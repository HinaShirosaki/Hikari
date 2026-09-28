'use strict';

module.exports = function registerPaperExperimentSql(context = {}) {
  const { assert, test, fsPromises: fs, path } = context.scope;
  const root = context.__dirname || process.cwd();
  const { createIntakeStore } = require(path.join(root, 'src/main/papers/store/intake/intake-store.js'));
  const { createAgentMcpGateway } = require(path.join(root, 'src/main/agent/mcp-contract/gateway.js'));
  const { runExperimentSql } = require(path.join(root, 'src/main/papers/store/intake/store/experiment-query.js'));
  const { getDirectMcpToolDefinitions } = require(path.join(root, 'src/main/agent/mcp-contract/direct-tools/index.js'));
  const toolName = 'paper_experiments_sql';
  const databasePath = (workspacePath) => path.join(workspacePath, 'KnowledgeBase', 'experiments.sqlite');

  async function fixture(action) {
    const workspacePath = await fs.mkdtemp(path.join(root, 'tmp', 'paper-experiment-sql-'));
    try {
      const store = createIntakeStore({ workspacePath, fs });
      for (const [paper, technique] of [['a', 'Western blot'], ['b', 'SPR']]) {
        const saved = await store.writeIntake(paper, { doc_type: 'research_paper', title: `Paper ${paper}`,
          project_ids: [`project-${paper}`], experiments: [1, 2].map((n) => ({ id: `e${n}`, title: `Experiment ${n}`,
            technique, outcome: 'Measured binding.', evidence: `Evidence for ${paper} ${n}.`, figure_ref: `Fig. ${n}` })) });
        assert.equal(saved.ok, true, saved.error);
      }
      const gateway = createAgentMcpGateway({ workspacePath, fs, env: {} });
      await action({ workspacePath, call: (args, context) => gateway.callGatewayTool(toolName, args, context) });
    } finally { await fs.rm(workspacePath, { recursive: true, force: true }); }
  }

  test('paper experiment SQL is advertised and supports bound joins, counts, CTEs, and schema discovery', async () => {
    await fixture(async ({ call }) => {
      const definition = getDirectMcpToolDefinitions().find((tool) => tool.name === toolName);
      assert.equal(definition.annotations.readOnlyHint, true);
      assert.deepEqual(definition.inputSchema.required, ['sql']);
      const joined = await call({ sql: 'SELECT p.title, p.paper_md, e.id, e.evidence FROM experiments e JOIN papers p USING (paper_id) WHERE technique LIKE ? ORDER BY e.ordinal;', parameters: ['%blot%'] });
      assert.equal(joined.ok, true, joined.error);
      assert.deepEqual(joined.columns, ['title', 'paper_md', 'id', 'evidence']);
      assert.deepEqual(joined.rows, [
        ['Paper a', 'KnowledgeBase/papers.md/a/Paper_a.md', 'e1', 'Evidence for a 1.'],
        ['Paper a', 'KnowledgeBase/papers.md/a/Paper_a.md', 'e2', 'Evidence for a 2.']
      ]);
      const grouped = await call({ sql: '/* stored experiments */ WITH totals AS (SELECT technique, COUNT(*) AS n FROM experiments GROUP BY technique) SELECT * FROM totals ORDER BY technique -- trailing comment' });
      assert.equal(grouped.ok, true, grouped.error);
      assert.deepEqual(grouped.rows, [['SPR', 2], ['Western blot', 2]]);
      const schema = await call({ sql: "SELECT name FROM pragma_table_info('experiments') ORDER BY cid" });
      assert.equal(schema.ok, true, schema.error);
      assert.ok(schema.rows.some(([name]) => name === 'evidence'));
      const quoted = await call({ sql: "SELECT '; DELETE FROM papers' AS literal, ? AS value, 9223372036854775807 AS large", parameters: ["a'; DROP TABLE papers; --"] });
      assert.equal(quoted.ok, true, quoted.error);
      assert.deepEqual(quoted.rows, [['; DELETE FROM papers', "a'; DROP TABLE papers; --", '9223372036854775807']]);
    });
  });

  test('paper experiment SQL rejects mutation, attachments, multiple statements, and database-path overrides without changing files', async () => {
    await fixture(async ({ workspacePath, call }) => {
      const before = await fs.readFile(databasePath(workspacePath));
      const intake = path.join(workspacePath, 'KnowledgeBase/papers.md/a/intake.json');
      const beforeIntake = await fs.readFile(intake);
      for (const sql of [
        'DELETE FROM experiments', 'DROP TABLE papers', "INSERT INTO experiments(paper_id) VALUES ('x')",
        "UPDATE experiments SET title = 'changed'", 'PRAGMA query_only = OFF', "ATTACH DATABASE '/tmp/other.sqlite' AS other",
        'SELECT 1; SELECT 2', 'SELECT 1; DELETE FROM experiments', 'WITH x AS (SELECT 1) DELETE FROM experiments RETURNING id',
        "SELECT load_extension('/tmp/extension')", "SELECT readfile('/etc/passwd')"
      ]) assert.equal((await call({ sql })).ok, false, sql);
      assert.equal((await call({ sql: 'SELECT 1', database_path: '/tmp/other.sqlite' })).status, 'invalid_arguments');
      assert.equal((await call({ sql: 'SELECT 1\0; DELETE FROM experiments' })).status, 'invalid_arguments');
      assert.equal((await call({ sql: 'SELECT ?', parameters: [{}] })).status, 'invalid_arguments');
      assert.equal((await call({ sql: 'SELECT 1', limit: 1000 })).status, 'invalid_arguments');
      assert.deepEqual(await fs.readFile(databasePath(workspacePath)), before);
      assert.deepEqual(await fs.readFile(intake), beforeIntake);
      assert.deepEqual((await call({ sql: 'SELECT COUNT(*) FROM experiments' })).rows, [[4]]);
    });
  });

  test('paper experiment SQL bounds rows and response size and reports empty results with column names', async () => {
    await fixture(async ({ call }) => {
      const result = await call({ sql: 'SELECT paper_id, id FROM experiments ORDER BY paper_id, ordinal', limit: 2 });
      assert.deepEqual(result.rows, [['a', 'e1'], ['a', 'e2']]);
      assert.equal(result.truncated, true);
      assert.equal(result.truncation_reason, 'row_limit');
      const exact = await call({ sql: 'SELECT id FROM experiments WHERE paper_id = ?', parameters: ['a'], limit: 2 });
      assert.equal(exact.truncated, false);
      const empty = await call({ sql: "SELECT id FROM experiments WHERE paper_id = 'missing'" });
      assert.deepEqual(empty.columns, ['id']);
      assert.deepEqual(empty.rows, []);
      assert.equal(empty.truncated, false);
      const large = await call({ sql: "SELECT printf('%60000s', 'x') AS large" });
      assert.equal(large.truncated, true);
      assert.equal(large.truncation_reason, 'response_size');
      assert.equal(large.row_count, 0);
      const memory = await call({ sql: 'SELECT length(randomblob(100000000))' });
      assert.equal(memory.ok, false);
      assert.match(memory.error, /memory/i);
    });
  });

  test('paper experiment SQL interrupts expensive queries and a later query still succeeds', async () => {
    await fixture(async ({ workspacePath, call }) => {
      const result = await runExperimentSql({ bytes: new Uint8Array(await fs.readFile(databasePath(workspacePath))),
        sql: 'WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n) SELECT SUM(x) FROM n', limit: 1, timeoutMs: 500 });
      assert.equal(result.status, 'query_timeout');
      assert.deepEqual((await call({ sql: 'SELECT COUNT(*) FROM experiments' })).rows, [[4]]);
    });
  });

  test('paper experiment SQL honors Settings, workspace isolation, and missing databases without rebuilding', async () => {
    await fixture(async ({ workspacePath, call }) => {
      const disabled = { snapshot: { settings: { agent: { disabledMcpToolNames: [toolName] } } } };
      assert.equal(getDirectMcpToolDefinitions(disabled).some((tool) => tool.name === toolName), false);
      assert.equal((await call({ sql: 'SELECT 1' }, disabled)).status, 'disabled');
      const otherPath = path.join(workspacePath, 'other-workspace');
      const other = createAgentMcpGateway({ workspacePath: otherPath, fs, env: {} });
      assert.equal((await other.callGatewayTool(toolName, { sql: 'SELECT COUNT(*) FROM experiments' })).status, 'not_found');
      await assert.rejects(fs.stat(otherPath), { code: 'ENOENT' });
      const withProject = await call({ sql: 'SELECT COUNT(*) FROM experiments' }, { project: { id: 'project-a' } });
      assert.equal(withProject.search_scope, 'library');
      assert.deepEqual(withProject.rows, [[4]], 'raw SQL scope is explicit rather than silently rewriting the query');
      await fs.writeFile(databasePath(workspacePath), 'corrupt database');
      assert.equal((await call({ sql: 'SELECT * FROM experiments' })).ok, false);
      assert.equal(await fs.readFile(databasePath(workspacePath), 'utf8'), 'corrupt database');
    });
  });

  test('paper experiment SQL works through the actual MCP server and preserves structured columns and rows', async () => {
    await fixture(async ({ workspacePath }) => {
      const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
      const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
      const { createAgentMcpStdioServer } = require(path.join(root, 'src/main/agent/mcp-contract/stdio-server.js'));
      const runtime = createAgentMcpStdioServer({ workspacePath, fs, env: {} });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'experiment-sql-selfcheck', version: '1' });
      try {
        await runtime.connect(serverTransport);
        await client.connect(clientTransport);
        assert.ok((await client.listTools()).tools.some((tool) => tool.name === toolName));
        const result = await client.callTool({ name: toolName, arguments: { sql: 'SELECT COUNT(*) AS n FROM experiments' } });
        assert.equal(result.isError, false);
        assert.deepEqual(result.structuredContent.columns, ['n']);
        assert.deepEqual(result.structuredContent.rows, [[4]]);
        assert.deepEqual(JSON.parse(result.content[0].text).rows, [[4]]);
      } finally { await client.close(); await runtime.close(); }
    });
  });
};
