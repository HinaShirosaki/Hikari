// Capture current renderer modules. No installed workspace or native bridge is used.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'../../..');
if(!process.versions.electron){const r=require('node:child_process').spawnSync(require(path.join(root,'node_modules/electron')),[__filename,...process.argv.slice(2)],{stdio:'inherit',env:{...process.env,TZ:'America/Chicago'},timeout:120000});process.exit(r.status??1);}
const {app,BrowserWindow,screen}=require('electron');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'hikari-hero-modules-'));
app.setPath('userData',path.join(scratch,'profile'));app.setPath('sessionData',path.join(scratch,'session'));app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 await app.whenReady();
 const captureZoom=4/screen.getPrimaryDisplay().scaleFactor;
 let html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script type="module" src="src\/renderer\/renderer.js"><\/script>/,'').replace('</head>','<style>:root {--shared-left-rail-width:380px!important;} #app-loading-cover, #storage-setup-page {display:none!important;}</style></head>');
 // Resolve all assets from the disposable page without changing the app's CSP.
 for(const folder of ['vendor','src','assets','plugins','ui']) fs.symlinkSync(path.join(root,folder),path.join(scratch,folder),'junction');
 fs.symlinkSync(path.join(root,'styles.css'),path.join(scratch,'styles.css'));
 const file=path.join(scratch,'index.html');fs.writeFileSync(file,html);
 const win=new BrowserWindow({width:Math.round(1600*captureZoom),height:Math.round(940*captureZoom),useContentSize:true,show:false,webPreferences:{offscreen:true,zoomFactor:captureZoom,sandbox:true,contextIsolation:true,backgroundThrottling:false}});
 win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,done)=>done({cancel:true}));
 win.webContents.on('console-message',(_,level,message)=>{if(level>=3)console.error(message.slice(0,400));});
 win.webContents.setZoomFactor(captureZoom);
 await win.loadFile(file);
 const pdfs={};for(const [key,name]of [['alphafold','alphafold'],['chemistry','click-chemistry']]){const p=path.join(process.env.HIKARI_HERO_PAPERS || '/tmp/hikari-hero-papers',name+'.pdf');if(fs.existsSync(p)&&fs.readFileSync(p).subarray(0,4).toString()==='%PDF') pdfs[key]='data:application/pdf;base64,'+fs.readFileSync(p).toString('base64');}
 if(!pdfs.alphafold && (!process.argv.slice(2).length || process.argv.includes('papers'))) throw Error('Provide alphafold.pdf in HIKARI_HERO_PAPERS before recapturing Papers.');
 // Keep fixture data off localStorage's small quota; put PDFs into state after boot.
 const init=pathToFileURL(path.join(__dirname,'hero-module-fixture.mjs')).href;
 await win.webContents.executeJavaScript(`import(${JSON.stringify(init)}).then(m=>m.initHeroModules()).then(()=>true)`);
 await win.webContents.executeJavaScript(`heroCore.state.papers.forEach(p=>{p.pdfDataUrl=${JSON.stringify(pdfs)}[p.id==='hero-alphafold'?'alphafold':'chemistry'];});`);
 const evaluate=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`);
 const only=new Set(process.argv.slice(2));
 const capture=async(name,code)=>{
   if(only.size&&!only.has(name))return;
   await evaluate(code);await pause(900);await evaluate("document.getElementById('topbar-local-time').textContent='10:30';");await evaluate('await document.fonts.ready;');
   const info=await evaluate(`return {active:document.body.dataset.activeView,text:document.querySelector('.view.is-active')?.innerText.slice(0,650)};`);
   const screenshot=await win.webContents.capturePage();
   const size=screenshot.getSize();
   if(size.width!==6400||size.height!==3760) throw Error('Unexpected hero resolution: '+JSON.stringify(size));
   fs.writeFileSync(path.join(root,'website/hikari-is/shots/hero-'+name+'.png'),screenshot.toPNG());
   console.log(name+' capture: '+size.width+' × '+size.height);
   console.log(name,JSON.stringify(info));
 };
 await capture('notebook',`heroCore.navigationShell.showView('biology-notebook-view');heroCore.moduleRuntime.modules.biologyNotebook.openEntry('hero-page');document.querySelector('#biology-notebook-protocol-area details').removeAttribute('open');`);
 await capture('samples',`heroCore.navigationShell.showView('sample-registry-view');const m=heroCore.moduleRuntime.modules.personalInventory;m.renderSections();document.querySelector('[data-inventory-section="-20 Degree"]').click();document.querySelector('[data-container-open="hero-box"]').click();document.querySelector('[data-well-index="19"]').click();`);
 await capture('plate',`heroCore.navigationShell.showView('assay-view');await new Promise(r=>setTimeout(r,250));document.getElementById('assay-mode-results-btn').click();document.querySelector('[data-assay-results-select="hero-plate"]').click();await new Promise(r=>setTimeout(r,350));const a=heroCore.state.assays[0];const traces=[[0,1,2],[3,4,5],[6,7]].map((rows,i)=>({type:'scatter',mode:'lines+markers',name:['A17','B08','Wild type'][i],x:a.concentrationAxisValues.map(Number),y:a.concentrationAxisValues.map((_,c)=>rows.reduce((sum,r)=>sum+Number(a.resultValues[String.fromCharCode(65+r)+(c+1)]),0)/rows.length)}));heroCore.moduleRuntime.modules.assay.renderAgentPlotlyGraph({name:'Activity across inhibitor concentrations',figure:{data:traces,layout:{xaxis:{title:{text:'Inhibitor (µM)'}},yaxis:{title:{text:'Retained activity (%)'}},showlegend:true}}});`);
 await capture('protocols',`heroCore.navigationShell.showView('protocol-management-view');document.querySelector('[data-protocol-select="hero-protocol"]').click();`);
 await capture('workflows',`heroCore.navigationShell.showView('workflow-management-view');heroCore.moduleRuntime.modules.workflowManagement.render();heroCore.moduleRuntime.modules.workflowManagement.openProcess('hero-workflow-0');`);
 await capture('dna',`heroCore.navigationShell.showView('sequence-viewer-view');for(let i=0;i<100&&!document.querySelector('#sequence-viewer-preview-host svg');i++)await new Promise(r=>setTimeout(r,50));if(!document.querySelector('#sequence-viewer-preview-host svg'))throw Error('Plasmid preview did not render');if(!document.getElementById('sequence-viewer-protein-builder-workspace').hidden)throw Error('DNA capture must show only the plasmid preview');`);
 await capture('papers',`heroCore.navigationShell.showView('papers-view');heroCore.moduleRuntime.modules.papers.render();document.querySelector('[data-paper-view="hero-alphafold"]').click();await new Promise(r=>setTimeout(r,1800));document.getElementById('paper-viewer-zoom-reset-btn').click();document.getElementById('paper-details-toggle-btn').click();await new Promise(r=>setTimeout(r,500));`);
 if(pdfs.chemistry) await capture('papers-chemistry',`document.querySelector('[data-paper-view="hero-click"]').click();await new Promise(r=>setTimeout(r,1800));document.getElementById('paper-viewer-zoom-reset-btn').click();document.getElementById('paper-details-toggle-btn').click();await new Promise(r=>setTimeout(r,500));`);
 win.destroy();app.quit();
})().catch(e=>{console.error(e);app.exit(1)});
