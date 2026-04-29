'use strict';

const { throwIfAgentRequestAborted } = require('../shared/agent-request-context.js');

const FINAL_RESPONSE_SCHEMA = {
  status: 'completed',
  assistant_text: 'Final answer or one blocking clarification question.',
  follow_up_questions: [],
  reasoning_summary: 'Brief evidence and verification summary.',
  citations: []
};

function defaultCleanText(value, _maxLength = 2000) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneJson(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function parseJsonObjectFromText(raw = '') {
  const text = String(raw || '').trim();
  if (!text) {
    return null;
  }
  const candidates = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    candidates.push(fenced[1].trim());
  }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function normalizeCitation(cleanText, citation = {}) {
  const source = citation && typeof citation === 'object' ? citation : {};
  return {
    source: cleanText(source.source || source.tool || source.type, 120),
    pointer: cleanText(source.pointer || source.url || source.title || source.id, 320),
    reason: cleanText(source.reason || source.summary, 500)
  };
}

function normalizeCodexAgentPayload(rawPayload = {}, rawText = '', { cleanText = defaultCleanText } = {}) {
  const source = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
  const followUps = asArray(source.follow_up_questions || source.followUpQuestions)
    .map((item) => cleanText(item, 500))
    .filter(Boolean)
    .slice(0, 6);
  const status = cleanText(source.status, 40)
    || (followUps.length ? 'needs_more_info' : 'completed');
  const answer = cleanText(
    source.assistant_text
      || source.assistantText
      || source.answer
      || source.message
      || rawText,
    120000
  );
  const reasoningSummary = cleanText(
    source.reasoning_summary
      || source.reasoningSummary
      || source.summary,
    4000
  );
  return {
    status,
    answer,
    follow_up_questions: followUps,
    reasoning_summary: reasoningSummary,
    citations: asArray(source.citations)
      .map((citation) => normalizeCitation(cleanText, citation))
      .filter((citation) => citation.source || citation.pointer || citation.reason)
      .slice(0, 12)
  };
}

function summarizeConversation(cleanText, conversation = []) {
  return asArray(conversation)
    .map((turn, index) => {
      const source = turn && typeof turn === 'object' ? turn : {};
      const role = cleanText(source.role, 40) || 'message';
      const text = cleanText(source.text || source.content || source.message, 4000);
      return text ? `${index + 1}. ${role}: ${text}` : '';
    })
    .filter(Boolean)
    .slice(-12)
    .join('\n');
}

function summarizeAttachments(cleanText, attachments = []) {
  return asArray(attachments)
    .map((attachment, index) => {
      const source = attachment && typeof attachment === 'object' ? attachment : {};
      const name = cleanText(source.name, 240) || `attachment-${index + 1}`;
      const kind = cleanText(source.kind, 40);
      const mimeType = cleanText(source.mimeType || source.mime_type, 160);
      const size = Number.isFinite(Number(source.size)) ? Number(source.size) : 0;
      return `- ${name}${kind ? ` (${kind})` : ''}${mimeType ? ` ${mimeType}` : ''}${size ? ` ${size} bytes` : ''}`;
    })
    .join('\n');
}

function buildCodexAgentPrompt(input = {}, { cleanText = defaultCleanText } = {}) {
  const message = cleanText(input.message, 24000);
  const conversationText = summarizeConversation(cleanText, input.conversation);
  const attachmentText = summarizeAttachments(cleanText, input.attachments);
  const projectId = cleanText(input.projectId, 120);
  const projectName = cleanText(input.projectName, 220);
  const selectionInsight = ensureObject(input.selectionInsight);
  const skillPromptPayload = ensureObject(input.skillPromptPayload);
  const blocks = [
    '# Enana Codex-Owned Agent Request',
    '',
    'You are handling this Enana chat turn as the Codex reasoning agent. Do the complete lifecycle yourself in this single Codex run: clarify if necessary, discover tool schemas, call Enana MCP tools, verify the inference, and synthesize the final answer.',
    '',
    'AGENTS.md in this workspace contains the durable Enana Codex agent contract. Follow it together with the request details below.',
    '',
    'Use the MCP server named `enana` for Enana app data, papers, protocols, notebooks, inventory, memory, and structured tool access. Use native Codex search or the Enana `web-search` tool for external web evidence.',
    '',
    'Final response rule: return exactly one JSON object and no surrounding prose. The JSON shape must be:',
    JSON.stringify(FINAL_RESPONSE_SCHEMA, null, 2),
    '',
    'Set `status` to `needs_more_info` when you need one blocking clarification. Put the user-facing question in both `assistant_text` and `follow_up_questions[0]`. Set `status` to `completed` when answering.',
    '',
    projectId || projectName
      ? `Selected project:\n${JSON.stringify({ id: projectId, name: projectName }, null, 2)}`
      : 'Selected project: none',
    '',
    selectionInsight.actionType || selectionInsight.selectedText
      ? `Selection insight context:\n${JSON.stringify(selectionInsight, null, 2)}`
      : '',
    conversationText ? `Recent conversation:\n${conversationText}` : '',
    attachmentText ? `Attachments supplied by Enana:\n${attachmentText}` : '',
    cleanText(skillPromptPayload.active_skills_prompt, 6000)
      ? `Active skills:\n${cleanText(skillPromptPayload.active_skills_prompt, 6000)}`
      : '',
    cleanText(skillPromptPayload.skills_catalog_prompt, 6000)
      ? `Skills catalog:\n${cleanText(skillPromptPayload.skills_catalog_prompt, 6000)}`
      : '',
    '',
    `Current user request:\n${message}`
  ];
  return blocks.filter((block) => cleanText(block, 1) || block === '').join('\n\n').trim();
}

function buildCodexAgentParserPayload(codexAgent = {}, {
  projectId = '',
  projectName = '',
  reasoningEffort = 0,
  cleanText = defaultCleanText
} = {}) {
  const needsClarification = cleanText(codexAgent.status, 40) === 'needs_more_info'
    || asArray(codexAgent.follow_up_questions).length > 0;
  return {
    primary_intent: 'codex_agent',
    reasoning_effort: Number.isFinite(Number(reasoningEffort)) ? Number(reasoningEffort) : 0,
    direct_answer: needsClarification ? null : cleanText(codexAgent.answer, 12000) || null,
    needs_clarification: needsClarification,
    clarification_reason: needsClarification
      ? cleanText(codexAgent.follow_up_questions?.[0] || codexAgent.answer, 500) || 'codex_agent_needs_more_info'
      : null,
    entities: {
      project_id: cleanText(projectId, 120),
      project_name: cleanText(projectName, 220)
    },
    inventory_search: {
      normalized_query: null,
      candidate_terms: [],
      aliases: [],
      search_mode: null
    },
    protocol_candidates: [],
    reasoning_summary: cleanText(codexAgent.reasoning_summary, 1200)
      || 'Handled by the Codex-owned agent lifecycle.'
  };
}

function buildCodexMcpContext(input = {}, { cleanText = defaultCleanText } = {}) {
  const snapshot = ensureObject(input.snapshot);
  return {
    provider: 'codex',
    model: cleanText(input.model, 120),
    cwd: cleanText(input.cwd, 1200),
    message: cleanText(input.message, 3200),
    conversation: cloneJson(asArray(input.conversation).slice(-12), []),
    project: {
      id: cleanText(input.projectId, 120),
      name: cleanText(input.projectName, 220)
    },
    projectId: cleanText(input.projectId, 120),
    projectName: cleanText(input.projectName, 220),
    dataFilePath: cleanText(snapshot?.data_file_path || snapshot?.dataFilePath, 2000),
    traceRequestId: cleanText(input.traceContext?.requestId, 120)
  };
}

function createCodexAgentRuntime(deps = {}) {
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const requestCodexAgentText = typeof deps.requestCodexAgentText === 'function'
    ? deps.requestCodexAgentText
    : null;
  const recordAgentLlmTrace = typeof deps.recordAgentLlmTrace === 'function'
    ? deps.recordAgentLlmTrace
    : (async () => {});
  const recordLifecycleEvent = typeof deps.recordLifecycleEvent === 'function'
    ? deps.recordLifecycleEvent
    : (() => {});
  const getWorkingDirectory = typeof deps.getWorkingDirectory === 'function'
    ? deps.getWorkingDirectory
    : (() => process.cwd());

  async function run(input = {}) {
    if (!requestCodexAgentText) {
      return {
        ok: false,
        provider: 'codex',
        model: cleanText(input.model, 120),
        error: 'Codex agent runtime is not configured.'
      };
    }
    const cwd = cleanText(input.cwd, 2400) || getWorkingDirectory();
    const prompt = buildCodexAgentPrompt(input, { cleanText });
    const traceContext = input.traceContext || null;
    const lifecycleRecorder = input.lifecycleRecorder || null;
    const model = cleanText(input.model, 120);
    const reasoningEffort = cleanText(input.reasoningEffort, 40);

    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'codex_agent_started',
      status: 'started',
      routing_intent: 'codex_agent',
      message: 'Starting Codex-owned agent lifecycle.'
    });
    await recordAgentLlmTrace(traceContext, {
      stage: 'codex_agent_runtime',
      provider: 'codex',
      model,
      summary: 'Started Codex-owned agent lifecycle.',
      request_payload: {
        model,
        reasoning_effort: reasoningEffort,
        prompt,
        attachments: asArray(input.attachments).map((attachment) => ({
          name: cleanText(attachment?.name, 240),
          kind: cleanText(attachment?.kind, 40),
          data: '[omitted]'
        }))
      }
    });

    throwIfAgentRequestAborted('Agent request stopped before starting Codex agent.');
    const rawText = await requestCodexAgentText({
      prompt,
      model,
      reasoningEffort,
      cwd,
      enableWebSearch: true,
      attachments: asArray(input.attachments),
      envOverrides: {
        ENANA_CODEX_REQUEST_CONTEXT: JSON.stringify(buildCodexMcpContext({
          ...input,
          cwd,
          model
        }, { cleanText }))
      }
    });
    throwIfAgentRequestAborted('Agent request stopped after Codex agent completed.');

    const parsed = parseJsonObjectFromText(rawText);
    const parseWarning = parsed ? '' : 'Codex agent returned non-JSON output; wrapped raw text as assistant_text.';
    const codexAgent = normalizeCodexAgentPayload(parsed || {}, rawText, { cleanText });
    const parser = buildCodexAgentParserPayload(codexAgent, {
      projectId: input.projectId,
      projectName: input.projectName,
      reasoningEffort,
      cleanText
    });
    await recordAgentLlmTrace(traceContext, {
      stage: parseWarning ? 'codex_agent_parse_warning' : 'codex_agent_completed',
      provider: 'codex',
      model,
      summary: parseWarning || 'Codex-owned agent lifecycle completed.',
      response_payload: parsed || rawText
    });
    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'codex_agent_completed',
      status: 'ok',
      routing_intent: 'codex_agent',
      message: cleanText(codexAgent.reasoning_summary || codexAgent.answer, 320)
        || 'Codex-owned agent lifecycle completed.',
      meta: {
        status: codexAgent.status,
        citation_count: asArray(codexAgent.citations).length,
        parse_warning: Boolean(parseWarning)
      }
    });

    return {
      ok: true,
      provider: 'codex',
      model,
      parser,
      codex_agent: codexAgent,
      thinking_trace: {
        intent_parse_question: 'Codex owned this request without Enana parser dispatch.',
        final_synthesize: cleanText(codexAgent.reasoning_summary, 1000)
          || 'Codex synthesized the final response from the evidence it gathered.'
      },
      ...(parseWarning ? { warnings: [parseWarning] } : {})
    };
  }

  return {
    run,
    buildPrompt: (input = {}) => buildCodexAgentPrompt(input, { cleanText }),
    parseJsonObjectFromText: (raw = '') => parseJsonObjectFromText(raw),
    normalizePayload: (payload = {}, rawText = '') => normalizeCodexAgentPayload(payload, rawText, { cleanText })
  };
}

module.exports = {
  FINAL_RESPONSE_SCHEMA,
  buildCodexAgentPrompt,
  buildCodexAgentParserPayload,
  buildCodexMcpContext,
  createCodexAgentRuntime,
  normalizeCodexAgentPayload,
  parseJsonObjectFromText
};
