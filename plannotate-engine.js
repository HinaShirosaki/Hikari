const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const https = require('https');
const { spawn } = require('child_process');

const MAX_PLASMID_SIZE = 50000;
const PROBLEM_HITS = new Set(['P03851', 'P03845', 'ISS', 'P03846']);

function resolveInstallRoot() {
  const envRoot = String(process.env.ENANA_PLANNOTATE_ROOT || process.env.PLANNOTATE_HOME || '').trim();
  if (envRoot) {
    return envRoot;
  }

  // Packaged Electron apps run from app.asar, which is read-only.
  if (String(__dirname).includes('.asar')) {
    return path.join(os.homedir(), '.enana', 'plannotate');
  }

  return path.join(__dirname, 'data', 'plannotate');
}

const PLANNOTATE_INSTALL_ROOT = resolveInstallRoot();
const PLANNOTATE_INSTALL_DATA_DIR = path.join(PLANNOTATE_INSTALL_ROOT, 'data');
const PLANNOTATE_INSTALL_DB_DIR = path.join(PLANNOTATE_INSTALL_ROOT, 'BLAST_dbs');
const METADATA_SOURCE_FILES = [
  'databases.yml',
  'snapgene.csv',
  'fpbase.csv',
  'swissprot.csv.gz',
  'colors.csv',
  'feature_orientation.csv',
  'protein_existence.csv'
];
const METADATA_REMOTE_BASE = 'https://raw.githubusercontent.com/mmcguffi/pLannotate/master/plannotate/data/data';
const BLAST_DBS_RELEASE_URL = 'https://github.com/mmcguffi/pLannotate/releases/download/v1.2.0/BLAST_dbs.tar.gz';

const DEFAULT_DATABASES = {
  Rfam: {
    method: 'infernal',
    priority: 3,
    parameters: ['--cpu', '1'],
    details: { default_type: 'ncRNA', compressed: false }
  },
  fpbase: {
    method: 'diamond',
    priority: 1,
    parameters: [
      '-k', '0',
      '--min-orf', '1',
      '--matrix', 'BLOSUM90',
      '--gapopen', '10',
      '--gapextend', '1',
      '--algo', 'ctg',
      '--id', '75',
      '--max-hsps', '10',
      '--culling-overlap', '200',
      '--seed-cut', '.001',
      '--comp-based-stats', '0',
      '--threads', '1'
    ],
    details: { default_type: 'CDS', compressed: false }
  },
  swissprot: {
    method: 'diamond',
    priority: 2,
    parameters: [
      '-k', '0',
      '--min-orf', '1',
      '--matrix', 'BLOSUM90',
      '--gapopen', '10',
      '--gapextend', '1',
      '--algo', 'ctg',
      '--id', '50',
      '--max-hsps', '10',
      '--culling-overlap', '200',
      '--seed-cut', '.001',
      '--comp-based-stats', '0',
      '--threads', '1'
    ],
    details: { default_type: 'CDS', compressed: true }
  },
  snapgene: {
    method: 'blastn',
    priority: 1,
    parameters: [
      '-perc_identity', '95',
      '-max_target_seqs', '20000',
      '-culling_limit', '25',
      '-word_size', '12',
      '-num_threads', '1'
    ],
    details: { default_type: null, compressed: false }
  }
};

const detailCache = new Map();

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function reverseComplementDna(sequence) {
  const map = {
    A: 'T',
    C: 'G',
    G: 'C',
    T: 'A',
    R: 'Y',
    Y: 'R',
    S: 'S',
    W: 'W',
    K: 'M',
    M: 'K',
    B: 'V',
    D: 'H',
    H: 'D',
    V: 'B',
    N: 'N'
  };
  return [...String(sequence || '').toUpperCase()]
    .reverse()
    .map((base) => map[base] || 'N')
    .join('');
}

function normalizeSequence(raw) {
  const cleaned = String(raw || '')
    .toUpperCase()
    .replace(/^>.*$/gm, '')
    .replace(/U/g, 'T')
    .replace(/[^ACGTRYSWKMBDHVN]/g, '');

  if (cleaned.length <= MAX_PLASMID_SIZE) {
    return { sequence: cleaned, warnings: [] };
  }

  return {
    sequence: cleaned.slice(0, MAX_PLASMID_SIZE),
    warnings: [`Input was truncated to ${MAX_PLASMID_SIZE.toLocaleString()} bases to match pLannotate size guidance.`]
  };
}

function parseCsvRow(line) {
  const fields = [];
  let current = '';
  let inQuote = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuote && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuote = !inQuote;
      }
      continue;
    }
    if (char === ',' && !inQuote) {
      fields.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  fields.push(current);
  return fields;
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runCommand(command, args, options = {}) {
  const {
    cwd = process.cwd(),
    allowNonZero = false
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0 || allowNonZero) {
        resolve({ code, stdout, stderr });
        return;
      }
      reject(new Error(`${command} exited with code ${code}. ${stderr || stdout}`.trim()));
    });
  });
}

function downloadFile(url, destination, redirectCount = 0) {
  const MAX_REDIRECTS = 5;
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        'User-Agent': 'Enana-pLannotate-Installer/1.0'
      }
    }, (response) => {
      const statusCode = Number(response.statusCode || 0);
      const location = response.headers.location;

      if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
        response.resume();
        if (redirectCount >= MAX_REDIRECTS) {
          reject(new Error(`Too many redirects while downloading ${url}`));
          return;
        }
        const nextUrl = location.startsWith('http') ? location : new URL(location, url).toString();
        downloadFile(nextUrl, destination, redirectCount + 1).then(resolve).catch(reject);
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`Download failed (${statusCode}) for ${url}`));
        return;
      }

      const stream = fs.createWriteStream(destination);
      response.pipe(stream);
      stream.on('finish', () => {
        stream.close(() => resolve(destination));
      });
      stream.on('error', (error) => {
        reject(error);
      });
    });

    request.on('error', (error) => {
      reject(error);
    });
  });
}

async function copyDirectory(sourceDir, destinationDir) {
  await fsp.mkdir(destinationDir, { recursive: true });
  const entries = await fsp.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(sourceDir, entry.name);
    const to = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(from, to);
      continue;
    }
    if (entry.isFile()) {
      await fsp.copyFile(from, to);
    }
  }
}

function localMetadataSourceDir() {
  const candidates = [
    path.join(__dirname, 'tmp', 'pLannotate-src', 'plannotate', 'data', 'data'),
    path.join(process.cwd(), 'tmp', 'pLannotate-src', 'plannotate', 'data', 'data')
  ];
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, 'snapgene.csv'))) || '';
}

function localDbSourceDir() {
  const candidates = [
    path.join(__dirname, 'tmp', 'pLannotate-src', 'plannotate', 'data', 'BLAST_dbs'),
    path.join(process.cwd(), 'tmp', 'pLannotate-src', 'plannotate', 'data', 'BLAST_dbs')
  ];
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, 'snapgene.nsq'))) || '';
}

async function findExecutable(command) {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  try {
    const result = await runCommand(locator, [command], { allowNonZero: true });
    if (result.code !== 0) {
      // Continue to fallback path probing below.
    } else {
      const first = result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      if (first) {
        return first;
      }
    }
  } catch {
    // Continue to fallback path probing below.
  }

  const pathEntries = String(process.env.PATH || '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (process.platform === 'darwin') {
    pathEntries.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/local/ncbi/blast/bin');
  } else if (process.platform === 'linux') {
    pathEntries.push('/usr/local/bin', '/usr/bin', '/bin');
  }

  const binaryName = process.platform === 'win32' ? `${command}.exe` : command;
  for (const dir of [...new Set(pathEntries)]) {
    const candidate = path.join(dir, binaryName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return '';
}

async function installExecutables(logs) {
  let blastn = await findExecutable('blastn');
  let diamond = await findExecutable('diamond');
  if (blastn && diamond) {
    logs.push('executables: blastn and diamond already present');
    return;
  }

  const brew = await findExecutable('brew');
  if (brew) {
    const missingPackages = [];
    if (!blastn) {
      missingPackages.push('blast');
    }
    if (!diamond) {
      missingPackages.push('diamond');
    }

    for (const pkg of missingPackages) {
      const installed = await runCommand(brew, ['list', '--versions', pkg], { allowNonZero: true });
      if (installed.code === 0 && installed.stdout.trim()) {
        logs.push(`executables: brew package ${pkg} already installed`);
        continue;
      }
      logs.push(`executables: installing ${pkg} with brew`);
      await runCommand(brew, ['install', pkg], { allowNonZero: false });
      logs.push(`executables: installed ${pkg}`);
    }
  } else {
    logs.push('executables: brew not found; skipped automatic executable install');
  }

  blastn = await findExecutable('blastn');
  diamond = await findExecutable('diamond');
  if (!blastn || !diamond) {
    const missing = [];
    if (!blastn) {
      missing.push('blastn');
    }
    if (!diamond) {
      missing.push('diamond');
    }
    logs.push(`executables: still missing ${missing.join(', ')}`);
  } else {
    logs.push('executables: blastn and diamond detected after install step');
  }
}

function resolveDataDir() {
  const candidates = [
    PLANNOTATE_INSTALL_DATA_DIR,
    path.join(__dirname, 'data', 'plannotate', 'data'),
    path.join(__dirname, 'tmp', 'pLannotate-src', 'plannotate', 'data', 'data'),
    path.join(process.cwd(), 'data', 'plannotate', 'data'),
    path.join(process.cwd(), 'tmp', 'pLannotate-src', 'plannotate', 'data', 'data')
  ];

  return candidates.find((dir) => {
    if (!dir || !fs.existsSync(dir)) {
      return false;
    }
    return fs.existsSync(path.join(dir, 'snapgene.csv')) && fs.existsSync(path.join(dir, 'fpbase.csv'));
  }) || '';
}

function resolveDbDir(preferredDbDir = '') {
  const envDir = String(process.env.PLANNOTATE_DB_DIR || '').trim();
  const candidates = [
    preferredDbDir,
    envDir,
    PLANNOTATE_INSTALL_DB_DIR,
    path.join(__dirname, 'data', 'plannotate', 'BLAST_dbs'),
    path.join(__dirname, 'tmp', 'pLannotate-src', 'plannotate', 'data', 'BLAST_dbs'),
    path.join(process.cwd(), 'data', 'plannotate', 'BLAST_dbs'),
    path.join(process.cwd(), 'tmp', 'pLannotate-src', 'plannotate', 'data', 'BLAST_dbs')
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    if (fs.existsSync(path.join(candidate, 'snapgene.nsq'))) {
      return candidate;
    }
    const nested = path.join(candidate, 'BLAST_dbs');
    if (fs.existsSync(path.join(nested, 'snapgene.nsq'))) {
      return nested;
    }
  }

  return '';
}

function hasBlastDb(dbDir, name) {
  if (!dbDir) {
    return false;
  }
  return (
    fs.existsSync(path.join(dbDir, `${name}.nhr`))
    && fs.existsSync(path.join(dbDir, `${name}.nin`))
    && fs.existsSync(path.join(dbDir, `${name}.nsq`))
  );
}

function hasDiamondDb(dbDir, name) {
  if (!dbDir) {
    return false;
  }
  return fs.existsSync(path.join(dbDir, `${name}.dmnd`));
}

function parsePriorityMod(description) {
  const text = String(description || '');
  const index = text.indexOf('existence level');
  if (index === -1) {
    return 0;
  }
  const digit = Number(text[index + 16]);
  if (!Number.isFinite(digit) || digit < 1) {
    return 0;
  }
  return digit - 1;
}

async function loadCsvDetails(dbName, dataDir) {
  const cacheKey = `csv:${dbName}:${dataDir}`;
  if (detailCache.has(cacheKey)) {
    return detailCache.get(cacheKey);
  }

  const filePath = path.join(dataDir, `${dbName}.csv`);
  if (!fs.existsSync(filePath)) {
    const empty = new Map();
    detailCache.set(cacheKey, empty);
    return empty;
  }

  const raw = await fsp.readFile(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (!lines.length) {
    const empty = new Map();
    detailCache.set(cacheKey, empty);
    return empty;
  }

  const header = parseCsvRow(lines[0]);
  const map = new Map();
  for (let i = 1; i < lines.length; i += 1) {
    const row = parseCsvRow(lines[i]);
    const item = {};
    for (let j = 0; j < header.length; j += 1) {
      item[header[j]] = row[j] ?? '';
    }
    const sseqid = String(item.sseqid || '').trim();
    if (!sseqid) {
      continue;
    }
    map.set(sseqid, {
      Feature: item.Feature || sseqid,
      Description: item.Description || '',
      Type: item.Type || '',
      priority_mod: dbName === 'swissprot' ? parsePriorityMod(item.Description || '') : 0
    });
  }

  detailCache.set(cacheKey, map);
  return map;
}

async function loadSwissprotSubset(sseqids, dataDir) {
  const unique = [...new Set(sseqids.map((id) => String(id || '').trim()).filter(Boolean))];
  const map = new Map();
  if (!unique.length) {
    return map;
  }

  const filePath = path.join(dataDir, 'swissprot.csv.gz');
  if (!fs.existsSync(filePath)) {
    return map;
  }

  const rgPath = await findExecutable('rg');
  if (!rgPath) {
    return map;
  }

  const pattern = unique.map((value) => escapeRegex(value)).join('|');
  if (!pattern) {
    return map;
  }

  const result = await runCommand(rgPath, ['-z', pattern, filePath], { allowNonZero: true });
  if (result.code !== 0 || !result.stdout.trim()) {
    return map;
  }

  const lines = result.stdout.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const row = parseCsvRow(line);
    if (!row.length) {
      continue;
    }
    const sseqid = String(row[0] || '').trim();
    if (!sseqid) {
      continue;
    }
    const description = row.slice(2).join(',') || '';
    map.set(sseqid, {
      Feature: row[1] || sseqid,
      Description: description,
      Type: 'CDS',
      priority_mod: parsePriorityMod(description)
    });
  }

  return map;
}

function buildDatabaseConfig(dbDir) {
  return Object.entries(DEFAULT_DATABASES).map(([name, source]) => ({
    name,
    method: source.method,
    priority: source.priority,
    parameters: [...source.parameters],
    details: { ...source.details },
    dbPath: source.method === 'infernal'
      ? {
        clanin: path.join(dbDir, `${name}.clanin`),
        cm: path.join(dbDir, `${name}.cm`)
      }
      : path.join(dbDir, name)
  }));
}

function parseBlastRows(stdout, columns) {
  const rows = [];
  const lines = String(stdout || '').split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length < columns.length) {
      continue;
    }
    const row = {};
    for (let i = 0; i < columns.length; i += 1) {
      row[columns[i]] = parts[i];
    }
    rows.push(row);
  }
  return rows;
}

async function runBlastTask({ sequence, database, tmpDir, warnings, executables }) {
  const queryPath = path.join(tmpDir, `${database.name}.query.fa`);
  const outputPath = path.join(tmpDir, `${database.name}.out.tsv`);
  await fsp.writeFile(queryPath, `>plannotate_query\n${sequence}\n`, 'utf8');

  if (database.method === 'blastn') {
    if (!executables.blastn) {
      warnings.push('blastn executable not found. snapgene database was skipped.');
      return [];
    }
    if (!hasBlastDb(path.dirname(database.dbPath), path.basename(database.dbPath))) {
      warnings.push('snapgene BLAST database files not found. snapgene database was skipped.');
      return [];
    }

    const columns = ['qstart', 'qend', 'sseqid', 'sframe', 'pident', 'slen', 'qseq', 'length', 'sstart', 'send', 'qlen', 'evalue'];
    const args = [
      '-task', 'blastn-short',
      '-query', queryPath,
      '-out', outputPath,
      '-db', database.dbPath,
      ...database.parameters,
      '-outfmt', `6 ${columns.join(' ')}`
    ];
    await runCommand(executables.blastn, args, { allowNonZero: true });
    const out = fs.existsSync(outputPath) ? await fsp.readFile(outputPath, 'utf8') : '';
    return parseBlastRows(out, columns).map((row) => ({
      ...row,
      sframe: asNumber(row.sframe),
      pident: asNumber(row.pident),
      slen: asNumber(row.slen),
      length: asNumber(row.length),
      qstart: asNumber(row.qstart),
      qend: asNumber(row.qend),
      sstart: asNumber(row.sstart),
      send: asNumber(row.send),
      qlen: asNumber(row.qlen),
      evalue: asNumber(row.evalue),
      db: database.name
    }));
  }

  if (database.method === 'diamond') {
    if (!executables.diamond) {
      warnings.push('diamond executable not found. protein databases were skipped.');
      return [];
    }
    if (!hasDiamondDb(path.dirname(database.dbPath), path.basename(database.dbPath))) {
      warnings.push(`${database.name} diamond database was not found and was skipped.`);
      return [];
    }

    const columns = ['qstart', 'qend', 'sseqid', 'pident', 'slen', 'qseq', 'length', 'sstart', 'send', 'qlen', 'evalue'];
    const args = [
      'blastx',
      '-d', database.dbPath,
      '-q', queryPath,
      '-o', outputPath,
      ...database.parameters,
      '--outfmt', '6',
      ...columns
    ];
    await runCommand(executables.diamond, args, { allowNonZero: true });
    const out = fs.existsSync(outputPath) ? await fsp.readFile(outputPath, 'utf8') : '';
    return parseBlastRows(out, columns).map((row) => {
      const qstart = asNumber(row.qstart);
      const qend = asNumber(row.qend);
      return {
        ...row,
        sseqid: String(row.sseqid || '').split('|')[1] || row.sseqid,
        sframe: qstart < qend ? 1 : -1,
        pident: asNumber(row.pident),
        slen: asNumber(row.slen) * 3,
        length: Math.abs(qend - qstart) + 1,
        qstart,
        qend,
        sstart: asNumber(row.sstart),
        send: asNumber(row.send),
        qlen: asNumber(row.qlen),
        evalue: asNumber(row.evalue),
        db: database.name
      };
    });
  }

  if (database.method === 'infernal') {
    warnings.push('infernal/cmscan integration is not available in this build; Rfam was skipped.');
    return [];
  }

  return [];
}

function normalizeHitNumbers(hit) {
  hit.qstart = asNumber(hit.qstart);
  hit.qend = asNumber(hit.qend);
  hit.sstart = asNumber(hit.sstart);
  hit.send = asNumber(hit.send);
  hit.sframe = asNumber(hit.sframe, 1);
  hit.pident = asNumber(hit.pident);
  hit.slen = asNumber(hit.slen);
  hit.length = asNumber(hit.length);
  hit.qlen = asNumber(hit.qlen);
  hit.evalue = asNumber(hit.evalue, 999);
  hit.priority = asNumber(hit.priority, 1);
  return hit;
}

function calculateHit(hit, linear) {
  hit.qstart -= 1;
  hit.qend -= 1;
  if (hit.qstart > hit.qend) {
    const temp = hit.qstart;
    hit.qstart = hit.qend;
    hit.qend = temp;
  }

  hit.percmatch = hit.slen ? (hit.length / hit.slen) * 100 : 0;
  hit.abs_percmatch = 100 - Math.abs(100 - hit.percmatch);
  hit.pi_permatch = (hit.pident * hit.abs_percmatch) / 100;
  hit.score = (hit.pi_permatch / 100) * hit.length;
  hit.score *= (2 ** (-1 * hit.priority)) * 2;

  if (!linear) {
    hit.qlen = Math.floor(hit.qlen / 2);
  }

  if (hit.pi_permatch === 100) {
    hit.score *= (1 / hit.priority) * 10;
  }

  hit.wiggle = Math.floor(hit.length * 0.15);
  hit.wstart = hit.qstart + hit.wiggle;
  hit.wend = hit.qend - hit.wiggle;
  return hit;
}

function getIntervals(hit, topology) {
  if (topology === 'linear') {
    const start = Math.min(hit.wstart, hit.wend);
    const end = Math.max(hit.wstart, hit.wend);
    return [[start, end]];
  }

  if (hit.wend >= hit.wstart) {
    return [[hit.wstart, hit.wend]];
  }

  return [
    [0, hit.wend],
    [hit.wstart, hit.qlen - 1]
  ];
}

function intervalsOverlap(left, right) {
  return left[0] <= right[1] && right[0] <= left[1];
}

function isFragment(hit) {
  if (hit.Type === 'CDS') {
    if (hit.pi_permatch === 100) {
      return false;
    }
    if ((hit.length % 3) === 0 && hit.percmatch > 95) {
      return false;
    }
    return true;
  }
  return hit.percmatch < 95;
}

function cleanHits(hits, detailed, topology) {
  const normalized = hits.map((hit) => {
    const next = { ...hit };
    next.qstart_dup = next.qstart;
    next.qend_dup = next.qend;
    if (next.qstart >= next.qlen) {
      next.qstart -= next.qlen;
    }
    if (next.qend >= next.qlen) {
      next.qend -= next.qlen;
    }
    if (next.wstart >= next.qlen) {
      next.wstart -= next.qlen;
    }
    if (next.wend >= next.qlen) {
      next.wend -= next.qlen;
    }
    return next;
  });

  const filtered = normalized
    .filter((hit) => !PROBLEM_HITS.has(hit.sseqid))
    .filter((hit) => hit.evalue < 1)
    .filter((hit) => hit.pi_permatch > 3)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (b.length !== a.length) {
        return b.length - a.length;
      }
      return b.percmatch - a.percmatch;
    });

  const dedupe = new Map();
  filtered.forEach((hit) => {
    const key = [
      hit.sseqid,
      hit.qstart,
      hit.qend,
      hit.sframe,
      Math.round(hit.pident * 1000) / 1000,
      hit.db
    ].join('|');
    const existing = dedupe.get(key);
    if (!existing || hit.score > existing.score) {
      dedupe.set(key, hit);
    }
  });

  const sorted = [...dedupe.values()].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (b.length !== a.length) {
      return b.length - a.length;
    }
    return b.percmatch - a.percmatch;
  });

  const kept = [];
  sorted.forEach((candidate) => {
    const candidateKind = detailed ? candidate.kind : 'all';
    const candidateIntervals = getIntervals(candidate, topology);
    const overlap = kept.some((existing) => {
      const existingKind = detailed ? existing.kind : 'all';
      if (existingKind !== candidateKind) {
        return false;
      }
      const existingIntervals = getIntervals(existing, topology);
      return candidateIntervals.some((left) => existingIntervals.some((right) => intervalsOverlap(left, right)));
    });
    if (!overlap) {
      kept.push(candidate);
    }
  });

  return kept.map((hit) => {
    const next = { ...hit };
    next.fragment = isFragment(next);
    next.qend += 1;
    next.matchMode = next.pi_permatch === 100 ? 'exact' : 'blast';
    if (next.sframe === -1 && next.qseq) {
      next.qseq = reverseComplementDna(next.qseq);
    }
    if (!next.Feature) {
      next.Feature = next.sseqid || 'feature';
    }
    if (!next.Description) {
      next.Description = '';
    }
    if (!next.Type) {
      next.Type = 'misc_feature';
    }
    if (topology === 'circular') {
      next.crossesOrigin = next.qend < next.qstart;
    } else {
      next.crossesOrigin = false;
    }
    return next;
  });
}

async function enrichHitDetails(hits, dataDir, database, detailed) {
  if (!hits.length) {
    return hits;
  }

  let detailsMap = new Map();
  if (database.name === 'swissprot') {
    detailsMap = await loadSwissprotSubset(hits.map((hit) => hit.sseqid), dataDir);
  } else {
    detailsMap = await loadCsvDetails(database.name, dataDir);
  }

  return hits.map((hit) => {
    const next = { ...hit };
    next.sseqid = String(next.sseqid || '').replace(/^pdb\|(.*)\|$/, '$1');
    const detail = detailsMap.get(next.sseqid);
    if (detail) {
      next.Feature = detail.Feature || next.Feature;
      next.Description = detail.Description || next.Description;
      if (!next.Type) {
        next.Type = detail.Type || next.Type;
      }
      if (database.name === 'swissprot' && Number.isFinite(detail.priority_mod)) {
        next.priority += detail.priority_mod;
      }
    }
    if (!next.Type && database.details.default_type) {
      next.Type = database.details.default_type;
    }
    if (next.Type === 'primer_bind') {
      next.__drop = true;
    }
    next.kind = detailed ? (next.Type || 'misc_feature') : 1;
    return next;
  }).filter((hit) => !hit.__drop);
}

async function installMetadataFiles(logs) {
  await fsp.mkdir(PLANNOTATE_INSTALL_DATA_DIR, { recursive: true });
  const localSource = localMetadataSourceDir();

  for (const fileName of METADATA_SOURCE_FILES) {
    const destination = path.join(PLANNOTATE_INSTALL_DATA_DIR, fileName);
    if (fs.existsSync(destination)) {
      logs.push(`metadata: ${fileName} already present`);
      continue;
    }

    if (localSource && fs.existsSync(path.join(localSource, fileName))) {
      await fsp.copyFile(path.join(localSource, fileName), destination);
      logs.push(`metadata: copied ${fileName} from local source`);
      continue;
    }

    const remoteUrl = `${METADATA_REMOTE_BASE}/${fileName}`;
    await downloadFile(remoteUrl, destination);
    logs.push(`metadata: downloaded ${fileName}`);
  }
}

async function installBlastDatabases(logs) {
  if (
    hasBlastDb(PLANNOTATE_INSTALL_DB_DIR, 'snapgene')
    && hasDiamondDb(PLANNOTATE_INSTALL_DB_DIR, 'fpbase')
    && hasDiamondDb(PLANNOTATE_INSTALL_DB_DIR, 'swissprot')
  ) {
    logs.push('databases: BLAST and diamond databases already present');
    return;
  }

  const localDbSource = localDbSourceDir();
  if (localDbSource) {
    await copyDirectory(localDbSource, PLANNOTATE_INSTALL_DB_DIR);
    logs.push('databases: copied local BLAST_dbs directory');
    return;
  }

  await fsp.mkdir(PLANNOTATE_INSTALL_ROOT, { recursive: true });
  const archivePath = path.join(PLANNOTATE_INSTALL_ROOT, 'BLAST_dbs.tar.gz');
  await downloadFile(BLAST_DBS_RELEASE_URL, archivePath);
  logs.push('databases: downloaded BLAST_dbs archive');

  await runCommand('tar', ['-xzf', archivePath, '-C', PLANNOTATE_INSTALL_ROOT]);
  logs.push('databases: extracted BLAST_dbs archive');

  await fsp.rm(archivePath, { force: true });
}

async function installPlannotateAssets() {
  const logs = [];
  logs.push(`install-root: ${PLANNOTATE_INSTALL_ROOT}`);
  logs.push(`platform: ${process.platform} ${process.arch}`);
  await installMetadataFiles(logs);
  await installBlastDatabases(logs);
  await installExecutables(logs);
  const status = await checkPlannotateEnvironment('');
  return { status, logs };
}

async function checkPlannotateEnvironment(preferredDbDir = '') {
  const dataDir = resolveDataDir();
  const dbDir = resolveDbDir(preferredDbDir);
  const blastn = await findExecutable('blastn');
  const diamond = await findExecutable('diamond');
  const cmscan = await findExecutable('cmscan');

  return {
    ok: Boolean(dataDir && dbDir && blastn && diamond && hasBlastDb(dbDir, 'snapgene') && hasDiamondDb(dbDir, 'fpbase') && hasDiamondDb(dbDir, 'swissprot')),
    dataDir,
    dbDir,
    executables: {
      blastn,
      diamond,
      cmscan
    },
    databases: {
      snapgene: hasBlastDb(dbDir, 'snapgene'),
      fpbase: hasDiamondDb(dbDir, 'fpbase'),
      swissprot: hasDiamondDb(dbDir, 'swissprot'),
      rfam: fs.existsSync(path.join(dbDir, 'Rfam.cm')) && fs.existsSync(path.join(dbDir, 'Rfam.clanin'))
    }
  };
}

async function annotateWithBlast(payload = {}) {
  const topology = payload.topology === 'linear' ? 'linear' : 'circular';
  const detailed = Boolean(payload.detailed);
  const { sequence, warnings: normalizeWarnings } = normalizeSequence(payload.sequenceText || payload.sequence || '');

  if (!sequence) {
    return {
      sequence: '',
      sequenceLength: 0,
      topology,
      options: payload,
      warnings: ['No valid DNA sequence was provided.'],
      stats: {
        referenceFeatures: 0,
        rawHits: 0,
        finalHits: 0,
        exactHits: 0,
        partialHits: 0
      },
      hits: []
    };
  }

  const env = await checkPlannotateEnvironment(payload.dbDir || '');
  const warnings = [...normalizeWarnings];
  if (!env.dataDir) {
    throw new Error('pLannotate metadata files were not found. Click One-Step Install Backend to download them.');
  }
  if (!env.executables.blastn) {
    throw new Error('blastn was not found on PATH. Install NCBI BLAST+ before annotating.');
  }
  if (!env.executables.diamond) {
    throw new Error('diamond was not found on PATH. Install diamond before annotating.');
  }
  if (!env.dbDir) {
    throw new Error('BLAST database folder was not found. Click One-Step Install Backend to download BLAST_dbs.');
  }
  if (!env.databases.snapgene || !env.databases.fpbase || !env.databases.swissprot) {
    throw new Error('Required pLannotate databases are missing (need snapgene BLAST and fpbase/swissprot diamond DBs).');
  }
  if (!env.databases.rfam) {
    warnings.push('Rfam infernal database was not found. ncRNA hits will be omitted.');
  }

  const query = topology === 'linear' ? sequence : `${sequence}${sequence}`;
  const databases = buildDatabaseConfig(env.dbDir);
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'plannotate-'));

  let rawHits = [];
  try {
    for (const database of databases) {
      const blastHits = await runBlastTask({
        sequence: query,
        database,
        tmpDir,
        warnings,
        executables: env.executables
      });
      if (!blastHits.length) {
        continue;
      }

      const enriched = await enrichHitDetails(blastHits, env.dataDir, database, detailed);
      const calculated = enriched.map((hit) => normalizeHitNumbers(calculateHit({
        ...hit,
        priority: database.priority
      }, topology === 'linear')));
      rawHits = rawHits.concat(calculated);
    }
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  if (!rawHits.length) {
    return {
      sequence,
      sequenceLength: sequence.length,
      topology,
      options: payload,
      warnings: warnings.length ? warnings : ['No annotations were found by blastn/diamond.'],
      stats: {
        referenceFeatures: 0,
        rawHits: 0,
        finalHits: 0,
        exactHits: 0,
        partialHits: 0
      },
      hits: []
    };
  }

  const cleaned = cleanHits(rawHits, detailed, topology).slice(0, 500);
  const exactHits = cleaned.filter((hit) => hit.pi_permatch === 100).length;
  const partialHits = cleaned.length - exactHits;

  return {
    sequence,
    sequenceLength: sequence.length,
    topology,
    options: payload,
    warnings,
    stats: {
      referenceFeatures: rawHits.length,
      rawHits: rawHits.length,
      finalHits: cleaned.length,
      exactHits,
      partialHits
    },
    hits: cleaned
  };
}

module.exports = {
  annotateWithBlast,
  checkPlannotateEnvironment,
  installPlannotateAssets
};
