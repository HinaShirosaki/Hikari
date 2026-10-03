'use strict';

const { transformPaperRecordsToMarkdown } = require('../../papers/parse/paper-markdown-import.js');

// Storage scans and root imports do not pass through the renderer upload gate.
function createPaperImportTransformer({
  getCodexLoginStatus,
  getCodexCliWorkingDirectory,
  paperKnowledgeDatabaseRuntime
} = {}) {
  return async (input = {}) => {
    let paperIntake = false;
    if (input.paperIntake !== false) {
      try {
        const status = await getCodexLoginStatus({ cwd: getCodexCliWorkingDirectory(), forceRefresh: true });
        paperIntake = status.cliAvailable !== false && (status.loggedIn === true
          || (status.source === 'stored' && status.canRefresh === true));
      } catch {
        // Keep local extraction available when account status cannot be checked.
      }
    }
    return transformPaperRecordsToMarkdown({
      ...input,
      paperIntake,
      paperKnowledgeDatabaseRuntime
    });
  };
}

module.exports = { createPaperImportTransformer };
