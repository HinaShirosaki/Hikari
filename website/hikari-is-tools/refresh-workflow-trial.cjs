// Refresh only Workflow in the frozen Trial. Preserve the other demos' source versions.
const fs = require('node:fs');
const path = require('node:path');
const {init, parse} = require('es-module-lexer');
const {SOURCE} = require('./trial-runtime.cjs');
const {optimizeTrial} = require('./optimize-trial.cjs');
const REPO = path.resolve(__dirname,'../..');
async function refreshWorkflowTrial() {
  await init;
  const queue=['src/renderer/module-manifests/workflow.js'], seen=new Set();
  for(let i=0;i<queue.length;i++) {
    const relative=queue[i];
    if(seen.has(relative))continue;
    seen.add(relative);
    const target=path.join(SOURCE,relative);
    const owned=relative.startsWith('src/renderer/modules/workflow/') || relative==='src/renderer/module-manifests/workflow.js';
    if(owned || !fs.existsSync(target)) {
      fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.copyFileSync(path.join(REPO,relative),target);
    }
    const [imports]=parse(fs.readFileSync(target,'utf8'));
    for(const dependency of imports) if(dependency.n?.startsWith('.'))queue.push(path.relative(SOURCE,path.resolve(path.dirname(target),dependency.n)));
  }
  const manifests=path.join(SOURCE,'src/renderer/module-manifests/index.js');
  let source=fs.readFileSync(manifests,'utf8');
  if(!source.includes("['./workflow.js'"))source=source.replace("['./settings.js', 'settingsManifest']","['./workflow.js', 'workflowManagementManifest'],\n  ['./settings.js', 'settingsManifest']");
  fs.writeFileSync(manifests,source);
  const styleManifest=path.join(SOURCE,'styles.css');
  let styles=fs.readFileSync(styleManifest,'utf8');
  for(const file of ['workflow-management-view.css','workflow-shell-overrides.css']) {
    const relative='ui/css/views/'+file;
    fs.copyFileSync(path.join(REPO,relative),path.join(SOURCE,relative));
    if(!styles.includes(relative))styles+=`\n@import url("./${relative}");\n`;
  }
  fs.writeFileSync(styleManifest,styles);
  const page=path.resolve(__dirname,'../hikari-is/trial-app.html');
  const markup=fs.readFileSync(path.join(REPO,'ui/html/views/workflow-management-view.html'),'utf8').trim();
  const html=fs.readFileSync(page,'utf8');
  const section=/<!-- SOURCE: ui\/html\/views\/workflow-management-view\.html -->[\s\S]*?(?=<!-- SOURCE:)/;
  if(!section.test(html))throw new Error('The Trial is missing the Workflow HTML insertion point.');
  fs.writeFileSync(page,html.replace(section,'<!-- SOURCE: ui/html/views/workflow-management-view.html -->\n'+markup+'\n\n'));
  console.log(`Workflow refresh traced ${seen.size} source dependencies; existing shared files preserved.`);
  await optimizeTrial();
}
if(require.main===module)refreshWorkflowTrial().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={refreshWorkflowTrial};
