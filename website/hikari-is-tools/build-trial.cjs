// Snapshot the desktop's generated HTML and browser assets; never edit app sources.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {SOURCE,copyFiles}=require('./trial-runtime.cjs');
// PDF.js in the browser trial: resolve its files inside runtime/ (the page's <base>) and keep
// its import native, since webpack cannot bundle an import from a computed URL.
function adaptPdfLoader(runtimeDir) {
  const file = path.join(runtimeDir, 'src/renderer/modules/papers/pdf-viewer/pdf-viewer-loader.js');
  let source = fs.readFileSync(file, 'utf8');
  for (const [from, to] of [
    ["if (typeof window === 'undefined' || !window.location?.href) {", "if (typeof document === 'undefined' || !document.baseURI) {"],
    ['return new URL(relativePath, window.location.href).href;', 'return new URL(relativePath, document.baseURI).href;'],
    ['import(buildViewerAssetUrl(', 'import(/* webpackIgnore: true */ buildViewerAssetUrl(']
  ]) {
    if (source.includes(from)) source = source.replace(from, to);
    else if (!source.includes(to)) throw new Error('pdf-viewer-loader.js changed; update the trial PDF adaptation.');
  }
  fs.writeFileSync(file, '// Browser trial adaptation: PDF.js loads from runtime/.\n' + source.replace(/^\/\/ Browser trial adaptation: PDF\.js loads from runtime\/\.\n/, ''));
}
async function buildTrial() {
const here = path.resolve(__dirname, '../hikari-is'), repo = path.resolve(__dirname, '../..');
// The complete desktop tree is temporary build input, never the vendored output.
const staging=fs.mkdtempSync(path.join(os.tmpdir(),'hikari-trial-build-'));
const runtime=path.join(staging,'runtime');
try {
fs.mkdirSync(runtime, { recursive: true });
for (const relative of ['src/renderer', 'src/shared', 'ui/css', 'vendor', 'assets', 'styles.css']) {
  fs.cpSync(path.join(repo, relative), path.join(runtime, relative), { recursive: true });
}
// Desktop plugins normally have their own loopback server. This trusted, bundled
// browser demo uses static URLs and a browser-only bridge instead of native IPC.
const originFile = path.join(runtime, 'src/renderer/app/plugin-origin.js');
fs.writeFileSync(originFile, `// Browser trial adaptation: only shipped plugin assets on this site's origin.\nexport function pluginOrigin(value) {\n  try { const url = new URL(value); return url.origin === location.origin && url.pathname.includes('/runtime/plugins/') ? url.origin : ''; } catch { return ''; }\n}\n`);
adaptPdfLoader(runtime);
let html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
html = html.replace(/<!-- AUTO-GENERATED FILE[\s\S]*?<!doctype html>/, '<!doctype html>');
html = html.replace(/<meta http-equiv="Content-Security-Policy"[\s\S]*?\/>/, `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'">`);
html = html.replace('<head>', '<head>\n  <base href="./runtime/">\n  <script src="../trial-core.js"></script>\n  <script src="../agent-scenes.js"></script>\n  <script src="../trial-adapter.js"></script>');
html = html.replace('<link rel="stylesheet" href="styles.css" />', '<link rel="stylesheet" href="styles.css" />\n  <link rel="stylesheet" href="../trial-app.css">');
// The website trial opens directly into its app window, without the desktop splash.
html = html.replace(/<div id="app-loading-cover"[\s\S]*?(?=<main id="storage-setup-page")/, '');
html = html.replace('<section id="home-view" class="view is-active" aria-label="Home">', '<section id="home-view" class="view" aria-label="Home" hidden>');
html = html.replace('<script src="./vendor/cropperjs/cropper.min.js"></script>', '<script src="../trial-entry.js"></script>\n  <script src="./vendor/cropperjs/cropper.min.js"></script>');
html = html.replace('src="src/renderer/renderer.js"', 'src="../trial-app.js"');
fs.writeFileSync(path.join(here, 'trial-app.html'), html);
const report=await require('./optimize-trial.cjs').optimizeTrial({runtimeDir:runtime});
copyFiles(runtime,SOURCE,report.snapshot);
console.log('Built browser trial; its bundled sources are kept in ../hikari-trial-source.');
} finally { fs.rmSync(staging,{recursive:true,force:true}); }
}
if(require.main===module)buildTrial().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={buildTrial};
