// Capture the actual Home renderer with disposable, fictional marketing data.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {pathToFileURL} = require('node:url');
const root = path.resolve(__dirname, '../../..');
if (!process.versions.electron) {
  const run = require('node:child_process').spawnSync(require(path.join(root, 'node_modules/electron')), [__filename], {stdio:'inherit', env:{...process.env, TZ:'America/Chicago'}, timeout:60000});
  process.exit(run.status ?? 1);
}
const {app, BrowserWindow, screen} = require('electron');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-site-hero-'));
app.setPath('userData', path.join(scratch,'profile'));
app.setPath('sessionData', path.join(scratch,'session'));
app.disableHardwareAcceleration();
const url = file => pathToFileURL(path.join(root,file)).href;
(async()=>{
  await app.whenReady();
 const captureZoom=4/screen.getPrimaryDisplay().scaleFactor;
  let shell = fs.readFileSync(path.join(root,'ui/html/shell/start.html'),'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'')
    .replace(/<div id="app-loading-cover"[\s\S]*?(?=  <main id="storage-setup-page)/,'')
    .replace(/<main id="storage-setup-page"[\s\S]*?<\/main>/,'')
    .replace(/href="([^"#]+)"/g,(_,file)=>`href="${url(file)}"`)
    .replace('<body>','<body class="theme-day" data-active-view="home-view" data-agent-availability="connected">');
  const fixture=path.join(scratch,'home.html');
  fs.writeFileSync(fixture,`${shell}${fs.readFileSync(path.join(root,'ui/html/views/home-view.html'),'utf8')}</section></div></main><script type="module" src="${pathToFileURL(path.join(__dirname,'hero-dashboard-fixture.mjs')).href}"></script></body></html>`);
  const win = new BrowserWindow({width:Math.round(1600*captureZoom),height:Math.round(940*captureZoom),useContentSize:true,show:false,webPreferences:{offscreen:true,zoomFactor:captureZoom,sandbox:true,contextIsolation:true}});
  win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,done)=>done({cancel:true}));
  win.webContents.on('console-message',(_,level,message)=>{if(level>=3) console.error(message);});
  win.webContents.setZoomFactor(captureZoom);
 await win.loadFile(fixture);
  for(let i=0;i<150;i++){
    if(await win.webContents.executeJavaScript('Boolean(window.tutorialReady && document.querySelector("[data-paper-finding-result]"))')) break;
    await new Promise(r=>setTimeout(r,50));
  }
  const info = await win.webContents.executeJavaScript(`(async()=>{
    if(!window.tutorialReady) throw Error('Dashboard did not initialize');
    document.querySelector('[data-dashboard-notebook-entry="demo-page"]').click();
    const note=document.querySelector('[data-dashboard-notebook-note-input]');
    note.value='Buffer B: 92% activity retained. Link sample PROT-017 (B2 / C4) to the plate 04 results and repeat with a fresh aliquot.';
    note.dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById('topbar-local-time').textContent='10:30';
    await document.fonts.ready;
    return {dock:document.querySelectorAll('.app-dock-btn').length, timers:document.querySelector('#dashboard-timer-active-list').textContent, passage:document.querySelector('#dashboard-passage-list').textContent, notebook:document.querySelector('#dashboard-notebook-page-list').textContent, papers:document.querySelector('.home-column-read').textContent};
  })()`);
  console.log(JSON.stringify(info));
  await new Promise(r=>setTimeout(r,400));
  const image=await win.webContents.capturePage();
  const size=image.getSize();
  if(size.width!==6400||size.height!==3760) throw Error('Unexpected hero resolution: '+JSON.stringify(size));
  console.log('Home capture: '+size.width+' × '+size.height);
  fs.writeFileSync(path.join(root,'website/hikari-is/shots/home-hero.png'),image.toPNG());
  win.destroy();
  app.quit();
})().catch(e=>{console.error(e);app.exit(1)});
