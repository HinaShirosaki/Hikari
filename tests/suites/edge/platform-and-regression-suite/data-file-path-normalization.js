module.exports = function registerPlatformAndRegressionSuiteDataFilePathNormalization(context = {}) {
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
  ['/tmp/name.', '/tmp/fallback.json', '/tmp/name..json'],
  ['/tmp/.hidden', '/tmp/fallback.json', '/tmp/.hidden.json'],
  ['/tmp/valid.ENA', '/tmp/fallback.json', '/tmp/valid.ENA'],
  ['/tmp/valid.Json', '/tmp/fallback.json', '/tmp/valid.Json'],
  ['/tmp/with spaces', '/tmp/fallback.ena', '/tmp/with spaces.json'],
  ['/tmp/multi.part.name', '/tmp/fallback.ena', '/tmp/multi.part.name.json'],
  ['  /tmp/trailing-space   ', '/tmp/fallback.ena', '/tmp/trailing-space.json'],
  ['', '/tmp/fallback.without.ext', '/tmp/fallback.without.ext.json'],
  [null, '/tmp/fallback.with.dot.', '/tmp/fallback.with.dot..json'],
  [undefined, '/tmp/only', '/tmp/only.json'],
  ['', '  ', ''],
  ['   ', '   ', '']
].forEach(([preferred, fallback, expected], idx) => {
  test(`[EDGE] normalizeDataFilePath extended case ${idx + 1}`, () => {
    assert.equal(mainUtils.normalizeDataFilePath(preferred, fallback), expected);
  });
});
  }
};
