#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(repoRoot, 'src');
const uiRoot = path.join(repoRoot, 'ui');
const appRegistryPath = path.join(uiRoot, 'config', 'app-registry.json');
const cssOrderPath = path.join(uiRoot, 'config', 'css-order.json');
const failures = [];

function listFiles(rootPath) {
  return fs.readdirSync(rootPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(rootPath, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
  });
}

function relative(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function resolveLocalImport(fromPath, specifier) {
  const base = path.resolve(path.dirname(fromPath), specifier);
  const candidates = path.extname(base)
    ? [base]
    : [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || '';
}

function collectSpecifiers(source) {
  const results = [];
  const patterns = [
    /\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
  ];
  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(source))) {
      results.push(match[1]);
    }
  });
  return [...new Set(results)];
}

const allFiles = listFiles(sourceRoot);
const sourceFiles = allFiles.filter((filePath) => /\.(?:c?js|mjs)$/.test(filePath));
const dependencyEdges = [];

sourceFiles.forEach((filePath) => {
  const source = fs.readFileSync(filePath, 'utf8');
  collectSpecifiers(source)
    .filter((specifier) => specifier.startsWith('.'))
    .forEach((specifier) => {
      const targetPath = resolveLocalImport(filePath, specifier);
      if (!targetPath) {
        failures.push(`${relative(filePath)} has an unresolved local import: ${specifier}`);
        return;
      }
      dependencyEdges.push([filePath, targetPath]);
    });
});

dependencyEdges.forEach(([fromPath, targetPath]) => {
  const from = relative(fromPath);
  const target = relative(targetPath);
  const sequenceViewerMainProcessPrefix = 'src/renderer/modules/sequence-viewer/main-process/';
  if (from.startsWith('src/main/') && target.startsWith('src/renderer/')) {
    const allowed = target.startsWith(sequenceViewerMainProcessPrefix);
    if (!allowed) {
      failures.push(`${from} crosses the Electron boundary into ${target}`);
    }
  }
  if (from.startsWith('src/renderer/')
    && !from.startsWith(sequenceViewerMainProcessPrefix)
    && target.startsWith(sequenceViewerMainProcessPrefix)) {
    failures.push(`${from} imports Node-only Sequence Viewer code from ${target}`);
  }
  if (from.startsWith('src/main/core/') && target.startsWith('src/main/app/')) {
    failures.push(`${from} creates a core -> app back-edge to ${target}`);
  }
  if (from.startsWith('src/renderer/app/') && target.startsWith('src/renderer/core/')) {
    failures.push(`${from} creates an app -> core back-edge to ${target}`);
  }
  if (from.startsWith('src/main/papers/') && target.startsWith('src/main/agent/')) {
    failures.push(`${from} imports Agent internals from ${target}`);
  }
  if ((from.startsWith('src/main/agent/runtime/') || from.startsWith('src/main/agent/mcp-contract/'))
    && target.startsWith('src/main/agent/codex-agent/')) {
    failures.push(`${from} imports Codex-specific code from ${target}`);
  }
  if (from.startsWith('src/renderer/modules/selection-insights/')
    && target.startsWith('src/renderer/modules/agent-chat/')
    && target !== 'src/renderer/modules/agent-chat/public-api.js') {
    failures.push(`${from} bypasses the Agent Chat public API via ${target}`);
  }
  if (from.startsWith('src/renderer/modules/agent-chat/')
    && from !== 'src/renderer/modules/agent-chat/index.js'
    && (target.startsWith('src/renderer/modules/biology-notebook/')
      || target.startsWith('src/renderer/modules/protocol/'))) {
    failures.push(`${from} imports feature-owned persistence from ${target}`);
  }
  if (from.startsWith('src/renderer/modules/biology-notebook/')
    && target.startsWith('src/renderer/modules/tool-box/')) {
    failures.push(`${from} imports Tool Box internals instead of renderer/lib via ${target}`);
  }
});

function sourceOwner(filePath) {
  const file = relative(filePath);
  const rendererModule = file.match(/^src\/renderer\/modules\/([^/]+)/);
  if (rendererModule) {
    return `renderer-module:${rendererModule[1].replace(/\.js$/, '')}`;
  }
  const rendererArea = file.match(/^src\/renderer\/([^/]+)/);
  if (rendererArea) {
    return `renderer:${rendererArea[1]}`;
  }
  if (file.startsWith('src/main/agent/')) {
    return 'main:agent';
  }
  // The Codex CLI provider is the transport half of the Codex Agent runtime,
  // even though its neutral public facade remains under main/lib.
  if (file === 'src/main/lib/codex-cli-provider.js'
    || file.startsWith('src/main/lib/codex-cli-provider/')) {
    return 'main:agent';
  }
  const mainArea = file.match(/^src\/main\/([^/]+)/);
  if (mainArea) {
    return `main:${mainArea[1]}`;
  }
  return file.startsWith('src/shared/') ? 'shared' : 'other';
}

const ownerGraph = new Map();
dependencyEdges.forEach(([fromPath, targetPath]) => {
  const fromOwner = sourceOwner(fromPath);
  const targetOwner = sourceOwner(targetPath);
  if (fromOwner === targetOwner) {
    return;
  }
  if (!ownerGraph.has(fromOwner)) {
    ownerGraph.set(fromOwner, new Set());
  }
  ownerGraph.get(fromOwner).add(targetOwner);
});

const ownerCycleKeys = new Set();
function visitOwner(owner, pathOwners = [], activeOwners = new Set()) {
  if (activeOwners.has(owner)) {
    const cycleStart = pathOwners.indexOf(owner);
    const cycle = [...pathOwners.slice(cycleStart), owner];
    const body = cycle.slice(0, -1);
    const rotations = body.map((_item, index) => [...body.slice(index), ...body.slice(0, index)]);
    const canonical = rotations.map((rotation) => rotation.join(' -> ')).sort()[0];
    ownerCycleKeys.add(canonical);
    return;
  }
  const nextActive = new Set(activeOwners).add(owner);
  const nextPath = [...pathOwners, owner];
  (ownerGraph.get(owner) || []).forEach((targetOwner) => visitOwner(targetOwner, nextPath, nextActive));
}
ownerGraph.forEach((_targets, owner) => visitOwner(owner));
ownerCycleKeys.forEach((cycle) => failures.push(`cross-owner dependency cycle: ${cycle}`));

const allowedRendererModuleRootFiles = new Set([
  'app-registry.generated.js',
  'app-state.js',
  'home-dashboard.js',
  'codex-model-catalog.generated.js',
  'tool-box.js',
  'utils.js',
  'views.js'
]);
fs.readdirSync(path.join(sourceRoot, 'renderer', 'modules'), { withFileTypes: true })
  .filter((entry) => entry.isFile() && !allowedRendererModuleRootFiles.has(entry.name))
  .forEach((entry) => failures.push(`src/renderer/modules/${entry.name} is a loose non-entry module`));

const sequenceNamePattern = /(?:sequence|oligo|crispr|primer|cloning|plasmid|genbank|backbone|orf|peptide|protein)/i;
const allowedSequencePrefixes = [
  'src/renderer/modules/sequence-viewer/',
  'src/main/ipc/',
  'src/main/preload/',
  'src/main/storage/'
];
allFiles.forEach((filePath) => {
  const file = relative(filePath);
  if (!sequenceNamePattern.test(path.basename(file))) {
    return;
  }
  const allowed = allowedSequencePrefixes.some((prefix) => file.startsWith(prefix))
    || file === 'src/renderer/module-manifests/sequence-viewer.js';
  if (!allowed) {
    failures.push(`${file} is sequence-owned code outside a Sequence Viewer or allowed boundary`);
  }
});

[
  'self-agent',
  'csv-io.js',
  'agent-context-debug.md',
  'Home Dashboard Prototype.html',
  'chemicals-test-import.csv',
  'demo.html',
  'data/llm-prompts.json',
  'data/chemicals.json',
  'src/main/sequence-viewer',
  'src/main/agent/codex-agent/protocol-fallback.js',
  'src/main/agent/plotly-graph-artifacts.js',
  'src/main/core/services/create-agent-mcp-initializer.js',
  'src/main/core/services/create-llm-prompts-service.js',
  'src/main/agent/tools/agent-tool-call.js',
  'src/main/agent/tools/agent-tool-provide.js',
  'src/main/papers/store/intake/index.js',
  'src/renderer/modules/agent-chat/notebook-drafts.js',
  'src/renderer/modules/pdf-export/template.js',
  'src/renderer/modules/sequence-viewer/sequence-input.js',
  'src/renderer/modules/tool-box/bench-calculations.js',
  'src/renderer/modules/tool-box/buffer.js',
  'src/renderer/modules/tool-box/molarity.js',
  'src/renderer/modules/tool-box/sequence.js',
  'src/renderer/modules/tool-box/oligo.js',
  'src/renderer/modules/tool-box/oligo-ui.js',
  'src/renderer/modules/tool-box/crispr.js',
  'src/renderer/modules/tool-box/crispr-ui.js',
  'src/renderer/modules/tool-box/peptide.js',
  'src/renderer/modules/tool-box/peptide-ui.js',
  'src/renderer/modules/tool-box/translation-ui.js',
  'src/renderer/modules/tool-box/extinction-ui.js',
  'src/renderer/services/sequenceService.js',
  'tests/suites/core/agent-suite/science-and-protocol-suite/prompt-and-fallback-suite.js',
  'tests/suites/core/app-modules-suite/assay-and-object-graph-suite.js',
  'src/main/ipc/index.js',
  'src/renderer/module-runtime.js',
  'src/renderer/shared-left-rail.js',
  'src/renderer/app/start-renderer-app.js',
  'assets/icons/synthesis-notebook.svg',
  'ui/assets/96-well-plate-reference.svg',
  'ui/css/overrides/shell-first-remake.css',
  'ui/css/views/synthesis-notebook-view.css',
  'ui/html/views/synthesis-notebook-view.html'
].forEach((retiredPath) => {
  if (fs.existsSync(path.join(repoRoot, retiredPath))) {
    failures.push(`${retiredPath} is a retired compatibility path`);
  }
});

allFiles
  .filter((filePath) => path.basename(filePath) === '.DS_Store')
  .forEach((filePath) => failures.push(`${relative(filePath)} is an OS metadata file`));

const appRegistry = JSON.parse(fs.readFileSync(appRegistryPath, 'utf8'));
const viewEntries = [
  ...(Array.isArray(appRegistry.apps) ? appRegistry.apps : []),
  ...(Array.isArray(appRegistry.supplementalViews) ? appRegistry.supplementalViews : [])
];
const expectedViewIds = new Set(viewEntries.map((entry) => String(entry?.viewId || '').trim()).filter(Boolean));
const htmlViewRoot = path.join(uiRoot, 'html', 'views');
const actualViewIds = new Set(
  fs.readdirSync(htmlViewRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => entry.name.replace(/\.html$/, ''))
);
expectedViewIds.forEach((viewId) => {
  if (!actualViewIds.has(viewId)) {
    failures.push(`ui/html/views/${viewId}.html is missing for a registered view`);
  }
});
actualViewIds.forEach((viewId) => {
  if (!expectedViewIds.has(viewId)) {
    failures.push(`ui/html/views/${viewId}.html is an unregistered view fragment`);
  }
});

const cssOrder = JSON.parse(fs.readFileSync(cssOrderPath, 'utf8'));
const allowedCssFiles = new Set([
  ...(Array.isArray(cssOrder.prefixInputs) ? cssOrder.prefixInputs : []),
  ...(Array.isArray(cssOrder.suffixInputs) ? cssOrder.suffixInputs : []),
  ...viewEntries
    .filter((entry) => entry?.includeStyle !== false)
    .map((entry) => `ui/css/views/${String(entry.viewId || '').trim()}.css`)
]);
listFiles(path.join(uiRoot, 'css'))
  .filter((filePath) => filePath.endsWith('.css'))
  .map(relative)
  .forEach((filePath) => {
    if (!allowedCssFiles.has(filePath)) {
      failures.push(`${filePath} is not part of the generated CSS bundle`);
    }
  });
allowedCssFiles.forEach((filePath) => {
  if (!fs.existsSync(path.join(repoRoot, filePath))) {
    failures.push(`${filePath} is configured for the CSS bundle but missing`);
  }
});

const runtimeReferenceRoots = [sourceRoot, uiRoot, path.join(repoRoot, 'config')];
const runtimeReferenceText = runtimeReferenceRoots
  .flatMap(listFiles)
  .filter((filePath) => /\.(?:css|html|js|json|mjs)$/.test(filePath))
  .map((filePath) => fs.readFileSync(filePath, 'utf8'))
  .join('\n');
const referencedRuntimeAssets = new Set(
  [...runtimeReferenceText.matchAll(/(?:assets\/icons|assets\/fonts|ui\/assets)\/[^\s"'()]+/g)]
    .map((match) => match[0])
);
referencedRuntimeAssets.forEach((assetPath) => {
  if (!fs.existsSync(path.join(repoRoot, assetPath))) {
    failures.push(`${assetPath} is referenced by runtime source but missing`);
  }
});
[
  ['assets/icons', /\.svg$/],
  ['ui/assets', /./]
].forEach(([assetFolder, assetPattern]) => {
  const assetRoot = path.join(repoRoot, assetFolder);
  if (!fs.existsSync(assetRoot)) {
    return;
  }
  listFiles(assetRoot)
    .filter((filePath) => assetPattern.test(path.basename(filePath)))
    .forEach((filePath) => {
      if (!runtimeReferenceText.includes(path.basename(filePath))) {
        failures.push(`${relative(filePath)} is an unreferenced runtime asset`);
      }
    });
});

const fontRoot = path.join(repoRoot, 'assets', 'fonts');
listFiles(fontRoot)
  .filter((filePath) => /\.(?:ttf|woff2?)$/i.test(filePath))
  .forEach((filePath) => {
    if (!runtimeReferenceText.includes(path.basename(filePath))) {
      failures.push(`${relative(filePath)} is an unreferenced font asset`);
    }
  });

if (failures.length) {
  console.error(`Source layout check failed with ${failures.length} issue(s):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Source layout check passed (${sourceFiles.length} source files, ${dependencyEdges.length} local imports).`);
