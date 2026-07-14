import { PLACEHOLDER_TOKEN_REGEX, cloneProtocolSnapshot } from '../entry/entry-helpers.js';

export function stripNotebookStepBulletPrefix(rawLine) {
  return String(rawLine || '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
    .trim();
}

export function formatProtocolStepLineForEditor(step) {
  const source = String(step?.text || '');
  const placeholders = Array.isArray(step?.placeholders) ? step.placeholders : [];
  const matches = [...source.matchAll(PLACEHOLDER_TOKEN_REGEX)];

  if (!matches.length) {
    if (!placeholders.length) {
      return source.trim();
    }

    let placeholderIndex = 0;
    let replaced = false;
    const rendered = source.replace(/\[([^[\]]+)\]/g, (match) => {
      const placeholder = placeholders[placeholderIndex];
      if (!placeholder) {
        return match;
      }
      placeholderIndex += 1;
      replaced = true;
      return `[${String(placeholder?.name || '').trim() || 'value'}]`;
    });

    if (replaced) {
      return rendered.trim();
    }

    const trailing = placeholders
      .map((placeholder) => `[${String(placeholder?.name || '').trim() || 'value'}]`)
      .join(' ');
    return `${source} ${trailing}`.trim();
  }

  let cursor = 0;
  let line = '';

  matches.forEach((match) => {
    const index = Number(match.index || 0);
    const placeholderId = String(match[1] || '').trim();
    const placeholder = placeholders.find((item) => String(item?.id || '').trim() === placeholderId);
    line += source.slice(cursor, index);
    line += `[${String(placeholder?.name || '').trim() || 'value'}]`;
    cursor = index + match[0].length;
  });

  line += source.slice(cursor);
  return line.trim();
}

export function formatProtocolStepsForEditor(protocol) {
  const steps = Array.isArray(protocol?.steps) ? protocol.steps : [];
  return steps
    .map((step) => formatProtocolStepLineForEditor(step))
    .filter(Boolean)
    .map((line) => `• ${line}`)
    .join('\n');
}

export function buildEditedProtocolStep({ rawLine, baseStep, stepIndex, createId }) {
  const line = stripNotebookStepBulletPrefix(rawLine);
  const stepId = String(baseStep?.id || '').trim() || createId();
  const existingPlaceholders = Array.isArray(baseStep?.placeholders)
    ? baseStep.placeholders
      .filter((item) => item && typeof item === 'object')
      .map((item, index) => ({
        id: String(item?.id || '').trim() || `${stepId}_placeholder_${index + 1}`,
        name: String(item?.name || '').trim()
      }))
    : [];
  const usedPlaceholderIds = new Set();
  const placeholders = [];
  const text = line.replace(/\[([^[\]]*)\]/g, (_match, rawName) => {
    const placeholderName = String(rawName || '').trim() || 'value';
    const expectedIndex = placeholders.length;
    const normalizedName = placeholderName.toLowerCase();
    const exactMatch = existingPlaceholders.find((item) => (
      item.id
      && !usedPlaceholderIds.has(item.id)
      && String(item.name || '').trim().toLowerCase() === normalizedName
    ));
    const positionalMatch = existingPlaceholders[expectedIndex];
    const placeholderId = exactMatch?.id
      || (positionalMatch?.id && !usedPlaceholderIds.has(positionalMatch.id) ? positionalMatch.id : '')
      || createId();
    usedPlaceholderIds.add(placeholderId);
    placeholders.push({
      id: placeholderId,
      name: placeholderName
    });
    return `{{ph:${placeholderId}}}`;
  }).replace(/\s+/g, ' ').trim();

  return {
    id: stepId || `${String(baseStep?.id || '').trim() || 'protocol'}_step_${stepIndex + 1}`,
    text,
    placeholders
  };
}

export function buildEditedProtocolSnapshot({ baseProtocol, draftName, draftStepsText, createId }) {
  const fallbackProtocol = cloneProtocolSnapshot(baseProtocol) || {
    id: String(baseProtocol?.id || '').trim(),
    name: String(baseProtocol?.name || '').trim() || 'Untitled Protocol',
    category: String(baseProtocol?.category || '').trim(),
    purpose: String(baseProtocol?.purpose || '').trim(),
    steps: []
  };
  const rawName = String(draftName || '').trim();
  const rawLines = String(draftStepsText || '').replace(/\r\n?/g, '\n').split('\n');
  const nextSteps = rawLines
    .map((line) => stripNotebookStepBulletPrefix(line))
    .filter(Boolean)
    .map((line, index) => buildEditedProtocolStep({
      rawLine: line,
      baseStep: fallbackProtocol.steps[index],
      stepIndex: index,
      createId
    }));

  return {
    ...fallbackProtocol,
    name: rawName || fallbackProtocol.name || 'Untitled Protocol',
    steps: nextSteps
  };
}
