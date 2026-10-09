module.exports = function registerPlatformAndRegressionSuiteModuleBoundaryGuards(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  const { assert, fs, path, loadEsmStyleModule, test } = scope;
function listJavaScriptFiles(rootPath) {
  return fs.readdirSync(rootPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      return listJavaScriptFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith('.js') ? [entryPath] : [];
  });
}

const moduleExportContracts = [
  ['src/renderer/modules/agent-chat/index.js', 'initAgentChat', 'function'],
  ['src/renderer/modules/assay/index.js', 'initAssay', 'function'],
  ['src/renderer/modules/assay/analysis/index.js', 'analyzeAssayData', 'function'],
  ['src/renderer/modules/biology-notebook/index.js', 'initLabNotebook', 'function'],
  ['src/renderer/lib/chemistry/buffer-compounds.js', 'BUFFER_COMPOUNDS', 'object'],
  ['src/plugins/gel/workspace/index.js', 'initGelAnalysis', 'function'],
  ['src/renderer/modules/lab-common-inventory/index.js', 'initLabCommonInventory', 'function'],
  ['src/renderer/modules/papers/index.js', 'initPapersManagement', 'function'],
  ['src/renderer/modules/personal-inventory/index.js', 'initPersonalInventory', 'function'],
  ['src/renderer/modules/biology-notebook/project/project-controller.js', 'createNotebookProjectController', 'function'],
  ['src/renderer/modules/protocol/index.js', 'initProtocolManagement', 'function'],
  ['src/renderer/modules/settings/index.js', 'initSettings', 'function'],
  ['src/renderer/modules/tool-box/index.js', 'initToolBox', 'function'],
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
  const rendererSequenceViewerRoot = path.join(rendererRoot, 'modules', 'sequence-viewer');
  const mainProcessSequenceViewerRoot = path.join(rendererSequenceViewerRoot, 'main-process');
  const sequenceViewerAlgorithmsRoot = path.join(
    rendererSequenceViewerRoot,
    'algorithms'
  );
  const sequenceViewerParserPath = path.join(rendererSequenceViewerRoot, 'parsing.js');
  const violations = [];
  const inspectedFiles = [
    ...listJavaScriptFiles(path.join(__dirname, 'src', 'main')),
    ...listJavaScriptFiles(mainProcessSequenceViewerRoot)
  ];
  inspectedFiles.forEach((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const specifiers = [
      ...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
      ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
      ...source.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
      ...source.matchAll(/\bpath\.resolve\(\s*__dirname\s*,\s*['"]([^'"]+)['"]\s*\)/g)
    ].map((match) => match[1]).filter((specifier) => specifier.startsWith('.'));
    specifiers.forEach((specifier) => {
      const resolved = path.resolve(path.dirname(filePath), specifier);
      const isMainProcessSequenceViewerFile = filePath === mainProcessSequenceViewerRoot
        || filePath.startsWith(`${mainProcessSequenceViewerRoot}${path.sep}`);
      const isMainProcessSequenceViewerTarget = resolved === mainProcessSequenceViewerRoot
        || resolved.startsWith(`${mainProcessSequenceViewerRoot}${path.sep}`);
      const isAllowedSequenceViewerDomainDependency = isMainProcessSequenceViewerFile && (
        resolved === sequenceViewerParserPath
        || resolved === sequenceViewerAlgorithmsRoot
        || resolved.startsWith(`${sequenceViewerAlgorithmsRoot}${path.sep}`)
      );
      if (
        !isMainProcessSequenceViewerTarget
        && !isAllowedSequenceViewerDomainDependency
        && (resolved === rendererRoot || resolved.startsWith(`${rendererRoot}${path.sep}`))
      ) {
        violations.push(`${path.relative(__dirname, filePath)} -> ${specifier}`);
      }
    });
  });
  assert.deepEqual(violations, []);
});

};
