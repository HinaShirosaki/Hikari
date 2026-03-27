'use strict';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function uniqueStrings(values, max = 20) {
  const seen = new Set();
  const out = [];
  asArray(values).forEach((value) => {
    const normalized = cleanText(value, 240);
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

function buildDefaultAnswerOutline(input = {}) {
  const requestType = cleanText(input.researchObjective?.request_type, 80);
  const sections = [
    {
      id: 'direct_answer',
      title: requestType === 'decision' ? 'Recommendation' : 'Direct Answer',
      objective: 'State the main conclusion as directly as possible.'
    },
    {
      id: 'key_evidence',
      title: 'Key Evidence',
      objective: 'Summarize the strongest supporting evidence tied to the plan.'
    },
    {
      id: 'uncertainty',
      title: 'Uncertainty and Gaps',
      objective: 'Preserve contradictions, caveats, and remaining unknowns.'
    }
  ];
  if (cleanText(input.intent, 80) === 'result_analysis') {
    sections.splice(1, 0, {
      id: 'interpretation',
      title: 'Interpretation',
      objective: 'Explain what the observed results most likely mean.'
    });
  }
  sections.push({
    id: 'next_steps',
    title: 'Suggested Next Steps',
    objective: 'List the next practical checks or follow-up questions.'
  });
  return {
    sections
  };
}

function mapEvidenceToOutlineSections(input = {}) {
  const outline = input.outline && typeof input.outline === 'object'
    ? input.outline
    : buildDefaultAnswerOutline(input);
  const citations = asArray(input.citations).slice(0, 12);
  const contradictions = asArray(input.accuracySnapshot?.contradictions).slice(0, 6);
  const uncertaintyMarkers = asArray(input.accuracySnapshot?.uncertainty_markers).slice(0, 6);
  const missingRequirements = asArray(input.completionCheck?.missing_requirements).slice(0, 6);
  return asArray(outline.sections).map((section, index) => {
    const title = cleanText(section?.title, 160);
    let evidence = citations.slice(Math.max(0, index - 1), Math.min(citations.length, index + 3));
    if (/uncertainty|gap/i.test(title)) {
      evidence = citations.slice(0, 4);
    }
    return {
      section_id: cleanText(section?.id, 120) || `section_${index + 1}`,
      title,
      objective: cleanText(section?.objective, 240),
      evidence,
      notes: uniqueStrings([
        /uncertainty|gap/i.test(title) ? contradictions.join('; ') : '',
        /uncertainty|gap/i.test(title) ? uncertaintyMarkers.join('; ') : '',
        /next step/i.test(title) ? missingRequirements.join('; ') : ''
      ], 4)
    };
  });
}

function validateSynthesisSections(input = {}) {
  const outline = input.outline && typeof input.outline === 'object'
    ? input.outline
    : { sections: [] };
  const renderedSections = asArray(input.renderedSections);
  const missingSectionIds = asArray(outline.sections)
    .map((section) => cleanText(section?.id, 120))
    .filter(Boolean)
    .filter((sectionId) => !renderedSections.some((row) => cleanText(row?.section_id, 120) === sectionId && cleanText(row?.text, 2000)));
  return {
    complete: missingSectionIds.length === 0,
    missing_section_ids: missingSectionIds
  };
}

module.exports = {
  buildDefaultAnswerOutline,
  mapEvidenceToOutlineSections,
  validateSynthesisSections
};
