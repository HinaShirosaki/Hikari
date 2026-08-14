import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  NOTEBOOK_MEMORY_MODEL_FALLBACK,
  PROJECT_MEMORY_AUTO_END,
  PROJECT_MEMORY_AUTO_START,
  buildNotebookConclusionRequest,
  collectProjectMemoryRecords,
  mergeProjectMemoryMarkdown,
  waitForProjectMemoryQueue,
  writeProjectMemoryFile
} = require('../src/main/storage/storage-memory.js');
const { importStorageRoot } = require('../src/main/storage/storage-import.js');

function countOccurrences(text, needle) {
  return String(text || '').split(needle).length - 1;
}

function sectionLines(markdown, heading, nextHeading) {
  const source = String(markdown || '');
  const startMarker = `${heading}\n`;
  const start = source.indexOf(startMarker);
  const end = start >= 0 ? source.indexOf(`\n${nextHeading}`, start + startMarker.length) : -1;
  assert.notEqual(start, -1, `missing section: ${heading}`);
  assert.notEqual(end, -1, `missing section after ${heading}: ${nextHeading}`);
  return source
    .slice(start + startMarker.length, end)
    .split('\n')
    .filter(Boolean);
}

function pagePayload(entry) {
  return JSON.stringify({
    schema_name: 'hikari_notebook_pages',
    schema_version: '1.0.0',
    updated_at: entry.updatedAt,
    notebookEntry: {
      ...entry,
      storageFolder: ''
    }
  }, null, 2);
}

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hikari-project-memory-'));
try {
  const projectFolder = path.join(tempDir, 'Project', 'Atlas');
  const memoryPath = path.join(projectFolder, 'MEMORY.md');
  await fs.mkdir(projectFolder, { recursive: true });

  const originalUserText = [
    '## User Notes',
    'Keep this exact sentence.',
    'Second line with  two  spaces.',
    'Name: Control sample',
    'ID: tube-7',
    'Description: Bench note only.'
  ].join('\n');
  const firstManaged = [
    '# Project Memory',
    '',
    'Name: Atlas',
    'ID: project-1',
    'Description: First description.',
    'Created: 2026-07-01T00:00:00.000Z',
    'Updated: 2026-07-02T00:00:00.000Z'
  ].join('\n');
  const initial = `${mergeProjectMemoryMarkdown('', firstManaged)}\n\n${originalUserText}`;
  const secondManaged = firstManaged.replace('First description.', 'Updated description.');
  const merged = mergeProjectMemoryMarkdown(initial, secondManaged);
  assert.equal(countOccurrences(merged, PROJECT_MEMORY_AUTO_START), 1);
  assert.equal(countOccurrences(merged, PROJECT_MEMORY_AUTO_END), 1);
  assert.equal(merged.slice(merged.indexOf('## User Notes')), originalUserText);
  assert.match(merged, /Description: Updated description\./);

  const markerFree = `# Lab Notes\n\n${originalUserText}`;
  const prepended = mergeProjectMemoryMarkdown(markerFree, secondManaged);
  assert.equal(prepended.slice(prepended.indexOf('# Lab Notes')), markerFree);

  const legacy = [
    '# Project Memory',
    '',
    'Name: Atlas',
    'Folder: Atlas',
    'ID: project-1',
    'Description: Legacy.',
    'Created: 2026-07-01T00:00:00.000Z',
    'Updated: 2026-07-02T00:00:00.000Z',
    '',
    '## Linked Records',
    '- Notebook pages: 0',
    '- Workflows: 0',
    '- Papers: 0',
    '- Assays: 0',
    '- Gel analyses: 0',
    '',
    '## Notes',
    '- Auto-generated from Hikari storage metadata.',
    '- Update the project record in the app to refresh this summary.',
    '',
    originalUserText
  ].join('\n');
  const migrated = mergeProjectMemoryMarkdown(legacy, secondManaged);
  assert.equal(countOccurrences(migrated, PROJECT_MEMORY_AUTO_START), 1);
  assert.equal(migrated.slice(migrated.indexOf('## User Notes')), originalUserText);

  await fs.writeFile(memoryPath, merged, 'utf8');
  const imported = await importStorageRoot({ storagePath: tempDir });
  const hydratedProject = imported.statePatch.projects.find((project) => project.id === 'project-1');
  assert.equal(hydratedProject?.name, 'Atlas');
  assert.equal(hydratedProject?.description, 'Updated description.');

  const notebookFolder = path.join(projectFolder, 'Notebook', 'Protein_Yield__note-1');
  const pagePath = path.join(notebookFolder, 'page.json');
  const entry = {
    id: 'note-1',
    notebookType: 'biology',
    notebookState: 'executed',
    projectId: 'project-1',
    projectName: 'Atlas',
    protocolId: 'protocol-1',
    protocolName: 'Protein Yield',
    experimentName: 'Protein Yield Run',
    result: 'Yield increased to 42 mg after purification.',
    resultTables: [],
    updatedAt: '2026-07-03T00:00:00.000Z',
    createdAt: '2026-07-03T00:00:00.000Z',
    storageFolder: notebookFolder
  };
  await fs.mkdir(notebookFolder, { recursive: true });
  await fs.writeFile(pagePath, pagePayload(entry), 'utf8');

  const snapshot = {
    projects: [{
      id: 'project-1',
      name: 'Atlas',
      description: 'Updated description.',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-03T00:00:00.000Z'
    }],
    notebookEntries: [entry],
    papers: [],
    workflows: [],
    assays: [],
    gelAnalyses: []
  };
  const projectRecord = collectProjectMemoryRecords(snapshot)[0];
  const conclusionRequest = buildNotebookConclusionRequest({
    id: entry.id,
    title: entry.experimentName,
    protocolName: entry.protocolName,
    corpus: entry.result
  });
  assert.deepEqual(conclusionRequest.schema.required, ['conclusion', 'quotes']);
  assert.match(conclusionRequest.prompt, /one concise, single-line experimental conclusion/);
  assert.match(conclusionRequest.prompt, /one sentence with no newline characters or Markdown/);
  assert.match(conclusionRequest.prompt, /exactly two JSON fields: "conclusion".*"quotes"/);
  let modelCalls = 0;
  const validGenerator = async () => {
    modelCalls += 1;
    return {
      ok: true,
      model: 'test-mini',
      payload: {
        conclusion: 'Purification produced a recorded yield of 42 mg.',
        supporting_quotes: ['"Yield increased to 42 mg after purification."']
      }
    };
  };

  await writeProjectMemoryFile({
    storageRootPath: tempDir,
    folderPath: projectFolder,
    snapshot,
    projectRecord,
    requestNotebookConclusion: validGenerator
  });
  await waitForProjectMemoryQueue(projectFolder);
  assert.equal(modelCalls, 1);

  await writeProjectMemoryFile({
    storageRootPath: tempDir,
    folderPath: projectFolder,
    snapshot,
    projectRecord,
    requestNotebookConclusion: validGenerator
  });
  await waitForProjectMemoryQueue(projectFolder);
  assert.equal(modelCalls, 1);

  const generatedMemory = await fs.readFile(memoryPath, 'utf8');
  assert.equal(generatedMemory.includes('## Linked Records'), false);
  assert.equal(generatedMemory.includes('- Notebook pages:'), false);
  assert.equal(generatedMemory.includes('## Memory Sync'), false);
  assert.equal(generatedMemory.includes('- Fallback extracts:'), false);
  assert.equal(generatedMemory.includes('\nID: project-1\n'), false);
  assert.equal(generatedMemory.includes('\nFolder: Atlas\n'), false);
  const generatedNotebookLines = sectionLines(
    generatedMemory,
    '## Experimental Conclusions',
    PROJECT_MEMORY_AUTO_END
  );
  assert.equal(generatedNotebookLines.length, 1, 'each notebook page occupies one MEMORY.md line');
  assert.equal(
    generatedNotebookLines[0],
    'Protein Yield Run; Purification produced a recorded yield of 42 mg.'
  );

  const changedEntry = {
    ...entry,
    result: 'Observed 3 colonies after selection.',
    updatedAt: '2026-07-04T00:00:00.000Z'
  };
  const changedSnapshot = {
    ...snapshot,
    notebookEntries: [changedEntry]
  };
  const fabricatedGenerator = async () => {
    modelCalls += 1;
    return {
      ok: true,
      model: 'test-mini',
      payload: {
        conclusion: 'Selection produced 99 colonies.',
        quotes: ['Observed 99 colonies after selection.']
      }
    };
  };
  await fs.writeFile(pagePath, pagePayload(changedEntry), 'utf8');
  await writeProjectMemoryFile({
    storageRootPath: tempDir,
    folderPath: projectFolder,
    snapshot: changedSnapshot,
    projectRecord: collectProjectMemoryRecords(changedSnapshot)[0],
    requestNotebookConclusion: fabricatedGenerator
  });
  await waitForProjectMemoryQueue(projectFolder);

  const cache = JSON.parse(await fs.readFile(
    path.join(projectFolder, '.hikari', 'research-memory.json'),
    'utf8'
  ));
  assert.equal(modelCalls, 2);
  assert.equal(cache['notebook:note-1'].model, NOTEBOOK_MEMORY_MODEL_FALLBACK);
  assert.equal(cache['notebook:note-1'].conclusion, 'Observed 3 colonies after selection.');
  assert.equal(Object.prototype.hasOwnProperty.call(cache['notebook:note-1'], 'quotes'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(cache['notebook:note-1'], 'status'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(cache['notebook:note-1'], 'error'), false);

  const staleEntry = {
    ...entry,
    result: 'Old result was 5 mg.',
    updatedAt: '2026-07-05T00:00:00.000Z'
  };
  const staleSnapshot = {
    ...snapshot,
    notebookEntries: [staleEntry]
  };
  await fs.writeFile(pagePath, pagePayload(staleEntry), 'utf8');
  let markStaleCallStarted;
  let releaseStaleCall;
  const staleCallStarted = new Promise((resolve) => {
    markStaleCallStarted = resolve;
  });
  const staleCallRelease = new Promise((resolve) => {
    releaseStaleCall = resolve;
  });
  const staleGenerator = async () => {
    markStaleCallStarted();
    await staleCallRelease;
    return {
      ok: true,
      model: 'test-mini',
      payload: {
        conclusion: 'The old recorded result was 5 mg.',
        quotes: ['Old result was 5 mg.']
      }
    };
  };
  await writeProjectMemoryFile({
    storageRootPath: tempDir,
    folderPath: projectFolder,
    snapshot: staleSnapshot,
    projectRecord: collectProjectMemoryRecords(staleSnapshot)[0],
    requestNotebookConclusion: staleGenerator
  });
  await staleCallStarted;
  await fs.writeFile(pagePath, pagePayload({
    ...staleEntry,
    result: 'New result was 9 mg.',
    updatedAt: '2026-07-06T00:00:00.000Z'
  }), 'utf8');
  releaseStaleCall();
  await waitForProjectMemoryQueue(projectFolder);
  const staleCache = JSON.parse(await fs.readFile(
    path.join(projectFolder, '.hikari', 'research-memory.json'),
    'utf8'
  ));
  assert.equal(
    Object.prototype.hasOwnProperty.call(staleCache, 'notebook:note-1'),
    false,
    'a conclusion is discarded when the saved page changes during generation'
  );

  // --- every current miss receives one serialized generation attempt -----------
  const capFolder = path.join(tempDir, 'Project', 'Cap');
  await fs.mkdir(capFolder, { recursive: true });
  const capEntries = Array.from({ length: 5 }, (unused, index) => ({
    ...entry,
    id: `cap-${index + 1}`,
    projectId: 'project-cap',
    projectName: 'Cap',
    storageFolder: '',
    result: `Cap run ${index + 1} yielded ${index + 1} colonies.`
  }));
  for (const capEntry of capEntries) {
    const capPageFolder = path.join(
      capFolder,
      'Notebook',
      `Protein_Yield__${capEntry.id}`
    );
    await fs.mkdir(capPageFolder, { recursive: true });
    await fs.writeFile(path.join(capPageFolder, 'page.json'), pagePayload(capEntry), 'utf8');
  }
  const capSnapshot = {
    ...snapshot,
    projects: [{ id: 'project-cap', name: 'Cap' }],
    notebookEntries: capEntries
  };
  let capCalls = 0;
  const capGenerator = async () => {
    capCalls += 1;
    return { ok: false, error: 'offline' };
  };
  await writeProjectMemoryFile({
    storageRootPath: tempDir,
    folderPath: capFolder,
    snapshot: capSnapshot,
    projectRecord: collectProjectMemoryRecords(capSnapshot)[0],
    requestNotebookConclusion: capGenerator
  });
  await waitForProjectMemoryQueue(capFolder);
  assert.equal(capCalls, 5, 'one sync attempts every current conclusion miss');
  const capCache = JSON.parse(await fs.readFile(
    path.join(capFolder, '.hikari', 'research-memory.json'),
    'utf8'
  ));
  assert.equal(Object.keys(capCache).length, 5);
  assert.equal(capCache['notebook:cap-1'].model, NOTEBOOK_MEMORY_MODEL_FALLBACK);
  const capMemory = await fs.readFile(path.join(capFolder, 'MEMORY.md'), 'utf8');
  assert.equal(capMemory.includes('## Memory Sync'), false);
  const capNotebookLines = sectionLines(
    capMemory,
    '## Experimental Conclusions',
    PROJECT_MEMORY_AUTO_END
  );
  assert.equal(capNotebookLines.length, 5, 'five notebook pages produce exactly five MEMORY.md lines');
  assert.equal(capNotebookLines.every((line) => /^Protein Yield Run; .+$/.test(line)), true);
  assert.equal(capNotebookLines.some((line) => /(?:^- Page:|Generated conclusion:|Recorded result extract:)/.test(line)), false);
  assert.equal(capNotebookLines.some((line) => /; (Protocol|Model|Generated|Result updated|Source):/.test(line)), false);

  // --- an unreadable saved page settles instead of re-asking every sync -------
  // No page.json is written for this project, so the post-generation check can
  // never confirm the result. That must not publish the unconfirmed conclusion,
  // and must not keep paying for the same call on every save.
  const unreadableFolder = path.join(tempDir, 'Project', 'Unreadable');
  await fs.mkdir(unreadableFolder, { recursive: true });
  const unreadableEntry = {
    ...entry,
    id: 'unreadable-1',
    projectId: 'project-unreadable',
    projectName: 'Unreadable',
    storageFolder: '',
    result: 'Run produced 5 mg.'
  };
  const unreadableSnapshot = {
    ...snapshot,
    projects: [{ id: 'project-unreadable', name: 'Unreadable' }],
    notebookEntries: [unreadableEntry]
  };
  let unreadableCalls = 0;
  const unreadableGenerator = async () => {
    unreadableCalls += 1;
    return {
      ok: true,
      model: 'test-mini',
      payload: { conclusion: 'Produced 5 mg.', quotes: ['Run produced 5 mg.'] }
    };
  };
  for (let sync = 0; sync < 3; sync += 1) {
    await writeProjectMemoryFile({
      storageRootPath: tempDir,
      folderPath: unreadableFolder,
      snapshot: unreadableSnapshot,
      projectRecord: collectProjectMemoryRecords(unreadableSnapshot)[0],
      requestNotebookConclusion: unreadableGenerator
    });
    await waitForProjectMemoryQueue(unreadableFolder);
  }
  assert.equal(unreadableCalls, 1, 'an unconfirmable page is asked about once, not once per sync');
  const unreadableCache = JSON.parse(await fs.readFile(
    path.join(unreadableFolder, '.hikari', 'research-memory.json'),
    'utf8'
  ));
  assert.equal(unreadableCache['notebook:unreadable-1'].model, NOTEBOOK_MEMORY_MODEL_FALLBACK);
  assert.equal(unreadableCache['notebook:unreadable-1'].conclusion, 'Run produced 5 mg.');

  // --- a save never waits on in-flight conclusion generation ------------------
  // Generation holds its own queue; only the short cache commit shares the file
  // queue with a render. If the two are merged again, the second save below sits
  // behind the blocked model call and this fails instead of hanging.
  const saveFolder = path.join(tempDir, 'Project', 'Save');
  await fs.mkdir(saveFolder, { recursive: true });
  const saveEntries = Array.from({ length: 2 }, (unused, index) => ({
    ...entry,
    id: `save-${index + 1}`,
    projectId: 'project-save',
    projectName: 'Save',
    storageFolder: '',
    result: `Save run ${index + 1} yielded ${index + 1} mg.`
  }));
  for (const saveEntry of saveEntries) {
    const savePageFolder = path.join(saveFolder, 'Notebook', `Protein_Yield__${saveEntry.id}`);
    await fs.mkdir(savePageFolder, { recursive: true });
    await fs.writeFile(path.join(savePageFolder, 'page.json'), pagePayload(saveEntry), 'utf8');
  }
  const saveSnapshot = {
    ...snapshot,
    projects: [{ id: 'project-save', name: 'Save' }],
    notebookEntries: saveEntries
  };
  let releaseBlockedCall;
  const blockedCall = new Promise((resolve) => {
    releaseBlockedCall = resolve;
  });
  const saveArgs = {
    storageRootPath: tempDir,
    folderPath: saveFolder,
    snapshot: saveSnapshot,
    projectRecord: collectProjectMemoryRecords(saveSnapshot)[0],
    requestNotebookConclusion: async () => {
      await blockedCall;
      return { ok: false, error: 'offline' };
    }
  };
  await writeProjectMemoryFile(saveArgs);
  const secondSave = writeProjectMemoryFile(saveArgs);
  const outcome = await Promise.race([
    secondSave.then(() => 'returned'),
    new Promise((resolve) => {
      setTimeout(() => resolve('blocked'), 2000).unref();
    })
  ]);
  assert.equal(outcome, 'returned', 'a save must not wait on in-flight conclusion generation');
  releaseBlockedCall();
  await secondSave;
  await waitForProjectMemoryQueue(saveFolder);

  console.log('project research memory selfcheck OK');
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
