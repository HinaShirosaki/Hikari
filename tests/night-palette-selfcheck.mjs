import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

const [
  palette,
  core,
  sequenceViewerPalette,
  assayPalette,
  gelViewPalette,
  gelPalette,
  gelCore
] = await Promise.all([
  read('ui/css/base/palette.css'),
  read('ui/css/base/core.css'),
  read('ui/css/views/sequence-viewer-palette.css'),
  read('ui/css/views/assay-plate-palette.css'),
  read('src/plugins/gel/vendor/css/views/gel-palette.css'),
  read('src/plugins/gel/vendor/css/base/palette.css'),
  read('src/plugins/gel/vendor/css/base/core.css')
]);

// Measurement colors encode data, so they stay fixed across themes.
const FIXED_DATA_COLORS = new Set(['--gel-path', '--gel-path-glow']);

assert.equal(gelPalette, palette, 'Gel must vendor the same palette as the host');


/* ---------- minimal CSS color resolver (hex, rgba, var, color-mix in srgb) ---------- */

// A block may be shared through a selector list (`:root, #preview[...] {`).
function readBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|[}/])\\s*${escaped}\\s*(?:,[^{}]*)?\\{`, 'm').exec(css);
  assert.ok(match, `missing block: ${selector}`);
  const start = match.index;
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

const day = readBlock(palette, ':root');
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
const controlBackground = token('--theme-control-background', surface);

assert.deepEqual(
  resolve('var(--theme-control-background)', day),
  resolve('var(--theme-surface)', day),
  'day fields must keep the historical near-white page surface'
);

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
atLeast('night text on themed control surfaces', text, controlBackground, 4.5);
assert.ok(
  luminance(controlBackground) >= luminance(subtle),
  'night control fill must be at least as bright as the subtle surface'
);

// Status chips: the shared -ink step must hold 4.5:1 on its own -soft tint in
// both modes, so a 13px label is readable on any chip the tint steps can make.
const tints = readBlock(palette, 'body');
for (const [mode, vars] of [['day', day], ['night', night]]) {
  const scope = new Map([...vars, ...tints]);
  const page = resolve('var(--theme-surface)', scope);
  for (const status of ['accent', 'success', 'warning', 'danger']) {
    const ink = resolve(`var(--theme-${status}-ink)`, scope);
    const fill = over(resolve(`var(--theme-${status}${status === 'accent' ? '-wash' : '-soft'})`, scope), page);
    atLeast(`${mode} ${status} chip`, ink, fill, 4.5);
  }
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

/*
 * A custom property is substituted where it is DECLARED, so a property written
 * on :root that reads --theme-* freezes the day palette and inherits those
 * light colors into night mode. (This is what painted the left rail near-white
 * in night mode: --app-left-rail-surface resolved --theme-surface-elevated
 * against :root, where it is #ffffff.)
 *
 * Such a property is only safe if it is re-declared per theme. Declaring it on
 * `body` instead is the one-line fix: the theme class lives there, so a single
 * declaration resolves correctly in every theme.
 */
function declarationsUnder(css, selector) {
  const found = new Map();
  const pattern = new RegExp(`(^|\\})\\s*${selector}\\s*\\{([^}]*)\\}`, 'g');
  for (const match of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(pattern)) {
    for (const [, property, value] of match[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      found.set(property, value.trim());
    }
  }
  return found;
}

const themedStylesheets = await Promise.all(
  ['ui/css', 'src/plugins'].map(async (dir) => {
    const { globSync } = await import('node:fs');
    return globSync(`${dir}/**/*.css`, { cwd: new URL('..', import.meta.url) });
  })
);

for (const relativePath of themedStylesheets.flat()) {
  const css = await read(relativePath);
  const root = declarationsUnder(css, ':root');
  const night = declarationsUnder(css, 'body\\.theme-night');
  for (const [property, value] of root) {
    if (!value.includes('var(--theme-')) continue;
    assert.ok(
      night.has(property),
      `${relativePath}: ${property} reads a theme token from :root, where it freezes the day palette and leaks into night mode; declare it on \`body\` (or re-declare it per theme)`
    );
  }
}

for (const [name, css] of [
  ['sequence-viewer-palette.css', sequenceViewerPalette],
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

/*
 * Every raw color a palette declares for day must either be re-declared for
 * night, or be listed here as deliberately fixed. Anything else renders its day
 * color on a dark page — a white table cell under light text, or near-black
 * plate labels on a dark surface.
 *
 * Fixed colors are ones that do not describe chrome: measurements, data
 * encodings, and drawings of physical objects.
 */
const FIXED_ACROSS_THEMES = new Set([
  // Drawings of physical labware: a Falcon tube is white plastic in any theme.
  '--assay-plate-pure-white', '--assay-plate-highlight', '--assay-plate-highlight-faint',
  '--assay-plate-labware-cap-start', '--assay-plate-labware-cap-end',
  '--assay-plate-labware-shadow', '--assay-plate-labware-glass-border',
  '--assay-plate-labware-glass-start', '--assay-plate-labware-glass-end',
  '--assay-plate-labware-mark', '--assay-plate-sample-fallback',
  // Data encodings.
  '--sequence-viewer-base-a-stroke', '--sequence-viewer-base-c-stroke',
  '--sequence-viewer-base-t-stroke',
  // Builder hues stay fixed; their rendered fill strength and ink follow the theme.
  ...Array.from({ length: 12 }, (_, i) => `--sequence-viewer-builder-palette-${i + 1}`),
  '--gel-marker', '--gel-marker-solid', '--gel-marker-label', '--gel-divider',
  '--gel-band-positive', '--gel-path', '--gel-path-glow',
  '--papers-highlight',
  // The Hikari action mark is a fixed brand spectrum in every theme.
  '--theme-hikari-rainbow-red', '--theme-hikari-rainbow-orange',
  '--theme-hikari-rainbow-yellow', '--theme-hikari-rainbow-green',
  '--theme-hikari-rainbow-cyan', '--theme-hikari-rainbow-blue',
  '--theme-hikari-rainbow-violet',
  // Fixed-value scientific canvases, per ui/css/Readme.md.
  '--tool-box-canvas-background', '--tool-box-canvas-border'
]);

const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\s*\(|hsla?\s*\(/;

for (const relativePath of themedStylesheets.flat()) {
  if (!relativePath.includes('palette')) continue;
  const css = await read(relativePath);
  const day = declarationsUnder(css, ':root');
  const night = declarationsUnder(css, 'body\\.theme-night');
  for (const [property, value] of day) {
    if (!RAW_COLOR.test(value)) continue;
    if (FIXED_ACROSS_THEMES.has(property)) continue;
    assert.ok(
      night.has(property),
      `${relativePath}: ${property} is a raw day color with no night value, so it paints its light/dark day color on a dark page; give it a night value or add it to FIXED_ACROSS_THEMES with a reason`
    );
  }
}

// The field fill lives in the shared rule, while each theme owns its token.
// Gel's core.css diverges from the host on fonts, so only the field rule is
// asserted to match rather than the whole stylesheet.
const FIELD_RULE = /input,\s*\n\s*textarea,\s*\n\s*select \{[^}]*background: var\(--theme-control-background\)/s;
assert.match(core, FIELD_RULE, 'shared field rule must use the theme control fill');
assert.match(gelCore, FIELD_RULE, 'gel must carry the same field fill rule as the host');

console.log('night-palette-selfcheck: ok');
