'use strict';

const { createAgentLlmRuntimeHelpers } = require('../shared/agent-llm-utils.js');
const { resolveAgentRuntimeFactory } = require('../shared/agent-runtime-registry.js');
const { createProtocolMatchingRuntime } = require('./agent-protocol-matching.js');
const { createNotebookGenerationRuntime } = require('./agent-notebook-generation.js');

function defaultEnsureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneJson(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function createNotebookDraftRuntime(deps = {}) {
  const {
    asArray,
    cleanText,
    uniqueStrings,
    requestStructuredJsonPayload,
    recordAgentLlmTrace
  } = createAgentLlmRuntimeHelpers(deps);
  const ensureObject = typeof deps.ensureObject === 'function' ? deps.ensureObject : defaultEnsureObject;
  const recordLifecycleEvent = typeof deps.recordLifecycleEvent === 'function'
    ? deps.recordLifecycleEvent
    : (() => {});
  const now = typeof deps.now === 'function'
    ? deps.now
    : (() => new Date().toISOString());
  const createProposalId = typeof deps.createProposalId === 'function'
    ? deps.createProposalId
    : (() => `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  const protocolMatchingFactory = resolveAgentRuntimeFactory(deps, 'protocol-matching');
  const notebookGenerationFactory = resolveAgentRuntimeFactory(deps, 'notebook-generation');
  const protocolMatchingRuntime = typeof protocolMatchingFactory === 'function'
    ? protocolMatchingFactory({
      ...deps,
      ensureObject
    })
    : createProtocolMatchingRuntime({
      ...deps,
      ensureObject
    });
  const notebookGenerationRuntime = typeof notebookGenerationFactory === 'function'
    ? notebookGenerationFactory({
      ...deps,
      ensureObject,
      runTool: null
    })
    : createNotebookGenerationRuntime({
      ...deps,
      ensureObject,
      runTool: null
    });
  const agentAppApi = deps.agentAppApi && typeof deps.agentAppApi === 'object'
    ? deps.agentAppApi
    : {};
  const protocolApi = agentAppApi.protocol && typeof agentAppApi.protocol === 'object'
    ? agentAppApi.protocol
    : {};
  const notebookApi = agentAppApi.notebook && typeof agentAppApi.notebook === 'object'
    ? agentAppApi.notebook
    : {};

  function normalizeProtocolRecord(protocol, index = 0) {
    if (typeof protocolApi.normalizeAgentProtocol === 'function') {
      return protocolApi.normalizeAgentProtocol(protocol, index);
    }
    return protocolMatchingRuntime.normalizeProtocolRecord(protocol, index);
  }

  function listAgentProtocols(snapshot = {}, options = {}) {
    if (typeof protocolApi.listAgentProtocols === 'function') {
      return asArray(protocolApi.listAgentProtocols({
        snapshot,
        ...options
      })).map((protocol, index) => normalizeProtocolRecord(protocol, index));
    }
    return asArray(snapshot?.protocols).map((protocol, index) => normalizeProtocolRecord(protocol, index));
  }

  function rankAgentProtocols(input = {}) {
    if (typeof protocolApi.rankAgentProtocols === 'function') {
      return protocolApi.rankAgentProtocols(input);
    }
    return protocolMatchingRuntime.rankProtocolMatches(input);
  }

  async function generateNotebookFromProtocol(input = {}) {
    if (typeof notebookApi.generateFromProtocol === 'function') {
      return notebookApi.generateFromProtocol(input);
    }
    return notebookGenerationRuntime.generateNotebook(input);
  }

  const NOTEBOOK_DRAFT_SELECTION_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: [
      'selected_candidate_id',
      'title',
      'purpose',
      'rationale',
      'planned_materials',
      'checkpoints'
    ],
    properties: {
      selected_candidate_id: {
        anyOf: [{ type: 'string' }, { type: 'null' }]
      },
      title: {
        anyOf: [{ type: 'string' }, { type: 'null' }]
      },
      purpose: {
        anyOf: [{ type: 'string' }, { type: 'null' }]
      },
      rationale: {
        anyOf: [{ type: 'string' }, { type: 'null' }]
      },
      planned_materials: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 10
      },
      checkpoints: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 10
      }
    }
  };

  const NOTEBOOK_DRAFT_SELECTION_SYSTEM_PROMPT = [
    'You propose the most likely next experiment and prepare planning notes for a future notebook draft.',
    'Choose exactly one candidate from the app-provided list.',
    'Prefer downstream workflow steps, recent executed progress, and project consistency.',
    'Use evidence context when provided to choose a better next experiment and to justify the plan.',
    'Return JSON only.'
  ].join(' ');

  const NOTEBOOK_DRAFT_SELECTION_RULES = [
    'Choose one candidate that best represents the most plausible next experiment.',
    'Prefer candidates that are downstream from already executed workflow blocks.',
    'Do not invent protocol IDs, workflow IDs, or unsupported materials.',
    'Write concise planning text suited for a notebook draft that the user will edit later.',
    'If the candidate already includes checklist text from workflow notes, convert it into checkpoints when helpful.',
    'When evidence context is provided, incorporate supported paper or record findings into the rationale and checkpoints.'
  ];

  function normalizeEvidenceContext(rawEvidence = []) {
    return asArray(rawEvidence).map((item) => {
      const source = ensureObject(item);
      return {
        tool_name: cleanText(source.tool_name || source.toolName, 120),
        status: cleanText(source.status, 80),
        summary: cleanText(source.summary, 900),
        item_count: Number.isFinite(Number(source.item_count || source.itemCount))
          ? Number(source.item_count || source.itemCount)
          : asArray(source.items).length,
        citations: asArray(source.citations).slice(0, 6).map((citation) => ({
          source: cleanText(citation?.source, 120),
          pointer: cleanText(citation?.pointer, 260),
          reason: cleanText(citation?.reason, 260)
        })).filter((citation) => citation.source || citation.pointer || citation.reason)
      };
    }).filter((item) => item.tool_name || item.summary);
  }

  function buildNotebookDraftSelectionPrompt({
    message,
    conversation,
    parserPayload,
    project,
    notebookRuns,
    candidates,
    evidenceContext = []
  } = {}) {
    const promptConversation = asArray(conversation).slice(-8).map((row, index) => {
      const role = row?.role === 'assistant' ? 'assistant' : 'user';
      const text = cleanText(row?.text, 1200);
      return text ? `${index + 1}. ${role}: ${text}` : '';
    }).filter(Boolean).join('\n');
    return [
      ...NOTEBOOK_DRAFT_SELECTION_RULES,
      `User message: ${cleanText(message, 3200)}`,
      promptConversation ? `Recent conversation:\n${promptConversation}` : '',
      `Parser JSON:\n${JSON.stringify(parserPayload || {}, null, 2)}`,
      `Resolved project JSON:\n${JSON.stringify(project || {}, null, 2)}`,
      `Recent notebook runs JSON:\n${JSON.stringify(asArray(notebookRuns).slice(0, 12), null, 2)}`,
      `Candidate experiments JSON:\n${JSON.stringify(asArray(candidates).slice(0, 6), null, 2)}`,
      asArray(evidenceContext).length
        ? `Evidence context JSON:\n${JSON.stringify(normalizeEvidenceContext(evidenceContext).slice(0, 6), null, 2)}`
        : ''
    ].filter(Boolean).join('\n\n');
  }

  function normalizeNotebookState(value) {
    return cleanText(value, 40).toLowerCase() === 'planned' ? 'planned' : 'executed';
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
    const executedRuns = notebookRuns.filter((entry) => entry.notebook_state !== 'planned');
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

  async function collectProtocolOnlyCandidates({
    snapshot = {},
    parserPayload = {},
    message = '',
    protocolCandidates = []
  } = {}) {
    const protocols = listAgentProtocols(snapshot);
    const ranked = rankAgentProtocols({
      snapshot,
      protocols,
      protocolCandidates,
      message,
      parserPayload
    });
    return asArray(ranked).slice(0, 3).map((match) => ({
      id: uniqueStrings(['protocol-only', cleanText(match?.id, 120), cleanText(match?.name, 220)], 5).join('::'),
      source_type: 'protocol_match',
      priority: 40,
      reason: 'Protocol matched directly from the planning request.',
      trail: [],
      protocol_id: cleanText(match?.id, 120),
      protocol_name: cleanText(match?.name, 220),
      workflow: null
    }));
  }

  async function requestNotebookDraftSelection({
    provider,
    endpoint,
    apiKey,
    model,
    message,
    conversation,
    parserPayload,
    project,
    notebookRuns,
    candidates,
    evidenceContext = [],
    traceContext = null
  } = {}) {
    return requestStructuredJsonPayload({
      stage: 'notebook_draft_selection',
      systemPrompt: NOTEBOOK_DRAFT_SELECTION_SYSTEM_PROMPT,
      userPrompt: buildNotebookDraftSelectionPrompt({
        message,
        conversation,
        parserPayload,
        project,
        notebookRuns,
        candidates,
        evidenceContext
      }),
      schema: NOTEBOOK_DRAFT_SELECTION_SCHEMA,
      traceContext,
      defaultError: 'Notebook draft proposal provider is not configured.'
    });
  }

  function buildFallbackProposal(candidate = {}, selectedProtocol = {}, evidenceContext = []) {
    const workflowName = cleanText(candidate?.workflow?.name, 220);
    const protocolName = cleanText(selectedProtocol?.name || candidate?.protocol_name, 220) || 'Next Experiment';
    const trail = asArray(candidate?.trail).map((item) => cleanText(item, 220)).filter(Boolean);
    const evidenceSummaries = normalizeEvidenceContext(evidenceContext)
      .map((item) => cleanText(item.summary, 240))
      .filter(Boolean)
      .slice(0, 3);
    return {
      title: workflowName
        ? `${protocolName} (${workflowName})`
        : protocolName,
      purpose: workflowName
        ? `Advance the next planned step in ${workflowName}.`
        : `Prepare the next likely experiment using ${protocolName}.`,
      rationale: cleanText([
        cleanText(candidate?.reason, 320) || 'This protocol is the strongest next-step candidate from local workflow and notebook context.',
        evidenceSummaries.length ? `Evidence considered: ${evidenceSummaries.join(' ')}` : ''
      ].filter(Boolean).join(' '), 700),
      planned_materials: uniqueStrings([
        ...asArray(selectedProtocol?.materials).slice(0, 5),
        protocolName
      ], 6),
      checkpoints: uniqueStrings([
        ...trail,
        cleanText(candidate?.reason, 220),
        ...evidenceSummaries
      ], 6)
    };
  }

  function renderPlannedResultText({
    title = '',
    purpose = '',
    rationale = '',
    plannedMaterials = [],
    checkpoints = []
  } = {}) {
    const lines = [];
    const cleanTitle = cleanText(title, 220);
    const cleanPurpose = cleanText(purpose, 700);
    const cleanRationale = cleanText(rationale, 700);
    if (cleanTitle) {
      lines.push(`Planned Experiment: ${cleanTitle}`);
    }
    if (cleanPurpose) {
      lines.push(`Purpose: ${cleanPurpose}`);
    }
    if (cleanRationale) {
      lines.push(`Why this next: ${cleanRationale}`);
    }
    if (asArray(plannedMaterials).length) {
      lines.push('Planned Materials:');
      asArray(plannedMaterials).forEach((item) => {
        const cleanItem = cleanText(item, 180);
        if (cleanItem) {
          lines.push(`- ${cleanItem}`);
        }
      });
    }
    if (asArray(checkpoints).length) {
      lines.push('Checkpoints:');
      asArray(checkpoints).forEach((item) => {
        const cleanItem = cleanText(item, 220);
        if (cleanItem) {
          lines.push(`- ${cleanItem}`);
        }
      });
    }
    return cleanText(lines.join('\n'), 3000);
  }

  function decorateNotebookDraft({
    notebook,
    candidate,
    proposal,
    evidenceContext = [],
    missingPlaceholders = []
  }) {
    const generatedAt = now();
    const clonedNotebook = cloneJson(notebook, {});
    const proposalId = createProposalId();
    const proposalPayload = {
      proposal_id: proposalId,
      title: cleanText(proposal?.title, 220) || cleanText(candidate?.protocol_name, 220) || 'Planned Experiment',
      purpose: cleanText(proposal?.purpose, 700),
      rationale: cleanText(proposal?.rationale, 700) || cleanText(candidate?.reason, 320),
      planned_materials: uniqueStrings(asArray(proposal?.planned_materials), 8),
      checkpoints: uniqueStrings(asArray(proposal?.checkpoints), 8),
      evidence_context: normalizeEvidenceContext(evidenceContext).slice(0, 6),
      workflow: candidate?.workflow && typeof candidate.workflow === 'object'
        ? {
          id: cleanText(candidate.workflow.id, 120),
          name: cleanText(candidate.workflow.name, 220),
          block_id: cleanText(candidate.workflow.block_id, 120),
          block_title: cleanText(candidate.workflow.block_title, 220)
        }
        : null
    };
    const plannedResult = renderPlannedResultText({
      title: proposalPayload.title,
      purpose: proposalPayload.purpose,
      rationale: proposalPayload.rationale,
      plannedMaterials: proposalPayload.planned_materials,
      checkpoints: proposalPayload.checkpoints
    });

    clonedNotebook.proposal = proposalPayload;
    clonedNotebook.save = {
      mode: 'confirm_before_save',
      applied: false,
      status: 'awaiting_user_confirmation',
      reason: 'Planned notebook draft is ready to create after confirmation.'
    };
    clonedNotebook.entry_template = ensureObject(clonedNotebook.entry_template);
    clonedNotebook.entry_template.result = plannedResult || cleanText(clonedNotebook.entry_template.result, 900);
    clonedNotebook.entry_template.updatedAt = generatedAt;
    clonedNotebook.entry_template.notebookState = 'planned';
    clonedNotebook.entry_template.executedAt = '';
    clonedNotebook.entry_template.agentDraftStatus = cleanText(
      clonedNotebook.entry_template.agentDraftStatus,
      80
    ) || (asArray(missingPlaceholders).length ? 'needs_review' : 'draft_ready');
    clonedNotebook.entry_template.agentDraftMeta = {
      ...ensureObject(clonedNotebook.entry_template.agentDraftMeta),
      source: 'agent_notebook_draft_v1',
      proposalId,
      workflowId: cleanText(candidate?.workflow?.id, 120),
      evidenceToolNames: uniqueStrings(
        normalizeEvidenceContext(evidenceContext).map((item) => item.tool_name),
        8
      ),
      suggestedAt: generatedAt
    };

    return clonedNotebook;
  }

  async function generateNotebookDraft({
    provider,
    endpoint,
    apiKey,
    model,
    message,
    conversation,
    snapshot,
    parserPayload,
    project: selectedProject = {},
    workflowId = '',
    protocolCandidates = [],
    evidenceContext = [],
    traceContext = null,
    lifecycleRecorder = null
  } = {}) {
    const resolvedProject = resolvePlanningProject({
      snapshot,
      selectedProject,
      parserPayload
    });
    const protocols = listAgentProtocols(snapshot);
    if (!protocols.length) {
      return {
        status: 'needs_more_info',
        project_name: cleanText(resolvedProject.name, 220),
        selected_protocol: null,
        source_workflow: null,
        missing_placeholders: [],
        follow_up_questions: ['No local protocols are available. Please add or import a protocol first.'],
        proposal_summary: '',
        proposal: null,
        notebook: null,
        summary: 'No local protocols are available.'
      };
    }

    if (!resolvedProject.id && !resolvedProject.name) {
      return {
        status: 'needs_more_info',
        project_name: '',
        selected_protocol: null,
        source_workflow: null,
        missing_placeholders: [],
        follow_up_questions: ['Please choose which project should receive the planned notebook draft.'],
        proposal_summary: '',
        proposal: null,
        notebook: null,
        summary: 'Project scope is required before planning a notebook draft.'
      };
    }

    const parserProtocolCandidates = uniqueStrings([
      ...asArray(protocolCandidates),
      ...asArray(parserPayload?.protocol_candidates)
    ], 5);
    const workflowCandidates = collectWorkflowCandidates({
      snapshot,
      project: resolvedProject,
      workflowId
    });
    const directProtocolCandidates = await collectProtocolOnlyCandidates({
      snapshot,
      parserPayload,
      message,
      protocolCandidates: parserProtocolCandidates
    });
    const candidates = uniqueStrings(
      [
        ...workflowCandidates.map((candidate) => candidate.id),
        ...directProtocolCandidates.map((candidate) => candidate.id)
      ],
      20
    ).map((candidateId) => (
      workflowCandidates.find((candidate) => candidate.id === candidateId)
      || directProtocolCandidates.find((candidate) => candidate.id === candidateId)
    )).filter(Boolean);

    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'notebook_draft_candidates',
      status: candidates.length ? 'ok' : 'pending',
      message: `Notebook draft candidates=${candidates.length}.`,
      meta: {
        workflow_id: cleanText(workflowId, 120),
        project_id: cleanText(resolvedProject.id, 120)
      }
    });
    await recordAgentLlmTrace(traceContext, {
      stage: 'notebook_draft_candidates',
      summary: `Collected ${candidates.length} notebook draft candidates.`,
      request_payload: {
        project: resolvedProject,
        workflow_id: cleanText(workflowId, 120),
        parser_protocol_candidates: parserProtocolCandidates
      },
      response_payload: {
        candidates: asArray(candidates).slice(0, 6)
      }
    });

    if (!candidates.length) {
      return {
        status: 'needs_more_info',
        project_name: cleanText(resolvedProject.name, 220),
        selected_protocol: null,
        source_workflow: null,
        missing_placeholders: [],
        follow_up_questions: ['I could not infer the next protocol. Please name the workflow or protocol you want drafted.'],
        proposal_summary: '',
        proposal: null,
        notebook: null,
        summary: 'No viable next-step protocol candidate was found.'
      };
    }

    const notebookRuns = extractNotebookRuns(snapshot)
      .filter((entry) => cleanText(entry.project_id, 120) === cleanText(resolvedProject.id, 120))
      .slice(0, 12);
    const normalizedEvidenceContext = normalizeEvidenceContext(evidenceContext);
    let selectedCandidate = candidates[0];
    let proposalFields = buildFallbackProposal(
      selectedCandidate,
      protocols.find((protocol) => protocol.id === selectedCandidate.protocol_id),
      normalizedEvidenceContext
    );
    const llmSelection = await requestNotebookDraftSelection({
      provider,
      endpoint,
      apiKey,
      model,
      message,
      conversation,
      parserPayload,
      project: resolvedProject,
      notebookRuns,
      candidates,
      evidenceContext: normalizedEvidenceContext,
      traceContext
    });
    if (llmSelection?.ok && llmSelection?.payload) {
      const selectedCandidateId = cleanText(llmSelection.payload.selected_candidate_id, 220);
      const llmCandidate = selectedCandidateId
        ? candidates.find((candidate) => candidate.id === selectedCandidateId)
        : null;
      if (llmCandidate) {
        selectedCandidate = llmCandidate;
      }
      proposalFields = {
        title: cleanText(llmSelection.payload.title, 220) || proposalFields.title,
        purpose: cleanText(llmSelection.payload.purpose, 700) || proposalFields.purpose,
        rationale: cleanText(llmSelection.payload.rationale, 700) || proposalFields.rationale,
        planned_materials: uniqueStrings(asArray(llmSelection.payload.planned_materials), 8).length
          ? uniqueStrings(asArray(llmSelection.payload.planned_materials), 8)
          : proposalFields.planned_materials,
        checkpoints: uniqueStrings(asArray(llmSelection.payload.checkpoints), 8).length
          ? uniqueStrings(asArray(llmSelection.payload.checkpoints), 8)
          : proposalFields.checkpoints
      };
    }

    const selectedProtocol = protocols.find((protocol) => cleanText(protocol.id, 120) === cleanText(selectedCandidate.protocol_id, 120))
      || protocols.find((protocol) => cleanText(protocol.name, 220).toLowerCase() === cleanText(selectedCandidate.protocol_name, 220).toLowerCase())
      || null;
    if (!selectedProtocol) {
      return {
        status: 'needs_more_info',
        project_name: cleanText(resolvedProject.name, 220),
        selected_protocol: null,
        source_workflow: selectedCandidate?.workflow || null,
        missing_placeholders: [],
        follow_up_questions: ['I could not resolve the protocol record for the proposed draft. Please pick a protocol explicitly.'],
        proposal_summary: '',
        proposal: null,
        notebook: null,
        summary: 'The proposed next-step protocol could not be resolved.'
      };
    }

    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'notebook_draft_selected',
      status: 'ok',
      message: `Notebook draft selected protocol ${cleanText(selectedProtocol.name, 220) || cleanText(selectedProtocol.id, 120)}.`,
      meta: {
        project_id: cleanText(resolvedProject.id, 120),
        protocol_id: cleanText(selectedProtocol.id, 120),
        workflow_id: cleanText(selectedCandidate?.workflow?.id, 120)
      }
    });

    const generationResult = await generateNotebookFromProtocol({
      provider,
      endpoint,
      apiKey,
      model,
      message: cleanText([
        message,
        proposalFields.title ? `Planned experiment title: ${proposalFields.title}` : '',
        proposalFields.purpose ? `Planned purpose: ${proposalFields.purpose}` : ''
      ].filter(Boolean).join('\n'), 3200),
      conversation,
      snapshot,
      parserPayload,
      selectedProtocol,
      project: resolvedProject,
      pendingValues: {},
      traceContext,
      lifecycleRecorder
    });
    const notebook = generationResult?.notebook && typeof generationResult.notebook === 'object'
      ? decorateNotebookDraft({
        notebook: generationResult.notebook,
        candidate: selectedCandidate,
        proposal: proposalFields,
        evidenceContext: normalizedEvidenceContext,
        missingPlaceholders: generationResult.missing_placeholders
      })
      : null;
    const proposalSummary = cleanText([
      cleanText(proposalFields.title, 220),
      cleanText(proposalFields.purpose, 260)
    ].filter(Boolean).join(': '), 520);

    return {
      status: notebook ? 'proposal_ready' : 'needs_more_info',
      project_name: cleanText(resolvedProject.name, 220),
      selected_protocol: {
        id: cleanText(selectedProtocol.id, 120),
        name: cleanText(selectedProtocol.name, 220),
        selection_method: cleanText(selectedCandidate?.source_type, 80) || 'workflow',
        rationale: cleanText(proposalFields.rationale, 320) || cleanText(selectedCandidate?.reason, 320)
      },
      source_workflow: selectedCandidate?.workflow || null,
      missing_placeholders: asArray(notebook?.unresolved_placeholders),
      follow_up_questions: uniqueStrings(asArray(generationResult?.follow_up_questions), 10),
      proposal_summary: proposalSummary,
      proposal: notebook?.proposal || null,
      notebook,
      summary: notebook
        ? `Planned notebook draft ready for confirmation using protocol ${cleanText(selectedProtocol.name, 220) || cleanText(selectedProtocol.id, 120)}.`
        : 'Notebook draft proposal could not be prepared.'
    };
  }

  return {
    NOTEBOOK_DRAFT_SELECTION_SYSTEM_PROMPT,
    NOTEBOOK_DRAFT_SELECTION_RULES,
    normalizeEvidenceContext,
    normalizeWorkflowRecord,
    extractNotebookRuns,
    resolvePlanningProject,
    collectWorkflowCandidates,
    collectProtocolOnlyCandidates,
    buildNotebookDraftSelectionPrompt,
    requestNotebookDraftSelection,
    buildFallbackProposal,
    renderPlannedResultText,
    decorateNotebookDraft,
    generateNotebookDraft
  };
}

module.exports = {
  createNotebookDraftRuntime
};
