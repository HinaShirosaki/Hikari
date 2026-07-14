module.exports = function registerPlatformAndRegressionSuitePart03(context = {}) {
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
[
  ['a'.repeat(120), 'a'.repeat(120)],
  ['a b c d e', 'a_b_c_d_e'],
  ['___', 'plasmid'],
  ['.....', '.....'],
  ['abc/def?ghi', 'abc_def_ghi'],
  [' leading-and-trailing ', 'leading-and-trailing'],
  ['UPPER lower MIXED', 'UPPER_lower_MIXED'],
  ['multiple   spaces', 'multiple_spaces'],
  ['name-with-dash', 'name-with-dash'],
  ['name_with_underscore', 'name_with_underscore'],
  ['name.with.dot', 'name.with.dot'],
  ['$', 'plasmid'],
  ['\n\t', 'plasmid'],
  ['__alpha__beta__', 'alpha__beta'],
  ['A/B\\C:D*E?F"G<H>I|J', 'A_B_C_D_E_F_G_H_I_J']
].forEach(([input, expected], idx) => {
  test(`[EDGE] sanitizeOutputName extended case ${idx + 1}`, () => {
    assert.equal(sequenceMainUtils.sanitizeOutputName(input), expected);
  });
});
[
  ['_alpha', '_alpha'],
  [' alpha beta ', 'alphabeta'],
  ['-x-y-z-', '-x-y-z-'],
  ['A.B.C', 'A.B.C'],
  ['A/B/C', 'ABC'],
  ['***suffix***', 'suffix'],
  ['123', '123'],
  ['__', '__'],
  ['\nA\tB\r', 'AB'],
  ['汉字', ''],
  [Symbol.for('x'), 'Symbolx']
].forEach(([input, expected], idx) => {
  test(`[EDGE] sanitizeSuffix extended case ${idx + 1}`, () => {
    assert.equal(sequenceMainUtils.sanitizeSuffix(input), expected);
  });
});
  }
};
