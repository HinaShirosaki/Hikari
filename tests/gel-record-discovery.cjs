'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { discoverGelRecords } = require('../src/main/lib/plugin-files');

async function main() {
  const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'gel-recovery-'));
  try {
    const library = path.join(storagePath, 'Plugins/gel/Gels');
    for (const [name, data] of [['saved', { id: 'saved', name: 'Saved gel', sourceImagePath: '/old/root/source.png' }], ['analysis-only', { id: 'analysis', name: 'Older analysis' }], ['invalid', []]]) {
      const folder = path.join(library, name); await fs.mkdir(folder, { recursive: true });
      await fs.writeFile(path.join(folder, 'gel-record.json'), JSON.stringify(data));
      await fs.writeFile(path.join(folder, 'analysis-result.json'), '{}');
    }
    await fs.writeFile(path.join(library, 'saved/source.png'), 'original bytes');
    await fs.symlink(path.join(library, 'saved'), path.join(library, 'linked'));
    const found = await discoverGelRecords({ storagePath });
    assert.equal(found.records.length, 2, 'Recover image-backed and analysis-only records');
    assert.equal(found.warnings.length, 1, 'Report invalid metadata without losing readable records');
    const saved = found.records.find(record => record.id === 'saved');
    assert.equal(saved.sourceImagePath, 'Gels/saved/source.png', 'Recovery uses the artifact location actually found');
    assert.equal(saved.recordJsonPath, 'Gels/saved/gel-record.json');
    assert.equal(saved.analysisResultPath, 'Gels/saved/analysis-result.json');
    assert.equal(await fs.readFile(path.join(library, 'saved/source.png'), 'utf8'), 'original bytes', 'Recovery does not rewrite artifacts');
    assert.equal(found.records.some(record => record.storageFolder.includes('linked')), false, 'Do not follow symlinked artifact folders');
    await assert.rejects(discoverGelRecords({ storagePath: '.' }), /absolute storage/);
    const empty = path.join(storagePath, 'empty'); await fs.mkdir(empty);
    assert.deepEqual(await discoverGelRecords({ storagePath: empty }), { records: [], warnings: [] });
    const { VERBS } = await import('../src/renderer/app/plugin-bridge/verbs.js');
    const recovery = VERBS['migration.recoverStoredGel'];
    assert.equal(recovery.internal, true);
    assert.equal(recovery.bundledPluginId, 'gel');
    let called = false;
    const context = { state: { settings: { storagePath } }, plugin: { id: 'gel', bundled: true, path: '@bundled/gel' }, api: { discoverGelRecords: async data => { called = true; assert.equal(data.storagePath, storagePath); return { ok: true, ...found }; } } };
    assert.equal((await recovery.handler({}, context)).records.length, 2);
    assert.equal(called, true);
    await assert.rejects(recovery.handler({}, { ...context, plugin: { id: 'other', bundled: true } }), /bundled Gel/);
    console.log('gel-record-discovery: passed (recovery, current paths, analysis-only records, invalid metadata, symlinks, read-only artifacts, and bundled-plugin boundary)');
  } finally { await fs.rm(storagePath, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
