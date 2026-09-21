// Bug-catching lint only. This is deliberately not a style config: the codebase
// is ~186k lines with no formatting history, so anything that reflows code would
// bury real findings under a rewrite.
//
// `no-undef` is off for src/ because it needs a full globals map for three
// environments (Node main, browser renderer, worker) to be useful rather than
// noisy; the test suite catches undefined identifiers quickly anyway. It is on
// for tests/, which are plain Node: each suite destructures what it needs from
// the harness `scope`, so a missing binding is a lint error, not a runtime
// ReferenceError. `no-unused-vars` is the rule that earns its keep here -- it
// finds dead code that tests cannot see.

import globals from 'globals';

const rules = {
  'no-unused-vars': ['error', {
    args: 'after-used',
    argsIgnorePattern: '^_',
    caughtErrors: 'none',
    // `const { drop, ...rest } = obj` is the omit idiom, not a dead binding.
    ignoreRestSiblings: true
  }],
  'no-cond-assign': 'error',
  'no-compare-neg-zero': 'error',
  'no-const-assign': 'error',
  'no-dupe-args': 'error',
  'no-dupe-class-members': 'error',
  'no-dupe-keys': 'error',
  'no-duplicate-case': 'error',
  'no-fallthrough': 'error',
  'no-func-assign': 'error',
  'no-self-assign': 'error',
  'no-sparse-arrays': 'error',
  'no-unreachable': 'error',
  'getter-return': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error'
};

export default [
  {
    ignores: [
      'src/plugins/*/vendor/**',   // vendored third-party + snapshot of app code
      'vendor/**',
      '**/*.generated.js',         // written by npm run build:ui
      'src/renderer/modules/views.js',
      'tests/tmp/**',
      'tests/fixtures/**'
    ]
  },
  {
    // Renderer is ESM.
    files: ['**/*.js'],
    // 2025 for import attributes (`with { type: 'json' }`).
    languageOptions: { ecmaVersion: 2025, sourceType: 'module' },
    // Directives left by a previous airbnb-style setup (no-await-in-loop,
    // no-nested-ternary) document intent for rules this config does not enable.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules
  },
  {
    // Test suites and the harness are CommonJS Node scripts.
    files: ['tests/**/*.js', 'test.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: globals.node },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: { ...rules, 'no-undef': ['error', { typeof: true }] }
  },
  {
    // Main process, shared, and the Sequence Viewer's Node-only half are CommonJS.
    files: [
      'src/main/**/*.js',
      'src/shared/**/*.js',
      'src/renderer/modules/sequence-viewer/main-process/**/*.js'
    ],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs' },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules
  }
];
