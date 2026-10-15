'use strict';

// Account catalog for execution fixtures. Status preflight must work before a
// prompt is accepted, just as it does with a real signed-in CLI.
module.exports = function serveCodexCatalog() {
  const lines = require('node:readline').createInterface({ input: process.stdin });
  lines.on('line', line => {
    const message = JSON.parse(line);
    if (message.id === undefined) return;
    const result = message.method === 'model/list' ? {
      data: ['gpt-5.4', 'gpt-5.1-codex-mini'].map((id, index) => ({
        id, isDefault: index === 0, defaultReasoningEffort: 'medium',
        supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'].map(reasoningEffort => ({ reasoningEffort }))
      })), nextCursor: null
    } : {};
    process.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`);
  });
};
