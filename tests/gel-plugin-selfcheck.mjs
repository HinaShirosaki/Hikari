// Self-check for src/plugins/gel — Hikari's internal Gel workspace running
// through the same sandbox and API boundary as an installed plugin.
//
// Two things can silently break it: the internal folder drifting out of the
// plugin contract, and the plugin-owned analysis graph losing an import. Both
// are checked against this source-owned plugin, the only implementation.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = path.join(projectRoot, 'src/plugins/gel');
const { inspectPluginFolder } = require(path.join(projectRoot, 'src/main/lib/inspect-plugin-folder.js'));
const { loadEsmStyleModule } = require(path.join(projectRoot, 'tests/support/runtime.js'));
const { BUNDLED_PLUGINS } = loadEsmStyleModule(
  path.join(projectRoot, 'src/renderer/lib/bundled-plugins.js')
);

// preprocessWithJs builds a preview ImageData for the canvas. Node has no such
// global; the preview is never read here, so a holder is enough.
globalThis.ImageData ??= class ImageData {
  constructor(data, width, height) {
    Object.assign(this, { data, width, height });
  }
};

const vendor = path.join(pluginDir, 'vendor/modules/gel');
const { detectLanes } = await import(new URL(`file://${vendor}/analysis/auto-lanes.js`));
const {
  analyzeGelImage,
  buildLanesFromManualSegmentation,
  detectLadderBandRows
} = await import(new URL(`file://${vendor}/analysis/analysis-core.js`));
const { buildQuantificationSignal } = await import(new URL(`file://${vendor}/analysis/image-processing.js`));
const { createHistoryController } = await import(new URL(`file://${vendor}/history.js`));
const { initPluginLeftRailResizer } = await import(new URL(`file://${pluginDir}/left-rail.js`));
const ladderConstants = await import(new URL(`file://${vendor}/constants.js`));

// Six evenly spaced dark lanes on a light background, each with one band.
function syntheticGel({ width = 320, height = 200, laneCount = 6 } = {}) {
  const gray = new Float32Array(width * height).fill(0.9);
  const pitch = Math.floor(width / (laneCount + 1));
  for (let lane = 1; lane <= laneCount; lane += 1) {
    const centerX = lane * pitch;
    for (let y = 90; y < 110; y += 1) {
      for (let x = centerX - 8; x <= centerX + 8; x += 1) {
        gray[(y * width) + x] = 0.15;
      }
    }
  }
  return { gray, width, height, laneCount };
}

async function checkFolderContract() {
  const result = await inspectPluginFolder({ fs, folderPath: pluginDir });
  assert.equal(result.ok, true, `plugin folder rejected: ${result.error}`);
  assert.equal(result.id, 'gel');
  assert.equal(result.serve, true, 'must stay served — main.js uses ES modules, which an opaque origin cannot load');
  // `layout` covers app.setLeftRailWidth, which the in-frame rail commits on pointer-up.
  assert.deepEqual(result.permissions, ['storage', 'files', 'downloads', 'layout']);

  const bundled = BUNDLED_PLUGINS.find((entry) => entry.id === result.id);
  assert.ok(bundled, 'Gel must remain registered as an internal bundled plugin');
  assert.equal(bundled.path, '@bundled/gel', 'renderer state must keep a private token, not a source path');
  assert.equal(bundled.bundled, true);
  assert.equal(bundled.icon, 'gel-analysis');
  assert.match(bundled.iconMarkup, /data-hikari-icon="gel-analysis"/);
  assert.doesNotMatch(bundled.iconMarkup, /<script|on\w+=/i, 'the trusted host icon stays inert');
  assert.equal(bundled.name, result.name);
  assert.equal(bundled.version, result.version);
  assert.equal(bundled.description, result.description);
  assert.equal(bundled.serve, result.serve);
  assert.deepEqual([...bundled.permissions], result.permissions);

  const mainServicesSource = await fs.readFile(
    path.join(projectRoot, 'src/main/core/main-services.js'),
    'utf8'
  );
  assert.match(
    mainServicesSource,
    /pluginId === 'gel' \? path\.join\(projectRoot, 'src', 'plugins', 'gel'\) : ''/,
    'the private Gel token must resolve to the source-owned packaged folder'
  );
}

async function checkLeftRailContract() {
  const rootStyles = new Map();
  const documentListeners = new Map();
  const windowListeners = new Map();
  const handleListeners = new Map();
  const bodyClasses = new Set();
  const railClasses = new Set();
  const commits = [];
  let handle = null;

  const rail = {
    classList: {
      add: (name) => railClasses.add(name),
      remove: (name) => railClasses.delete(name)
    },
    getBoundingClientRect: () => ({
      width: Number.parseFloat(rootStyles.get('--shared-left-rail-width')) || 280
    })
  };
  const layout = {
    querySelector: (selector) => (selector === '[data-sync-left-rail]' ? rail : null),
    querySelectorAll: () => [],
    append: (node) => { handle = node; }
  };
  const documentObject = {
    documentElement: {
      style: { setProperty: (name, value) => rootStyles.set(name, value) }
    },
    body: {
      classList: {
        add: (name) => bodyClasses.add(name),
        remove: (name) => bodyClasses.delete(name)
      }
    },
    querySelector: (selector) => (selector === '.gel-workspace.left-rail-template' ? layout : null),
    querySelectorAll: () => [],
    createElement: () => ({
      setAttribute() {},
      addEventListener: (type, listener) => handleListeners.set(type, listener),
      removeEventListener: (type) => handleListeners.delete(type),
      remove() { this.removed = true; }
    }),
    addEventListener: (type, listener) => documentListeners.set(type, listener),
    removeEventListener: (type) => documentListeners.delete(type)
  };
  const windowObject = {
    innerWidth: 1200,
    addEventListener: (type, listener) => windowListeners.set(type, listener),
    removeEventListener: (type) => windowListeners.delete(type)
  };

  const controller = initPluginLeftRailResizer({
    documentObject,
    windowObject,
    initialLayout: {
      leftRail: { width: 300, min: 240, max: 400, mobileBreakpoint: 980 }
    },
    commitWidth: async (width) => {
      commits.push(width);
      return { leftRail: { width, min: 240, max: 400, mobileBreakpoint: 980 } };
    }
  });

  assert.ok(handle, 'Gel creates one resize handle inside its own iframe');
  assert.equal(rootStyles.get('--shared-left-rail-width'), '300px');
  handleListeners.get('pointerdown')({ clientX: 300, preventDefault() {} });
  documentListeners.get('pointermove')({ clientX: 360 });
  assert.equal(rootStyles.get('--shared-left-rail-width'), '360px', 'pointer movement resizes immediately');
  assert.equal(bodyClasses.has('shared-left-rail-resizing'), true);
  documentListeners.get('pointerup')({});
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(commits, [360], 'only the settled width crosses the host API boundary');
  assert.equal(railClasses.has('is-resizing'), false);
  assert.equal(bodyClasses.has('shared-left-rail-resizing'), false);

  controller.applyContext({ leftRail: { width: 390, min: 240, max: 400, mobileBreakpoint: 980 } });
  assert.equal(rootStyles.get('--shared-left-rail-width'), '390px', 'host layout updates stay synchronized');
  controller.destroy();
  assert.equal(handle.removed, true);
  assert.equal(windowListeners.has('resize'), false, 'destroy releases the resize listener');
}

async function checkAdapterContract() {
  const [mainSource, exportSource, recordSource, controllerSource, powerPointSource, htmlSource, viewSource, coreCss] = await Promise.all([
    fs.readFile(path.join(pluginDir, 'main.js'), 'utf8'),
    fs.readFile(path.join(vendor, 'export.js'), 'utf8'),
    fs.readFile(path.join(vendor, 'records-manager.js'), 'utf8'),
    fs.readFile(path.join(vendor, 'index.js'), 'utf8'),
    fs.readFile(path.join(vendor, 'rendering/powerpoint-export.js'), 'utf8'),
    fs.readFile(path.join(pluginDir, 'index.html'), 'utf8'),
    fs.readFile(path.join(pluginDir, 'vendor/gel-view.html'), 'utf8'),
    fs.readFile(path.join(pluginDir, 'vendor/css/base/core.css'), 'utf8')
  ]);
  assert.doesNotMatch(mainSource, /PERSIST_DEBOUNCE_MS/, 'save acknowledgement must not sit behind a timer');
  assert.match(mainSource, /await hikari\.call\('storage\.set'/, 'persist waits for the host write');
  assert.match(mainSource, /app\.setLeftRailWidth/, 'the in-frame rail commits its settled width through the host API');
  assert.match(mainSource, /initPluginLeftRailResizer/, 'Gel initializes its plugin-owned resize controller');
  assert.match(mainSource, /!Number\.isInteger\(version\)/, 'stored schema versions are validated before hydration');
  assert.match(mainSource, /gelAnalyses: state\.gelAnalyses\.map\(toStoredRecord\)/, 'plugin storage keeps a compact record index');
  assert.match(recordSource, /await runtime\.persist\(\)/, 'the Gel save waits for persistence');
  assert.match(recordSource, /let savePromise = null/, 'the Gel UI deduplicates concurrent saves');
  assert.match(recordSource, /let exportPromise = null/, 'the Gel UI deduplicates native export dialogs');
  assert.match(recordSource, /failedResult\.error/, 'artifact write failures remain visible to the user');
  assert.match(
    controllerSource.slice(controllerSource.indexOf('const recordsManager =')),
    /confirmDelete:/,
    'record deletion has an explicit user confirmation'
  );
  assert.match(exportSource, /hikariApi\?\.exportTextFile/, 'exports use the host save dialog API');
  assert.match(exportSource, /hikariApi\?\.exportBinaryFile/, 'generated PNGs use the host save dialog API');
  assert.match(mainSource, /async exportBinaryFile\(\{ dataBase64, fileName \}\)/, 'the Gel adapter forwards PNG bytes without text encoding');
  assert.match(powerPointSource, /slide\.addTable/, 'PowerPoint exports keep lane metadata as a native table');
  assert.match(powerPointSource, /presentation\.write/, 'PowerPoint exports use the bundled compatibility writer');
  assert.match(htmlSource, /id="boot-retry"/, 'boot failures expose a retry action');
  assert.match(
    htmlSource,
    /vendor\/pptxgenjs\/pptxgen\.bundle\.js/,
    'the PowerPoint compatibility writer loads before Gel modules execute'
  );
  await fs.access(path.join(pluginDir, 'vendor/pptxgenjs/LICENSE'));
  assert.match(htmlSource, /<script src="\.\/hikari\.js"><\/script>/, 'the classic host client loads before the module adapter');
  assert.match(viewSource, /id="gel-save-btn"/, 'the save action has a stable busy-state target');
  assert.match(viewSource, /id="gel-ladder-preset"/, 'the ladder preset select is present for records-manager to read');
  assert.match(viewSource, /id="gel-ladder-band-mw"[^>]+list="gel-ladder-band-mw-options"/, 'the ladder MW field offers the preset sizes');
  assert.match(viewSource, /id="gel-status"[^>]+aria-live="polite"/, 'workspace status updates are announced');
  assert.doesNotMatch(htmlSource, /universal-left-rail-lists\.css|universal-menus\.css/, 'unrelated shell styles are not loaded');
  assert.doesNotMatch(coreCss, /assets\/fonts/, 'the plugin CSS has no missing external font dependency');
}

function checkPipeline() {
  const { gray, width, height, laneCount } = syntheticGel();

  const detected = detectLanes({ gray, width, height, expectedLaneCount: laneCount });
  assert.ok(detected, 'detectLanes found nothing on a synthetic gel');
  assert.ok(detected.peaks.length >= 2, `expected lane peaks, got ${detected.peaks.length}`);
  assert.ok(detected.bandBottom > detected.bandTop, 'band window is inverted');

  // The same handoff main.js makes: auto-detected segmentation in as manual
  // overrides, which is the only way analyzeGelImage accepts lanes.
  const { report } = analyzeGelImage({
    gray,
    imageName: 'synthetic.png',
    width,
    height,
    params: {
      analysisType: 'sds-page',
      analysisMode: 'manual',
      ladderStandards: [],
      ladderLane: 1,
      normalization: 'total-lane',
      enhancement: {},
      manualOverrides: {
        laneSegmentation: {
          gelLeft: detected.gelLeft,
          gelRight: detected.gelRight,
          dividers: detected.dividers,
          dividerDone: true,
          bandTop: detected.bandTop,
          bandBottom: detected.bandBottom
        }
      }
    }
  });

  assert.ok(report.lanes.length >= 2, `expected quantified lanes, got ${report.lanes.length}`);
  assert.ok(
    report.lanes.every((lane) => lane.bands.length > 0),
    'every lane inside the band window should carry a band'
  );
  assert.ok(
    report.lanes.some((lane) => lane.totalBandIntensity > 0),
    'bands quantified to zero intensity'
  );
  // No ladder is passed, so MW calibration must fail cleanly rather than throw.
  assert.equal(report.calibration.ok, false);
}

function checkLadderPresets() {
  const { DEFAULT_LADDER_PRESET_ID, DEFAULT_LADDER_STANDARDS, LADDER_PRESETS, getLadderPresetBands } = ladderConstants;

  const ids = LADDER_PRESETS.map((preset) => preset.id);
  assert.equal(new Set(ids).size, ids.length, 'preset ids must be unique — the select stores one as the record parameter');
  assert.ok(ids.includes(DEFAULT_LADDER_PRESET_ID), 'the default preset id must name a real preset');
  assert.deepEqual(getLadderPresetBands(DEFAULT_LADDER_PRESET_ID), DEFAULT_LADDER_STANDARDS);

  LADDER_PRESETS.forEach((preset) => {
    assert.ok(preset.label && preset.group, `${preset.id} needs a label and a group`);
    assert.ok(preset.bands.length >= 2, `${preset.id} needs at least two bands to calibrate against`);
    // buildCalibration pairs ladder bands top-down with these, so a preset that
    // is not strictly descending would silently mis-size every sample lane.
    preset.bands.forEach((size, index) => {
      assert.ok(Number.isFinite(size) && size > 0, `${preset.id} has a non-positive band size`);
      assert.ok(index === 0 || size < preset.bands[index - 1], `${preset.id} bands are not strictly descending`);
    });
  });

  // Unknown ids (an older record, a retired preset) must not blank the standards.
  assert.deepEqual(getLadderPresetBands('not-a-preset'), DEFAULT_LADDER_STANDARDS);
  const copy = getLadderPresetBands(DEFAULT_LADDER_PRESET_ID);
  copy.push(0);
  assert.deepEqual(getLadderPresetBands(DEFAULT_LADDER_PRESET_ID), DEFAULT_LADDER_STANDARDS, 'callers must not mutate the shared preset');
}

// Detect ladder bands: the Detect ladder button pairs these rows with the preset
// top-down, so a row that lands on the wrong band mislabels every band below it.
function checkLadderDetection() {
  const width = 120;
  const height = 240;
  const bandRows = [30, 80, 140, 195];
  const gray = new Float32Array(width * height).fill(0.9);
  bandRows.forEach((row) => {
    for (let y = row - 4; y <= row + 4; y += 1) {
      for (let x = 40; x <= 80; x += 1) {
        gray[(y * width) + x] = 0.15;
      }
    }
  });

  const overrides = { laneSegmentation: { gelLeft: 35, gelRight: 85, dividers: [] } };
  const lane = (buildLanesFromManualSegmentation(overrides, width, height) || [])[0];
  assert.ok(lane, 'one lane must be built from the synthetic divider layout');

  const { signal } = buildQuantificationSignal(gray);
  const rows = detectLadderBandRows({ signal, width, height, lane, count: bandRows.length });
  assert.equal(rows.length, bandRows.length, `expected ${bandRows.length} ladder bands, got ${rows.length}`);
  assert.deepEqual(rows, [...rows].sort((a, b) => a - b), 'rows must come back top-to-bottom for preset pairing');
  rows.forEach((row, index) => {
    assert.ok(
      Math.abs(row - bandRows[index]) <= 4,
      `ladder band ${index} detected at row ${row}, expected near ${bandRows[index]}`
    );
  });

  // Fewer standards than bands must not over-read: only the strongest are returned.
  assert.equal(detectLadderBandRows({ signal, width, height, lane, count: 2 }).length, 2);
  assert.deepEqual(detectLadderBandRows({ signal, width, height, lane, count: 0 }), []);
  assert.deepEqual(detectLadderBandRows({ signal, width, height, lane: null, count: 4 }), []);
}

// Undo/redo inside the frame. The host's global service snapshots the renderer's
// state object, which never contains this frame's lane and band edits, so the
// workspace keeps its own stack and reports its depth up through app.setHistory.
function checkHistoryController() {
  const runtime = { manualOverrides: { ladderLane: 1, ladderBands: [] }, imageRevision: 0 };
  const renders = [];
  const announced = [];
  const history = createHistoryController({
    runtime,
    deps: {
      onHistoryChanged: (historyState) => announced.push(historyState),
      renderAll: () => renders.push(JSON.stringify(runtime.manualOverrides))
    }
  });

  assert.deepEqual(history.getHistoryState(), { canUndo: false, canRedo: false });
  assert.equal(history.commit(), false, 'an unchanged render must not push an entry');
  assert.equal(history.undo(), false);

  runtime.manualOverrides = { ladderLane: 1, ladderBands: [{ pixelY: 40, mw: 50 }] };
  assert.equal(history.commit(), true);
  runtime.manualOverrides = { ladderLane: 2, ladderBands: [{ pixelY: 40, mw: 50 }] };
  assert.equal(history.commit(), true);
  assert.deepEqual(history.getHistoryState(), { canUndo: true, canRedo: false });

  assert.equal(history.undo(), true);
  assert.equal(runtime.manualOverrides.ladderLane, 1);
  assert.equal(runtime.manualOverrides.ladderBands.length, 1, 'undo went back two steps at once');
  assert.equal(history.undo(), true);
  assert.equal(runtime.manualOverrides.ladderBands.length, 0);
  assert.equal(history.undo(), false, 'undo ran past the start of the stack');

  assert.equal(history.redo(), true);
  assert.equal(runtime.manualOverrides.ladderBands.length, 1);
  assert.equal(history.redo(), true);
  assert.equal(runtime.manualOverrides.ladderLane, 2);
  assert.equal(history.redo(), false);
  assert.equal(renders.length, 4, 'every applied snapshot must re-render the workspace');
  assert.ok(announced.length > 0, 'the host is never told the buttons can light up');

  // Re-rendering during an undo must not push the restored state back on.
  history.undo();
  assert.deepEqual(history.getHistoryState(), { canUndo: true, canRedo: true });

  // A new image or an applied crop moves every coordinate: the stack is dropped,
  // not replayed onto pixels that no longer exist.
  runtime.imageRevision += 1;
  runtime.manualOverrides = { ladderLane: 9, ladderBands: [] };
  assert.equal(history.commit(), false);
  assert.deepEqual(history.getHistoryState(), { canUndo: false, canRedo: false });
  assert.equal(history.undo(), false);
  assert.equal(runtime.manualOverrides.ladderLane, 9, 'a dropped stack still rolled the state back');
}

await checkFolderContract();
await checkAdapterContract();
await checkLeftRailContract();
checkPipeline();
checkLadderPresets();
checkLadderDetection();
checkHistoryController();
console.log('gel-plugin-selfcheck: ok');
