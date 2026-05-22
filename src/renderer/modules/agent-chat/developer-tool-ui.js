import * as developerToolsModule from './developer-tools.js';

export function createDeveloperToolUi({
  dom,
  safeText
}) {
  function renderDeveloperToolHint() {
    developerToolsModule.renderDeveloperToolHint({
      developerToolSelect: dom.developerToolSelect,
      developerToolHint: dom.developerToolHint,
      developerToolMessageInput: dom.developerToolMessageInput
    });
  }

  function renderDeveloperToolOptions() {
    developerToolsModule.renderDeveloperToolOptions({
      developerToolSelect: dom.developerToolSelect,
      safeText,
      renderDeveloperToolHint
    });
  }

  return {
    renderDeveloperToolHint,
    renderDeveloperToolOptions
  };
}
