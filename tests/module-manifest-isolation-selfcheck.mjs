// One broken module must not take down the other thirteen. Every manifest
// callback runs inside runManifestStep(), so this asserts the three loops keep
// going past a throw and still deliver the healthy modules' work.
import assert from 'node:assert/strict';
import {
  createManifestNavigationAliases,
  createManifestRenderEntries,
  initializeModuleManifests,
  renderModuleManifests
} from '../src/renderer/module-manifests/runtime.js';

const boom = () => {
  throw new Error('deliberate module failure');
};

function makeRegistry() {
  const registered = [];
  return { registered, register: (key, module) => registered.push([key, module]) };
}

const manifests = [
  { key: 'healthyBefore', init: () => ({ id: 'before' }), bootOrder: 10, renderAll: (ctx) => ctx.rendered.push('before'), viewId: 'before-view', render: (ctx) => ctx.rendered.push('before-view') },
  { key: 'brokenInit', init: boom, bootOrder: 20, renderAll: (ctx) => ctx.rendered.push('brokenInit'), viewId: 'broken-init-view' },
  { key: 'brokenRender', init: () => ({ id: 'br' }), bootOrder: 30, renderAll: boom, viewId: 'broken-render-view', render: boom },
  { key: 'brokenViews', init: () => ({ id: 'bv' }), bootOrder: 40, viewIds: boom, render: () => {}, navigationAliases: [{ viewId: boom, navigationViewId: 'x' }] },
  { key: 'healthyAfter', init: () => ({ id: 'after' }), bootOrder: 50, renderAll: (ctx) => ctx.rendered.push('after'), viewId: 'after-view', render: (ctx) => ctx.rendered.push('after-view') }
];

// console.error is the intended reporting path; silence it so the check reads clean.
const realError = console.error;
const logged = [];
console.error = (message) => logged.push(String(message));
try {
  const registry = makeRegistry();
  const context = { modules: {}, rendered: [] };

  // 1. init: a throwing module is skipped, the rest still register.
  const initialized = initializeModuleManifests(registry, manifests, context);
  assert.deepEqual(Object.keys(initialized).sort(), ['brokenRender', 'brokenViews', 'healthyAfter', 'healthyBefore']);
  assert.equal(initialized.brokenInit, undefined, 'the throwing module must be absent');
  assert.equal(context.modules.healthyAfter.id, 'after', 'modules after the failure must still initialize');

  // 2. renderAll: a throwing render does not stop later modules in bootOrder.
  renderModuleManifests(manifests, context);
  assert.deepEqual(context.rendered, ['before', 'brokenInit', 'after'], 'renderAll must span the failures');

  // 3. per-view entries: view resolution and render are both fenced.
  const entries = new Map(createManifestRenderEntries(manifests, context));
  assert.ok(!entries.has('broken-views-view'), 'a manifest whose viewIds throws contributes nothing');
  assert.doesNotThrow(() => entries.get('broken-render-view')(), 'a throwing per-view render must not escape');
  context.rendered.length = 0;
  entries.get('after-view')();
  assert.deepEqual(context.rendered, ['after-view'], 'healthy per-view renders still work');

  // 4. navigation aliases: one throwing alias does not lose the map.
  assert.doesNotThrow(() => createManifestNavigationAliases(manifests, context));

  // Every failure was reported, named by manifest key.
  assert.ok(logged.some((line) => line.includes('"brokenInit"') && line.includes('initialize')));
  assert.ok(logged.some((line) => line.includes('"brokenRender"') && line.includes('render')));
  assert.ok(logged.some((line) => line.includes('"brokenViews"')));
} finally {
  console.error = realError;
}

console.log('module-manifest-isolation-selfcheck: ok');
