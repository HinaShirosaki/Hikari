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
  windowObject = window
}) {
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
    const addCandidate = (target, text) => {
      if (!target || !target.viewId) {
        return;
      }
      const searchText = String(text || '').trim();
      if (!searchText) {
        return;
      }
      candidates.push({ target, text: searchText });
    };

    const chemicalTarget = getScopeTarget('chemicals');
    asArray(state.labInventory?.chemicals).forEach((chemical) => {
      addCandidate(chemicalTarget, [
        chemical?.name,
        chemical?.casNumber,
        chemical?.vendor,
        chemical?.catalogNumber,
        chemical?.location,
        chemical?.unitSize,
        chemical?.amountInStock
      ].join(' '));
    });

    const sampleTarget = getScopeTarget('samples');
    asArray(state.samples).forEach((sample) => {
      addCandidate(sampleTarget, [
        sample?.code,
        sample?.name,
        sample?.type,
        sample?.lot,
        sample?.concentration,
        sample?.notes
      ].join(' '));
    });

    const assayTarget = getScopeTarget('assay');
    asArray(state.assays).forEach((assayItem) => {
      addCandidate(assayTarget, [
        assayItem?.assayNumber,
        assayItem?.name,
        assayItem?.projectName,
        assayItem?.plateLabel,
        assayItem?.notebookEntryProtocolName,
        assayItem?.notes,
        asArray(assayItem?.sampleAxisValues).join(' '),
        asArray(assayItem?.concentrationAxisValues).join(' ')
      ].join(' '));
    });

    const gelTarget = getScopeTarget('gel');
    asArray(state.gelAnalyses).forEach((record) => {
      addCandidate(gelTarget, [
        record?.name,
        record?.projectName,
        record?.notebookEntryProtocolName,
        record?.analysisType,
        record?.imageName,
        record?.report?.confidence?.label,
        asArray(record?.report?.warnings).join(' ')
      ].join(' '));
    });

    const projectTarget = getScopeTarget('projects');
    asArray(state.projects).forEach((project) => {
      addCandidate(projectTarget, [project?.name, project?.description].join(' '));
    });

    const protocolTarget = getScopeTarget('protocols');
    asArray(state.protocols).forEach((protocolItem) => {
      addCandidate(protocolTarget, protocolSearchText(protocolItem));
    });

    const paperTarget = getScopeTarget('papers');
    asArray(state.papers).forEach((paper) => {
      addCandidate(paperTarget, [
        paper?.title,
        paper?.linkedName,
        paper?.summary,
        paper?.fileName
      ].join(' '));
    });

    const memberTarget = getScopeTarget('members');
    asArray(state.members).forEach((member) => {
      addCandidate(memberTarget, [
        member?.name,
        member?.position,
        member?.institutionEmail,
        member?.enanaEmail
      ].join(' '));
    });

    const workflowTarget = {
      viewId: VIEWS.WORKFLOW_MANAGEMENT,
      inputId: '',
      label: 'Workflows'
    };
    asArray(state.workflows).forEach((workflow) => {
      addCandidate(workflowTarget, [workflow?.name, workflow?.description].join(' '));
    });

    const biologyNotebookTarget = {
      viewId: VIEWS.BIOLOGY_NOTEBOOK,
      inputId: '',
      label: 'Biology Notebook'
    };
    asArray(state.notebookEntries).forEach((entry) => {
      if (entry?.notebookType !== 'biology') {
        return;
      }
      addCandidate(biologyNotebookTarget, [
        entry?.projectName,
        entry?.protocolName,
        entry?.result,
        asArray(entry?.resultFiles).join(' '),
        entry?.updatedAt
      ].join(' '));
    });

    const personalInventoryTarget = {
      viewId: VIEWS.SAMPLE_REGISTRY,
      inputId: '',
      label: 'Sample & Inventory'
    };
    Object.entries(state.inventory || {}).forEach(([zone, containers]) => {
      asArray(containers).forEach((container) => {
        addCandidate(personalInventoryTarget, [
          zone,
          container?.name,
          container?.type,
          container?.singleContent,
          asArray(container?.wells)
            .map((well) => (typeof well === 'string' ? well : `${well?.name || ''} ${well?.content || ''}`))
            .join(' ')
        ].join(' '));
      });
    });

    return candidates;
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
      setSearchInputValue('sample-search', payload.query);
      return;
    }

    if (type === 'search-assays') {
      showView(VIEWS.ASSAY);
      setSearchInputValue('assay-search', payload.query);
      return;
    }

    if (type === 'search-gels') {
      showView(VIEWS.GEL);
      setSearchInputValue('gel-search', payload.query);
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
    if (!windowObject.enanaApi?.onTelegramCommand) {
      return;
    }

    windowObject.enanaApi.onTelegramCommand((payload) => {
      handleTelegramCommand(payload);
    });
  }

  return {
    executeTopbarSearch,
    handleTelegramCommand,
    initTelegramCommandBridge
  };
}
