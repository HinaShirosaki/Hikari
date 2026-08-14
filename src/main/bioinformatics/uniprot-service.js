'use strict';

const {
  BioinformaticsServiceError,
  clampInteger,
  cleanText,
  ensureObject,
  responseHeader
} = require('./request-client');

const UNIPROT_BASE_URL = 'https://rest.uniprot.org';
const MAX_UNIPROT_QUERY_LENGTH = 2000;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function nestedValue(value) {
  return cleanText(value?.value ?? value, 600);
}

function featurePosition(value) {
  const position = ensureObject(value);
  const numeric = Number(position.value);
  return {
    value: Number.isFinite(numeric) ? numeric : null,
    modifier: cleanText(position.modifier, 40)
  };
}

function normalizeUniProtRecord(value) {
  const record = ensureObject(value);
  const recommendedName = nestedValue(record?.proteinDescription?.recommendedName?.fullName);
  const submittedName = nestedValue(record?.proteinDescription?.submissionNames?.[0]?.fullName);
  const geneNames = asArray(record.genes)
    .map((gene) => nestedValue(gene?.geneName))
    .filter(Boolean);
  const comments = asArray(record.comments);
  return {
    accession: cleanText(record.primaryAccession, 40),
    entryId: cleanText(record.uniProtkbId, 80),
    entryType: cleanText(record.entryType, 120),
    reviewed: /\breviewed\b|swiss-prot/i.test(cleanText(record.entryType, 120)),
    proteinName: recommendedName || submittedName,
    geneNames,
    organism: {
      scientificName: cleanText(record?.organism?.scientificName, 240),
      commonName: cleanText(record?.organism?.commonName, 160),
      taxonomyId: Number(record?.organism?.taxonId) || null
    },
    sequence: {
      value: cleanText(record?.sequence?.value, 2_000_000),
      length: Number(record?.sequence?.length) || 0,
      molecularWeight: Number(record?.sequence?.molWeight) || 0,
      crc64: cleanText(record?.sequence?.crc64, 40)
    },
    functions: comments
      .filter((comment) => cleanText(comment?.commentType, 80).toUpperCase() === 'FUNCTION')
      .flatMap((comment) => asArray(comment?.texts).map((item) => nestedValue(item)))
      .filter(Boolean),
    subcellularLocations: comments
      .filter((comment) => cleanText(comment?.commentType, 80).toUpperCase() === 'SUBCELLULAR LOCATION')
      .flatMap((comment) => asArray(comment?.subcellularLocations))
      .map((location) => ({
        location: nestedValue(location?.location),
        topology: nestedValue(location?.topology),
        orientation: nestedValue(location?.orientation)
      }))
      .filter((location) => location.location || location.topology || location.orientation),
    features: asArray(record.features).map((feature) => ({
      type: cleanText(feature?.type, 80),
      description: cleanText(feature?.description, 600),
      featureId: cleanText(feature?.featureId, 100),
      start: featurePosition(feature?.location?.start),
      end: featurePosition(feature?.location?.end)
    })),
    crossReferences: asArray(record.uniProtKBCrossReferences).map((reference) => ({
      database: cleanText(reference?.database, 80),
      id: cleanText(reference?.id, 180),
      properties: asArray(reference?.properties).map((property) => ({
        key: cleanText(property?.key, 100),
        value: cleanText(property?.value, 500)
      }))
    })),
    url: record.primaryAccession
      ? `https://www.uniprot.org/uniprotkb/${encodeURIComponent(record.primaryAccession)}`
      : ''
  };
}

function parseJson(text, failureMessage) {
  try {
    return JSON.parse(String(text || '{}'));
  } catch {
    throw new BioinformaticsServiceError(failureMessage, { code: 'UNIPROT_RESPONSE_INVALID' });
  }
}

function extractNextCursor(response) {
  const link = responseHeader(response, 'link');
  const nextUrl = link.match(/<([^>]+)>;\s*rel="?next"?/i)?.[1] || '';
  if (!nextUrl) {
    return '';
  }
  try {
    const parsed = new URL(nextUrl);
    return parsed.origin === UNIPROT_BASE_URL ? cleanText(parsed.searchParams.get('cursor'), 2000) : '';
  } catch {
    return '';
  }
}

function createUniProtService(deps = {}) {
  if (typeof deps.requestText !== 'function') {
    throw new Error('createUniProtService requires requestText.');
  }
  const requestText = deps.requestText;

  async function searchUniProt(payload = {}) {
    const input = ensureObject(payload);
    const query = cleanText(input.query, MAX_UNIPROT_QUERY_LENGTH + 1);
    if (!query || query.length > MAX_UNIPROT_QUERY_LENGTH) {
      throw new BioinformaticsServiceError(
        `UniProt query must contain between 1 and ${MAX_UNIPROT_QUERY_LENGTH.toLocaleString()} characters.`,
        { code: 'INVALID_UNIPROT_QUERY' }
      );
    }
    const size = clampInteger(input.size, 25, 1, 100);
    const cursor = cleanText(input.cursor, 2000);
    const url = new URL('/uniprotkb/search', UNIPROT_BASE_URL);
    url.searchParams.set('format', 'json');
    url.searchParams.set('size', String(size));
    url.searchParams.set('query', query);
    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }
    if (input.includeIsoforms === true) {
      url.searchParams.set('includeIsoform', 'true');
    }

    const { response, text } = await requestText(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' }
    }, 'UniProt');
    const payloadJson = parseJson(text, 'UniProt returned invalid search JSON.');
    const records = asArray(payloadJson?.results).slice(0, size);
    const totalText = responseHeader(response, 'x-total-results');
    const total = totalText ? Number(totalText) : Number.NaN;
    return {
      query,
      total: Number.isFinite(total) && total >= 0 ? total : null,
      nextCursor: extractNextCursor(response),
      items: records.map(normalizeUniProtRecord),
      records
    };
  }

  async function getUniProtEntry(payload = {}) {
    const input = ensureObject(payload);
    const accession = cleanText(input.accession ?? payload, 80).toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(accession)) {
      throw new BioinformaticsServiceError('A valid UniProt accession or entry ID is required.', {
        code: 'INVALID_UNIPROT_ACCESSION'
      });
    }
    const url = new URL(`/uniprotkb/${encodeURIComponent(accession)}`, UNIPROT_BASE_URL);
    url.searchParams.set('format', 'json');
    const { text } = await requestText(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' }
    }, 'UniProt');
    const record = parseJson(text, 'UniProt returned invalid entry JSON.');
    return { entry: normalizeUniProtRecord(record), record };
  }

  return { searchUniProt, getUniProtEntry };
}

module.exports = {
  UNIPROT_BASE_URL,
  createUniProtService,
  extractNextCursor,
  normalizeUniProtRecord
};
