'use strict';

const { mergePaperEvidence } = require('../../../../shared/paper-evidence.mjs');

function extractPaperEvidenceFromToolOutput(toolName, output, depth = 0) {
  if (!/(?:^|__)(?:paper[_-]analysis|literature[_-]search)$/.test(String(toolName)) || depth > 10 || !output) return [];
  if (typeof output === 'string') {
    try { return extractPaperEvidenceFromToolOutput(toolName, JSON.parse(output), depth + 1); } catch { return []; }
  }
  if (typeof output !== 'object' || output.isError === true || output.ok === false) return [];
  // Prefer full structured data to the model's potentially shortened text copy.
  const direct = mergePaperEvidence(output.paper_evidence, output.meta?.paper_evidence, output.loaded_context_blocks);
  if (direct.length) return direct;
  if (Array.isArray(output)) {
    return mergePaperEvidence(...output.map(item => extractPaperEvidenceFromToolOutput(toolName, item, depth + 1)));
  }
  for (const candidate of [output.structuredContent, output.structured_content,
    output.Ok, output.result, output.output, output.tool_result, output.toolResult,
    output.tool_output, output.toolOutput, output.tool_output_text, output.content, output.text]) {
    const found = extractPaperEvidenceFromToolOutput(toolName, candidate, depth + 1);
    if (found.length) return found;
  }
  return [];
}

function extractPaperEvidenceFromToolEvent(event = {}) {
  return extractPaperEvidenceFromToolOutput(event.tool_name || event.toolName, event);
}

module.exports = { extractPaperEvidenceFromToolOutput, extractPaperEvidenceFromToolEvent };
