const fs = require('fs/promises');
const path = require('path');
const { app } = require('electron');
const { Telegraf } = require('telegraf');

const TELEGRAM_MODULE_MAP = new Map([
  ['home', { type: 'open-view', viewId: 'home-view', label: 'Home' }],
  ['members', { type: 'open-view', viewId: 'lab-management-view', label: 'Members' }],
  ['member', { type: 'open-view', viewId: 'lab-management-view', label: 'Members' }],
  ['instruments', { type: 'open-view', viewId: 'instrument-management-view', label: 'Instruments' }],
  ['instrument', { type: 'open-view', viewId: 'instrument-management-view', label: 'Instruments' }],
  ['protocols', { type: 'open-view', viewId: 'protocol-management-view', label: 'Protocols' }],
  ['protocol', { type: 'open-view', viewId: 'protocol-management-view', label: 'Protocols' }],
  ['collaborations', { type: 'open-view', viewId: 'collaboration-management-view', label: 'Collaborations' }],
  ['collaboration', { type: 'open-view', viewId: 'collaboration-management-view', label: 'Collaborations' }],
  ['synthesis', { type: 'open-view', viewId: 'synthesis-notebook-view', label: 'Synthesis Notebook' }],
  ['biology', { type: 'open-view', viewId: 'biology-notebook-view', label: 'Biology Notebook' }],
  ['chemicals', { type: 'open-view', viewId: 'lab-common-inventory-view', label: 'Chemicals' }],
  ['samples', { type: 'open-view', viewId: 'sample-registry-view', label: 'Samples' }],
  ['assay', { type: 'open-view', viewId: 'assay-view', label: 'Assay' }],
  ['gel', { type: 'open-view', viewId: 'gel-view', label: 'Gel' }],
  ['inventory', { type: 'open-view', viewId: 'personal-inventory-view', label: 'Personal Inventory' }],
  ['projects', { type: 'open-view', viewId: 'project-management-view', label: 'Projects' }],
  ['workflows', { type: 'open-view', viewId: 'workflow-management-view', label: 'Workflows' }],
  ['papers', { type: 'open-view', viewId: 'papers-view', label: 'Papers' }],
  ['tools', { type: 'open-view', viewId: 'tool-box-view', label: 'Tools' }],
  ['toolbox', { type: 'open-view', viewId: 'tool-box-view', label: 'Tools' }],
  ['settings', { type: 'open-view', viewId: 'setting-view', label: 'Settings' }],
  ['setting', { type: 'open-view', viewId: 'setting-view', label: 'Settings' }]
]);

const TELEGRAM_SEARCH_TARGETS = new Map([
  ['inventory', { scope: 'chemicals', label: 'Chemicals', type: 'search-chemicals' }],
  ['chemical', { scope: 'chemicals', label: 'Chemicals', type: 'search-chemicals' }],
  ['chemicals', { scope: 'chemicals', label: 'Chemicals', type: 'search-chemicals' }],
  ['sample', { scope: 'samples', label: 'Samples', type: 'search-samples' }],
  ['samples', { scope: 'samples', label: 'Samples', type: 'search-samples' }],
  ['assay', { scope: 'assay', label: 'Assay', type: 'search-assays' }],
  ['assays', { scope: 'assay', label: 'Assay', type: 'search-assays' }],
  ['gel', { scope: 'gel', label: 'Gel', type: 'search-gels' }],
  ['gels', { scope: 'gel', label: 'Gel', type: 'search-gels' }]
]);

const LOOKUP_ACTIONS = new Map([
  ['inventory', { label: 'Inventory', moduleToken: 'chemicals', searchToken: 'inventory', globalScope: 'chemical' }],
  ['sample', { label: 'Sample', moduleToken: 'samples', searchToken: 'samples', globalScope: 'sample' }],
  ['construct', { label: 'Construct', moduleToken: 'samples', searchToken: 'samples', globalScope: 'sample' }],
  ['protocol', { label: 'Protocol', moduleToken: 'protocols', globalScope: 'protocol' }],
  ['project', { label: 'Project', moduleToken: 'projects', globalScope: 'project' }],
  ['instrument', { label: 'Instrument', moduleToken: 'instruments', globalScope: 'instrument' }],
  ['paper', { label: 'Paper', moduleToken: 'papers', globalScope: 'papers' }],
  ['lot', { label: 'Lot', moduleToken: 'chemicals', searchToken: 'chemicals', globalScope: 'chemical' }],
  ['location', { label: 'Location', moduleToken: 'samples', searchToken: 'samples', globalScope: 'sample' }],
  ['expiry', { label: 'Expiry', moduleToken: 'chemicals', searchToken: 'chemicals', globalScope: 'chemical' }]
]);

const SEARCH_SCOPE_TO_LOOKUP_SUBINTENT = new Map([
  ['inventory', 'inventory'],
  ['chemical', 'inventory'],
  ['chemicals', 'inventory'],
  ['sample', 'sample'],
  ['samples', 'sample'],
  ['construct', 'construct'],
  ['constructs', 'construct'],
  ['protocol', 'protocol'],
  ['protocols', 'protocol'],
  ['project', 'project'],
  ['projects', 'project'],
  ['instrument', 'instrument'],
  ['instruments', 'instrument'],
  ['paper', 'paper'],
  ['papers', 'paper'],
  ['library', 'paper'],
  ['lot', 'lot'],
  ['lots', 'lot'],
  ['expiry', 'expiry'],
  ['expiring', 'expiry'],
  ['location', 'location']
]);

const DEFAULT_PROTOCOL_STEPS = [
  'Clarify lysate by centrifugation at configured conditions.',
  'Equilibrate Ni-NTA resin with binding buffer.',
  'Load clarified lysate onto the affinity column.',
  'Wash resin with low-imidazole wash buffer.',
  'Elute target protein with high-imidazole buffer.',
  'Collect and label elution fractions.',
  'Assess fractions by SDS-PAGE.',
  'Pool target-containing fractions.',
  'Buffer-exchange and concentrate pooled protein.',
  'Store aliquots and record final yield.'
];

const EVENT_TO_DRAFT_TYPE = new Map([
  ['protein_expression', 'notebook'],
  ['transformation', 'notebook'],
  ['transfection', 'notebook'],
  ['cell_culture', 'notebook'],
  ['purification', 'notebook'],
  ['assay', 'assay'],
  ['gel', 'notebook'],
  ['inventory_usage', 'reagent_checklist'],
  ['decision', 'decision'],
  ['task', 'task'],
  ['sample_registration', 'notebook'],
  ['reagent_registration', 'reagent_checklist'],
  ['checklist', 'notebook'],
  ['daily_summary', 'notebook'],
  ['reservation_request', 'reservation'],
  ['observation', 'notebook']
]);

const DRAFT_TYPE_LABELS = new Map([
  ['notebook', 'notebook entry'],
  ['decision', 'decision record'],
  ['task', 'task list'],
  ['assay', 'assay plan'],
  ['reagent_checklist', 'reagent checklist'],
  ['reservation', 'reservation request']
]);

const FIELD_LABEL_MAP = new Map([
  ['target_protein', 'target protein'],
  ['construct', 'construct'],
  ['host_strain', 'host strain'],
  ['culture_id', 'culture ID'],
  ['induction_od600', 'induction OD600'],
  ['inducer', 'inducer'],
  ['inducer_concentration', 'inducer concentration'],
  ['temperature_c', 'temperature (C)'],
  ['start_time', 'start time'],
  ['harvest_time', 'harvest time'],
  ['project', 'project'],
  ['protocol', 'protocol'],
  ['cell_line', 'cell line'],
  ['action', 'action'],
  ['split_ratio', 'split ratio'],
  ['confluency', 'confluency'],
  ['vessel', 'vessel'],
  ['media', 'media'],
  ['target', 'target'],
  ['sample_input', 'input sample'],
  ['purification_method', 'purification method'],
  ['fractions', 'fractions'],
  ['buffers', 'buffers'],
  ['linked_gel', 'linked gel'],
  ['assay_type', 'assay type'],
  ['assay_id', 'assay ID'],
  ['sample_set', 'sample set'],
  ['readout', 'readout'],
  ['controls', 'controls'],
  ['gel_type', 'gel type'],
  ['ladder', 'ladder'],
  ['expected_band_kda', 'expected band (kDa)'],
  ['items', 'items'],
  ['decision_text', 'decision'],
  ['reason', 'reason'],
  ['evidence_refs', 'evidence refs'],
  ['task_text', 'task'],
  ['sample_id', 'sample ID'],
  ['sample_name', 'sample name'],
  ['sample_type', 'sample type'],
  ['location', 'location'],
  ['reagent_name', 'reagent name'],
  ['lot_number', 'lot number'],
  ['amount', 'amount'],
  ['unit', 'unit'],
  ['summary', 'summary'],
  ['events', 'events'],
  ['event_count', 'event count'],
  ['title', 'title'],
  ['message_text', 'message']
]);

function getMainWindowSafe(getMainWindow) {
  const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : null;
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }
  return mainWindow;
}

function getCommandArgs(text) {
  return String(text || '').replace(/^\/\S+\s*/, '').trim();
}

function normalizeTokenKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function getModuleTarget(token) {
  return TELEGRAM_MODULE_MAP.get(normalizeTokenKey(token)) || null;
}

function getSearchTarget(token) {
  return TELEGRAM_SEARCH_TARGETS.get(normalizeTokenKey(token)) || null;
}

function splitFirstToken(value) {
  const text = String(value || '').trim();
  if (!text) {
    return { first: '', rest: '' };
  }
  const firstSpace = text.indexOf(' ');
  if (firstSpace < 0) {
    return { first: text, rest: '' };
  }
  return {
    first: text.slice(0, firstSpace).trim(),
    rest: text.slice(firstSpace + 1).trim()
  };
}

function levenshteinDistance(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (!a) {
    return b.length;
  }
  if (!b) {
    return a.length;
  }

  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) {
    matrix[i][0] = i;
  }
  for (let j = 0; j <= b.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
}

function getModuleCatalog() {
  const byView = new Map();
  TELEGRAM_MODULE_MAP.forEach((target, token) => {
    if (!byView.has(target.viewId)) {
      byView.set(target.viewId, {
        token,
        label: target.label
      });
    }
  });
  return Array.from(byView.values()).sort((a, b) => a.token.localeCompare(b.token));
}

function getModuleSuggestions(token, limit = 3) {
  const query = normalizeTokenKey(token);
  if (!query) {
    return [];
  }

  const candidates = getModuleCatalog().map((entry) => entry.token);
  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: levenshteinDistance(query, candidate)
    }))
    .sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate));

  const threshold = Math.max(2, Math.floor(query.length / 2));
  const closeMatches = scored
    .filter((entry) => entry.score <= threshold)
    .slice(0, limit)
    .map((entry) => entry.candidate);
  if (closeMatches.length) {
    return closeMatches;
  }

  return candidates
    .filter((candidate) => candidate.includes(query) || query.includes(candidate))
    .slice(0, limit);
}

function sendTelegramCommandToRenderer(getMainWindow, payload) {
  const mainWindow = getMainWindowSafe(getMainWindow);
  if (!mainWindow) {
    return false;
  }
  mainWindow.webContents.send('telegram-command', payload);
  return true;
}

function sendSearchCommand(getMainWindow, target, query) {
  return sendTelegramCommandToRenderer(getMainWindow, {
    type: target.type,
    query: String(query || '').trim()
  });
}

function sendGlobalSearchCommand(getMainWindow, query, scope = '') {
  return sendTelegramCommandToRenderer(getMainWindow, {
    type: 'global-search',
    query: String(query || '').trim(),
    scope: String(scope || '').trim()
  });
}

function getTelegramLogPathCandidates() {
  const override = String(process.env.TELEGRAM_BOT_LOG_PATH || '').trim();
  if (override) {
    return [override];
  }

  const candidates = [];
  if (!app.isPackaged) {
    candidates.push(path.join(__dirname, 'data', 'telegram-events.log'));
    candidates.push(path.join(process.cwd(), 'data', 'telegram-events.log'));
  } else {
    candidates.push(path.join(process.cwd(), 'data', 'telegram-events.log'));
  }
  candidates.push(path.join(app.getPath('userData'), 'telegram-events.log'));

  return Array.from(new Set(candidates));
}

function detectMessageType(message) {
  if (!message) {
    return 'unknown';
  }
  if (typeof message.text === 'string') {
    return 'text';
  }
  if (typeof message.caption === 'string') {
    return 'caption';
  }

  const knownTypes = [
    'photo',
    'video',
    'document',
    'audio',
    'voice',
    'animation',
    'sticker',
    'location',
    'contact',
    'poll'
  ];
  for (const type of knownTypes) {
    if (message[type]) {
      return type;
    }
  }
  return 'other';
}

function formatTelegramLogEntry(ctx) {
  const message = ctx.message || null;
  const body = typeof message?.text === 'string'
    ? message.text
    : typeof message?.caption === 'string'
      ? message.caption
      : '';

  return JSON.stringify({
    timestamp: new Date().toISOString(),
    updateType: String(ctx.updateType || ''),
    messageType: detectMessageType(message),
    chatId: message?.chat?.id ?? ctx.chat?.id ?? null,
    chatType: message?.chat?.type ?? ctx.chat?.type ?? '',
    fromId: message?.from?.id ?? ctx.from?.id ?? null,
    fromUsername: message?.from?.username ?? ctx.from?.username ?? '',
    fromName: [message?.from?.first_name, message?.from?.last_name].filter(Boolean).join(' ').trim(),
    messageId: message?.message_id ?? null,
    body
  });
}

function createTelegramLogMetaEntry(type, extra = {}) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    type,
    ...extra
  });
}

async function appendTelegramLogEntry(logPath, entry) {
  if (!logPath) {
    return;
  }

  try {
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, `${entry}\n`, 'utf8');
  } catch (error) {
    console.error('Failed to append Telegram message log:', error);
  }
}

async function ensureTelegramLogFile(logPath) {
  try {
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, '', 'utf8');
    return true;
  } catch (error) {
    console.error('Failed to initialize Telegram message log file:', error);
    return false;
  }
}

async function resolveTelegramLogPath() {
  const candidates = getTelegramLogPathCandidates();
  for (const candidate of candidates) {
    const ok = await ensureTelegramLogFile(candidate);
    if (ok) {
      return candidate;
    }
  }
  return '';
}

function createStatusMessage(mainWindow) {
  if (!mainWindow) {
    return [
      'Enana app is running.',
      'Window: not available'
    ].join('\n');
  }

  return [
    'Enana app is running.',
    'Window: available',
    `Visible: ${mainWindow.isVisible() ? 'yes' : 'no'}`,
    `Minimized: ${mainWindow.isMinimized() ? 'yes' : 'no'}`,
    `Maximized: ${mainWindow.isMaximized() ? 'yes' : 'no'}`
  ].join('\n');
}

function isoNow() {
  return new Date().toISOString();
}

function isBlank(value) {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === 'string') {
    return !value.trim();
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return false;
}

function compactObject(objectValue) {
  const entries = Object.entries(objectValue || {}).filter(([, value]) => !isBlank(value));
  return Object.fromEntries(entries);
}

function firstRegexValue(text, patterns) {
  const source = String(text || '');
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match && match[1]) {
      return String(match[1]).trim();
    }
  }
  return '';
}

function uniqueValues(values) {
  const output = [];
  const seen = new Set();
  values.forEach((value) => {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    output.push(normalized);
  });
  return output;
}

function parseLinkedRecords(text) {
  const source = String(text || '');
  const matches = source.match(/\b(?:SMP|ASY|GEL|NB|EXP|RUN|PRJ)-[A-Za-z0-9-]+\b/gi) || [];
  return uniqueValues(matches);
}

function parseProjectFromText(text, fallback = '') {
  const explicit = firstRegexValue(text, [
    /\bproject\s*[:\-]?\s*([A-Za-z0-9._-]{2,})\b/i,
    /\bfor\s+project\s+([A-Za-z0-9._-]{2,})\b/i
  ]);
  if (explicit) {
    return explicit;
  }
  const shorthand = firstRegexValue(text, [
    /\b(PD\d{1,4}[A-Za-z0-9-]*)\b/,
    /\b(EGFR|HER2|PDL1|PD1)\b/i
  ]);
  if (shorthand) {
    return shorthand;
  }
  const fallbackText = String(fallback || '').trim();
  return fallbackText || null;
}

function parseProtocolFromText(text, fallback = '') {
  const protocol = firstRegexValue(text, [
    /\bprotocol\s*[:\-]?\s*([A-Za-z0-9 _./-]{2,80})/i,
    /\bstart\s+([A-Za-z0-9 _./-]{2,80})\s+protocol\b/i
  ]).replace(/[.?!]+$/, '').trim();
  if (protocol) {
    return protocol;
  }
  const fallbackText = String(fallback || '').trim();
  return fallbackText || null;
}

function parseDurationToMs(value) {
  const base = String(value || '').trim().toLowerCase();
  if (!base) {
    return 0;
  }

  const text = base.replace(/([a-z])(?=\d)/g, '$1 ');
  const unitRegex = /(\d+(?:\.\d+)?)\s*(days?|d|hours?|hrs?|hr|h|minutes?|mins?|min|m|seconds?|secs?|sec|s)\b/g;
  let totalMs = 0;
  let matched = false;
  let match;
  while ((match = unitRegex.exec(text))) {
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) {
      continue;
    }
    const unit = match[2];
    let unitMs = 0;
    if (/^d/.test(unit)) {
      unitMs = 24 * 60 * 60 * 1000;
    } else if (/^h/.test(unit)) {
      unitMs = 60 * 60 * 1000;
    } else if (/^m/.test(unit)) {
      unitMs = 60 * 1000;
    } else if (/^s/.test(unit)) {
      unitMs = 1000;
    }
    totalMs += amount * unitMs;
    matched = true;
  }

  if (matched) {
    return Math.round(totalMs);
  }

  if (/^\d+(?:\.\d+)?$/.test(text)) {
    return Math.round(Number(text) * 60 * 1000);
  }

  return 0;
}

function splitDurationAndLabel(value) {
  const text = String(value || '').trim();
  if (!text) {
    return {
      durationText: '',
      label: '',
      durationMs: 0
    };
  }

  const tokens = text.split(/\s+/).filter(Boolean);
  let best = null;
  for (let i = 1; i <= tokens.length; i += 1) {
    const durationText = tokens.slice(0, i).join(' ');
    const durationMs = parseDurationToMs(durationText);
    if (!durationMs) {
      continue;
    }
    best = {
      durationText,
      label: tokens.slice(i).join(' ').trim(),
      durationMs
    };
  }

  if (best) {
    return best;
  }

  return {
    durationText: text,
    label: '',
    durationMs: parseDurationToMs(text)
  };
}

function parseTimerRequest(text) {
  const source = String(text || '').trim();
  if (!source) {
    return null;
  }

  const match = source.match(/^(?:set|start)?\s*timer\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const parsed = splitDurationAndLabel(match[1]);
  return {
    duration: parsed.durationText,
    duration_ms: parsed.durationMs,
    label: parsed.label || 'Lab reminder'
  };
}

function formatDuration(durationMs) {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const chunks = [];
  if (days) {
    chunks.push(`${days}d`);
  }
  if (hours) {
    chunks.push(`${hours}h`);
  }
  if (minutes) {
    chunks.push(`${minutes}m`);
  }
  if (!chunks.length || (!days && !hours && seconds)) {
    chunks.push(`${seconds}s`);
  }
  return chunks.join(' ');
}

function parseNumericValue(text, patterns) {
  const raw = firstRegexValue(text, patterns);
  if (!raw) {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function parseTemperatureC(text) {
  return parseNumericValue(text, [
    /\b(?:at|temp(?:erature)?\s*)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:°?\s*c)\b/i,
    /\b([0-9]+(?:\.[0-9]+)?)\s*(?:°?\s*c)\b/i
  ]);
}

function parseReagentAmountItems(text) {
  const source = String(text || '');
  const items = [];
  const quantitative = /(\d+(?:\.\d+)?)\s*(uL|ul|µL|mL|L|g|mg|ug|µg|kg|box(?:es)?|bottle(?:s)?|vial(?:s)?|tube(?:s)?|tips?)\s+([A-Za-z0-9][A-Za-z0-9\s._/-]{0,50}?)(?=\s+(?:and|for|with|into|to)\b|$)/gi;
  let match;
  while ((match = quantitative.exec(source))) {
    items.push({
      name: String(match[3] || '').trim(),
      amount: String(match[1] || '').trim(),
      unit: String(match[2] || '').trim()
    });
  }

  if (!items.length) {
    const simple = source.match(/\b(?:used|finished|consumed)\s+(one|two|three|\d+(?:\.\d+)?)\s+(box|bottle|vial|tube)\s+of\s+([A-Za-z0-9][A-Za-z0-9\s._/-]+)/i);
    if (simple) {
      items.push({
        name: String(simple[3] || '').trim(),
        amount: String(simple[1] || '').trim(),
        unit: String(simple[2] || '').trim()
      });
    }
  }

  return items;
}

function parseProteinExpressionEvent(text, context = {}) {
  const source = String(text || '');
  const targetProtein = firstRegexValue(source, [
    /\bexpress(?:ed|ing)?\s+([A-Za-z0-9._/-]+)\b/i,
    /\bexpression\s+of\s+([A-Za-z0-9._/-]+)\b/i,
    /\binduced\s+([A-Za-z0-9._/-]+)\s+culture\b/i
  ]);
  const construct = firstRegexValue(source, [
    /\bconstruct\s+([A-Za-z0-9._/-]+)\b/i,
    /\bplasmid\s+([A-Za-z0-9._/-]+)\b/i
  ]);
  const hostStrain = firstRegexValue(source, [
    /\b(?:in|into)\s+([A-Za-z0-9()_-]+)\b/i,
    /\bhost\s*[:\-]?\s*([A-Za-z0-9()_-]+)\b/i,
    /\b(BL21(?:\(DE3\))?|DH5alpha|Top10|Rosetta)\b/i
  ]);
  const cultureId = firstRegexValue(source, [
    /\bculture\s*[:\-]?\s*([A-Za-z0-9._/-]+)\b/i,
    /\bbatch\s*[:\-]?\s*([A-Za-z0-9._/-]+)\b/i
  ]);
  const inductionOd = parseNumericValue(source, [
    /\bOD(?:600)?\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)\b/i
  ]);
  const inducerConcentration = firstRegexValue(source, [
    /\bIPTG\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?\s*(?:mM|uM|µM))\b/i,
    /\b([0-9]+(?:\.[0-9]+)?\s*(?:mM|uM|µM))\s*IPTG\b/i
  ]) || null;
  const temperatureC = parseTemperatureC(source);
  const harvestTime = firstRegexValue(source, [
    /\bharvest\s*(?:at|on)?\s*([A-Za-z0-9: -]{2,40})\b/i
  ]) || null;

  const fields = {
    target_protein: targetProtein || null,
    construct: construct || null,
    host_strain: hostStrain || null,
    culture_id: cultureId || null,
    induction_od600: inductionOd,
    inducer: 'IPTG',
    inducer_concentration: inducerConcentration,
    temperature_c: temperatureC,
    start_time: null,
    harvest_time: harvestTime,
    project: parseProjectFromText(source, context.active_project || context.default_project),
    protocol: parseProtocolFromText(source, context.active_protocol)
  };

  const missingFields = [];
  if (fields.induction_od600 === null) {
    missingFields.push('induction_od600');
  }
  if (!fields.inducer_concentration) {
    missingFields.push('inducer_concentration');
  }
  if (fields.temperature_c === null) {
    missingFields.push('temperature_c');
  }

  return {
    event_type: 'protein_expression',
    fields,
    missing_fields: missingFields
  };
}

function parseTransformationEvent(text, context = {}) {
  const source = String(text || '');
  const construct = firstRegexValue(source, [
    /\btransform(?:ed|ation)?\s+([A-Za-z0-9._/-]+)\s+(?:into|in)\b/i,
    /\btransform(?:ed|ation)?\s+([A-Za-z0-9._/-]+)\b/i,
    /\bplasmid\s+([A-Za-z0-9._/-]+)\b/i
  ]);
  const hostStrain = firstRegexValue(source, [
    /\binto\s+([A-Za-z0-9()_-]+)\b/i,
    /\bhost\s*[:\-]?\s*([A-Za-z0-9()_-]+)\b/i
  ]);
  const method = firstRegexValue(source, [
    /\b(heat[-\s]?shock|electroporation|chemical transformation)\b/i
  ]) || null;
  const selectionMarker = firstRegexValue(source, [
    /\b(kanamycin|ampicillin|chloramphenicol|zeocin|hygromycin)\b/i
  ]) || null;
  const plateType = firstRegexValue(source, [
    /\b(LB agar|SOC|agar plate|selective plate|plate)\b/i
  ]) || null;

  return {
    event_type: 'transformation',
    fields: {
      construct: construct || null,
      host_strain: hostStrain || null,
      method,
      selection_marker: selectionMarker,
      plate_type: plateType,
      project: parseProjectFromText(source, context.active_project || context.default_project)
    }
  };
}

function parseTransfectionEvent(text, context = {}) {
  const source = String(text || '');
  const cellLine = firstRegexValue(source, [
    /\btransfect(?:ed|ion)?\s+([A-Za-z0-9._/-]+)\b/i,
    /\b(HEK293T|HEK293F|CHO(?:-K1)?|A549|HepG2)\b/i
  ]);
  const construct = firstRegexValue(source, [
    /\bwith\s+([A-Za-z0-9._/-]+)\s+(?:plasmid|construct)?\b/i,
    /\bfor\s+([A-Za-z0-9._/-]+)\s+construct\b/i
  ]);
  const transfectionReagent = firstRegexValue(source, [
    /\b(PEI|Lipofectamine\s*\d*|Fugene|jetPRIME)\b/i
  ]) || null;
  const plateFormat = firstRegexValue(source, [
    /\b(\d+\s*-?\s*well)\b/i
  ]) || null;
  const dnaAmount = firstRegexValue(source, [
    /\b([0-9]+(?:\.[0-9]+)?\s*(?:ng|ug|µg|mg))\b/i
  ]) || null;
  const ratio = firstRegexValue(source, [
    /\bratio\s*[:=]?\s*([0-9:.]+)\b/i
  ]) || null;
  const cultureScale = firstRegexValue(source, [
    /\b([0-9]+(?:\.[0-9]+)?\s*(?:mL|L))\b/i
  ]) || null;

  return {
    event_type: 'transfection',
    fields: {
      cell_line: cellLine || null,
      construct: construct || null,
      transfection_reagent: transfectionReagent,
      plate_format: plateFormat,
      dna_amount: dnaAmount,
      ratio,
      culture_scale: cultureScale,
      project: parseProjectFromText(source, context.active_project || context.default_project)
    }
  };
}

function parseCellCultureEvent(text, context = {}) {
  const source = String(text || '');
  let action = 'culture';
  if (/\bseed(?:ed|ing)?\b/i.test(source)) {
    action = 'seed';
  } else if (/\bpassag(?:e|ed|ing)\b/i.test(source)) {
    action = 'passage';
  } else if (/\bmedia\s+change|changed\s+media\b/i.test(source)) {
    action = 'media_change';
  }

  const cellLine = firstRegexValue(source, [
    /\b(?:seed(?:ed|ing)?|passag(?:e|ed|ing)?|transfect(?:ed|ion)?)\s+([A-Za-z0-9._/-]+)\b/i,
    /\b(HEK293T|HEK293F|CHO(?:-K1)?|A549|HepG2)\b/i
  ]);

  return {
    event_type: 'cell_culture',
    fields: {
      action,
      cell_line: cellLine || null,
      split_ratio: firstRegexValue(source, [/\b(\d+\s*:\s*\d+)\b/i]) || null,
      confluency: parseNumericValue(source, [/\b([0-9]{1,3})\s*%\s*conflu(?:ent|ency)?\b/i]),
      vessel: firstRegexValue(source, [/\b(T\d+|flask|dish|plate|well|bioreactor)\b/i]) || null,
      media: firstRegexValue(source, [/\b(DMEM|RPMI|FBS[^,.;]*|LB|media[^,.;]*)\b/i]) || null,
      project: parseProjectFromText(source, context.active_project || context.default_project)
    }
  };
}

function detectPurificationMethod(text) {
  const source = String(text || '');
  if (/\bni[-\s]?nta\b/i.test(source)) {
    return 'Ni-NTA';
  }
  if (/\bsec\b|size\s+exclusion/i.test(source)) {
    return 'SEC';
  }
  if (/\biex\b|ion\s+exchange/i.test(source)) {
    return 'IEX';
  }
  if (/\baffinity/i.test(source)) {
    return 'Affinity';
  }
  return null;
}

function parsePurificationEvent(text, context = {}) {
  const source = String(text || '');

  return {
    event_type: 'purification',
    fields: {
      target: firstRegexValue(source, [
        /\bpurif(?:y|ied|ication)\s+([A-Za-z0-9._/-]+)\b/i,
        /\bfor\s+([A-Za-z0-9._/-]+)\s+protein\b/i
      ]) || null,
      sample_input: firstRegexValue(source, [
        /\bsample\s+([A-Za-z0-9._/-]+)\b/i
      ]) || null,
      purification_method: detectPurificationMethod(source),
      start_time: null,
      fractions: firstRegexValue(source, [
        /\bfractions?\s+([0-9]+\s*(?:to|-|-)\s*[0-9]+|[0-9]+)\b/i
      ]) || null,
      buffers: uniqueValues((source.match(/\b(?:binding|wash|elution|lysis)\s+buffer\b/gi) || []).map((item) => item.toLowerCase())),
      linked_gel: firstRegexValue(source, [
        /\b(GEL-[A-Za-z0-9-]+)\b/i,
        /\bgel\s+([A-Za-z0-9._/-]+)\b/i
      ]) || null,
      project: parseProjectFromText(source, context.active_project || context.default_project)
    }
  };
}

function parseAssayEvent(text, context = {}) {
  const source = String(text || '');
  let assayType = firstRegexValue(source, [
    /\b(ELISA|BLI|SPR|qPCR|flow cytometry|western blot|cell viability)\b/i
  ]);
  if (!assayType) {
    assayType = /\bassay\b/i.test(source) ? 'Assay' : null;
  }

  const controls = [];
  const controlMatch = source.match(/\bcontrols?\s*[:\-]?\s*([^.;\n]+)/i);
  if (controlMatch) {
    controlMatch[1]
      .split(/[,/]| and /i)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => controls.push(item));
  }

  return {
    event_type: 'assay',
    fields: {
      assay_type: assayType,
      assay_id: firstRegexValue(source, [/\b(ASY-[A-Za-z0-9-]+)\b/i]) || null,
      sample_set: firstRegexValue(source, [
        /\bon\s+([A-Za-z0-9 _./-]{2,80})$/i,
        /\bfor\s+([A-Za-z0-9 _./-]{2,80})$/i
      ]) || null,
      readout: firstRegexValue(source, [
        /\b(OD\d+|fluorescence|luminescence|absorbance|Ct)\b/i
      ]) || null,
      controls: uniqueValues(controls),
      project: parseProjectFromText(source, context.active_project || context.default_project)
    }
  };
}

function parseGelEvent(text, context = {}) {
  const source = String(text || '');
  let gelType = null;
  if (/\bsds[-\s]?page\b/i.test(source)) {
    gelType = 'SDS-PAGE';
  } else if (/\bwestern\b/i.test(source)) {
    gelType = 'western';
  } else if (/\bagarose\b/i.test(source)) {
    gelType = 'agarose';
  }

  return {
    event_type: 'gel',
    fields: {
      gel_type: gelType,
      sample_set: firstRegexValue(source, [
        /\bfor\s+([A-Za-z0-9 _./-]{2,80})\b/i
      ]) || null,
      ladder: firstRegexValue(source, [
        /\bladder\s*[:\-]?\s*([A-Za-z0-9._/-]+)\b/i
      ]) || null,
      expected_band_kda: parseNumericValue(source, [
        /\b([0-9]+(?:\.[0-9]+)?)\s*kda\b/i
      ]),
      project: parseProjectFromText(source, context.active_project || context.default_project)
    }
  };
}

function parseReagentUseEvent(text, context = {}) {
  const source = String(text || '');
  const items = parseReagentAmountItems(source);

  return {
    event_type: 'inventory_usage',
    fields: {
      items,
      project: parseProjectFromText(source, context.active_project || context.default_project),
      linked_run: firstRegexValue(source, [/\b(RUN-[A-Za-z0-9-]+)\b/i]) || context.active_run_id || null
    }
  };
}

function parseDecisionEvent(text, context = {}) {
  const source = String(text || '');

  return {
    event_type: 'decision',
    fields: {
      decision_text: source,
      project: parseProjectFromText(source, context.active_project || context.default_project),
      reason: firstRegexValue(source, [/\bdue\s+to\s+(.+)$/i]) || null,
      evidence_refs: parseLinkedRecords(source)
    }
  };
}

function parseTaskEvent(text, context = {}) {
  const source = String(text || '');
  return {
    event_type: 'task',
    fields: {
      task_text: source,
      project: parseProjectFromText(source, context.active_project || context.default_project),
      linked_records: parseLinkedRecords(source)
    }
  };
}

function parseSampleRegistrationEvent(text, context = {}) {
  const source = String(text || '');
  const sampleId = firstRegexValue(source, [/\b([A-Z]{2,5}-\d{2,})\b/]);
  const location = firstRegexValue(source, [/\b(?:at|in|location\s*[:\-]?)\s+([A-Za-z0-9 _./-]{2,80})$/i]);

  return {
    event_type: 'sample_registration',
    fields: {
      sample_id: sampleId || null,
      sample_name: firstRegexValue(source, [/\bname\s*[:\-]?\s*([A-Za-z0-9 _./-]{2,80})/i]) || null,
      sample_type: firstRegexValue(source, [/\b(?:type|kind)\s*[:\-]?\s*([A-Za-z0-9 _./-]{2,80})/i]) || null,
      location: location || null,
      project: parseProjectFromText(source, context.active_project || context.default_project)
    }
  };
}

function parseReagentRegistrationEvent(text, context = {}) {
  const source = String(text || '');
  return {
    event_type: 'reagent_registration',
    fields: {
      reagent_name: firstRegexValue(source, [/\bname\s*[:\-]?\s*([A-Za-z0-9 _./-]{2,80})/i]) || source,
      lot_number: firstRegexValue(source, [/\blot\s*[:\-]?\s*([A-Za-z0-9._/-]+)\b/i]) || null,
      amount: firstRegexValue(source, [/\b(\d+(?:\.\d+)?)\b/]) || null,
      unit: firstRegexValue(source, [/\b(?:\d+(?:\.\d+)?)\s*(uL|ul|µL|mL|L|g|mg|ug|µg|kg|bottle|vial|box)\b/i]) || null,
      location: firstRegexValue(source, [/\b(?:at|in|location\s*[:\-]?)\s+([A-Za-z0-9 _./-]{2,80})$/i]) || null,
      project: parseProjectFromText(source, context.active_project || context.default_project)
    }
  };
}

function parseChecklistEvent(text, context = {}) {
  const source = String(text || '');
  return {
    event_type: 'checklist',
    fields: {
      title: source,
      project: parseProjectFromText(source, context.active_project || context.default_project),
      protocol: parseProtocolFromText(source, context.active_protocol)
    }
  };
}

function parseReservationEvent(text, context = {}) {
  const source = String(text || '');
  return {
    event_type: 'reservation_request',
    fields: {
      title: source,
      instrument: firstRegexValue(source, [/\bfor\s+([A-Za-z0-9 _./-]{2,80})\b/i]) || null,
      start_time: firstRegexValue(source, [/\b(?:at|on)\s+([A-Za-z0-9: -]{2,80})\b/i]) || null,
      project: parseProjectFromText(source, context.active_project || context.default_project)
    }
  };
}

function parseObservationEvent(text, context = {}) {
  const source = String(text || '');
  return {
    event_type: 'observation',
    fields: {
      observation: source,
      project: parseProjectFromText(source, context.active_project || context.default_project),
      linked_records: parseLinkedRecords(source)
    }
  };
}

function detectLabEventType(text) {
  const lower = String(text || '').toLowerCase();
  if (!lower) {
    return 'observation';
  }
  if (/\btransfect/.test(lower)) {
    return 'transfection';
  }
  if (/\btransform|heat[- ]?shock|electroporat/.test(lower)) {
    return 'transformation';
  }
  if (/\bexpress|induc(ed|tion)?\b/.test(lower)) {
    return 'protein_expression';
  }
  if (/\bpurif|ni[- ]?nta|sec\b|fractions?\b/.test(lower)) {
    return 'purification';
  }
  if (/\belisa|assay|bli\b|spr\b|qpcr\b/.test(lower)) {
    return 'assay';
  }
  if (/\bsds[- ]?page|gel|western|agarose/.test(lower)) {
    return 'gel';
  }
  if (/\bpassag|seed(ed|ing)?|media\s+change|confluen/.test(lower)) {
    return 'cell_culture';
  }
  if (/\bused\b|finished\b|consum(ed|e)\b|tips\b/.test(lower)) {
    return 'inventory_usage';
  }
  if (/\bdecid(ed|e)\b|repeat\b|drop\b|scale[- ]?up\b/.test(lower)) {
    return 'decision';
  }
  if (/\btask\b|todo\b|to do\b/.test(lower)) {
    return 'task';
  }
  return 'observation';
}

function parseLabEventByType(eventType, text, context = {}) {
  switch (eventType) {
    case 'protein_expression':
      return parseProteinExpressionEvent(text, context);
    case 'transformation':
      return parseTransformationEvent(text, context);
    case 'transfection':
      return parseTransfectionEvent(text, context);
    case 'cell_culture':
      return parseCellCultureEvent(text, context);
    case 'purification':
      return parsePurificationEvent(text, context);
    case 'assay':
      return parseAssayEvent(text, context);
    case 'gel':
      return parseGelEvent(text, context);
    case 'inventory_usage':
      return parseReagentUseEvent(text, context);
    case 'decision':
      return parseDecisionEvent(text, context);
    case 'task':
      return parseTaskEvent(text, context);
    case 'sample_registration':
      return parseSampleRegistrationEvent(text, context);
    case 'reagent_registration':
      return parseReagentRegistrationEvent(text, context);
    case 'checklist':
      return parseChecklistEvent(text, context);
    case 'reservation_request':
      return parseReservationEvent(text, context);
    case 'daily_summary':
      return {
        event_type: 'daily_summary',
        fields: {
          summary: String(text || '').trim(),
          project: parseProjectFromText(text, context.active_project || context.default_project)
        },
        missing_fields: []
      };
    default:
      return parseObservationEvent(text, context);
  }
}

function parseLabEvent(text, eventTypeHint = '', context = {}) {
  const eventType = eventTypeHint || detectLabEventType(text);
  return parseLabEventByType(eventType, text, context);
}

function eventTypeToIntentSubintent(eventType) {
  switch (eventType) {
    case 'protein_expression':
      return 'protein_expression';
    case 'transformation':
      return 'transformation';
    case 'transfection':
      return 'transfection';
    case 'cell_culture':
      return 'cell_seeding';
    case 'purification':
      return 'purification';
    case 'assay':
      return 'assay_run';
    case 'gel':
      return 'gel_run';
    case 'inventory_usage':
      return 'reagent_prep';
    case 'decision':
      return 'decision_record';
    default:
      return 'observation';
  }
}

function parseLookupSubintent(text) {
  const lower = String(text || '').toLowerCase();
  if (!lower) {
    return '';
  }
  if (/\bexpir|expiry|expire\b/.test(lower)) {
    return 'expiry';
  }
  if (/\blot\b/.test(lower)) {
    return 'lot';
  }
  if (/\bconstruct\b/.test(lower)) {
    return 'construct';
  }
  if (/\bsample\b|\bsmp-/.test(lower)) {
    return 'sample';
  }
  if (/\bprotocol\b/.test(lower)) {
    return 'protocol';
  }
  if (/\bproject\b/.test(lower)) {
    return 'project';
  }
  if (/\binstrument\b|\bbooked\b|\bfplc\b/.test(lower)) {
    return 'instrument';
  }
  if (/\bpaper\b|\blibrary\b|\bjournal\b/.test(lower)) {
    return 'paper';
  }
  if (/\bwhere\s+is\b|\blocation\b/.test(lower)) {
    return 'location';
  }
  if (/\bdo\s+we\s+have\b|\bavailable\b|\binventory\b|\blow\s+stock\b/.test(lower)) {
    return 'inventory';
  }
  return '';
}

function extractLookupQuery(text, subintent = '') {
  let query = String(text || '').trim();
  query = query
    .replace(/^(do\s+we\s+have|where\s+is|find|show|lookup|look\s+up|what(?:'s|\s+is)\s+booked\s+(?:on|for)|any)\s+/i, '')
    .replace(/^(inventory|sample|samples|construct|constructs|protocol|project|instrument|paper|papers|lots?|expiry|expiring)\s+/i, '')
    .replace(/[?.!]+$/g, '')
    .trim();

  if (!query && subintent === 'expiry') {
    return 'expiring';
  }
  if (!query && subintent === 'inventory') {
    return '';
  }
  return query;
}

function parseNaturalLanguageIntent(text, context = {}) {
  const source = String(text || '').trim();
  const lower = source.toLowerCase();

  const result = {
    intent: '',
    subintent: '',
    entities: {},
    time_context: {},
    linked_records: parseLinkedRecords(source),
    confidence: 0.2,
    requires_confirmation: false,
    draft_action: null
  };

  if (!source) {
    return result;
  }

  const timerIntent = parseTimerRequest(source);
  if (timerIntent) {
    result.intent = 'reminder';
    result.subintent = 'timer';
    result.entities = {
      duration: timerIntent.duration,
      label: timerIntent.label
    };
    result.time_context = {
      duration_ms: timerIntent.duration_ms
    };
    result.confidence = timerIntent.duration_ms ? 0.96 : 0.8;
    result.requires_confirmation = !timerIntent.duration_ms;
    return result;
  }

  const executionMap = [
    ['start', /^(?:start|begin)\s+.+(?:protocol|workflow)/i],
    ['next', /^(?:next)\b/i],
    ['done', /^(?:done|complete(?:d)?)\b/i],
    ['repeat', /^(?:repeat|again)\b/i],
    ['pause', /^(?:pause|hold)\b/i],
    ['resume', /^(?:resume|continue)\b/i],
    ['add_note', /^(?:note|log note)\b/i],
    ['add_deviation', /\bdeviation\b/i]
  ];

  for (const [subintent, pattern] of executionMap) {
    if (pattern.test(source)) {
      result.intent = 'protocol_execution';
      result.subintent = subintent;
      result.entities = {
        protocol_name: parseProtocolFromText(source, context.active_protocol)
      };
      result.confidence = 0.92;
      result.requires_confirmation = false;
      return result;
    }
  }

  const lookupSubintent = parseLookupSubintent(source);
  if (lookupSubintent && (/\?|\bdo\s+we\s+have\b|\bwhere\s+is\b|\bshow\b|\bfind\b|\bexpir|\bbooked\b|\blow\s+stock\b/.test(lower) || ['protocol', 'project', 'instrument', 'paper'].includes(lookupSubintent))) {
    result.intent = 'lookup';
    result.subintent = lookupSubintent;
    result.entities = {
      query: extractLookupQuery(source, lookupSubintent)
    };
    result.confidence = 0.88;
    return result;
  }

  if (/\bdraft\b|\bsummarize\b|\bsummary\b|\bchecklist\b|\bassay\s+plan\b|\breservation\b/.test(lower)) {
    result.intent = 'draft_record';
    if (/\bdecision\b/.test(lower)) {
      result.subintent = 'decision_record';
    } else if (/\bchecklist\b/.test(lower)) {
      result.subintent = 'reagent_checklist';
    } else if (/\bassay\s+plan\b|\bdraft\s+assay\b/.test(lower)) {
      result.subintent = 'assay_plan';
    } else if (/\breservation\b/.test(lower)) {
      result.subintent = 'reservation_request';
    } else if (/\bsummarize\b|\bsummary\b/.test(lower)) {
      result.subintent = 'daily_summary';
    } else {
      result.subintent = 'notebook_entry';
    }
    result.entities = {
      message_text: source,
      project: parseProjectFromText(source, context.active_project || context.default_project)
    };
    result.confidence = 0.84;
    result.requires_confirmation = true;
    result.draft_action = 'create';
    return result;
  }

  if (/\b(decide|decided|decision|drop\s+construct|scale[- ]?up|repeat\s+purification)\b/.test(lower)) {
    result.intent = 'draft_record';
    result.subintent = 'decision_record';
    result.entities = {
      decision_text: source,
      project: parseProjectFromText(source, context.active_project || context.default_project)
    };
    result.confidence = 0.9;
    result.requires_confirmation = true;
    result.draft_action = 'create';
    return result;
  }

  if (/\btask\b|\btodo\b|\bto do\b/.test(lower)) {
    result.intent = 'draft_record';
    result.subintent = 'task_list';
    result.entities = {
      task_text: source,
      project: parseProjectFromText(source, context.active_project || context.default_project)
    };
    result.confidence = 0.85;
    result.requires_confirmation = true;
    result.draft_action = 'create';
    return result;
  }

  const eventType = detectLabEventType(source);
  if (eventType !== 'observation') {
    result.intent = 'log_experiment';
    result.subintent = eventTypeToIntentSubintent(eventType);
    result.entities = {
      project: parseProjectFromText(source, context.active_project || context.default_project),
      protocol: parseProtocolFromText(source, context.active_protocol)
    };
    result.confidence = 0.82;
    result.requires_confirmation = true;
    result.draft_action = 'create';
    return result;
  }

  if (/^log\s+this\s*:/i.test(source) || /^note\s*:/i.test(source)) {
    result.intent = 'draft_record';
    result.subintent = 'notebook_entry';
    result.entities = {
      message_text: source.replace(/^\s*(log\s+this\s*:|note\s*:)/i, '').trim(),
      project: parseProjectFromText(source, context.active_project || context.default_project)
    };
    result.confidence = 0.79;
    result.requires_confirmation = true;
    result.draft_action = 'create';
    return result;
  }

  result.intent = 'chat';
  result.subintent = 'general';
  result.entities = {
    message_text: source
  };
  result.confidence = 0.35;
  return result;
}

function mapIntentToEventType(intent) {
  const fallback = detectLabEventType(intent?.entities?.message_text || '');
  if (!intent) {
    return fallback;
  }
  if (intent.intent === 'log_experiment') {
    const subintent = String(intent.subintent || '').toLowerCase();
    if (subintent === 'protein_expression') {
      return 'protein_expression';
    }
    if (subintent === 'transformation') {
      return 'transformation';
    }
    if (subintent === 'transfection') {
      return 'transfection';
    }
    if (subintent === 'cell_seeding' || subintent === 'passage') {
      return 'cell_culture';
    }
    if (subintent === 'purification') {
      return 'purification';
    }
    if (subintent === 'assay_run') {
      return 'assay';
    }
    if (subintent === 'gel_run') {
      return 'gel';
    }
    if (subintent === 'reagent_prep') {
      return 'inventory_usage';
    }
    return fallback;
  }
  if (intent.intent === 'draft_record') {
    const subintent = String(intent.subintent || '').toLowerCase();
    if (subintent === 'decision_record') {
      return 'decision';
    }
    if (subintent === 'task_list') {
      return 'task';
    }
    if (subintent === 'assay_plan') {
      return 'assay';
    }
    if (subintent === 'reagent_checklist') {
      return 'checklist';
    }
    if (subintent === 'daily_summary') {
      return 'daily_summary';
    }
    if (subintent === 'reservation_request') {
      return 'reservation_request';
    }
    return fallback;
  }
  return fallback;
}

function formatFieldLabel(key) {
  if (FIELD_LABEL_MAP.has(key)) {
    return FIELD_LABEL_MAP.get(key);
  }
  return String(key || '').replace(/_/g, ' ');
}

function formatFieldValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (Array.isArray(value)) {
    if (!value.length) {
      return '';
    }
    if (value.every((item) => typeof item === 'string')) {
      return value.join(', ');
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function buildDraftTitle(draft) {
  const fields = draft?.content?.fields || {};
  switch (draft?.content?.event_type) {
    case 'protein_expression': {
      const target = fields.target_protein || fields.construct || 'target';
      return `Protein expression of ${target}`;
    }
    case 'transformation':
      return `Transformation of ${fields.construct || 'construct'}`;
    case 'transfection':
      return `Transfection in ${fields.cell_line || 'cells'}`;
    case 'cell_culture':
      return `Cell culture update (${fields.action || 'culture'})`;
    case 'purification':
      return `Purification of ${fields.target || 'target'}`;
    case 'assay':
      return `Assay draft (${fields.assay_type || 'assay'})`;
    case 'gel':
      return `Gel run draft (${fields.gel_type || 'gel'})`;
    case 'inventory_usage':
      return 'Reagent usage draft';
    case 'decision':
      return 'Decision draft';
    case 'task':
      return 'Task draft';
    case 'sample_registration':
      return `Sample registration (${fields.sample_id || 'draft'})`;
    case 'reagent_registration':
      return 'Reagent registration draft';
    case 'checklist':
      return `Checklist draft (${fields.title || 'task'})`;
    case 'reservation_request':
      return 'Reservation request draft';
    case 'daily_summary':
      return 'Daily summary draft';
    default:
      return 'Lab draft record';
  }
}

function formatDetectedFields(fields) {
  const lines = [];
  Object.entries(fields || {}).forEach(([key, value]) => {
    const display = formatFieldValue(value);
    if (!display) {
      return;
    }
    lines.push(`- ${formatFieldLabel(key)}: ${display}`);
  });
  return lines;
}

function formatDraftReply(draft, options = {}) {
  const updated = Boolean(options.updated);
  const missing = Array.isArray(draft?.content?.missing_fields) ? draft.content.missing_fields : [];
  const fields = draft?.content?.fields || {};

  const lines = [];
  if (updated) {
    lines.push('Updated draft.');
  } else {
    lines.push(`I created a draft ${DRAFT_TYPE_LABELS.get(draft.draft_type) || 'record'}.`);
  }
  lines.push(`Draft ID: ${draft.draft_id}`);
  lines.push(`Title: ${buildDraftTitle(draft)}`);

  const detected = formatDetectedFields(fields);
  if (detected.length) {
    lines.push('Detected:');
    lines.push(...detected);
  }

  if (missing.length) {
    lines.push('Missing:');
    missing.forEach((field) => {
      lines.push(`- ${formatFieldLabel(field)}`);
    });
  }

  lines.push('Reply with:');
  lines.push('- "add ..." to refine this draft');
  lines.push('- "save draft"');
  lines.push('- "discard"');
  lines.push('- "open in Enana"');

  return lines.join('\n');
}

function formatProtocolStepReply(run, extra = '') {
  const index = Number(run.current_step_index || 0);
  const total = Array.isArray(run.steps) ? run.steps.length : 0;
  const stepText = run.steps[index] || 'No step text available.';
  const lines = [
    `Protocol: ${run.protocol_name}`,
    `Step ${index + 1} of ${total}`,
    stepText,
    '',
    'Reply:',
    '- "done"',
    '- "repeat"',
    '- "note ..."',
    '- "set timer 10 min"',
    '- "pause"'
  ];
  if (extra) {
    lines.unshift(extra);
  }
  return lines.join('\n');
}

function createDefaultChatContext() {
  return {
    active_project: '',
    default_project: '',
    active_protocol: '',
    active_run_id: '',
    active_draft_id: '',
    last_entities: {},
    notifications_enabled: true
  };
}

function buildTodaySummaryFromHistory(events) {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  const filtered = (events || []).filter((entry) => {
    const t = new Date(entry.timestamp || 0);
    return t.getFullYear() === y && t.getMonth() === m && t.getDate() === d;
  });

  if (!filtered.length) {
    return 'No logged events for today yet.';
  }

  const lines = [`I found ${filtered.length} logged events today:`];
  filtered.slice(-10).forEach((entry) => {
    lines.push(`- ${entry.label || entry.type || 'event'}`);
  });
  return lines.join('\n');
}

function formatSessionContextMessage(context, activeDraft, activeRun) {
  const lines = [
    'Current Telegram context:',
    `- active project: ${context.active_project || '(none)'}`,
    `- default project: ${context.default_project || '(none)'}`,
    `- active protocol: ${context.active_protocol || '(none)'}`,
    `- active run: ${activeRun ? activeRun.run_id : '(none)'}`,
    `- active draft: ${activeDraft ? activeDraft.draft_id : '(none)'}`,
    `- notifications: ${context.notifications_enabled ? 'on' : 'off'}`
  ];
  return lines.join('\n');
}

function startTelegramBot(getMainWindow, tokenOverride = '') {
  const token = String(tokenOverride || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) {
    console.log('Telegram bot disabled (no token configured)');
    return null;
  }

  const bot = new Telegraf(token);
  let telegramLogPath = '';

  const chatDefaultSearchScope = new Map();
  const chatContexts = new Map();
  const drafts = new Map();
  const protocolRuns = new Map();
  const reminders = new Map();
  const chatEventHistory = new Map();

  let draftCounter = 1;
  let runCounter = 1;
  let reminderCounter = 1;

  const MAX_HISTORY_PER_CHAT = 200;
  const MAX_TIMER_MS = 7 * 24 * 60 * 60 * 1000;

  const ensureLogPath = async () => {
    if (!telegramLogPath) {
      telegramLogPath = await resolveTelegramLogPath();
      if (telegramLogPath) {
        console.log(`Telegram message log: ${telegramLogPath}`);
        await appendTelegramLogEntry(
          telegramLogPath,
          createTelegramLogMetaEntry('bot-start', {
            pid: process.pid,
            cwd: process.cwd(),
            appPath: app.getAppPath(),
            isPackaged: app.isPackaged
          })
        );
      } else {
        console.error('Telegram message logging disabled: no writable log path found.');
      }
    }
    return telegramLogPath;
  };
  void ensureLogPath();

  bot.on('message', async (ctx, next) => {
    const logPath = await ensureLogPath();
    await appendTelegramLogEntry(logPath, formatTelegramLogEntry(ctx));
    return next();
  });

  const getChatScopeKey = (ctx) => String(ctx?.chat?.id || ctx?.from?.id || 'global');

  const getChatContext = (ctx) => {
    const key = getChatScopeKey(ctx);
    if (!chatContexts.has(key)) {
      chatContexts.set(key, createDefaultChatContext());
    }
    return chatContexts.get(key);
  };

  const getDefaultSearchTarget = (ctx) => {
    const scope = chatDefaultSearchScope.get(getChatScopeKey(ctx));
    return scope ? getSearchTarget(scope) : null;
  };

  const getActiveDraft = (ctx) => {
    const context = getChatContext(ctx);
    const draftId = context.active_draft_id;
    if (!draftId) {
      return null;
    }
    const draft = drafts.get(draftId) || null;
    if (!draft || draft.status !== 'active') {
      context.active_draft_id = '';
      return null;
    }
    return draft;
  };

  const getActiveRun = (ctx) => {
    const context = getChatContext(ctx);
    const runId = context.active_run_id;
    if (!runId) {
      return null;
    }
    const run = protocolRuns.get(runId) || null;
    if (!run || run.status === 'completed' || run.status === 'aborted') {
      context.active_run_id = '';
      return null;
    }
    return run;
  };

  const noWindowMessage = (ctx) => {
    ctx.reply('No active Enana window. Open the app window and try again.');
  };

  const recordChatEvent = (ctx, event) => {
    const key = getChatScopeKey(ctx);
    const history = chatEventHistory.get(key) || [];
    history.push({
      timestamp: isoNow(),
      ...event
    });
    if (history.length > MAX_HISTORY_PER_CHAT) {
      history.splice(0, history.length - MAX_HISTORY_PER_CHAT);
    }
    chatEventHistory.set(key, history);
  };

  const performLookupAction = (ctx, subintent, queryText = '') => {
    const action = LOOKUP_ACTIONS.get(subintent) || LOOKUP_ACTIONS.get('inventory');
    const query = String(queryText || '').trim();
    const moduleTarget = getModuleTarget(action.moduleToken);

    if (action.searchToken) {
      const searchTarget = getSearchTarget(action.searchToken);
      if (!searchTarget) {
        return {
          ok: false,
          message: `No search target configured for ${action.label}.`
        };
      }
      const sent = sendSearchCommand(getMainWindow, searchTarget, query);
      if (!sent) {
        return {
          ok: false,
          message: 'No active Enana window. Open the app window and try again.'
        };
      }
      return {
        ok: true,
        message: query
          ? `Opened ${searchTarget.label} and searched for: ${query}`
          : `Opened ${searchTarget.label}.`
      };
    }

    if (query) {
      const sent = sendGlobalSearchCommand(getMainWindow, query, action.globalScope || subintent);
      if (!sent) {
        return {
          ok: false,
          message: 'No active Enana window. Open the app window and try again.'
        };
      }
      return {
        ok: true,
        message: `Opened ${action.label} and searched for: ${query}`
      };
    }

    if (!moduleTarget) {
      return {
        ok: false,
        message: `No module target configured for ${action.label}.`
      };
    }

    const sent = sendTelegramCommandToRenderer(getMainWindow, {
      type: 'open-view',
      viewId: moduleTarget.viewId
    });
    if (!sent) {
      return {
        ok: false,
        message: 'No active Enana window. Open the app window and try again.'
      };
    }

    return {
      ok: true,
      message: `Opened ${moduleTarget.label}.`
    };
  };

  const resolveSearchScope = (scopeArg) => {
    const normalized = normalizeTokenKey(scopeArg);
    const direct = getSearchTarget(normalized);
    if (direct) {
      return {
        type: 'search-target',
        searchTarget: direct,
        scope: direct.scope,
        label: direct.label
      };
    }

    const lookupSubintent = SEARCH_SCOPE_TO_LOOKUP_SUBINTENT.get(normalized);
    if (lookupSubintent) {
      return {
        type: 'lookup-subintent',
        subintent: lookupSubintent
      };
    }

    return null;
  };

  const performSearchScope = (ctx, scopeArg, query) => {
    const resolved = resolveSearchScope(scopeArg);
    if (!resolved) {
      return {
        ok: false,
        message: `Unknown scope: ${scopeArg}.`
      };
    }

    if (resolved.type === 'search-target') {
      const sent = sendSearchCommand(getMainWindow, resolved.searchTarget, query);
      if (!sent) {
        return {
          ok: false,
          message: 'No active Enana window. Open the app window and try again.'
        };
      }
      return {
        ok: true,
        message: `Opened ${resolved.label} and searched for: ${query}`
      };
    }

    return performLookupAction(ctx, resolved.subintent, query);
  };

  const createDraft = (ctx, rawText, options = {}) => {
    const context = getChatContext(ctx);
    const intent = options.intent || parseNaturalLanguageIntent(rawText, context);
    const eventType = options.eventType || mapIntentToEventType(intent);
    const parsed = options.parsed || parseLabEvent(rawText, eventType, context);

    const draftType = options.draftType
      || EVENT_TO_DRAFT_TYPE.get(parsed.event_type)
      || EVENT_TO_DRAFT_TYPE.get(eventType)
      || 'notebook';

    const draftId = `DR-${String(draftCounter).padStart(5, '0')}`;
    draftCounter += 1;

    const now = isoNow();
    const project = parsed?.fields?.project || parseProjectFromText(rawText, context.active_project || context.default_project);
    const protocol = parsed?.fields?.protocol || parseProtocolFromText(rawText, context.active_protocol);

    const draft = {
      draft_id: draftId,
      user_id: String(ctx?.from?.id || ''),
      chat_id: String(ctx?.chat?.id || ''),
      draft_type: draftType,
      linked_project: project || '',
      linked_protocol: protocol || '',
      parsed_entities: compactObject({
        ...intent.entities,
        ...compactObject(parsed.fields)
      }),
      content: {
        event_type: parsed.event_type,
        fields: parsed.fields,
        missing_fields: Array.isArray(parsed.missing_fields) ? parsed.missing_fields : [],
        source_messages: [rawText]
      },
      status: 'active',
      created_at: now,
      updated_at: now
    };

    drafts.set(draftId, draft);
    context.active_draft_id = draftId;
    if (project) {
      context.active_project = project;
    }
    if (protocol) {
      context.active_protocol = protocol;
    }
    context.last_entities = {
      ...context.last_entities,
      ...draft.parsed_entities
    };

    recordChatEvent(ctx, {
      type: 'draft-created',
      label: `Draft ${draftId}: ${buildDraftTitle(draft)}`,
      draft_id: draftId
    });

    return draft;
  };

  const updateDraft = (ctx, message) => {
    const draft = getActiveDraft(ctx);
    if (!draft) {
      return null;
    }

    draft.content.source_messages.push(message);
    const combinedText = draft.content.source_messages.join(' ');
    const context = getChatContext(ctx);

    const parsed = parseLabEvent(combinedText, draft.content.event_type, context);
    draft.content.fields = parsed.fields;
    draft.content.missing_fields = Array.isArray(parsed.missing_fields) ? parsed.missing_fields : [];
    draft.parsed_entities = {
      ...draft.parsed_entities,
      ...compactObject(parsed.fields)
    };
    draft.updated_at = isoNow();

    if (parsed.fields?.project) {
      context.active_project = parsed.fields.project;
    }
    if (parsed.fields?.protocol) {
      context.active_protocol = parsed.fields.protocol;
    }
    context.last_entities = {
      ...context.last_entities,
      ...compactObject(parsed.fields)
    };

    recordChatEvent(ctx, {
      type: 'draft-updated',
      label: `Draft ${draft.draft_id} updated`,
      draft_id: draft.draft_id
    });

    return draft;
  };

  const saveActiveDraft = (ctx) => {
    const draft = getActiveDraft(ctx);
    if (!draft) {
      return null;
    }
    draft.status = 'saved';
    draft.updated_at = isoNow();
    const context = getChatContext(ctx);
    context.active_draft_id = '';

    recordChatEvent(ctx, {
      type: 'draft-saved',
      label: `Saved draft ${draft.draft_id}`,
      draft_id: draft.draft_id
    });

    return draft;
  };

  const discardActiveDraft = (ctx) => {
    const draft = getActiveDraft(ctx);
    if (!draft) {
      return null;
    }
    draft.status = 'discarded';
    draft.updated_at = isoNow();
    const context = getChatContext(ctx);
    context.active_draft_id = '';

    recordChatEvent(ctx, {
      type: 'draft-discarded',
      label: `Discarded draft ${draft.draft_id}`,
      draft_id: draft.draft_id
    });

    return draft;
  };

  const openDraftInEnana = (ctx, draft) => {
    if (!draft) {
      return false;
    }

    let moduleToken = 'biology';
    if (draft.draft_type === 'reagent_checklist' || draft.content.event_type === 'inventory_usage' || draft.content.event_type === 'reagent_registration') {
      moduleToken = 'chemicals';
    } else if (draft.content.event_type === 'sample_registration') {
      moduleToken = 'samples';
    } else if (draft.draft_type === 'reservation') {
      moduleToken = 'instruments';
    }

    const target = getModuleTarget(moduleToken);
    if (!target) {
      return false;
    }

    const sent = sendTelegramCommandToRenderer(getMainWindow, {
      type: 'open-view',
      viewId: target.viewId
    });

    if (sent) {
      recordChatEvent(ctx, {
        type: 'draft-opened',
        label: `Opened ${draft.draft_id} in Enana`,
        draft_id: draft.draft_id
      });
    }

    return sent;
  };

  const createProtocolRun = (ctx, protocolName) => {
    const context = getChatContext(ctx);
    const runId = `RUN-${String(runCounter).padStart(5, '0')}`;
    runCounter += 1;

    const run = {
      run_id: runId,
      protocol_name: protocolName,
      steps: [...DEFAULT_PROTOCOL_STEPS],
      current_step_index: 0,
      status: 'active',
      notes: [],
      deviations: [],
      project: context.active_project || context.default_project || null,
      created_at: isoNow(),
      updated_at: isoNow()
    };

    protocolRuns.set(runId, run);
    context.active_run_id = runId;
    context.active_protocol = protocolName;

    recordChatEvent(ctx, {
      type: 'protocol-run-started',
      label: `Started protocol run ${runId}: ${protocolName}`,
      run_id: runId
    });

    return run;
  };

  const handleExecutionSubintent = (ctx, subintent, payloadText = '') => {
    if (subintent === 'start') {
      const protocolName = String(payloadText || '').trim() || parseProtocolFromText(payloadText, getChatContext(ctx).active_protocol);
      if (!protocolName) {
        ctx.reply('Usage: /start-protocol <protocol name>');
        return true;
      }
      const run = createProtocolRun(ctx, protocolName);
      ctx.reply(formatProtocolStepReply(run, `Starting draft execution for protocol "${run.protocol_name}".`));
      return true;
    }

    const run = getActiveRun(ctx);
    if (!run) {
      ctx.reply('No active protocol run. Use /start-protocol <protocol> first.');
      return true;
    }

    if (subintent === 'pause') {
      run.status = 'paused';
      run.updated_at = isoNow();
      ctx.reply(`Paused protocol run ${run.run_id}. Reply "resume" to continue.`);
      return true;
    }

    if (subintent === 'resume') {
      run.status = 'active';
      run.updated_at = isoNow();
      ctx.reply(formatProtocolStepReply(run, `Resumed protocol run ${run.run_id}.`));
      return true;
    }

    if (subintent === 'repeat') {
      run.updated_at = isoNow();
      ctx.reply(formatProtocolStepReply(run, 'Repeating current step.'));
      return true;
    }

    if (subintent === 'add_note') {
      const note = String(payloadText || '').replace(/^note\s*/i, '').trim();
      if (!note) {
        ctx.reply('Usage: note <text>');
        return true;
      }
      run.notes.push({ text: note, at: isoNow() });
      run.updated_at = isoNow();
      ctx.reply(`Noted for run ${run.run_id}: ${note}`);
      return true;
    }

    if (subintent === 'add_deviation') {
      const deviation = String(payloadText || '').replace(/^deviation\s*/i, '').trim();
      if (!deviation) {
        ctx.reply('Usage: /deviation <text>');
        return true;
      }
      run.deviations.push({ text: deviation, at: isoNow() });
      run.updated_at = isoNow();
      ctx.reply(`Deviation logged for run ${run.run_id}: ${deviation}`);
      return true;
    }

    if (subintent === 'next' || subintent === 'done') {
      if (run.status === 'paused') {
        ctx.reply('Protocol is paused. Reply "resume" first.');
        return true;
      }

      if (run.current_step_index >= run.steps.length - 1) {
        run.status = 'completed';
        run.updated_at = isoNow();
        getChatContext(ctx).active_run_id = '';
        ctx.reply(`Protocol run ${run.run_id} completed.`);
        return true;
      }

      run.current_step_index += 1;
      run.updated_at = isoNow();
      const header = subintent === 'done'
        ? 'Marked step done. Moving to next step.'
        : 'Moved to next step.';
      ctx.reply(formatProtocolStepReply(run, header));
      return true;
    }

    return false;
  };

  const scheduleReminder = (ctx, durationMs, durationText, label) => {
    const ms = Number(durationMs);
    if (!Number.isFinite(ms) || ms <= 0) {
      return {
        ok: false,
        message: 'Could not parse timer duration. Example: /timer 45 min harvest culture'
      };
    }
    if (ms > MAX_TIMER_MS) {
      return {
        ok: false,
        message: 'Timer is too long for Telegram reminders in this version. Please keep timers under 7 days.'
      };
    }

    const reminderId = `RM-${String(reminderCounter).padStart(5, '0')}`;
    reminderCounter += 1;

    const chatId = ctx?.chat?.id;
    const chatKey = getChatScopeKey(ctx);
    const triggerAt = new Date(Date.now() + ms);

    const timer = setTimeout(() => {
      reminders.delete(reminderId);
      const context = chatContexts.get(chatKey) || createDefaultChatContext();
      if (!context.notifications_enabled) {
        return;
      }
      bot.telegram.sendMessage(chatId, `Timer completed (${label || 'Lab reminder'}).`).catch((error) => {
        console.error('Failed to deliver Telegram reminder:', error);
      });
    }, ms);

    reminders.set(reminderId, {
      reminder_id: reminderId,
      chat_id: String(chatId || ''),
      label: label || 'Lab reminder',
      trigger_at: triggerAt.toISOString(),
      status: 'scheduled',
      timer
    });

    recordChatEvent(ctx, {
      type: 'reminder-scheduled',
      label: `Reminder ${reminderId}: ${label || 'Lab reminder'} in ${formatDuration(ms)}`,
      reminder_id: reminderId
    });

    return {
      ok: true,
      reminder_id: reminderId,
      message: `Timer set for ${durationText || formatDuration(ms)} (${label || 'Lab reminder'}).`
    };
  };

  const createTodaySummaryDraft = (ctx) => {
    const key = getChatScopeKey(ctx);
    const history = chatEventHistory.get(key) || [];
    const summaryText = buildTodaySummaryFromHistory(history);

    const parsed = {
      event_type: 'daily_summary',
      fields: {
        summary: summaryText,
        event_count: history.length,
        events: history.slice(-10).map((item) => item.label || item.type || 'event'),
        project: getChatContext(ctx).active_project || getChatContext(ctx).default_project || null
      },
      missing_fields: []
    };

    return createDraft(ctx, summaryText, {
      intent: {
        intent: 'draft_record',
        subintent: 'daily_summary',
        entities: {
          message_text: summaryText
        }
      },
      eventType: 'daily_summary',
      parsed,
      draftType: 'notebook'
    });
  };

  const registerCommandAlias = (command, aliases, handler) => {
    bot.command(command, handler);
    aliases.forEach((alias) => {
      const escapedAlias = alias.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const pattern = new RegExp(`^\\/${escapedAlias}(?:@\\w+)?(?:\\s+([\\s\\S]*))?$`, 'i');
      bot.hears(pattern, (ctx) => {
        const argText = String(ctx.match?.[1] || '').trim();
        const original = ctx.message?.text;
        if (ctx.message) {
          ctx.message.text = `/${command}${argText ? ` ${argText}` : ''}`;
        }
        const result = handler(ctx);
        return Promise.resolve(result).finally(() => {
          if (ctx.message) {
            ctx.message.text = original;
          }
        });
      });
    });
  };

  bot.start((ctx) => {
    ctx.reply('Enana lab assistant bot connected. Use /help for commands.');
  });

  registerCommandAlias('help', [], (ctx) => {
    ctx.reply([
      'Available commands:',
      '/help - list commands',
      '/modules - list openable modules',
      '/open <module> - open module',
      '/open <module> <query> - open/search module in one command',
      '/search <scope> <query> - scoped search',
      '/scope <scope|none> - set/clear default search scope',
      '/q <query> - search using saved scope',
      '/inventory <query>',
      '/sample <query> | /samples <query>',
      '/construct <query>',
      '/protocol <query>',
      '/project <query>',
      '/instrument <query>',
      '/papers <query>',
      '/expiring | /lowstock | /today',
      '/log <message> | /note <message> | /decision <message> | /task <message>',
      '/use <message> | /register-sample <message> | /register-reagent <message>',
      '/start-protocol <name> | /next | /done | /repeat | /pause | /resume | /deviation <message>',
      '/timer <duration> <label>',
      '/draft-notebook | /draft-summary | /draft-checklist <topic> | /draft-assay <desc> | /draft-reservation <message>',
      '/link-project <project> | /set-default-project <project> | /my-context | /notifications [on|off]',
      '/status | /time | /version | /focus | /maximize | /restore | /minimize'
    ].join('\n'));
  });

  registerCommandAlias('modules', [], (ctx) => {
    const filterToken = normalizeTokenKey(getCommandArgs(ctx.message?.text));
    const modules = getModuleCatalog()
      .filter((entry) => !filterToken || entry.token.includes(filterToken) || normalizeTokenKey(entry.label).includes(filterToken))
      .map((entry) => entry.token);
    if (!modules.length) {
      ctx.reply(`No module matched "${filterToken}".`);
      return;
    }
    const prefix = filterToken ? `Openable modules matching "${filterToken}": ` : 'Openable modules: ';
    ctx.reply(`${prefix}${modules.join(', ')}`);
  });

  registerCommandAlias('open', [], (ctx) => {
    const rawArgs = getCommandArgs(ctx.message?.text);
    const { first: tokenArg, rest: trailingQuery } = splitFirstToken(rawArgs);
    if (!tokenArg) {
      ctx.reply('Usage: /open <module>. Try /modules.');
      return;
    }

    const target = getModuleTarget(tokenArg);
    if (!target) {
      const suggestions = getModuleSuggestions(tokenArg);
      const suggestionText = suggestions.length ? ` Did you mean: ${suggestions.join(', ')}?` : '';
      ctx.reply(`Unknown module: ${tokenArg}.${suggestionText} Try /modules.`);
      return;
    }

    if (trailingQuery) {
      const searchTarget = getSearchTarget(tokenArg);
      if (searchTarget) {
        const sent = sendSearchCommand(getMainWindow, searchTarget, trailingQuery);
        if (!sent) {
          noWindowMessage(ctx);
          return;
        }
        ctx.reply(`Opened ${searchTarget.label} and searched for: ${trailingQuery}`);
        return;
      }

      const sentGlobal = sendGlobalSearchCommand(getMainWindow, trailingQuery, normalizeTokenKey(tokenArg));
      if (!sentGlobal) {
        noWindowMessage(ctx);
        return;
      }
      ctx.reply(`Opened ${target.label} and searched for: ${trailingQuery}`);
      return;
    }

    const sent = sendTelegramCommandToRenderer(getMainWindow, {
      type: 'open-view',
      viewId: target.viewId
    });
    if (!sent) {
      noWindowMessage(ctx);
      return;
    }

    ctx.reply(`Opened ${target.label}.`);
  });

  registerCommandAlias('status', ['app'], (ctx) => {
    ctx.reply(createStatusMessage(getMainWindowSafe(getMainWindow)));
  });

  registerCommandAlias('ping', [], (ctx) => {
    ctx.reply('pong');
  });

  registerCommandAlias('time', [], (ctx) => {
    ctx.reply(`Server time: ${new Date().toLocaleString('en-US', { timeZoneName: 'short' })}`);
  });

  registerCommandAlias('version', [], (ctx) => {
    ctx.reply(`Enana version: ${app.getVersion()}`);
  });

  registerCommandAlias('logfile', [], (ctx) => {
    if (!telegramLogPath) {
      ctx.reply('Telegram log file is not ready yet.');
      return;
    }
    ctx.reply(`Telegram log file: ${telegramLogPath}`);
  });

  registerCommandAlias('focus', [], (ctx) => {
    const mainWindow = getMainWindowSafe(getMainWindow);
    if (!mainWindow) {
      ctx.reply('No active Enana window to focus.');
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
    ctx.reply('Enana window focused.');
  });

  registerCommandAlias('maximize', [], (ctx) => {
    const mainWindow = getMainWindowSafe(getMainWindow);
    if (!mainWindow) {
      ctx.reply('No active Enana window to maximize.');
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.maximize();
    mainWindow.show();
    mainWindow.focus();
    ctx.reply('Enana window maximized.');
  });

  registerCommandAlias('restore', [], (ctx) => {
    const mainWindow = getMainWindowSafe(getMainWindow);
    if (!mainWindow) {
      ctx.reply('No active Enana window to restore.');
      return;
    }

    if (mainWindow.isMinimized() || mainWindow.isMaximized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
    ctx.reply('Enana window restored.');
  });

  registerCommandAlias('minimize', [], (ctx) => {
    const mainWindow = getMainWindowSafe(getMainWindow);
    if (!mainWindow) {
      ctx.reply('No active Enana window to minimize.');
      return;
    }
    mainWindow.minimize();
    ctx.reply('Enana window minimized.');
  });

  registerCommandAlias('echo', [], (ctx) => {
    const text = getCommandArgs(ctx.message?.text);
    if (!text) {
      ctx.reply('Usage: /echo <text>');
      return;
    }
    ctx.reply(text);
  });

  registerCommandAlias('inventory', [], (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const result = performLookupAction(ctx, 'inventory', query);
    ctx.reply(result.message);
  });

  registerCommandAlias('chemicals', [], (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const result = performLookupAction(ctx, 'inventory', query);
    ctx.reply(result.message);
  });

  registerCommandAlias('sample', [], (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const result = performLookupAction(ctx, 'sample', query);
    ctx.reply(result.message);
  });

  registerCommandAlias('samples', [], (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const result = performLookupAction(ctx, 'sample', query);
    ctx.reply(result.message);
  });

  registerCommandAlias('construct', [], (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const result = performLookupAction(ctx, 'construct', query);
    ctx.reply(result.message);
  });

  registerCommandAlias('protocol', [], (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const result = performLookupAction(ctx, 'protocol', query);
    ctx.reply(result.message);
  });

  registerCommandAlias('project', [], (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const result = performLookupAction(ctx, 'project', query);
    ctx.reply(result.message);
  });

  registerCommandAlias('instrument', [], (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const result = performLookupAction(ctx, 'instrument', query);
    ctx.reply(result.message);
  });

  registerCommandAlias('papers', [], (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const result = performLookupAction(ctx, 'paper', query);
    ctx.reply(result.message);
  });

  registerCommandAlias('assay', ['assays'], (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const result = performSearchScope(ctx, 'assay', query);
    ctx.reply(result.message);
  });

  registerCommandAlias('gel', ['gels'], (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const result = performSearchScope(ctx, 'gel', query);
    ctx.reply(result.message);
  });

  registerCommandAlias('search', [], (ctx) => {
    const { first: scopeArg, rest: query } = splitFirstToken(getCommandArgs(ctx.message?.text));
    if (!scopeArg || !query) {
      ctx.reply('Usage: /search <scope> <query>. Scopes: chemicals, samples, assay, gel, protocol, project, instrument, papers');
      return;
    }
    const result = performSearchScope(ctx, scopeArg, query);
    ctx.reply(result.message);
  });

  registerCommandAlias('scope', [], (ctx) => {
    const scopeArg = normalizeTokenKey(getCommandArgs(ctx.message?.text));
    const chatKey = getChatScopeKey(ctx);
    if (!scopeArg) {
      const current = getDefaultSearchTarget(ctx);
      ctx.reply(current
        ? `Default search scope is "${current.scope}". Use /q <query>.`
        : 'No default search scope set. Use /scope <chemicals|samples|assay|gel>.');
      return;
    }

    if (scopeArg === 'none' || scopeArg === 'off' || scopeArg === 'clear') {
      chatDefaultSearchScope.delete(chatKey);
      ctx.reply('Default search scope cleared.');
      return;
    }

    const target = getSearchTarget(scopeArg);
    if (!target) {
      ctx.reply('Unknown scope for /scope. Use chemicals, samples, assay, or gel.');
      return;
    }

    chatDefaultSearchScope.set(chatKey, target.scope);
    ctx.reply(`Default search scope set to "${target.scope}". Use /q <query>.`);
  });

  registerCommandAlias('q', [], (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    if (!query) {
      ctx.reply('Usage: /q <query>. Set default scope with /scope first.');
      return;
    }
    const target = getDefaultSearchTarget(ctx);
    if (!target) {
      ctx.reply('No default search scope set. Use /scope <chemicals|samples|assay|gel> first.');
      return;
    }
    const sent = sendSearchCommand(getMainWindow, target, query);
    if (!sent) {
      noWindowMessage(ctx);
      return;
    }
    ctx.reply(`Opened ${target.label} and searched for: ${query}`);
  });

  registerCommandAlias('expiring', ['expiring-lots'], (ctx) => {
    const result = performLookupAction(ctx, 'expiry', 'expiring');
    ctx.reply(result.ok
      ? `${result.message}\nReview lot expiration in Chemicals.`
      : result.message);
  });

  registerCommandAlias('lowstock', ['low-stock'], (ctx) => {
    const result = performLookupAction(ctx, 'inventory', 'low stock');
    ctx.reply(result.ok
      ? `${result.message}\nReview stock levels in Chemicals.`
      : result.message);
  });

  registerCommandAlias('today', [], (ctx) => {
    const key = getChatScopeKey(ctx);
    const history = chatEventHistory.get(key) || [];
    ctx.reply(buildTodaySummaryFromHistory(history));
  });

  registerCommandAlias('log', [], (ctx) => {
    const message = getCommandArgs(ctx.message?.text);
    if (!message) {
      ctx.reply('Usage: /log <message>');
      return;
    }
    const draft = createDraft(ctx, message, {
      intent: {
        intent: 'log_experiment',
        subintent: eventTypeToIntentSubintent(detectLabEventType(message)),
        entities: {
          message_text: message
        }
      }
    });
    ctx.reply(formatDraftReply(draft));
  });

  registerCommandAlias('note', [], (ctx) => {
    const message = getCommandArgs(ctx.message?.text);
    if (!message) {
      ctx.reply('Usage: /note <message>');
      return;
    }

    const run = getActiveRun(ctx);
    if (run) {
      handleExecutionSubintent(ctx, 'add_note', message);
      return;
    }

    const draft = createDraft(ctx, message, {
      intent: {
        intent: 'draft_record',
        subintent: 'notebook_entry',
        entities: {
          message_text: message
        }
      }
    });
    ctx.reply(formatDraftReply(draft));
  });

  registerCommandAlias('decision', [], (ctx) => {
    const message = getCommandArgs(ctx.message?.text);
    if (!message) {
      ctx.reply('Usage: /decision <message>');
      return;
    }
    const draft = createDraft(ctx, message, {
      intent: {
        intent: 'draft_record',
        subintent: 'decision_record',
        entities: {
          decision_text: message
        }
      },
      eventType: 'decision'
    });
    ctx.reply(formatDraftReply(draft));
  });

  registerCommandAlias('task', [], (ctx) => {
    const message = getCommandArgs(ctx.message?.text);
    if (!message) {
      ctx.reply('Usage: /task <message>');
      return;
    }
    const draft = createDraft(ctx, message, {
      intent: {
        intent: 'draft_record',
        subintent: 'task_list',
        entities: {
          task_text: message
        }
      },
      eventType: 'task',
      draftType: 'task'
    });
    ctx.reply(formatDraftReply(draft));
  });

  registerCommandAlias('use', [], (ctx) => {
    const message = getCommandArgs(ctx.message?.text);
    if (!message) {
      ctx.reply('Usage: /use <message>');
      return;
    }
    const draft = createDraft(ctx, message, {
      intent: {
        intent: 'draft_record',
        subintent: 'reagent_usage',
        entities: {
          message_text: message
        }
      },
      eventType: 'inventory_usage',
      draftType: 'reagent_checklist'
    });
    ctx.reply(formatDraftReply(draft));
  });

  registerCommandAlias('register_sample', ['register-sample'], (ctx) => {
    const message = getCommandArgs(ctx.message?.text);
    if (!message) {
      ctx.reply('Usage: /register-sample <message>');
      return;
    }
    const draft = createDraft(ctx, message, {
      intent: {
        intent: 'draft_record',
        subintent: 'sample_registration',
        entities: {
          message_text: message
        }
      },
      eventType: 'sample_registration'
    });
    ctx.reply(formatDraftReply(draft));
  });

  registerCommandAlias('register_reagent', ['register-reagent'], (ctx) => {
    const message = getCommandArgs(ctx.message?.text);
    if (!message) {
      ctx.reply('Usage: /register-reagent <message>');
      return;
    }
    const draft = createDraft(ctx, message, {
      intent: {
        intent: 'draft_record',
        subintent: 'reagent_registration',
        entities: {
          message_text: message
        }
      },
      eventType: 'reagent_registration',
      draftType: 'reagent_checklist'
    });
    ctx.reply(formatDraftReply(draft));
  });

  registerCommandAlias('start_protocol', ['start-protocol'], (ctx) => {
    const protocolName = getCommandArgs(ctx.message?.text);
    if (!protocolName) {
      ctx.reply('Usage: /start-protocol <protocol name>');
      return;
    }
    handleExecutionSubintent(ctx, 'start', protocolName);
  });

  registerCommandAlias('next', [], (ctx) => {
    handleExecutionSubintent(ctx, 'next');
  });

  registerCommandAlias('done', [], (ctx) => {
    handleExecutionSubintent(ctx, 'done');
  });

  registerCommandAlias('repeat', [], (ctx) => {
    handleExecutionSubintent(ctx, 'repeat');
  });

  registerCommandAlias('pause', [], (ctx) => {
    handleExecutionSubintent(ctx, 'pause');
  });

  registerCommandAlias('resume', [], (ctx) => {
    handleExecutionSubintent(ctx, 'resume');
  });

  registerCommandAlias('deviation', [], (ctx) => {
    const message = getCommandArgs(ctx.message?.text);
    if (!message) {
      ctx.reply('Usage: /deviation <message>');
      return;
    }
    handleExecutionSubintent(ctx, 'add_deviation', message);
  });

  registerCommandAlias('timer', [], (ctx) => {
    const argText = getCommandArgs(ctx.message?.text);
    if (!argText) {
      ctx.reply('Usage: /timer <duration> <label>');
      return;
    }
    const parsed = splitDurationAndLabel(argText);
    const label = parsed.label || 'Lab reminder';
    const result = scheduleReminder(ctx, parsed.durationMs, parsed.durationText, label);
    ctx.reply(result.message);
  });

  registerCommandAlias('draft_notebook', ['draft-notebook'], (ctx) => {
    const message = getCommandArgs(ctx.message?.text) || 'Draft notebook from latest updates';
    const draft = createDraft(ctx, message, {
      intent: {
        intent: 'draft_record',
        subintent: 'notebook_entry',
        entities: {
          message_text: message
        }
      },
      eventType: detectLabEventType(message),
      draftType: 'notebook'
    });
    ctx.reply(formatDraftReply(draft));
  });

  registerCommandAlias('draft_summary', ['draft-summary'], (ctx) => {
    const draft = createTodaySummaryDraft(ctx);
    ctx.reply(formatDraftReply(draft));
  });

  registerCommandAlias('draft_checklist', ['draft-checklist'], (ctx) => {
    const topic = getCommandArgs(ctx.message?.text);
    if (!topic) {
      ctx.reply('Usage: /draft-checklist <protocol or task>');
      return;
    }
    const draft = createDraft(ctx, topic, {
      intent: {
        intent: 'draft_record',
        subintent: 'reagent_checklist',
        entities: {
          title: topic
        }
      },
      eventType: 'checklist'
    });
    ctx.reply(formatDraftReply(draft));
  });

  registerCommandAlias('draft_assay', ['draft-assay'], (ctx) => {
    const desc = getCommandArgs(ctx.message?.text);
    if (!desc) {
      ctx.reply('Usage: /draft-assay <description>');
      return;
    }
    const draft = createDraft(ctx, desc, {
      intent: {
        intent: 'draft_record',
        subintent: 'assay_plan',
        entities: {
          message_text: desc
        }
      },
      eventType: 'assay',
      draftType: 'assay'
    });
    ctx.reply(formatDraftReply(draft));
  });

  registerCommandAlias('draft_reservation', ['draft-reservation'], (ctx) => {
    const message = getCommandArgs(ctx.message?.text);
    if (!message) {
      ctx.reply('Usage: /draft-reservation <message>');
      return;
    }
    const draft = createDraft(ctx, message, {
      intent: {
        intent: 'draft_record',
        subintent: 'reservation_request',
        entities: {
          message_text: message
        }
      },
      eventType: 'reservation_request',
      draftType: 'reservation'
    });
    ctx.reply(formatDraftReply(draft));
  });

  registerCommandAlias('link_project', ['link-project'], (ctx) => {
    const project = getCommandArgs(ctx.message?.text);
    if (!project) {
      ctx.reply('Usage: /link-project <project>');
      return;
    }
    const context = getChatContext(ctx);
    context.active_project = project;
    context.last_entities = {
      ...context.last_entities,
      project
    };
    ctx.reply(`Linked current Telegram session to project "${project}".`);
  });

  registerCommandAlias('set_default_project', ['set-default-project'], (ctx) => {
    const project = getCommandArgs(ctx.message?.text);
    if (!project) {
      ctx.reply('Usage: /set-default-project <project>');
      return;
    }
    const context = getChatContext(ctx);
    context.default_project = project;
    if (!context.active_project) {
      context.active_project = project;
    }
    ctx.reply(`Default project set to "${project}".`);
  });

  registerCommandAlias('my_context', ['my-context'], (ctx) => {
    const context = getChatContext(ctx);
    const activeDraft = getActiveDraft(ctx);
    const activeRun = getActiveRun(ctx);
    ctx.reply(formatSessionContextMessage(context, activeDraft, activeRun));
  });

  registerCommandAlias('notifications', [], (ctx) => {
    const raw = normalizeTokenKey(getCommandArgs(ctx.message?.text));
    const context = getChatContext(ctx);
    if (!raw) {
      ctx.reply(`Notifications are ${context.notifications_enabled ? 'on' : 'off'}. Use /notifications on|off.`);
      return;
    }

    if (['on', 'enable', 'enabled', 'yes'].includes(raw)) {
      context.notifications_enabled = true;
      ctx.reply('Notifications enabled.');
      return;
    }

    if (['off', 'disable', 'disabled', 'no'].includes(raw)) {
      context.notifications_enabled = false;
      ctx.reply('Notifications disabled.');
      return;
    }

    ctx.reply('Usage: /notifications on|off');
  });

  getModuleCatalog().forEach((entry) => {
    const cmd = entry.token;
    if ([
      'inventory',
      'chemicals',
      'samples',
      'sample',
      'assay',
      'gel',
      'protocol',
      'project',
      'instrument',
      'papers'
    ].includes(cmd)) {
      return;
    }

    bot.command(cmd, (ctx) => {
      const sent = sendTelegramCommandToRenderer(getMainWindow, {
        type: 'open-view',
        viewId: TELEGRAM_MODULE_MAP.get(cmd)?.viewId
      });
      if (!sent) {
        noWindowMessage(ctx);
        return;
      }
      ctx.reply(`Opened ${entry.label}.`);
    });
  });

  bot.on('text', (ctx) => {
    const msg = String(ctx.message?.text || '').trim();
    if (!msg) {
      return;
    }
    if (msg.startsWith('/')) {
      return;
    }

    const context = getChatContext(ctx);
    const lower = msg.toLowerCase();
    const activeDraft = getActiveDraft(ctx);

    if (activeDraft) {
      if (/^save\s+draft$/i.test(msg) || /^save$/i.test(msg)) {
        const saved = saveActiveDraft(ctx);
        ctx.reply(`Saved as draft ${saved.draft_id}.`);
        return;
      }
      if (/^discard$/i.test(msg)) {
        const discarded = discardActiveDraft(ctx);
        ctx.reply(`Discarded draft ${discarded.draft_id}.`);
        return;
      }
      if (/^open\s+in\s+enana$/i.test(msg)) {
        const sent = openDraftInEnana(ctx, activeDraft);
        if (!sent) {
          noWindowMessage(ctx);
          return;
        }
        ctx.reply(`Opened draft ${activeDraft.draft_id} context in Enana.`);
        return;
      }

      if (/^(add|set)\s+/i.test(msg) || activeDraft.content.missing_fields?.length) {
        const cleaned = msg.replace(/^(add|set)\s+/i, '').trim() || msg;
        const updated = updateDraft(ctx, cleaned);
        ctx.reply(formatDraftReply(updated, { updated: true }));
        return;
      }
    }

    if (/^(done|next|repeat|pause|resume)$/i.test(msg)) {
      const executionIntent = msg.toLowerCase() === 'next' ? 'next' : msg.toLowerCase();
      handleExecutionSubintent(ctx, executionIntent);
      return;
    }

    if (/^note\s+/.test(lower)) {
      const activeRun = getActiveRun(ctx);
      if (activeRun) {
        handleExecutionSubintent(ctx, 'add_note', msg);
        return;
      }
    }

    if (/^deviation\s+/.test(lower)) {
      const activeRun = getActiveRun(ctx);
      if (activeRun) {
        handleExecutionSubintent(ctx, 'add_deviation', msg);
        return;
      }
    }

    const timerRequest = parseTimerRequest(msg);
    if (timerRequest) {
      const timerResult = scheduleReminder(ctx, timerRequest.duration_ms, timerRequest.duration, timerRequest.label);
      ctx.reply(timerResult.message);
      return;
    }

    const intent = parseNaturalLanguageIntent(msg, context);

    if (intent.intent === 'lookup') {
      const query = intent.entities?.query || '';
      const result = performLookupAction(ctx, intent.subintent, query);
      ctx.reply(result.message);
      recordChatEvent(ctx, {
        type: 'lookup',
        label: `Lookup ${intent.subintent}: ${query || '(none)'}`
      });
      return;
    }

    if (intent.intent === 'protocol_execution') {
      const payload = intent.subintent === 'start'
        ? parseProtocolFromText(msg, context.active_protocol)
        : msg;
      handleExecutionSubintent(ctx, intent.subintent, payload);
      return;
    }

    if (intent.intent === 'log_experiment' || intent.intent === 'draft_record') {
      const draft = createDraft(ctx, msg, { intent });
      ctx.reply(formatDraftReply(draft));
      return;
    }

    recordChatEvent(ctx, {
      type: 'message',
      label: msg
    });

    ctx.reply([
      'I can help with lookup, logging, draft creation, protocol steps, and timers.',
      'Try:',
      '- "Do we have imidazole?"',
      '- "I expressed PD1-His in BL21"',
      '- "set timer 45 min harvest culture"',
      '- "summarize today"'
    ].join('\n'));
  });

  bot
    .launch()
    .then(() => {
      console.log('Telegram bot started');
      void ensureLogPath().then((logPath) => appendTelegramLogEntry(
        logPath,
        createTelegramLogMetaEntry('bot-launched')
      ));
    })
    .catch((error) => {
      console.error('Failed to start Telegram bot:', error);
      void ensureLogPath().then((logPath) => appendTelegramLogEntry(
        logPath,
        createTelegramLogMetaEntry('bot-launch-failed', { error: String(error) })
      ));
    });

  bot.catch((error, ctx) => {
    console.error('Telegram bot middleware error:', error);
    void ensureLogPath().then((logPath) => appendTelegramLogEntry(
      logPath,
      createTelegramLogMetaEntry('bot-error', {
        error: String(error),
        updateType: String(ctx?.updateType || '')
      })
    ));
  });

  return bot;
}

startTelegramBot._internals = {
  getCommandArgs,
  normalizeTokenKey,
  getModuleTarget,
  getSearchTarget,
  splitFirstToken,
  levenshteinDistance,
  getModuleCatalog,
  getModuleSuggestions,
  parseDurationToMs,
  splitDurationAndLabel,
  parseTimerRequest,
  parseNaturalLanguageIntent,
  parseLookupSubintent,
  parseLabEvent,
  parseProteinExpressionEvent,
  parseTransformationEvent,
  parseTransfectionEvent,
  parseCellCultureEvent,
  parsePurificationEvent,
  parseAssayEvent,
  parseGelEvent,
  parseReagentUseEvent,
  parseDecisionEvent,
  sendGlobalSearchCommand
};

module.exports = startTelegramBot;
