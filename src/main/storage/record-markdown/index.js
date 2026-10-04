'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { writeFileAtomic } = require('../../lib/shared-json-file');
const { array, inline, label, object, section } = require('./format');
const { notebookContext, resolveLocalPath } = require('./context');
const { GENERATED_MARKER, renderNotebook, renderProtocol } = require('./render');
const { derivedBlock, documentMarker, preserveDocument } = require('./document-fields');
const { checkpointMarker } = require('../../lib/record-markdown/checkpoint');

const ASSET_FOLDER = '.hikari-markdown';
const IMAGE_EXTENSIONS = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/avif': 'avif', 'image/tiff': 'tiff',
  'image/heic': 'heic', 'image/heif': 'heif'
};

// Editors may add a BOM or front matter above the marker line; the document
// stays Hikari's, as it is for the reader.
const isGeneratedMarkdown = source => source.replace(/^\uFEFF/, '').split(/\r?\n/).includes(GENERATED_MARKER);

async function existingMarkdown(filePath) {
  try {
    const source = await fs.readFile(filePath, 'utf8');
    if (!isGeneratedMarkdown(source)) {
      throw new Error(`Cannot regenerate ${filePath}: it contains user-owned Markdown. Move or rename it first.`);
    }
    return source;
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

function collectImages(sources) {
  const embeddedImages = new Map();
  const assets = new Map();
  function walk(value, key = '') {
    if (typeof value === 'string') {
      const match = /^data:(image\/[a-z0-9.+-]+)(;base64)?,([\s\S]*)$/i.exec(value);
      const extension = match && IMAGE_EXTENSIONS[match[1].toLowerCase()];
      if (!extension) return;
      let bytes;
      try {
        if (match[2] && !/^[a-z0-9+/\s]*={0,2}$/i.test(match[3])) return;
        bytes = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]), 'utf8');
      } catch { return; }
      if (!bytes.length) return;
      const hash = createHash('sha256').update(bytes).digest('hex');
      const name = `${hash}.${extension}`;
      const relativePath = `${ASSET_FOLDER}/${name}`;
      embeddedImages.set(value, relativePath);
      const asset = assets.get(name) || { name, bytes, labels: [] };
      asset.labels.push(key);
      assets.set(name, asset);
    } else if (value && typeof value === 'object') {
      for (const [field, item] of Object.entries(value)) walk(item, key ? `${key}.${field}` : field);
    }
  }
  sources.forEach(source => walk(source));
  return { assets, embeddedImages };
}

async function missingFiles(sources, storageRoot) {
  const candidates = new Set();
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string' && /^(?:path|relativePath)$|(?:Path|RelativePath)$/.test(key)) {
        const resolved = resolveLocalPath(item, storageRoot);
        if (resolved) candidates.add(resolved);
      } else if (item && typeof item === 'object') walk(item);
    }
  }
  sources.forEach(walk);
  const unavailable = new Set();
  await Promise.all([...candidates].map(async file => {
    if (!await fs.stat(file).then(stat => stat.isFile(), () => false)) unavailable.add(file);
  }));
  return unavailable;
}

async function writeImages(folderPath, assets, previous) {
  if (!assets.size && !previous.generator) return;
  const assetFolder = path.join(folderPath, ASSET_FOLDER);
  const stat = await fs.lstat(assetFolder).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error(`Expected an ordinary generated image directory: ${assetFolder}`);
  if (!stat) await fs.mkdir(assetFolder, { recursive: true });
  for (const asset of assets.values()) {
    const filePath = path.join(assetFolder, asset.name);
    let current;
    try { current = await fs.readFile(filePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!current?.equals(asset.bytes)) await writeFileAtomic(fs, filePath, asset.bytes);
  }
  return { assetFolder, previous };
}

async function finishImages(state, assets) {
  if (!state) return;
  const { assetFolder, previous } = state;
  const manifest = { generator: GENERATED_MARKER, files: [...assets.keys()] };
  if (JSON.stringify(manifest) !== JSON.stringify(previous)) {
    await writeFileAtomic(fs, path.join(assetFolder, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }
  if (previous.generator === GENERATED_MARKER) {
    for (const name of array(previous.files)) {
      if (/^[a-f0-9]{64}\.[a-z]+$/.test(name) && !assets.has(name)) await fs.rm(path.join(assetFolder, name), { force: true });
    }
  }
}

// Rendering only reads, so a caller can compare the result before writing.
async function renderRecordMarkdown({ filePath, payload, kind, snapshot = {}, storageRoot, canonical = false, expectedSource }) {
  const folderPath = path.dirname(filePath);
  const markdownPath = path.join(folderPath, kind === 'protocol' ? 'protocol.md' : 'page.md');
  // A writer passes the Markdown it already read; commit re-checks it before writing.
  const previous = expectedSource ?? await existingMarkdown(markdownPath);
  const linked = kind === 'notebook' ? await notebookContext(object(payload.notebookEntry), snapshot, storageRoot) : null;
  const sources = [payload, ...(linked ? [linked] : [])];
  const images = collectImages(sources);
  const options = { folderPath, storageRoot, canonical, missingFiles: await missingFiles(sources, storageRoot), usedImageTargets: new Set(), ...images };
  let markdown = kind === 'protocol' ? renderProtocol(payload, options) : renderNotebook(payload, linked, options);
  const imageSection = section('Images', [...images.assets.values()].filter(asset => !options.usedImageTargets.has(`${ASSET_FOLDER}/${asset.name}`)).map(asset => {
    const names = asset.labels.map(key => label(key.split('.').filter(part => !/^\d+$/.test(part)).at(-1) || 'Image'));
    return `![${inline([...new Set(names)].join(', '))}](<${ASSET_FOLDER}/${asset.name}>)`;
  }).join('\n\n'));
  markdown += canonical ? derivedBlock('images', imageSection) : imageSection;
  if (previous.includes(documentMarker(kind))) {
    if (!canonical) throw new Error(`Cannot regenerate a migrated document as an export: ${markdownPath}`);
    markdown = preserveDocument(previous, markdown);
  }
  const manifest = await fs.readFile(path.join(folderPath, ASSET_FOLDER, 'manifest.json'), 'utf8')
    .then(JSON.parse, error => { if (error.code === 'ENOENT') return {}; throw error; });
  // Manual annotations can reference extracted images; keep those assets too.
  if (canonical) {
    for (const name of array(manifest.files)) {
      if (/^[a-f0-9]{64}\.[a-z]+$/.test(name) && markdown.includes(`${ASSET_FOLDER}/${name}`) && !images.assets.has(name)) {
        images.assets.set(name, { name, bytes: await fs.readFile(path.join(folderPath, ASSET_FOLDER, name)), labels: [] });
      }
    }
  }
  return { folderPath, markdownPath, previous, markdown, assets: images.assets, manifest };
}

async function commitRecordMarkdown({ folderPath, markdownPath, previous, markdown, assets, manifest }, { kind, canonical = false, transaction }) {
  if (transaction) {
    markdown = markdown.replace(/^<!-- hikari-checkpoint:[a-f0-9-]+ -->\r?\n/gm, '')
      .replace(documentMarker(kind), `${documentMarker(kind)}\n${checkpointMarker(transaction)}`);
  }
  const imageState = await writeImages(folderPath, assets, manifest);
  if (markdown !== previous) {
    if (canonical && await existingMarkdown(markdownPath) !== previous) throw new Error(`Markdown changed while saving ${markdownPath}`);
    await writeFileAtomic(fs, markdownPath, markdown);
  }
  await finishImages(imageState, assets);
  return markdownPath;
}

async function writeRecordMarkdown(input) {
  return commitRecordMarkdown(await renderRecordMarkdown(input), input);
}

async function removeGeneratedMarkdown(recordPath) {
  const markdownPath = recordPath.replace(/\.json$/, '.md');
  try {
    const source = await fs.readFile(markdownPath, 'utf8');
    if (isGeneratedMarkdown(source)) {
      await fs.rm(markdownPath, { force: true });
      const assetFolder = path.join(path.dirname(markdownPath), ASSET_FOLDER);
      try {
        if ((await fs.lstat(assetFolder)).isSymbolicLink()) return;
        const manifest = JSON.parse(await fs.readFile(path.join(assetFolder, 'manifest.json'), 'utf8'));
        if (manifest.generator === GENERATED_MARKER) {
          for (const name of array(manifest.files)) {
            if (/^[a-f0-9]{64}\.[a-z]+$/.test(name)) await fs.rm(path.join(assetFolder, name), { force: true });
          }
          await fs.rm(path.join(assetFolder, 'manifest.json'), { force: true });
          await fs.rmdir(assetFolder).catch(() => {});
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function writeRecordMarkdownSafely(input, warnings) {
  try {
    return await writeRecordMarkdown(input);
  } catch (error) {
    const warning = `Markdown generation failed for ${input.filePath}: ${error.message}`;
    warnings.push(warning);
    console.warn(warning);
    return '';
  }
}

async function removeGeneratedMarkdownSafely(recordPath, warnings) {
  try { await removeGeneratedMarkdown(recordPath); }
  catch (error) {
    const warning = `Markdown cleanup failed for ${recordPath}: ${error.message}`;
    warnings.push(warning);
    console.warn(warning);
  }
}

module.exports = { GENERATED_MARKER, commitRecordMarkdown, existingMarkdown, renderRecordMarkdown, writeRecordMarkdown, writeRecordMarkdownSafely, removeGeneratedMarkdownSafely };
