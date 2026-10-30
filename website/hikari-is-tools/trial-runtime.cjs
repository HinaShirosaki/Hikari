// The website's module boundary, shared by refresh, bundling, and validation.
const fs = require('node:fs');
const path = require('node:path');
const { init, parse } = require('es-module-lexer');

// Frozen desktop sources the bundle is built from. They stay out of the website
// folder: the browser loads only the bundle and the files listed in the manifest.
const SOURCE = path.resolve(__dirname, '../hikari-trial-source');
const MODULES = new Set([
  'biology-notebook.js', 'protocol.js', 'agent-chat-rail.js', 'papers.js',
  'personal-inventory.js', 'sample-registry.js', 'assay.js',
  'sequence-viewer.js', 'workflow.js', 'settings.js'
]);
const UNUSED_STYLES = /\/ui\/css\/views\/(?:home-view|tool-box(?:-palette|-view)?|lab-common-inventory-view)(?:\.css|\/)/;
function neededStyle(file) { return !UNUSED_STYLES.test(file.split(path.sep).join('/')); }
function filesIn(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, {withFileTypes:true}).flatMap(entry => {
    const file=path.join(dir,entry.name);
    return entry.isDirectory() ? filesIn(file) : [file];
  });
}
function copyFiles(from, to, files) {
  fs.rmSync(to,{recursive:true,force:true});
  for (const relative of files) {
    fs.mkdirSync(path.dirname(path.join(to,relative)),{recursive:true});
    fs.copyFileSync(path.join(from,relative),path.join(to,relative));
  }
}

// Keep webpack's actual source graph plus resources loaded outside its bundle,
// such as stylesheet URLs. PDF.js and Plotly are not shipped (see capture-scenes.cjs).
// Bundled sources stay in the snapshot only; everything else is served.
async function pruneRuntime(runtime, {sourceFiles, cssFiles, html, reportFile}) {
  await init;
  const before=filesIn(runtime), keep=new Set(), served=new Set(), queue=[];
  const inside=file=>file.startsWith(runtime+path.sep);
  function add(file, serve=true) {
    file=path.resolve(file);
    if (!inside(file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return;
    // A bundled file that the browser also loads natively is served, and so are its imports.
    if (serve && !served.has(file)) { served.add(file); if (keep.has(file)) queue.push(file); }
    if (!keep.has(file)) { keep.add(file); queue.push(file); }
  }
  for (const file of sourceFiles) add(file,false);
  for (const file of cssFiles) add(file,false);
  for (const file of ['trial-manifests.js','styles.css','src/renderer/module-manifests/index.js']) add(path.join(runtime,file),false);
  for (const file of ['trial-bundle.js','trial-calculations.js','trial-styles.css','vendor/tabulator/tabulator.min.js']) add(path.join(runtime,file));
  // Stylesheet and module imports follow their importer; other references are fetched at runtime.
  function resource(value, base, serve=true) {
    if (!value || /^(?:[a-z]+:|\/|#|data:)/i.test(value)) return;
    add(path.resolve(base,value.split(/[?#]/)[0]),serve);
  }
  function markup(text, base, serve) {
    for (const [,value] of text.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)) resource(value,base);
    for (const [,value] of text.matchAll(/url\(\s*["']?([^\s)'";]+)["']?\s*\)/g)) resource(value,base,serve || !/\.css$/i.test(value));
  }
  markup(html,runtime,true); // trial-app.html uses runtime/ as its <base>.
  for (let index=0;index<queue.length;index++) {
    const file=queue[index], ext=path.extname(file), serve=served.has(file);
    if (!['.js','.mjs','.css','.html'].includes(ext)) continue;
    // Bundles/libraries are already complete; follow our source imports.
    const text=fs.readFileSync(file,'utf8');
    if (ext==='.css' || ext==='.html') markup(text,path.dirname(file),serve);
    if (file.includes(`${path.sep}src${path.sep}`)) {
      if (ext==='.js' || ext==='.mjs') {
        const [imports]=parse(text);
        for (const dependency of imports) if (dependency.n?.startsWith('.')) resource(dependency.n,path.dirname(file),serve);
      }
      for (const [,value] of text.matchAll(/["']((?:\.\/)?assets\/[^"']+)["']/g)) resource(value,runtime);
    }
  }
  // Preserve license notices for every retained third-party resource family.
  for (const file of before) if (/LICENSE|COPYING|NOTICE/i.test(path.basename(file))) {
    const parent=path.dirname(file)+path.sep;
    if ([...keep].some(used=>used.startsWith(parent))) add(file,[...served].some(used=>used.startsWith(parent)));
  }
  const removed=before.filter(file=>!keep.has(file));
  const size=files=>[...files].reduce((sum,file)=>sum+fs.statSync(file).size,0);
  const relative=files=>[...files].map(file=>path.relative(runtime,file).split(path.sep).join('/')).sort();
  for (const file of removed) fs.unlinkSync(file);
  function removeEmpty(dir) {
    for (const entry of fs.readdirSync(dir,{withFileTypes:true})) if(entry.isDirectory())removeEmpty(path.join(dir,entry.name));
    if (dir!==runtime && !fs.readdirSync(dir).length)fs.rmdirSync(dir);
  }
  removeEmpty(runtime);
  const report={modules:[...MODULES],files:relative(served),bytes:size(served)};
  fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');
  console.log(`Runtime: ${before.length} → ${keep.size} snapshot files (${removed.length} unused removed); ${served.size} served, ${(report.bytes/1048576).toFixed(1)} MiB.`);
  return {...report,snapshot:relative(keep)};
}

module.exports={SOURCE,MODULES,neededStyle,filesIn,copyFiles,pruneRuntime};
