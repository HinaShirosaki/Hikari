'use strict';

const { asArray, ensureObject } = require('../../lib/normalize.js');

const PAPER_FINDING_TASK_TYPE = 'paper_finding';
const PAPER_FINDING_RESULT_TYPE = 'paper_finding_result';
const DEFAULT_FREQUENCY_VALUE = 1;
const DEFAULT_FREQUENCY_UNIT = 'week';
const DEFAULT_MAX_RESULTS = 12;
const MAX_INTERVAL_MINUTES = 525_600;

const FREQUENCY_UNIT_MINUTES = Object.freeze({
  minute: 1,
  hour: 60,
  day: 1_440,
  week: 10_080,
  month: 43_200,
  year: 525_600
});

function cleanText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function hasOwn(value, key) {
  return Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key));
}

function normalizeFrequencyUnit(value) {
  const unit = cleanText(value, 40)
    .toLowerCase()
    .replace(/[_\s-]+/g, '')
    .replace(/s$/u, '');
  if (unit === 'min' || unit === 'minute') {
    return 'minute';
  }
  if (unit === 'hr' || unit === 'hour') {
    return 'hour';
  }
  if (unit === 'day') {
    return 'day';
  }
  if (unit === 'wk' || unit === 'week') {
    return 'week';
  }
  if (unit === 'mo' || unit === 'month') {
    return 'month';
  }
  if (unit === 'yr' || unit === 'year') {
    return 'year';
  }
  return '';
}

function frequencyLabel(value, unit) {
  const displayValue = Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(3)));
  return `Every ${displayValue} ${unit}${Number(value) === 1 ? '' : 's'}`;
}

function parseFrequencyString(value) {
  const match = cleanText(value, 120).match(
    /^(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|months?|mos?|years?|yrs?)$/iu
  );
  if (!match) {
    return null;
  }
  return {
    value: Number(match[1]),
    unit: normalizeFrequencyUnit(match[2])
  };
}

function normalizePaperFindingFrequency(input = {}) {
  const source = ensureObject(input);
  const rawFrequency = source.frequency;
  const frequencyObject = ensureObject(rawFrequency);
  const parsedString = typeof rawFrequency === 'string'
    ? parseFrequencyString(rawFrequency)
    : null;
  const directInterval = Number(
    source.interval_minutes
      ?? source.intervalMinutes
      ?? frequencyObject.interval_minutes
      ?? frequencyObject.intervalMinutes
  );
  let value = Number(
    frequencyObject.value
      ?? source.frequency_value
      ?? source.frequencyValue
      ?? parsedString?.value
      ?? DEFAULT_FREQUENCY_VALUE
  );
  let unit = normalizeFrequencyUnit(
    frequencyObject.unit
      || source.frequency_unit
      || source.frequencyUnit
      || parsedString?.unit
      || DEFAULT_FREQUENCY_UNIT
  );

  if (Number.isFinite(directInterval) && directInterval > 0) {
    const preferredUnits = ['year', 'month', 'week', 'day', 'hour', 'minute'];
    unit = preferredUnits.find((candidate) => (
      directInterval >= FREQUENCY_UNIT_MINUTES[candidate]
      && directInterval % FREQUENCY_UNIT_MINUTES[candidate] === 0
    )) || 'minute';
    value = directInterval / FREQUENCY_UNIT_MINUTES[unit];
  }

  if (!Number.isFinite(value) || value <= 0 || !unit) {
    throw new Error('frequency must be a positive value with a minute, hour, day, week, month, or year unit.');
  }
  const intervalMinutes = Math.round(value * FREQUENCY_UNIT_MINUTES[unit]);
  if (intervalMinutes < 1 || intervalMinutes > MAX_INTERVAL_MINUTES) {
    throw new Error(`paper finding frequency must be between 1 minute and ${MAX_INTERVAL_MINUTES} minutes.`);
  }
  return {
    value,
    unit,
    interval_minutes: intervalMinutes,
    label: frequencyLabel(value, unit)
  };
}

function normalizePreferredJournals(value) {
  const candidates = [];
  function add(entry) {
    if (Array.isArray(entry)) {
      entry.forEach(add);
      return;
    }
    if (entry && typeof entry === 'object') {
      add(entry.name || entry.url || entry.href || '');
      return;
    }
    String(entry || '')
      .split(/[;\n]+/u)
      .map((item) => cleanText(item, 240))
      .filter(Boolean)
      .forEach((item) => candidates.push(item));
  }
  add(value);
  const seen = new Set();
  return candidates.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  }).slice(0, 12);
}

function normalizeProject(input = {}) {
  const source = ensureObject(input);
  const project = ensureObject(source.project);
  const normalized = {
    id: cleanText(project.id || project.project_id || project.projectId, 220),
    name: cleanText(project.name || project.project_name || project.projectName, 320),
    description: cleanText(
      project.description
        || source.project_description
        || source.projectDescription,
      12_000
    ),
    storage_path: cleanText(
      project.storage_path
        || project.storagePath
        || source.storage_path
        || source.storagePath,
      2400
    ),
    data_file_path: cleanText(
      project.data_file_path
        || project.dataFilePath
        || source.data_file_path
        || source.dataFilePath,
      2400
    ),
    cwd: cleanText(project.cwd || source.cwd, 2400)
  };
  if (!normalized.id && !normalized.name) {
    throw new Error('paper finding requires a project id or project name.');
  }
  return normalized;
}

function normalizeMaxResults(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_RESULTS;
  }
  return Math.max(1, Math.min(24, Math.round(parsed)));
}

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

function isPaperFindingTask(task = {}) {
  return cleanText(task?.task_type || task?.taskType, 80).toLowerCase() === PAPER_FINDING_TASK_TYPE;
}

function parseJsonObject(raw = '') {
  const text = cleanText(raw, 120_000);
  if (!text) {
    return null;
  }
  const candidates = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  if (fenced?.[1]) {
    candidates.push(fenced[1].trim());
  }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Try the next possible JSON object.
    }
  }
  return null;
}

function unwrapPaperFindingPayload(value) {
  let source = ensureObject(value);
  for (let depth = 0; depth < 4; depth += 1) {
    const papers = source.papers || source.selected_papers || source.selectedPapers || source.items;
    if (Array.isArray(papers)) {
      return source;
    }
    const nestedObject = ensureObject(
      source.paper_finding_result
        || source.paperFindingResult
        || source.result
        || source.output
        || source.data
    );
    if (Object.keys(nestedObject).length) {
      source = nestedObject;
      continue;
    }
    const nestedText = source.answer || source.assistant_text || source.assistantText || source.text;
    const parsedText = typeof nestedText === 'string' ? parseJsonObject(nestedText) : null;
    if (parsedText) {
      source = parsedText;
      continue;
    }
    break;
  }
  return source;
}

function safeHttpUrl(value) {
  const raw = cleanText(value, 2000);
  if (!raw) {
    return '';
  }
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function normalizeAuthors(value) {
  const source = Array.isArray(value)
    ? value
    : String(value || '').split(/\s*;\s*|\s+and\s+/iu);
  const seen = new Set();
  return source
    .map((author) => cleanText(
      author && typeof author === 'object'
        ? (author.name || [author.given, author.family].filter(Boolean).join(' '))
        : author,
      240
    ))
    .filter((author) => {
      const key = author.toLowerCase();
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 24);
}

function normalizePaperCard(value = {}) {
  const source = ensureObject(value);
  const title = cleanText(source.title || source.paper_title || source.paperTitle, 500);
  if (!title) {
    return null;
  }
  const doi = cleanText(source.doi, 180).replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, '');
  const pmid = cleanText(source.pmid, 120);
  const pmcid = cleanText(source.pmcid, 120);
  const explicitUrl = safeHttpUrl(source.url || source.page_url || source.pageUrl);
  const url = explicitUrl || (doi ? `https://doi.org/${encodeURIComponent(doi)}` : '');
  const downloadStatus = cleanText(source.download_status || source.downloadStatus, 80).toLowerCase();
  return {
    title,
    authors: normalizeAuthors(source.authors || source.author),
    journal: cleanText(source.journal || source.journal_name || source.journalName, 260),
    published_at: cleanText(
      source.published_at
        || source.publishedAt
        || source.publication_date
        || source.publicationDate
        || source.year,
      80
    ),
    doi,
    pmid,
    pmcid,
    url,
    summary: cleanText(source.summary || source.snippet || source.abstract, 1600),
    relevance_reason: cleanText(
      source.relevance_reason
        || source.relevanceReason
        || source.reason,
      800
    ),
    source: cleanText(source.source || source.database, 120),
    already_local: source.already_local === true
      || source.alreadyLocal === true
      || downloadStatus === 'already_ingested',
    download_status: 'not_requested'
  };
}

function paperIdentity(card = {}) {
  return cleanText(
    card.doi
      || card.pmid
      || card.pmcid
      || card.url
      || `${card.title}|${card.journal}|${card.published_at}`,
    2000
  ).toLowerCase();
}

function parsePaperFindingResultText(text = '', {
  maxResults = DEFAULT_MAX_RESULTS,
  completedAt = ''
} = {}) {
  const parsed = parseJsonObject(text);
  const payload = unwrapPaperFindingPayload(parsed || {});
  const rawPapers = asArray(
    payload.papers
      || payload.selected_papers
      || payload.selectedPapers
      || payload.items
  );
  const seen = new Set();
  const papers = rawPapers
    .map(normalizePaperCard)
    .filter((card) => {
      const key = card ? paperIdentity(card) : '';
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, normalizeMaxResults(maxResults));
  const summary = cleanText(
    payload.summary
      || payload.message
      || (parsed ? '' : text),
    4000
  );

  return {
    type: PAPER_FINDING_RESULT_TYPE,
    status: parsed ? 'completed' : 'unparsed',
    generated_at: cleanText(
      payload.generated_at
        || payload.generatedAt
        || completedAt,
      80
    ),
    query: cleanText(payload.query || payload.search_query || payload.searchQuery, 600),
    summary: summary || (
      papers.length
        ? `Found ${papers.length} paper${papers.length === 1 ? '' : 's'}.`
        : 'No matching paper metadata was returned.'
    ),
    papers,
    download_policy: 'metadata_only',
    ...(parsed ? {} : { raw_text: cleanText(text, 20_000) })
  };
}

function normalizePaperFindingRunResult(task = {}, text = '', context = {}) {
  if (!isPaperFindingTask(task)) {
    return null;
  }
  const config = ensureObject(ensureObject(task.metadata).paper_finding);
  return parsePaperFindingResultText(text, {
    maxResults: config.max_results,
    completedAt: context.completedAt || context.completed_at
  });
}

function buildPaperFindingInputFromTask(task = {}) {
  const source = ensureObject(task);
  const project = ensureObject(source.project);
  const config = ensureObject(ensureObject(source.metadata).paper_finding);
  const execution = ensureObject(source.execution);
  return {
    title: cleanText(source.title, 220),
    requirements: cleanText(config.requirements, 12_000),
    frequency: {
      value: Number(config.frequency_value) || DEFAULT_FREQUENCY_VALUE,
      unit: normalizeFrequencyUnit(config.frequency_unit) || DEFAULT_FREQUENCY_UNIT
    },
    preferred_journals: normalizePreferredJournals(config.preferred_journals),
    max_results: normalizeMaxResults(config.max_results),
    enabled: source.enabled !== false,
    project: {
      id: cleanText(project.id, 220) || cleanText(config.project_id, 220),
      name: cleanText(project.name, 320) || cleanText(config.project_name, 320),
      description: cleanText(project.description, 12_000) || cleanText(config.project_description, 12_000),
      storage_path: cleanText(project.storage_path, 2400),
      data_file_path: cleanText(project.data_file_path, 2400),
      cwd: cleanText(project.cwd, 2400)
    },
    execution: {
      model: cleanText(execution.model, 120),
      reasoning_effort: cleanText(execution.reasoning_effort, 40),
      enable_web_search: true,
      timeout_ms: Number(execution.timeout_ms) || 900_000
    }
  };
}

function hasPaperFindingFrequencyInput(input = {}) {
  const source = ensureObject(input);
  return [
    'frequency',
    'frequency_value',
    'frequencyValue',
    'frequency_unit',
    'frequencyUnit',
    'interval_minutes',
    'intervalMinutes'
  ].some((key) => hasOwn(source, key));
}

module.exports = {
  DEFAULT_MAX_RESULTS,
  PAPER_FINDING_RESULT_TYPE,
  PAPER_FINDING_TASK_TYPE,
  buildPaperFindingInputFromTask,
  buildPaperFindingPrompt,
  buildPaperFindingScheduledTaskInput,
  hasPaperFindingFrequencyInput,
  isPaperFindingTask,
  normalizePaperFindingFrequency,
  normalizePaperFindingRunResult,
  parsePaperFindingResultText
};
