import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { i18n } from '../src/renderer/lib/i18n/index.js';
import { buildPrimerResultTable } from '../src/renderer/modules/sequence-viewer/cloning-design-notebook/result-text.js';
import { buildProteinBuilderPrimerResultTable } from '../src/renderer/modules/sequence-viewer/protein-builder-cloning/result-text.js';
import { flushMarkdownRecordState, hasPendingMarkdownSaves } from '../src/renderer/services/markdown-record-storage.js';

const require = createRequire(import.meta.url);
const { createMainDataHelpers } = require('../src/main/data/data-helpers.js');
const { syncBundleFromSnapshot } = require('../src/main/storage/storage-sidecars.js');
const { importStorageRoot } = require('../src/main/storage/storage-import.js');
const primers = [{ name: 'Mutagenesis_F', role: 'mutagenesis-forward', sequence: 'ACGT'.repeat(6), length: 24,
  tm: 62.5, gcContent: 50, groupLabel: 'PCR 1', warnings: ['Check annealing'], qualityWarnings: [] }];
const builders = [
  ['Sequence Viewer', () => buildPrimerResultTable(primers)],
  ['Protein Builder', () => buildProteinBuilderPrimerResultTable({ primerOligoPlan: { primers } })]
];

for (const [name, build] of builders) {
  test(`${name} primer tables contain translated text that survives cloning and JSON storage`, () => {
    try {
      for (const locale of ['en', 'es', 'zh-Hans', 'zh-Hant', 'ja']) {
        i18n.setLocale(locale);
        const table = build();
        assert.deepEqual(structuredClone(table), table);
        assert.deepEqual(JSON.parse(JSON.stringify(table)), table);
        assert.ok(table.columns.every(column => typeof column.title === 'string' && !column.title.includes('<span')));
        assert.equal(table.rows[0].sequence, primers[0].sequence);
        assert.equal(table.rows[0].notes, 'Check annealing');
      }
    } finally { i18n.setLocale('en'); }
  });
}

test('generated primer tables and already-affected pages save and reload without losing recorded data', async () => {
  const root = await fs.mkdtemp('/private/tmp/hikari-primer-storage-');
  try {
    const legacy = buildPrimerResultTable(primers);
    let formatterCalls = 0;
    legacy.columns[0].titleFormatter = () => { formatterCalls++; return 'PCR Step'; };
    legacy.columns[0].headerTooltip = legacy.columns[0].titleFormatter;
    const tables = [...builders.map(([, build]) => build()), legacy];
    const entries = tables.map((table, index) => ({
      id: `primer-page-${index}`, notebookType: 'biology', projectId: 'p', projectName: 'Primer storage',
      experimentName: `Primer page ${index}`, result: 'Recorded notes 🧪\nKeep the primer sequences and table cells.',
      resultTable: table, resultTables: [table],
      toolCalculations: [{ id: 'reaction', table: { headers: ['Item', 'Volume'], rows: [['Water', '20 µL']] } }],
      resultFiles: ['recorded.png'], resultFileRecords: [{ name: 'recorded.png', relativePath: 'Attachments/recorded.png' }],
      updatedAt: '2026-11-02T00:00:00.000Z'
    }));
    const state = { settings: { storagePath: root }, projects: [{ id: 'p', name: 'Primer storage' }], protocols: [], notebookEntries: entries };
    assert.throws(() => structuredClone(state), /clone/);
    const expected = JSON.parse(JSON.stringify(entries));
    const helpers = createMainDataHelpers({ fs, path, syncBundleFromSnapshot, hasSupportedDataExtension: () => true,
      getDefaultDataFilePath: () => path.join(root, 'hikari-data.json') });
    const api = { autoSaveDataFile: snapshot => {
      assert.deepEqual(structuredClone(snapshot), snapshot, 'the IPC snapshot contains only cloneable data');
      return helpers.autoSaveDataFile({ data: snapshot });
    } };
    await flushMarkdownRecordState(api, state);
    assert.equal(hasPendingMarkdownSaves(), false);
    assert.equal(formatterCalls, 0, 'storage never runs UI callbacks');
    const reloaded = await importStorageRoot({ storagePath: root });
    assert.ok(reloaded.statePatch?.notebookEntries);
    for (const original of expected) {
      const saved = reloaded.statePatch.notebookEntries.find(entry => entry.id === original.id);
      assert.ok(saved);
      for (const field of ['result', 'resultTable', 'resultTables', 'toolCalculations', 'resultFiles', 'resultFileRecords']) {
        assert.deepEqual(saved[field], original[field], `${original.id}: ${field}`);
      }
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
