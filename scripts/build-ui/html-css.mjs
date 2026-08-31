import path from 'node:path';
import { readJson, readText, toPosix, writeText } from './fs-helpers.mjs';
import { CSS_CONFIG_PATH, HTML_CONFIG_PATH, ROOT_DIR } from './paths.mjs';

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

async function buildHtml(views) {
  const config = await readJson(HTML_CONFIG_PATH);
  const shellStart = await readText(config.shellStart);
  const shellEnd = await readText(config.shellEnd);

  const viewParts = [];
  const seenViewIds = new Set();

  for (const entry of views) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('Invalid view entry in html-order.json');
    }
    const { viewId: id, file } = entry;
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

async function buildCss(views) {
  const config = await readJson(CSS_CONFIG_PATH);
  const viewInputs = views.map((view) => view.styleFile).filter(Boolean);
  const inputs = [
    ...(config.prefixInputs || []),
    ...viewInputs,
    ...(config.suffixInputs || [])
  ];
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

export {
  buildCss,
  buildHtml
};
