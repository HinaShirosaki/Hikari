const fail = (message) => { throw new Error(message); };
const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const allowedKeys = (value, keys, name) => {
  if (!isObject(value)) fail(`${name} must be an object.`);
  Object.keys(value).forEach((key) => { if (!keys.includes(key)) fail(`Unknown ${name} field: ${key}`); });
};
function plainText(value, limit, name) {
  if (typeof value !== 'string' || value.length > limit || /[<>]/.test(value)) fail(`${name} must be plain text, at most ${limit} characters.`);
  return value;
}
function finite(value, min, max, name) {
  if (!Number.isFinite(value) || value < min || value > max) fail(`${name} must be a number between ${min} and ${max}.`);
  return value;
}
function choice(value, options, name) {
  if (!options.includes(value)) fail(`${name} must be ${options.join(' or ')}.`);
  return value;
}
export function normalizePlotElements(input = []) {
  if (!Array.isArray(input) || input.length > 32) fail('The plot supports at most 32 added elements.');
  const ids = new Set();
  return input.map((source) => {
    if (!isObject(source)) fail('Each plot element must be an object.');
    const fields = { label: ['text', 'x', 'y', 'coordinates', 'fontSize', 'arrow'], line: ['axis', 'value', 'dash', 'width'], band: ['axis', 'start', 'end', 'opacity'] };
    choice(source.type, Object.keys(fields), 'type');
    allowedKeys(source, ['id', 'type', 'color', ...fields[source.type]], 'element');
    if (typeof source.id !== 'string' || !/^[\w.-]{1,100}$/.test(source.id) || ids.has(source.id)) fail('Each element needs a unique ID using letters, numbers, dots, underscores or hyphens.');
    ids.add(source.id);
    const color = source.color ?? '#647457';
    if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) fail('Element color must be a hex color.');
    const result = { id: source.id, type: source.type, color };
    if (source.type === 'label') {
      result.text = plainText(source.text, 500, 'Label text');
      result.coordinates = choice(source.coordinates ?? 'plot', ['plot', 'data'], 'coordinates');
      result.x = typeof source.x === 'string' && result.coordinates === 'data'
        ? plainText(source.x, 200, 'X category') : finite(source.x, -1e100, 1e100, 'X');
      result.y = finite(source.y, -1e100, 1e100, 'Y');
      result.fontSize = finite(source.fontSize ?? 14, 6, 48, 'Font size');
      if (source.arrow !== undefined && typeof source.arrow !== 'boolean') fail('arrow must be a boolean.');
      result.arrow = source.arrow === true;
      if (result.coordinates === 'plot' && (result.x < 0 || result.x > 1 || result.y < 0 || result.y > 1)) fail('Plot coordinates must be between 0 and 1.');
    } else {
      result.axis = choice(source.axis, ['x', 'y'], 'axis');
      if (source.type === 'line') {
        result.value = finite(source.value, -1e100, 1e100, 'Line value');
        result.width = finite(source.width ?? 1.5, 0.5, 8, 'Line width');
        result.dash = choice(source.dash ?? 'dash', ['solid', 'dash', 'dot'], 'Line dash');
      } else {
        result.start = finite(source.start, -1e100, 1e100, 'Band start');
        result.end = finite(source.end, -1e100, 1e100, 'Band end');
        if (result.start >= result.end) fail('Band start must be smaller than its end.');
        result.opacity = finite(source.opacity ?? 0.15, 0.01, 1, 'Band opacity');
      }
    }
    return result;
  });
}

export function validatePlotRequest(input) {
  allowedKeys(input, ['action', 'assay_id', 'expected_revision', 'request_id', 'style'], 'request');
  choice(input.action, ['read', 'update'], 'action');
  if (input.assay_id !== undefined && (typeof input.assay_id !== 'string' || input.assay_id.length > 220)) fail('Invalid assay_id.');
  if (input.action === 'update') {
    if (!input.assay_id?.trim()) fail('Updates require assay_id from read.');
    if (typeof input.expected_revision !== 'string' || !/^[a-f0-9]{64}$/.test(input.expected_revision)) fail('Updates require expected_revision from read.');
    if (typeof input.request_id !== 'string' || !/^[\w.-]{1,160}$/.test(input.request_id)) fail('Updates require a unique request_id.');
    if (!isObject(input.style) || !Object.keys(input.style).length) fail('Updates require a nonempty style patch.');
  } else if (input.style !== undefined) fail('read does not accept a style patch.');
  function json(value, depth = 0) {
    if (depth > 10) fail('Style is too deeply nested.');
    if (typeof value === 'string' && (value.length > 12000 || /[<>]/.test(value))) fail('Style strings must be plain text without markup.');
    if (typeof value === 'number' && !Number.isFinite(value)) fail('Style numbers must be finite.');
    if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) return;
    if (typeof value !== 'object') fail('Style must contain JSON values.');
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('Invalid style key.');
      json(item, depth + 1);
    }
  }
  json(input);
  if (JSON.stringify(input).length > 64000) fail('Plot update must be at most 64 KB.');
  if (input.style?.plotElements !== undefined) normalizePlotElements(input.style.plotElements);
  return input;
}

export async function plotRevision(value) {
  const sort = (item) => Array.isArray(item) ? item.map(sort)
    : isObject(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, sort(item[key])])) : item;
  const bytes = new TextEncoder().encode(JSON.stringify(sort(value)));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
