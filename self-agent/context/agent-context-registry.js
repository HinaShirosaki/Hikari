'use strict';

function createAgentContextRegistryRuntime(deps = {}) {
  const asArray = typeof deps.asArray === 'function'
    ? deps.asArray
    : ((value) => (Array.isArray(value) ? value : []));
  const cleanText = typeof deps.cleanText === 'function'
    ? deps.cleanText
    : ((value) => String(value || '').trim());
  const now = typeof deps.now === 'function'
    ? deps.now
    : (() => new Date().toISOString());
  const ensureObject = typeof deps.ensureObject === 'function'
    ? deps.ensureObject
    : ((value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {}));
  const cloneJson = typeof deps.cloneJson === 'function'
    ? deps.cloneJson
    : ((value, fallback = null) => {
      try {
        return JSON.parse(JSON.stringify(value));
      } catch {
        return fallback;
      }
    });
  const uniqueStrings = typeof deps.uniqueStrings === 'function'
    ? deps.uniqueStrings
    : ((values, max = 12) => {
      const seen = new Set();
      const out = [];
      asArray(values).forEach((value) => {
        const normalized = cleanText(value, 260);
        if (!normalized) {
          return;
        }
        const key = normalized.toLowerCase();
        if (seen.has(key) || out.length >= max) {
          return;
        }
        seen.add(key);
        out.push(normalized);
      });
      return out;
    });
  const normalizeProject = typeof deps.normalizeProject === 'function'
    ? deps.normalizeProject
    : (() => null);
  const normalizeTaskRecord = typeof deps.normalizeTaskRecord === 'function'
    ? deps.normalizeTaskRecord
    : (() => null);
  const buildTaskSummary = typeof deps.buildTaskSummary === 'function'
    ? deps.buildTaskSummary
    : (() => '');
  const CONTEXT_MODES = deps.CONTEXT_MODES && typeof deps.CONTEXT_MODES === 'object'
    ? deps.CONTEXT_MODES
    : { READY: 'ready', ACTIVE_TASK: 'active_task' };
  const CONTEXT_REGISTRY_SECTIONS = deps.CONTEXT_REGISTRY_SECTIONS && typeof deps.CONTEXT_REGISTRY_SECTIONS === 'object'
    ? deps.CONTEXT_REGISTRY_SECTIONS
    : {
      USER: 'user',
      EXECUTION: 'execution',
      MEMORY: 'memory',
      REASONING: 'reasoning',
      SYSTEM: 'system'
    };

  function normalizeConversation(conversation, max = 8) {
    return asArray(conversation)
      .slice(-max)
      .map((entry) => ({
        role: cleanText(entry?.role, 40) || 'user',
        text: cleanText(entry?.text, 4000)
      }))
      .filter((entry) => entry.text);
  }

  function normalizeImmediateToolOutputs(toolOutputs, max = 6) {
    return asArray(toolOutputs)
      .slice(-max)
      .map((entry) => ({
        tool_name: cleanText(entry?.tool_name || entry?.name, 120),
        ok: entry?.ok !== false,
        summary: cleanText(entry?.summary, 320),
        result: cloneJson(entry?.result !== undefined ? entry.result : entry?.items, null),
        recorded_at: cleanText(entry?.recorded_at || entry?.recordedAt, 80)
      }))
      .filter((entry) => entry.tool_name || entry.summary || entry.result !== null);
  }

  function normalizeLongTermMemoryItems(items, max = 12) {
    return asArray(items).slice(0, max).map((item) => {
      const source = ensureObject(item);
      return {
        id: cleanText(source.id, 160),
        category: cleanText(source.category, 120),
        key: cleanText(source.key, 220),
        summary: cleanText(source.summary, 600),
        value: cloneJson(source.value, null),
        project_name: cleanText(source.project_name || source.projectName, 220),
        tags: uniqueStrings(source.tags, 12),
        source: cleanText(source.source, 120),
        updated_at: cleanText(source.updated_at || source.updatedAt, 80)
      };
    }).filter((item) => item.id || item.key || item.summary);
  }

  function normalizeCompletedTaskEntries(values, max = 8) {
    return asArray(values).slice(0, max).map((item) => {
      const source = ensureObject(item);
      const summary = cleanText(source.summary, 320);
      if (!summary && !cleanText(source.task_id, 160) && !cleanText(source.task_type, 120)) {
        return null;
      }
      return {
        task_id: cleanText(source.task_id, 160),
        task_type: cleanText(source.task_type, 120),
        intent: cleanText(source.intent, 120),
        status: cleanText(source.status, 80),
        summary,
        completed_at: cleanText(source.completed_at || source.completedAt, 80)
      };
    }).filter(Boolean);
  }

  function normalizeFollowUpAnswerEntry(value) {
    if (typeof value === 'string') {
      const answer = cleanText(value, 4000);
      return answer
        ? {
          answer,
          provided_values: {},
          resolved_fields: [],
          recorded_at: now()
        }
        : null;
    }

    const source = ensureObject(value);
    const answer = cleanText(source.answer || source.message, 4000);
    const providedValues = cloneJson(ensureObject(source.provided_values || source.known_values), {});
    const resolvedFields = uniqueStrings(
      source.resolved_fields !== undefined
        ? source.resolved_fields
        : Object.keys(providedValues),
      24
    ).map((item) => item.toLowerCase());
    const recordedAt = cleanText(source.recorded_at || source.recordedAt, 80) || now();
    if (!answer && !Object.keys(providedValues).length && !resolvedFields.length) {
      return null;
    }
    return {
      answer,
      provided_values: providedValues,
      resolved_fields: resolvedFields,
      recorded_at: recordedAt
    };
  }

  function normalizeFollowUpAnswerEntries(values, max = 12) {
    return asArray(values)
      .slice(0, max)
      .map((value) => normalizeFollowUpAnswerEntry(value))
      .filter(Boolean);
  }

  function normalizeReasoningFeedbackEntries(values, max = 8) {
    return asArray(values).slice(0, max).map((value) => {
      if (typeof value === 'string') {
        const summary = cleanText(value, 320);
        return summary
          ? {
            kind: '',
            summary,
            impact: '',
            recorded_at: now()
          }
          : null;
      }
      const source = ensureObject(value);
      const kind = cleanText(source.kind || source.type, 80);
      const summary = cleanText(source.summary || source.message || source.reason, 320);
      const impact = cleanText(source.impact || source.effect, 320);
      const recordedAt = cleanText(source.recorded_at || source.recordedAt, 80) || now();
      if (!kind && !summary && !impact) {
        return null;
      }
      return {
        kind,
        summary,
        impact,
        recorded_at: recordedAt
      };
    }).filter(Boolean);
  }

  function normalizePaperContextEntries(values, max = 8) {
    return asArray(values).slice(0, max).map((value) => {
      if (typeof value === 'string') {
        const summary = cleanText(value, 1200);
        return summary
          ? {
            title: '',
            summary,
            source: '',
            recorded_at: now()
          }
          : null;
      }
      const source = ensureObject(value);
      const title = cleanText(source.title || source.paper_title || source.paperTitle, 240);
      const summary = cleanText(source.summary || source.abstract || source.content || source.text, 1200);
      const citationSource = cleanText(source.source || source.provider || source.origin, 160);
      const recordedAt = cleanText(source.recorded_at || source.recordedAt, 80) || now();
      if (!title && !summary && !citationSource) {
        return null;
      }
      return {
        title,
        summary,
        source: citationSource,
        recorded_at: recordedAt
      };
    }).filter(Boolean);
  }

  function createEmptyContextRegistry(timestamp = now()) {
    return {
      version: 1,
      updated_at: cleanText(timestamp, 80) || now(),
      user: {
        original_user_message: '',
        latest_user_message: '',
        clarified_user_message: '',
        recent_messages: [],
        follow_up_questions: [],
        follow_up_answers: []
      },
      execution: {
        tool_outputs: [],
        papers: [],
        paper_summaries: []
      },
      memory: {
        goals: [],
        decisions: [],
        constraints: [],
        unresolved_questions: [],
        current_project_state: null,
        active_task_summary: '',
        recent_completed_tasks: [],
        long_term_memory: []
      },
      reasoning: {
        inference_feedback: [],
        evaluation_feedback: []
      },
      system: {
        skills: [],
        workflow_state: null,
        agent_internal_state: {},
        mode: CONTEXT_MODES.READY,
        active_task: null
      }
    };
  }

  function normalizeContextRegistry(registry = null, session = null) {
    const source = ensureObject(registry);
    const fallbackSession = ensureObject(session);
    const fallbackMemory = ensureObject(fallbackSession.session_memory);
    const normalized = createEmptyContextRegistry(
      cleanText(source.updated_at, 80) || cleanText(fallbackSession.updated_at, 80) || now()
    );
    const userSource = ensureObject(source[CONTEXT_REGISTRY_SECTIONS.USER]);
    const executionSource = ensureObject(source[CONTEXT_REGISTRY_SECTIONS.EXECUTION]);
    const memorySource = ensureObject(source[CONTEXT_REGISTRY_SECTIONS.MEMORY]);
    const reasoningSource = ensureObject(source[CONTEXT_REGISTRY_SECTIONS.REASONING]);
    const systemSource = ensureObject(source[CONTEXT_REGISTRY_SECTIONS.SYSTEM]);
    const normalizedTask = normalizeTaskRecord(systemSource.active_task, fallbackSession.active_task);

    normalized.user.original_user_message = cleanText(userSource.original_user_message, 4000)
      || cleanText(fallbackSession.latest_user_request, 4000);
    normalized.user.latest_user_message = cleanText(userSource.latest_user_message, 4000)
      || cleanText(userSource.clarified_user_message, 4000)
      || cleanText(fallbackSession.latest_user_request, 4000);
    normalized.user.clarified_user_message = cleanText(userSource.clarified_user_message, 4000);
    normalized.user.recent_messages = normalizeConversation(
      userSource.recent_messages && userSource.recent_messages.length
        ? userSource.recent_messages
        : fallbackSession.recent_conversation
    );
    normalized.user.follow_up_questions = uniqueStrings(userSource.follow_up_questions, 12);
    normalized.user.follow_up_answers = normalizeFollowUpAnswerEntries(userSource.follow_up_answers, 12);

    normalized.execution.tool_outputs = normalizeImmediateToolOutputs(
      executionSource.tool_outputs && executionSource.tool_outputs.length
        ? executionSource.tool_outputs
        : fallbackSession.latest_tool_outputs
    );
    normalized.execution.papers = normalizePaperContextEntries(
      executionSource.papers !== undefined ? executionSource.papers : executionSource.paper_information,
      8
    );
    normalized.execution.paper_summaries = normalizePaperContextEntries(executionSource.paper_summaries, 8);

    normalized.memory.goals = uniqueStrings(
      memorySource.goals && memorySource.goals.length ? memorySource.goals : fallbackMemory.goals,
      10
    );
    normalized.memory.decisions = uniqueStrings(
      memorySource.decisions && memorySource.decisions.length ? memorySource.decisions : fallbackMemory.decisions,
      12
    );
    normalized.memory.constraints = uniqueStrings(
      memorySource.constraints && memorySource.constraints.length ? memorySource.constraints : fallbackMemory.constraints,
      12
    );
    normalized.memory.unresolved_questions = uniqueStrings(
      memorySource.unresolved_questions && memorySource.unresolved_questions.length
        ? memorySource.unresolved_questions
        : fallbackMemory.unresolved_questions,
      12
    );
    normalized.memory.current_project_state = normalizeProject(
      memorySource.current_project_state || fallbackMemory.current_project_state
    );
    normalized.memory.active_task_summary = cleanText(memorySource.active_task_summary, 600)
      || cleanText(fallbackMemory.active_task_summary, 600);
    normalized.memory.recent_completed_tasks = normalizeCompletedTaskEntries(
      memorySource.recent_completed_tasks && memorySource.recent_completed_tasks.length
        ? memorySource.recent_completed_tasks
        : fallbackMemory.recent_completed_tasks,
      8
    );
    normalized.memory.long_term_memory = normalizeLongTermMemoryItems(memorySource.long_term_memory, 12);

    normalized.reasoning.inference_feedback = normalizeReasoningFeedbackEntries(
      reasoningSource.inference_feedback || reasoningSource.inferenceFeedback,
      8
    );
    normalized.reasoning.evaluation_feedback = normalizeReasoningFeedbackEntries(
      reasoningSource.evaluation_feedback || reasoningSource.evaluationFeedback,
      8
    );

    normalized.system.skills = uniqueStrings(systemSource.skills, 16);
    normalized.system.workflow_state = cloneJson(
      ensureObject(systemSource.workflow_state || systemSource.workflow),
      null
    );
    if (normalized.system.workflow_state && !Object.keys(normalized.system.workflow_state).length) {
      normalized.system.workflow_state = null;
    }
    normalized.system.agent_internal_state = cloneJson(
      ensureObject(systemSource.agent_internal_state || systemSource.internal_state),
      {}
    );
    normalized.system.mode = cleanText(systemSource.mode, 80)
      || (normalizedTask ? CONTEXT_MODES.ACTIVE_TASK : cleanText(fallbackSession.mode, 80))
      || CONTEXT_MODES.READY;
    normalized.system.active_task = normalizedTask ? cloneJson(normalizedTask, null) : null;
    normalized.updated_at = cleanText(source.updated_at, 80)
      || cleanText(fallbackSession.updated_at, 80)
      || now();

    if (!normalized.memory.current_project_state && normalizedTask?.project) {
      normalized.memory.current_project_state = cloneJson(normalizedTask.project, null);
    }
    if (!normalized.memory.active_task_summary && normalizedTask) {
      normalized.memory.active_task_summary = buildTaskSummary(normalizedTask);
    }

    return normalized;
  }

  function ensureContextRegistry(session) {
    const registry = normalizeContextRegistry(session?.context_registry, session);
    session.context_registry = registry;
    return registry;
  }

  function syncLegacySessionFieldsFromRegistry(session, registry) {
    const normalized = normalizeContextRegistry(registry, session);
    session.context_registry = cloneJson(normalized, {});
    session.mode = normalized.system.active_task ? CONTEXT_MODES.ACTIVE_TASK : CONTEXT_MODES.READY;
    session.active_task = normalized.system.active_task ? cloneJson(normalized.system.active_task, null) : null;
    session.latest_user_request = cleanText(normalized.user.clarified_user_message, 4000)
      || cleanText(normalized.user.latest_user_message, 4000)
      || cleanText(normalized.user.original_user_message, 4000);
    session.recent_conversation = cloneJson(normalizeConversation(normalized.user.recent_messages, 8), []);
    session.latest_tool_outputs = cloneJson(normalizeImmediateToolOutputs(normalized.execution.tool_outputs, 6), []);
    session.session_memory = {
      goals: uniqueStrings(normalized.memory.goals, 10),
      decisions: uniqueStrings(normalized.memory.decisions, 12),
      constraints: uniqueStrings(normalized.memory.constraints, 12),
      unresolved_questions: uniqueStrings(normalized.memory.unresolved_questions, 12),
      current_project_state: normalizeProject(normalized.memory.current_project_state),
      active_task_summary: cleanText(normalized.memory.active_task_summary, 600),
      recent_completed_tasks: normalizeCompletedTaskEntries(normalized.memory.recent_completed_tasks, 8)
    };
    return session;
  }

  function syncSessionMemoryIntoRegistry(session) {
    const registry = ensureContextRegistry(session);
    registry.memory.goals = uniqueStrings(session.session_memory?.goals, 10);
    registry.memory.decisions = uniqueStrings(session.session_memory?.decisions, 12);
    registry.memory.constraints = uniqueStrings(session.session_memory?.constraints, 12);
    registry.memory.unresolved_questions = uniqueStrings(session.session_memory?.unresolved_questions, 12);
    registry.memory.current_project_state = normalizeProject(session.session_memory?.current_project_state);
    registry.memory.active_task_summary = cleanText(session.session_memory?.active_task_summary, 600);
    registry.memory.recent_completed_tasks = normalizeCompletedTaskEntries(session.session_memory?.recent_completed_tasks, 8);
    registry.updated_at = now();
    syncLegacySessionFieldsFromRegistry(session, registry);
    return registry;
  }

  function syncTaskIntoRegistry(session, task = session.active_task) {
    const registry = ensureContextRegistry(session);
    const normalizedTask = normalizeTaskRecord(task, session.active_task);
    registry.system.active_task = normalizedTask ? cloneJson(normalizedTask, null) : null;
    registry.system.mode = normalizedTask ? CONTEXT_MODES.ACTIVE_TASK : CONTEXT_MODES.READY;
    registry.memory.current_project_state = normalizedTask?.project
      ? cloneJson(normalizedTask.project, null)
      : normalizeProject(registry.memory.current_project_state);
    registry.memory.active_task_summary = normalizedTask ? buildTaskSummary(normalizedTask) : '';
    registry.updated_at = now();
    syncLegacySessionFieldsFromRegistry(session, registry);
    return normalizedTask;
  }

  function mergeToolOutputEntries(existing, incoming, max = 6) {
    const merged = [];
    const seen = new Set();
    [...normalizeImmediateToolOutputs(incoming, max), ...normalizeImmediateToolOutputs(existing, max)]
      .forEach((entry) => {
        const key = [
          cleanText(entry.tool_name, 120).toLowerCase(),
          cleanText(entry.summary, 320).toLowerCase(),
          cleanText(entry.recorded_at, 80)
        ].join('::');
        if (seen.has(key) || merged.length >= max) {
          return;
        }
        seen.add(key);
        merged.push(entry);
      });
    return merged;
  }

  function registerContextInputs(session, input = {}) {
    const source = ensureObject(input);
    const registry = ensureContextRegistry(session);
    const latestUserMessage = cleanText(
      source.current_user_request !== undefined
        ? source.current_user_request
        : (source.message !== undefined ? source.message : source.answer),
      4000
    );
    const clarifiedUserMessage = cleanText(source.clarified_user_message || source.clarifiedUserMessage, 4000);
    const questions = uniqueStrings([
      source.question,
      ...asArray(source.questions),
      ...asArray(source.follow_up_questions)
    ], 12);
    const hasExplicitAnswerPayload = source.answer !== undefined
      || source.provided_values !== undefined
      || source.resolved_fields !== undefined;
    const activeTaskInput = source.active_task !== undefined
      ? source.active_task
      : source.current_task_state;
    const inferenceFeedbackInput = source.inference_feedback !== undefined
      ? source.inference_feedback
      : source.reasoning_feedback;
    const evaluationFeedbackInput = source.evaluation_feedback !== undefined
      ? source.evaluation_feedback
      : source.judge_feedback;

    if (latestUserMessage) {
      if (!registry.user.original_user_message) {
        registry.user.original_user_message = latestUserMessage;
      }
      registry.user.latest_user_message = latestUserMessage;
    }
    if (clarifiedUserMessage) {
      if (!registry.user.original_user_message) {
        registry.user.original_user_message = latestUserMessage || clarifiedUserMessage;
      }
      registry.user.latest_user_message = latestUserMessage || clarifiedUserMessage;
      registry.user.clarified_user_message = clarifiedUserMessage;
    }

    if (source.recent_conversation !== undefined || source.conversation !== undefined) {
      registry.user.recent_messages = normalizeConversation(
        source.recent_conversation !== undefined ? source.recent_conversation : source.conversation,
        8
      );
    }

    if (questions.length) {
      registry.user.follow_up_questions = uniqueStrings([
        ...registry.user.follow_up_questions,
        ...questions
      ], 12);
    }

    if (hasExplicitAnswerPayload) {
      const answerEntry = normalizeFollowUpAnswerEntry({
        answer: source.answer !== undefined ? source.answer : source.message,
        provided_values: source.provided_values,
        resolved_fields: source.resolved_fields,
        recorded_at: source.recorded_at || source.recordedAt
      });
      if (answerEntry) {
        registry.user.follow_up_answers = normalizeFollowUpAnswerEntries([
          answerEntry,
          ...registry.user.follow_up_answers
        ], 12);
      }
    }

    if (source.tool_outputs !== undefined) {
      registry.execution.tool_outputs = normalizeImmediateToolOutputs(source.tool_outputs, 6);
    } else {
      const hasSingleToolOutput = cleanText(source.tool_name || source.toolName, 120)
        || source.summary !== undefined
        || source.result !== undefined
        || source.input !== undefined
        || source.ok !== undefined;
      if (hasSingleToolOutput) {
        registry.execution.tool_outputs = mergeToolOutputEntries(
          registry.execution.tool_outputs,
          [{
            tool_name: source.tool_name || source.toolName,
            ok: source.ok,
            summary: source.summary,
            result: source.result,
            recorded_at: source.recorded_at || source.recordedAt
          }],
          6
        );
      }
    }

    if (
      source.paper_information !== undefined
      || source.paper_context_blocks !== undefined
      || source.loaded_context_blocks !== undefined
    ) {
      registry.execution.papers = normalizePaperContextEntries(
        source.paper_information !== undefined
          ? source.paper_information
          : (source.paper_context_blocks !== undefined ? source.paper_context_blocks : source.loaded_context_blocks),
        8
      );
    }
    if (source.paper_summaries !== undefined || source.paper_summary_blocks !== undefined) {
      registry.execution.paper_summaries = normalizePaperContextEntries(
        source.paper_summaries !== undefined ? source.paper_summaries : source.paper_summary_blocks,
        8
      );
    }

    if (source.long_term_memory !== undefined || source.recalled_memory !== undefined) {
      registry.memory.long_term_memory = normalizeLongTermMemoryItems(
        source.long_term_memory !== undefined ? source.long_term_memory : source.recalled_memory,
        12
      );
    }

    if (inferenceFeedbackInput !== undefined) {
      registry.reasoning.inference_feedback = normalizeReasoningFeedbackEntries(inferenceFeedbackInput, 8);
    }
    if (evaluationFeedbackInput !== undefined) {
      registry.reasoning.evaluation_feedback = normalizeReasoningFeedbackEntries(evaluationFeedbackInput, 8);
    }

    if (source.skills !== undefined) {
      registry.system.skills = uniqueStrings([
        ...registry.system.skills,
        ...asArray(source.skills)
      ], 16);
    }
    if (source.workflow_state !== undefined) {
      const workflowState = cloneJson(ensureObject(source.workflow_state), null);
      registry.system.workflow_state = workflowState && Object.keys(workflowState).length ? workflowState : null;
    }
    if (source.agent_internal_state !== undefined || source.internal_state !== undefined) {
      registry.system.agent_internal_state = cloneJson(
        ensureObject(source.agent_internal_state !== undefined ? source.agent_internal_state : source.internal_state),
        {}
      );
    }
    if (activeTaskInput !== undefined) {
      const normalizedTask = normalizeTaskRecord(activeTaskInput, session.active_task);
      registry.system.active_task = normalizedTask ? cloneJson(normalizedTask, null) : null;
      registry.system.mode = normalizedTask ? CONTEXT_MODES.ACTIVE_TASK : CONTEXT_MODES.READY;
      registry.memory.current_project_state = normalizedTask?.project
        ? cloneJson(normalizedTask.project, null)
        : registry.memory.current_project_state;
      registry.memory.active_task_summary = normalizedTask ? buildTaskSummary(normalizedTask) : '';
    }

    registry.updated_at = now();
    syncLegacySessionFieldsFromRegistry(session, registry);
    return registry;
  }

  function buildRegistrySelection(registry) {
    const source = normalizeContextRegistry(registry);
    const activeTask = source.system.active_task ? cloneJson(source.system.active_task, null) : null;
    const currentUserRequest = cleanText(source.user.clarified_user_message, 4000)
      || cleanText(source.user.latest_user_message, 4000)
      || cleanText(source.user.original_user_message, 4000);

    return {
      user: {
        current_user_request: currentUserRequest,
        recent_conversation: normalizeConversation(source.user.recent_messages, 8),
        follow_up_questions: uniqueStrings(source.user.follow_up_questions, 12),
        follow_up_answers: normalizeFollowUpAnswerEntries(source.user.follow_up_answers, 12)
      },
      execution: {
        latest_tool_outputs: normalizeImmediateToolOutputs(source.execution.tool_outputs, 6),
        papers: normalizePaperContextEntries(source.execution.papers, 8),
        paper_summaries: normalizePaperContextEntries(source.execution.paper_summaries, 8)
      },
      memory: {
        goals: uniqueStrings(source.memory.goals, 10),
        decisions: uniqueStrings(source.memory.decisions, 12),
        constraints: uniqueStrings(source.memory.constraints, 12),
        unresolved_questions: uniqueStrings([
          ...source.memory.unresolved_questions,
          ...source.user.follow_up_questions
        ], 12),
        current_project_state: normalizeProject(source.memory.current_project_state || activeTask?.project),
        active_task_summary: cleanText(source.memory.active_task_summary, 600) || buildTaskSummary(activeTask),
        recent_completed_tasks: normalizeCompletedTaskEntries(source.memory.recent_completed_tasks, 8),
        long_term_memory: normalizeLongTermMemoryItems(source.memory.long_term_memory, 12)
      },
      reasoning: {
        inference_feedback: normalizeReasoningFeedbackEntries(source.reasoning.inference_feedback, 8),
        evaluation_feedback: normalizeReasoningFeedbackEntries(source.reasoning.evaluation_feedback, 8)
      },
      system: {
        skills: uniqueStrings(source.system.skills, 16),
        workflow_state: cloneJson(source.system.workflow_state, null),
        agent_internal_state: cloneJson(source.system.agent_internal_state, {}),
        mode: activeTask ? CONTEXT_MODES.ACTIVE_TASK : CONTEXT_MODES.READY,
        active_task: activeTask
      }
    };
  }

  return {
    createEmptyContextRegistry,
    normalizeContextRegistry,
    ensureContextRegistry,
    syncLegacySessionFieldsFromRegistry,
    syncSessionMemoryIntoRegistry,
    syncTaskIntoRegistry,
    registerContextInputs,
    buildRegistrySelection
  };
}

module.exports = {
  createAgentContextRegistryRuntime
};
