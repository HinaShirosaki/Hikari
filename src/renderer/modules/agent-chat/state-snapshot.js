import { mapExperimentDataToLlmJson } from './experiment-llm-mapper.js';
import { asArray, mapPaper, trimText } from './shared.js';
import { normalizePreferredJournalList } from '../../lib/preferred-journals.js';

export { mapExperimentDataToLlmJson };

// Request context sent with each agent request: settings and the active paper.
// No workspace records: the request saves to storage first, and every agent tool
// reads protocols, notebook pages, projects, papers and plates from storage
// (runAgentTool). Module context such as the active plate is injected by its module.
export function buildStateSnapshot(state) {
  const agentChatContext = state.agentChatContext && typeof state.agentChatContext === 'object'
    ? state.agentChatContext
    : {};
  const activePaperId = trimText(agentChatContext.paperId, 120);
  const activePaper = activePaperId
    ? asArray(state.papers).find((paper) => trimText(paper?.id, 120) === activePaperId)
    : null;
  const activePaperRecord = activePaper ? mapPaper(activePaper) : null;
  const activePaperMarkdownPath = trimText(
    agentChatContext.knowledgeMarkdownRelativePath
      || activePaperRecord?.transformed_markdown_relative_path
      || activePaperRecord?.knowledge_markdown_relative_path,
    2400
  );
  const preferredJournals = Array.from(
    normalizePreferredJournalList([
      state.settings?.preferredJournals,
      state.settings?.preferred_journals,
      state.settings?.preferredJournal,
      state.settings?.preferred_journal
    ]),
    (item) => trimText(item, 240)
  ).filter(Boolean);
  return {
    activePaper: activePaperRecord,
    paper_agent: activePaperRecord ? {
      active_paper_id: trimText(agentChatContext.paperId || activePaperRecord.id, 220),
      active_paper_title: trimText(agentChatContext.paperTitle || activePaperRecord.title, 320),
      session_prompt: trimText(agentChatContext.sessionPrompt, 2400),
      transformed_markdown_relative_path: activePaperMarkdownPath,
      knowledge_status: trimText(agentChatContext.knowledgeStatus || activePaperRecord.knowledge_status, 80),
      has_transformed_markdown: Boolean(activePaperMarkdownPath)
    } : null,
    data_file_path: '',
    settings: {
      storagePath: trimText(state.settings?.storagePath, 1200),
      preferredJournals,
      preferredJournal: preferredJournals.join('; '),
      agent: {
        externalSkillsEnabled: state.settings?.agent?.externalSkillsEnabled !== false,
        disabledExternalSkillNames: asArray(state.settings?.agent?.disabledExternalSkillNames)
          .map((item) => trimText(item, 160))
          .filter(Boolean),
        disabledMcpToolNames: asArray(state.settings?.agent?.disabledMcpToolNames)
          .map((item) => trimText(item, 160))
          .filter(Boolean)
      }
    },
    timestamp: new Date().toISOString()
  };
}
