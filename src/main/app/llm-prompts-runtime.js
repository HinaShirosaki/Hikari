'use strict';

function normalizeLlmPromptPayload(parsed) {
  const source = parsed && typeof parsed === 'object' ? parsed : {};
  const agent = source.agent && typeof source.agent === 'object' ? source.agent : {};
  return { agent };
}

function createLlmPromptsRuntime({ fs, promptsFilePath, consoleObject = console } = {}) {
  let llmPromptsCache = null;
  let llmPromptsPromise = null;

  async function loadLlmPrompts() {
    if (llmPromptsCache) {
      return llmPromptsCache;
    }

    if (!llmPromptsPromise) {
      llmPromptsPromise = fs.readFile(promptsFilePath, 'utf8')
        .then((raw) => JSON.parse(raw))
        .then((parsed) => {
          llmPromptsCache = normalizeLlmPromptPayload(parsed);
          return llmPromptsCache;
        })
        .catch((error) => {
          consoleObject.error('Failed to load LLM prompts config:', error);
          llmPromptsCache = normalizeLlmPromptPayload({});
          return llmPromptsCache;
        });
    }

    return llmPromptsPromise;
  }

  return {
    loadLlmPrompts
  };
}

module.exports = {
  createLlmPromptsRuntime
};
