#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const CSS_DIR = path.join(ROOT_DIR, 'ui', 'css');
const CSS_ORDER_PATH = path.join(ROOT_DIR, 'ui', 'config', 'css-order.json');
const COLOR_LITERAL_PATTERN = /#[0-9a-f]{3,8}\b|rgba?\s*\(|hsla?\s*\(/i;
// A declaration starts at the beginning of a line (after whitespace); a BEM
// modifier such as `.rail--pinned:has(...)` inside a selector must not match.
const CUSTOM_PROPERTY_PATTERN = /^\s*(--[a-zA-Z0-9_-]+)\s*:/gm;
const CUSTOM_PROPERTY_VAR_PATTERN = /var\(\s*(--[a-zA-Z0-9_-]+)/g;
const CUSTOM_PROPERTY_SCRIPT_PATTERN = /(?:setProperty|getPropertyValue)\(\s*['"](--[a-zA-Z0-9_-]+)['"]/g;

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

async function listCssFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listCssFiles(absolutePath));
    } else if (entry.isFile() && entry.name.endsWith('.css')) {
      files.push(absolutePath);
    }
  }

  return files.sort();
}

async function listTextFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listTextFiles(absolutePath));
    } else if (entry.isFile() && /\.(?:html|js|mjs)$/.test(entry.name)) {
      files.push(absolutePath);
    }
  }

  return files;
}

function modulePrefixForPalette(filePath) {
  const fileName = path.basename(filePath);
  if (fileName === 'palette.css') {
    return '--theme-';
  }
  return `--${fileName.replace(/-palette\.css$/, '')}-`;
}

const cssFiles = await listCssFiles(CSS_DIR);
const paletteFiles = cssFiles.filter((filePath) => path.basename(filePath).endsWith('palette.css'));
const paletteSet = new Set(paletteFiles);
const errors = [];
const customPropertyDeclarations = new Map();
const customPropertyReferences = new Set();

for (const filePath of cssFiles) {
  const relativePath = toPosix(path.relative(ROOT_DIR, filePath));
  const source = stripComments(await fs.readFile(filePath, 'utf8'));

  if (source.includes('--palette-')) {
    errors.push(`${relativePath}: legacy --palette-* aliases are not allowed`);
  }

  if (!paletteSet.has(filePath) && COLOR_LITERAL_PATTERN.test(source)) {
    errors.push(`${relativePath}: raw color literals must move to a module palette`);
  }

  if (paletteSet.has(filePath)) {
    const expectedPrefix = modulePrefixForPalette(filePath);
    for (const match of source.matchAll(CUSTOM_PROPERTY_PATTERN)) {
      if (!match[1].startsWith(expectedPrefix)) {
        errors.push(`${relativePath}: ${match[1]} must use the ${expectedPrefix} prefix`);
      }
    }
  }


  for (const match of source.matchAll(CUSTOM_PROPERTY_PATTERN)) {
    const owners = customPropertyDeclarations.get(match[1]) || new Set();
    owners.add(relativePath);
    customPropertyDeclarations.set(match[1], owners);
  }
  for (const match of source.matchAll(CUSTOM_PROPERTY_VAR_PATTERN)) {
    customPropertyReferences.add(match[1]);
  }
}

const runtimeTextFiles = [
  ...await listTextFiles(path.join(ROOT_DIR, 'src')),
  ...await listTextFiles(path.join(ROOT_DIR, 'ui', 'html'))
];
for (const filePath of runtimeTextFiles) {
  const source = stripComments(await fs.readFile(filePath, 'utf8'));
  for (const match of source.matchAll(CUSTOM_PROPERTY_SCRIPT_PATTERN)) {
    customPropertyReferences.add(match[1]);
  }
}

for (const [propertyName, owners] of customPropertyDeclarations) {
  if (!customPropertyReferences.has(propertyName)) {
    errors.push(`${[...owners].join(', ')}: ${propertyName} is declared but never consumed`);
  }
}

const cssOrder = JSON.parse(await fs.readFile(CSS_ORDER_PATH, 'utf8'));
const prefixInputs = new Set(cssOrder.prefixInputs || []);
for (const filePath of paletteFiles) {
  const relativePath = toPosix(path.relative(ROOT_DIR, filePath));
  if (!prefixInputs.has(relativePath)) {
    errors.push(`${relativePath}: palette files must be listed in css-order.json prefixInputs`);
  }
}

if (errors.length) {
  console.error('CSS color contract failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(`CSS color contract passed: ${paletteFiles.length} palettes, no raw colors or unused custom properties.`);
}
