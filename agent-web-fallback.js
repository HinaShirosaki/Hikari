'use strict';

const DEFAULT_WEB_LIMIT = 6;
const DEFAULT_TIMEOUT_MS = 8000;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, maxLength = 500) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function tokenize(value) {
  return cleanText(value, 6000)
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 120);
}

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  asArray(values).forEach((value) => {
    const normalized = cleanText(value, 260);
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(normalized);
  });
  return out;
}

function stripHtml(value) {
  return cleanText(value, 1200).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function sourceDomain(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    return cleanText(parsed.hostname, 120).toLowerCase();
  } catch {
    return '';
  }
}

function scoreByQuery(item, queryTokens) {
  const text = [
    cleanText(item?.title, 320),
    cleanText(item?.snippet, 600),
    cleanText(item?.source_domain, 120)
  ].join(' ').toLowerCase();
  if (!queryTokens.length) {
    return 0;
  }
  return queryTokens.reduce((score, token) => (text.includes(token) ? score + 1 : score), 0);
}

function normalizeEvidenceItems(items, lane = 'web') {
  return asArray(items).map((item) => {
    const title = cleanText(item?.title, 320);
    const url = cleanText(item?.url, 1400);
    const snippet = cleanText(item?.snippet, 800);
    const domain = cleanText(item?.source_domain, 120).toLowerCase() || sourceDomain(url);
    return {
      title,
      url,
      snippet,
      source_domain: domain,
      published_at: cleanText(item?.published_at, 80),
      source_lane: lane,
      source_tool: cleanText(item?.source_tool, 120)
    };
  }).filter((item) => item.title || item.url || item.snippet);
}

function shouldRunWebFallback({ routing, intent, message, internalEvidence }) {
  const normalizedIntent = cleanText(intent || routing?.intent, 80) || 'general_science_question';
  const text = cleanText(message, 2600).toLowerCase();
  const external = asArray(internalEvidence).filter((entry) => {
    const source = cleanText(entry?.source, 120).toLowerCase();
    return source.includes('web')
      || source.includes('pubmed')
      || source.includes('crossref')
      || source.includes('europe_pmc')
      || source.includes('literature');
  });
  const plannerRequestsWeb = routing?.plan?.needs_web_search === true;
  if (plannerRequestsWeb && external.length >= 2) {
    return {
      should_run: false,
      reason: 'external_evidence_already_available'
    };
  }
  if (plannerRequestsWeb) {
    return {
      should_run: true,
      reason: 'planner_requested_web_search'
    };
  }

  const internal = asArray(internalEvidence).filter((entry) => {
    const source = cleanText(entry?.source, 120).toLowerCase();
    return source
      && !source.includes('web')
      && !source.includes('pubmed')
      && !source.includes('crossref')
      && !source.includes('europe_pmc');
  });

  if (normalizedIntent === 'project_science_question' && internal.length < 2) {
    return {
      should_run: true,
      reason: 'insufficient_internal_project_evidence'
    };
  }

  if (normalizedIntent === 'general_science_question' && /latest|recent|new|today|reference|citation|review|paper|literature/.test(text)) {
    return {
      should_run: true,
      reason: 'general_science_requires_current_references'
    };
  }

  return {
    should_run: false,
    reason: 'not_required'
  };
}

function buildWebQueries({ message, entities, intent, projectName = '' }) {
  const normalizedIntent = cleanText(intent, 80) || 'general_science_question';
  const base = cleanText(message, 320);
  const protein = cleanText(entities?.protein, 120);
  const compound = cleanText(entities?.compound, 120);
  const project = cleanText(projectName || entities?.project, 180);
  const paperTitle = cleanText(entities?.paper_title, 260);

  const rows = [base];
  if (paperTitle) {
    rows.push(`${paperTitle} methods summary`);
  }
  if (protein || compound) {
    rows.push(cleanText(`${protein} ${compound} method review`.trim(), 320));
  }
  if (normalizedIntent === 'project_science_question' && project) {
    rows.push(cleanText(`${project} ${base} literature`, 320));
  }
  if (normalizedIntent === 'general_science_question') {
    rows.push(cleanText(`${base} recent review`, 320));
  }

  return uniqueStrings(rows).slice(0, 3);
}

async function fetchJson(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      },
      signal: controller.signal
    });
    if (!response.ok) {
      return null;
    }
    const body = await response.text();
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseDuckDuckGoPayload(payload, limit) {
  const rows = [];
  const abstractText = cleanText(payload?.AbstractText, 700);
  const abstractUrl = cleanText(payload?.AbstractURL, 1400);
  const heading = cleanText(payload?.Heading, 260);
  if (abstractText && (abstractUrl || heading)) {
    rows.push({
      title: heading || abstractUrl,
      url: abstractUrl,
      snippet: abstractText,
      source_domain: sourceDomain(abstractUrl) || 'duckduckgo.com',
      published_at: ''
    });
  }

  const related = asArray(payload?.RelatedTopics).flatMap((topic) => {
    if (Array.isArray(topic?.Topics)) {
      return topic.Topics;
    }
    return [topic];
  });
  related.forEach((topic) => {
    if (rows.length >= limit) {
      return;
    }
    const text = cleanText(topic?.Text, 700);
    const url = cleanText(topic?.FirstURL, 1400);
    if (!text || !url) {
      return;
    }
    rows.push({
      title: text.split(' - ')[0] || text,
      url,
      snippet: text,
      source_domain: sourceDomain(url) || 'duckduckgo.com',
      published_at: ''
    });
  });

  return rows.slice(0, limit);
}

function parseWikipediaPayload(payload, limit) {
  const rows = [];
  const search = asArray(payload?.query?.search);
  search.forEach((item) => {
    if (rows.length >= limit) {
      return;
    }
    const title = cleanText(item?.title, 260);
    if (!title) {
      return;
    }
    const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`;
    rows.push({
      title,
      url,
      snippet: stripHtml(item?.snippet),
      source_domain: 'en.wikipedia.org',
      published_at: ''
    });
  });
  return rows;
}

async function searchWebResults({ query, limit = DEFAULT_WEB_LIMIT }) {
  const normalizedQuery = cleanText(query, 320);
  const normalizedLimit = Math.max(1, Math.min(10, Number(limit) || DEFAULT_WEB_LIMIT));
  if (!normalizedQuery) {
    return [];
  }

  const duckUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(normalizedQuery)}&format=json&no_html=1&skip_disambig=1`;
  const duckPayload = await fetchJson(duckUrl);
  const duckItems = parseDuckDuckGoPayload(duckPayload || {}, normalizedLimit);
  if (duckItems.length >= Math.min(3, normalizedLimit)) {
    return duckItems.slice(0, normalizedLimit);
  }

  const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(normalizedQuery)}&utf8=&format=json&srlimit=${normalizedLimit}`;
  const wikiPayload = await fetchJson(wikiUrl);
  const wikiItems = parseWikipediaPayload(wikiPayload || {}, normalizedLimit);

  return uniqueStrings([...duckItems, ...wikiItems].map((item) => JSON.stringify(item)))
    .map((item) => {
      try {
        return JSON.parse(item);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .slice(0, normalizedLimit);
}

function mergeAndRankWebEvidence({ webItems, literatureItems, query }) {
  const normalizedWeb = normalizeEvidenceItems(webItems, 'web');
  const normalizedLiterature = normalizeEvidenceItems(literatureItems, 'literature');
  const queryTokens = tokenize(query);
  const merged = [...normalizedLiterature, ...normalizedWeb];
  const deduped = [];
  const seen = new Set();

  merged.forEach((item) => {
    const key = cleanText(item.url || item.title, 600).toLowerCase();
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    deduped.push({
      ...item,
      score: scoreByQuery(item, queryTokens) + (item.source_lane === 'literature' ? 0.2 : 0)
    });
  });

  return deduped
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (left.source_lane !== right.source_lane) {
        return left.source_lane === 'literature' ? -1 : 1;
      }
      return cleanText(left.title || left.url, 320).localeCompare(cleanText(right.title || right.url, 320));
    })
    .slice(0, 12)
    .map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.snippet,
      source_domain: item.source_domain,
      published_at: item.published_at,
      source_lane: item.source_lane,
      source_tool: item.source_tool,
      score: Number(item.score) || 0
    }));
}

function buildWebFallbackSummary({ queries, items }) {
  const normalizedQueries = asArray(queries).map((query) => cleanText(query, 260)).filter(Boolean);
  const normalizedItems = asArray(items);
  const literatureCount = normalizedItems.filter((item) => cleanText(item?.source_lane, 40) === 'literature').length;
  const webCount = normalizedItems.filter((item) => cleanText(item?.source_lane, 40) === 'web').length;
  return `Web fallback executed for ${normalizedQueries.length} query(s); merged ${normalizedItems.length} source(s) (${literatureCount} literature, ${webCount} web).`;
}

module.exports = {
  shouldRunWebFallback,
  buildWebQueries,
  searchWebResults,
  mergeAndRankWebEvidence,
  buildWebFallbackSummary
};
