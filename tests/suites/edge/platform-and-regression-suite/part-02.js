module.exports = function registerPlatformAndRegressionSuitePart02(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
const sourceCache = new Map();
function readSource(relativePath) {
  const filePath = path.join(__dirname, relativePath);
  if (!sourceCache.has(filePath)) {
    sourceCache.set(filePath, fs.readFileSync(filePath, 'utf8'));
  }
  return sourceCache.get(filePath);
}

function listJavaScriptFiles(rootPath) {
  return fs.readdirSync(rootPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      return listJavaScriptFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith('.js') ? [entryPath] : [];
  });
}

function assertClose(actual, expected, epsilon = 1e-6) {
  assert.equal(Number.isFinite(actual), true, `Expected finite number, got ${actual}`);
  assert.ok(Math.abs(actual - expected) <= epsilon, `Expected ${actual} to be within ${epsilon} of ${expected}`);
}

const normalizedArrayKeys = [
  'instruments',
  'projects',
  'workflows',
  'workflowTemplates',
  'journalClubs',
  'papers',
  'paperExperimentLinks',
  'notebookEntries',
  'assays',
  'gelAnalyses',
  'samples',
  'messages'
];
[
  ['My Plasmid', 'My_Plasmid'],
  ['  spaced name  ', 'spaced_name'],
  ['A/B:C', 'A_B_C'],
  ['___abc___', 'abc'],
  ['a.b-c_d', 'a.b-c_d'],
  ['***', 'plasmid'],
  ['', 'plasmid'],
  [null, 'plasmid'],
  ['alpha beta gamma', 'alpha_beta_gamma'],
  ['中文', 'plasmid']
].forEach(([input, expected], idx) => {
  test(`[P1] sanitizeOutputName default fallback case ${idx + 1}`, () => {
    assert.equal(mainUtils.sanitizeOutputName(input), expected);
  });
});
test('[P1] sanitizeOutputName uses custom fallback when normalized output is empty', () => {
  assert.equal(mainUtils.sanitizeOutputName('***', 'fallback_name'), 'fallback_name');
});
[
  [' _pL ann!* ', '_pLann'],
  ['suffix-1', 'suffix-1'],
  ['A.B_C', 'A.B_C'],
  ['   ', ''],
  [null, '_pLann'],
  [undefined, '_pLann'],
  ['x/y:z', 'xyz'],
  ['"quoted"', 'quoted']
].forEach(([input, expected], idx) => {
  test(`[P1] sanitizeSuffix case ${idx + 1}`, () => {
    assert.equal(mainUtils.sanitizeSuffix(input), expected);
  });
});
[
  ['', ''],
  ['   ', ''],
  ['>already\nACGT\n', '>already\nACGT'],
  ['acgt', '>sequence\nACGT\n'],
  ['ac gt 123', '>sequence\nACGT\n'],
  ['n-n-n', '>sequence\nNNN\n'],
  ['abc!def', '>sequence\nABCDEF\n'],
  ['a'.repeat(80), `>sequence\n${'A'.repeat(80)}\n`],
  ['a'.repeat(81), `>sequence\n${'A'.repeat(80)}\nA\n`],
  ['a'.repeat(160), `>sequence\n${'A'.repeat(80)}\n${'A'.repeat(80)}\n`]
].forEach(([input, expected], idx) => {
  test(`[P0] normalizeSequenceInput case ${idx + 1}`, () => {
    assert.equal(mainUtils.normalizeSequenceInput(input), expected);
  });
});

const moduleExportContracts = [
  ['src/renderer/modules/agent-chat/index.js', 'initAgentChat', 'function'],
  ['src/renderer/modules/assay/index.js', 'initAssay', 'function'],
  ['src/renderer/modules/assay/analysis/index.js', 'analyzeAssayData', 'function'],
  ['src/renderer/modules/biology-notebook/index.js', 'initLabNotebook', 'function'],
  ['src/renderer/modules/buffer-compounds.js', 'BUFFER_COMPOUNDS', 'object'],
  ['src/renderer/modules/collaboration-management/index.js', 'initCollaborationManagement', 'function'],
  ['src/renderer/modules/gel/index.js', 'initGelAnalysis', 'function'],
  ['src/renderer/modules/lab-common-inventory/index.js', 'initLabCommonInventory', 'function'],
  ['src/renderer/modules/lab-management.js', 'initLabManagement', 'function'],
  ['src/renderer/modules/papers/index.js', 'initPapersManagement', 'function'],
  ['src/renderer/modules/personal-inventory/index.js', 'initPersonalInventory', 'function'],
  ['src/renderer/modules/biology-notebook/project-controller.js', 'createNotebookProjectController', 'function'],
  ['src/renderer/modules/protocol/index.js', 'initProtocolManagement', 'function'],
  ['src/renderer/modules/sample-registry/index.js', 'initSampleRegistry', 'function'],
  ['src/renderer/modules/settings/index.js', 'initSettings', 'function'],
  ['src/renderer/modules/tool-box.js', 'initToolBox', 'function'],
  ['src/renderer/modules/workflow/index.js', 'initWorkflowManagement', 'function']
];
moduleExportContracts.forEach(([relativePath, exportName, expectedType], idx) => {
  test(`[P1] module export contract case ${idx + 1} (${relativePath})`, () => {
    const loaded = loadEsmStyleModule(path.join(__dirname, relativePath));
    assert.equal(typeof loaded[exportName], expectedType);
  });
});

test('[P0] main-process modules do not import renderer UI or controller implementation files', () => {
  const rendererRoot = path.join(__dirname, 'src', 'renderer');
  const sequenceViewerAlgorithmsRoot = path.join(
    rendererRoot,
    'modules',
    'sequence-viewer',
    'algorithms'
  );
  const violations = [];
  listJavaScriptFiles(path.join(__dirname, 'src', 'main')).forEach((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const specifiers = [
      ...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
      ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
      ...source.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)
    ].map((match) => match[1]).filter((specifier) => specifier.startsWith('.'));
    specifiers.forEach((specifier) => {
      const resolved = path.resolve(path.dirname(filePath), specifier);
      const isSequenceViewerAlgorithm = resolved === sequenceViewerAlgorithmsRoot
        || resolved.startsWith(`${sequenceViewerAlgorithmsRoot}${path.sep}`);
      if (
        !isSequenceViewerAlgorithm
        && (resolved === rendererRoot || resolved.startsWith(`${rendererRoot}${path.sep}`))
      ) {
        violations.push(`${path.relative(__dirname, filePath)} -> ${specifier}`);
      }
    });
  });
  assert.deepEqual(violations, []);
});

test('[P1] renderer folder modules have no obsolete top-level compatibility entries', () => {
  [
    'agent-chat.js',
    'gel-analysis.js',
    'papers-management.js',
    'protocol-management.js',
    'sequence-viewer.js'
  ].forEach((fileName) => {
    assert.equal(fs.existsSync(path.join(__dirname, 'src', 'renderer', 'modules', fileName)), false);
  });
});

const removedCodeGuards = [
  ['src/renderer/modules/views.js', /LAB_NOTEBOOK/, false],
  ['src/main/lib/telegramBot.js', /telegram-message/, false],
  ['src/main/preload.js', /onTelegramMessage/, false],
  ['index.html', /lab-notebook-view/, false],
  ['src/renderer/renderer.js', /VIEWS\.LAB_NOTEBOOK/, false],
  ['forge.config.js', /hikari-data/, true],
  ['package.json', /"build:ui": "node scripts\/build-ui\.mjs"/, true],
  ['package.json', /"check:dom-ids": "node scripts\/check-dom-ids\.mjs"/, true],
  ['package.json', /"dist": "npm run build:ui && electron-forge make"/, true],
  ['package.json', /"package:app": "npm run build:ui && electron-forge package"/, true]
];
removedCodeGuards.forEach(([relativePath, pattern, shouldMatch], idx) => {
  test(`[P1] regression guard case ${idx + 1} (${relativePath})`, () => {
    const source = readSource(relativePath);
    assert.equal(pattern.test(source), shouldMatch);
  });
});

const indexHtmlSource = readSource('index.html');
const appRegistry = JSON.parse(fs.readFileSync(path.join(__dirname, 'ui', 'config', 'app-registry.json'), 'utf8'));
const sectionViews = new Set([...indexHtmlSource.matchAll(/<section id=\"([^\"]+)\" class=\"view\"/g)].map((match) => match[1]));
const navViews = new Set((appRegistry.apps || []).map((app) => app.viewId));
const nonHomeViews = Object.values(shared.VIEWS).filter((viewId) => viewId !== shared.VIEWS.HOME);
nonHomeViews.forEach((viewId) => {
  test(`[P0] index section exists for ${viewId}`, () => {
    assert.equal(sectionViews.has(viewId), true);
  });
});

const navExpectedViews = nonHomeViews.filter((viewId) => viewId !== shared.VIEWS.PERSONAL_INVENTORY);
navExpectedViews.forEach((viewId) => {
  test(`[P0] app registry entry exists for ${viewId}`, () => {
    assert.equal(navViews.has(viewId), true);
  });
});

Object.entries(shared.TITLES).forEach(([viewId, title], idx) => {
  test(`[P1] title text exists for mapped view case ${idx + 1} (${viewId})`, () => {
    assert.equal(typeof title, 'string');
    assert.ok(title.trim().length > 0);
  });
});

const extraInvalidValues = [null, undefined, '', '[]', 0, 1, true, false, () => 1, Symbol.for('x')];
normalizedArrayKeys.forEach((key) => {
  extraInvalidValues.forEach((value, idx) => {
    test(`[EDGE] normalizeState invalid type matrix ${key} case ${idx + 1}`, () => {
      const normalized = shared.normalizeState({ [key]: value });
      assert.equal(Array.isArray(normalized[key]), true);
      assert.equal(normalized[key].length, 0);
    });
  });
});
normalizedArrayKeys.forEach((key) => {
  [
    [{ id: `${key}-a` }],
    [{ id: `${key}-a` }, { id: `${key}-b` }],
    [1, 2, 3]
  ].forEach((value, idx) => {
    test(`[EDGE] normalizeState valid array matrix ${key} case ${idx + 1}`, () => {
      const normalized = shared.normalizeState({ [key]: value });
      if (key === 'papers' && idx < 2) {
        assert.equal(normalized[key].length, value.length);
        normalized[key].forEach((item, itemIndex) => {
          assert.equal(item.id, value[itemIndex].id);
          assert.equal(Array.isArray(item.comments), true);
          assert.equal(item.comments.length, 0);
        });
        return;
      }
      assert.deepEqual(normalized[key], value);
    });
  });
});
[
  '<script>',
  '<IMG SRC=x onerror=alert(1)>',
  '&already&escaped',
  'a"b"c',
  "apostrophe's test",
  '<<>>',
  '汉字<script>',
  '\nline\nbreak',
  '`code`',
  '<svg><path/></svg>',
  String.raw`slash\quote"combo`,
  '<a href="javascript:alert(1)">x</a>'
].forEach((input, idx) => {
  test(`[EDGE] safeText strips dangerous chars case ${idx + 1}`, () => {
    const output = shared.safeText(input);
    assert.equal(output.includes('<'), false);
    assert.equal(output.includes('>'), false);
  });
});
[
  '"',
  '\\',
  '\\"',
  'abc\\"def',
  'path\\to\\dir',
  'mix"and\\slash',
  '',
  'simple',
  '""""',
  '\\\\\\\\'
].forEach((input, idx) => {
  test(`[EDGE] cssEscape escapes quote/slash matrix case ${idx + 1}`, () => {
    const output = shared.cssEscape(input);
    assert.equal(/(^|[^\\])"/.test(output), false);
    assert.equal(output.includes('\\'), input.includes('\\') || input.includes('"'));
  });
});
[
  ['.json', true],
  ['.ena', true],
  ['file.', false],
  ['file..json', true],
  ['archive.tar.json', true],
  ['archive.tar.ena', true],
  [' spaced .json', true],
  ['a/b/c.ENA', true],
  ['A/B/C.Json', true],
  ['name\n.json', true],
  ['name\t.ena', true],
  ['sample.Json ', true],
  ['sample.Ena ', true],
  ['samplejson', false],
  ['sampleena', false],
  ['sample.jso', false],
  ['sample.en', false],
  ['sample.jpeg', false],
  ['sample.enaa', false],
  ['sample.jsonl', false],
  ['  ', false],
  ['a.🧪', false],
  ['A.JSON.BAK', false],
  ['a..ena', true],
  ['a..json', true],
  ['../relative/file.ena', true],
  ['../relative/file.json', true],
  ['C:\\temp\\file.json', true],
  ['C:\\temp\\file.ena', true],
  ['file.JSON\n', true]
].forEach(([input, expected], idx) => {
  test(`[EDGE] hasSupportedDataExtension extended case ${idx + 1}`, () => {
    assert.equal(mainUtils.hasSupportedDataExtension(input), expected);
  });
});

for (let length = 1; length <= 120; length += 3) {
  test(`[EDGE] normalizeSequenceInput wrap behavior len ${length}`, () => {
    const source = 'acgt'.repeat(Math.ceil(length / 4)).slice(0, length);
    const output = mainUtils.normalizeSequenceInput(source);
    const lines = output.trim().split('\n');
    assert.equal(lines[0], '>sequence');
    const seq = lines.slice(1).join('');
    assert.equal(seq, source.toUpperCase());
    lines.slice(1).forEach((line) => {
      assert.ok(line.length <= 80);
    });
  });
}
[
  ['>h\nacgt\nnn\n', '>h\nacgt\nnn'],
  ['>h\r\nACGT\r\n', '>h\r\nACGT'],
  ['>h\n', '>h'],
  ['>header with space\nACGT', '>header with space\nACGT'],
  ['>\nACGT', '>\nACGT']
].forEach(([input, expected], idx) => {
  test(`[EDGE] normalizeSequenceInput fasta passthrough case ${idx + 1}`, () => {
    assert.equal(mainUtils.normalizeSequenceInput(input), expected);
  });
});
  }
};
