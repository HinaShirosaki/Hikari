const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const array = value => Array.isArray(value) ? value : [];
const text = value => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const html = value => text(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeMarkdown = value => html(value).replace(/([\\`*_[\]#!])/g, '\\$1');
const inline = value => escapeMarkdown(value).replace(/\r?\n/g, ' ');
const cell = value => escapeMarkdown(value).replace(/\|/g, '&#124;').replace(/\r?\n/g, '<br>');
function label(key) {
  if (key === 'pH') return 'pH';
  if (key === 'volumePerWellUl') return 'Volume per well (µL)';
  const words = String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ')
    .replace(/\bId\b/gi, 'ID').replace(/\bUrl\b/gi, 'URL');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function table(headers, rows) {
  if (!headers.length) return '';
  return [
    `| ${headers.map(cell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${headers.map((_header, index) => cell(row[index]).replace(/\r?\n/g, '<br>')).join(' | ')} |`)
  ].join('\n');
}

function properties(value) {
  const entries = Object.entries(object(value)).filter(([_key, item]) => item != null && item !== '');
  return entries.length ? table(['Field', 'Value'], entries.map(([key, item]) => [label(key), text(item)])) : '';
}

// Generic saved context also handles newly added fields, without an exporter
// schema that silently loses them. Nested fields become sections and tables.
function context(value, level = 4) {
  if (Array.isArray(value)) {
    if (value.every(row => row && typeof row === 'object' && !Array.isArray(row))) {
      const keys = [...new Set(value.flatMap(row => Object.keys(row)))];
      const scalarKeys = keys.filter(key => value.every(row => !row[key] || typeof row[key] !== 'object'));
      const nestedKeys = keys.filter(key => !scalarKeys.includes(key));
      const summary = table(scalarKeys.map(label), value.map(row => scalarKeys.map(key => row[key])));
      const details = value.flatMap((row, index) => nestedKeys.filter(key => row[key]).map(key =>
        section(`${row.name || row.sample || row.title || `Row ${index + 1}`} — ${label(key)}`, context(row[key], Math.min(level + 1, 6)), Math.min(level, 6))));
      return [summary, ...details].filter(Boolean).join('\n\n');
    }
    return value.map((item, index) => item && typeof item === 'object'
      ? section(`Item ${index + 1}`, context(item, Math.min(level + 1, 6)), Math.min(level, 6))
      : `- ${inline(item)}`).join('\n');
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    const scalars = entries.filter(([_key, item]) => !item || typeof item !== 'object');
    const nested = entries.filter(([_key, item]) => item && typeof item === 'object');
    return [properties(Object.fromEntries(scalars)), ...nested.map(([key, item]) =>
      section(label(key), context(item, Math.min(level + 1, 6)), Math.min(level, 6)))].filter(Boolean).join('\n\n');
  }
  return html(value);
}

function section(title, body, level = 2) {
  const content = text(body).trimEnd();
  return content ? `${'#'.repeat(level)} ${inline(title)}\n\n${content}\n\n` : '';
}

export { array, cell, context, html, inline, label, object, properties, section, table, text };
