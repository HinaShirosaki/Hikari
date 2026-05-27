module.exports = function registerCodexCliProviderSuite(context = {}) {
  const registerParts = [
    require('./codex-cli-provider-suite/part-01.js'),
    require('./codex-cli-provider-suite/part-02.js'),
    require('./codex-cli-provider-suite/part-03.js'),
    require('./codex-cli-provider-suite/part-04.js'),
    require('./codex-cli-provider-suite/part-05.js'),
    require('./codex-cli-provider-suite/part-06.js'),
    require('./codex-cli-provider-suite/part-07.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
