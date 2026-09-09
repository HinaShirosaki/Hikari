'use strict';

// Turns the snapshot's workflows, blocks, and notebook runs into the candidate
// list the selection step ranks.
function createDraftCandidates({
  asArray,
  cleanText,
  ensureObject,
  uniqueStrings,
  listAgentProtocols,
  notebookApi
} = {}) {
  function normalizeNotebookState(value) {
    const status = cleanText(value, 40).toLowerCase();
    return ['planned', 'suggested'].includes(status) ? status : 'executed';
  }

  function extractNotebookRuns(snapshot = {}) {
    const experimentRuns = asArray(snapshot?.experimentData?.notebook_runs).map((entry) => {
      const payload = ensureObject(entry);
      return {
        id: cleanText(payload.id, 120),
        project_id: cleanText(payload.project_id || payload.projectId, 120),
        protocol_id: cleanText(payload.protocol_id || payload.protocolId, 120),
        protocol_name: cleanText(payload.protocol_name || payload.protocolName, 220),
        workflow_id: cleanText(payload.workflow_id || payload.workflowId || payload?.agent_draft_meta?.workflowId, 120),
        notebook_state: normalizeNotebookState(payload.notebook_state || payload.notebookState),
        executed_at: cleanText(payload.executed_at || payload.executedAt, 80),
        updated_at: cleanText(payload.updated_at || payload.updatedAt, 80),
        agent_draft_status: cleanText(payload.agent_draft_status || payload.agentDraftStatus, 80),
        proposal_id: cleanText(payload.proposal_id || payload.proposalId || payload?.agent_draft_meta?.proposalId, 160),
        result: cleanText(payload.result, 900)
      };
    }).filter((entry) => entry.id || entry.protocol_id || entry.protocol_name);
    if (experimentRuns.length) {
      return experimentRuns;
    }
    const notebookEntries = typeof notebookApi.listAgentEntries === 'function'
      ? asArray(notebookApi.listAgentEntries({
        snapshot,
        limit: 180
      }))
      : asArray(snapshot?.notebookEntries);
    return notebookEntries.map((entry) => {
      const payload = ensureObject(entry);
      return {
        id: cleanText(payload.id, 120),
        project_id: cleanText(payload.projectId || payload.project_id, 120),
        protocol_id: cleanText(payload.protocolId || payload.protocol_id, 120),
        protocol_name: cleanText(payload.protocolName || payload.protocol_name, 220),
        workflow_id: cleanText(payload?.agentDraftMeta?.workflowId || payload.workflow_id, 120),
        notebook_state: normalizeNotebookState(payload.notebookState || payload.notebook_state),
        executed_at: cleanText(payload.executedAt || payload.executed_at, 80),
        updated_at: cleanText(payload.updatedAt || payload.updated_at, 80),
        agent_draft_status: cleanText(payload.agentDraftStatus || payload.agent_draft_status, 80),
        proposal_id: cleanText(payload?.agentDraftMeta?.proposalId || payload.proposal_id, 160),
        result: cleanText(payload.result, 900)
      };
    }).filter((entry) => entry.id || entry.protocol_id || entry.protocol_name);
  }

  function buildProtocolMap(snapshot = {}) {
    return new Map(
      listAgentProtocols(snapshot)
        .filter((protocol) => protocol.id || protocol.name)
        .map((protocol) => [cleanText(protocol.id, 120), protocol])
        .filter(([id]) => id)
    );
  }

  function normalizeWorkflowBlock(block = {}, index = 0, protocolMap = new Map()) {
    const payload = ensureObject(block);
    const protocolId = cleanText(payload.protocol_id || payload.protocolId, 120);
    const protocol = protocolId ? protocolMap.get(protocolId) || null : null;
    const text = cleanText(payload.text, 400);
    const type = cleanText(payload.type, 40).toLowerCase() === 'text'
      ? 'text'
      : (protocolId ? 'protocol' : (text ? 'text' : 'protocol'));
    return {
      id: cleanText(payload.id, 120) || `block-${index + 1}`,
      type,
      protocol_id: type === 'protocol' ? protocolId : '',
      protocol_name: cleanText(payload.protocol_name || payload.protocolName || protocol?.name, 220),
      text: type === 'text' ? text : '',
      title: type === 'protocol'
        ? (cleanText(protocol?.name, 220) || cleanText(payload.protocol_name || payload.protocolName, 220) || 'Protocol Block')
        : (text || 'Text Block')
    };
  }

  function normalizeWorkflowRecord(workflow = {}, protocolMap = new Map(), index = 0) {
    const payload = ensureObject(workflow);
    const blocks = asArray(payload.blocks).map((block, blockIndex) => normalizeWorkflowBlock(block, blockIndex, protocolMap));
    const links = asArray(payload.links).map((link, linkIndex) => ({
      id: cleanText(link?.id, 120) || `link-${index + 1}-${linkIndex + 1}`,
      from_block_id: cleanText(link?.from_block_id || link?.fromBlockId, 120),
      to_block_id: cleanText(link?.to_block_id || link?.toBlockId, 120)
    })).filter((link) => link.from_block_id && link.to_block_id);
    return {
      id: cleanText(payload.id, 120) || `workflow-${index + 1}`,
      name: cleanText(payload.name, 220),
      description: cleanText(payload.description, 700),
      project_id: cleanText(payload.project_id || payload.projectId, 120),
      project_name: cleanText(payload.project_name || payload.projectName, 220),
      notebook_entry_ids: uniqueStrings(
        payload.notebook_entry_ids !== undefined ? payload.notebook_entry_ids : payload.notebookEntryIds,
        60
      ),
      blocks,
      links,
      updated_at: cleanText(payload.updated_at || payload.updatedAt, 80)
    };
  }

  function createDirectionMaps(workflow = {}) {
    const incoming = new Map();
    const outgoing = new Map();
    asArray(workflow.blocks).forEach((block) => {
      incoming.set(block.id, []);
      outgoing.set(block.id, []);
    });
    asArray(workflow.links).forEach((link) => {
      if (!incoming.has(link.to_block_id) || !outgoing.has(link.from_block_id)) {
        return;
      }
      incoming.get(link.to_block_id).push(link.from_block_id);
      outgoing.get(link.from_block_id).push(link.to_block_id);
    });
    return { incoming, outgoing };
  }

  function resolvePlanningProject({
    snapshot = {},
    selectedProject = {},
    parserPayload = {}
  } = {}) {
    const projects = asArray(snapshot?.projects).map((project) => ({
      id: cleanText(project?.id, 120),
      name: cleanText(project?.name, 220),
      summary: cleanText(project?.summary, 400)
    })).filter((project) => project.id || project.name);
    const parserEntities = ensureObject(parserPayload?.entities);
    const projectId = cleanText(selectedProject?.id, 120);
    const projectName = cleanText(selectedProject?.name, 220);
    const parserProjectName = cleanText(parserEntities.project_name, 220);

    if (projectId) {
      const exact = projects.find((project) => project.id === projectId);
      if (exact) {
        return {
          id: exact.id,
          name: exact.name,
          resolution_source: 'tool_project_id'
        };
      }
    }

    const byName = uniqueStrings([projectName, parserProjectName], 3)
      .map((candidate) => ({
        candidate,
        match: projects.find((project) => project.name.toLowerCase() === candidate.toLowerCase())
          || projects.find((project) => project.name.toLowerCase().includes(candidate.toLowerCase()))
      }))
      .find((row) => row.match);
    if (byName?.match) {
      return {
        id: byName.match.id,
        name: byName.match.name,
        resolution_source: cleanText(byName.candidate, 220) === projectName
          ? 'tool_project_name'
          : 'parser_project_name'
      };
    }

    if (projectName) {
      return {
        id: projectId,
        name: projectName,
        resolution_source: 'tool_project_name_unverified'
      };
    }

    if (parserProjectName) {
      return {
        id: '',
        name: parserProjectName,
        resolution_source: 'parser_project_name_unverified'
      };
    }

    if (projects.length === 1) {
      return {
        id: projects[0].id,
        name: projects[0].name,
        resolution_source: 'single_project_fallback'
      };
    }

    return {
      id: '',
      name: '',
      resolution_source: 'unresolved'
    };
  }

  function buildWorkflowCandidate({
    workflow,
    block,
    trail = [],
    reason = '',
    priority = 0,
    sourceType = 'workflow'
  }) {
    const protocolId = cleanText(block?.protocol_id, 120);
    const protocolName = cleanText(block?.protocol_name, 220);
    return {
      id: uniqueStrings([
        cleanText(workflow?.id, 120),
        cleanText(block?.id, 120),
        protocolId,
        protocolName
      ], 10).join('::') || cleanText(`${sourceType}-${protocolId}-${block?.id}`, 220),
      source_type: sourceType,
      priority: Number(priority) || 0,
      reason: cleanText(reason, 320),
      trail: uniqueStrings(asArray(trail), 6),
      protocol_id: protocolId,
      protocol_name: protocolName,
      workflow: workflow && typeof workflow === 'object'
        ? {
          id: cleanText(workflow.id, 120),
          name: cleanText(workflow.name, 220),
          description: cleanText(workflow.description, 320),
          block_id: cleanText(block?.id, 120),
          block_title: cleanText(block?.title, 220)
        }
        : null
    };
  }

  function collectWorkflowCandidates({
    snapshot = {},
    project = {},
    workflowId = ''
  } = {}) {
    const protocolMap = buildProtocolMap(snapshot);
    const notebookRuns = extractNotebookRuns(snapshot);
    const executedRuns = notebookRuns.filter((entry) => entry.notebook_state === 'executed');
    const plannedRuns = notebookRuns.filter((entry) => entry.notebook_state === 'planned');
    const executedProtocolIds = new Set(
      executedRuns
        .filter((entry) => !project.id || cleanText(entry.project_id, 120) === cleanText(project.id, 120))
        .map((entry) => cleanText(entry.protocol_id, 120))
        .filter(Boolean)
    );
    const plannedWorkflowProtocolKeys = new Set(
      plannedRuns
        .filter((entry) => !project.id || cleanText(entry.project_id, 120) === cleanText(project.id, 120))
        .map((entry) => `${cleanText(entry?.workflow_id, 120)}::${cleanText(entry.protocol_id, 120)}`)
        .filter((key) => key !== '::')
    );

    const workflows = asArray(snapshot?.workflows)
      .map((workflow, index) => normalizeWorkflowRecord(workflow, protocolMap, index))
      .filter((workflow) => (!project.id || workflow.project_id === cleanText(project.id, 120)))
      .filter((workflow) => !workflowId || workflow.id === cleanText(workflowId, 120));

    const candidates = [];
    workflows.forEach((workflow) => {
      const blockById = new Map(asArray(workflow.blocks).map((block) => [block.id, block]));
      const { incoming, outgoing } = createDirectionMaps(workflow);
      const completedBlockIds = asArray(workflow.blocks)
        .filter((block) => block.type === 'protocol')
        .filter((block) => executedProtocolIds.has(block.protocol_id))
        .map((block) => block.id);

      const collectNextProtocol = (startBlockIds, basePriority, reasonPrefix) => {
        asArray(startBlockIds).forEach((startBlockId) => {
          const visited = new Set();
          const queue = asArray(outgoing.get(startBlockId)).map((nextId) => ({
            blockId: nextId,
            trail: []
          }));
          while (queue.length) {
            const current = queue.shift();
            const blockId = cleanText(current?.blockId, 120);
            if (!blockId || visited.has(blockId)) {
              continue;
            }
            visited.add(blockId);
            const block = blockById.get(blockId);
            if (!block) {
              continue;
            }
            if (block.type === 'text') {
              const nextTrail = uniqueStrings([...asArray(current?.trail), cleanText(block.text, 220)], 6);
              asArray(outgoing.get(blockId)).forEach((nextId) => {
                queue.push({
                  blockId: nextId,
                  trail: nextTrail
                });
              });
              continue;
            }
            const workflowProtocolKey = `${workflow.id}::${block.protocol_id}`;
            if (!executedProtocolIds.has(block.protocol_id) && !plannedWorkflowProtocolKeys.has(workflowProtocolKey)) {
              candidates.push(buildWorkflowCandidate({
                workflow,
                block,
                trail: current?.trail,
                reason: `${reasonPrefix}${cleanText(block.title, 220) ? ` ${cleanText(block.title, 220)}` : ''}.`,
                priority: basePriority,
                sourceType: 'workflow'
              }));
            }
          }
        });
      };

      if (completedBlockIds.length) {
        collectNextProtocol(completedBlockIds, 100, 'Downstream workflow step after completed block');
        return;
      }

      const rootProtocolBlocks = asArray(workflow.blocks)
        .filter((block) => !(incoming.get(block.id) || []).length);
      const rootTextBlocks = rootProtocolBlocks.filter((block) => block.type === 'text').map((block) => block.id);
      collectNextProtocol(rootTextBlocks, 70, 'Earliest protocol after workflow note');
      rootProtocolBlocks
        .filter((block) => block.type === 'protocol')
        .forEach((block) => {
          const workflowProtocolKey = `${workflow.id}::${block.protocol_id}`;
          if (!executedProtocolIds.has(block.protocol_id) && !plannedWorkflowProtocolKeys.has(workflowProtocolKey)) {
            candidates.push(buildWorkflowCandidate({
              workflow,
              block,
              trail: [],
              reason: 'Earliest unresolved workflow protocol.',
              priority: 60,
              sourceType: 'workflow'
            }));
          }
        });
    });

    return candidates
      .filter((candidate) => candidate.protocol_id || candidate.protocol_name)
      .sort((left, right) => {
        if (right.priority !== left.priority) {
          return right.priority - left.priority;
        }
        const leftWorkflow = cleanText(left?.workflow?.name, 220);
        const rightWorkflow = cleanText(right?.workflow?.name, 220);
        return rightWorkflow.localeCompare(leftWorkflow);
      });
  }

  return {
    normalizeNotebookState,
    extractNotebookRuns,
    buildProtocolMap,
    normalizeWorkflowBlock,
    normalizeWorkflowRecord,
    createDirectionMaps,
    resolvePlanningProject,
    buildWorkflowCandidate,
    collectWorkflowCandidates
  };
}

module.exports = { createDraftCandidates };
