export function createAgentChatRuntimeState() {
  return {
    inFlight: false,
    liveAssistantMessage: null,
    activeClientRequestId: '',
    stopRequested: false,
    stopInProgress: false,
    developerResponseSimulatorFolded: false,
    developerContextPreview: null,
    developerContextPreviewText: ''
  };
}
