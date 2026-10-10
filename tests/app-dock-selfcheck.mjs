import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAppDock } from '../src/renderer/app/navigation-shell/app-dock.js';
import runtime from './support/runtime.js';

const registry = JSON.parse(fs.readFileSync(new URL('../ui/config/app-registry.json', import.meta.url), 'utf8'));
const documentObject = runtime.createMockDocument();
const originalCreateElement = documentObject.createElement;
documentObject.createElement = (tag) => {
  const element = originalCreateElement(tag);
  element.children = [];
  element.append = (...nodes) => element.children.push(...nodes);
  element.replaceChildren = (...nodes) => { element.children = nodes; };
  element.querySelectorAll = () => element.children;
  element.focus = () => { documentObject.activeElement = element; };
  return element;
};
documentObject.body.dataset = {};
const dockNav = documentObject.createElement('nav');
const moreMenu = documentObject.createElement('div');
const moreBtn = documentObject.createElement('button');
moreMenu.hidden = true;
documentObject.querySelectorAll = () => [...dockNav.children, ...moreMenu.children];
const apps = [...registry.apps, { id: 'plugin-example', viewId: 'plugin-view', label: 'Plugin example' }];
const dockApps = registry.dockOrder.map((id) => apps.find((app) => app.id === id));
const expandedDockApps = [...dockApps, ...apps.filter((app) => !registry.dockOrder.includes(app.id))];
const resolveNavigationViewId = (id) => id === 'sequence-viewer-detail-view' ? 'sequence-viewer-view' : id;
const pageTitle = {};
let activeViewId = 'home-view';
const windowObject = { innerWidth: 4000 };
const dock = createAppDock({
  documentObject, windowObject, dockNav, moreMenu, moreBtn, expandedDockApps,
  getActiveViewId: () => activeViewId,
  pageTitle, TITLES: {}, resolveNavigationViewId,
  getAppForView: (id) => apps.find((app) => app.viewId === resolveNavigationViewId(id))
});
const navigate = (id) => {
  activeViewId = id;
  dock.renderAppNavigation(id);
  dock.syncNavigationState(id);
};
const ids = () => dockNav.children.map((button) => button.dataset.appId);
const expectedOrder = [
  'home', 'protocols', 'biology-notebook', 'papers', 'sample-inventory', 'chemicals',
  'workflows', 'agent', 'sequence-viewer', 'assay', 'tools', 'settings', 'plugin-example'
];
navigate(activeViewId);
assert.deepEqual(ids(), expectedOrder, 'wide windows retain the original full icon order');
assert.equal(moreBtn.hidden, true, 'More disappears when every module fits');
assert.equal(moreMenu.children.length, 0);
windowObject.innerWidth = 560;
navigate(activeViewId);
const mediumCount = dockNav.children.length;
assert.ok(mediumCount > 5 && mediumCount < apps.length, 'medium windows can show more than five icons');
windowObject.innerWidth = 320;
navigate(activeViewId);
const narrowCount = dockNav.children.length;
assert.ok(narrowCount < mediumCount, 'narrowing the window folds additional modules');
assert.deepEqual(ids(), expectedOrder.slice(0, narrowCount));
assert.equal(moreBtn.hidden, false);
assert.deepEqual(moreMenu.children.map((button) => button.dataset.appId), expectedOrder.slice(narrowCount));
const originalButtons = [...dockNav.children];
dock.renderAppNavigation();
assert.deepEqual(dockNav.children, originalButtons, 'unchanged capacity preserves existing DOM nodes');
for (const app of apps) {
  navigate(app.viewId);
  assert.equal(pageTitle.textContent, 'Hikari');
  assert.equal(dockNav.children.find((button) => button.attributes.get('aria-current') === 'page').dataset.appId, app.id);
  assert.ok(ids().includes(app.id), 'the selected overflow module is promoted into the dock');
  assert.deepEqual(ids(), expectedOrder.filter((id) => ids().includes(id)), 'promotion preserves registry order');
  const reachableIds = [...ids(), ...moreMenu.children.map((button) => button.dataset.appId)];
  assert.equal(new Set(reachableIds).size, apps.length, 'no module is lost or duplicated');
  assert.equal(reachableIds.length, apps.length);
}
navigate('sequence-viewer-detail-view');
assert.equal(dockNav.children.find((button) => button.attributes.get('aria-current') === 'page').dataset.appId, 'sequence-viewer');
assert.equal(pageTitle.textContent, 'Hikari');
dock.toggleMoreMenu(true);
const firstOverflow = moreMenu.children[0].dataset.appId;
assert.equal(documentObject.activeElement.dataset.appId, firstOverflow);
const press = (key) => {
  let prevented = false;
  dock.handleMoreMenuKeydown({ key, preventDefault: () => { prevented = true; } });
  return prevented;
};
assert.equal(press('ArrowDown'), true);
assert.equal(documentObject.activeElement.dataset.appId, moreMenu.children[1].dataset.appId);
press('End');
assert.equal(documentObject.activeElement.dataset.appId, 'plugin-example');
press('ArrowDown');
assert.equal(documentObject.activeElement.dataset.appId, firstOverflow, 'arrow navigation wraps');
press('ArrowUp');
assert.equal(documentObject.activeElement.dataset.appId, 'plugin-example');
assert.equal(press('Tab'), false, 'Tab keeps its native focus traversal');
assert.equal(moreMenu.hidden, true);
assert.equal(documentObject.activeElement, moreBtn);
assert.equal(moreBtn.attributes.get('aria-expanded'), 'false');
windowObject.innerWidth = 4000;
navigate(activeViewId);
assert.equal(moreBtn.hidden, true);
assert.deepEqual(ids(), expectedOrder, 'widening restores the full original order');
const offlineDock = createAppDock({
  documentObject, windowObject, dockNav, moreMenu, moreBtn, expandedDockApps,
  isAppShown: (app) => app.id !== 'agent',
  getActiveViewId: () => activeViewId,
  pageTitle, TITLES: {}, resolveNavigationViewId,
  getAppForView: (id) => apps.find((app) => app.viewId === resolveNavigationViewId(id))
});
offlineDock.renderAppNavigation(activeViewId);
assert.deepEqual(ids(), expectedOrder.filter((id) => id !== 'agent'), 'a hidden module leaves the dock and More');
assert.equal(moreMenu.children.length, 0);
console.log('PASS app dock: original order, responsive overflow, selected-module promotion, aliases, keyboard focus, and hidden modules');
