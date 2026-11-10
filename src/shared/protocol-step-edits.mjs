export const MAX_PROTOCOL_STEP_EDITS = 20;
export const MAX_PROTOCOL_STEP_TEXT = 6000;

export function protocolStepText(step) {
  const value = typeof step === 'string' ? step : step?.text || step?.instruction || step?.action;
  return String(value ?? '').replace(/\r\n/g, '\n').trim();
}

export function normalizeProtocolStepEdits(edits) {
  if (!Array.isArray(edits) || !edits.length || edits.length > MAX_PROTOCOL_STEP_EDITS) return null;
  const seen = new Set();
  const normalized = [];
  for (const edit of edits) {
    const { step_number, expected_text, replacement_text } = edit || {};
    if (!Number.isSafeInteger(step_number) || step_number < 1 || seen.has(step_number)
      || typeof expected_text !== 'string' || typeof replacement_text !== 'string') return null;
    const before = protocolStepText(expected_text);
    const after = protocolStepText(replacement_text);
    if (!before || !after || before === after
      || before.length > MAX_PROTOCOL_STEP_TEXT || after.length > MAX_PROTOCOL_STEP_TEXT) return null;
    // Keep both token IDs and legacy positional placeholders bound to their values.
    const tokens = /\{\{ph:[^}]+\}\}|\[[^\[\]\n]+\]/g;
    if (JSON.stringify(before.match(tokens)) !== JSON.stringify(after.match(tokens))) return null;
    seen.add(step_number);
    normalized.push({ step_number, expected_text: before, replacement_text: after });
  }
  return normalized;
}
