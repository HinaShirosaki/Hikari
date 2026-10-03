// Real DOM regression coverage for saved highlights and asynchronous page changes.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
if (!process.versions.electron) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-insights-'));
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(require('electron'), [__filename, temp], { encoding: 'utf8', timeout: 60000 });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  fs.rmSync(temp, { recursive: true, force: true });
  if (result.status !== 0) throw result.error || new Error(`Insight QA failed: ${result.status}`);
} else {
  const { app, BrowserWindow } = require('electron');
  const temp = process.argv[2];
  app.setPath('userData', path.join(temp, 'profile'));
  const url = file => pathToFileURL(path.join(root, file)).href;
  const html = `<!doctype html><meta charset="utf-8">
  <link rel="stylesheet" href="${url('styles.css')}">
  <style>body{display:block;padding:48px}main{max-width:700px}section{margin-bottom:60px}</style>
  <main><h1>Saved research answers</h1><section><h2>Protocol</h2><div id="protocol"></div></section>
  <section><h2>Notebook</h2><div id="notebook"></div></section></main>
  <script type="module">
  import {createSelectionInsightsController} from '${url('src/renderer/modules/selection-insights/controller.js')}';
  import {getSelectionContext} from '${url('src/renderer/modules/selection-insights/controller-selection.js')}';
  import {runInsightAction} from '${url('src/renderer/modules/selection-insights/controller-actions.js')}';
  const check=(value,message)=>{if(!value)throw new Error(message)};
  document.body.dataset.agentAvailability='connected';
  const records={}; let requests=0; let pending=[]; const sidecars=[];
  window.hikariApi={runDirectLlmPrompt:()=>{requests++;return new Promise((resolve,reject)=>pending.push({resolve,reject}))}};
  const controller=createSelectionInsightsController({state:{settings:{}},createId:()=>crypto.randomUUID(),api:{writeJsonFile:async data=>sidecars.push(data)}});
  const markup='<p data-selection-segment-id="step-1">Add DTT, then add <strong>DTT</strong> to the buffer.</p>';
  const hosts=new Map(); const active={};
  for(const kind of ['protocol','notebook']){
    records[kind]={id:kind+'-1',name:kind,selectionInsights:[]}; active[kind]=kind;
    const host=document.getElementById(kind); host.innerHTML=markup;
    const getContext=()=>{const key=active[kind];return {kind,record:records[key],storagePath:'/test',
      updateRecord:updater=>(records[key]=updater(records[key]))}};
    hosts.set(kind,{host,getContext});controller.registerHost({key:kind,host,getContext});
  }
  const ctx={hosts,rootDocument:document,windowObject:window,state:{settings:{}},createId:()=>crypto.randomUUID(),api:{writeJsonFile:async data=>sidecars.push(data)}};
  window.showMenu=()=>{
    document.querySelectorAll('.selection-insight-panel').forEach(panel=>{panel.hidden=true});
    const host=document.getElementById('protocol');
    const text=host.querySelector('p').firstChild;
    const range=document.createRange();range.setStart(text,4);range.setEnd(text,7);
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
    host.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:260,clientY:225}));
    const menu=[...document.querySelectorAll('.selection-insight-menu')].find(el=>!el.hidden);
    check(!menu.querySelector('.selection-insight-menu-context'),'menu contains only actions');
    check(menu.textContent.includes('Explain selection') && menu.textContent.includes('Find suppliers'),'clear action labels');
    const rect=menu.getBoundingClientRect();
    check(rect.left>=0 && rect.right<=innerWidth && rect.bottom<=innerHeight,'menu fits viewport');
    return {x:Math.floor(rect.x)-20,y:Math.floor(rect.y)-20,width:Math.ceil(rect.width)+40,height:Math.ceil(rect.height)+40};
  };
  window.runTests=async()=>{
    for(const kind of ['protocol','notebook']){
      const host=hosts.get(kind).host;
      const node=host.querySelector('strong').firstChild; const range=document.createRange();range.selectNodeContents(node);
      const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
      const selected=getSelectionContext(ctx,kind);check(selected.occurrenceIndex===2,'second occurrence selected');
      const task=runInsightAction(ctx,kind,selected,'what_is_it');
      await new Promise(r=>setTimeout(r,0));
      check(host.querySelectorAll('.selection-insight-anchor').length===1,'pending highlight created from NodeList');
      records.other={id:'other',selectionInsights:[]};active[kind]='other';host.innerHTML=markup;controller.refreshHost(kind);
      pending.shift().resolve({ok:true,text:'DTT is a reducing agent.'});await task;
      check(records.other.selectionInsights.length===0,'navigation does not contaminate new page');
      check(records[kind].selectionInsights[0].answers.what_is_it.text==='DTT is a reducing agent.','answer saved on original page');
      check(sidecars.at(-1).data.owner.id===kind+'-1','sidecar belongs to original page');
      records[kind]=JSON.parse(JSON.stringify(records[kind]));active[kind]=kind;host.innerHTML=markup;controller.refreshHost(kind);
      const anchor=host.querySelector('.selection-insight-anchor');check(anchor?.textContent==='DTT','highlight restored after serialization and rerender');
      check(anchor.closest('strong') || anchor.querySelector('strong')?.textContent==='DTT','formatting preserved');
      check(host.textContent==='Add DTT, then add DTT to the buffer.','text unchanged');
      const prefix=document.createRange();prefix.setStart(host,0);prefix.setEndBefore(anchor);check(prefix.toString()==='Add DTT, then add ','second occurrence preserved');
      anchor.dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));
      const panel=[...document.querySelectorAll('.selection-insight-panel')].find(el=>!el.hidden);
      check(panel?.textContent.includes('DTT is a reducing agent.'),'hover shows saved answer');
      check(getComputedStyle(panel).position==='fixed','popover overlays document');
      const before=requests;await runInsightAction(ctx,kind,selected,'what_is_it');check(requests===before,'saved answer reused without request');
      controller.refreshHost(kind);controller.refreshHost(kind);check(host.querySelectorAll('.selection-insight-anchor').length===1,'rerender does not duplicate highlights');
      controller.hidePanel();
    }
    // Both answer types must merge against the latest owning record.
    const selected={segmentId:'step-1',selectedText:'DTT',occurrenceIndex:2};
    const buy=runInsightAction(ctx,'protocol',selected,'where_to_buy');await new Promise(r=>setTimeout(r,0));
    pending.shift().resolve({ok:true,payload:{summary:'Available from laboratory suppliers.',items:[]}});await buy;
    const answers=records.protocol.selectionInsights[0].answers;
    check(answers.what_is_it.text && answers.where_to_buy.summary,'both answer types retained');
    document.querySelectorAll('.selection-insight-panel').forEach(panel=>{panel.hidden=true});
    document.getElementById('protocol').querySelector('.selection-insight-anchor').dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));
    return 'Protocol and Notebook: selection, highlights, hover, reload, reuse, navigation, sidecars and both answer types passed';
  };
  </script>`;
  (async()=>{
    await app.whenReady();
    const file=path.join(temp,'fixture.html');fs.writeFileSync(file,html);
    const win=new BrowserWindow({width:1000,height:760,show:false,webPreferences:{contextIsolation:true}});
    await win.loadFile(file);
    console.log(await win.webContents.executeJavaScript('window.runTests()'));
    const out=path.join(root,'artifacts/selection-insights');fs.mkdirSync(out,{recursive:true});
    for(const theme of ['day','night']){
      await win.webContents.executeJavaScript(`document.body.dataset.theme='${theme}'; document.body.className='theme-${theme}'`);
      await new Promise(resolve=>setTimeout(resolve,150));
      fs.writeFileSync(path.join(out,theme+'.png'),(await win.webContents.capturePage()).toPNG());
    }
    const menuRect=await win.webContents.executeJavaScript('window.showMenu()');
    for(const theme of ['day','night']){
      await win.webContents.executeJavaScript(`document.body.dataset.theme='${theme}'; document.body.className='theme-${theme}'`);
      await new Promise(resolve=>setTimeout(resolve,150));
      fs.writeFileSync(path.join(out,'menu-'+theme+'.png'),(await win.webContents.capturePage(menuRect)).toPNG());
    }
    win.setSize(360,640);
    await win.webContents.executeJavaScript('window.showMenu()');
    console.log('Menu labels, action-only layout and narrow viewport passed');
    app.quit();
  })().catch(error=>{console.error(error);app.exit(1)});
}
