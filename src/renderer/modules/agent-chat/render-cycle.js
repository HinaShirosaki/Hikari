export function renderAgentChat({
  state,
  dom,
  runtime,
  shell,
  sessionManager,
  attachmentsController,
  loadPersistentSessions = true
}) {
  shell.ensureAgentState();
  shell.renderProjectOptions();
  shell.renderScopedComposer();
  shell.renderContextSummary();
  sessionManager.renderSessionList();
  if (loadPersistentSessions) {
    void sessionManager.refreshPersistentSessions();
  }
  shell.syncComposerHeight();
  attachmentsController.render();
  shell.renderHistoryView();
  if (!runtime.inFlight) {
    shell.setStatus('Ready.');
  }
}
