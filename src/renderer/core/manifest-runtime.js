// Manifest callbacks are module code, and the renderer runs all 14 modules
// through the three loops below. Unguarded, one module throwing takes the whole
// app down: a throw in init escapes startHikariCore entirely (no view is ever
// shown, the dock renders zero buttons, and the loading cover still lifts on its
// cap -- so a dead shell looks like a booted app). A missing module beats that,
// so every manifest call is fenced and names itself in the log.
function runManifestStep(manifest, phase, work) {
  try {
    return work();
  } catch (error) {
    console.error(`Module "${manifest?.key || 'unknown'}" failed to ${phase}:`, error);
    return null;
  }
}

export function initAndRegisterModule(moduleRegistry, key, initializer, options) {
  const module = initializer(options);
  moduleRegistry.register(key, module);
  return module;
}

export function initializeModuleManifest(moduleRegistry, manifest, context) {
  if (!manifest?.key || typeof manifest.init !== 'function') {
    return null;
  }
  const history = context.getModuleHistory?.(manifest.historyOwner || manifest.key);
  const moduleContext = history ? { ...context, persist: history.persist, history } : context;
  const options = typeof manifest.createOptions === 'function'
    ? manifest.createOptions(moduleContext)
    : {};
  const module = initAndRegisterModule(moduleRegistry, manifest.key, manifest.init, options);
  if (module && history) module.history = history;
  return module;
}

export function initializeModuleManifests(moduleRegistry, manifests, context) {
  const initialized = {};
  manifests.forEach((manifest) => {
    const module = runManifestStep(
      manifest,
      'initialize',
      () => initializeModuleManifest(moduleRegistry, manifest, context)
    );
    if (module) {
      initialized[manifest.key] = module;
      if (context?.modules && typeof context.modules === 'object') {
        context.modules[manifest.key] = module;
      }
    }
  });
  return initialized;
}

function addManifestViewId(viewIds, viewId) {
  const normalizedViewId = String(viewId || '').trim();
  if (normalizedViewId && !viewIds.includes(normalizedViewId)) {
    viewIds.push(normalizedViewId);
  }
}

// A manifest may name its views four ways (viewIds, viewKeys, viewId, viewKey);
// all are merged, deduped, and resolved against context.views.
export function resolveManifestViewIds(manifest, context) {
  const viewIds = [];
  const dynamicViewIds = typeof manifest.viewIds === 'function'
    ? manifest.viewIds(context)
    : manifest.viewIds;
  if (Array.isArray(dynamicViewIds)) {
    dynamicViewIds.forEach((viewId) => addManifestViewId(viewIds, viewId));
  }
  if (Array.isArray(manifest.viewKeys)) {
    manifest.viewKeys.forEach((viewKey) => addManifestViewId(viewIds, context.views?.[viewKey]));
  }
  if (typeof manifest.viewId === 'function') {
    addManifestViewId(viewIds, manifest.viewId(context));
  } else {
    addManifestViewId(viewIds, manifest.viewId);
  }
  if (manifest.viewKey) {
    addManifestViewId(viewIds, context.views?.[manifest.viewKey]);
  }
  return viewIds;
}

function resolveManifestNavigationAlias(alias, context) {
  if (!alias || typeof alias !== 'object') {
    return null;
  }
  const sourceViewId = typeof alias.viewId === 'function'
    ? alias.viewId(context)
    : alias.viewId || context.views?.[alias.viewKey];
  const navigationViewId = typeof alias.navigationViewId === 'function'
    ? alias.navigationViewId(context)
    : alias.navigationViewId || context.views?.[alias.navigationViewKey];
  const source = String(sourceViewId || '').trim();
  const target = String(navigationViewId || '').trim();
  return source && target ? [source, target] : null;
}

export function createManifestRenderEntries(manifests, context) {
  return manifests
    .flatMap((manifest) => runManifestStep(manifest, 'resolve views for', () => {
      const viewIds = resolveManifestViewIds(manifest, context);
      if (!viewIds.length || typeof manifest.render !== 'function') {
        return [];
      }
      // Guarded per view too: this closure runs on every navigation, and an
      // unguarded throw here aborts showView() midway, leaving the rail and
      // chrome sync below it unrun.
      return viewIds.map((viewId) => [
        viewId,
        () => runManifestStep(manifest, 'render', () => manifest.render(context, { viewId }))
      ]);
    }) || [])
    .filter(([viewId]) => Boolean(viewId));
}

export function createManifestNavigationAliases(manifests, context) {
  return new Map(manifests.flatMap((manifest) => {
    const aliases = Array.isArray(manifest.navigationAliases)
      ? manifest.navigationAliases
      : [];
    return runManifestStep(manifest, 'resolve navigation aliases for', () => aliases
      .map((alias) => resolveManifestNavigationAlias(alias, context))
      .filter(Boolean)) || [];
  }));
}

function getManifestBootOrder(manifest) {
  const bootOrder = Number(manifest?.bootOrder);
  return Number.isFinite(bootOrder) ? bootOrder : null;
}

// Boot-time full render. Only manifests that declare a numeric bootOrder take
// part; ties keep manifest-array order.
export function renderModuleManifests(manifests, context) {
  manifests
    .map((manifest, index) => ({
      manifest,
      index,
      bootOrder: getManifestBootOrder(manifest)
    }))
    .filter((entry) => entry.bootOrder !== null)
    .sort((first, second) => first.bootOrder - second.bootOrder || first.index - second.index)
    .forEach(({ manifest }) => {
      const render = typeof manifest.renderAll === 'function'
        ? manifest.renderAll
        : manifest.render;
      runManifestStep(manifest, 'render', () => render?.(context));
    });
}
