'use strict';

const { asArray, ensureObject } = require('../../lib/normalize.js');
const { DEFAULT_FREQUENCY_UNIT, DEFAULT_FREQUENCY_VALUE, DEFAULT_MAX_RESULTS, PAPER_FINDING_RESULT_TYPE, PAPER_FINDING_TASK_TYPE } = require('./paper-finding/constants.js');
const { cleanText, hasOwn, normalizeFrequencyUnit, normalizeMaxResults, normalizePaperFindingFrequency, normalizePreferredJournals } = require('./paper-finding/frequency-and-project.js');
const { buildPaperFindingPrompt, buildPaperFindingScheduledTaskInput } = require('./paper-finding/task-input.js');

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
