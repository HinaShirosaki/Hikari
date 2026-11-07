'use strict';

const { mergePaperEvidence, mergeSourceEvidence } = require('../../../../shared/paper-evidence.mjs');
const { recordCitationTarget } = require('../../../../shared/record-citations.mjs');

function lookupSourceType(toolName) {
  if (/(?:^|__)protocol[_-](?:lookup|matching)$/.test(toolName)) return 'protocol';
  if (/(?:^|__)notebook[_-]lookup$/.test(toolName)) return 'notebook';
  return '';
}

function getRecordEvidence(type, output) {
  const stored = mergeSourceEvidence(output.paper_evidence, output.meta?.paper_evidence)
    .filter(block => block.source_type === type);
  if (stored.length) return stored;
  const items = Array.isArray(output.items) ? output.items : [];
  const matches = type === 'protocol' ? [...items, output.selected_protocol] : items;
  return mergeSourceEvidence(matches.flatMap(item => {
    const target = recordCitationTarget(type, item?.id);
    if (!target || target !== item.citation_target) return [];
    return [{
      source_type: type,
      record_id: item.id,
      title: item.title || item.name,
      excerpt: type === 'protocol' ? item.purpose : (item.content?.result || item.result || item.summary)
    }];
  }));
}

function extractPaperEvidenceFromToolOutput(toolName, output, depth = 0) {
  const type = lookupSourceType(toolName);
  if ((!type && !/(?:^|__)(?:paper[_-]analysis|literature[_-]search)$/.test(toolName)) || depth > 10 || !output) return [];
  if (typeof output === 'string') {
    try { return extractPaperEvidenceFromToolOutput(toolName, JSON.parse(output), depth + 1); } catch { return []; }
  }
  if (typeof output !== 'object' || output.isError === true || output.ok === false) return [];
  // Prefer full structured data to the model's potentially shortened text copy.
  const direct = type ? getRecordEvidence(type, output)
    : mergePaperEvidence(output.paper_evidence, output.meta?.paper_evidence, output.loaded_context_blocks);
  if (direct.length) return direct;
  if (Array.isArray(output)) {
    return mergeSourceEvidence(...output.map(item => extractPaperEvidenceFromToolOutput(toolName, item, depth + 1)));
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
