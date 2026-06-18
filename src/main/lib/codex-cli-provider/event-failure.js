'use strict';

const { getCodexJsonEventDescriptor } = require('./event-descriptor');
const { collectTextFromCodexEventValue } = require('./event-values');
const { cleanText, safeParseJson } = require('./utils');

function clampCodexSummaryText(value = '', maxLength = 2000) {
  const text = cleanText(value, maxLength);
  const limit = Math.max(120, Number(maxLength) || 2000);
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit - 3)}...`;
}

function pickCodexEventCredits(source = {}) {
  if (!source || typeof source !== 'object') {
    return null;
  }
  return source.rate_limits?.credits
    || source.rateLimits?.credits
    || source.credits
    || null;
}

function isCodexWarningLine(line = '') {
  return /\bWARN\b/u.test(line)
    && /codex_core_(plugins|skills)::/u.test(line);
}

function summarizeCodexRawFailureOutput(text = '') {
  const lines = String(text || '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const meaningfulLines = lines.filter((line) => !isCodexWarningLine(line));
  const selectedLines = meaningfulLines.length ? meaningfulLines : lines;
  return clampCodexSummaryText(selectedLines.join('\n') || '', 2000);
}

function summarizeCodexCommandFailure({ stdout = '', stderr = '' } = {}) {
  let reportedNoCredits = false;
  let completedWithoutAgentMessage = false;
  let jsonErrorText = '';

  String(stdout || '').split(/\r?\n/u).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    const parsed = safeParseJson(trimmed, null);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return;
    }
    const { source, type } = getCodexJsonEventDescriptor(parsed);
    const credits = pickCodexEventCredits(source);
    if (credits && credits.has_credits === false && credits.unlimited !== true) {
      reportedNoCredits = true;
    }
    if (type === 'task_complete' && source.last_agent_message === null) {
      completedWithoutAgentMessage = true;
    }
    if (/error|failed|failure/u.test(type)) {
      const eventText = collectTextFromCodexEventValue(
        source.error
          || source.message
          || source.reason
          || source.status
          || source.data,
        2000
      );
      if (eventText && !jsonErrorText) {
        jsonErrorText = eventText;
      }
    }
  });

  if (reportedNoCredits) {
    return 'Codex CLI failed before producing an answer. The active Codex account reported no available credits.';
  }
  if (jsonErrorText) {
    return clampCodexSummaryText(jsonErrorText, 2000);
  }
  if (completedWithoutAgentMessage) {
    return 'Codex CLI finished without producing an assistant message.';
  }

  return summarizeCodexRawFailureOutput(stderr)
    || summarizeCodexRawFailureOutput(stdout)
    || 'Unknown error';
}

module.exports = {
  summarizeCodexCommandFailure
};
