import { asArray } from '../../lib/normalize.js';

function normalizeSearchToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

function buildViewAliasMap({ apps = [] }) {
  const map = new Map();
  apps.forEach((app) => {
    if (app?.hiddenFromNavigation === true) {
      return;
    }
    [
      app.id,
      app.label,
      ...(Array.isArray(app.aliases) ? app.aliases : [])
    ].forEach((token) => {
      const normalized = normalizeSearchToken(token);
      if (!normalized || map.has(normalized)) {
        return;
      }
      map.set(normalized, app.viewId);
    });
  });
  return map;
}

function buildSearchScopeMap({ apps = [] }) {
  const map = new Map();
  apps.forEach((app) => {
    if (app?.hiddenFromNavigation === true) {
      return;
    }
    const target = {
      viewId: app.viewId,
      inputId: String(app.searchInputId || '').trim(),
      label: app.label
    };
    [
      app.id,
      app.label,
      ...(Array.isArray(app.aliases) ? app.aliases : [])
    ].forEach((token) => {
      const normalized = normalizeSearchToken(token);
      if (!normalized || map.has(normalized)) {
        return;
      }
      map.set(normalized, target);
    });
  });
  return map;
}

function tokenizeSearchQuery(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 12);
}

function scoreTextByTokens(text, queryTokens, queryLower) {
  const haystack = String(text || '').toLowerCase();
  if (!haystack) {
    return 0;
  }

  if (!queryTokens.length) {
    return queryLower && haystack.includes(queryLower) ? 1 : 0;
  }

  let score = 0;
  queryTokens.forEach((token) => {
    if (haystack.includes(token)) {
      score += 1;
    }
  });
  if (queryLower && queryLower.length >= 3 && haystack.includes(queryLower)) {
    score += 2;
  }
  return score;
}

function protocolSearchText(protocol) {
  const stepsText = asArray(protocol?.steps)
    .map((step) => (typeof step === 'string' ? step : step?.text || step?.instruction || step?.title || ''))
    .join(' ');
  return [
    protocol?.name,
    protocol?.purpose,
    asArray(protocol?.materials).join(' '),
    stepsText,
    protocol?.troubleshooting
  ].join(' ');
}

function joinSublabel(parts) {
  return parts
    .map((part) => (part == null ? '' : String(part).trim()))
    .filter((part) => part.length > 0)
    .join(' · ');
}

function scoreSuggestion(candidate, queryLower, queryTokens) {
  const labelLower = String(candidate.label || '').toLowerCase();
  const textLower = String(candidate.text || '').toLowerCase();
  let score = 0;

  if (labelLower) {
    if (labelLower === queryLower) {
      score += 16;
    } else if (labelLower.startsWith(queryLower)) {
      score += 10;
    } else if (labelLower.includes(queryLower)) {
      score += 5;
    }
    queryTokens.forEach((token) => {
      if (labelLower.includes(token)) {
        score += 2;
      }
    });
  }

  if (textLower && textLower !== labelLower) {
    if (textLower.includes(queryLower)) {
      score += 1.5;
    }
    queryTokens.forEach((token) => {
      if (textLower.includes(token)) {
        score += 0.6;
      }
    });
  }

  return score;
}

export {
  buildSearchScopeMap,
  buildViewAliasMap,
  joinSublabel,
  normalizeSearchToken,
  protocolSearchText,
  scoreSuggestion,
  scoreTextByTokens,
  tokenizeSearchQuery
};
