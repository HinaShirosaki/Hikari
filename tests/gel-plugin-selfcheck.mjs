// Self-check for examples/plugins/gel — the gel analysis pipeline running as a
// plugin (docs/plugins/plugin-system.md).
//
// Two things can silently break it: the folder drifting out of the install
// contract, and the vendored copy of the analysis modules losing an import when
// the built-in module moves. Both are checked here against the plugin's own
// copy, never the source tree, so a stale or half-copied vendor/ fails.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = path.join(projectRoot, 'examples/plugins/gel');
const { inspectPluginFolder } = require(path.join(projectRoot, 'src/main/lib/inspect-plugin-folder.js'));

// preprocessWithJs builds a preview ImageData for the canvas. Node has no such
// global; the preview is never read here, so a holder is enough.
globalThis.ImageData ??= class ImageData {
  constructor(data, width, height) {
    Object.assign(this, { data, width, height });
  }
};

const vendor = path.join(pluginDir, 'vendor/modules/gel');
const { detectLanes } = await import(new URL(`file://${vendor}/analysis/auto-lanes.js`));
const { analyzeGelImage } = await import(new URL(`file://${vendor}/analysis/analysis-core.js`));

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
  assert.deepEqual(result.permissions, ['storage', 'files', 'downloads']);
}

async function checkAdapterContract() {
  const [mainSource, exportSource, recordSource, controllerSource, htmlSource, viewSource, coreCss] = await Promise.all([
    fs.readFile(path.join(pluginDir, 'main.js'), 'utf8'),
    fs.readFile(path.join(vendor, 'export.js'), 'utf8'),
    fs.readFile(path.join(vendor, 'records-manager.js'), 'utf8'),
    fs.readFile(path.join(vendor, 'index.js'), 'utf8'),
    fs.readFile(path.join(pluginDir, 'index.html'), 'utf8'),
    fs.readFile(path.join(pluginDir, 'vendor/gel-view.html'), 'utf8'),
    fs.readFile(path.join(pluginDir, 'vendor/css/base/core.css'), 'utf8')
  ]);
  assert.doesNotMatch(mainSource, /PERSIST_DEBOUNCE_MS/, 'save acknowledgement must not sit behind a timer');
  assert.match(mainSource, /await hikari\.call\('storage\.set'/, 'persist waits for the host write');
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
  assert.match(htmlSource, /id="boot-retry"/, 'boot failures expose a retry action');
  assert.match(htmlSource, /<script src="\.\/hikari\.js"><\/script>/, 'the classic host client loads before the module adapter');
  assert.match(viewSource, /id="gel-save-btn"/, 'the save action has a stable busy-state target');
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

await checkFolderContract();
await checkAdapterContract();
checkPipeline();
console.log('gel-plugin-selfcheck: ok');
