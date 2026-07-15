module.exports = function registerPromptAndFallbackSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();

  with (scope) {
    test('agent system prompt can include a paper rail session prompt', () => {
      const { createAgentRuntimeSupport } = require(path.join(
        __dirname,
        'src',
        'main',
        'agent',
        'runtime',
        'agent-runtime-support.js'
      ));
      const runtime = createAgentRuntimeSupport({
        renderPromptTemplate: (template, vars = {}) => String(template || '').replace('{{projectScope}}', vars.projectScope || '')
      });
      const systemPrompt = runtime.buildAgentSystemPrompt('Atlas', {
        agent: {
          sessionPrompt: 'Paper agent session: read the transformed markdown paper.md before answering.'
        }
      });
      assert.match(systemPrompt, /Scoped project: Atlas/);
      assert.match(systemPrompt, /Paper agent session/);
      assert.match(systemPrompt, /transformed markdown paper\.md/);
    });

    // The science-reasoning-loop prompt-builder and fallback tests moved out with
    // /self-agent when it was isolated; those runtimes are no longer imported.
  }
};
