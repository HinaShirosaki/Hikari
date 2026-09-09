'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { OFFICIAL_MCP_SKILLS, releaseOfficialMcpSkillsForWorkspace } = require('../src/main/agent/codex-agent/official-mcp-skills.js');
const { ASSAY_TABLE_MCP_TOOL, callAssayTable } = require('../src/main/agent/mcp-contract/direct-tools/assay-table.js');
const { PLOTLY_GRAPH_MCP_TOOL, callPlotlyGraph } = require('../src/main/agent/mcp-contract/direct-tools/plotly-graph.js');
const { validateValueAgainstSchema } = require('../src/main/agent/tools/tool-loading/schema-validation.js');
const { createAgentAssayTableRuntime } = require('../src/main/agent/tools/agent-assay-table.js');
const { createAgentPlotlyGraphRuntime } = require('../src/main/agent/tools/agent-plotly-graph.js');
const { runPythonSandbox } = require('../src/main/agent/tools/agent-python-sandbox.js');

const skill = OFFICIAL_MCP_SKILLS.find(item => item.id === 'assay-plotly');
assert.ok(skill);
const files = { 'SKILL.md': skill.content, ...skill.files };
const examples = Object.values(files).flatMap(content => (
  [...content.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]))
));
const namedExample = name => {
  const example = examples.find(item => (item.arguments.output_name || item.arguments.name) === name);
  assert.ok(example, `Missing example ${name}`);
  return structuredClone(example);
};
function createClient(options = {}) {
  const tables = createAgentAssayTableRuntime(options);
  const graphs = createAgentPlotlyGraphRuntime();
  const deps = { runTool: (id, args) => (id === 'assay-table' ? tables : graphs).execute(args) };
  const call = (tool, args) => (tool === 'assay_table' ? callAssayTable : callPlotlyGraph)(args, {}, deps);
  return {
    tables,
    call,
    async success(tool, args) {
      const result = await call(tool, args);
      assert.equal(result.ok, true, JSON.stringify(result));
      return result;
    },
    async example(name, overrides = {}) {
      const { tool, arguments: args } = namedExample(name);
      return this.success(tool, { ...args, ...overrides });
    }
  };
}

test('Assay skill reference links resolve and executable examples validate against public schemas', () => {
  const schemas = new Map([ASSAY_TABLE_MCP_TOOL, PLOTLY_GRAPH_MCP_TOOL].map(tool => [tool.name, tool.inputSchema]));
  const reachable = new Set(['SKILL.md']);
  const visit = file => {
    for (const match of files[file].matchAll(/\]\(([^)]+\.md)\)/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
      assert.ok(files[target], `${file} links to missing ${target}`);
      if (!reachable.has(target)) { reachable.add(target); visit(target); }
    }
  };
  visit('SKILL.md');
  assert.deepEqual([...reachable].sort(), Object.keys(files).sort());
  assert.ok(examples.length > 0);
  for (const example of examples) {
    const schema = schemas.get(example.tool);
    assert.ok(schema, `Unknown tool ${example.tool}`);
    const result = validateValueAgainstSchema(example.arguments, schema, schema);
    assert.equal(result.ok, true, `${example.tool}: ${result.error}`);
  }
});

test('Assay skill releases every file, refreshes references, and preserves user-owned skills', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'assay-skill-release-'));
  try {
    const root = path.join(workspace, '.agents', 'skills', skill.directory);
    await releaseOfficialMcpSkillsForWorkspace(workspace);
    for (const [file, content] of Object.entries(files)) {
      assert.equal(await fs.readFile(path.join(root, file), 'utf8'), content);
    }
    const reference = path.join(root, 'references/tool-reference.md');
    await fs.writeFile(reference, 'outdated official reference');
    await fs.writeFile(path.join(root, 'personal-note.md'), 'keep me');
    await releaseOfficialMcpSkillsForWorkspace(workspace);
    assert.equal(await fs.readFile(reference, 'utf8'), files['references/tool-reference.md']);
    assert.equal(await fs.readFile(path.join(root, 'personal-note.md'), 'utf8'), 'keep me');
    await fs.writeFile(path.join(root, 'SKILL.md'), 'user-owned skill');
    await fs.writeFile(reference, 'user-owned reference');
    const result = await releaseOfficialMcpSkillsForWorkspace(workspace);
    assert.equal(result.find(item => item.path === path.join(root, 'SKILL.md')).status, 'preserved');
    assert.equal(await fs.readFile(path.join(root, 'SKILL.md'), 'utf8'), 'user-owned skill');
    assert.equal(await fs.readFile(reference, 'utf8'), 'user-owned reference');
    const ignores = require('../forge.config.js').packagerConfig.ignore;
    for (const file of Object.keys(files)) {
      const packagedPath = `/src/main/agent/codex-agent/official-skills/${skill.directory}/${file}`;
      assert.equal(ignores.some(rule => rule.test(packagedPath)), false, `Excluded from package: ${file}`);
    }
  } finally { await fs.rm(workspace, { recursive: true, force: true }); }
});

test('documented table calculations preserve original rows and feed the plotted means, errors, and counts', async () => {
  const client = createClient();
  const raw = await client.example('Example raw wells');
  const summary = await client.example('Example dose summary', { table_id: raw.table.id });
  assert.deepEqual(summary.table.rows, [
    { sample: 'Compound A', concentration: 1, mean: 12, sd: 2, n: 3 },
    { sample: 'Compound A', concentration: 10, mean: 22, sd: 2, n: 3 }
  ]);
  const wide = await client.success('assay_table', {
    action: 'create', rows: [{ sample: 'A', rep1: 0, rep2: 2, rep3: '' }, { sample: 'B', rep1: 8, rep2: 10, rep3: 12 }]
  });
  const wideSummary = await client.example('Example row replicate summary', { table_id: wide.table.id });
  assert.equal(wideSummary.table.rows[0].mean, 1);
  assert.equal(wideSummary.table.rows[0].n, 2);
  assert.equal(wideSummary.table.rows[0].sd, Math.sqrt(2));
  assert.equal(wideSummary.table.rows[1].mean, 10);
  const joined = await client.success('assay_table', { action: 'create', rows: [{ well: 'A1', result: 1, blank_mean: 3 }] });
  const corrected = await client.example('Example blank corrected wells', { table_id: joined.table.id });
  assert.notEqual(corrected.table.id, joined.table.id);
  assert.deepEqual(corrected.table.rows, [{ well: 'A1', result: 1, blank_mean: 3, corrected: -2 }]);
  assert.deepEqual(client.tables.getTable({ table_id: joined.table.id }).rows, joined.table.rows);
  assert.deepEqual(client.tables.getTable({ table_id: raw.table.id }).rows, raw.table.rows);
  const graph = await client.example('Example dose response');
  const trace = graph.graph.figure.data[0];
  assert.deepEqual(trace.x, summary.table.rows.map(row => row.concentration));
  assert.deepEqual(trace.y, summary.table.rows.map(row => row.mean));
  assert.deepEqual(trace.error_y.array, summary.table.rows.map(row => row.sd));
  assert.deepEqual(trace.customdata, summary.table.rows.map(row => [row.n]));
  const inspected = await client.success('plotly_graph', { action: 'inspect', graph_id: graph.graph.id });
  assert.deepEqual(inspected.inspection.issues, []);
  assert.equal(inspected.graph.figure, undefined);
});

test('documented Plotly updates preserve data and heatmap recipe preserves zeroes and gaps', async () => {
  const client = createClient();
  const created = await client.example('Example dose response');
  const update = examples.find(item => item.tool === 'plotly_graph' && item.arguments.action === 'update');
  const updated = await client.success(update.tool, { ...update.arguments, graph_id: created.graph.id });
  assert.deepEqual(updated.graph.figure.data, created.graph.figure.data);
  assert.deepEqual(updated.graph.figure.layout.xaxis, created.graph.figure.layout.xaxis);
  assert.equal(updated.graph.figure.layout.yaxis.tickformat, '.1f');
  const inspected = await client.success('plotly_graph', { action: 'inspect', graph_id: created.graph.id });
  assert.deepEqual(inspected.inspection.issues, []);
  const heatmap = await client.example('Example plate crop');
  const trace = heatmap.graph.figure.data[0];
  assert.deepEqual(trace.x, ['1', '2', '3']);
  assert.deepEqual(trace.y, ['A', 'B']);
  assert.deepEqual(trace.z, [[10, 0, null], [14, 20, 22]]);
  assert.equal(heatmap.graph.figure.layout.yaxis.autorange, 'reversed');
  assert.deepEqual(heatmap.graph.inspection.issues, []);
});

test('documented Python example runs in the real sandbox and refuses truncated staging', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'assay-skill-python-'));
  try {
    const client = createClient({ runPythonSandbox, sandboxRoot: workspace });
    const raw = await client.example('Example raw wells');
    const summary = await client.example('Example Python dose summary', { table_id: raw.table.id });
    assert.deepEqual(summary.table.rows.map(row => [row.mean, row.sd, row.n]), [[12, 2, 3], [22, 2, 3]]);
    assert.ok(summary.table.rows.every(row => Math.abs(row.sem - 2 / Math.sqrt(3)) < 1e-12));
    const sparse = await client.success('assay_table', { action: 'create', rows: [
      { sample: 'A', concentration: 1, result: 0 }, { sample: 'A', concentration: 1, result: '' },
      { sample: 'B', concentration: 1, result: null }
    ] });
    const sparseSummary = await client.example('Example Python dose summary', { table_id: sparse.table.id });
    assert.deepEqual(sparseSummary.table.rows.map(row => [row.mean, row.sd, row.sem, row.n]), [[0, '', '', 1], ['', '', '', 0]]);
    const large = await client.success('assay_table', { action: 'create', rows: Array.from({ length: 51 }, (_, i) => ({ sample: 'A', concentration: 1, result: i })) });
    assert.equal(large.table.preview_truncated, true);
    assert.equal(large.table.rows.length, 50);
    const builtIn = await client.example('Example dose summary', { table_id: large.table.id });
    assert.equal(builtIn.table.rows[0].n, 51);
    assert.equal(builtIn.table.rows[0].mean, 25);
    const example = namedExample('Example Python dose summary');
    const before = client.tables.listTables().length;
    const refused = await client.call(example.tool, { ...example.arguments, table_id: large.table.id });
    assert.equal(refused.ok, false);
    assert.equal(refused.status, 'python_failed');
    assert.match(refused.error, /Input table is missing rows/);
    assert.equal(client.tables.listTables().length, before);
  } finally { await fs.rm(workspace, { recursive: true, force: true }); }
});
