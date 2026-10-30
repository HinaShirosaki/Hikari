// Regression: a warm worksheet keeps its viewport, editable grid, and drafts
// while switching between browser demos. Covers Safari's srcdoc/file path too.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const site=path.resolve(__dirname,'../hikari-is');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'hikari-calculation-switch-')));
app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const server=http.createServer((req,res)=>{
  const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'')||'index.html';
  const file=path.resolve(site,relative);
  if(!file.startsWith(site+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';res.writeHead(200,{'Content-Type':type});res.end(bytes);});
});
(async()=>{
 await app.whenReady();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port;
 for(const mode of ['file','http']){
  const win=new BrowserWindow({width:1440,height:1050,useContentSize:true,show:false,webPreferences:{sandbox:true,backgroundThrottling:false,partition:'calculation-'+mode}});
  win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(request,done)=>done({cancel:!request.url.startsWith(`http://127.0.0.1:${port}/`)}));
  const start=Date.now();
  if(mode==='file')await win.loadFile(path.join(site,'index.html'),{hash:'trial/calculations'});
  else await win.loadURL(`http://127.0.0.1:${port}/#trial/calculations`);
  const evaluate=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`);
  const until=async(code,label)=>{for(let n=0;n<160;n++){if(await evaluate('return Boolean('+code+');'))return;await pause(50);}throw Error(mode+': '+label);};
  await until('document.getElementById("trial-app")?.dataset.ready === "true"','worksheet startup');
  const coldMs=Date.now()-start;
  await evaluate(`const f=document.getElementById('trial-app');const d=f.contentDocument;window.calcFrame=f;window.calcTable=d.querySelector('[data-result-table-host]');window.calcViewport={width:d.documentElement.clientWidth,height:d.documentElement.clientHeight};window.calcSizes=[];new f.contentWindow.ResizeObserver(()=>calcSizes.push([d.documentElement.clientWidth,d.documentElement.clientHeight])).observe(d.documentElement);[...calcTable.querySelectorAll('.tabulator-row')].find(r=>r.textContent.includes('Formula example')).querySelector('[tabulator-field="demo_molarity_3"]').click();const editor=calcTable.querySelector('input');if(!editor)throw Error('No cell editor');editor.value='2';editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,bubbles:true}));d.getElementById('biology-notebook-result').value='A draft note survives demo switches.';`);
  await until(`calcTable.querySelector('[tabulator-field="demo_molarity_4"]') && [...calcTable.querySelectorAll('.tabulator-row')].find(r=>r.textContent.includes('Formula example')).querySelector('[tabulator-field="demo_molarity_4"]').textContent.trim()==='25'`,'formula calculation');
  await evaluate(`document.querySelector('[data-trial-feature="cloning"]').click();`);
  await until(`document.querySelector('iframe[data-feature="cloning"]')?.dataset.ready==='true'`,'cloning startup');
  await evaluate(`if(!calcFrame.hidden||!calcFrame.inert||calcFrame.getAttribute('aria-hidden')!=='true')throw Error('Inactive frame is interactive');if(!calcFrame.getBoundingClientRect().width||calcFrame.contentDocument.documentElement.clientWidth!==calcViewport.width)throw Error('Worksheet viewport collapsed');`);
  const switches=[];
  for(let n=0;n<6;n++){
    const elapsed=await evaluate(`const began=performance.now();document.querySelector('[data-trial-feature="${n%2?'cloning':'calculations'}"]').click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()-began;`);switches.push(Math.round(elapsed));
  }
  await evaluate(`document.querySelector('[data-trial-feature="calculations"]').click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const d=calcFrame.contentDocument;if(d.querySelector('[data-result-table-host]')!==calcTable)throw Error('Worksheet grid rebuilt');if(d.getElementById('biology-notebook-result').value!=='A draft note survives demo switches.')throw Error('Draft note lost');if(calcSizes.some(([w,h])=>!w||!h))throw Error('Worksheet resized to zero');d.getElementById('save-biology-notebook-btn').click();`);
  await until(`calcFrame.contentWindow.HikariBrowserTrial.getState().notebookEntries.find(p=>p.id==='demo-calculations').result==='A draft note survives demo switches.'`,'worksheet save');
  console.log(JSON.stringify({mode,coldMs,switchMs:switches,viewportPreserved:true,gridPreserved:true,formula:25,draftSaved:true}));
  win.destroy();
 }
 server.close();app.quit();
})().catch(error=>{console.error(error);server.close();app.exit(1)});
