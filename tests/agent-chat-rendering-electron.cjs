'use strict';
// Native DOM verification: disclosure/focus/selection cannot be checked by the
// lightweight DOM used in the core suite. Uses sample state and no agent calls.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

async function main() {
  if (!process.versions.electron) {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename], { encoding: 'utf8', timeout: 60000 });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    assert.equal(result.status, 0, String(result.error || `Electron failed (${result.signal})`));
    return;
  }
  const { app, BrowserWindow } = require('electron');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-chat-rendering-'));
  app.setPath('userData', path.join(scratch, 'profile'));
  app.disableHardwareAcceleration();
  await app.whenReady();
  const out = path.join(root, 'artifacts/agent-chat-rendering-review');
  fs.mkdirSync(out, { recursive: true });
  const url = file => pathToFileURL(path.join(root, file)).href;
  const view = fs.readFileSync(path.join(root, 'ui/html/views/agent-view.html'), 'utf8').replace('class="view"', 'class="view is-active"');
  const fixture = path.join(scratch, 'view.html');
  fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${url('styles.css')}"><style>
    body{display:block;margin:0;height:100vh;padding:0;overflow:hidden;background:var(--theme-surface)}
    #agent-view{height:100vh}.agent-session-rail{display:none!important}.agent-chat-layout{grid-template-columns:minmax(0,1fr)!important;gap:0!important}
    .agent-chat-panel{padding:0!important}.agent-review-overlay{display:none!important}
  </style></head><body class="ui-neutral-compact theme-day">${view}</body></html>`);
  const win = new BrowserWindow({ width: 1000, height: 1000, show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  await win.loadFile(fixture);
  const run = async code => {
    const result = await win.webContents.executeJavaScript(`(async () => { try { return { value: await eval(${JSON.stringify(code)}) }; } catch (error) { return { error: error.stack }; } })()`);
    if (result.error) throw new Error(result.error);
    return result.value;
  };
  await run(`(async () => {
    const base = ${JSON.stringify(url('src/renderer/modules/agent-chat') + '/')};
    const { hydrateAgentChatIcons } = await import(base + 'icons.js');
    const { createAgentChatShellController } = await import(base + 'shell-controller.js');
    const { createHistoryActionController } = await import(base + 'history-actions.js');
    const { createAgentReviewOverlayController } = await import(base + 'review-overlay.js');
    const { collectAgentChatDom } = await import(base + 'dom-bindings.js');
    const safeText = text => String(text ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
    const draft = { proposal: { title: 'Run comparison summary', purpose: 'Record the available results and the missing attachment.', planned_materials: [], checkpoints: [] }, project: { name: 'Binding study' }, save: { mode: 'confirm_before_save', applied: false }, rendered_steps: ['Attach the Run 03 result file.', 'Compare the two runs once both files are available.'], unresolved_placeholders: [] };
    window.state = { settings: { agent: {} }, projects: [{ id: 'p', name: 'Binding study' }], notebookEntries: [], agentChat: { currentSessionId: 'sample', projectId: 'p', messages: [
      { id: 'u1', role: 'user', text: 'Compare the latest two runs and prepare a notebook summary.', createdAt: '2026-09-13T16:00:00Z' },
      { id: 'a1', role: 'assistant', text: '### Run 03 is missing its raw results.\\n\\nThe notebook has entries for both runs, but only Run 02 has an attached result file. A numerical comparison needs the Run 03 data.\\n\\n| Record | Run 02 | Run 03 |\\n| --- | --- | --- |\\n| Notebook | Recorded | Recorded |\\n| Raw results | Attached | Missing |', createdAt: '2026-09-13T16:00:08Z', meta: { notebookDraft: draft, activity_trace_rows: ['Read the project notebook', 'Checked Run 02 and Run 03', 'Prepared a summary draft'] } }
    ] } };
    window.runtime = { liveAssistantMessage: null, inFlight: false };
    window.copied = ''; window.protocolsAdded = []; window.answers = []; window.notices = [];
    const notebookDraftAdapter = {
      normalizeDraft: value => value || null, normalizeState: value => value,
      findEntryForDraft: () => state.notebookEntries[0] || null,
      createPlannedPage: value => {
        const created = !state.notebookEntries.length;
        if (created) state.notebookEntries.push({ id: 'page-1', notebookState: 'planned' });
        return { ok: true, created, entry: state.notebookEntries[0], draft: { ...value, save: { ...value.save, applied: true, status: 'approved' } } };
      }
    };
    const protocolReviewAdapter = { collectReviewProtocols: meta => meta.protocols || [], approveGeneratedProtocol: value => { protocolsAdded.push(value); return value; } };
    hydrateAgentChatIcons(document);
    window.dom = collectAgentChatDom(document, { idPrefix: 'agent' });
    window.shell = createAgentChatShellController({ dom, state, runtime, safeText, persist: () => {}, notebookDraftAdapter, protocolReviewAdapter });
    let review;
    window.historyActions = createHistoryActionController({
      api: { writeTextToClipboard: text => { copied = text; return { ok: true }; } }, state, input: dom.input,
      persist: () => {}, setStatus: text => notices.push(text), syncComposerHeight: shell.syncComposerHeight,
      renderContextSummary: () => {}, renderHistoryView: shell.renderHistoryView,
      answerAssistantQuestion: (id, text) => answers.push({ id, text }), notebookDraftAdapter, onOpenNotebookEntry: () => {},
      reviewInline: (id, item, decision) => review.reviewInline(id, item, decision)
    });
    review = createAgentReviewOverlayController({ dom, state, safeText, persist: () => {}, setStatus: text => notices.push(text), renderContextSummary: () => {}, renderHistoryView: shell.renderHistoryView, notebookActions: historyActions.notebookActions, notebookDraftAdapter, protocolReviewAdapter });
    dom.historyNode.addEventListener('click', historyActions.onHistoryClick);
    dom.questionDock.addEventListener('click', historyActions.onHistoryClick);
    shell.renderProjectOptions(); shell.renderHistoryView(); shell.syncComposerHeight();
    window.redraw = () => shell.renderHistoryView();
  })()`);
  assert.equal(await run('document.querySelectorAll("span[data-agent-chat-icon]").length'), 0);
  assert.ok(await run('document.querySelectorAll("svg.agent-chat-icon[data-agent-chat-icon]").length >= 6'));
  await run(`document.querySelector('.agent-draft-card').open = true; document.querySelector('.agent-thinking-trace').open = true; window.retainedDraft = document.querySelector('.agent-draft-card');`);
  // Unrelated streamed text must preserve open cards and selected old text.
  await run(`window.retainedText = document.querySelector('.agent-chat-markdown p').firstChild;
    const range = document.createRange(); range.setStart(retainedText, 0); range.setEnd(retainedText, 12);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    runtime.liveAssistantMessage = { id: 'live', role: 'assistant', text: 'Working…', meta: { live_progress: { response_text: 'Stable streaming text' } } }; redraw();`);
  assert.equal(await run('getSelection().toString()'), 'The notebook');
  assert.equal(await run('document.querySelector(".agent-draft-card") === retainedDraft && retainedDraft.open && document.querySelector(".agent-thinking-trace").open'), true);
  await run(`window.liveText = document.querySelector('.agent-stream-live p').firstChild;
    const range = document.createRange(); range.setStart(liveText, 0); range.setEnd(liveText, 6);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    runtime.liveAssistantMessage.meta.live_progress.response_text += ' continues without replacing its prefix.'; redraw();`);
  assert.equal(await run('document.querySelector(".agent-stream-live p").firstChild === liveText && getSelection().toString() === "Stable"'), true);
  await run('runtime.liveAssistantMessage = null; getSelection().removeAllRanges(); redraw();');
  await run('document.querySelector("[data-agent-copy-message]").click();');
  assert.equal(await run('copied === state.agentChat.messages[1].text'), true);
  await run("dom.input.value=Array.from({length:10},()=> 'A line of a longer message').join('\\n'); shell.syncComposerHeight();");
  assert.equal(await run('dom.input.getBoundingClientRect().height > 100 && dom.input.getBoundingClientRect().height <= parseFloat(getComputedStyle(dom.input).maxHeight)'), true, 'Composer grows to the resolved CSS limit, including rem values');
  await run("dom.input.value=''; shell.syncComposerHeight();");

  const measurements = [];
  for (const theme of ['day', 'night']) {
    await run(`document.body.className = 'ui-neutral-compact theme-${theme}';`);
    for (const width of [1100, 760, 390, 320]) {
      win.setContentSize(width, 1000);
      await run(`document.querySelector('.agent-draft-card').open = false; document.querySelector('.agent-thinking-trace').open = false; dom.historyNode.scrollTop = 0; shell.syncComposerHeight(); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));`);
      const metrics = await run(`(() => {
        const assistant = document.querySelector('.agent-chat-item-assistant');
        const user = document.querySelector('.agent-chat-item-user');
        const history = dom.historyNode.getBoundingClientRect(); const composer = document.querySelector('.agent-composer-card').getBoundingClientRect();
        const attach = document.querySelector('#agent-attach-btn').getBoundingClientRect(); const project = document.querySelector('#agent-project-select').getBoundingClientRect();
        return { viewport: innerWidth, documentOverflow: document.documentElement.scrollWidth > innerWidth,
          historyOverflow: dom.historyNode.scrollWidth > dom.historyNode.clientWidth, background: getComputedStyle(assistant).backgroundColor,
          assistantWidth: assistant.getBoundingClientRect().width, userWidth: user.getBoundingClientRect().width,
          historyBottom: history.bottom, composerTop: composer.top, titleWidth: document.querySelector('.agent-output-copy').getBoundingClientRect().width,
          headerHidden: getComputedStyle(user.querySelector('header')).position === 'absolute',
          composerControlHeights: { attach: attach.height, project: project.height },
          composerControlsShareRow: Math.abs(attach.top - project.top) < 1 };
      })()`);
      assert.equal(metrics.documentOverflow, false, JSON.stringify(metrics));
      assert.equal(metrics.historyOverflow, false, JSON.stringify(metrics));
      assert.equal(metrics.background, 'rgba(0, 0, 0, 0)');
      assert.ok(metrics.userWidth < metrics.assistantWidth);
      assert.ok(metrics.historyBottom <= metrics.composerTop + 1);
      assert.ok(metrics.titleWidth >= 90, JSON.stringify(metrics));
      assert.equal(metrics.headerHidden, true);
      assert.equal(metrics.composerControlHeights.attach, metrics.composerControlHeights.project, JSON.stringify(metrics));
      if (width >= 720) assert.equal(metrics.composerControlsShareRow, true, JSON.stringify(metrics));
      measurements.push({ theme, width, ...metrics });
      await new Promise(resolve => setTimeout(resolve, 100));
      if ([1100, 390].includes(width)) fs.writeFileSync(path.join(out, `${theme}-${width}.png`), (await win.webContents.capturePage()).toPNG());
    }
  }
  win.setContentSize(1000, 1000);
  await run(`document.body.className='ui-neutral-compact theme-day'; document.querySelector('.agent-draft-card').open = true; dom.historyNode.scrollTop=0; new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));`);
  await new Promise(resolve => setTimeout(resolve, 100));
  fs.writeFileSync(path.join(out, 'notebook-review.png'), (await win.webContents.capturePage()).toPNG());
  await run(`document.querySelector('[data-agent-create-planned-page]').click();`);
  assert.equal(await run('state.notebookEntries.length'), 1);
  assert.equal(await run('Boolean(document.querySelector("[data-agent-open-notebook-page]"))'), true);
  await run(`state.agentChat.messages.push({id:'protocol-message', role:'assistant', text:'The protocol draft is ready to review.', meta:{protocols:[{name:'Sample protocol',purpose:'Rendering fixture',materials:[],steps:[{text:'Review the sample record.'}]}]}}); redraw(); window.protocolButton=document.querySelector('[data-agent-inline-approve]'); protocolButton.click();`);
  assert.equal(await run('protocolsAdded.length'), 1);
  await run('historyActions.onHistoryClick({ target: protocolButton });');
  assert.equal(await run('protocolsAdded.length'), 1, 'stale protocol approval must be idempotent');
  await run(`state.agentChat.messages.push({id:'question',role:'assistant',text:'One clarification.',meta:{codex_agent:{status:'needs_more_info'},user_question:{question:'How should I handle the missing file?',options:[{label:'Summarize available records',value:'summary'}],allow_custom:true}}}); redraw(); window.answerInput=document.querySelector('[data-agent-question-custom-input]'); answerInput.value='Keep the missing data explicit'; answerInput.focus(); answerInput.setSelectionRange(4,11); redraw();`);
  assert.equal(await run('document.activeElement === answerInput && answerInput.value === "Keep the missing data explicit" && answerInput.selectionStart === 4'), true);
  await run('document.querySelector("[data-agent-question-submit]").click();');
  assert.equal(await run('answers.at(-1).text'), 'Keep the missing data explicit');
  // Long histories should not drag a reader back to the latest message.
  await run(`state.agentChat.messages=Array.from({length:40},(_,i)=>({id:'long-'+i,role:i%2?'assistant':'user',text:'Example message '+i})); redraw(); dom.historyNode.scrollTop=100; state.agentChat.messages.push({id:'last',role:'assistant',text:'New message'}); redraw();`);
  assert.equal(await run('dom.historyNode.scrollTop'), 100);
  // Opening a saved session deliberately anchors its latest content after the
  // layout is final, rather than leaving a partially visible first message.
  await run(`shell.renderHistoryView({ forceScroll: true }); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));`);
  assert.equal(await run('dom.historyNode.scrollHeight - dom.historyNode.scrollTop - dom.historyNode.clientHeight <= 1'), true);
  await run('state.agentChat.messages=[]; redraw();');
  assert.equal(await run('dom.conversationShell.classList.contains("is-empty-chat")'), true);
  fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify({ measurements, checks: ['selection during streaming', 'stable disclosures', 'copy', 'inline notebook approval', 'protocol approval idempotency', 'clarification focus and custom answer', 'scroll anchoring', 'empty conversation'] }, null, 2));
  console.log('Agent Chat Electron: 8 day/night layouts, streaming selection, stable cards, copy, inline approvals, clarification, scroll anchoring and empty state passed.');
  win.destroy(); app.quit();
}

main().catch(error => { console.error(error); if (process.versions.electron) require('electron').app.exit(1); else process.exitCode = 1; });
