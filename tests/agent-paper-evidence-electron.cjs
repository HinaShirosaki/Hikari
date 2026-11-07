'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

async function main() {
  if (!process.versions.electron) {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename], { encoding: 'utf8', timeout: 60000 });
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
    assert.equal(result.status, 0, String(result.error || result.signal));
    return;
  }
  const { app, BrowserWindow } = require('electron');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-paper-card-'));
  app.setPath('userData', path.join(scratch, 'profile'));
  app.disableHardwareAcceleration();
  await app.whenReady();
  const out = path.join(root, 'artifacts/agent-paper-evidence');
  fs.mkdirSync(out, { recursive: true });
  const url = file => pathToFileURL(path.join(root, file)).href;
  const fixture = path.join(scratch, 'workspace.html');
  fs.writeFileSync(fixture, fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace('<head>', `<head><base href="${url('')}/">`));
  const win = new BrowserWindow({ width: 1500, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadFile(fixture);
  const run = code => win.webContents.executeJavaScript(code);
  await run(`(async () => {
    document.querySelector('#app-loading-cover').remove();
    document.body.className = 'ui-neutral-compact theme-day agent-view-fixed-scroll has-shared-left-rail-view';
    document.body.dataset.agentAvailability = 'connected';
    document.querySelectorAll('.view').forEach(node => node.classList.toggle('is-active', node.id === 'agent-view'));
    const base = ${JSON.stringify(url('src/renderer/modules/agent-chat') + '/')};
    const { collectAgentChatDom } = await import(base + 'dom-bindings.js');
    const { createAgentChatShellController } = await import(base + 'shell-controller.js');
    const safeText = text => String(text ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
    window.evidence = [{ paper_id: 'p1', paper_title: 'Quantifying protein–ligand binding with a fluorescence assay',
      section_label: 'Controls and assay conditions', source_path: 'KnowledgeBase/papers.md/p1/paper.md',
      line_ranges: [{start_line:42,end_line:44},{start_line:61,end_line:61}],
      source_lines: [{line_number:42,content:'Binding was measured across a serial dilution of the ligand.'},
        {line_number:43,content:'  Each plate included a protein-free control and a vehicle control.'},
        {line_number:44,content:'Measurements were collected after a 30-minute incubation.'},
        {line_number:61,content:'The control signal was subtracted before curve fitting.'}],
      relevance_reason: 'These lines identify the controls and incubation time needed to compare the two runs. They also explain how the background signal was removed.',
      related_comments: [{text:'Check whether both runs used the same vehicle concentration.'}] },
      {paper_id:'p2', paper_title:'Assessing reproducibility in plate-based binding measurements', section_label:'',
        source_path:'KnowledgeBase/papers.md/p2/paper.md', line_ranges:[{start_line:108,end_line:109}],
        source_lines:[{line_number:108,content:'Independent measurements were collected in triplicate.'},{line_number:109,content:'Variability was reported for each concentration.'}],
        relevance_reason:'Provides a reference for reporting uncertainty in the comparison.'}];
    evidence.splice(1,0,{paper_id:'p1',paper_title:evidence[0].paper_title,section_label:'Methods',
      source_path:evidence[0].source_path,line_ranges:[{start_line:80,end_line:80}],
      source_lines:[{line_number:80,content:'The plate reader recorded fluorescence after the incubation.'}],
      relevance_reason:'Identifies the measurement method.',related_comments:[]});
    evidence.splice(2,0,{paper_id:'p1',paper_title:evidence[0].paper_title,section_label:evidence[0].section_label,
      source_path:evidence[0].source_path,line_ranges:[{start_line:90,end_line:90}],
      source_lines:[{line_number:90,content:'A matched vehicle control was recorded independently for the second plate.'}],
      relevance_reason:'Provides a second control passage.',related_comments:[]});
    window.state = {settings:{storagePath:'/test/Lab',agent:{}},projects:[],agentChat:{currentSessionId:'paper-chat',messages:[
      {id:'u',role:'user',text:'Find the controls I should check before comparing these binding assay runs.'},
      {id:'a',role:'assistant',text:'The reader found two useful passages. Check the vehicle control, incubation time, and background subtraction before comparing the curves.',meta:{paper_evidence:evidence}}
    ]}};
    window.runtime = {liveAssistantMessage:null};
    window.dom = collectAgentChatDom(document);
    window.openedSources=[];
    window.shell = createAgentChatShellController({dom,state,runtime,safeText,persist:()=>{},
      onOpenPaperCitation:async source=>{openedSources.push(source);return {ok:true};}});
    window.firstPaper=()=>document.querySelector('.agent-evidence-paper');
    window.redraw = () => shell.renderHistoryView();
    shell.renderProjectOptions(); redraw(); shell.syncComposerHeight();
  })()`);
  await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  assert.equal(await run('dom.paperEvidence.hidden'), false);
  assert.equal(await run('document.querySelectorAll(".agent-evidence-paper").length'), 2);
  assert.equal(await run('document.querySelector(".agent-evidence-title").textContent'), 'Evidence');
  assert.equal(await run('document.querySelector(".agent-evidence-total").textContent'), '2 papers · 4 passages');
  assert.equal(await run('document.querySelector(".agent-evidence-line-text").textContent'), await run('evidence[0].source_lines.map(line => line.content).join("\\n")'));
  assert.equal(await run('document.querySelector(".agent-evidence-comment").textContent'), await run('evidence[0].relevance_reason'));
  assert.equal(await run('firstPaper().querySelectorAll(".agent-evidence-page-button svg path").length'), 2);
  assert.equal(await run('firstPaper().querySelectorAll(".agent-evidence-open-paper svg path").length'), 1);
  // Updating the answer does not replace source DOM, collapse it, or lose selection.
  await run(`window.retained = document.querySelector('.agent-evidence-line-text');
    const range=document.createRange(); range.selectNodeContents(retained); getSelection().removeAllRanges(); getSelection().addRange(range);
    state.agentChat.messages.push({id:'a2',role:'assistant',text:'Another update.'}); redraw();`);
  const selection = await run('({stable:document.querySelector(".agent-evidence-line-text") === retained,selected:getSelection().toString(),text:retained.textContent,open:[...dom.paperEvidence.querySelectorAll("details")].map(d=>d.open),height:retained.getBoundingClientRect().height})');
  assert.equal(selection.stable && selection.selected === selection.text, true, JSON.stringify(selection));
  await run('getSelection().removeAllRanges();');
  const measurements = [];
  for (const theme of ['day', 'night']) {
    await run(`document.body.classList.toggle('theme-day', ${theme === 'day'}); document.body.classList.toggle('theme-night', ${theme === 'night'});`);
    for (const width of [1500, 1280, 1100]) {
      win.setContentSize(width, 960);
      await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      const metrics = await run(`(() => {
        const card = dom.paperEvidence.getBoundingClientRect(); const chat = dom.conversationShell.getBoundingClientRect();
        const composer = document.querySelector('#agent-view .agent-composer-card').getBoundingClientRect();
        return {width:innerWidth, card:{x:card.x,y:card.y,right:card.right,bottom:card.bottom,width:card.width,height:card.height},
          chat:{x:chat.x,right:chat.right,bottom:chat.bottom},composerBottom:composer.bottom,
          overflow:document.documentElement.scrollWidth > innerWidth || dom.paperEvidence.scrollWidth > dom.paperEvidence.clientWidth,
          panelWidth:document.querySelector('#agent-view .agent-chat-panel').clientWidth};
      })()`);
      assert.equal(metrics.overflow, false, JSON.stringify(metrics));
      assert.ok(metrics.card.right <= width + 1 && metrics.card.bottom <= 960, JSON.stringify(metrics));
      assert.ok(metrics.composerBottom <= 960, JSON.stringify(metrics));
      if (metrics.panelWidth > 736) assert.ok(metrics.card.x >= metrics.chat.right, JSON.stringify(metrics));
      else assert.ok(metrics.card.y >= metrics.chat.bottom - 1, JSON.stringify(metrics));
      measurements.push({ theme, ...metrics });
      if (width === 1500) fs.writeFileSync(path.join(out, `${theme}-${width}.png`), (await win.webContents.capturePage()).toPNG());
    }
  }
  // Each paper has one visible passage, grouped into section tabs.
  assert.equal(await run('firstPaper().querySelectorAll("[role=tab]").length'), 2);
  assert.equal(await run('firstPaper().querySelectorAll(".agent-evidence-line-text").length'), 1);
  assert.equal(await run('firstPaper().querySelector(".agent-evidence-position").textContent'), 'Passage 1 of 2');
  assert.equal(await run('firstPaper().querySelector(".is-previous").disabled'), true);
  await run('firstPaper().querySelector(".agent-evidence-page-button:not(.is-previous)").click()');
  const selected = await run('firstPaper().querySelector(".agent-evidence-line-text").textContent');
  assert.equal(selected, 'A matched vehicle control was recorded independently for the second plate.');
  assert.equal(await run('firstPaper().querySelector(".agent-evidence-position").textContent'), 'Passage 2 of 2');
  assert.equal(await run('firstPaper().querySelector(".agent-evidence-page-button:not(.is-previous)").disabled'), true);
  assert.equal(await run('firstPaper().querySelector(".agent-evidence-comment").textContent'), 'Provides a second control passage.');
  await run('firstPaper().querySelectorAll("[role=tab]")[1].click()');
  assert.equal(await run('firstPaper().querySelector(".agent-evidence-line-text").textContent'), 'The plate reader recorded fluorescence after the incubation.');
  await run('firstPaper().querySelectorAll("[role=tab]")[0].click()');
  assert.equal(await run('firstPaper().querySelector(".agent-evidence-line-text").textContent'), selected, 'Each section retains its selected passage');
  await run('firstPaper().querySelectorAll("[role=tab]")[0].focus()');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Right'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Right'});
  await run('new Promise(resolve=>requestAnimationFrame(resolve))');
  assert.equal(await run('firstPaper().querySelectorAll("[role=tab]")[1].getAttribute("aria-selected")'), 'true');
  assert.equal(await run('document.activeElement === firstPaper().querySelectorAll("[role=tab]")[1]'), true);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Left'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Left'});
  await run('new Promise(resolve=>requestAnimationFrame(resolve))');
  // New excerpts and updated comments must not reset the reader to the first passage.
  await run(`const previous=state.agentChat.messages[1].meta.paper_evidence;
    state.agentChat.messages[1].meta.paper_evidence=[{...previous[0],line_ranges:[{start_line:20,end_line:20}],
      source_lines:[{line_number:20,content:'An earlier control was recorded before the assay.'}]},...previous.map(block=>({...block,relevance_reason:block.relevance_reason+' Updated relevance.'}))];redraw();`);
  assert.equal(await run('firstPaper().querySelector(".agent-evidence-line-text").textContent'), selected);
  assert.equal(await run('firstPaper().querySelector(".agent-evidence-position").textContent'), 'Passage 3 of 3');
  await run('firstPaper().querySelector(".agent-evidence-open-paper").click()');
  const source = await run('openedSources.at(-1)');
  assert.equal(source.path, '/test/Lab/KnowledgeBase/papers.md/p1/paper.md');
  assert.equal(source.excerpt, selected, 'The source action follows the active passage');
  // A long passage keeps navigation visible and returns to the next passage's beginning.
  await run(`window.beforeLong=state.agentChat.messages[1].meta.paper_evidence;
    state.agentChat.messages[1].meta.paper_evidence=beforeLong.map(block=>block.source_lines?.[0]?.line_number===90
      ? {...block,source_lines:[{line_number:90,content:'A long source paragraph retains all of its scientific context. '.repeat(80)}]} : block);
    redraw();dom.paperEvidence.scrollTop=dom.paperEvidence.scrollHeight;`);
  await run('new Promise(resolve=>requestAnimationFrame(resolve))');
  const toolbar = await run(`(()=>{const card=dom.paperEvidence.getBoundingClientRect();const bar=firstPaper().querySelector('.agent-evidence-reader-toolbar').getBoundingClientRect();return {top:bar.top,bottom:bar.bottom,cardTop:card.top,cardBottom:card.bottom};})()`);
  assert.ok(toolbar.top>=toolbar.cardTop-1 && toolbar.bottom<=toolbar.cardBottom,JSON.stringify(toolbar));
  await run('firstPaper().querySelector(".is-previous").click()');
  const beginning = await run(`(()=>{const bar=firstPaper().querySelector('.agent-evidence-reader-toolbar').getBoundingClientRect();const quote=firstPaper().querySelector('.agent-evidence-quote').getBoundingClientRect();return {quoteTop:quote.top,toolbarBottom:bar.bottom};})()`);
  assert.ok(beginning.quoteTop>=beginning.toolbarBottom-1,JSON.stringify(beginning));
  await run('state.agentChat.messages[1].meta.paper_evidence=beforeLong;redraw()');
  // Native paper/card disclosures still work and retain their state.
  await run(`document.querySelectorAll('.agent-evidence-paper')[1].querySelector('summary').click(); redraw();`);
  assert.equal(await run('document.querySelectorAll(".agent-evidence-paper")[1].open'), true);
  await run(`document.querySelector('.agent-evidence-heading').focus();`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
  await run('new Promise(resolve => requestAnimationFrame(resolve))');
  assert.equal(await run('document.querySelector(".agent-evidence-card").open'), false);
  await run('redraw();');
  assert.equal(await run('document.querySelector(".agent-evidence-card").open'), false);
  // A new session must not inherit the old card or its disclosure state.
  await run(`window.saved = JSON.parse(JSON.stringify(state.agentChat.messages)); state.agentChat.currentSessionId='empty'; state.agentChat.messages=[]; redraw();`);
  assert.equal(await run('dom.paperEvidence.hidden && !document.querySelector(".agent-chat-stage").classList.contains("has-paper-evidence")'), true);
  await run(`state.agentChat.currentSessionId='paper-chat'; state.agentChat.messages=saved; redraw();`);
  assert.equal(await run('document.querySelector(".agent-evidence-card").open'), true);
  assert.equal(await run('firstPaper().querySelector(".agent-evidence-position").textContent'), 'Passage 1 of 3', 'A new session starts with its first passage');
  // Paper strings remain text, including strings that resemble markup.
  await run(`state.agentChat.messages[1].meta.paper_evidence=state.agentChat.messages[1].meta.paper_evidence.map((block,i)=>i ? block : {...block,relevance_reason:'<img src=x onerror="window.injected=true">'}); redraw();`);
  assert.equal(await run('dom.paperEvidence.querySelectorAll("img,script").length'), 0);
  assert.equal(await run('document.querySelector(".agent-evidence-comment").textContent'), '<img src=x onerror="window.injected=true">');
  assert.equal(await run('window.injected === undefined'), true);
  await run(`(async () => { const {i18n}=await import(${JSON.stringify(url('src/renderer/lib/i18n/index.js'))});
    const {translateTree}=await import(${JSON.stringify(url('src/renderer/lib/i18n/dom.js'))}); i18n.setLocale('zh-Hans'); translateTree(dom.paperEvidence); })()`);
  assert.equal(await run('document.querySelector(".agent-evidence-title").textContent'), '依据');
  assert.equal(await run('document.querySelector(".agent-evidence-comment-label").textContent'), '选择原因');
  assert.equal(await run('firstPaper().querySelector(".agent-evidence-position").textContent'), '摘录 1 / 3');
  assert.equal(await run('firstPaper().querySelector(".agent-evidence-open-paper").textContent'), '在论文中打开');
  assert.equal(await run('document.querySelectorAll(".agent-evidence-paper")[1].querySelector(".agent-evidence-tab-label").textContent'), '摘录', 'Unlabelled sections have a localized tab');
  await run(`state.agentChat.messages[1].meta.paper_evidence=state.agentChat.messages[1].meta.paper_evidence.map(block=>block.paper_id==='p2'
    ? {...block,source_path:'file:///private/not-a-reader-source.md'} : block);redraw();`);
  assert.equal(await run('document.querySelectorAll(".agent-evidence-paper")[1].querySelector(".agent-evidence-open-paper")'), null, 'Untrusted source paths do not produce file actions');
  fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify({ measurements }, null, 2));
  console.log('Evidence reader Electron passed: 6 desktop day/night layouts, exact passages, section tabs, paging, keyboard access, retained selection, trusted source action, session isolation and localization.');
  win.destroy(); app.quit();
}

main().catch(error => { console.error(error); if (process.versions.electron) require('electron').app.exit(1); else process.exitCode = 1; });
