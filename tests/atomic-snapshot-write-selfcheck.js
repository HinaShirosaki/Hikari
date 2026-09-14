#!/usr/bin/env node
// Self-check for the atomic snapshot write: a save that dies mid-write must
// leave the previous .json intact, and a good save must leave no .tmp behind.
// Run: node tests/atomic-snapshot-write-selfcheck.js
const assert = require('node:assert/strict');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createMainDataHelpers } = require(path.join(__dirname, '..', 'src/main/data/data-helpers.js'));

async function main() {
  const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'hikari-atomic-'));
  const dataFilePath = path.join(dir, 'hikari-data.json');
  try {
    const helpers = createMainDataHelpers({
      fs: fsPromises,
      path,
      hasSupportedDataExtension: (p) => /\.json$/i.test(p),
      getDefaultDataFilePath: () => dataFilePath
    });

    // --- a good save lands whole and leaves no temp file ---
    const first = await helpers.saveSelectedDataFile({ data: { protocols: [{ id: 'p1' }] }, filePath: dataFilePath });
    assert.equal(first.ok, true, first.error);
    assert.deepEqual(JSON.parse(await fsPromises.readFile(dataFilePath, 'utf8')).protocols, [{ id: 'p1' }]);
    assert.deepEqual(await fsPromises.readdir(dir), ['hikari-data.json']);

    // --- a write that dies half way leaves the previous snapshot untouched ---
    const dyingFs = {
      ...fsPromises,
      writeFile: async (target, text) => {
        await fsPromises.writeFile(target, text.slice(0, 20), 'utf8');
        throw new Error('power loss');
      }
    };
    const fragile = createMainDataHelpers({
      fs: dyingFs,
      path,
      hasSupportedDataExtension: (p) => /\.json$/i.test(p),
      getDefaultDataFilePath: () => dataFilePath
    });
    const second = await fragile.saveSelectedDataFile({ data: { protocols: [{ id: 'p2' }] }, filePath: dataFilePath });
    assert.equal(second.ok, false);
    assert.match(second.error, /power loss/);
    assert.deepEqual(JSON.parse(await fsPromises.readFile(dataFilePath, 'utf8')).protocols, [{ id: 'p1' }]);

    // --- the next good save recovers, replacing the stale .tmp ---
    const third = await helpers.saveSelectedDataFile({ data: { protocols: [{ id: 'p3' }] }, filePath: dataFilePath });
    assert.equal(third.ok, true, third.error);
    assert.deepEqual(JSON.parse(await fsPromises.readFile(dataFilePath, 'utf8')).protocols, [{ id: 'p3' }]);
    assert.deepEqual(await fsPromises.readdir(dir), ['hikari-data.json']);

    console.log('atomic-snapshot-write selfcheck: ok');
  } finally {
    await fsPromises.rm(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
