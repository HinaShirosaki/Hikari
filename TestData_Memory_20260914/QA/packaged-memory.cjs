'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const storage = path.dirname(__dirname);
const archive = path.join(root, 'out/Hikari-darwin-arm64/Hikari.app/Contents/Resources/app.asar');
const packaged = createRequire(path.join(archive, 'package.json'));
const phase = process.argv[2] || 'seed';
const report = { phase, archive, electron: process.versions.electron, checks: [], calls: [] };
const check = (label, actual, expected = true) => { assert.deepEqual(actual, expected, label); report.checks.push(label); };
function payload(raw) {
  let result = raw.structuredContent || JSON.parse(raw.content[0].text);
  const top = result;
  while (result.output || result.result) result = result.output || result.result;
  return { ...result, ok: top.ok !== false && result.ok !== false };
}
async function main() {
  const snapshot = JSON.parse(await fs.readFile(path.join(__dirname, 'snapshot.json'), 'utf8'));
  const profile = path.join(__dirname, 'profile');
  await fs.mkdir(path.join(profile, 'Config'), { recursive: true });
  await fs.writeFile(path.join(profile, 'Config/last-storage-root.json'), JSON.stringify({ storagePath: storage }));
  const { createMainAppPaths } = packaged('./src/main/lib/app-paths.js');
  const appPaths = createMainAppPaths({ app: { getPath: () => profile }, path, projectRoot: archive, processObject: { env: {}, cwd: () => storage } });
  const { createMainAgentServices } = packaged('./src/main/core/services/create-agent-services.js');
  const services = createMainAgentServices({ getStorageRoot: appPaths.getStorageRoot, getAgentMemoryFilePath: appPaths.getAgentMemoryFilePath, getCodexCliWorkingDirectory: () => storage, getAgentPythonSandboxRoot: () => path.join(__dirname, 'sandbox') });
  const { createAgentMcpHost } = packaged('./src/main/agent/mcp-contract/host.js');
  const context = { storagePath: storage, project: snapshot.projects[0], snapshot };
  const host = createAgentMcpHost({ runTool: services.agentToolRuntime.runAgentTool, getSnapshot: () => snapshot, getContextDefaults: () => context, env: {} });
  const { url, token } = await host.ensureStarted();
  const { Client } = packaged('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = packaged('@modelcontextprotocol/sdk/client/stdio.js');
  const transport = new StdioClientTransport({
    command: process.env.HIKARI_QA_NODE,
    args: [path.join(`${archive}.unpacked`, 'src/main/agent/mcp-contract/stdio-server.js')],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, HIKARI_AGENT_STORAGE_PATH: storage, HIKARI_AGENT_MCP_HOST: url, HIKARI_AGENT_MCP_TOKEN: token, HIKARI_AGENT_MCP_REQUEST_CONTEXT: JSON.stringify(context) }, stderr: 'pipe'
  });
  const client = new Client({ name: 'packaged-memory-qa', version: '1.0' });
  try {
    await client.connect(transport);
    check('Packaged stdio server advertises memory', (await client.listTools()).tools.some(t => t.name === 'memory'));
    const call = async (args) => {
      const result = payload(await client.callTool({ name: 'memory', arguments: args }));
      report.calls.push({ args, result });
      return result;
    };
    if (phase === 'seed') {
      check('Fresh workspace starts empty', (await call({ action: 'list', scope: 'global' })).items.length, 0);
      check('Global preference persisted through app host', (await call({ action: 'remember', key: 'report_format', summary: 'Use concise tables for memory QA.' })).ok);
      const a = await call({ action: 'remember', scope: 'project', key: 'qa_marker', summary: 'Amber paperclip 73.' });
      check('Selected project stable ID is persisted', a.item.project_id, 'memory-qa-a');
      const b = await call({ action: 'remember', scope: 'project', project_id: 'memory-qa-b', project_name: 'Memory QA B', key: 'qa_marker', summary: 'Blue notebook 29.' });
      check('Second project memory persisted', b.ok);
      const recall = await call({ action: 'recall' });
      check('Project recall contains project plus global', recall.items.length, 2);
      check('Project B does not leak into project A', recall.items.some(x => x.summary === 'Blue notebook 29.'), false);
      check('Unfiltered forget rejected through full MCP chain', (await call({ action: 'forget' })).ok, false);
      check('Healthy call after rejected deletion', (await call({ action: 'recall' })).items.length, 2);
      await call({ action: 'remember', scope: 'global', key: 'phrase', summary: 'binder optimization' });
      await call({ action: 'remember', scope: 'global', key: 'scattered', summary: 'optimization of a binder' });
      check('Ranked recall uses words in either order', (await call({ action: 'recall', scope: 'global', query: 'binder optimization' })).items.map(x => x.key), ['phrase', 'scattered']);
      check('Exact-key forget removes only selected record', (await call({ action: 'forget', scope: 'global', key: 'scattered' })).removed_count, 1);
      check('App path resolves inside isolated storage', appPaths.getAgentMemoryFilePath(), path.join(storage, '.hikari/agent-memory.json'));
      const saved = JSON.parse(await fs.readFile(appPaths.getAgentMemoryFilePath(), 'utf8'));
      check('Disk contains four intended records', saved.items.length, 4);
    } else {
      const recalled = await call({ action: 'recall', scope: 'project', include_global: false });
      check('Project A persists after complete process restart', recalled.items[0].summary, 'Amber paperclip 73.');
      check('Global preferences persist after process restart', (await call({ action: 'recall', scope: 'global', key: 'report_format' })).items.length, 1);
      check('Deleted record stays deleted after restart', (await call({ action: 'recall', scope: 'global', key: 'scattered' })).items.length, 0);
      check('Project B persists independently', (await call({ action: 'recall', scope: 'project', project_id: 'memory-qa-b', include_global: false })).items[0].summary, 'Blue notebook 29.');
    }
  } finally { await client.close(); await host.close(); }

  const memory = packaged('./src/main/storage/storage-memory.js');
  const projectRecord = memory.collectProjectMemoryRecords(snapshot).find(p => p.projectId === 'memory-qa-a');
  const folderPath = path.join(storage, 'Project/Memory_QA_A');
  await fs.mkdir(folderPath, { recursive: true });
  const memoryPath = path.join(folderPath, 'MEMORY.md');
  if (phase === 'seed') {
    const notebookFolder = path.join(folderPath, 'Notebook/QA_Result');
    await fs.mkdir(notebookFolder, { recursive: true });
    const entry = { id: 'qa-notebook', notebookType: 'biology', notebookState: 'executed', projectId: 'memory-qa-a', projectName: 'Memory QA A', experimentName: 'Synthetic QA result', protocolName: 'Memory verification', result: 'QA sample A yielded 12 mg. QA sample B yielded 9 mg. These are synthetic test values.', storageFolder: notebookFolder };
    snapshot.notebookEntries = [entry];
    await fs.writeFile(path.join(notebookFolder, 'page.json'), JSON.stringify({ notebookEntry: entry }, null, 2));
    await fs.writeFile(memoryPath, '## User Notes\nPreserve this QA note.\n');
    let generationCalls = 0;
    await memory.writeProjectMemoryFile({ storageRootPath: storage, folderPath, snapshot, projectRecord, requestNotebookConclusion: async () => {
      generationCalls += 1;
      return { model: 'deterministic-qa', payload: { conclusion: 'A deliberately unsupported claim.', quotes: ['QA sample A yielded 12 mg.'] } };
    } });
    await memory.waitForProjectMemoryQueue(folderPath);
    check('Packaged notebook generation pipeline executed', generationCalls, 1);
    const text = await fs.readFile(memoryPath, 'utf8');
    check('Manual project note preserved', text.includes('Preserve this QA note.'));
    check('Existing paper intake summary enters project memory', text.includes('pH-responsive M2pep'));
    check('Notebook publishes recorded evidence', text.includes('Synthetic QA result; QA sample A yielded 12 mg.'));
    check('Unsupported model interpretation is not published', text.includes('A deliberately unsupported claim.'), false);
    const cache = JSON.parse(await fs.readFile(path.join(folderPath, '.hikari/research-memory.json'), 'utf8'))['notebook:qa-notebook'];
    check('Provenance saved', cache.sourceRelativePath.endsWith('page.json'));
    check('Proposed summary retained separately', cache.proposedConclusion, 'A deliberately unsupported claim.');
    await fs.writeFile(path.join(__dirname, 'snapshot.json'), JSON.stringify(snapshot, null, 2));
  } else {
    let generationCalls = 0;
    await memory.writeProjectMemoryFile({ storageRootPath: storage, folderPath, snapshot, projectRecord, requestNotebookConclusion: async () => { generationCalls += 1; throw new Error('Should use cached evidence'); } });
    await memory.waitForProjectMemoryQueue(folderPath);
    check('Evidence cache reused after process restart', generationCalls, 0);
    check('Project memory remains grounded after restart', (await fs.readFile(memoryPath, 'utf8')).includes('Synthetic QA result; QA sample A yielded 12 mg.'));
  }
  report.ok = true;
  await fs.writeFile(path.join(__dirname, `${phase}-report.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ phase, passed: report.checks.length, report: path.join(__dirname, `${phase}-report.json`) }));
}
main().catch(async error => {
  report.ok = false; report.error = error.stack;
  await fs.writeFile(path.join(__dirname, `${phase}-report.json`), JSON.stringify(report, null, 2));
  console.error(error); process.exit(1);
});
