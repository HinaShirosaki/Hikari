'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

async function main() {
  if (!process.versions.electron) {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename], { encoding: 'utf8', timeout: 120000 });
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
    assert.equal(result.status, 0, String(result.error || result.signal)); return;
  }
  const { app, BrowserWindow } = require('electron');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-citations-'));
  app.setPath('userData', path.join(scratch, 'profile')); app.disableHardwareAcceleration();
  await app.whenReady();
  const url = file => pathToFileURL(path.join(root, file)).href;
  const out = path.join(root, 'artifacts/agent-paper-citations'); fs.mkdirSync(out, { recursive: true });
  const fixture = path.join(root, `.paper-citations-fixture-${process.pid}.html`);
  fs.writeFileSync(fixture, fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace('<head>', `<head><base href="${url('')}/"><script src="${url('vendor/jspdf.umd.min.js')}"></script>`));
  const win = new BrowserWindow({ width: 1500, height: 960, show: false, webPreferences: { backgroundThrottling: false } });
  const run = code => win.webContents.executeJavaScript(code);
  try {
    await win.loadFile(fixture);
    await run(`(async () => {
      document.querySelector('#app-loading-cover').remove();
      document.body.className='ui-neutral-compact theme-day agent-view-fixed-scroll has-shared-left-rail-view';
      document.body.dataset.agentAvailability='connected';
      window.show = id => { document.body.dataset.activeView=id; document.querySelectorAll('.view').forEach(node=>node.classList.toggle('is-active',node.id===id)); };
      show('agent-view');
      const {initPapersManagement}=await import(${JSON.stringify(url('src/renderer/modules/papers/index.js'))});
      const {defaultState}=await import(${JSON.stringify(url('src/renderer/modules/app-state/index.js'))});
      const {collectAgentChatDom}=await import(${JSON.stringify(url('src/renderer/modules/agent-chat/dom-bindings.js'))});
      const {createAgentChatShellController}=await import(${JSON.stringify(url('src/renderer/modules/agent-chat/shell-controller.js'))});
      const {createHistoryActionController}=await import(${JSON.stringify(url('src/renderer/modules/agent-chat/history-actions.js'))});
      const {agentChatManifest}=await import(${JSON.stringify(url('src/renderer/module-manifests/agent-chat.js'))});
      const safeText=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
      window.state=structuredClone(defaultState); state.settings.storagePath='/test/Lab papers';
      window.passage='A fluorescence assay measured residence times across independent replicates in mammalian cells.';
      const pdf=new jspdf.jsPDF(); pdf.text('Introduction without the cited experiment.',20,30); pdf.addPage();
      pdf.text('Methods and controls',20,25); pdf.text('A fluorescence assay measured residence times',20,70);
      pdf.text('across independent replicates in mammalian cells.',20,78);
      pdf.addPage(); pdf.text('Results with different controls.',20,30);
      window.downloadedPaper={id:'local-paper',title:'Residence assay',fileName:'residence.pdf',storedRelativePath:'Papers/residence.pdf',
        pdfDataUrl:'data:application/pdf;base64,'+pdf.output('datauristring').split(',')[1],comments:[],highlights:[],ingestionStatus:'ready'};
      state.papers=[];
      window.path='KnowledgeBase/papers.md/residence/paper.md';
      const block={paper_id:'knowledge-id-differs-from-library-id',paper_title:'Residence assay',section_label:'Methods',source_path:path,
        source_lines:[{line_number:42,content:passage},{line_number:43,content:'A separate control was measured independently under identical conditions.'}]};
      state.agentChat={currentSessionId:'citations',messages:[{id:'u',role:'user',text:'How was residence measured?'},
        {id:'a',role:'assistant',text:'They measured residence by fluorescence. [Residence assay](<'+path+'#L42>)',meta:{paper_evidence:[block]}}]};
      window.reads=[];window.discoveryCalls=[];window.hikariApi={
        discoverStoredPapers:async payload=>{discoveryCalls.push(payload.metadataOnly===true);return payload.metadataOnly
          ? {ok:true,papers:[structuredClone(downloadedPaper)],journalClubs:[]} : new Promise(()=>{});},
        readFileBytes:async file=>{reads.push(file);return {ok:true,bytes:file.endsWith('.pdf')?pdf.output('arraybuffer'):new TextEncoder().encode(JSON.stringify({source_pdf_path:'Papers/residence.pdf'})).buffer};},
        openFilePath:()=>{throw Error('Must stay inside Papers');}};
      window.papers=initPapersManagement({state,persist:()=>{},createId:()=>crypto.randomUUID(),safeText,document,window}); papers.render();
      window.dom=collectAgentChatDom(document); window.runtime={liveAssistantMessage:null};
      window.shell=createAgentChatShellController({dom,state,runtime,safeText,persist:()=>{}});
      shell.renderProjectOptions(); shell.renderHistoryView();
      const opts=agentChatManifest.createOptions({state,persist:()=>{},createId:()=>'',safeText,rendererServices:{notebook:{},protocol:{}},
        modules:{papers},showView:show,views:{PAPERS:'papers-view'},rootDocument:document,windowObject:window});
      const navigate=opts.onOpenPaperCitation;opts.onOpenPaperCitation=async source=>{window.navigationResult=await navigate(source);return navigationResult;};
      window.notices=[]; window.actions=createHistoryActionController({...opts,setStatus:value=>notices.push(value),renderHistoryView:shell.renderHistoryView,renderContextSummary:()=>{}});
      window.clicked=null; dom.historyNode.addEventListener('click',event=>{clicked=actions.onHistoryClick(event);});
    })()`);
    const metrics=[];
    for (const theme of ['day','night']) {
      for (const width of [1500,760,390]) {
        win.setContentSize(width,960);
        await run(`document.body.classList.toggle('theme-day',${theme==='day'});document.body.classList.toggle('theme-night',${theme==='night'});
          new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
        const measured=await run(`(()=>{const button=document.querySelector('[data-agent-paper-source]');const rect=button.getBoundingClientRect();return {
          width:rect.width,height:rect.height,label:button.getAttribute('aria-label'),text:button.textContent,
          overflow:document.documentElement.scrollWidth>innerWidth,
          outline:(button.focus(),getComputedStyle(button).outlineStyle)};})()`);
        assert.ok(measured.width<=45 && measured.height>=20,JSON.stringify(measured));
        assert.equal(measured.text,'1'); assert.match(measured.label,/Residence assay.*Methods/); assert.equal(measured.overflow,false);
        metrics.push({theme,viewport:width,...measured});
        if(width===1500) fs.writeFileSync(path.join(out,`button-${theme}.png`),(await win.webContents.capturePage()).toPNG());
      }
    }
    win.setContentSize(1500,960);
    await run(`document.querySelector('[data-agent-paper-source]').click(); clicked`);
    assert.equal(await run('document.body.dataset.activeView'),'papers-view');
    assert.equal(await run('papers.getActivePaperId()'),'local-paper',JSON.stringify(await run('({notices,reads,status:document.getElementById("paper-viewer-status").textContent})')));
    assert.equal(await run('discoveryCalls.includes(true)'),true,'The new download opens through a metadata-only library lookup');
    await run('new Promise(resolve=>setTimeout(resolve,100))');
    assert.equal(await run('document.getElementById("paper-viewer-page-input").value'),'2');
    assert.equal(await run('navigationResult.located'),true);
    assert.ok(await run('document.querySelectorAll(".papers-viewer-search-highlight").length')>0,JSON.stringify(await run('({notices,status:document.getElementById("paper-viewer-status").textContent,search:document.getElementById("paper-selection-search-count")?.textContent,texts:[...document.querySelectorAll(".papers-viewer-text-layer")].map(node=>node.textContent)})')));
    assert.equal(await run('state.papers[0].highlights.length'),0,'Citation does not create a saved annotation');
    assert.equal(await run('reads[0]'),'/test/Lab papers/KnowledgeBase/papers.md/residence/meta.json');
    fs.writeFileSync(path.join(out,'passage.png'),(await win.webContents.capturePage()).toPNG());
    await run(`document.getElementById('paper-viewer-zoom-in-btn').click();new Promise(resolve=>setTimeout(resolve,100))`);
    const readerZoom=await run(`document.getElementById('paper-viewer-zoom-label').textContent`);
    const pdfReads=await run(`reads.filter(file=>file.endsWith('.pdf')).length`);
    // Saved chat renders the same source; repeated navigation stays in this PDF.
    await run(`state.agentChat.messages=JSON.parse(JSON.stringify(state.agentChat.messages));show('agent-view');shell.renderHistoryView();
      document.querySelector('[data-agent-paper-source]').focus();`);
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});win.webContents.sendInputEvent({type:'char',keyCode:'Enter'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
    await run('new Promise(resolve=>setTimeout(resolve,50))'); await run('clicked');
    assert.equal(await run('document.getElementById("paper-viewer-page-input").value'),'2',JSON.stringify(await run('({navigationResult,notices,active:document.body.dataset.activeView,status:document.getElementById("paper-viewer-status").textContent})')));
    assert.equal(await run(`document.getElementById('paper-viewer-zoom-label').textContent`),readerZoom,'A citation in the open paper keeps its zoom');
    assert.equal(await run(`reads.filter(file=>file.endsWith('.pdf')).length`),pdfReads,'A citation in the open paper does not reload it');
    // Failed matches leave the document open and report the missing location.
    const missing=await run(`papers.openPaperCitation({path:'/test/Lab papers/'+path,excerpt:'A completely absent experiment measuring something that is never described in this document.'})`);
    assert.deepEqual(missing,{ok:true,located:false});
    assert.match(await run('document.getElementById("paper-viewer-status").textContent'),/could not be located/);
    const realResults=[];
    if (process.env.HIKARI_CITATION_REAL_PAPER==='1') {
      const chat=fs.readFileSync(path.join(root,'TestData3/chat_log/chat-mw2zkd6q-hkd88ck4.log'),'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line));
      const blocks=chat.filter(row=>row.type==='assistant-message').at(-1).meta.paper_evidence;
      const source=blocks[0].source_absolute_path;
      const metadata=JSON.parse(fs.readFileSync(path.join(path.dirname(source),'meta.json'),'utf8'));
      const storage=path.join(root,'TestData3');
      const pdf=fs.readFileSync(path.join(storage,metadata.source_pdf_path));
      await run(`state.settings.storagePath=${JSON.stringify(storage)};
        state.papers=[{id:'real-fact',title:${JSON.stringify(metadata.title)},fileName:'FACT.pdf',storedRelativePath:${JSON.stringify(metadata.source_pdf_path)},comments:[],highlights:[]}];
        window.realPdf=Uint8Array.from(atob(${JSON.stringify(pdf.toString('base64'))}),char=>char.charCodeAt(0)).buffer;
        hikariApi.readFileBytes=async file=>({ok:true,bytes:file.endsWith('.pdf')?realPdf.slice(0):new TextEncoder().encode(${JSON.stringify(JSON.stringify(metadata))}).buffer});void 0;`);
      for (const line of [54,56,58,248]) {
        const selected=blocks.flatMap(block=>block.source_lines).find(row=>row.line_number===line);
        const result=await run(`papers.openPaperCitation(${JSON.stringify({path:source,excerpt:selected.content})})`);
        assert.equal(result.located,true,`Real FACT paper line ${line}`);
        await run('new Promise(resolve=>setTimeout(resolve,150))');
        const highlights=await run(`(()=>{const marks=[...document.querySelectorAll('.papers-viewer-search-highlight')];return marks.map(mark=>{
          const rect=mark.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,background:getComputedStyle(mark).backgroundColor};});})()`);
        assert.ok(highlights.length>0,`Real FACT line ${line} retains its highlight after rendering`);
        const page=await run('document.getElementById("paper-viewer-page-input").value');
        realResults.push({line,page,located:result.located,highlights});
      }
      fs.writeFileSync(path.join(out,'real-paper-passage.png'),(await win.webContents.capturePage()).toPNG());
    }
    fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({metrics,correctPaper:true,page:2,temporaryHighlight:true,keyboardAndReload:true,missingPassageReported:true,realResults},null,2));
    console.log('Paper citation Electron passed: 6 layouts, sentence button, actual manifest routing, PDF identity, page 2 passage highlight, keyboard/reload, no saved annotations and missing passage.');
  } finally {win.destroy();fs.rmSync(fixture,{force:true});fs.rmSync(scratch,{recursive:true,force:true});app.quit();}
}
main().catch(error=>{console.error(error);if(process.versions.electron)require('electron').app.exit(1);else process.exitCode=1;});
