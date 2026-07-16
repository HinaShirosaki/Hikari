import { asArray, trimText } from './shared.js';

export function renderEmptyHistory({ historyNode, state, safeText }) {
  const projectId = trimText(state?.agentChat?.projectId, 120);
  const projectName = asArray(state?.projects).find((project) => trimText(project?.id, 120) === projectId)?.name || '';
  historyNode.innerHTML = `
    <section class="agent-empty-state">
      <p class="agent-empty-kicker">Agent Workspace</p>
      <h3>${safeText(projectName ? `Start a thread for ${projectName}` : 'Start a new lab thread')}</h3>
      <p class="small-note">
        ${safeText(projectName
          ? 'Ask for planning help, notebook lookups, literature grounding, or a next-step recommendation within the selected project.'
          : 'Ask for planning help, notebook lookups, literature grounding, or a next-step recommendation across your lab data.')}
      </p>
      <div class="agent-empty-prompt-list">
        <button type="button" class="ghost-btn agent-empty-prompt" data-agent-suggest-prompt="Summarize the latest progress and open questions for this project.">Summarize recent progress</button>
        <button type="button" class="ghost-btn agent-empty-prompt" data-agent-suggest-prompt="Draft the next experiment I should run and explain why.">Draft the next experiment</button>
        <button type="button" class="ghost-btn agent-empty-prompt" data-agent-suggest-prompt="Find likely causes for a weak assay signal and suggest troubleshooting steps.">Troubleshoot an assay</button>
      </div>
    </section>
  `;
}
