'use strict';

const LITERATURE_SOURCES = Object.freeze({
  AUTO: 'auto',
  WEB: 'web',
  PUBMED: 'pubmed',
  CROSSREF: 'crossref',
  UNIPROT: 'uniprot',
  EUROPE_PMC: 'europe_pmc'
});

const LITERATURE_SOURCE_ORDER = Object.freeze([
  LITERATURE_SOURCES.PUBMED,
  LITERATURE_SOURCES.EUROPE_PMC,
  LITERATURE_SOURCES.CROSSREF,
  LITERATURE_SOURCES.UNIPROT,
  LITERATURE_SOURCES.WEB
]);

// Sources whose native query syntax can honor a journal filter. Others
// (UniProt, web) cannot, so they are excluded from a journal-scoped pass to
// avoid leaking unfiltered hits and to keep the "empty -> relax" retry correct.
const JOURNAL_FILTERABLE_SOURCES = Object.freeze(new Set([
  LITERATURE_SOURCES.PUBMED,
  LITERATURE_SOURCES.EUROPE_PMC,
  LITERATURE_SOURCES.CROSSREF
]));

const SOURCE_LABELS = Object.freeze({
  [LITERATURE_SOURCES.WEB]: 'web',
  [LITERATURE_SOURCES.PUBMED]: 'PubMed',
  [LITERATURE_SOURCES.CROSSREF]: 'Crossref',
  [LITERATURE_SOURCES.UNIPROT]: 'UniProt',
  [LITERATURE_SOURCES.EUROPE_PMC]: 'Europe PMC'
});

module.exports = {
  LITERATURE_SOURCES,
  LITERATURE_SOURCE_ORDER,
  JOURNAL_FILTERABLE_SOURCES,
  SOURCE_LABELS
};
