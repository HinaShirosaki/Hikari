// Codex gate for every AI surface. The state lives on
// <body data-agent-availability="connected|offline">, and CSS hides
// .hikari-agent-action and [data-requires-agent] unless it is "connected".
// The attribute is absent until the first Codex status check, so AI controls
// start hidden instead of flashing on an install without Codex.
export const AGENT_AVAILABILITY_EVENT = 'hikari:agent-availability-changed';

// Expired stored credentials count only when the backend found a refresh token.
export function isCodexConnected(status) {
  return status?.cliAvailable !== false && (status?.loggedIn === true
    || (status?.source === 'stored' && status?.canRefresh === true));
}

export function isAgentAvailable(documentObject = globalThis.document) {
  return documentObject?.body?.dataset?.agentAvailability === 'connected';
}

// Unknown (before the first check) is not offline, so a connected user whose
// startup view is Agent is not bounced while the check is still running.
export function isAgentOffline(documentObject = globalThis.document) {
  return documentObject?.body?.dataset?.agentAvailability === 'offline';
}

export function setAgentAvailability(connected, documentObject = globalThis.document) {
  const dataset = documentObject?.body?.dataset;
  const next = connected ? 'connected' : 'offline';
  if (!dataset || dataset.agentAvailability === next) {
    return;
  }
  dataset.agentAvailability = next;
  const EventCtor = documentObject.defaultView?.CustomEvent || globalThis.CustomEvent;
  if (typeof EventCtor === 'function') {
    documentObject.dispatchEvent(new EventCtor(AGENT_AVAILABILITY_EVENT));
  }
}
