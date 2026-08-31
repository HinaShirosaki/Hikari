import fs from 'node:fs/promises';
import path from 'node:path';
import { readJson, toPosix, writeText } from './fs-helpers.mjs';
import { APP_REGISTRY_MODULE_OUTPUT, APP_REGISTRY_PATH, ROOT_DIR, VIEWS_MODULE_OUTPUT } from './paths.mjs';

function ensureAppRegistryShape(registry) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    throw new Error('app-registry.json must export an object');
  }
  if (!Array.isArray(registry.apps) || !registry.apps.length) {
    throw new Error('app-registry.json requires a non-empty "apps" array');
  }
  if (!Array.isArray(registry.dockOrder) || !registry.dockOrder.length) {
    throw new Error('app-registry.json requires a non-empty "dockOrder" array');
  }
}

function normalizeViewDescriptor(rawView, sourceLabel) {
  const viewKey = String(rawView?.viewKey || '').trim();
  const viewId = String(rawView?.viewId || '').trim();
  const subtitle = String(rawView?.subtitle || '').trim();
  if (!viewId || !subtitle) {
    throw new Error(`${sourceLabel} requires viewId and subtitle`);
  }
  if (viewKey && !/^[A-Z][A-Z0-9_]*$/.test(viewKey)) {
    throw new Error(`${sourceLabel} has invalid viewKey "${viewKey}"`);
  }
  return {
    viewKey,
    viewId,
    subtitle,
    file: `ui/html/views/${viewId}.html`,
    styleFile: rawView?.includeStyle === false ? '' : `ui/css/views/${viewId}.css`
  };
}

async function buildAppRegistry() {
  const registry = await readJson(APP_REGISTRY_PATH);
  ensureAppRegistryShape(registry);

  const seenIds = new Set();
  const seenViewIds = new Set();
  const seenViewKeys = new Set();
  const seenIcons = new Set();
  const dockApps = [];
  const normalizedApps = [];
  const normalizedViews = [];

  for (const [index, rawApp] of registry.apps.entries()) {
    if (!rawApp || typeof rawApp !== 'object' || Array.isArray(rawApp)) {
      throw new Error(`Invalid app entry at index ${index} in app-registry.json`);
    }
    const id = String(rawApp.id || '').trim();
    const viewKey = String(rawApp.viewKey || '').trim();
    const label = String(rawApp.label || '').trim();
    const viewId = String(rawApp.viewId || '').trim();
    const subtitle = String(rawApp.subtitle || '').trim();
    const icon = String(rawApp.icon || '').trim();
    const placement = String(rawApp.placement || '').trim();
    const aliases = Array.isArray(rawApp.aliases)
      ? rawApp.aliases.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    const searchInputId = String(rawApp.searchInputId || '').trim();
    const agentChatRail = rawApp.agentChatRail === true;
    const hiddenFromNavigation = rawApp.hiddenFromNavigation === true;

    if (!id || !viewKey || !label || !viewId || !subtitle || !icon || !placement) {
      throw new Error(`App entry "${id || `index ${index}`}" is missing a required field`);
    }
    if (!/^[A-Z][A-Z0-9_]*$/.test(viewKey)) {
      throw new Error(`App "${id}" has invalid viewKey "${viewKey}"`);
    }
    if (placement !== 'dock' && placement !== 'more') {
      throw new Error(`App "${id}" has unsupported placement "${placement}"`);
    }
    if (seenIds.has(id)) {
      throw new Error(`Duplicate app id in app-registry.json: ${id}`);
    }
    if (seenViewIds.has(viewId)) {
      throw new Error(`Duplicate app viewId in app-registry.json: ${viewId}`);
    }
    if (seenViewKeys.has(viewKey)) {
      throw new Error(`Duplicate app viewKey in app-registry.json: ${viewKey}`);
    }
    if (seenIcons.has(icon)) {
      throw new Error(`Duplicate app icon in app-registry.json: ${icon}`);
    }
    const iconPath = path.join(ROOT_DIR, 'assets', 'icons', icon);
    let iconMarkup = '';
    try {
      await fs.access(iconPath);
      iconMarkup = (await fs.readFile(iconPath, 'utf8')).trim();
    } catch {
      throw new Error(`App "${id}" references missing icon "${iconPath}"`);
    }

    seenIds.add(id);
    seenViewIds.add(viewId);
    seenViewKeys.add(viewKey);
    seenIcons.add(icon);

    const app = {
      id,
      viewKey,
      label,
      viewId,
      subtitle,
      icon,
      iconMarkup,
      placement,
      aliases,
      searchInputId,
      agentChatRail,
      hiddenFromNavigation
    };
    if (placement === 'dock') {
      dockApps.push(id);
    }
    normalizedApps.push(app);
    normalizedViews.push(normalizeViewDescriptor(app, `App "${id}"`));
  }

  for (const [index, rawView] of (registry.supplementalViews || []).entries()) {
    const view = normalizeViewDescriptor(rawView, `Supplemental view at index ${index}`);
    if (seenViewIds.has(view.viewId)) {
      throw new Error(`Duplicate supplemental viewId in app-registry.json: ${view.viewId}`);
    }
    if (view.viewKey && seenViewKeys.has(view.viewKey)) {
      throw new Error(`Duplicate supplemental viewKey in app-registry.json: ${view.viewKey}`);
    }
    seenViewIds.add(view.viewId);
    if (view.viewKey) {
      seenViewKeys.add(view.viewKey);
    }
    normalizedViews.push(view);
  }

  const viewOrder = Array.isArray(registry.viewOrder)
    ? registry.viewOrder.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  if (viewOrder.length !== normalizedViews.length || new Set(viewOrder).size !== viewOrder.length) {
    throw new Error('viewOrder must list every app and supplemental view exactly once');
  }
  normalizedViews.forEach((view) => {
    if (!viewOrder.includes(view.viewId)) {
      throw new Error(`viewOrder is missing viewId "${view.viewId}"`);
    }
  });
  normalizedViews.sort((left, right) => viewOrder.indexOf(left.viewId) - viewOrder.indexOf(right.viewId));

  const dockOrder = registry.dockOrder.map((value) => String(value || '').trim()).filter(Boolean);
  if (dockOrder.length !== dockApps.length) {
    throw new Error('dockOrder length must match the number of apps with placement "dock"');
  }
  const dockAppSet = new Set(dockApps);
  dockOrder.forEach((id) => {
    if (!seenIds.has(id)) {
      throw new Error(`dockOrder references unknown app id "${id}"`);
    }
    if (!dockAppSet.has(id)) {
      throw new Error(`dockOrder references app "${id}" but its placement is not "dock"`);
    }
  });
  dockApps.forEach((id) => {
    if (!dockOrder.includes(id)) {
      throw new Error(`App "${id}" is placed in the dock but missing from dockOrder`);
    }
  });

  const generated = [
    '/* AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY. */',
    `/* Source config: ${toPosix(path.relative(ROOT_DIR, APP_REGISTRY_PATH))} */`,
    '',
    `export const APP_REGISTRY = ${JSON.stringify(normalizedApps, null, 2)};`,
    '',
    `export const APP_DOCK_ORDER = ${JSON.stringify(dockOrder, null, 2)};`,
    ''
  ].join('\n');

  const viewEntries = normalizedViews
    .filter((view) => view.viewKey)
    .map((view) => `  ${view.viewKey}: ${JSON.stringify(view.viewId)}`)
    .join(',\n');
  const titleEntries = normalizedViews
    .filter((view) => view.viewKey)
    .map((view) => `  [VIEWS.${view.viewKey}]: ${JSON.stringify(view.subtitle)}`)
    .join(',\n');
  const generatedViews = [
    '/* AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY. */',
    `/* Source config: ${toPosix(path.relative(ROOT_DIR, APP_REGISTRY_PATH))} */`,
    '',
    'export const VIEWS = Object.freeze({',
    viewEntries,
    '});',
    '',
    'export const TITLES = Object.freeze({',
    titleEntries,
    '});',
    ''
  ].join('\n');

  await writeText(APP_REGISTRY_MODULE_OUTPUT, generated);
  await writeText(VIEWS_MODULE_OUTPUT, generatedViews);
  return {
    apps: normalizedApps,
    views: normalizedViews
  };
}

export {
  buildAppRegistry
};
