#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const scriptPath = fileURLToPath(import.meta.url);
const scriptName = path.basename(scriptPath);
const projectRoot = path.resolve(path.dirname(scriptPath), '..');
const require = createRequire(import.meta.url);
const { loadEsmStyleModule } = require(path.join(projectRoot, 'tests', 'support', 'runtime.js'));
const { parseInputRecords } = loadEsmStyleModule(
  path.join(projectRoot, 'src', 'renderer', 'modules', 'sequence-viewer', 'parsing.js')
);
const { buildCircularPreviewHtmlDocument } = loadEsmStyleModule(
  path.join(projectRoot, 'src', 'renderer', 'modules', 'sequence-viewer', 'storage.js')
);
const sequenceLibrary = require(path.join(
  projectRoot,
  'src',
  'renderer',
  'modules',
  'sequence-viewer',
  'main-process',
  'sequence-library'
));
const libraryPaths = require(path.join(
  projectRoot,
  'src',
  'renderer',
  'modules',
  'sequence-viewer',
  'main-process',
  'sequence-library',
  'paths.js'
));

function usage() {
  return `Usage: node scripts/${scriptName} --storage-path <path> [options]

Regenerates the standalone HTML plasmid preview for every Sequence Library entry.
Only existing preview .html files are replaced; the Hikari database and GenBank files are not changed.

Options:
  --storage-path <path>  Hikari storage root (or set HIKARI_STORAGE_PATH).
  --entry <id>           Regenerate one entry. Repeat to select multiple entries.
  --dry-run              Report the previews that would be regenerated without writing files.
  --help                 Show this help text.
`;
}

function requireValue(args, index, option) {
  const value = String(args[index + 1] || '').trim();
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function parseArguments(args) {
  const options = {
    storagePath: String(process.env.HIKARI_STORAGE_PATH || '').trim(),
    entryIds: [],
    dryRun: false,
    help: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--storage-path') {
      options.storagePath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--entry') {
      options.entryIds.push(requireValue(args, index, arg));
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  options.storagePath = String(options.storagePath || '').trim();
  options.entryIds = [...new Set(options.entryIds.map((id) => String(id).trim()).filter(Boolean))];
  return options;
}

function buildPreviewRecord(entry, gbkText) {
  const parsed = parseInputRecords(String(gbkText || ''));
  const record = Array.isArray(parsed?.records) ? parsed.records[0] : null;
  if (!record?.sequence?.length) {
    const reason = Array.isArray(parsed?.errors) ? parsed.errors[0] : '';
    throw new Error(reason || 'Stored GenBank file contains no sequence.');
  }

  return {
    ...record,
    name: String(entry?.name || record.name || 'sequence').trim() || 'sequence',
    topology: String(entry?.topology || record.topology || 'linear').trim() || 'linear',
    sourceFormat: String(entry?.sourceFormat || record.sourceFormat || '').trim()
  };
}

async function regenerateEntry({ storagePath, paths, entry, dryRun }) {
  if (!entry?.id || !entry?.htmlRelPath) {
    throw new Error('Entry metadata is missing its preview path.');
  }

  const current = await sequenceLibrary.getSequenceEntry({
    storagePath,
    id: entry.id,
    includeGbk: true
  });
  if (!current?.entry || !String(current?.gbkText || '').trim()) {
    throw new Error('Stored GenBank file could not be read.');
  }

  const previewRecord = buildPreviewRecord(current.entry, current.gbkText);
  const htmlText = buildCircularPreviewHtmlDocument(previewRecord);
  if (!String(htmlText || '').trim()) {
    throw new Error('Preview renderer returned empty HTML.');
  }

  const htmlPath = libraryPaths.ensurePathWithinRoot(paths.libraryRoot, current.entry.htmlRelPath);
  if (!dryRun) {
    await fs.writeFile(htmlPath, htmlText, 'utf8');
  }

  return {
    id: current.entry.id,
    name: current.entry.name,
    htmlPath
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  if (!options.storagePath) {
    throw new Error(`Missing --storage-path.\n\n${usage()}`);
  }

  const storagePath = path.resolve(options.storagePath);
  const listing = await sequenceLibrary.listSequenceEntries({ storagePath });
  const selectedIds = new Set(options.entryIds);
  const entries = (Array.isArray(listing?.entries) ? listing.entries : [])
    .filter((entry) => !selectedIds.size || selectedIds.has(entry.id));
  const unavailableIds = [...selectedIds].filter((id) => !entries.some((entry) => entry.id === id));
  if (unavailableIds.length) {
    throw new Error(`Sequence Library entry not found: ${unavailableIds.join(', ')}`);
  }
  if (!entries.length) {
    process.stdout.write('No Sequence Library entries found.\n');
    return;
  }

  const paths = libraryPaths.resolveLibraryPaths(storagePath);
  const failures = [];
  let regenerated = 0;
  for (const entry of entries) {
    try {
      const result = await regenerateEntry({ storagePath, paths, entry, dryRun: options.dryRun });
      regenerated += 1;
      process.stdout.write(`${options.dryRun ? 'Would regenerate' : 'Regenerated'} ${result.name} (${result.id})\n`);
    } catch (error) {
      failures.push({ entry, error });
      process.stderr.write(`Failed ${entry?.name || entry?.id || 'sequence'}: ${error?.message || error}\n`);
    }
  }

  process.stdout.write(`${options.dryRun ? 'Would regenerate' : 'Regenerated'} ${regenerated}/${entries.length} plasmid preview HTML file${entries.length === 1 ? '' : 's'}.\n`);
  if (failures.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.message || error}\n`);
  process.exitCode = 1;
});
