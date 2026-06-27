module.exports = function registerAgentPromptRegistrySuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    const childProcess = require('node:child_process');
    const promptRegistry = require(path.join(
      __dirname,
      'src',
      'main',
      'helpers',
      'agent',
      'shared',
      'agent-prompt-registry.js'
    ));

    test('agent prompt registry renders markdown with core prompt sections', () => {
      const entries = promptRegistry.getAgentPromptRegistry();
      const ids = entries.map((entry) => entry.id);

      assert.equal(entries.length > 10, true);
      assert.equal(ids.includes('core.intent_parser_catalog_prompt'), true);
      assert.equal(ids.includes('science.final_synthesis_prompt'), true);

      const markdown = promptRegistry.renderAgentPromptRegistryMarkdown({
        generatedAt: '2026-04-05T00:00:00.000Z'
      });
      assert.match(markdown, /# Agent Prompt Registry/);
      assert.match(markdown, /## Core Agent/);
      assert.match(markdown, /## Science Reasoning/);
      assert.match(markdown, /Classify the lab-assistant user message\. Return compact JSON only\./);
    });

    test('agent prompt export script writes a markdown file', () => {
      const outputPath = path.join(__dirname, 'tmp', 'agent-prompts-test.md');
      childProcess.execFileSync(
        process.execPath,
        [path.join(__dirname, 'scripts', 'export-agent-prompts.mjs'), outputPath],
        { cwd: __dirname }
      );

      const written = fs.readFileSync(outputPath, 'utf8');
      assert.match(written, /# Agent Prompt Registry/);
      assert.match(written, /### Codex Tool Loop Prompt/);
    });
  }
};
