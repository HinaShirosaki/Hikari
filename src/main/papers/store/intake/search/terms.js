'use strict';

const MAX_QUERY_CHARS = 300;
const MAX_TERMS = 24;
const STOPWORDS = new Set((
  'a about above after again against all am an and any are as at be because been before being below '
  + 'between both but by can cannot could did do does doing down during each few for from further '
  + 'had has have having he her here hers herself him himself his how if in into is it its itself '
  + 'just me might more most must my myself no nor not now of off on once only or other ought our '
  + 'ours ourselves out over own same shall she should so some such than that the their theirs them '
  + 'themselves then there these they this those through to too under until up used using very was '
  + 'we were what when where which while who whom why will with would you your yours '
  + 'find show tell please paper papers study studies research article articles use uses'
).split(/\s+/u));

const GREEK = { α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', κ: 'kappa', λ: 'lambda', μ: 'mu' };
// Keep this list small and explicit. Related assays (e.g. PCR and qPCR) are not synonyms.
const ALIASES = [
  [/\b(?:western\s+blot(?:s|ting)?|immunoblots?|immunoblotting)\b/gu, 'westernblot'],
  [/\b(?:qpcr|quantitative\s+(?:real\s+time\s+)?(?:pcr|polymerase\s+chain\s+reaction))\b/gu, 'qpcr'],
  [/\brna\s+(?:seq|sequencing)\b/gu, 'rnaseq'],
  [/\bchip\s+seq\b/gu, 'chipseq']
];

function uniqueTokens(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function uniqueConceptTokens(values = []) {
  const seen = new Set();
  return values.filter((value) => {
    if (typeof value !== 'string' || !value) return false;
    const key = termKey(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractDois(value) {
  return String(value || '').toLowerCase().match(/10\.\d{4,9}\/[a-z0-9._;()/:\-]+/gu)
    ?.map((doi) => doi.replace(/[.,;:]+$/u, '')) || [];
}

function normalizeText(value) {
  let text = String(value || '').normalize('NFKC').toLowerCase()
    .replace(/[αβγδκλμ]/gu, (letter) => GREEK[letter])
    .replace(/[\u2010-\u2015\u2212_]/gu, '-')
    // PT-179 and HEK-293 retain their identity; PT-179 must not match PT-17.
    .replace(/([a-z]+)-(\d+)/gu, '$1$2')
    .replace(/[^\p{L}\p{N}]+/gu, ' ');
  ALIASES.forEach(([pattern, replacement]) => { text = text.replace(pattern, replacement); });
  return text.trim();
}

function termKey(term) {
  // Conservative plural folding only; never stem identifiers containing digits.
  if (/^[a-z]{5,}s$/u.test(term) && !/(ss|us|is)$/u.test(term)) {
    return term.endsWith('ies') ? `${term.slice(0, -3)}y` : term.slice(0, -1);
  }
  return term;
}

function textTerms(value) {
  const dois = extractDois(value);
  let text = String(value || '').toLowerCase()
    .replace(/(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/gu, '');
  dois.forEach((doi) => { text = text.replaceAll(doi, ' '); });
  return [...dois, ...normalizeText(text).split(/\s+/u).filter((term) => term.length >= 2)];
}

function tokenize(value) {
  return uniqueConceptTokens(textTerms(String(value || '').slice(0, MAX_QUERY_CHARS))
    .filter((term) => !STOPWORDS.has(term)))
    .slice(0, MAX_TERMS);
}

module.exports = { MAX_QUERY_CHARS, MAX_TERMS, normalizeText, termKey, textTerms, tokenize, uniqueTokens, uniqueConceptTokens };
