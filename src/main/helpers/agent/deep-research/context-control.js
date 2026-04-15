'use strict';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, _maxLength = 2000) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function cloneJson(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function uniqueStrings(values, max = 20) {
  const seen = new Set();
  const out = [];
  asArray(values).forEach((value) => {
    const normalized = cleanText(value, 320);
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
}

function normalizeEvidenceRow(value) {
  const source = value && typeof value === 'object' ? value : {};
  const normalized = {
    source: cleanText(source.source, 120),
    pointer: cleanText(source.pointer, 240),
    reason: cleanText(source.reason, 320)
  };
  return normalized.source || normalized.pointer ? normalized : null;
}

function dedupeEvidenceRows(rows, max = 40) {
  const seen = new Set();
  const out = [];
  asArray(rows).forEach((row) => {
    const normalized = normalizeEvidenceRow(row);
    if (!normalized) {
      return;
    }
    const key = `${normalized.source.toLowerCase()}::${normalized.pointer.toLowerCase()}`;
    if (seen.has(key) || out.length >= max) {
      return;
    }
    seen.add(key);
    out.push(normalized);
  });
  return out;
}

function createContextControlState(input = {}) {
  return {
    objective_summary: cleanText(input.objective_summary, 600),
    rolling_summary: cleanText(input.rolling_summary, 1200),
    round_summaries: [],
    evidence_buffer: dedupeEvidenceRows(input.evidence_buffer, 40),
    section_buffers: {},
    retrieval_notes: uniqueStrings(input.retrieval_notes, 20),
    updated_at: new Date().toISOString()
  };
}

function recordSectionBuffer(state, sectionName, evidenceRows = []) {
  const source = state && typeof state === 'object' ? state : createContextControlState();
  const normalizedSection = cleanText(sectionName, 160);
  if (!normalizedSection) {
    return cloneJson(source, createContextControlState());
  }
  const next = cloneJson(source, createContextControlState());
  const currentRows = asArray(next.section_buffers?.[normalizedSection]);
  if (!next.section_buffers || typeof next.section_buffers !== 'object') {
    next.section_buffers = {};
  }
  next.section_buffers[normalizedSection] = dedupeEvidenceRows([
    ...currentRows,
    ...asArray(evidenceRows)
  ], 16);
  next.updated_at = new Date().toISOString();
  return next;
}

function updateContextControlState(state, input = {}) {
  const source = state && typeof state === 'object' ? state : createContextControlState();
  const next = cloneJson(source, createContextControlState());
  const roundSummary = {
    round: Number.isFinite(Number(input.round)) ? Number(input.round) : next.round_summaries.length + 1,
    stage: cleanText(input.stage, 80) || 'execute',
    tool_name: cleanText(input.tool_name, 120),
    assistant_text: cleanText(input.assistant_text, 1200),
    tool_summary: cleanText(input.tool_summary, 320),
    missing_requirements: uniqueStrings(input.missing_requirements, 6)
  };
  next.round_summaries = asArray(next.round_summaries)
    .concat([roundSummary])
    .slice(-8);
  next.evidence_buffer = dedupeEvidenceRows([
    ...asArray(next.evidence_buffer),
    ...asArray(input.evidence_rows)
  ], 40);
  next.retrieval_notes = uniqueStrings([
    ...asArray(next.retrieval_notes),
    cleanText(input.retrieval_note, 320),
    cleanText(input.tool_summary, 320)
  ], 20);

  asArray(input.section_buffers).forEach((sectionRow) => {
    const sectionName = cleanText(sectionRow?.section, 160);
    if (!sectionName) {
      return;
    }
    const currentRows = asArray(next.section_buffers?.[sectionName]);
    if (!next.section_buffers || typeof next.section_buffers !== 'object') {
      next.section_buffers = {};
    }
    next.section_buffers[sectionName] = dedupeEvidenceRows([
      ...currentRows,
      ...asArray(sectionRow?.evidence)
    ], 16);
  });

  const roundLines = asArray(next.round_summaries)
    .slice(-4)
    .map((item) => {
      const parts = [
        cleanText(item.tool_name, 120),
        cleanText(item.tool_summary, 220),
        cleanText(item.assistant_text, 220)
      ].filter(Boolean);
      return parts.join(': ');
    })
    .filter(Boolean);
  next.rolling_summary = uniqueStrings([
    cleanText(next.objective_summary, 400),
    ...roundLines
  ], 6).join(' | ');
  next.updated_at = new Date().toISOString();
  return next;
}

function buildContextControlSnapshot(state, options = {}) {
  const source = state && typeof state === 'object' ? state : createContextControlState();
  const maxEvidence = Math.max(1, Number(options.maxEvidence) || 10);
  const maxRounds = Math.max(1, Number(options.maxRounds) || 4);
  const sectionLimit = Math.max(1, Number(options.maxSections) || 4);
  const sectionEntries = Object.entries(source.section_buffers && typeof source.section_buffers === 'object'
    ? source.section_buffers
    : {})
    .slice(0, sectionLimit)
    .map(([section, evidence]) => ({
      section: cleanText(section, 160),
      evidence: dedupeEvidenceRows(evidence, 8)
    }));
  return {
    objective_summary: cleanText(source.objective_summary, 600),
    rolling_summary: cleanText(source.rolling_summary, 1200),
    round_summaries: asArray(source.round_summaries).slice(-maxRounds).map((item) => ({
      round: Number(item?.round) || 0,
      stage: cleanText(item?.stage, 80),
      tool_name: cleanText(item?.tool_name, 120),
      tool_summary: cleanText(item?.tool_summary, 320),
      assistant_text: cleanText(item?.assistant_text, 800),
      missing_requirements: uniqueStrings(item?.missing_requirements, 6)
    })),
    evidence_buffer: dedupeEvidenceRows(source.evidence_buffer, maxEvidence),
    section_buffers: sectionEntries,
    retrieval_notes: uniqueStrings(source.retrieval_notes, 8),
    updated_at: cleanText(source.updated_at, 80)
  };
}

module.exports = {
  createContextControlState,
  recordSectionBuffer,
  updateContextControlState,
  buildContextControlSnapshot
};
