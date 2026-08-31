'use strict';

const { defaultEnsureObject } = require('./helpers.js');

// Turns the request into the copied context and sub-agent prompts the workflow
// runs on, plus the candidate-search runtime it queries.
function createSearchContext({
  asArray,
  cleanText,
  uniqueStrings,
  literatureSearchRuntime
} = {}) {
  function normalizePreferredJournalNames(value) {
    const candidates = [];
    function pushCandidate(candidate) {
      if (Array.isArray(candidate)) {
        candidate.forEach(pushCandidate);
        return;
      }
      if (candidate && typeof candidate === 'object') {
        pushCandidate(candidate.name || candidate.url || candidate.href || '');
        return;
      }
      String(candidate || '')
        .split(/[;\n]+/)
        .map((item) => cleanText(item, 240).trim())
        .filter(Boolean)
        .forEach((item) => candidates.push(item));
    }
    pushCandidate(value);
    return uniqueStrings(candidates, 12);
  }

  function getCandidateSearchRuntime() {
    if (literatureSearchRuntime && typeof literatureSearchRuntime.searchLiteratureCandidates === 'function') {
      return literatureSearchRuntime.searchLiteratureCandidates.bind(literatureSearchRuntime);
    }
    if (literatureSearchRuntime && typeof literatureSearchRuntime.searchLiterature === 'function') {
      return literatureSearchRuntime.searchLiterature.bind(literatureSearchRuntime);
    }
    return null;
  }

  function buildCopiedContext(input = {}, query = '') {
    const source = defaultEnsureObject(input);
    const snapshot = defaultEnsureObject(source.snapshot);
    const project = defaultEnsureObject(source.project || snapshot.project);
    const settings = defaultEnsureObject(snapshot.settings);
    const parserPayload = defaultEnsureObject(source.parser_payload || source.parserPayload);
    const preferredJournals = normalizePreferredJournalNames([
      source.preferred_journals,
      source.preferredJournals,
      settings.preferred_journals,
      settings.preferredJournals,
      snapshot.preferred_journals,
      snapshot.preferredJournals,
      source.preferred_journal,
      source.preferredJournal,
      settings.preferred_journal,
      settings.preferredJournal,
      snapshot.preferred_journal,
      snapshot.preferredJournal
    ]);
    return {
      message: cleanText(source.message, 1200),
      query: cleanText(query || source.query, 600),
      topic: cleanText(source.topic, 240),
      source: cleanText(source.source, 80),
      sources: uniqueStrings(asArray(source.sources).map((item) => cleanText(item, 80)), 8),
      preferred_literature_source: cleanText(
        source.preferred_literature_source
        || source.preferredLiteratureSource
        || settings.preferred_literature_source
        || settings.preferredLiteratureSource
        || snapshot.preferred_literature_source
        || snapshot.preferredLiteratureSource,
        80
      ),
      preferred_web_source: cleanText(
        source.preferred_web_source
        || source.preferredWebSource
        || settings.preferred_web_source
        || settings.preferredWebSource
        || snapshot.preferred_web_source
        || snapshot.preferredWebSource,
        240
      ),
      project: {
        id: cleanText(project.id || project.projectId, 120),
        name: cleanText(project.name || project.projectName, 220)
      },
      storage_path: cleanText(
        source.storage_path
        || source.storagePath
        || settings.storagePath
        || snapshot.storagePath,
        2000
      ),
      preferred_journal: preferredJournals.join('; '),
      preferred_journals: preferredJournals,
      parser_payload: parserPayload,
      snapshot_summary: {
        project_count: asArray(snapshot.projects).length,
        protocol_count: asArray(snapshot.protocols).length,
        workflow_count: asArray(snapshot.workflows).length,
        notebook_entry_count: asArray(snapshot.notebookEntries).length,
        paper_count: asArray(snapshot.papers).length
      }
    };
  }

  function buildSubAgentSystemPrompt(context = {}) {
    const contextSource = defaultEnsureObject(context);
    const preferredJournals = normalizePreferredJournalNames([
      contextSource.preferred_journals,
      contextSource.preferred_journal
    ]);
    const preferredJournal = preferredJournals.length
      ? preferredJournals.join('; ')
      : cleanText(contextSource.preferred_journal, 1200);
    const preferredJournalLine = preferredJournal
      ? `The user has set preferred journals: "${preferredJournal}". When candidate quality is comparable, prefer papers from these journals (match by URL host or by journal name). Do not exclude other journals; treat them as soft preferences, not filters.`
      : '';
    return [
      'You are a delegated literature search sub-agent.',
      'Use the copied main-agent context to search for candidate papers, select the most useful ones, and read selected paper abstracts or already-ingested paper markdown in batches.',
      'Return only grounded context that can be loaded back into the main agent.',
      'Never invent citations or claim that a download succeeded unless the download tool reported success.',
      preferredJournalLine
    ].filter(Boolean).join(' ');
  }

  function buildSubAgentMessage(context = {}) {
    return [
      'Search literature for the current request and prepare main-agent context to load.',
      `Copied context JSON:\n${JSON.stringify(context, null, 2)}`,
      'Use the search results, abstracts, and returned lists to choose the papers that should be fully read.',
      'Do not start new PDF downloads automatically; the user downloads selected papers later with the paper download button or explicit paper-download action.',
      'Read selected papers in batches and return the resulting context blocks, selected paper list, any existing local paper records, and useful notes.'
    ].join('\n\n');
  }

  return {
    normalizePreferredJournalNames,
    getCandidateSearchRuntime,
    buildCopiedContext,
    buildSubAgentSystemPrompt,
    buildSubAgentMessage
  };
}

module.exports = { createSearchContext };
