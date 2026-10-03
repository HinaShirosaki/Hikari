'use strict';

const path = require('node:path');
const { constants } = require('node:fs');

const MAX_ICON_BYTES = 32 * 1024;

// SVGs are delivered as image data, never as markup in the host document.
// Keep file access inside the installed folder and bound the read, including
// for a symlink or a file that grows between stat and read.
async function readPluginIcon({ fs, folderPath, icon }) {
  if (icon === undefined || icon === '') return '';
  if (typeof icon !== 'string' || icon.length > 240
    || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*\.svg$/i.test(icon)
    || icon.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('"icon" must be a relative SVG file path inside the plugin folder.');
  }
  const root = await fs.realpath(folderPath);
  const target = await fs.realpath(path.join(root, icon));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error('Plugin icon must stay inside the plugin folder.');
  }
  const handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_ICON_BYTES) {
      throw new Error('Plugin icon must be a regular SVG file of at most 32 KiB.');
    }
    const buffer = Buffer.alloc(MAX_ICON_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, bytesRead);
    if (!bytesRead || bytesRead > MAX_ICON_BYTES || !/<svg(?:\s|>)/i.test(bytes.toString('utf8'))) {
      throw new Error('Plugin icon must contain an SVG image of at most 32 KiB.');
    }
    return `data:image/svg+xml;base64,${bytes.toString('base64')}`;
  } finally {
    await handle.close();
  }
}

module.exports = { readPluginIcon };
