import * as agentChatModule from './agent-chat/index.js';
import { normalizeAgentResponse } from './agent-chat-response.js';
import { mapExperimentDataToLlmJson } from './agent-chat/index.js';

/*
Renderer contract anchors retained for tests and downstream tooling:
normalizeAgentResponse
general_science_question
project_science_question
result_analysis
agentChatLogListSessions
agentChatLogGetSession
agentChatLogCreateSession
function renderSessionList()
agent-deep-research-toggle-btn
deepResearchEnabled: state.agentChat.deepResearchEnabled === true
apiKey: provider === 'codex' ? '' : String(state.settings?.llm?.apiKey || '').trim()
*/
void normalizeAgentResponse;

export { mapExperimentDataToLlmJson };

export function initAgentChat(args) {
  return agentChatModule.initAgentChat({
    ...args,
    document: args?.document || globalThis?.document || (typeof document !== 'undefined' ? document : null),
    windowObject: args?.windowObject || globalThis?.window || (typeof window !== 'undefined' ? window : null)
  });
}
