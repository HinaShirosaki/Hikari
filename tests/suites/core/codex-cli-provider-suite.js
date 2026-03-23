module.exports = function registerCodexCliProviderSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    const providerPath = path.join(__dirname, 'src', 'main', 'lib', 'codex-cli-provider.js');
    const loadProvider = () => {
      delete require.cache[require.resolve(providerPath)];
      return require(providerPath);
    };

    test('codex cli provider stores and clears the configured model', () => {
      const provider = loadProvider();
      assert.equal(provider.getCodexCliModel(), '');
      assert.equal(provider.setCodexCliModel(' gpt-5 '), 'gpt-5');
      assert.equal(provider.getCodexCliModel(), 'gpt-5');
      assert.equal(provider.setCodexCliModel(''), '');
      assert.equal(provider.getCodexCliModel(), '');
    });

    test('codex cli provider uses the configured model when building exec args', () => {
      const provider = loadProvider();
      provider.setCodexCliModel('gpt-5-mini');

      const args = provider.buildCodexCliExecArgs({
        outputFile: '/tmp/codex-last-message.txt'
      });

      assert.equal(args.includes('-m'), true);
      assert.equal(args[args.indexOf('-m') + 1], 'gpt-5-mini');
      assert.equal(args[args.length - 1], '-');
      provider.setCodexCliModel('');
    });

    test('codex cli provider prefers explicit request models and remembers them', () => {
      const provider = loadProvider();
      provider.setCodexCliModel('gpt-old');

      const args = provider.buildCodexCliExecArgs({
        outputFile: '/tmp/codex-last-message.txt',
        model: ' gpt-5.1 '
      });

      assert.equal(args[args.indexOf('-m') + 1], 'gpt-5.1');
      assert.equal(provider.getCodexCliModel(), 'gpt-5.1');
      provider.setCodexCliModel('');
    });
  }
};
