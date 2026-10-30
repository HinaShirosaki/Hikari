import { createPresentation } from "../../lib/i18n/presentation.js";
import "./localization.js";
const i18nUi = createPresentation("agent");
import { asArray, trimText } from './shared.js';
import { agentMessage } from './localization.js';

export function renderEmptyHistory({ historyNode, state }) {
  const projectId = trimText(state?.agentChat?.projectId, 120);
  const projectName = asArray(state?.projects).find((project) => trimText(project?.id, 120) === projectId)?.name || '';
  i18nUi.setHtml(historyNode, `
    <section class="agent-empty-state">
      <p class="agent-empty-kicker">${agentMessage('empty.kicker')}</p>
      <h3>${projectName ? agentMessage('empty.titleProject', { project: projectName }) : agentMessage('empty.title')}</h3>
      <p class="small-note">
        ${agentMessage(projectName ? 'empty.bodyProject' : 'empty.body')}
      </p>
    </section>
  `);
}
