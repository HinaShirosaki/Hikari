export function createAlignmentStateActions(ctx) {
  const { state, controllers } = ctx;

  function resetAlignmentState(options = {}) {
    const preserveSessions = options?.preserveSessions === true;
    if (!preserveSessions) {
      state.alignmentSessions = [];
    }
    state.activeAlignmentSessionId = '';
    state.activeAlignmentSessionName = '';
    state.activeAlignmentResult = null;
    state.activeAlignmentQueryRecord = null;
    state.alignmentViewEnabled = false;
  }

  function setAlignmentSessions(sessions) {
    state.alignmentSessions = Array.isArray(sessions) ? sessions : [];
    if (!state.activeAlignmentSessionId) {
      controllers.detail?.syncAlignmentControlsState?.();
      return;
    }

    const activeSession = state.alignmentSessions.find((session) => String(session?.id || '') === String(state.activeAlignmentSessionId));
    if (!activeSession) {
      resetAlignmentState({ preserveSessions: true });
    } else {
      state.activeAlignmentSessionName = String(activeSession?.name || activeSession?.queryRecord?.name || '').trim();
      state.activeAlignmentResult = activeSession?.result || state.activeAlignmentResult;
      state.activeAlignmentQueryRecord = activeSession?.queryRecord || state.activeAlignmentQueryRecord;
    }
    controllers.detail?.syncAlignmentControlsState?.();
  }

  return {
    resetAlignmentState,
    setAlignmentSessions
  };
}
