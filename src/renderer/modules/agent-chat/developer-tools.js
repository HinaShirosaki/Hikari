import {
  DEVELOPER_TOOL_TEST_OPTION_BY_NAME,
  DEVELOPER_TOOL_TEST_OPTIONS,
  asArray,
  trimText
} from './shared.js';

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
