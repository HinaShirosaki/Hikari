import { mapExperimentDataToLlmJson } from '../experiment-llm-mapper.js';
import {
  asArray,
  mapPaper,
  mapProject,
  mapWorkflow,
  trimText
} from './shared.js';

export { mapExperimentDataToLlmJson };

export function buildStateSnapshot(state, projectId) {
  const agentChatContext = state.agentChatContext && typeof state.agentChatContext === 'object'
    ? state.agentChatContext
    : {};
  const filteredProjects = projectId
    ? asArray(state.projects).filter((project) => project.id === projectId)
    : asArray(state.projects);
  const projectIds = new Set(filteredProjects.map((project) => project.id));
  const projectNameById = new Map(asArray(state.projects).map((project) => [String(project.id || ''), trimText(project.name, 180)]));

  const filteredNotebookEntries = asArray(state.notebookEntries)
    .filter((entry) => !projectIds.size || projectIds.has(entry.projectId))
    .slice(-120);
  const protocolIds = new Set(filteredNotebookEntries.map((entry) => String(entry?.protocolId || '')).filter(Boolean));
  const protocolCount = projectIds.size
    ? asArray(state.protocols).filter((protocol) => protocolIds.has(String(protocol?.id || ''))).length
    : asArray(state.protocols).length;
  const protocolNameById = new Map(asArray(state.protocols).map((protocol) => [String(protocol.id || ''), trimText(protocol.name, 180)]));

  const workflows = asArray(state.workflows)
    .filter((workflow) => !projectIds.size || projectIds.has(String(workflow?.projectId || '')))
    .slice(0, 80)
    .map((workflow) => mapWorkflow(workflow, protocolNameById, projectNameById));

  const papers = asArray(state.papers)
    .filter((paper) => !projectIds.size || (paper.linkedType === 'project' && projectIds.has(paper.linkedId)))
    .slice(0, 60)
    .map(mapPaper);
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
  const paperAgentSessionPrompt = trimText(agentChatContext.sessionPrompt, 2400);
  const protocols = asArray(state.protocols)
    .slice(0, 120)
    .map((protocol) => ({
      id: trimText(protocol?.id, 120),
      name: trimText(protocol?.name, 220),
      purpose: trimText(protocol?.purpose || protocol?.description, 700),
      projectId: trimText(protocol?.projectId, 120),
      projectName: trimText(protocol?.projectName, 220),
      aliases: asArray(protocol?.aliases).map((alias) => trimText(alias, 120)).filter(Boolean).slice(0, 8),
      steps: asArray(protocol?.steps).slice(0, 120).map((step, stepIndex) => ({
        id: trimText(step?.id, 120) || `step-${stepIndex + 1}`,
        text: trimText(step?.text || step?.instruction || step?.action, 1200),
        placeholders: asArray(step?.placeholders).slice(0, 40).map((placeholder, placeholderIndex) => ({
          id: trimText(placeholder?.id, 120) || `ph-${stepIndex + 1}-${placeholderIndex + 1}`,
          name: trimText(placeholder?.name, 120) || 'value'
        }))
      }))
    }))
    .filter((protocol) => protocol.id || protocol.name);

  const projects = filteredProjects.slice(0, 30).map(mapProject);
  const experimentData = mapExperimentDataToLlmJson(state, projectId);
  const assays = asArray(experimentData.assay_runs).slice(0, 80);
  const gelAnalyses = asArray(experimentData.gel_runs).slice(0, 80);
  const personalSections = Object.entries(state?.inventory || {});
  const personalItemCount = personalSections.reduce((count, [, items]) => count + asArray(items).length, 0);
  const chemicalCount = asArray(state?.labInventory?.chemicals).length;
  return {
    projects,
    workflows,
    protocols,
    notebookEntries: [],
    assays,
    gelAnalyses,
    experimentData,
    papers,
    activePaper: activePaperRecord,
    paper_agent: activePaperRecord ? {
      active_paper_id: trimText(agentChatContext.paperId || activePaperRecord.id, 220),
      active_paper_title: trimText(agentChatContext.paperTitle || activePaperRecord.title, 320),
      session_prompt: paperAgentSessionPrompt,
      transformed_markdown_relative_path: activePaperMarkdownPath,
      knowledge_status: trimText(agentChatContext.knowledgeStatus || activePaperRecord.knowledge_status, 80),
      has_transformed_markdown: Boolean(activePaperMarkdownPath)
    } : null,
    inventory: {
      personal: [],
      chemicals: []
    },
    snapshot_mode: 'thin',
    context_counts: {
      projects: projects.length,
      protocols: protocolCount,
      workflows: workflows.length,
      notebookEntries: filteredNotebookEntries.length,
      assays: assays.length,
      gelAnalyses: gelAnalyses.length,
      papers: papers.length,
      active_paper: activePaper ? 1 : 0,
      inventory_chemicals: chemicalCount,
      inventory_personal_sections: personalSections.length,
      inventory_personal_items: personalItemCount
    },
    data_file_path: '',
    settings: {
      storagePath: trimText(state.settings?.storagePath, 1200),
      preferredJournal: trimText(state.settings?.preferredJournal, 1200),
      agent: {
        externalSkillsEnabled: state.settings?.agent?.externalSkillsEnabled !== false,
        disabledExternalSkillNames: asArray(state.settings?.agent?.disabledExternalSkillNames)
          .map((item) => trimText(item, 160))
          .filter(Boolean)
      }
    },
    timestamp: new Date().toISOString()
  };
}
