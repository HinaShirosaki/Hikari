import { showTransientNotice } from '../lib/notify.js';
import { asArray } from '../lib/normalize.js';
import { createSearchCandidates } from './topbar-search/candidates.js';
import {
  normalizeSearchToken,
  scoreSuggestion,
  scoreTextByTokens,
  tokenizeSearchQuery
} from './topbar-search/scoring.js';

export function createTopbarSearchController({
  state,
  VIEWS,
  TITLES,
  globalViewAliases,
  searchScopeTargets,
  showView,
  getActiveViewId,
  setSearchInputValue,
  topbarSearchInput,
  apps = [],
  openItemHandlers = {},
  windowObject: _windowObject = window
}) {
  const itemHandlers = openItemHandlers && typeof openItemHandlers === 'object'
    ? openItemHandlers
    : {};
  const appSuggestionEntries = asArray(apps).filter((app) => app?.hiddenFromNavigation !== true).map((app) => {
    const viewId = app?.viewId;
    const aliases = asArray(app?.aliases);
    return {
      app,
      viewId,
      target: { viewId, inputId: '', label: app?.label || '' },
      aliasText: [app?.id, app?.label, ...aliases].filter(Boolean).join(' ')
    };
  }).filter((entry) => entry.viewId);
  function getScopeTarget(scopeToken) {
    return searchScopeTargets.get(normalizeSearchToken(scopeToken)) || null;
  }

  function parseTopbarSearch(rawValue) {
    const raw = String(rawValue || '').trim();
    const parsed = {
      raw,
      query: raw,
      queryLower: raw.toLowerCase(),
      tokens: tokenizeSearchQuery(raw),
      scopeToken: '',
      target: null,
      openViewId: ''
    };
    if (!raw) {
      return parsed;
    }
    const scopedMatch = raw.match(/^([a-z0-9][a-z0-9_\-\s]{0,30})\s*:\s*(.+)$/i);
    if (scopedMatch) {
      const scopeToken = normalizeSearchToken(scopedMatch[1]);
      const target = getScopeTarget(scopeToken);
      if (target) {
        const query = String(scopedMatch[2] || '').trim();
        parsed.scopeToken = scopeToken;
        parsed.target = target;
        parsed.query = query;
        parsed.queryLower = query.toLowerCase();
        parsed.tokens = tokenizeSearchQuery(query);
        return parsed;
      }
    }
    const [rawFirstToken = '', ...restParts] = raw.split(/\s+/);
    const firstToken = normalizeSearchToken(rawFirstToken);
    const trailingQuery = restParts.join(' ').trim();
    if (firstToken && trailingQuery) {
      const target = getScopeTarget(firstToken);
      if (target) {
        parsed.scopeToken = firstToken;
        parsed.target = target;
        parsed.query = trailingQuery;
        parsed.queryLower = trailingQuery.toLowerCase();
        parsed.tokens = tokenizeSearchQuery(trailingQuery);
        return parsed;
      }
    }

    if (firstToken && globalViewAliases.has(firstToken)) {
      parsed.openViewId = globalViewAliases.get(firstToken);
      parsed.query = trailingQuery;
      parsed.queryLower = trailingQuery.toLowerCase();
      parsed.tokens = tokenizeSearchQuery(trailingQuery);
    }
    return parsed;
  }

  function applySearchTarget(target, query) {
    if (!target || !target.viewId) {
      return false;
    }

    showView(target.viewId);
    if (target.inputId) {
      return setSearchInputValue(target.inputId, query);
    }
    return true;
  }

  function getScopeTargetForView(viewId) {
    let fallback = null;
    for (const target of searchScopeTargets.values()) {
      if (target.viewId !== viewId) {
        continue;
      }
      if (target.inputId) {
        return target;
      }
      if (!fallback) {
        fallback = target;
      }
    }
    return fallback;
  }


  const {
    buildGlobalSearchCandidates,
    buildAppSuggestionCandidates
  } = createSearchCandidates({ state, VIEWS, TITLES, appSuggestionEntries, getScopeTarget });

  function getSearchSuggestions(rawQuery, options = {}) {
    const limit = Number.isFinite(options.limit) && options.limit > 0
      ? Math.floor(options.limit)
      : 8;
    const raw = String(rawQuery || '').trim();
    if (!raw) {
      return [];
    }

    const parsed = parseTopbarSearch(rawQuery);
    const effectiveQuery = parsed.query || raw;
    const queryLower = effectiveQuery.toLowerCase();
    const queryTokens = parsed.tokens.length
      ? parsed.tokens
      : tokenizeSearchQuery(effectiveQuery);

    const candidates = [
      ...buildAppSuggestionCandidates(),
      ...buildGlobalSearchCandidates()
    ];

    const filterToViewId = parsed.target?.viewId || parsed.openViewId || '';
    const scoped = filterToViewId
      ? candidates.filter((candidate) => candidate.target?.viewId === filterToViewId)
      : candidates;

    const ranked = [];
    scoped.forEach((candidate) => {
      const score = scoreSuggestion(candidate, queryLower, queryTokens);
      if (score <= 0) {
        return;
      }
      ranked.push({ candidate, score });
    });

    ranked.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return String(a.candidate.label || '').localeCompare(String(b.candidate.label || ''));
    });

    const seenLabels = new Set();
    const results = [];
    for (const entry of ranked) {
      const dedupeKey = `${entry.candidate.kind}::${entry.candidate.label.toLowerCase()}::${entry.candidate.target.viewId}`;
      if (seenLabels.has(dedupeKey)) {
        continue;
      }
      seenLabels.add(dedupeKey);
      results.push(entry.candidate);
      if (results.length >= limit) {
        break;
      }
    }
    return results;
  }

  function applySuggestion(suggestion) {
    if (!suggestion?.target?.viewId) {
      return false;
    }
    const handler = suggestion.itemId
      ? itemHandlers[suggestion.kind]
      : null;
    if (typeof handler === 'function') {
      try {
        const handled = handler(suggestion.itemId, suggestion);
        if (handled !== false) {
          return true;
        }
      } catch (error) {
        console.error('Failed to open suggestion item:', error);
      }
    }
    const opened = applySearchTarget(suggestion.target, suggestion.applyQuery || '');
    if (!opened) {
      showTransientNotice('Could not open that search result.', { type: 'error' });
    }
    return opened;
  }

  function executeTopbarSearch(rawQuery) {
    const parsed = parseTopbarSearch(rawQuery);
    if (!parsed.raw) {
      if (topbarSearchInput) {
        topbarSearchInput.title = 'Type a query and press Enter.';
      }
      return false;
    }

    if (parsed.target) {
      const applied = applySearchTarget(parsed.target, parsed.query);
      if (topbarSearchInput) {
        const canFilter = Boolean(parsed.target.inputId && parsed.query);
        topbarSearchInput.title = applied
          ? (canFilter
            ? `Opened ${parsed.target.label} and searched for "${parsed.query}".`
            : `Opened ${parsed.target.label}.`)
          : 'Search target unavailable.';
      }
      return applied;
    }

    if (parsed.openViewId) {
      showView(parsed.openViewId);
      let appliedQuery = false;
      if (parsed.query) {
        const scopedTarget = getScopeTargetForView(parsed.openViewId);
        if (scopedTarget?.inputId) {
          setSearchInputValue(scopedTarget.inputId, parsed.query);
          appliedQuery = true;
        }
      }
      if (topbarSearchInput) {
        topbarSearchInput.title = appliedQuery
          ? `Opened ${TITLES[parsed.openViewId] || 'view'} and searched for "${parsed.query}".`
          : `Opened ${TITLES[parsed.openViewId] || 'view'}.`;
      }
      return true;
    }

    const activeViewId = getActiveViewId();
    const candidates = buildGlobalSearchCandidates();
    let bestCandidate = null;
    let bestScore = 0;
    candidates.forEach((candidate) => {
      let score = scoreTextByTokens(candidate.text, parsed.tokens, parsed.queryLower);
      if (!score) {
        return;
      }
      if (candidate.target.viewId === activeViewId) {
        score += 0.25;
      }
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    });

    if (bestCandidate) {
      applySearchTarget(bestCandidate.target, parsed.query);
      if (topbarSearchInput) {
        const canFilter = Boolean(bestCandidate.target.inputId && parsed.query);
        topbarSearchInput.title = canFilter
          ? `Opened ${bestCandidate.target.label} and searched for "${parsed.query}".`
          : `Opened ${bestCandidate.target.label}.`;
      }
      return true;
    }

    const activeScopeTarget = getScopeTargetForView(activeViewId);
    if (activeScopeTarget?.inputId) {
      applySearchTarget(activeScopeTarget, parsed.query);
      if (topbarSearchInput) {
        topbarSearchInput.title = `Searched in current ${activeScopeTarget.label} view.`;
      }
      return true;
    }

    const aliasViewId = globalViewAliases.get(normalizeSearchToken(parsed.query));
    if (aliasViewId) {
      showView(aliasViewId);
      if (topbarSearchInput) {
        topbarSearchInput.title = `Opened ${TITLES[aliasViewId] || 'view'}.`;
      }
      return true;
    }

    if (topbarSearchInput) {
      topbarSearchInput.title = `No match found for "${parsed.query}". Try "assay: keyword" or "gel: keyword".`;
    }
    return false;
  }

  return {
    executeTopbarSearch,
    getSearchSuggestions,
    applySuggestion
  };
}

export {
  normalizeSearchToken,
  buildViewAliasMap,
  buildSearchScopeMap
} from './topbar-search/scoring.js';
