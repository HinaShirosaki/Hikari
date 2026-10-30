// Prepare a source-backed Protein Builder capture page with fictional data only.
// Serve only the isolated capture directory and capture at 3840 × 2400.
// A 1600 × 1000 logical window at 2.4× keeps the seven-block chain in view.
const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(__dirname, '../..');
const output = path.join(repo, 'tmp/hikari-is-protein-builder');
const capture = path.join(output, 'capture');
// Illustrative antibody-domain sequences for the website demo; no antigen or
// experimentally validated binding/production claim is associated with this fixture.
const demoDomains = {
  VH: 'MEVQLVESGGGLVQPGGSLRLSCAASGFTFSSYAMSWVRQAPGKGLEWVSAISGSGGSTYYADSVKGRFTISRDNSKNTLYLQMNSLRAEDTAVYYCAAGGSGYFDYWGQGTLVTVSS',
  VL: 'DIQMTQSPSSLSASVGDRVTITCRASQSVSSYLAWYQQKPGKAPKLLIYAASTLQSGVPSRFSGSGSGTDFTLTISSLQPEDFATYYCQQSSYSPWTFGQGTKVEIK',
  Fc: 'DKTHTCPPCPAPELLGGPSVFLFPPKPKDTLMISRTPEVTCVVVDVSHEDPEVKFNWYVDGVEVHNAKTKPREEQYNSTYRVVSVLTVLHQDWLNGKEYKCKVSNKALPAPIEKTISKAKGQPREPQVYTLPPSRDELTKNQVSLTCLVKGFYPSDIAVEWESNGQPENNYKTTPPVLDSDGSFFLYSKLTVDKSRWQQGNVFSCSVMHEALHNHYTQKSLSLSPGK',
  VHH: 'QVQLVESGGGLVQAGGSLRLSCAASGFTFSSYAMGWFRQAPGKEREFVAAISSGGGSTYYADSVKGRFTISRDNAKNTVYLQMNSLKPEDTAVYYCAAGGSGSYDYWGQGTQVTVSS'
};
const demoProtein = Object.values(demoDomains).join('GGGGSGGGGSGGGGS');
const generated = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
const shell = generated.slice(generated.indexOf('<main class="app-shell">'), generated.indexOf('<!-- SOURCE: ui/html/views/home-view.html -->'));
const view = fs.readFileSync(path.join(repo, 'ui/html/views/sequence-viewer-view.html'), 'utf8').replace('class="view"', 'class="view is-active"');
const dockApps = [
  ['home', 'Home', 'home-view'], ['biology-notebook', 'Notebook', 'biology-notebook-view'],
  ['protocols', 'Protocols', 'protocol-management-view'], ['sequence-viewer', 'Sequences', 'sequence-viewer-view'],
  ['assay', 'Assays', 'assay-view'], ['sample-inventory', 'Inventory', 'sample-registry-view'],
  ['workflows', 'Workflows', 'workflow-management-view'], ['papers', 'Papers', 'papers-view'], ['settings', 'Settings', 'setting-view']
].map(([id, label, viewId]) => ({id, label, viewId, iconMarkup: fs.readFileSync(path.join(repo, 'assets/icons', id + '.svg'), 'utf8')}));
const script = `
  import {createSequenceViewerProteinBuilderController} from '/src/renderer/modules/sequence-viewer/protein-builder.js';
  import {getSequenceViewerElements} from '/src/renderer/modules/sequence-viewer/dom.js';
  import {cloneLibraryRow, createCustomRow} from '/src/renderer/modules/sequence-viewer/protein-builder/row-factory.js';
  import {translateDnaSequence} from '/src/renderer/modules/sequence-viewer/calculations/sequence.js';
  import {createAppDock} from '/src/renderer/app/navigation-shell/app-dock.js';
  const $ = id => document.getElementById(id);
  const elements = getSequenceViewerElements(document);
  elements.homeWorkspace.hidden = true;
  elements.proteinBuilderWorkspace.hidden = false;
  const controller = createSequenceViewerProteinBuilderController({elements,
    hasStoragePath: () => true, getStoragePath: () => '/demo/hikari'});
  controller.bindEvents();
  const domains = ${JSON.stringify(demoDomains)};
  controller.loadMcpConstruct({constructName: 'VH–VL–Fc–VHH', codonUsageProfile: 'human', rows: [
    createCustomRow(1, 'VH', domains.VH), cloneLibraryRow(2, 'linker', 'g4s3'),
    createCustomRow(3, 'VL', domains.VL), cloneLibraryRow(4, 'linker', 'g4s3'),
    createCustomRow(5, 'Fc', domains.Fc), cloneLibraryRow(6, 'linker', 'g4s3'),
    createCustomRow(7, 'VHH', domains.VHH)
  ]});
  const protein = elements.proteinBuilderSequence.value;
  const dna = elements.proteinBuilderDnaSequence.textContent.trim();
  if (protein !== ${JSON.stringify(demoProtein)} || dna.length !== protein.length * 3 || translateDnaSequence(dna).protein !== protein) {
    throw new Error('Demo protein and coding DNA do not match.');
  }
  if (elements.proteinBuilderCopyProteinBtn.disabled || elements.proteinBuilderCopyDnaBtn.disabled) {
    throw new Error('Both sequence copy controls must be available.');
  }
  const apps = ${JSON.stringify(dockApps)};
  const dock = createAppDock({documentObject: document, windowObject: window, TITLES: {}, dockNav: $('app-dock-nav'),
    appDockDivider: document.querySelector('.app-dock-divider'), moreBtn: $('app-more-btn'), moreMenu: $('app-more-menu'),
    expandedDockApps: apps, getActiveViewId: () => 'sequence-viewer-view', getAppForView: id => apps.find(a => a.viewId === id), resolveNavigationViewId: id => id});
  dock.renderAppNavigation(); dock.syncNavigationState('sequence-viewer-view');
  const lights = document.createElement('div'); lights.className = 'trial-window-controls'; lights.innerHTML = '<i></i><i></i><i></i>';
  document.querySelector('.topbar').prepend(lights); $('topbar-local-time').textContent = '09:41';
  await document.fonts.ready;
  document.body.dataset.captureReady = 'true';
`;
const html = `<!doctype html><html lang="en" data-capture="true" data-window-chrome="mac"><head><meta charset="utf-8"><title>Hikari · Protein Builder demo capture</title>
  <link rel="stylesheet" href="capture.css">
  <style>html,body{margin:0;overflow:hidden}html[data-capture="true"]:not([data-capture-density="native"]){zoom:2.4}html[data-capture="true"] .app-shell{height:1000px}body{--app-font-size:16px}</style>
  </head><body class="ui-neutral-compact sequence-viewer-fixed-scroll" data-trial-feature="protein-builder">${shell}${view}</section></div></main><script src="capture.js"></script></body></html>`;
async function prepare() {
  fs.mkdirSync(capture, {recursive: true});
  const entry = path.join(output, 'capture-entry.mjs');
  fs.writeFileSync(entry, script.replace(/from '(\/src\/[^']+)'/g, (_, file) => `from ${JSON.stringify(path.join(repo, file.slice(1)))}`));
  const webpack = require('webpack');
  await new Promise((resolve, reject) => {
    const compiler = webpack({mode: 'production', target: ['web', 'es2022'], devtool: false, entry,
      output: {path: capture, filename: 'capture.js'}, experiments: {topLevelAwait: true},
      module: {parser: {javascript: {url: false, dynamicImportMode: 'eager'}}}, performance: {hints: false}});
    compiler.run((error, stats) => compiler.close(() => error ? reject(error) : stats.hasErrors()
      ? reject(new Error(stats.toString({all: false, errors: true}))) : resolve()));
  });
  function copyAsset(file) {
    const relative = path.relative(repo, file);
    if (!relative.startsWith('assets' + path.sep)) throw new Error('Capture resources must be app assets: ' + relative);
    const target = path.join(capture, relative);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.copyFileSync(file, target);
    return relative.split(path.sep).join('/');
  }
  function flattenCss(file) {
    return fs.readFileSync(file, 'utf8').replace(/@import\s+url\(['"]([^'"]+)['"]\);/g,
      (_, relative) => flattenCss(path.resolve(path.dirname(file), relative)))
      .replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g, (whole, quote, url) => {
        if (/^(?:[a-z]+:|\/|#)/i.test(url) || url.startsWith('assets/')) return whole;
        return `url("${copyAsset(path.resolve(path.dirname(file), url))}")`;
      });
  }
  const styles = ['styles.css', 'website/hikari-is/trial-app.css', 'website/hikari-is/screenshot-capture.css']
    .map(file => flattenCss(path.join(repo, file))).join('\n');
  fs.writeFileSync(path.join(capture, 'capture.css'), styles);
  for (const [, file] of html.matchAll(/(?:src|href)="(?:\.\/)?(assets\/[^"?#]+)"/g)) copyAsset(path.join(repo, file));
  fs.writeFileSync(path.join(capture, 'index.html'), html);
  console.log('Prepared isolated capture folder: ' + capture);
}
prepare().catch(error => {console.error(error); process.exitCode = 1;});
