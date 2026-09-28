import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  NOTEBOOK_MEMORY_MODEL_FALLBACK,
  NOTEBOOK_SUMMARY_PENDING,
  PAPER_SUMMARY_PENDING,
  PROJECT_MEMORY_AUTO_END,
  PROJECT_MEMORY_AUTO_START,
  buildNotebookConclusionRequest,
  collectProjectMemoryRecords,
  mergeProjectMemoryMarkdown,
  waitForProjectMemoryQueue,
  writeProjectMemoryFile
} = require('../src/main/project-memory');
const { importStorageRoot } = require('../src/main/storage/storage-import.js');
const { hydrateSnapshotFromBundle } = require('../src/main/storage/storage-hydration.js');
const { PROJECT_MEMORY_MAX_BYTES } = require('../src/main/project-memory/constants.js');
const { CODEX_PROJECT_DOC_MAX_BYTES } = require('../src/main/lib/codex-cli-provider/constants.js');
const { buildProjectMemoryGeneratedBlock, projectMemoryByteBudget } = require('../src/main/project-memory/memory-markdown.js');
const { sanitizeFolderName } = require('../src/main/storage/storage-utils.js');
const { hydrateProjectRootFromStoragePath } = require('../src/main/storage/hydration/project-folders.js');

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
    '## Experiments',
    '## Agent Notes'
  );
  assert.equal(generatedNotebookLines.length, 1, 'each notebook page occupies one MEMORY.md line');
  assert.equal(
    generatedNotebookLines[0],
    '- Protein Yield Run; Purification produced a recorded yield of 42 mg. ("Yield increased to 42 mg after purification.")',
    'the published line is the summary sentence, carrying the quote that proves it'
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
  assert.equal(
    cache['notebook:note-1'].conclusion,
    NOTEBOOK_SUMMARY_PENDING,
    'an unsummarized page says so instead of pasting the saved result'
  );
  assert.deepEqual(cache['notebook:note-1'].quotes, []);
  assert.equal(cache['notebook:note-1'].status, 'fallback');
  assert.equal(Object.prototype.hasOwnProperty.call(cache['notebook:note-1'], 'error'), false);

  // A provider recovery retries unchanged source after backoff; explicit
  // regeneration also works without altering canonical notebook content.
  const cachePath = path.join(projectFolder, '.hikari', 'research-memory.json');
  cache['notebook:note-1'].retryAfter = new Date(0).toISOString();
  await fs.writeFile(cachePath, JSON.stringify(cache));
  let recoveryCalls = 0;
  const recoveryGenerator = async () => {
    recoveryCalls += 1;
    return { payload: { conclusion: 'A proposed interpretation.', quotes: ['Observed 3 colonies after selection.'] } };
  };
  const recoveryInput = {
    storageRootPath: tempDir, folderPath: projectFolder, snapshot: changedSnapshot,
    projectRecord: collectProjectMemoryRecords(changedSnapshot)[0], requestNotebookConclusion: recoveryGenerator
  };
  await writeProjectMemoryFile(recoveryInput);
  await waitForProjectMemoryQueue(projectFolder);
  assert.equal(recoveryCalls, 1);
  const recovered = JSON.parse(await fs.readFile(cachePath, 'utf8'))['notebook:note-1'];
  assert.equal(recovered.status, 'evidence');
  assert.deepEqual(recovered.quotes, ['Observed 3 colonies after selection.']);
  assert.equal(recovered.conclusion, 'A proposed interpretation.');
  assert.ok(recovered.sourceRelativePath.endsWith('page.json'));
  assert.equal(
    (await fs.readFile(memoryPath, 'utf8')).includes(
      'A proposed interpretation. ("Observed 3 colonies after selection.")'
    ),
    true,
    'a quote-verified summary is what MEMORY.md publishes, beside its evidence'
  );
  await writeProjectMemoryFile({ ...recoveryInput, regenerateConclusions: true });
  await waitForProjectMemoryQueue(projectFolder);
  assert.equal(recoveryCalls, 2);

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
    '## Experiments',
    '## Agent Notes'
  );
  assert.equal(capNotebookLines.length, 5, 'five notebook pages produce exactly five MEMORY.md lines');
  assert.equal(capNotebookLines.every((line) => /^- Protein Yield Run; .+$/.test(line)), true);
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
  assert.equal(unreadableCache['notebook:unreadable-1'].conclusion, NOTEBOOK_SUMMARY_PENDING);
  assert.equal(
    (await fs.readFile(path.join(unreadableFolder, 'MEMORY.md'), 'utf8')).includes('Produced 5 mg.'),
    false,
    'a summary that could not be confirmed against the saved page is never published'
  );

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

  // --- typeless pages and un-analyzed papers both still reach MEMORY.md -------
  // Most saved pages predate notebookType, and most linked papers predate
  // intake.json. Excluding either one rendered a populated project as empty.
  const legacyFolder = path.join(tempDir, 'Project', 'Legacy');
  const legacyPage = {
    ...entry,
    id: 'legacy-1',
    projectId: 'project-legacy',
    projectName: 'Legacy',
    experimentName: 'Legacy Run',
    storageFolder: '',
    result: 'Recovered 7 mg of protein.'
  };
  delete legacyPage.notebookType;
  const legacyPageFolder = path.join(legacyFolder, 'Notebook', 'Protein_Yield__legacy-1');
  await fs.mkdir(legacyPageFolder, { recursive: true });
  await fs.writeFile(path.join(legacyPageFolder, 'page.json'), pagePayload(legacyPage), 'utf8');

  const legacyPaperFolder = path.join(tempDir, 'KnowledgeBase', 'papers.md', 'Old_Paper');
  await fs.mkdir(legacyPaperFolder, { recursive: true });
  await fs.writeFile(path.join(legacyPaperFolder, 'Old_Paper.md'), '# Old Paper\n', 'utf8');

  const legacySnapshot = {
    ...snapshot,
    projects: [{ id: 'project-legacy', name: 'Legacy' }],
    notebookEntries: [legacyPage],
    papers: [{
      id: 'paper-old',
      title: 'Old Paper',
      linkedType: 'project',
      linkedId: 'project-legacy',
      knowledgeMarkdownRelativePath: 'KnowledgeBase/papers.md/Old_Paper/Old_Paper.md'
    }]
  };
  await writeProjectMemoryFile({
    storageRootPath: tempDir,
    folderPath: legacyFolder,
    snapshot: legacySnapshot,
    projectRecord: collectProjectMemoryRecords(legacySnapshot)[0],
    requestNotebookConclusion: async () => ({ ok: false, error: 'offline' })
  });
  await waitForProjectMemoryQueue(legacyFolder);

  const legacyMemory = await fs.readFile(path.join(legacyFolder, 'MEMORY.md'), 'utf8');
  const legacyNotebookLines = sectionLines(
    legacyMemory,
    '## Experiments',
    '## Agent Notes'
  );
  assert.deepEqual(
    legacyNotebookLines,
    [`- Legacy Run; ${NOTEBOOK_SUMMARY_PENDING}`],
    'a page without notebookType still reaches MEMORY.md'
  );
  const legacyPaperLines = sectionLines(
    legacyMemory,
    '## Papers',
    '## Experiments'
  );
  assert.deepEqual(
    legacyPaperLines,
    [`- Old Paper; ${PAPER_SUMMARY_PENDING}`],
    'an un-analyzed paper is still listed, on one line, saying the summary is missing'
  );

  // An explicit non-biology type is still excluded; only an absent one is not.
  const synthesisSnapshot = {
    ...legacySnapshot,
    notebookEntries: [{ ...legacyPage, notebookType: 'synthesis' }]
  };
  const synthesisFolder = path.join(tempDir, 'Project', 'Synthesis');
  await fs.mkdir(synthesisFolder, { recursive: true });
  await writeProjectMemoryFile({
    storageRootPath: tempDir,
    folderPath: synthesisFolder,
    snapshot: synthesisSnapshot,
    projectRecord: collectProjectMemoryRecords(synthesisSnapshot)[0],
    requestNotebookConclusion: async () => ({ ok: false, error: 'offline' })
  });
  await waitForProjectMemoryQueue(synthesisFolder);
  const synthesisMemory = await fs.readFile(path.join(synthesisFolder, 'MEMORY.md'), 'utf8');
  assert.deepEqual(
    sectionLines(synthesisMemory, '## Experiments', '## Agent Notes'),
    ['- None recorded.'],
    'an explicit synthesis page stays out of project memory'
  );

  // The folder is the project's identity: MEMORY.md stores no id, so a project
  // whose folder holds no page.json to read one back from must still hydrate
  // onto its live record instead of beside it under a minted id.
  const identityRoot = path.join(tempDir, 'identity-root');
  const identityProject = {
    id: 'project-identity',
    name: 'Ion Channels',
    description: 'Paper-only project.',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z'
  };
  const identitySnapshot = {
    settings: { storagePath: identityRoot },
    projects: [identityProject],
    notebookEntries: [],
    papers: [{
      id: 'paper-identity',
      title: 'Ion Paper',
      linkedType: 'project',
      linkedId: 'project-identity',
      knowledgeMarkdownRelativePath: 'KnowledgeBase/papers.md/Ion_Paper/Ion_Paper.md'
    }]
  };
  const identityFolder = path.join(identityRoot, 'Project', 'Ion_Channels');
  await fs.mkdir(identityFolder, { recursive: true });
  await writeProjectMemoryFile({
    storageRootPath: identityRoot,
    folderPath: identityFolder,
    snapshot: identitySnapshot,
    projectRecord: collectProjectMemoryRecords(identitySnapshot)[0]
  });
  await waitForProjectMemoryQueue(identityFolder);

  const reloaded = await hydrateSnapshotFromBundle({
    dataFilePath: path.join(identityRoot, 'hikari-data.json'),
    snapshot: identitySnapshot
  });
  assert.deepEqual(
    reloaded.snapshot.projects.map((project) => project.id),
    ['project-identity'],
    'a paper-only project folder hydrates onto its live record, not beside it'
  );

  // Recovery with no data file left to match against still mints a folder id.
  const recoveredRoot = await hydrateProjectRootFromStoragePath({ storagePath: identityRoot });
  assert.deepEqual(
    recoveredRoot.projects.map((project) => project.id),
    ['project_folder_ion_channels'],
    'a folder with no live project still recovers under a minted id'
  );

  // --- the index stays inside the project-doc cap, newest first -------------
  // Codex stops reading at CODEX_PROJECT_DOC_MAX_BYTES and says nothing when it
  // does, so the block has to bound itself. Storage cannot import that constant
  // across the agent boundary; this is what keeps the copy honest.
  assert.equal(
    PROJECT_MEMORY_MAX_BYTES,
    CODEX_PROJECT_DOC_MAX_BYTES,
    'the memory byte cap must track the Codex project-doc cap'
  );

  const isoDay = (day) => new Date(Date.UTC(2020, 0, 1) + (day * 86400000)).toISOString();
  const manyPapers = Array.from({ length: 400 }, (unused, index) => ({
    paperId: `cap-p${index}`,
    title: `Paper ${index}`,
    updatedAt: isoDay(index),
    summary: `A summary of paper ${index} written at a realistic length for one index line.`
  }));
  const manyPages = Array.from({ length: 400 }, (unused, index) => ({
    id: `cap-n${index}`,
    title: `Run ${index}`,
    updatedAt: isoDay(index),
    conclusion: `Run ${index} produced a measurable result worth one recorded sentence.`,
    quotes: [`run ${index} measured a result worth quoting back`]
  }));
  const cappedBlock = buildProjectMemoryGeneratedBlock(
    { displayName: 'Capped' },
    { paperEntries: manyPapers, notebookEntries: manyPages, byteBudget: projectMemoryByteBudget('') }
  );
  assert.ok(
    Buffer.byteLength(cappedBlock, 'utf8') <= PROJECT_MEMORY_MAX_BYTES,
    'an oversized project still renders within the project-doc cap'
  );
  const cappedLines = cappedBlock.split('\n');
  assert.ok(cappedLines.some((line) => line.startsWith('- Paper 399;')), 'the newest paper survives');
  assert.ok(cappedLines.some((line) => line.startsWith('- Run 399;')), 'the newest experiment survives');
  assert.ok(!cappedLines.some((line) => line.startsWith('- Paper 0;')), 'the oldest paper is dropped');
  assert.ok(!cappedLines.some((line) => line.startsWith('- Run 0;')), 'the oldest experiment is dropped');
  assert.equal(
    cappedLines.filter((line) => line.includes('omitted from this index')).length,
    2,
    'each section says how many records it left out and which tool retrieves them'
  );

  // Hand-written notes are counted against the same cap, never truncated.
  const notes = `## Bench notes\n${'x'.repeat(40000)}`;
  const notesBudget = projectMemoryByteBudget(notes);
  assert.ok(notesBudget < PROJECT_MEMORY_MAX_BYTES - 40000, 'manual notes shrink the generated budget');
  const withNotes = mergeProjectMemoryMarkdown(notes, buildProjectMemoryGeneratedBlock(
    { displayName: 'Noted' },
    { notebookEntries: manyPages, byteBudget: notesBudget }
  ));
  assert.ok(
    Buffer.byteLength(withNotes, 'utf8') <= PROJECT_MEMORY_MAX_BYTES,
    'the whole file, notes included, stays within the cap'
  );
  assert.ok(withNotes.includes('## Bench notes'), 'hand-written notes are never the thing that gets cut');

  // Ordering is recency, not the alphabet: an old A-title yields to a new Z-title.
  const orderedBlock = buildProjectMemoryGeneratedBlock({ displayName: 'Ordered' }, {
    notebookEntries: [
      { id: 'a', title: 'Alpha run', updatedAt: isoDay(1), conclusion: 'Older result.' },
      { id: 'z', title: 'Zulu run', updatedAt: isoDay(9), conclusion: 'Newer result.' }
    ]
  });
  assert.deepEqual(
    sectionLines(mergeProjectMemoryMarkdown('', orderedBlock), '## Experiments', '## Agent Notes'),
    ['- Zulu run; Newer result.', '- Alpha run; Older result.'],
    'the newest experiment is listed first, not the alphabetical one'
  );

  // A notebook result may contain anything, including a pasted MEMORY.md. If a
  // marker survives into the block, the next merge splices at the injected one
  // and appends a fresh block on every save until the file is garbage.
  const injectedBlock = buildProjectMemoryGeneratedBlock({ displayName: 'Inj' }, {
    notebookEntries: [{
      id: 'inj',
      title: `Evil ${PROJECT_MEMORY_AUTO_END} run`,
      updatedAt: '2026-01-01T00:00:00.000Z',
      conclusion: `pasted ${PROJECT_MEMORY_AUTO_START} block ${PROJECT_MEMORY_AUTO_END} here`
    }]
  });
  const injectedOnce = mergeProjectMemoryMarkdown('## Bench notes\nkeep me', injectedBlock);
  const injectedTwice = mergeProjectMemoryMarkdown(injectedOnce, injectedBlock);
  assert.equal(
    injectedOnce.split(PROJECT_MEMORY_AUTO_START).length - 1,
    1,
    'an injected marker cannot open a second auto block'
  );
  assert.equal(injectedOnce, injectedTwice, 're-merging an injected block is byte-stable');
  assert.ok(injectedTwice.includes('keep me'), 'injection cannot eat hand-written notes');

  // A project folder name is joined onto a trusted base by every sidecar
  // writer, not just this one: "Project/.." resolves to the storage root, and
  // a project named ".." used to drop MEMORY.md and .agents/ there.
  assert.equal(sanitizeFolderName('..', 'Untitled_Project'), 'Untitled_Project');
  assert.equal(sanitizeFolderName('.', 'Untitled_Project'), 'Untitled_Project');
  assert.equal(sanitizeFolderName('...', 'Untitled_Project'), 'Untitled_Project');
  assert.equal(sanitizeFolderName('.hikari', 'Untitled_Project'), '.hikari', 'a leading dot is still a usable name');
  assert.equal(sanitizeFolderName('../../evil', 'Untitled_Project'), '.._.._evil');

  // The notebook's project dialog cannot import the helper above, so it carries
  // its own copy to decide both the folder it asks main to create and whether a
  // new name would collide. Drift means the dialog creates one folder while
  // storage writes MEMORY.md into another.
  const controllerSource = await fs.readFile(
    new URL('../src/renderer/modules/biology-notebook/project/project-controller.js', import.meta.url),
    'utf8'
  );
  const rendererSanitize = new Function(`${
    controllerSource.slice(
      controllerSource.indexOf('function sanitizeFolderName'),
      controllerSource.indexOf('function projectFolderKey')
    )
  } return sanitizeFolderName;`)();
  for (const candidate of [
    'Atlas', 'Atlas ', 'My Project', 'My/Project', 'My_Project', 'My  Project',
    '..', '.', '...', '.hikari', '../../evil', 'a'.repeat(400), '', '   '
  ]) {
    assert.equal(
      rendererSanitize(candidate),
      sanitizeFolderName(candidate, ''),
      `renderer and storage must agree on the folder for ${JSON.stringify(candidate)}`
    );
  }

  // --- Agent Notes: the agent's own memos, written through the memory tool ---
  // Codex runs read-only, so the section renders the memory store rather than
  // inviting a file edit the sandbox would refuse.
  const { createAgentMemoryRuntime } = require('../src/main/agent/context/agent-memory.js');
  const notesRoot = path.join(tempDir, 'notes-root');
  const agentMemoryFilePath = path.join(notesRoot, '.hikari', 'agent-memory.json');
  const runtime = createAgentMemoryRuntime({ memoryFilePath: agentMemoryFilePath });
  await runtime.execute({ action: 'remember', scope: 'project', project_id: 'proj-notes',
    key: 'buffer-prep', summary: 'Use freshly made KCl; the old stock drifted.' });
  await runtime.execute({ action: 'remember', scope: 'project', project_name: 'Ion Channels',
    key: 'next-step', summary: 'Repeat trial 3 at 30 uM before calling it a dose response.' });
  await runtime.execute({ action: 'remember', key: 'format', summary: 'Prefers terse answers.' });
  await runtime.execute({ action: 'remember', scope: 'project', project_id: 'someone-else',
    key: 'other-note', summary: 'Belongs to a different project.' });

  const notesSnapshot = {
    settings: { storagePath: notesRoot },
    projects: [{ id: 'proj-notes', name: 'Ion Channels' }],
    notebookEntries: [], papers: []
  };
  const notesFolder = path.join(notesRoot, 'Project', 'Ion_Channels');
  await fs.mkdir(notesFolder, { recursive: true });
  await writeProjectMemoryFile({
    storageRootPath: notesRoot,
    folderPath: notesFolder,
    snapshot: notesSnapshot,
    projectRecord: collectProjectMemoryRecords(notesSnapshot)[0],
    agentMemoryFilePath
  });
  await waitForProjectMemoryQueue(notesFolder);
  const notesMemory = await fs.readFile(path.join(notesFolder, 'MEMORY.md'), 'utf8');
  assert.deepEqual(
    sectionLines(notesMemory, '## Agent Notes', PROJECT_MEMORY_AUTO_END).sort(),
    [
      '- buffer-prep; Use freshly made KCl; the old stock drifted.',
      '- next-step; Repeat trial 3 at 30 uM before calling it a dose response.'
    ].sort(),
    'project-scoped memos reach Agent Notes, by id or by project name'
  );
  assert.equal(notesMemory.includes('- format;'), false, 'a global preference is not a project note');
  assert.equal(notesMemory.includes('- other-note;'), false, 'another project\'s memo does not leak in');

  // Under budget pressure the agent's memos outrank papers and experiments.
  const squeezed = buildProjectMemoryGeneratedBlock({ displayName: 'Squeezed' }, {
    notebookEntries: manyPages,
    noteEntries: [{ id: 'm', title: 'keep-me', summary: 'The note must survive the trim.', updatedAt: isoDay(0) }],
    byteBudget: 900
  });
  assert.ok(squeezed.includes('- keep-me; The note must survive the trim.'),
    'a note is reserved ahead of newer papers and experiments');
  assert.ok(squeezed.includes('omitted from this index'), 'the records it displaced are still accounted for');
  assert.ok(Buffer.byteLength(squeezed, 'utf8') <= 900 + 400, 'the squeezed block stays near its budget');

  console.log('project research memory selfcheck OK');
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
