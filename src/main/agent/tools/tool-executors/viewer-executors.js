'use strict';

const { ensureObject } = require('../../../lib/normalize.js');


function registerViewerToolExecutors(genericAgentToolRuntime, context = {}) {
  const {
    cleanText,
    sequenceAgentRuntime
  } = context;

  async function runSequenceAgentAction(toolName, args = {}) {
    if (!sequenceAgentRuntime || typeof sequenceAgentRuntime.invoke !== 'function') {
      return {
        ok: false,
        status: 'error',
        error: 'Sequence-viewer runtime is not configured.',
        summary: 'Sequence-viewer runtime is not configured.'
      };
    }
    const action = cleanText(args?.action, 60);
    const result = await sequenceAgentRuntime.invoke(action, ensureObject(args));
    const payload = ensureObject(result);
    const errorMessage = cleanText(payload?.error?.message || payload?.error, 1200);
    const ok = !errorMessage && payload?.pending_approval !== false;
    return {
      ...payload,
      ok: ok !== false && !errorMessage,
      status: errorMessage
        ? cleanText(payload?.error?.code, 60) || 'error'
        : (payload?.pending_approval ? 'pending_approval' : 'completed'),
      action,
      error: errorMessage,
      summary: cleanText(payload?.summary, 320)
        || (errorMessage
          ? errorMessage
          : (payload?.pending_approval
            ? `${toolName} prepared a proposal for approval.`
            : `${toolName} ${action || 'action'} completed.`))
    };
  }

  genericAgentToolRuntime.registerToolExecutor('sequence-viewer', async ({ args }) => (
    runSequenceAgentAction('sequence-viewer', args)
  ));

  genericAgentToolRuntime.registerToolExecutor('sequence-edit', async ({ args }) => (
    runSequenceAgentAction('sequence-edit', args)
  ));
}

module.exports = { registerViewerToolExecutors };
