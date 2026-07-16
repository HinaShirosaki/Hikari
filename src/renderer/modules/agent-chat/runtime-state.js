export function createAgentChatRuntimeState() {
  return {
    inFlight: false,
    liveAssistantMessage: null,
    activeClientRequestId: '',
    inFlightClientRequestId: '',
    activeRequests: new Map(),
    canceledClientRequestIds: new Set(),
    stopRequested: false,
    stopInProgress: false,
    developerResponseSimulatorFolded: false,
    developerContextPreview: null,
    developerContextPreviewText: ''
  };
}
