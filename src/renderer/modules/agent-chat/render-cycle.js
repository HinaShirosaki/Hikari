import { createPresentation } from "../../lib/i18n/presentation.js";
import "./localization.js";
const i18nUi = createPresentation("agent");
export function renderAgentChat({
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
    shell.setStatus(i18nUi.text("Ready."));
  }
}
