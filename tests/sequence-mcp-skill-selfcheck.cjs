'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { test } = require('node:test');
const { OFFICIAL_MCP_SKILLS, releaseOfficialMcpSkillsForWorkspace } = require('../src/main/agent/codex-agent/official-mcp-skills');
const { SEQUENCE_MCP_TOOLS } = require('../src/main/agent/mcp-contract/direct-tools/sequence-tools');
const { validateValueAgainstSchema } = require('../src/main/agent/tools/tool-loading/schema-validation');
const skill = OFFICIAL_MCP_SKILLS.find(item => item.id === 'sequence-viewer');
const examples = () => Object.values(skill.files).flatMap(content => [...content.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1])));

test('official Sequence Viewer skill links resolve and examples use production schemas', () => {
  assert.ok(skill);
  const files = { 'SKILL.md': skill.content, ...skill.files };
  for (const [file, content] of Object.entries(files)) {
    for (const match of content.matchAll(/\]\(([^)]+\.md)\)/g)) {
      const linked = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
      assert.ok(files[linked], `${file} links to missing ${linked}`);
    }
  }
  const tools = new Set();
  for (const example of examples()) {
    const tool = SEQUENCE_MCP_TOOLS.find(item => item.definition.name === example.tool);
    assert.ok(tool, `Unknown example tool ${example.tool}`);
    const validation = validateValueAgainstSchema(example.arguments, tool.definition.inputSchema, tool.definition.inputSchema);
    assert.equal(validation.ok, true, `${example.tool}: ${validation.error}`);
    tools.add(example.tool);
  }
  assert.equal(tools.size, 9);
});

test('official release materializes and refreshes all references without deleting user files', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'sequence-skill-release-'));
  try {
    const root = path.join(workspace, '.agents', 'skills', skill.directory);
    await releaseOfficialMcpSkillsForWorkspace(workspace);
    for (const [file, content] of Object.entries({ 'SKILL.md': skill.content, ...skill.files })) assert.equal(await fs.readFile(path.join(root, file), 'utf8'), content);
    await fs.writeFile(path.join(root, 'references/tool-reference.md'), 'outdated official reference');
    await fs.writeFile(path.join(root, 'personal-note.md'), 'keep me');
    await releaseOfficialMcpSkillsForWorkspace(workspace);
    assert.equal(await fs.readFile(path.join(root, 'references/tool-reference.md'), 'utf8'), skill.files['references/tool-reference.md']);
    assert.equal(await fs.readFile(path.join(root, 'personal-note.md'), 'utf8'), 'keep me');
    await fs.writeFile(path.join(root, 'SKILL.md'), 'user-owned skill');
    await fs.writeFile(path.join(root, 'references/tool-reference.md'), 'user-owned reference');
    const result = await releaseOfficialMcpSkillsForWorkspace(workspace);
    assert.equal(result.find(row => row.path === path.join(root, 'SKILL.md')).status, 'preserved');
    assert.equal(await fs.readFile(path.join(root, 'SKILL.md'), 'utf8'), 'user-owned skill');
    assert.equal(await fs.readFile(path.join(root, 'references/tool-reference.md'), 'utf8'), 'user-owned reference');
  } finally { await fs.rm(workspace, { recursive: true, force: true }); }
});

test('documented fusion and original-coordinate batch examples execute against discovered references', async () => {
  const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'sequence-skill-workflow-'));
  try {
    const { algorithms } = require('../src/renderer/modules/sequence-viewer/main-process/mcp/service');
    const model = await algorithms();
    const { reverseTranslateProteinSequence } = await import('../src/renderer/modules/sequence-viewer/calculations/sequence.js');
    const library = require('../src/renderer/modules/sequence-viewer/main-process/sequence-library');
    const protein = 'M' + 'A'.repeat(39) + 'HLFSECTNWVFIDQP' + 'G'.repeat(35);
    const sequence = reverseTranslateProteinSequence(protein).dna + 'TAA';
    const record = { name: 'Training plasmid', sequence, topology: 'linear', features: [{ name: 'Target', type: 'cds', strand: 1, segments: [{ start: 0, end: sequence.length }] }] };
    await library.upsertSequenceEntry({ storagePath, id: 'fixture', name: record.name, status: 'saved', topology: record.topology, sequence, sequenceLength: sequence.length, featureCount: 1, features: record.features, gbkText: model.buildRecordGenbankText(record) });
    const call = async (name, args) => {
      const result = await SEQUENCE_MCP_TOOLS.find(tool => tool.definition.name === name).handler(args, {}, { storagePath });
      assert.equal(result.ok, true, JSON.stringify(result));
      return result;
    };
    const found = await call('sequence_search', { mode: 'name', query: 'Training plasmid' });
    const parent = await call('sequence_get', { entry_id: found.items[0].entry_id });
    const his = await call('sequence_protein_parts', { query: 'His' });
    const tev = await call('sequence_protein_parts', { query: 'TEV' });
    const substitutions = { ENTRY_ID: parent.entry_id, REVISION: parent.revision, FEATURE_REF: parent.features.items[0].feature_ref, HIS_PART_ID: his.items[0].part_id, TEV_PART_ID: tev.items[0].part_id };
    const replace = value => typeof value === 'string' ? substitutions[value] || value : Array.isArray(value) ? value.map(replace) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)])) : value;
    const runExample = async requestId => {
      const example = examples().find(item => item.arguments.request_id === requestId);
      assert.ok(example);
      return call(example.tool, replace(example.arguments));
    };
    const built = await runExample('build-his-tev-01');
    assert.equal(built.protein, 'HHHHHHENLYFQG' + protein);
    assert.equal(built.dna.slice(39), sequence.slice(0, -3));
    substitutions.CONSTRUCT_ID = built.construct_id;
    const fused = await runExample('insert-fusion-01');
    assert.equal(fused.protein, built.protein);
    const edited = await runExample('target-batch-01');
    assert.equal(edited.protein.slice(40, 55), 'HLFSGCTVGSFIDQP');
    assert.equal(edited.protein.length, protein.length);
    const fresh = await call('sequence_get', { entry_id: edited.entry_id });
    const read = await call('sequence_protein_get', { entry_id: fresh.entry_id, feature_ref: fresh.features.items[0].feature_ref, offset: 40, limit: 15 });
    assert.equal(read.residues.items.map(item => item.amino_acid).join(''), 'HLFSGCTVGSFIDQP');
    assert.equal(read.terminal_stop.codon, 'TAA');
    assert.equal((await call('sequence_get', { entry_id: parent.entry_id, include_sequence: true })).sequence, sequence);
  } finally { await fs.rm(storagePath, { recursive: true, force: true }); }
});
