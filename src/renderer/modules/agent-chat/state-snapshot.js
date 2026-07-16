import { mapExperimentDataToLlmJson } from '../../services/experiment-llm-mapper.js';
import {
  asArray,
  mapPaper,
  mapProject,
  mapWorkflow,
  trimText
} from './shared.js';
import { normalizePreferredJournalList } from '../../lib/preferred-journals.js';

export { mapExperimentDataToLlmJson };

export function mapNotebookEntryForLookupBridge(entry) {
  const source = entry && typeof entry === 'object' ? entry : {};
  return {
    id: trimText(source.id, 120),
    notebookType: trimText(source.notebookType, 80),
    notebookState: trimText(source.notebookState, 80),
    experimentName: trimText(source.experimentName, 220),
    projectId: trimText(source.projectId, 120),
    projectName: trimText(source.projectName, 220),
    protocolId: trimText(source.protocolId, 120),
    protocolName: trimText(source.protocolName, 220),
    result: trimText(source.result, 2400),
    toolCalculations: asArray(source.toolCalculations).slice(0, 8).map((calculation) => ({
      title: trimText(calculation?.title, 220),
      result: trimText(calculation?.result, 600),
      summary: trimText(calculation?.summary, 600),
      formula: trimText(calculation?.formula, 600)
    })),
    createdAt: trimText(source.createdAt, 80),
    updatedAt: trimText(source.updatedAt, 80),
    executedAt: trimText(source.executedAt, 80),
    bridgeSnapshot: true
  };
}

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
  const notebookLookupBridgeEntries = filteredNotebookEntries
    .slice(-60)
    .map(mapNotebookEntryForLookupBridge)
    .filter((entry) => entry.id);
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
  const preferredJournals = Array.from(
    normalizePreferredJournalList([
      state.settings?.preferredJournals,
      state.settings?.preferred_journals,
      state.settings?.preferredJournal,
      state.settings?.preferred_journal
    ]),
    (item) => trimText(item, 240)
  ).filter(Boolean);
  const preferredJournal = preferredJournals.join('; ');
  return {
    projects,
    workflows,
    protocols,
    notebookEntries: [],
    notebook_lookup_bridge: {
      version: 1,
      complete: filteredNotebookEntries.length <= notebookLookupBridgeEntries.length,
      entries: notebookLookupBridgeEntries
    },
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
      preferredJournals,
      preferredJournal,
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
