export function normalizeSearchToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

export function buildViewAliasMap({ apps = [], normalizeViewId }) {
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
      map.set(normalized, normalizeViewId(app.viewId));
    });
  });
  return map;
}

export function buildSearchScopeMap({ apps = [], normalizeViewId }) {
  const map = new Map();
  apps.forEach((app) => {
    if (app?.hiddenFromNavigation === true) {
      return;
    }
    const target = {
      viewId: normalizeViewId(app.viewId),
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

function asArray(value) {
  return Array.isArray(value) ? value : [];
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
  normalizeViewId: normalizeAppViewId = (viewId) => viewId,
  openItemHandlers = {},
  windowObject = window
}) {
  const itemHandlers = openItemHandlers && typeof openItemHandlers === 'object'
    ? openItemHandlers
    : {};
  const appSuggestionEntries = asArray(apps).filter((app) => app?.hiddenFromNavigation !== true).map((app) => {
    const viewId = normalizeAppViewId(app?.viewId);
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

  function buildGlobalSearchCandidates() {
    const candidates = [];
    let nextCandidateId = 0;
    const addCandidate = (target, text, displayInfo = {}) => {
      if (!target || !target.viewId) {
        return;
      }
      const searchText = String(text || '').trim();
      if (!searchText) {
        return;
      }
      const label = String(displayInfo.label || '').trim() || searchText;
      const sublabel = String(displayInfo.sublabel || '').trim();
      const kind = String(displayInfo.kind || target.label || '').trim();
      const applyQueryRaw = displayInfo.applyQuery == null ? label : displayInfo.applyQuery;
      const applyQuery = String(applyQueryRaw || '').trim();
      const itemId = String(displayInfo.itemId || '').trim();
      candidates.push({
        id: `c${nextCandidateId++}`,
        target,
        text: searchText,
        label,
        sublabel,
        kind,
        applyQuery,
        itemId
      });
    };

    const chemicalTarget = getScopeTarget('chemicals');
    asArray(state.labInventory?.chemicals).forEach((chemical) => {
      const label = chemical?.name || chemical?.casNumber || chemical?.catalogNumber;
      addCandidate(chemicalTarget, [
        chemical?.name,
        chemical?.casNumber,
        chemical?.vendor,
        chemical?.catalogNumber,
        chemical?.location,
        chemical?.unitSize,
        chemical?.amountInStock
      ].join(' '), {
        label,
        sublabel: joinSublabel([chemical?.casNumber, chemical?.vendor, chemical?.location]),
        kind: 'Chemical',
        applyQuery: label,
        itemId: chemical?.id
      });
    });

    const sampleTarget = getScopeTarget('samples');
    asArray(state.samples).forEach((sample) => {
      const label = sample?.name || sample?.code;
      addCandidate(sampleTarget, [
        sample?.code,
        sample?.name,
        sample?.type,
        sample?.lot,
        sample?.concentration,
        sample?.notes
      ].join(' '), {
        label,
        sublabel: joinSublabel([sample?.code, sample?.type, sample?.concentration]),
        kind: 'Sample',
        applyQuery: sample?.code || label,
        itemId: sample?.id
      });
    });

    const assayTarget = getScopeTarget('assay');
    asArray(state.assays).forEach((assayItem) => {
      const label = assayItem?.name || assayItem?.assayNumber;
      addCandidate(assayTarget, [
        assayItem?.assayNumber,
        assayItem?.name,
        assayItem?.projectName,
        assayItem?.plateLabel,
        assayItem?.notebookEntryProtocolName,
        assayItem?.notes,
        asArray(assayItem?.sampleAxisValues).join(' '),
        asArray(assayItem?.concentrationAxisValues).join(' ')
      ].join(' '), {
        label,
        sublabel: joinSublabel([assayItem?.assayNumber, assayItem?.projectName, assayItem?.plateLabel]),
        kind: 'Assay',
        applyQuery: assayItem?.assayNumber || label,
        itemId: assayItem?.id
      });
    });

    const projectTarget = getScopeTarget('projects');
    asArray(state.projects).forEach((project) => {
      const label = project?.name;
      addCandidate(projectTarget, [project?.name, project?.description].join(' '), {
        label,
        sublabel: project?.description,
        kind: 'Project',
        applyQuery: label,
        itemId: project?.id
      });
    });

    const protocolTarget = getScopeTarget('protocols');
    asArray(state.protocols).forEach((protocolItem) => {
      const label = protocolItem?.name;
      addCandidate(protocolTarget, protocolSearchText(protocolItem), {
        label,
        sublabel: protocolItem?.purpose,
        kind: 'Protocol',
        applyQuery: label,
        itemId: protocolItem?.id
      });
    });

    const paperTarget = getScopeTarget('papers');
    asArray(state.papers).forEach((paper) => {
      const label = paper?.title || paper?.fileName;
      addCandidate(paperTarget, [
        paper?.title,
        paper?.linkedName,
        paper?.summary,
        paper?.fileName
      ].join(' '), {
        label,
        sublabel: joinSublabel([paper?.linkedName, paper?.fileName]),
        kind: 'Paper',
        applyQuery: label,
        itemId: paper?.id
      });
    });

    const memberTarget = getScopeTarget('members');
    asArray(state.members).forEach((member) => {
      const label = member?.name;
      addCandidate(memberTarget, [
        member?.name,
        member?.position,
        member?.institutionEmail,
        member?.hikariEmail
      ].join(' '), {
        label,
        sublabel: joinSublabel([member?.position, member?.institutionEmail || member?.hikariEmail]),
        kind: 'Member',
        applyQuery: label
      });
    });

    const workflowTarget = {
      viewId: VIEWS.WORKFLOW_MANAGEMENT,
      inputId: '',
      label: 'Workflows'
    };
    asArray(state.workflows).forEach((workflow) => {
      const label = workflow?.name;
      addCandidate(workflowTarget, [workflow?.name, workflow?.description].join(' '), {
        label,
        sublabel: workflow?.description,
        kind: 'Workflow',
        applyQuery: '',
        itemId: workflow?.id
      });
    });

    const biologyNotebookTarget = {
      viewId: VIEWS.BIOLOGY_NOTEBOOK,
      inputId: '',
      label: 'Notebook'
    };
    asArray(state.notebookEntries).forEach((entry) => {
      if (entry?.notebookType !== 'biology') {
        return;
      }
      const label = entry?.protocolName || entry?.projectName;
      addCandidate(biologyNotebookTarget, [
        entry?.projectName,
        entry?.protocolName,
        entry?.result,
        asArray(entry?.resultFiles).join(' '),
        entry?.updatedAt
      ].join(' '), {
        label,
        sublabel: joinSublabel([entry?.projectName, entry?.updatedAt]),
        kind: 'Notebook',
        applyQuery: '',
        itemId: entry?.id
      });
    });

    const personalInventoryTarget = {
      viewId: VIEWS.PERSONAL_INVENTORY,
      inputId: '',
      label: 'Containers'
    };
    Object.entries(state.inventory || {}).forEach(([zone, containers]) => {
      asArray(containers).forEach((container) => {
        const label = container?.name;
        addCandidate(personalInventoryTarget, [
          zone,
          container?.name,
          container?.type,
          container?.singleContent,
          asArray(container?.wells)
            .map((well) => (typeof well === 'string' ? well : `${well?.name || ''} ${well?.content || ''}`))
            .join(' ')
        ].join(' '), {
          label,
          sublabel: joinSublabel([container?.type, zone]),
          kind: 'Container',
          applyQuery: ''
        });
      });
    });

    return candidates;
  }

  function buildAppSuggestionCandidates() {
    return appSuggestionEntries.map((entry, index) => ({
      id: `app-${index}`,
      target: entry.target,
      text: entry.aliasText,
      label: entry.app?.label || '',
      sublabel: TITLES[entry.viewId] || '',
      kind: 'Module',
      applyQuery: ''
    }));
  }

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
    return applySearchTarget(suggestion.target, suggestion.applyQuery || '');
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

  function handleTelegramCommand(payload) {
    if (!payload || typeof payload !== 'object') {
      return;
    }

    const type = String(payload.type || '');
    if (type === 'open-view') {
      const viewId = String(payload.viewId || '').trim();
      if (viewId) {
        showView(viewId);
      }
      return;
    }

    if (type === 'search-chemicals') {
      showView(VIEWS.LAB_COMMON_INVENTORY);
      setSearchInputValue('chemical-search', payload.query);
      return;
    }

    if (type === 'search-samples') {
      showView(VIEWS.SAMPLE_REGISTRY);
      return;
    }

    if (type === 'search-assays') {
      showView(VIEWS.ASSAY);
      setSearchInputValue('assay-search', payload.query);
      return;
    }

    if (type === 'global-search') {
      const scope = String(payload.scope || '').trim();
      const query = String(payload.query || '').trim();
      const searchText = scope && query
        ? `${scope}: ${query}`
        : query || scope;
      if (!searchText) {
        return;
      }
      if (topbarSearchInput) {
        topbarSearchInput.value = searchText;
      }
      executeTopbarSearch(searchText);
    }
  }

  function initTelegramCommandBridge() {
    if (!windowObject.hikariApi?.onTelegramCommand) {
      return;
    }

    windowObject.hikariApi.onTelegramCommand((payload) => {
      handleTelegramCommand(payload);
    });
  }

  return {
    executeTopbarSearch,
    getSearchSuggestions,
    applySuggestion,
    handleTelegramCommand,
    initTelegramCommandBridge
  };
}
