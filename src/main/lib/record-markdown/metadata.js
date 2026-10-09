'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const yaml = require('js-yaml');
const { isPathInside } = require('../path-safety');

class ImageReference {
  constructor(file, header) { this.file = file; this.header = header; }
}
const schema = yaml.JSON_SCHEMA.extend(new yaml.Type('!hikari/image', {
  kind: 'mapping', instanceOf: ImageReference,
  construct: value => new ImageReference(value?.file, `data:${value?.mediaType}${value?.encoding === 'base64' ? ';base64' : ''},`),
  represent: value => ({ file: value.file, mediaType: value.header.slice(5).replace(/(?:;base64)?,$/, ''), encoding: value.header.includes(';base64') ? 'base64' : 'uri' }),
  resolve: value => value && typeof value.file === 'string'
}));

const START = '<!-- hikari-record:v2\n';
const pattern = /^<!-- hikari-record:v2\r?\n([\s\S]*?)^-->[ \t]*(?:\r?\n|$)/gm;
const markdownPathFor = file => file.replace(/\.json(?:\.pending)?$/, '.md');
const legacyPathFor = file => file.replace(/\.md$/, '.json');
const escape = source => source.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescape = source => source.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// An image whose file is missing or changed loads as this placeholder and is
// saved back as its reference, so restoring the file brings the image back.
const UNAVAILABLE_IMAGE = 'hikari-image-unavailable:';

// A single Markdown rename commits prose and typed scientific state together.
// YAML lives in an invisible comment, without source-JSON dumps in the document.
function embedRecordMetadata(source, payload, kind, embeddedImages = new Map()) {
  const checkpoint = structuredClone(payload);
  const key = kind === 'protocol' ? 'protocol' : 'notebookEntry';
  delete checkpoint[key].markdownRevision;
  delete checkpoint[key].storageDocumentFile;
  function images(value) {
    if (typeof value === 'string' && embeddedImages.has(value)) return new ImageReference(embeddedImages.get(value), value.slice(0, value.indexOf(',') + 1));
    if (typeof value === 'string' && value.startsWith(UNAVAILABLE_IMAGE)) {
      const reference = value.slice(UNAVAILABLE_IMAGE.length);
      const split = reference.indexOf(',') + 1;
      return new ImageReference(reference.slice(split), reference.slice(0, split));
    }
    if (Array.isArray(value)) return value.map(images);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, images(item)]));
    return value;
  }
  const body = yaml.dump({ version: 2, kind, payload: images(checkpoint) }, { schema, noRefs: true, lineWidth: -1, skipInvalid: false });
  const metadata = `${START}${escape(body)}-->\n`;
  const clean = source.replace(pattern, '').replace(/^<!-- hikari-checkpoint:[a-f0-9-]+ -->\r?\n/gm, '');
  return clean.replace(/^(<!-- hikari-document:(?:protocol|notebook):v1 -->)\r?\n/m, (_match, marker) => `${marker}\n${metadata}`);
}

function readRecordMetadata(source) {
  const matches = [...source.matchAll(pattern)];
  if (!matches.length) {
    if (source.includes('<!-- hikari-record:')) throw new Error('Incomplete or unsupported Markdown record metadata');
    return null;
  }
  if (matches.length !== 1 || (source.match(/^<!-- hikari-record:/gm) || []).length !== 1) throw new Error('Duplicate Markdown record metadata');
  const value = yaml.load(unescape(matches[0][1]), { schema });
  const key = value?.kind === 'protocol' ? 'protocol' : 'notebookEntry';
  if (value?.version !== 2 || !['protocol', 'notebook'].includes(value.kind) || !value.payload?.[key]?.id) throw new Error('Invalid Markdown record metadata');
  const seen = new Set();
  function validate(item) {
    if (!item || typeof item !== 'object') return;
    if (seen.has(item)) throw new Error('Markdown record metadata cannot contain YAML aliases');
    seen.add(item);
    for (const child of Object.values(item)) validate(child);
  }
  validate(value);
  return value.payload;
}

async function readMarkdownCheckpoint(file, source, fallback) {
  const markdownPath = markdownPathFor(file);
  const text = source === undefined ? await fs.readFile(markdownPath, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; }) : source;
  if (text === null) return null;
  const data = readRecordMetadata(text);
  if (!data) return null;
  const folder = path.dirname(markdownPath);
  const actualFolder = await fs.realpath(folder);
  const fallbackImages = new Map();
  function collect(value) {
    if (typeof value === 'string' && /^data:image\//i.test(value)) {
      const match = /^data:image\/[a-z0-9.+-]+(;base64)?,([\s\S]*)$/i.exec(value);
      if (match) {
        const bytes = match[1] ? Buffer.from(match[2], 'base64') : Buffer.from(decodeURIComponent(match[2]), 'utf8');
        fallbackImages.set(createHash('sha256').update(bytes).digest('hex'), bytes);
      }
    } else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  }
  if (fallback) collect(fallback);
  const warnings = [];
  async function images(value) {
    if (value instanceof ImageReference) {
      try {
        if (!/^\.hikari-markdown\/[a-f0-9]{64}\.[a-z]+$/.test(value.file || '') || !/^data:image\/[a-z0-9.+-]+(?:;base64)?,$/i.test(value.header || '')) throw new Error('invalid image reference');
        let bytes;
        try {
          const file = await fs.realpath(path.join(folder, value.file));
          if (!isPathInside(actualFolder, file)) throw new Error('outside the document folder');
          bytes = await fs.readFile(file);
        } catch (error) {
          const hash = path.basename(value.file).split('.')[0];
          if (error.code !== 'ENOENT' || !fallbackImages.has(hash)) throw error;
          bytes = fallbackImages.get(hash);
        }
        if (createHash('sha256').update(bytes).digest('hex') !== path.basename(value.file).split('.')[0]) throw new Error('its content changed');
        return value.header + (value.header.includes(';base64') ? bytes.toString('base64') : encodeURIComponent(bytes.toString('utf8')));
      } catch (error) {
        // One unreadable image must not hide the whole record.
        warnings.push(`Image ${value.file} in ${markdownPath} is unavailable (${error.code === 'ENOENT' ? 'missing' : error.message}); the record loaded without it. Restore the file to bring the image back.`);
        return `${UNAVAILABLE_IMAGE}${value.header}${value.file}`;
      }
    }
    if (Array.isArray(value)) return Promise.all(value.map(images));
    if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await images(item)])));
    return value;
  }
  return { exists: true, ok: true, data: await images(data), source: text, standalone: true, error: '', warnings };
}

module.exports = { embedRecordMetadata, legacyPathFor, markdownPathFor, readMarkdownCheckpoint, readRecordMetadata };
