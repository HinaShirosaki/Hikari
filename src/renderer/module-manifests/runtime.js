export function initAndRegisterModule(moduleRegistry, key, initializer, options) {
  const module = initializer(options);
  moduleRegistry.register(key, module);
  return module;
}

export function initializeModuleManifest(moduleRegistry, manifest, context) {
  if (!manifest?.key || typeof manifest.init !== 'function') {
    return null;
  }
  const options = typeof manifest.createOptions === 'function'
    ? manifest.createOptions(context)
    : {};
  return initAndRegisterModule(moduleRegistry, manifest.key, manifest.init, options);
}

export function initializeModuleManifests(moduleRegistry, manifests, context) {
  const initialized = {};
  manifests.forEach((manifest) => {
    const module = initializeModuleManifest(moduleRegistry, manifest, context);
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

function resolveManifestViewIds(manifest, context) {
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
    .flatMap((manifest) => {
      const viewIds = resolveManifestViewIds(manifest, context);
      if (!viewIds.length || typeof manifest.render !== 'function') {
        return [];
      }
      return viewIds.map((viewId) => [viewId, () => manifest.render(context, { viewId })]);
    })
    .filter(([viewId]) => Boolean(viewId));
}

export function createManifestNavigationAliases(manifests, context) {
  return new Map(manifests.flatMap((manifest) => {
    const aliases = Array.isArray(manifest.navigationAliases)
      ? manifest.navigationAliases
      : [];
    return aliases
      .map((alias) => resolveManifestNavigationAlias(alias, context))
      .filter(Boolean);
  }));
}

function getManifestBootOrder(manifest) {
  const bootOrder = Number(manifest?.bootOrder);
  return Number.isFinite(bootOrder) ? bootOrder : null;
}

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
      render?.(context);
    });
}
