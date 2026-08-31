import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT_DIR } from './paths.mjs';

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

export {
  readJson,
  readText,
  toPosix,
  writeText
};
