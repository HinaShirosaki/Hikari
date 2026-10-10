// Isolated dock fixture with real host CSS, preload, manifest inspection, and
// image-mode SVG rendering. Never reads or modifies the user's Hikari profile.
const { app, BrowserWindow, ipcMain, session, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const repo = path.resolve(__dirname, '..');
const runtime = path.resolve(process.env.HIKARI_PLUGIN_QA_ROOT || repo);
const { registerPluginIpc } = require(path.join(runtime, 'src/main/ipc/register-plugin-ipc.js'));
const temp = fsSync.mkdtempSync(path.join(os.tmpdir(), 'hikari-dock-icon-'));
app.setPath('userData', path.join(temp, 'profile'));
app.setPath('sessionData', path.join(temp, 'session'));
let win, servers, probeServer, externalRequests = 0, checks = 0;
const check = (value, message) => { assert.ok(value, message); checks += 1; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  await app.whenReady();
  servers = registerPluginIpc({ ipcMain, session, dialog, fs });
  const folder = path.join(temp, 'scientific-illustration');
  await fs.cp(path.join(repo, 'plugins/scientific-illustration'), folder, { recursive: true });
  probeServer = http.createServer((_req, res) => { externalRequests += 1; res.end('<svg/>'); });
  await new Promise(resolve => probeServer.listen(0, '127.0.0.1', resolve));
  const externalUrl = `http://127.0.0.1:${probeServer.address().port}/external.svg`;
  const hostileSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><script>parent.iconExecuted=true</script><foreignObject width="24" height="24"><body xmlns="http://www.w3.org/1999/xhtml" onload="parent.iconExecuted=true">X</body></foreignObject><image href="${externalUrl}" width="24" height="24"/><circle cx="12" cy="12" r="8"/></svg>`;
  const url = file => pathToFileURL(path.join(runtime, file)).href;
  const source = await fs.readFile(path.join(runtime, 'index.html'), 'utf8');
  const csp = source.match(/<meta http-equiv="Content-Security-Policy"[\s\S]*?>/)[0];
  await fs.writeFile(path.join(temp, 'host.html'), `<!DOCTYPE html><html><head>${csp}<link rel="stylesheet" href="${url('styles.css')}"><style>
    body{min-width:0}.topbar{position:relative}.preview{display:grid;grid-template-columns:180px 1fr;gap:36px;align-items:center;padding:52px 64px}.preview-mark svg{width:150px;height:150px;color:var(--theme-text-strong)}.preview h2{margin:0 0 8px}.preview p{margin:0;color:var(--theme-text-muted)}.samples{display:flex;gap:24px;align-items:center;margin-top:28px;color:var(--theme-text-muted)}.sample{display:flex;gap:12px;align-items:center}.sample svg{width:22px;height:22px}.sample.active{color:var(--theme-text-strong)}#probe{position:absolute;width:24px;height:24px;bottom:8px;right:8px;opacity:0}
    </style></head><body><header class="topbar"><div class="topbar-brand"><h1>Hikari</h1></div><div class="app-dock"><nav id="app-dock-nav"></nav><span class="app-dock-divider"></span><button id="app-more-btn" class="app-nav-btn">More</button><div id="app-more-menu" class="app-more-menu" hidden></div></div><div class="topbar-tools"><input placeholder="Search Hikari"></div></header><main class="preview"><div class="preview-mark"></div><div><h2>Figura</h2><p>A cell diagram and drawing pen.</p><div class="samples"><span class="sample"></span><span class="sample active"></span></div></div></main><div id="probe"></div><script type="module" src="host.mjs"></script></body></html>`);
  await fs.writeFile(path.join(temp, 'host.mjs'), `
    import { createAppDock } from ${JSON.stringify(url('src/renderer/app/navigation-shell/app-dock.js'))};
    import { loadPluginIcons, pluginIconMarkup } from ${JSON.stringify(url('src/renderer/app/plugin-loader.js'))};
    import { APP_REGISTRY } from ${JSON.stringify(url('src/renderer/modules/app-registry.generated.js'))};
    import { applyAppearanceToDocument } from ${JSON.stringify(url('src/renderer/app/appearance.js'))};
    window.inspected=await hikariApi.inspectPluginFolder(${JSON.stringify(folder)});
    if(!inspected.ok) throw new Error(inspected.error);
    const entry={id:'plugin-scientific-illustration',viewId:'plugin-scientific-illustration-view',label:'Previous plugin name',iconMarkup:pluginIconMarkup('')};
    window.installedPlugin={id:'scientific-illustration',name:entry.label,path:${JSON.stringify(folder)},permissions:['storage']};
    const section=document.createElement('section');section.id=entry.viewId;section.hidden=true;
    const frame=document.createElement('iframe');frame.className='plugin-frame';section.append(frame);document.body.append(section);
    window.apps=[...APP_REGISTRY.filter(app=>!app.hiddenFromNavigation),entry];
    window.activeViewId=entry.viewId;
    window.dock=createAppDock({documentObject:document,windowObject:window,TITLES:{},dockNav:document.getElementById('app-dock-nav'),appDockDivider:document.querySelector('.app-dock-divider'),moreBtn:document.getElementById('app-more-btn'),moreMenu:document.getElementById('app-more-menu'),expandedDockApps:apps,getActiveViewId:()=>activeViewId,getAppForView:id=>apps.find(app=>app.viewId===id),resolveNavigationViewId:id=>id});
    window.navigate=id=>{activeViewId=id;dock.renderAppNavigation(id);dock.syncNavigationState(id);};
    navigate(activeViewId);
    // Simulate an existing install with a cached name and original permission grants.
    await loadPluginIcons({plugins:[installedPlugin],appRegistry:apps,api:hikariApi,documentObject:document});
    navigate(activeViewId);
    window.setTheme=mode=>applyAppearanceToDocument({mode},document,16);
    setTheme('day');
    document.querySelector('.preview-mark').innerHTML=entry.iconMarkup;
    document.querySelector('.sample').innerHTML=entry.iconMarkup+'Dock size';
    document.querySelector('.sample.active').innerHTML=entry.iconMarkup+'Selected';
    document.getElementById('probe').innerHTML=pluginIconMarkup(${JSON.stringify(`data:image/svg+xml;base64,${Buffer.from(hostileSvg).toString('base64')}`)});
    window.iconReady=true;
  `);
  win = new BrowserWindow({ show: false, width: 1120, height: 440, webPreferences: {
    preload: path.join(runtime, 'src/main/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false
  } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await win.loadFile(path.join(temp, 'host.html'));
  for (let i = 0; i < 100; i += 1) {
    if (await win.webContents.executeJavaScript('Boolean(window.iconReady)')) break;
    await pause(50);
  }
  const evaluate = code => win.webContents.executeJavaScript(code);
  check(await evaluate('Boolean(window.iconReady)'), 'fixture loaded through real manifest IPC');
  const selected = '[data-app-id="plugin-scientific-illustration"]';
  check(await evaluate(`inspected.name==='Figura' && installedPlugin.name==='Figura' && document.querySelector('#app-dock-nav ${selected}').getAttribute('aria-label')==='Figura'`), 'Existing install names refresh to Figura in Settings and navigation');
  check(await evaluate(`(()=>{const section=document.getElementById('plugin-scientific-illustration-view'),frame=section.querySelector('iframe');return section.getAttribute('aria-label')==='Figura'&&frame.title.startsWith('Figura')&&frame.title===frame.getAttribute('aria-label')})()`), 'The view and iframe accessible names refresh with the manifest');
  check(await evaluate(`installedPlugin.id==='scientific-illustration' && installedPlugin.permissions.join(',')==='storage'`), 'The rename preserves plugin identity and original permission grants');
  check(await evaluate(`document.querySelector('#app-dock-nav ${selected} svg').dataset.pluginIcon==='true'`), 'existing installation refreshes its dock icon');
  check(await evaluate(`document.querySelector('#app-dock-nav ${selected}').getAttribute('aria-current')==='page'`), 'active plugin is promoted into the dock');
  for (const mode of ['day', 'night']) {
    await evaluate(`setTheme('${mode}')`); await pause(150);
    const metric = await evaluate(`(()=>{const button=document.querySelector('#app-dock-nav ${selected}'),icon=button.querySelector('.app-nav-icon'),svg=icon.querySelector('svg'),r=svg.getBoundingClientRect(),b=button.getBoundingClientRect();return {width:r.width,height:r.height,centerX:r.x+r.width/2-(b.x+b.width/2),centerY:r.y+r.height/2-(b.y+b.height/2),color:getComputedStyle(button).color,fill:getComputedStyle(svg.querySelector('rect')).fill,mask:getComputedStyle(svg).maskImage}})()`);
    check(metric.width === 22 && metric.height === 22 && Math.abs(metric.centerX) < 0.5 && Math.abs(metric.centerY) < 0.5, `${mode}: icon is 22px and centered`);
    check(metric.color === metric.fill && metric.mask.startsWith('url("data:image/svg+xml;base64,'), `${mode}: monochrome mask follows host color`);
    await fs.writeFile(path.join(temp, `${mode}.png`), (await win.webContents.capturePage()).toPNG());
    if (mode === 'day') {
      const rect = await evaluate('(()=>{const r=document.querySelector(".preview-mark svg").getBoundingClientRect();return {x:Math.round(r.x)-12,y:Math.round(r.y)-12,width:174,height:174}})()');
      await fs.writeFile(path.join(temp, 'icon.png'), (await win.webContents.capturePage(rect)).toPNG());
    }
  }
  await evaluate('setTheme("day");navigate("home-view");dock.toggleMoreMenu(true)'); await pause(100);
  check(await evaluate(`document.querySelector('#app-more-menu ${selected} svg').dataset.pluginIcon==='true'`), 'More menu uses the same icon');
  check(await evaluate(`document.querySelector('#app-more-menu ${selected}').getAttribute('aria-label')==='Figura'`), 'icon-only entry keeps its accessible name');
  await fs.writeFile(path.join(temp, 'more.png'), (await win.webContents.capturePage()).toPNG());
  await pause(300);
  check(await evaluate('!window.iconExecuted && !document.querySelector("#probe script,#probe foreignObject,#probe image")'), 'hostile SVG code stays out of host DOM and cannot execute');
  check(externalRequests === 0, 'SVG image mode cannot fetch external resources');
  console.log(`Plugin dock icon: ${checks} checks passed. Runtime: ${runtime}. Screenshots: ${temp}`);
}

const timeout = setTimeout(() => { console.error('Dock icon fixture timed out'); app.exit(1); }, 30000);
run().then(() => 0, error => { console.error(error.stack || error); return 1; }).then(async code => {
  clearTimeout(timeout); win?.destroy(); await servers?.closeAll();
  if (probeServer) await new Promise(resolve => probeServer.close(resolve));
  app.exit(code);
});
