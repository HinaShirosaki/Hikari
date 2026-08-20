export function createAgentChatRuntimeState() {
  return {
    inFlight: false,
    liveAssistantMessage: null,
    activeClientRequestId: '',
    inFlightClientRequestId: '',
    activeRequests: new Map(),
    canceledClientRequestIds: new Set(),
    sendPending: false,
    sessionTransitionPending: false,
    stopRequested: false,
    stopInProgress: false,
  };
}
