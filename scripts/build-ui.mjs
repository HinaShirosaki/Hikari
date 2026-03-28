#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const HTML_CONFIG_PATH = path.join(ROOT_DIR, 'ui', 'config', 'html-order.json');
const CSS_CONFIG_PATH = path.join(ROOT_DIR, 'ui', 'config', 'css-order.json');
const APP_REGISTRY_PATH = path.join(ROOT_DIR, 'ui', 'config', 'app-registry.json');
const APP_REGISTRY_MODULE_OUTPUT = 'src/renderer/modules/app-registry.generated.js';

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function readText(relativePath) {
  const absolutePath = path.join(ROOT_DIR, relativePath);
  return fs.readFile(absolutePath, 'utf8');
}

async function writeText(relativePath, contents) {
  const absolutePath = path.join(ROOT_DIR, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, contents.replace(/\r\n/g, '\n'), 'utf8');
}

function ensureAppRegistryShape(registry) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    throw new Error('app-registry.json must export an object');
  }
  if (!Array.isArray(registry.apps) || !registry.apps.length) {
    throw new Error('app-registry.json requires a non-empty "apps" array');
  }
  if (!Array.isArray(registry.dockOrder) || !registry.dockOrder.length) {
    throw new Error('app-registry.json requires a non-empty "dockOrder" array');
  }
}

async function buildAppRegistry(validViewIds) {
  const registry = await readJson(APP_REGISTRY_PATH);
  ensureAppRegistryShape(registry);

  const seenIds = new Set();
  const seenViewIds = new Set();
  const seenIcons = new Set();
  const dockApps = [];
  const normalizedApps = [];

  for (const [index, rawApp] of registry.apps.entries()) {
    if (!rawApp || typeof rawApp !== 'object' || Array.isArray(rawApp)) {
      throw new Error(`Invalid app entry at index ${index} in app-registry.json`);
    }
    const id = String(rawApp.id || '').trim();
    const label = String(rawApp.label || '').trim();
    const viewId = String(rawApp.viewId || '').trim();
    const icon = String(rawApp.icon || '').trim();
    const placement = String(rawApp.placement || '').trim();
    const aliases = Array.isArray(rawApp.aliases)
      ? rawApp.aliases.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    const searchInputId = String(rawApp.searchInputId || '').trim();

    if (!id || !label || !viewId || !icon || !placement) {
      throw new Error(`App entry "${id || `index ${index}`}" is missing a required field`);
    }
    if (placement !== 'dock' && placement !== 'more') {
      throw new Error(`App "${id}" has unsupported placement "${placement}"`);
    }
    if (seenIds.has(id)) {
      throw new Error(`Duplicate app id in app-registry.json: ${id}`);
    }
    if (seenViewIds.has(viewId)) {
      throw new Error(`Duplicate app viewId in app-registry.json: ${viewId}`);
    }
    if (seenIcons.has(icon)) {
      throw new Error(`Duplicate app icon in app-registry.json: ${icon}`);
    }
    if (!validViewIds.has(viewId)) {
      throw new Error(`App "${id}" references unknown viewId "${viewId}"`);
    }

    const iconPath = path.join(ROOT_DIR, 'assets', 'icons', icon);
    let iconMarkup = '';
    try {
      await fs.access(iconPath);
      iconMarkup = (await fs.readFile(iconPath, 'utf8')).trim();
    } catch {
      throw new Error(`App "${id}" references missing icon "${iconPath}"`);
    }

    seenIds.add(id);
    seenViewIds.add(viewId);
    seenIcons.add(icon);

    const app = {
      id,
      label,
      viewId,
      icon,
      iconMarkup,
      placement,
      aliases,
      searchInputId
    };
    if (placement === 'dock') {
      dockApps.push(id);
    }
    normalizedApps.push(app);
  }

  const dockOrder = registry.dockOrder.map((value) => String(value || '').trim()).filter(Boolean);
  if (dockOrder.length !== dockApps.length) {
    throw new Error('dockOrder length must match the number of apps with placement "dock"');
  }
  const dockAppSet = new Set(dockApps);
  dockOrder.forEach((id) => {
    if (!seenIds.has(id)) {
      throw new Error(`dockOrder references unknown app id "${id}"`);
    }
    if (!dockAppSet.has(id)) {
      throw new Error(`dockOrder references app "${id}" but its placement is not "dock"`);
    }
  });
  dockApps.forEach((id) => {
    if (!dockOrder.includes(id)) {
      throw new Error(`App "${id}" is placed in the dock but missing from dockOrder`);
    }
  });

  const generated = [
    '/* AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY. */',
    `/* Source config: ${toPosix(path.relative(ROOT_DIR, APP_REGISTRY_PATH))} */`,
    '',
    `export const APP_REGISTRY = ${JSON.stringify(normalizedApps, null, 2)};`,
    '',
    `export const APP_DOCK_ORDER = ${JSON.stringify(dockOrder, null, 2)};`,
    ''
  ].join('\n');

  await writeText(APP_REGISTRY_MODULE_OUTPUT, generated);
  return normalizedApps;
}

function collectHtmlIds(htmlText) {
  const idCounts = new Map();
  const idRegex = /\bid="([^"]+)"/g;
  let match = idRegex.exec(htmlText);
  while (match) {
    const id = match[1];
    idCounts.set(id, (idCounts.get(id) || 0) + 1);
    match = idRegex.exec(htmlText);
  }
  return idCounts;
}

function ensureViewBlock({ id, file, contents }) {
  const expected = new RegExp(`<section\\s+id="${id}"`);
  if (!expected.test(contents)) {
    throw new Error(`View file ${file} does not contain expected section id: ${id}`);
  }
}

async function buildHtml() {
  const config = await readJson(HTML_CONFIG_PATH);
  const validViewIds = new Set((config.views || []).map((entry) => String(entry?.id || '').trim()).filter(Boolean));
  await buildAppRegistry(validViewIds);
  const shellStart = await readText(config.shellStart);
  const shellEnd = await readText(config.shellEnd);

  const viewParts = [];
  const seenViewIds = new Set();

  for (const entry of config.views || []) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('Invalid view entry in html-order.json');
    }
    const { id, file } = entry;
    if (!id || !file) {
      throw new Error('Each html view entry requires id and file');
    }
    if (seenViewIds.has(id)) {
      throw new Error(`Duplicate view id in html-order.json: ${id}`);
    }
    seenViewIds.add(id);
    const contents = await readText(file);
    ensureViewBlock({ id, file, contents });
    viewParts.push(`<!-- SOURCE: ${file} -->\n${contents.trimEnd()}\n`);
  }

  const autoHeader = [
    '<!-- AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY. -->',
    `<!-- Source config: ${toPosix(path.relative(ROOT_DIR, HTML_CONFIG_PATH))} -->`,
    ''
  ].join('\n');

  const html = `${autoHeader}${shellStart.trimEnd()}\n${viewParts.join('\n')}${shellEnd.trimStart()}`;

  const idCounts = collectHtmlIds(html);
  const duplicateIds = [...idCounts.entries()].filter(([, count]) => count > 1);
  if (duplicateIds.length) {
    const message = duplicateIds.map(([id, count]) => `${id} (${count})`).join(', ');
    throw new Error(`Duplicate HTML id attributes detected: ${message}`);
  }

  const missingViews = [...seenViewIds].filter((id) => !idCounts.has(id));
  if (missingViews.length) {
    throw new Error(`Generated HTML is missing required view ids: ${missingViews.join(', ')}`);
  }

  await writeText(config.output, html.endsWith('\n') ? html : `${html}\n`);
  return config.output;
}

async function buildCss() {
  const config = await readJson(CSS_CONFIG_PATH);
  const inputs = config.inputs || [];
  const seen = new Set();
  const importLines = [];

  for (const file of inputs) {
    if (!file || typeof file !== 'string') {
      throw new Error('Each CSS input entry must be a non-empty string');
    }
    if (seen.has(file)) {
      throw new Error(`Duplicate CSS input entry in css-order.json: ${file}`);
    }
    seen.add(file);

    // Validate source CSS exists/readable.
    await readText(file);

    const relativeImport = toPosix(path.relative(path.dirname(config.output), file));
    const importPath = relativeImport.startsWith('.') ? relativeImport : `./${relativeImport}`;
    importLines.push(`@import url("${importPath}");`);
  }

  const cssHeader = [
    '/* AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY. */',
    `/* Source config: ${toPosix(path.relative(ROOT_DIR, CSS_CONFIG_PATH))} */`,
    '/* Intentionally kept as an import manifest to reduce merge conflicts across branches. */',
    ''
  ].join('\n');

  const css = `${cssHeader}${importLines.join('\n')}\n`;
  await writeText(config.output, css.endsWith('\n') ? css : `${css}\n`);
  return config.output;
}

async function main() {
  const htmlOutput = await buildHtml();
  const cssOutput = await buildCss();
  console.log(`Built ${htmlOutput} and ${cssOutput}`);
}

main().catch((error) => {
  console.error('[build-ui] Failed:', error?.message || error);
  process.exit(1);
});
