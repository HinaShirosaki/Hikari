'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readBuildLock(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lockPath = [path.join(root, 'package-lock.json'), path.join(root, 'bin', 'build-lock.json')]
    .find((candidate) => fs.existsSync(candidate));
  if (!lockPath) throw new Error('Missing Hikari build lock. Run npm pack from a checkout with package-lock.json.');
  const source = fs.readFileSync(lockPath, 'utf8');
  const lock = JSON.parse(source);
  const locked = lock.packages?.[''];
  if (lock.lockfileVersion !== 3 || locked?.name !== manifest.name || locked?.version !== manifest.version) {
    throw new Error('Hikari build lock does not match package.json. Update package-lock.json before packaging.');
  }
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const entries = (object) => JSON.stringify(Object.entries(object || {}).sort(([a], [b]) => a.localeCompare(b)));
    if (entries(manifest[field]) !== entries(locked[field])) {
      throw new Error(`Hikari build lock has outdated ${field}. Update package-lock.json before packaging.`);
    }
  }
  return source;
}

function preparePackage(root = path.join(__dirname, '..')) {
  fs.writeFileSync(path.join(root, 'bin', 'build-lock.json'), readBuildLock(root));
}

if (require.main === module) preparePackage();
module.exports = { preparePackage, readBuildLock };
