import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

const [
  palette,
  core,
  sequenceViewerPalette,
  workflowPalette,
  assayPalette,
  gelViewPalette,
  gelPalette,
  gelCore
] = await Promise.all([
  read('ui/css/base/palette.css'),
  read('ui/css/base/core.css'),
  read('ui/css/views/sequence-viewer-palette.css'),
  read('ui/css/views/workflow-palette.css'),
  read('ui/css/views/assay-plate-palette.css'),
  read('src/plugins/gel/vendor/css/views/gel-palette.css'),
  read('src/plugins/gel/vendor/css/base/palette.css'),
  read('src/plugins/gel/vendor/css/base/core.css')
]);

// Measurement colors encode data, so they stay fixed across themes.
const FIXED_DATA_COLORS = new Set(['--gel-path', '--gel-path-glow']);

assert.equal(gelPalette, palette, 'Gel must vendor the same palette as the host');


/* ---------- minimal CSS color resolver (hex, rgba, var, color-mix in srgb) ---------- */

function readBlock(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing block: ${selector}`);
  const body = css.slice(start, css.indexOf('\n}', start));
  const vars = new Map();
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    vars.set(name, value.trim());
  }
  return vars;
}

const parseHex = (text) => {
  let hex = text.slice(1);
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(1);
};

// Split on top-level commas only, so nested color-mix() survives.
function splitArgs(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current.trim());
  return parts;
}

function resolve(value, vars, seen = new Set()) {
  const text = value.trim();

  if (text.startsWith('#')) return parseHex(text);
  if (text === 'transparent') return [0, 0, 0, 0];

  if (text.startsWith('rgba(') || text.startsWith('rgb(')) {
    const n = text.match(/[\d.]+/g).map(Number);
    return [n[0], n[1], n[2], n[3] ?? 1];
  }

  const varMatch = text.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (varMatch) {
    const name = varMatch[1];
    assert.ok(!seen.has(name), `circular var reference: ${name}`);
    assert.ok(vars.has(name), `unresolved var: ${name}`);
    return resolve(vars.get(name), vars, new Set([...seen, name]));
  }

  if (text.startsWith('color-mix(')) {
    const args = splitArgs(text.slice('color-mix('.length, text.lastIndexOf(')')));
    assert.equal(args[0], 'in srgb', `only "in srgb" is modelled here: ${text}`);
    const [firstText, percent] = args[1].split(/\s+(?=\d+%$)/);
    const share = Number(percent.replace('%', '')) / 100;
    const first = resolve(firstText, vars, seen);
    const second = resolve(args[2].replace(/\s+\d+%$/, ''), vars, seen);
    // srgb mixing happens on the gamma-encoded channels, premultiplied by alpha.
    const alpha = first[3] * share + second[3] * (1 - share);
    const channel = (i) => (alpha === 0
      ? 0
      : (first[i] * first[3] * share + second[i] * second[3] * (1 - share)) / alpha);
    return [channel(0), channel(1), channel(2), alpha];
  }

  throw new Error(`cannot resolve color: ${text}`);
}

// Composite a possibly-translucent color over an opaque backdrop.
const over = (src, dst) => src.map((v, i) => (i < 3 ? v * src[3] + dst[i] * (1 - src[3]) : 1));

const luminance = (color) => {
  const channel = (value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color[0]) + 0.7152 * channel(color[1]) + 0.0722 * channel(color[2]);
};

const contrast = (a, b) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};

/* ---------- the night contract ---------- */

const night = readBlock(palette, 'body.theme-night');
const token = (name, backdrop) => {
  const color = resolve(`var(${name})`, night);
  return color[3] === 1 ? color : over(color, backdrop);
};

const background = token('--theme-background');
const surface = token('--theme-surface');
const subtle = token('--theme-surface-subtle');
const elevated = token('--theme-surface-elevated');

// A raised dialog must not read as recessed.
const ladder = [background, surface, subtle, elevated];
for (let i = 1; i < ladder.length; i += 1) {
  assert.ok(
    luminance(ladder[i]) > luminance(ladder[i - 1]),
    `night elevation ramp must increase (step ${i} does not)`
  );
}

const atLeast = (label, fg, bg, min) => {
  const ratio = contrast(fg, bg);
  assert.ok(ratio >= min, `${label}: ${ratio.toFixed(2)}:1 is below ${min}:1`);
};

const text = token('--theme-text');
const textMuted = token('--theme-text-muted');
const border = token('--theme-border', surface);

for (const [name, panel] of [['surface', surface], ['subtle', subtle], ['elevated', elevated]]) {
  atLeast(`night text on ${name}`, text, panel, 4.5);
  atLeast(`night muted text on ${name}`, textMuted, panel, 4.5);
  atLeast(`night accent on ${name}`, token('--theme-accent'), panel, 4.5);
  atLeast(`night success on ${name}`, token('--theme-success'), panel, 4.5);
  atLeast(`night warning on ${name}`, token('--theme-warning'), panel, 4.5);
  atLeast(`night danger on ${name}`, token('--theme-danger'), panel, 4.5);
  // WCAG 1.4.11: a field is identified by its edge, so the edge must be visible
  // on every surface a field can sit on.
  atLeast(`night border on ${name}`, border, panel, 3);
}

atLeast('night ink on accent', token('--theme-text-on-accent'), token('--theme-accent'), 4.5);
atLeast('night text inside a field', text, token('--theme-control-background', surface), 4.5);

// Status chips must mix toward the light, not toward the surface they sit on.
for (const status of ['success', 'warning', 'danger']) {
  const hue = `var(--theme-${status})`;
  const ink = resolve(`color-mix(in srgb, ${hue} 72%, var(--theme-text-strong))`, night);
  const fill = resolve(`color-mix(in srgb, ${hue} 16%, var(--theme-surface))`, night);
  atLeast(`night ${status} chip`, ink, fill, 4.5);
}

/* ---------- night must not fork the theme vocabulary ---------- */

const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|rgba?\s*\(|hsla?\s*\(/i;

// A view's night colors live either in a body.theme-night block or in a
// --<view>-night-* property on :root. Both must defer to the theme contract.
function nightDeclarations(css) {
  const found = [];
  const blockStart = css.indexOf('body.theme-night {');
  if (blockStart !== -1) {
    found.push(...readBlock(css, 'body.theme-night'));
  }
  for (const [, property, value] of css.matchAll(/(--[\w-]*-night-[\w-]+)\s*:\s*([^;]+);/g)) {
    found.push([property, value.trim()]);
  }
  return found;
}

// A custom property is substituted where it is DECLARED, so a --*-night-*
// property written on :root resolves --theme-* against the day palette and
// inherits a light value into night mode. It must be night-scoped.
function rootBlockBody(css) {
  const start = css.indexOf(':root {');
  return start === -1 ? '' : css.slice(start, css.indexOf('\n}', start));
}

for (const [name, css] of [
  ['sequence-viewer-palette.css', sequenceViewerPalette],
  ['workflow-palette.css', workflowPalette],
  ['assay-plate-palette.css', assayPalette],
  ['gel-palette.css', gelViewPalette]
]) {
  for (const [, property, value] of rootBlockBody(css).matchAll(/(--[\w-]*-night-[\w-]+)\s*:\s*([^;]+);/g)) {
    assert.ok(
      !value.includes('var(--theme-'),
      `${name}: ${property} reads a theme token from :root, where it resolves against the day palette; declare it under body.theme-night`
    );
  }
}

for (const [name, css] of [
  ['sequence-viewer-palette.css', sequenceViewerPalette],
  ['workflow-palette.css', workflowPalette],
  ['assay-plate-palette.css', assayPalette],
  ['gel-palette.css', gelViewPalette]
]) {
  const declarations = nightDeclarations(css);
  assert.ok(declarations.length > 0, `${name}: expected night declarations to check`);
  for (const [property, value] of declarations) {
    if (FIXED_DATA_COLORS.has(property)) continue;
    assert.doesNotMatch(
      value,
      COLOR_LITERAL,
      `${name}: ${property} hardcodes a night color; derive it from --theme-* instead`
    );
  }
}

// The fix for invisible fields lives in the shared rule, not per view.
// Gel's core.css diverges from the host on fonts, so only the field rule is
// asserted to match rather than the whole stylesheet.
const FIELD_RULE = /input,\s*\n\s*textarea,\s*\n\s*select \{[^}]*background: var\(--theme-control-background\)/s;
assert.match(core, FIELD_RULE, 'shared field rule must use the control fill, not the page surface');
assert.match(gelCore, FIELD_RULE, 'gel must carry the same field fill rule as the host');

console.log('night-palette-selfcheck: ok');
