// Self-check for the sequence viewer's library folders.
//
// Every project gets a folder in the library rail and a real
// `Project/<Name>/DNA` directory; folders the user makes get a directory
// under `DNA/` instead. The parts that can break quietly are the
// rail rows and their directories: a rename must move one folder rather than
// leave two, a project row must not be renamed or deleted out from under its
// project, and a listing must not rewrite the database when nothing changed.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const libraryDir = path.join(projectRoot, 'src/renderer/modules/sequence-viewer/main-process/sequence-library');
const {
  deleteSequenceFolder,
  listSequenceEntries,
  upsertSequenceFolder
} = require(path.join(libraryDir, 'index.js'));

const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'hikari-seq-projects-'));
const sequenceDirFor = (folderName) => path.join(storagePath, 'Project', folderName, 'DNA');
const libraryDirFor = (folderName) => path.join(storagePath, 'DNA', folderName);
const exists = (target) => fs.stat(target).then(() => true, () => false);
const railNames = (result) => result.folders.map((folder) => folder.name).sort();

try {
  // A project's folder shows up in the rail and on disk.
  let listed = await listSequenceEntries({
    storagePath,
    projects: [{ id: 'p1', name: 'Gene Editing' }, { id: 'p2', name: 'Assay Dev' }]
  });
  assert.deepEqual(railNames(listed), ['Assay Dev', 'Gene Editing']);
  assert.ok((await fs.stat(sequenceDirFor('Gene_Editing'))).isDirectory());
  assert.ok((await fs.stat(sequenceDirFor('Assay_Dev'))).isDirectory());

  const originalRowId = listed.folders.find((folder) => folder.name === 'Gene Editing').id;

  // Renaming a project renames its existing row rather than adding a second
  // one, so sequences filed under it stay put.
  listed = await listSequenceEntries({
    storagePath,
    projects: [{ id: 'p1', name: 'Gene Editing v2' }, { id: 'p2', name: 'Assay Dev' }]
  });
  assert.deepEqual(railNames(listed), ['Assay Dev', 'Gene Editing v2']);
  assert.equal(listed.folders.find((folder) => folder.name === 'Gene Editing v2').id, originalRowId);

  // A hand-made folder keeps its name; the project does not overwrite it (the
  // name column is UNIQUE, so a blind upsert would throw).
  await upsertSequenceFolder({ storagePath, name: 'Cloning' });
  listed = await listSequenceEntries({ storagePath, projects: [{ id: 'p3', name: 'Cloning' }] });
  assert.deepEqual(railNames(listed), ['Assay Dev', 'Cloning', 'Gene Editing v2']);
  assert.ok(!listed.folders.some((folder) => folder.id === 'project:p3'));

  // Projects unchanged since the last listing must not rewrite the sqlite file.
  const sqlitePath = listed.sqlitePath;
  const before = (await fs.stat(sqlitePath)).mtimeMs;
  await new Promise((resolve) => { setTimeout(resolve, 20); });
  await listSequenceEntries({ storagePath, projects: [{ id: 'p2', name: 'Assay Dev' }] });
  assert.equal((await fs.stat(sqlitePath)).mtimeMs, before);

  // No projects: nothing added, nothing dropped.
  listed = await listSequenceEntries({ storagePath, projects: [] });
  assert.deepEqual(railNames(listed), ['Assay Dev', 'Cloning', 'Gene Editing v2']);

  // A user folder lives under SequenceViewer. The project of the same name
  // still owns its own `Project/Cloning/DNA`; only the rail row is skipped,
  // because the two directories have different owners.
  assert.ok(await exists(libraryDirFor('Cloning')));
  assert.ok(await exists(sequenceDirFor('Cloning')));

  // The rail creates a folder then renames it inline, so the rename has to move
  // the directory instead of leaving the placeholder behind.
  const draft = await upsertSequenceFolder({ storagePath, name: 'New Folder' });
  await fs.writeFile(path.join(libraryDirFor('New_Folder'), 'note.txt'), 'kept', 'utf8');
  await upsertSequenceFolder({ storagePath, id: draft.folder.id, name: 'Golden Gate' });
  assert.ok(!await exists(libraryDirFor('New_Folder')));
  assert.equal(await fs.readFile(path.join(libraryDirFor('Golden_Gate'), 'note.txt'), 'utf8'), 'kept');

  // Names the library uses for its own files are refused.
  await assert.rejects(
    upsertSequenceFolder({ storagePath, name: 'entries' }),
    /reserved/i
  );
  assert.ok(await exists(path.join(storagePath, 'DNA', 'entries')));

  // A project row is owned by its project; renaming or deleting it in the rail
  // would just be undone by the next listing, so both are refused.
  const projectRow = (await listSequenceEntries({
    storagePath,
    projects: [{ id: 'p1', name: 'Gene Editing v2' }]
  })).folders.find((folder) => folder.id === originalRowId);
  assert.ok(projectRow);
  await assert.rejects(
    upsertSequenceFolder({ storagePath, id: originalRowId, name: 'Renamed' }),
    /project/i
  );
  await assert.rejects(deleteSequenceFolder({ storagePath, id: originalRowId }), /project/i);

  // Deleting a user folder drops an empty directory but keeps one holding files.
  const empty = await upsertSequenceFolder({ storagePath, name: 'Scratch' });
  await deleteSequenceFolder({ storagePath, id: empty.folder.id });
  assert.ok(!await exists(libraryDirFor('Scratch')));

  const kept = (await listSequenceEntries({ storagePath, projects: [] }))
    .folders.find((folder) => folder.name === 'Golden Gate');
  await deleteSequenceFolder({ storagePath, id: kept.id });
  assert.equal(await fs.readFile(path.join(libraryDirFor('Golden_Gate'), 'note.txt'), 'utf8'), 'kept');

  console.log('sequence-project-folders-selfcheck: ok');
} finally {
  await fs.rm(storagePath, { recursive: true, force: true });
}
