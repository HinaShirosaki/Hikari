'use strict';

const { ensureObject } = require('../../../lib/normalize.js');
const { DEFAULT_MAX_RESULTS, PAPER_FINDING_RESULT_TYPE, PAPER_FINDING_TASK_TYPE } = require('./constants.js');
const { cleanText, normalizeMaxResults, normalizePaperFindingFrequency, normalizePreferredJournals, normalizeProject } = require('./frequency-and-project.js');

function buildPaperFindingPrompt({
  project,
  requirements = '',
  preferredJournals = [],
  maxResults = DEFAULT_MAX_RESULTS,
  frequencyLabel: cadenceLabel = ''
} = {}) {
  const explicitRequirements = cleanText(requirements, 12_000);
  const projectDescription = cleanText(project?.description, 12_000);
  const journals = normalizePreferredJournals(preferredJournals);
  const requirementsBlock = explicitRequirements
    ? `User-specified paper requirements:\n${explicitRequirements}`
    : [
      'No separate paper requirements were supplied.',
      'Infer the search topics from the current project MEMORY.md, related durable Hikari memory, and the captured project description below.',
      'Prefer the current project MEMORY.md when it is newer than the captured description.'
    ].join(' ');
  const journalBlock = journals.length
    ? `Saved preferred journals (soft ranking only, never a hard filter unless the requirements explicitly say "only"): ${journals.join('; ')}`
    : 'No preferred journals were supplied.';

  return [
    '# Scheduled Hikari paper finding',
    '',
    `This is a background ${cleanText(cadenceLabel, 120) || 'recurring'} paper-discovery run. Do not ask the user questions.`,
    '',
    `Project:\n${JSON.stringify({
      id: cleanText(project?.id, 220),
      name: cleanText(project?.name, 320),
      captured_description: projectDescription
    }, null, 2)}`,
    '',
    requirementsBlock,
    '',
    journalBlock,
    '',
    'Required workflow:',
    '1. Read the current project MEMORY.md when present in the working directory. Recall only related durable Hikari memory that helps refine the project topic; do not write or change memory.',
    '2. Derive a compact literature query from the explicit requirements, or from the project description and related memory when requirements are empty.',
    '3. Make at most one `literature_search` call. Use literature API sources such as `pubmed`, `europe_pmc`, and `crossref`; use native Codex web search separately only when it adds current evidence.',
    '4. Do not call `paper_download`. Do not download, open, save, ingest, attach, or transform a PDF. Do not create a Hikari paper record. This run is metadata-only.',
    `5. Select up to ${normalizeMaxResults(maxResults)} useful paper cards. Prefer stable identifiers and grounded bibliographic metadata. Explain briefly why each paper is relevant to this project.`,
    '',
    'Return exactly one JSON object with no Markdown fence and this shape:',
    JSON.stringify({
      type: PAPER_FINDING_RESULT_TYPE,
      query: 'the final compact search query',
      summary: 'one short run summary',
      papers: [{
        title: 'paper title',
        authors: ['author names when available'],
        journal: 'journal name',
        published_at: 'publication date or year',
        doi: 'DOI when available',
        pmid: 'PMID when available',
        pmcid: 'PMCID when available',
        url: 'canonical landing-page URL',
        summary: 'abstract-grounded one-sentence summary',
        relevance_reason: 'why this paper matches the project',
        source: 'PubMed, Europe PMC, Crossref, or web',
        already_local: false
      }]
    }, null, 2),
    '',
    'Omit PDF URLs, local file paths, Markdown paths, extracted text, and download instructions from the result.'
  ].join('\n');
}

function buildPaperFindingScheduledTaskInput(input = {}) {
  const source = ensureObject(input);
  const project = normalizeProject(source);
  const frequency = normalizePaperFindingFrequency(source);
  const requirements = cleanText(source.requirements, 12_000);
  const preferredJournals = normalizePreferredJournals([
    source.preferred_journals,
    source.preferredJournals,
    source.preferred_journal,
    source.preferredJournal
  ]);
  const maxResults = normalizeMaxResults(source.max_results ?? source.maxResults);
  const executionSource = ensureObject(source.execution);
  const title = cleanText(source.title, 220)
    || `Find papers for ${project.name || project.id}`;
  const paperFindingMetadata = {
    project_id: project.id,
    project_name: project.name,
    project_description: project.description,
    requirements,
    frequency_value: frequency.value,
    frequency_unit: frequency.unit,
    interval_minutes: frequency.interval_minutes,
    frequency_label: frequency.label,
    preferred_journals: preferredJournals,
    max_results: maxResults,
    result_delivery: 'home_dashboard_card',
    download_policy: 'metadata_only'
  };

  return {
    title,
    prompt: buildPaperFindingPrompt({
      project,
      requirements,
      preferredJournals,
      maxResults,
      frequencyLabel: frequency.label
    }),
    enabled: source.enabled !== false,
    task_type: PAPER_FINDING_TASK_TYPE,
    metadata: {
      ...ensureObject(source.metadata),
      paper_finding: paperFindingMetadata
    },
    schedule: {
      kind: 'interval',
      interval_minutes: frequency.interval_minutes,
      ...(cleanText(source.anchor_at || source.anchorAt, 80)
        ? { anchor_at: cleanText(source.anchor_at || source.anchorAt, 80) }
        : {})
    },
    project,
    execution: {
      model: cleanText(executionSource.model || source.model, 120),
      reasoning_effort: cleanText(
        executionSource.reasoning_effort
          || executionSource.reasoningEffort
          || source.reasoning_effort
          || source.reasoningEffort
          || 'medium',
        40
      ).toLowerCase(),
      enable_web_search: true,
      timeout_ms: Number(
        executionSource.timeout_ms
          ?? executionSource.timeoutMs
          ?? source.timeout_ms
          ?? source.timeoutMs
          ?? 900_000
      )
    }
  };
}

module.exports = {
  buildPaperFindingPrompt,
  buildPaperFindingScheduledTaskInput
};
