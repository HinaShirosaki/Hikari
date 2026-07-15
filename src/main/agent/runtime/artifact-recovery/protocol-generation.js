'use strict';

const {
  buildDirectProtocolGenerationFallbackArgs,
  buildProtocolGenerationAggregate,
  looksLikeDirectToolMaterializationFailure,
  normalizeProtocolGenerationArtifact
} = require('../tool-artifacts/protocol-generation.js');

function defaultCleanText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function stripInlineMarkdown(rawText = '') {
  return String(rawText || '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripListPrefix(rawText = '') {
  return stripInlineMarkdown(rawText)
    .replace(/^\s*(?:[-*]|\d+[.)])\s*/, '')
    .trim();
}

function normalizeSectionKey(rawLine = '') {
  const cleaned = stripInlineMarkdown(rawLine)
    .replace(/^#{1,6}\s*/, '')
    .replace(/:$/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!cleaned) {
    return '';
  }
  if (/^materials?$/.test(cleaned) || /^reagents?$/.test(cleaned)) {
    return 'materials';
  }
  if (/^(step by step|steps?|procedure|procedures|method|methods|protocol steps)$/.test(cleaned)) {
    return 'steps';
  }
  if (/^(timing|timeline|time course)$/.test(cleaned)) {
    return 'timing';
  }
  if (/^controls?$/.test(cleaned)) {
    return 'controls';
  }
  if (/^(key )?(caveats?|notes?|limitations?|troubleshooting)$/.test(cleaned)) {
    return 'caveats';
  }
  if (/^(purpose|overview|summary|rationale)$/.test(cleaned)) {
    return 'purpose';
  }
  return '';
}

function isHeadingLike(rawLine = '') {
  const line = String(rawLine || '').trim();
  return /^#{1,6}\s+/.test(line)
    || (/^\*\*[^*]{1,220}\*\*$/.test(line) && !/[.!?]\s*$/.test(stripInlineMarkdown(line)));
}

function extractProtocolTitle(lines = [], cleanText = defaultCleanText) {
  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line) {
      continue;
    }
    const cleaned = stripInlineMarkdown(line).replace(/^#{1,6}\s*/, '').trim();
    const protocolMatch = cleaned.match(/^protocol\s*:\s*(.+)$/i);
    if (protocolMatch?.[1]) {
      return cleanText(protocolMatch[1], 220);
    }
    if (isHeadingLike(line) && /\bprotocol\b/i.test(cleaned) && !normalizeSectionKey(line)) {
      return cleanText(cleaned.replace(/^protocol\s*[-:]\s*/i, ''), 220);
    }
  }
  return '';
}

function findProtocolHeadingLineIndex(lines = []) {
  return lines.findIndex((rawLine) => {
    const line = String(rawLine || '').trim();
    if (!line) {
      return false;
    }
    const cleaned = stripInlineMarkdown(line).replace(/^#{1,6}\s*/, '').trim();
    return /^protocol\s*:/i.test(cleaned)
      || (isHeadingLike(line) && /\bprotocol\b/i.test(cleaned) && !normalizeSectionKey(line));
  });
}

function lineHasProtocolGenerationUnavailableWarning(rawLine = '') {
  const line = stripInlineMarkdown(rawLine).toLowerCase();
  const rawLower = String(rawLine || '').toLowerCase();
  const mentionsProtocolGeneration = line.includes('protocol_generation')
    || line.includes('protocol-generation')
    || rawLower.includes('protocol_generation')
    || rawLower.includes('protocol-generation');
  return mentionsProtocolGeneration
    && (
      /not visible/.test(line)
      || /not exposed/.test(line)
      || /not available/.test(line)
      || /\bunavailable\b/.test(line)
      || /not found/.test(line)
      || /couldn['’]?t queue/.test(line)
      || /could not queue/.test(line)
      || /couldn['’]?t submit/.test(line)
      || /could not submit/.test(line)
      || /couldn['’]?t call/.test(line)
      || /could not call/.test(line)
      || /cannot call/.test(line)
      || /unable to call/.test(line)
    );
}

function stripProtocolGenerationUnavailablePreamble(rawAnswer = '') {
  const text = String(rawAnswer || '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const warningIndex = lines.findIndex(lineHasProtocolGenerationUnavailableWarning);
  if (warningIndex < 0) {
    return text;
  }
  const headingIndex = findProtocolHeadingLineIndex(lines);
  if (headingIndex >= 0 && headingIndex > warningIndex) {
    return lines.slice(headingIndex).join('\n').trim();
  }
  if (headingIndex === warningIndex) {
    const line = lines[headingIndex] || '';
    const headingMatch = line.match(/(?:#{1,6}\s*)?(?:\*\*)?protocol\s*:/i);
    if (headingMatch?.index >= 0) {
      return [
        line.slice(headingMatch.index),
        ...lines.slice(headingIndex + 1)
      ].join('\n').trim();
    }
  }
  return lines
    .filter((line) => !lineHasProtocolGenerationUnavailableWarning(line))
    .join('\n')
    .trim();
}

function uniqueCleanItems(items = [], cleanText = defaultCleanText, maxItems = 80) {
  const seen = new Set();
  const out = [];
  items.forEach((item) => {
    const text = cleanText(item, 1200);
    if (!text) {
      return;
    }
    const key = text.toLowerCase();
    if (seen.has(key) || out.length >= maxItems) {
      return;
    }
    seen.add(key);
    out.push(text);
  });
  return out;
}

function pushSectionItem(sections, sectionKey, rawLine, cleanText = defaultCleanText) {
  const value = cleanText(stripListPrefix(rawLine), 1200);
  if (value) {
    sections[sectionKey].push(value);
  }
}

function textRequestsProtocolGeneration(rawMessage = '') {
  const text = String(rawMessage || '').toLowerCase();
  if (!text) {
    return false;
  }
  return [
    /\b(generate|create|draft|prepare|build|write|make)\b[\s\S]{0,180}\b(protocol|sop|procedure|method)\b/,
    /\b(protocol|sop|procedure)\b[\s\S]{0,180}\b(from|based on|for this paper|for the paper|from this paper)\b/,
    /\bturn\b[\s\S]{0,120}\b(paper|methods?|selected text|selection)\b[\s\S]{0,120}\bprotocol\b/
  ].some((pattern) => pattern.test(text));
}

function buildTroubleshootingText(sections, cleanText = defaultCleanText) {
  const blocks = [];
  const pushBlock = (label, values = []) => {
    const items = uniqueCleanItems(values, cleanText, 40);
    if (items.length) {
      blocks.push(`${label}:\n${items.map((item) => `- ${item}`).join('\n')}`);
    }
  };
  pushBlock('Timing', sections.timing);
  pushBlock('Controls', sections.controls);
  pushBlock('Key caveats', sections.caveats);
  return cleanText(blocks.join('\n\n'), 6000);
}

function parseAuthoredProtocolMarkdown(rawAnswer = '', { cleanText = defaultCleanText } = {}) {
  const text = stripProtocolGenerationUnavailablePreamble(rawAnswer);
  if (!text.trim()) {
    return null;
  }
  const lines = text.split('\n');
  const title = extractProtocolTitle(lines, cleanText);
  const sections = {
    materials: [],
    steps: [],
    timing: [],
    controls: [],
    caveats: [],
    purpose: []
  };
  let currentSection = '';
  let currentStepIndex = -1;

  lines.forEach((rawLine) => {
    const line = String(rawLine || '').trim();
    if (!line) {
      return;
    }
    const cleaned = stripInlineMarkdown(line).replace(/^#{1,6}\s*/, '').trim();
    if (title && cleaned === title) {
      return;
    }
    if (/^protocol\s*:/i.test(cleaned)) {
      return;
    }
    const sectionKey = normalizeSectionKey(line);
    if (sectionKey) {
      currentSection = sectionKey;
      currentStepIndex = -1;
      return;
    }

    const numberedStep = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
    if (currentSection === 'steps' || (!currentSection && numberedStep)) {
      if (numberedStep?.[2]) {
        sections.steps.push(cleanText(stripInlineMarkdown(numberedStep[2]), 2000));
        currentStepIndex = sections.steps.length - 1;
        return;
      }
      if (currentStepIndex >= 0) {
        const continuation = cleanText(stripListPrefix(line), 1000);
        if (continuation) {
          sections.steps[currentStepIndex] = cleanText(`${sections.steps[currentStepIndex]} ${continuation}`, 2400);
        }
      }
      return;
    }

    if (['materials', 'timing', 'controls', 'caveats'].includes(currentSection)) {
      pushSectionItem(sections, currentSection, line, cleanText);
      return;
    }

    if (currentSection === 'purpose' || !currentSection) {
      const value = cleanText(stripInlineMarkdown(line), 1200);
      if (value && !/^[-*]\s+/.test(line)) {
        sections.purpose.push(value);
      }
    }
  });

  const steps = uniqueCleanItems(sections.steps, cleanText, 120);
  const materials = uniqueCleanItems(sections.materials, cleanText, 80);
  const name = title || 'Generated protocol';
  const purpose = cleanText(sections.purpose.join(' '), 1000)
    || 'Generated from paper context in the Hikari agent.';
  const protocol = {
    name,
    purpose,
    materials,
    steps: steps.map((step, index) => ({
      step_number: index + 1,
      text: step
    })),
    troubleshooting: buildTroubleshootingText(sections, cleanText)
  };
  const hasProtocolShape = steps.length >= 2 && (
    materials.length > 0
    || /\bprotocol\b/i.test(name)
    || /materials?/i.test(text)
  );
  return hasProtocolShape ? protocol : null;
}

function buildAuthoredProtocolGenerationFallbackArgs(rawMessage = '', rawAnswer = '', { cleanText = defaultCleanText } = {}) {
  if (!textRequestsProtocolGeneration(rawMessage)) {
    return null;
  }
  const protocol = parseAuthoredProtocolMarkdown(rawAnswer, { cleanText });
  if (!protocol?.steps?.length) {
    return null;
  }
  return {
    protocol,
    result_summary: `Prepared protocol "${cleanText(protocol.name, 220)}" for app review.`,
    save: true
  };
}

async function resolveProtocolGenerationArtifact({
  agentResult = {},
  userMessage = '',
  rawText = '',
  cleanText = defaultCleanText,
  lifecycleRecorder = null,
  recordLifecycleEvent = () => {},
  executeProtocolGeneration = null,
  streamedProtocolGenerationPayloads = [],
  toolContext = {},
  lifecycleStage = 'agent_direct_tool_fallback',
  routingIntent = 'agent',
  agentLabel = 'Agent'
} = {}) {
  const artifacts = Array.isArray(streamedProtocolGenerationPayloads)
    ? streamedProtocolGenerationPayloads
    : [];
  let protocolGenerationArtifact = buildProtocolGenerationAggregate(artifacts);
  if (protocolGenerationArtifact || !executeProtocolGeneration || agentResult.status === 'needs_more_info') {
    return protocolGenerationArtifact;
  }

  const rawAnswer = cleanText(agentResult.answer || rawText, 120000);
  let fallbackKind = '';
  let fallbackArgs = buildDirectProtocolGenerationFallbackArgs(userMessage, { cleanText });
  if (fallbackArgs && looksLikeDirectToolMaterializationFailure(`${rawText}\n${agentResult.answer}`)) {
    fallbackKind = 'materialization_failure';
  } else {
    fallbackArgs = buildAuthoredProtocolGenerationFallbackArgs(userMessage, rawAnswer, { cleanText });
    fallbackKind = fallbackArgs ? 'authored_protocol_markdown' : '';
  }
  if (!fallbackArgs) {
    return null;
  }

  recordLifecycleEvent(lifecycleRecorder, {
    stage: lifecycleStage,
    status: 'started',
    routing_intent: routingIntent,
    tool_name: 'protocol_generation',
    message: fallbackKind === 'authored_protocol_markdown'
      ? `Normalizing ${agentLabel}-authored protocol prose through Hikari protocol_generation.`
      : `Recovering direct protocol_generation after ${agentLabel} could not materialize the named MCP tool.`
  });
  try {
    const fallbackResult = await executeProtocolGeneration(fallbackArgs, {
      ...ensureObject(toolContext),
      lifecycleRecorder
    });
    const fallbackArtifact = normalizeProtocolGenerationArtifact(fallbackResult, { cleanText });
    if (fallbackArtifact?.protocol) {
      artifacts.push(fallbackArtifact);
      protocolGenerationArtifact = buildProtocolGenerationAggregate(artifacts);
      agentResult.status = 'completed';
      agentResult.answer = fallbackArtifact.save_requested || fallbackArtifact.requires_user_approval
        ? 'The protocol is ready for review.'
        : (cleanText(agentResult.answer, 120000) || 'The protocol was normalized.');
      agentResult.follow_up_questions = [];
      agentResult.user_question = null;
      agentResult.reasoning_summary = fallbackKind === 'authored_protocol_markdown'
        ? `Recovered by normalizing a ${agentLabel}-authored protocol answer through the Hikari protocol_generation tool.`
        : `Recovered by directly executing the named Hikari protocol_generation tool after ${agentLabel} could not materialize it.`;
      recordLifecycleEvent(lifecycleRecorder, {
        stage: lifecycleStage,
        status: 'ok',
        routing_intent: routingIntent,
        tool_name: 'protocol_generation',
        message: cleanText(fallbackArtifact.summary, 320) || 'Direct protocol_generation fallback completed.',
        meta: {
          save_requested: fallbackArtifact.save_requested === true,
          protocol_name: cleanText(fallbackArtifact.protocol?.name || fallbackArtifact.protocol?.title, 220)
        }
      });
      return protocolGenerationArtifact;
    }
    recordLifecycleEvent(lifecycleRecorder, {
      stage: lifecycleStage,
      status: 'failed',
      routing_intent: routingIntent,
      tool_name: 'protocol_generation',
      message: cleanText(fallbackResult?.error || fallbackResult?.status, 320)
        || 'Direct protocol_generation fallback did not return a protocol.'
    });
  } catch (error) {
    recordLifecycleEvent(lifecycleRecorder, {
      stage: lifecycleStage,
      status: 'failed',
      routing_intent: routingIntent,
      tool_name: 'protocol_generation',
      message: cleanText(error?.message, 320) || 'Direct protocol_generation fallback failed.'
    });
  }
  return null;
}

module.exports = {
  resolveProtocolGenerationArtifact
};
