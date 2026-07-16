import {
  DEVELOPER_TOOL_TEST_OPTION_BY_NAME,
  DEVELOPER_TOOL_TEST_OPTIONS,
  asArray,
  trimText
} from './shared.js';

function tryParseJsonObject(rawText = '') {
  const raw = trimText(rawText, 120000);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    // Continue with fenced or prose-wrapped JSON extraction below.
  }

  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    try {
      const parsed = JSON.parse(fencedMatch[1]);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      // Fall through to first-object extraction.
    }
  }

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function hasAgentResultShape(source) {
  return Boolean(
    source
    && typeof source === 'object'
    && (
      source.parser
      || source.protocol_to_notebook
      || source.notebook_draft
      || source.protocol_generation
      || source.codex_agent
      || source.inventory_lookup
      || source.notebook_lookup
      || source.purchase_recommendation
      || source.general_science_question
      || source.project_science_question
      || source.result_analysis
    )
  );
}

function hasCodexFinalShape(source) {
  return Boolean(
    source
    && typeof source === 'object'
    && (
      source.assistant_text
      || source.answer
      || source.status
      || source.follow_up_questions
      || source.user_question
      || source.citations
      || source.reasoning_summary
    )
  );
}

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value || '');
  }
}

function summarizePreviewContext(preview) {
  const source = preview && typeof preview === 'object' ? preview : {};
  const snapshot = source.state_snapshot && typeof source.state_snapshot === 'object'
    ? source.state_snapshot
    : {};
  const contextCounts = snapshot.context_counts && typeof snapshot.context_counts === 'object'
    ? snapshot.context_counts
    : {};
  return {
    provider: trimText(source.provider, 80),
    model: trimText(source.model, 120),
    project_id: trimText(source?.project?.id || source.project_id, 120),
    project_name: trimText(source?.project?.name || source.project_name, 220),
    prompt_kind: trimText(source?.prompt?.kind, 80),
    conversation_turns: asArray(source?.request?.conversation).length,
    attachment_count: asArray(source?.request?.attachments).length,
    snapshot_mode: trimText(snapshot.snapshot_mode, 80),
    context_counts: contextCounts
  };
}

export function buildDeveloperMockAgentResult({
  rawResponse = '',
  provider = '',
  model = ''
} = {}) {
  const raw = trimText(rawResponse, 120000);
  const parsed = tryParseJsonObject(raw);
  const normalizedProvider = trimText(provider, 80) || 'developer';
  const normalizedModel = trimText(model, 120);
  const mockMeta = {
    parsed_json: Boolean(parsed),
    response_shape: parsed
      ? (hasAgentResultShape(parsed)
        ? 'agent_result'
        : (hasCodexFinalShape(parsed) ? 'codex_final_response' : 'json'))
      : 'text'
  };

  if (parsed && hasAgentResultShape(parsed)) {
    return {
      ...parsed,
      ok: parsed.ok !== false,
      provider: trimText(parsed.provider, 80) || normalizedProvider,
      model: trimText(parsed.model, 120) || normalizedModel,
      developer_mock_meta: mockMeta
    };
  }

  if (parsed && hasCodexFinalShape(parsed)) {
    const answer = trimText(parsed.answer || parsed.assistant_text, 12000)
      || trimText(asArray(parsed.follow_up_questions)[0], 12000)
      || raw;
    const status = trimText(parsed.status, 40) || 'completed';
    return {
      ok: true,
      provider: normalizedProvider,
      model: normalizedModel,
      parser: {
        primary_intent: 'codex_agent',
        reasoning_effort: 0,
        direct_answer: status === 'needs_more_info' ? null : answer,
        needs_clarification: status === 'needs_more_info',
        clarification_reason: status === 'needs_more_info'
          ? trimText(parsed?.user_question?.question || asArray(parsed.follow_up_questions)[0] || answer, 600)
          : null,
        entities: {},
        inventory_search: {
          candidate_terms: []
        },
        protocol_candidates: [],
        reasoning_summary: trimText(parsed.reasoning_summary, 1200)
          || 'Developer-supplied mock Codex response.'
      },
      codex_agent: {
        ...parsed,
        status,
        answer,
        assistant_text: trimText(parsed.assistant_text, 12000) || answer,
        reasoning_summary: trimText(parsed.reasoning_summary, 1200)
          || 'Developer-supplied mock Codex response.'
      },
      user_question: parsed.user_question || parsed.userQuestion || null,
      developer_mock_meta: mockMeta
    };
  }

  return {
    ok: true,
    provider: normalizedProvider,
    model: normalizedModel,
    parser: {
      primary_intent: 'developer_mock_response',
      reasoning_effort: 0,
      direct_answer: raw,
      needs_clarification: false,
      clarification_reason: null,
      entities: {},
      inventory_search: {
        candidate_terms: []
      },
      protocol_candidates: [],
      reasoning_summary: raw || 'Developer mock response.'
    },
    developer_mock_meta: mockMeta
  };
}

export function formatDeveloperVisibleContext(context = {}) {
  const source = context && typeof context === 'object' ? context : {};
  const preview = source.preview && typeof source.preview === 'object' ? source.preview : source;
  const prompt = preview.prompt && typeof preview.prompt === 'object' ? preview.prompt : {};
  const request = preview.request && typeof preview.request === 'object' ? preview.request : {};
  const sections = [];
  const provider = trimText(preview.provider, 80) || trimText(source.provider, 80) || 'unknown';
  const model = trimText(preview.model, 120) || trimText(source.model, 120);
  const projectName = trimText(preview?.project?.name || preview.project_name, 220);
  const projectId = trimText(preview?.project?.id || preview.project_id, 120);
  const summary = summarizePreviewContext(preview);

  sections.push('Agent-visible context');
  sections.push(`Provider: ${provider}${model ? ` / ${model}` : ''}`);
  sections.push(projectName || projectId
    ? `Project: ${projectName || '(unnamed)'}${projectId ? ` (${projectId})` : ''}`
    : 'Project: all projects');
  sections.push(`Updated: ${trimText(source.updated_at || preview.updated_at, 80) || 'local preview'}`);

  const systemPrompt = trimText(
    prompt.system_prompt
      || prompt.systemPrompt
      || prompt.codex_agent_prompt
      || prompt.codexPrompt
      || '',
    120000
  );
  sections.push('\n--- System / Agent Prompt ---');
  sections.push(systemPrompt || 'No separate system prompt is available for this preview branch.');

  sections.push('\n--- Current Request ---');
  sections.push(trimText(request.message || preview.message, 24000) || '(no draft message)');

  sections.push('\n--- Conversation Sent ---');
  sections.push(safeJson(asArray(request.conversation || preview.conversation)));

  sections.push('\n--- Attachments Sent ---');
  sections.push(safeJson(asArray(request.attachments || preview.attachments)));

  if (preview.mcp_context) {
    sections.push('\n--- MCP / Provider Context ---');
    sections.push(safeJson(preview.mcp_context));
  }

  sections.push('\n--- LLM Settings Visible To Runtime ---');
  sections.push(safeJson(preview.llm || source.llm || {}));

  sections.push('\n--- Agent Flags ---');
  sections.push(safeJson(preview.agent || source.agent || {}));

  sections.push('\n--- State Snapshot Sent ---');
  sections.push(safeJson(preview.state_snapshot || source.stateSnapshot || {}));

  sections.push('\n--- Preview Summary ---');
  sections.push(safeJson(summary));

  return sections.join('\n');
}

export function summarizeDeveloperVisibleContext(context = {}) {
  const source = context && typeof context === 'object' ? context : {};
  const preview = source.preview && typeof source.preview === 'object' ? source.preview : source;
  return summarizePreviewContext(preview);
}

export function renderDeveloperToolOptions({ developerToolSelect, safeText, renderDeveloperToolHint }) {
  if (!developerToolSelect) {
    return;
  }
  const selected = trimText(developerToolSelect.value, 120);
  developerToolSelect.innerHTML = DEVELOPER_TOOL_TEST_OPTIONS.map((item) => (
    `<option value="${safeText(item.name)}">${safeText(item.label)}</option>`
  )).join('');
  const fallbackName = DEVELOPER_TOOL_TEST_OPTIONS[0]?.name || '';
  developerToolSelect.value = DEVELOPER_TOOL_TEST_OPTION_BY_NAME.has(selected) ? selected : fallbackName;
  renderDeveloperToolHint();
}

export function renderDeveloperToolHint({
  developerToolSelect,
  developerToolHint,
  developerToolMessageInput
}) {
  const toolName = trimText(developerToolSelect?.value, 120);
  const option = DEVELOPER_TOOL_TEST_OPTION_BY_NAME.get(toolName) || null;
  if (developerToolHint) {
    developerToolHint.textContent = option
      ? `${option.description} Example: ${option.example}`
      : 'Select a tool and provide a manual test message.';
  }
  if (developerToolMessageInput && !trimText(developerToolMessageInput.value, 3000)) {
    developerToolMessageInput.placeholder = option
      ? `Example: ${option.example}`
      : 'Enter a tool-directed test message.';
  }
}

export function appendToolTestAssistantMessage(
  { state, createId, persist, renderHistory },
  result,
  fallbackText,
  requestMessage = ''
) {
  state.agentChat.messages.push({
    id: createId(),
    role: 'assistant',
    text: trimText(result?.summary, 12000) || fallbackText,
    createdAt: new Date().toISOString(),
    meta: {
      tool_test: {
        ok: result?.ok === true,
        run_mode: trimText(result?.run_mode, 40) || 'all',
        tool_name: trimText(result?.tool_name, 120),
        request_message: trimText(requestMessage || result?.request_message, 3000),
        status: trimText(result?.status, 80),
        tool_count: Number(result?.tool_count) || asArray(result?.items).length,
        passed_count: Number(result?.passed_count) || 0,
        failed_count: Number(result?.failed_count) || 0,
        summary: trimText(result?.summary, 320),
        items: asArray(result?.items)
      }
    }
  });
  state.agentChat.messages = state.agentChat.messages.slice(-40);
  persist();
  renderHistory();
}
