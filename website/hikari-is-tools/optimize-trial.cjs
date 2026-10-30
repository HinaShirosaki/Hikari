// Package the existing browser snapshot without changing desktop app sources.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const webpack = require('webpack');
const {SOURCE,MODULES,neededStyle,copyFiles,pruneRuntime}=require('./trial-runtime.cjs');
const here = path.resolve(__dirname, '../hikari-is');

async function optimizeTrial({runtimeDir=SOURCE}={}) {
  const runtime=path.resolve(runtimeDir);
  // CSV import is public here: it must read the quoted CSV the native exporter
  // writes, and preserve the sample-code uniqueness enforced by manual saving.
  const inventoryFile=path.join(runtime,'src/renderer/modules/personal-inventory/well-sample-events.js');
  let inventory=fs.readFileSync(inventoryFile,'utf8');
  if(!inventory.includes('HikariTrialModel.parseCsv')) {
    const begin=inventory.indexOf('  const lines = csvText.split('),end=inventory.indexOf('\n  ctx.uiState.wellEditorStatus = \'Imported samples',begin);
    if(begin<0 || end<0)throw new Error('Update the Trial CSV import adapter.');
    let importer=inventory.slice(begin,end);
    importer=importer.replace(/  const lines =[\s\S]*?  const header =[^\n]+;/,`  let rows;
  try { rows = window.HikariTrialModel.parseCsv(csvText); }
  catch (error) { ctx.uiState.wellEditorStatus = error.message; return; }
  if (rows.length < 2) { ctx.uiState.wellEditorStatus = 'CSV needs a header and at least one sample.'; return; }
  const header = rows[0].map(cell => cell.trim().toLowerCase());
  let imported = 0, skipped = 0;`)
      .replace("if (wellIndex < 0)","if (wellIndex < 0 || !header.includes('name'))")
      .replace('Import CSV needs a "well" column.','Import CSV needs "well" and "name" columns.')
      .replace("lines.slice(1).forEach((line) => {\n    const cells = line.split(',').map((cell) => cell.trim());","rows.slice(1).forEach((cells) => {")
      .replace('if (targetIndex < 0 || !name) {\n      return;', 'if (targetIndex < 0 || !name) {\n      skipped++; return;')
      .replace('    const sample = {',`    if (code && state.samples.some(sample => helpers.normalizeSampleCode(sample.code) === code)) { skipped++; return; }
    const sample = {`)
      .replace('    state.samples.push(sample);','    state.samples.push(sample); imported++;');
    inventory=inventory.slice(0,begin)+importer+inventory.slice(end);
    inventory=inventory.replace("ctx.uiState.wellEditorStatus = 'Imported samples from CSV.';","ctx.uiState.wellEditorStatus = `Imported ${imported} sample(s).${skipped ? ` Skipped ${skipped} row(s) with missing values, unknown wells, or duplicate codes.` : ''}`;");
    fs.writeFileSync(inventoryFile,inventory);
  }
  // Guard the native router itself, including callbacks that don't use dock links.
  const navigationFile=path.join(runtime,'src/renderer/app/navigation-shell.js');
  let navigation=fs.readFileSync(navigationFile,'utf8');
  if(!navigation.includes('HikariBrowserTrial?.allowsView')) {
    const anchor='const requestedView = normalize(viewId);';
    if(!navigation.includes(anchor))throw new Error('Update the Trial navigation boundary.');
    navigation=navigation.replace(anchor,anchor+'\n    if (windowObject.HikariBrowserTrial?.allowsView && !windowObject.HikariBrowserTrial.allowsView(requestedView)) return;');
    fs.writeFileSync(navigationFile,navigation);
  }
  // Browser-only access to the real controller's draft and validated DNA build.
  // Apply to full rebuilds as well as the frozen snapshot; desktop sources stay intact.
  const builderFile=path.join(runtime,'src/renderer/modules/sequence-viewer/protein-builder.js');
  let builder=fs.readFileSync(builderFile,'utf8');
  // The desktop loader treats the supplied name as its previous automatic
  // suggestion; use the chain suggestion so a restored custom name survives.
  builder=builder.replace("ctx.state.suggestedConstructName = payload.constructName || '';",'ctx.state.suggestedConstructName = ctx.getSuggestedConstructName();');
  if(!builder.includes('trialSnapshot:')) {
    if(!builder.includes('ctx.buildCurrentDnaSequence();') || !builder.includes('bindEvents: ctx.bindEvents,'))throw new Error('Update the Protein Builder trial adapter for the current controller.');
    builder=builder.replace('ctx.buildCurrentDnaSequence();','if (payload.buildDna !== false) ctx.buildCurrentDnaSequence();')
      .replace('bindEvents: ctx.bindEvents,',"trialSnapshot: () => ({...ctx.getProteinBuilderPayload(),buildDna:!!ctx.state.dnaConstruct?.ok}),\n    trialBuildDna: ctx.buildCurrentDnaSequence,\n    bindEvents: ctx.bindEvents,");
  }
  fs.writeFileSync(builderFile,builder);
  // Public DNA trials use the existing editor and cloning controller together.
  // Keep this browser facade out of the desktop module's source.
  const sequenceFile=path.join(runtime,'src/renderer/modules/sequence-viewer/index.js');
  let sequence=fs.readFileSync(sequenceFile,'utf8');
  if(!sequence.includes('trialSequence:')) {
    const entry='openAgentResult: mcpActions.openAction,';
    if(!sequence.includes(entry))throw new Error('Update the DNA Trial facade for the current controller.');
    sequence=sequence.replace(entry,`trialSequence: {
      snapshot: () => ({record: actions.getSelectedRecord(), source: state.sequenceEditDesignSource, state}),
      applyEdit: actions.applySequenceEdit,
      cloningDesign: controllers.cloningDesign,
      returnToDetail: actions.returnToSequenceDetailFromCloningDesign
    },
    ${entry}`);
    fs.writeFileSync(sequenceFile,sequence);
  }
  const manifestFile = path.join(runtime, 'src/renderer/module-manifests/index.js');
  const source = fs.readFileSync(manifestFile, 'utf8').replace(/(export const \w+ = await loadManifests\(\[)([\s\S]*?)(\]\);)/g,(_,start,entries,end)=> {
    const kept=[...entries.matchAll(/\['([^']+)', '([^']+)'\]/g)].filter(entry=>MODULES.has(entry[1].slice(2))).map(entry=>`  ['${entry[1]}', '${entry[2]}']`);
    return start+'\n'+kept.join(',\n')+'\n'+end;
  });
  fs.writeFileSync(manifestFile,source);
  const imports = [], groups = [];
  for (const match of source.matchAll(/export const (\w+) = await loadManifests\(\[([\s\S]*?)\]\);/g)) {
    const names = [];
    for (const entry of match[2].matchAll(/\['([^']+)', '([^']+)'\]/g)) {
      if (!MODULES.has(entry[1].slice(2))) continue;
      imports.push(`import { ${entry[2]} } from './src/renderer/module-manifests/${entry[1].slice(2)}';`);
      names.push(entry[2]);
    }
    groups.push(`export const ${match[1]} = [${names.join(', ')}];`);
  }
  if (!groups.length) throw new Error('The snapshot manifest format changed; rebuild the Trial manifest adapter.');
  const generated = path.join(runtime, 'trial-manifests.js');
  fs.writeFileSync(generated, '// Generated by optimize-trial.cjs.\n' + imports.join('\n') + '\n' + groups.join('\n') + '\n' + source.slice(source.indexOf('export const rendererModuleManifests')));
  const calculationManifests = path.join(runtime, 'trial-calculations-manifests.js');
  fs.writeFileSync(calculationManifests, `// Generated by optimize-trial.cjs. Worksheet dependencies only.
import { biologyNotebookManifest } from './src/renderer/module-manifests/biology-notebook.js';
import { protocolManifest } from './src/renderer/module-manifests/protocol.js';
export const rendererModuleManifests = [biologyNotebookManifest, protocolManifest];
`);
  // The navigation shell may ask an absent Agent rail to render. Public
  // worksheets have no Agent module; its shell callback must remain optional.
  const moduleRuntimeFile=path.join(runtime,'src/renderer/core/module-runtime.js');
  fs.writeFileSync(moduleRuntimeFile,fs.readFileSync(moduleRuntimeFile,'utf8')
    .replace('() => modules.agentChatRail.render()', '() => modules.agentChatRail?.render?.()'));
  const aliases={[manifestFile]:generated};
  // Build refreshes in a temporary snapshot; the website entry still imports ./runtime/.
  const entrySource=fs.readFileSync(path.join(here,'trial-app.js'),'utf8');
  for(const [,specifier] of entrySource.matchAll(/from\s+['"](\.\/runtime\/[^'"]+)['"]/g))aliases[specifier]=path.join(runtime,specifier.slice('./runtime/'.length));
  const stats = await new Promise((resolve, reject) => {
    const config = {
      mode: 'production', target: ['web', 'es2022'], devtool: false,
      entry: [path.join(runtime, 'src/renderer/bootstrap/index-shell.js'), path.join(here, 'trial-app.js')],
      output: { path: runtime, filename: 'trial-bundle.js', publicPath: './', clean: false },
      experiments: { topLevelAwait: true },
      resolve: { alias: aliases },
      module: { parser: { javascript: { url: false, dynamicImportMode: 'eager' } } },
      optimization: { splitChunks: false, runtimeChunk: false },
      performance: { hints: false }
    };
    const compiler = webpack([
      {...config, plugins:[new webpack.DefinePlugin({__HIKARI_TRIAL_CALCULATIONS_ONLY__: 'false'})]},
      {...config, name:'calculations',
        output:{...config.output,filename:'trial-calculations.js'},
        resolve:{alias:{...aliases,[manifestFile]:calculationManifests}},
        plugins:[new webpack.DefinePlugin({__HIKARI_TRIAL_CALCULATIONS_ONLY__: 'true'})]}
    ]);
    compiler.run((error, result) => compiler.close(() => {
      if (error) reject(error);
      else if (result.hasErrors()) reject(new Error(result.toString({all:false,errors:true,errorDetails:true})));
      else resolve(result);
    }));
  });

  const cssFiles = new Set();
  function flattenCss(file, ancestors = []) {
    if (ancestors.includes(file)) throw new Error(`Circular stylesheet import: ${file}`);
    cssFiles.add(file);
    // Rewrite this file's asset URLs before inlining child stylesheets.
    const css = fs.readFileSync(file, 'utf8').replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g, (whole, quote, url) => {
      if (/^(?:[a-z]+:|\/|#)/i.test(url) || url.endsWith('.css')) return whole;
      return `url("${path.relative(runtime, path.resolve(path.dirname(file), url)).split(path.sep).join('/')}")`;
    });
    return css.replace(/@import\s+url\(['"]([^'"]+)['"]\);/g, (_, relative) => {
      const child=path.resolve(path.dirname(file),relative);
      return neededStyle(child) ? flattenCss(child,[...ancestors,file]) : '';
    });
  }
  // Keep the snapshot's import manifest valid after pruning unused view styles.
  const styleManifest=path.join(runtime,'styles.css');
  fs.writeFileSync(styleManifest,fs.readFileSync(styleManifest,'utf8').replace(/@import\s+url\(['"]([^'"]+)['"]\);/g,(whole,relative)=>neededStyle(path.resolve(runtime,relative)) ? whole : ''));
  fs.writeFileSync(path.join(runtime, 'trial-styles.css'), flattenCss(path.join(runtime, 'styles.css')));
  const fingerprint = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(runtime,file))).digest('hex').slice(0,12);
  let html = fs.readFileSync(path.join(here, 'trial-app.html'), 'utf8');
  // The embedded app shell is not a separate search landing page.
  if (!/<meta name="robots"/.test(html)) html = html.replace('<head>', '<head>\n  <meta name="robots" content="noindex">');
  // Use the website's transparent gold mark in Trial too; a dark tile makes
  // Safari add a pale frame, even when the tile is fully opaque.
  html=html.replace(/<link rel="icon"[^>]*>(?:\s*<link rel="icon"[^>]*>)*/,
'<link rel="icon" type="image/x-icon" sizes="16x16 24x24 32x32 48x48 64x64 128x128 256x256" href="../favicon-mark.ico?v=mark-20261029">\n  <link rel="icon" type="image/png" sizes="16x16" href="../favicon-mark-16.png?v=mark-20261029">\n  <link rel="icon" type="image/png" sizes="32x32" href="../favicon-mark-32.png?v=mark-20261029">\n  <link rel="icon" type="image/svg+xml" sizes="any" href="../favicon.svg?v=transparent-vector-1">');
  if (!/src="\.\.\/trial-boot\.js(?:\?[^\"]*)?"/.test(html)) html = html.replace('<script src="../trial-core.js"></script>', '<script src="../trial-core.js"></script>\n  <script src="../trial-boot.js"></script>');
  html = html.replace(/<script type="module" src="src\/renderer\/bootstrap\/index-shell.js"><\/script>/, '');
  // Only the Agent chart screenshot uses Plotly; trial-entry.js loads it there.
  html = html.replace(/\s*<script src="\.\/vendor\/plotly\/plotly\.min\.js"><\/script>/, '');
  // Notebook PDF export/print need jsPDF; the Trial hides them (trial-app.css) to skip 420 KB at startup.
  html = html.replace(/\s*<script src="\.\/vendor\/jspdf\.umd\.min\.js"><\/script>/, '');
  // trial-launch.js loads Tabulator, or trial-grid.js for the public worksheet.
  html = html.replace(/\s*<script src="\.\/vendor\/tabulator\/tabulator\.min\.js"><\/script>/, '');
  html = html.replace(/href="(?:styles|trial-styles)\.css(?:\?[^\"]*)?"/, `href="trial-styles.css?v=${fingerprint('trial-styles.css')}"`);
  const appStyleVersion=crypto.createHash('sha256').update(fs.readFileSync(path.join(here,'trial-app.css'))).digest('hex').slice(0,12);
  html=html.replace(/href="\.\.\/trial-app\.css(?:\?[^\"]*)?"/,`href="../trial-app.css?v=${appStyleVersion}"`);
  const gridVersion=crypto.createHash('sha256').update(fs.readFileSync(path.join(here,'trial-grid.js'))).digest('hex').slice(0,12);
  const launchTag=`<script src="../trial-launch.js" data-default-bundle="trial-bundle.js?v=${fingerprint('trial-bundle.js')}" data-calculations-bundle="trial-calculations.js?v=${fingerprint('trial-calculations.js')}" data-tabulator="./vendor/tabulator/tabulator.min.js" data-grid="../trial-grid.js?v=${gridVersion}"></script>`;
  // The launcher sits in <head>, before the stylesheets, so the bundle downloads alongside them.
  html = html.replace(/\s*<script(?: type="module")? src="(?:\.\.\/trial-app\.js|trial-bundle\.js(?:\?[^\"]*)?|\.\.\/trial-launch\.js(?:\?[^\"]*)?)"[^>]*><\/script>/,'');
  html = html.replace(/<script src="\.\.\/trial-adapter\.js(?:\?[^\"]*)?"><\/script>/,adapter=>`${adapter}\n  ${launchTag}`);
  function versionSiteScripts(markup,files,prefix='') {
    for(const file of files) {
      const version=crypto.createHash('sha256').update(fs.readFileSync(path.join(here,file))).digest('hex').slice(0,12);
      const source=prefix+file, pattern=new RegExp('src="'+source.replaceAll('.', '\\.')+'(?:\\?[^\"]*)?"','g');
      markup=markup.replace(pattern,`src="${source}?v=${version}"`);
    }
    return markup;
  }
  html=versionSiteScripts(html,['trial-core.js','trial-boot.js','trial-adapter.js','trial-entry.js','trial-launch.js'],'../');
  fs.writeFileSync(path.join(here, 'trial-app.html'), html);
  // Safari isolates file iframes. A parser-inserted classic script can build
  // the same app in srcdoc, which inherits the landing page's origin. Hosted
  // visitors keep using trial-app.html and never download this file fallback.
  fs.writeFileSync(path.join(here,'trial-file-frame.js'),
    '// Generated by optimize-trial.cjs from trial-app.html. File previews only.\n'
    +'window.HikariTrialFrameParams = new URL(document.currentScript.src).search;\n'
    +`document.write(${JSON.stringify(html)});\n`);
  const pageFile=path.join(here,'index.html');
  let page=versionSiteScripts(fs.readFileSync(pageFile,'utf8'),['trial-core.js','trial-guide.js','trial.js']);
  for(const file of ['trial.css','trial-guide.css']) {
    const version=crypto.createHash('sha256').update(fs.readFileSync(path.join(here,file))).digest('hex').slice(0,12);
    const pattern=new RegExp('href="'+file.replaceAll('.', '\\.')+'(?:\\?[^\"]*)?"','g');
    page=page.replace(pattern,`href="${file}?v=${version}"`);
  }
  fs.writeFileSync(pageFile,page);
  const report = { modules: stats.stats[0].compilation.modules.size, stylesheets: cssFiles.size, scriptBytes:fs.statSync(path.join(runtime,'trial-bundle.js')).size,
    calculationModules:stats.stats[1].compilation.modules.size, calculationScriptBytes:fs.statSync(path.join(runtime,'trial-calculations.js')).size, styleBytes:fs.statSync(path.join(runtime,'trial-styles.css')).size,
    entryHash:crypto.createHash('sha256').update(fs.readFileSync(path.join(here,'trial-app.js'))).digest('hex') };
  fs.writeFileSync(path.join(__dirname,'trial-build.json'),JSON.stringify(report,null,2)+'\n');
  console.log('Trial bundled:',report);
  const runtimeReport=await pruneRuntime(runtime,{sourceFiles:new Set(stats.stats.flatMap(build=>[...build.compilation.fileDependencies])),cssFiles,html,reportFile:path.join(__dirname,'trial-runtime-manifest.json')});
  copyFiles(runtime,path.join(here,'runtime'),runtimeReport.files);
  return runtimeReport;
}
module.exports = { optimizeTrial };
if (require.main === module) optimizeTrial().catch(error => { console.error(error); process.exitCode=1; });
