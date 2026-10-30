import { array, html, inline, object, text } from './format.mjs';

const DOCUMENT_VERSION = 1;
const documentMarker = kind => `<!-- hikari-document:${kind}:v${DOCUMENT_VERSION} -->`;
// A blank line before the closing marker keeps formatters such as Prettier
// from reading it as part of a list item that ends the section.
const block = (kind, key, body) => {
  const content = body.trimEnd();
  return `<!-- hikari-${kind}:${key} -->\n${content ? `${content}\n` : ''}\n<!-- /hikari-${kind}:${key} -->\n\n`;
};
const fieldBlock = (key, title, body, level = 2) => block('field', key, `${'#'.repeat(level)} ${title}\n\n${body}`);
const derivedBlock = (key, body) => block('derived', key, body);

function blocks(source, kind = 'field') {
  const found = new Map();
  const pattern = new RegExp(`^<!-- hikari-${kind}:([a-z-]+) -->\\r?\\n([\\s\\S]*?)^<!-- /hikari-${kind}:\\1 -->[ \\t]*(?:\\r?\\n|$)`, 'gm');
  for (const match of source.matchAll(pattern)) {
    if (found.has(match[1])) throw new Error(`Duplicate Markdown section: ${match[1]}`);
    // Formatters such as Prettier add a blank line after each marker.
    found.set(match[1], { body: match[2].replace(/\r\n/g, '\n').replace(/^(?:[ \t]*\n)+/, '').trimEnd(), source: match[0] });
  }
  const starts = source.match(new RegExp(`^<!-- /?hikari-${kind}:`, 'gm')) || [];
  if (starts.length !== found.size * 2) throw new Error(`Incomplete Markdown ${kind} section markers`);
  return found;
}

// The final section marker of a document and where the text after it starts.
function lastSection(source) {
  const closing = [...source.matchAll(/^<!-- \/hikari-(field|derived):([a-z-]+) -->[ \t]*(?:\r?\n|$)/gm)].at(-1);
  return closing && { kind: closing[1], key: closing[2], end: closing.index + closing[0].length };
}

function decode(value, escaped = false) {
  const source = escaped ? value.replace(/\\([\\`*_[\]#!])/g, '$1') : value;
  return source.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function content(body) {
  return body.replace(/^#{1,6} [^\n]*(?:\n(?:\n)?|$)/, '').trimEnd();
}

function stepText(step) { return text(typeof step === 'string' ? step : step?.text || step?.instruction || step?.action); }

function displayStep(step) {
  const placeholders = array(step?.placeholders);
  let index = 0;
  const source = stepText(step);
  return source.includes('{{ph:')
    ? source.replace(/\{\{ph:([^}]+)\}\}/g, (_match, id) => `[${placeholders.find(item => text(item.id) === id)?.name || id}]`)
    : source.replace(/\[([^\[\]]+)\]/g, match => placeholders[index++] ? `[${placeholders[index - 1].name}]` : match);
}

function fieldsForRecord(record, kind) {
  if (kind === 'notebook') return { result: `## Notes and results\n\n${html(record.result)}`.trimEnd() };
  return {
    name: `# ${inline(record.name || record.title || 'Protocol')}`,
    purpose: `## Purpose\n\n${html(record.purpose || record.description)}`.trimEnd(),
    materials: `## Materials\n\n${Array.isArray(record.materials) ? record.materials.map(item => `- ${inline(item)}`).join('\n') : html(record.materials)}`.trimEnd(),
    steps: `## Steps\n\n${array(record.steps).map((step, index) => `<!-- hikari-step:${index} -->\n${index + 1}. ${html(displayStep(step)).replace(/\r?\n/g, '\n   ')}`).join('\n\n')}`.trimEnd(),
    troubleshooting: `## Troubleshooting\n\n${html(record.troubleshooting)}`.trimEnd()
  };
}

function parseSteps(body, original) {
  // Editors hide step markers. A marker belongs to the next item even across
  // blank lines; a marker whose item was deleted is a deleted step.
  const source = content(body).replace(/^(<!-- hikari-step:\d+ -->)\n(?:[ \t]*\n)*(?=\d+[.)] )|^<!-- hikari-step:\d+ -->(?:\n|(?![\s\S]))/gm,
    (_match, marker) => marker ? `${marker}\n` : '');
  if (!source.trim()) return [];
  const pattern = /(?:^|\n)(?:<!-- hikari-step:(\d+) -->\n)?\d+[.)] ([\s\S]*?)(?=\n(?:<!-- hikari-step:\d+ -->\n)?\d+[.)] |$)/g;
  const matches = [...source.matchAll(pattern)];
  const covered = matches.map(match => match[0]).join('');
  if (!matches.length || covered.trim() !== source.trim()) throw new Error('Steps must be a numbered Markdown list');
  const seen = new Set();
  const anchored = matches.some(match => match[1] !== undefined);
  return matches.map((match, index) => {
    const position = match[1] === undefined ? (anchored ? -1 : index) : Number(match[1]);
    if (position >= 0) {
      if (seen.has(position)) throw new Error('Duplicate protocol step marker');
      if (match[1] !== undefined && position >= original.length) throw new Error('Unknown protocol step marker');
      seen.add(position);
    }
    const prior = original[position];
    let value = decode(match[2].trimEnd().replace(/\n {3}/g, '\n'));
    // Keep unchanged steps byte-for-byte, including legacy string steps and tokens.
    if (prior !== undefined && value === displayStep(prior)) return structuredClone(prior);
    const step = { ...object(prior), text: value, placeholders: array(prior?.placeholders).map(item => ({ ...item })) };
    if (stepText(prior).includes('{{ph:')) {
      const byName = new Map();
      for (const placeholder of step.placeholders) {
        const ids = byName.get(placeholder.name) || new Set();
        ids.add(placeholder.id);
        byName.set(placeholder.name, ids);
      }
      const occurrences = new Map();
      for (const token of stepText(prior).matchAll(/\{\{ph:([^}]+)\}\}/g)) {
        const placeholder = step.placeholders.find(item => item.id === token[1]);
        if (!placeholder) continue;
        const ids = occurrences.get(placeholder.name) || [];
        ids.push(placeholder.id);
        occurrences.set(placeholder.name, ids);
      }
      const positions = new Map();
      step.text = value.replace(/\[([^\[\]]+)\]/g, (match, name) => {
        const ids = byName.get(name);
        if (!ids) return match;
        const position = positions.get(name) || 0;
        positions.set(name, position + 1);
        const id = ids.size === 1 ? [...ids][0] : occurrences.get(name)?.[position];
        if (!id) throw new Error(`Ambiguous protocol parameter: ${name}`);
        return `{{ph:${id}}}`;
      });
      for (const [name, ids] of byName) {
        if (ids.size > 1 && (positions.get(name) || 0) !== (occurrences.get(name)?.length || 0)) {
          throw new Error(`Ambiguous protocol parameter: ${name}`);
        }
      }
    }
    return step;
  });
}

function readDocumentRecord(source, record, kind) {
  if (!source.includes(documentMarker(kind))) throw new Error(`Missing ${kind} Markdown document marker`);
  const found = blocks(source);
  // Text typed after a page's final notes section belongs to those notes.
  const last = lastSection(source);
  const tail = kind === 'notebook' && last ? source.slice(last.end).replace(/\r\n/g, '\n').trim() : '';
  if (tail && found.has('result')) found.set('result', { ...found.get('result'), body: `${found.get('result').body}\n\n${tail}` });
  const expected = fieldsForRecord(record, kind);
  const next = structuredClone(record);
  for (const [key, baseline] of Object.entries(expected)) {
    const field = found.get(key);
    if (!field) throw new Error(`Missing Markdown section: ${key}`);
    if (field.body === baseline) continue;
    if (key === 'name') next.name = decode(field.body.replace(/^# /, ''), true).trim();
    else if (key === 'steps') next.steps = parseSteps(field.body, array(record.steps));
    else if (key === 'materials' && Array.isArray(record.materials)) {
      const body = content(field.body);
      next.materials = body.trim() ? body.split(/\n(?=- )/).map(line => decode(line.replace(/^- /, ''), true)) : [];
    } else {
      next[key] = decode(content(field.body));
      if (key === 'purpose') delete next.description;
    }
  }
  return next;
}

function validateDocument(source, record, kind) {
  readDocumentRecord(source, record, kind);
  const derived = blocks(source, 'derived');
  for (const key of ['metadata', 'context', 'images']) {
    if (!derived.has(key)) throw new Error(`Missing Markdown derived section: ${key}`);
  }
}

// Three-way merge prevents a stale app snapshot from replacing external edits.
async function createMarkdownRevision(record, kind) {
  const fields = await Promise.all(Object.entries(fieldsForRecord(record, kind)).map(async ([key, value]) => {
    const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [key, Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')];
  }));
  return { version: DOCUMENT_VERSION, fields: Object.fromEntries(fields) };
}

async function mergeDocumentRecord(source, baseline, incoming, kind) {
  const current = readDocumentRecord(source, baseline, kind);
  const baselineRevision = await createMarkdownRevision(baseline, kind);
  const candidate = incoming.markdownRevision;
  const validRevision = candidate?.version === DOCUMENT_VERSION && Object.keys(baselineRevision.fields).every(key => /^[a-f0-9]{64}$/.test(candidate.fields?.[key] || ''));
  const before = validRevision ? candidate.fields : baselineRevision.fields;
  const disk = (await createMarkdownRevision(current, kind)).fields;
  const proposed = (await createMarkdownRevision(incoming, kind)).fields;
  const next = structuredClone(incoming);
  for (const key of Object.keys(baselineRevision.fields)) {
    if (disk[key] === before[key]) continue;
    if (proposed[key] !== before[key] && proposed[key] !== disk[key]) {
      throw Object.assign(new Error(`Markdown conflict in ${key}`), { code: 'MARKDOWN_CONFLICT' });
    }
    if (key === 'name') next.name = current.name;
    else if (key === 'purpose') { next.purpose = current.purpose; delete next.description; }
    else next[key] = structuredClone(current[key]);
  }
  return next;
}

function preserveDocument(previous, rendered) {
  if (!previous) return rendered;
  let result = previous;
  for (const kind of ['field', 'derived']) {
    const oldBlocks = blocks(previous, kind);
    for (const [key, updated] of blocks(rendered, kind)) {
      const old = oldBlocks.get(key);
      if (!old) throw new Error(`Missing Markdown ${kind} section: ${key}`);
      // Older sections lack the blank line before their closing marker; they
      // are rewritten once. A function replacement keeps `$$`, `$&` and `$'` literal.
      const unspaced = /\n\n<!-- \//.test(updated.source) && !/\n[ \t]*\r?\n<!-- \//.test(old.source);
      if (old.body !== updated.body || unspaced) result = result.replace(old.source, () => updated.source);
    }
  }
  // A page ends with its notes. Text typed after them was read into the
  // notes, so it is dropped here; older pages are reordered to match.
  const target = lastSection(rendered);
  const last = lastSection(result);
  if (target?.kind === 'field' && last) {
    if (last.kind === 'field' && last.key === target.key) {
      if (result.slice(last.end).trim()) result = `${result.slice(0, last.end)}\n`;
    } else {
      const moved = blocks(result).get(target.key).source;
      const start = result.indexOf(moved);
      result = result.slice(0, start) + result.slice(start + moved.length).replace(/^\n/, '');
      const end = lastSection(result).end;
      result = `${result.slice(0, end)}\n${moved}`;
    }
  }
  return result;
}

export { DOCUMENT_VERSION, block, blocks, createMarkdownRevision, derivedBlock, documentMarker, fieldBlock, fieldsForRecord, mergeDocumentRecord, preserveDocument, readDocumentRecord, validateDocument };
