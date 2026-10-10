const { randomUUID } = require('node:crypto');

async function verifySystemHistory({ tool, evaluate, check, win, pause }) {
  const host = code => win.webContents.executeJavaScript(code);
  const read = () => tool({ action: 'read', include_assets: true });
  const apply = async operations => {
    const current = await read();
    const result = await tool({ action: 'apply', illustration_id: current.illustration_id,
      expected_revision: current.revision, request_id: randomUUID(), operations });
    check(result.ok, result.error || 'Save system-history fixture'); await pause(70); return result;
  };
  const buttons = () => host('({undo:document.getElementById("global-undo-btn").disabled,redo:document.getElementById("global-redo-btn").disabled})');
  const focusCanvas = async () => {
    await evaluate('document.getElementById("main-canvas").focus()');
    // The hidden fixture does not emit an OS window-blur event for a scripted
    // frame focus. Refresh the real delegate after that programmatic step.
    await host('qaHistoryDelegate.refresh()'); await pause(50);
  };
  const settled = async () => { await pause(70); await evaluate('illustrationWorkspace.flush().then(()=>true)'); await pause(30); return read(); };
  win.webContents.debugger.attach('1.3');
  const click = async command => {
    const p = await host(`(()=>{const r=document.getElementById('global-${command}-btn').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    for (const type of ['mousePressed', 'mouseReleased']) await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, ...p, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    return settled();
  };
  const key = async (letter, modifiers = 2) => {
    for (const type of ['rawKeyDown', 'keyUp']) await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
      type, key: letter, code: `Key${letter.toUpperCase()}`, windowsVirtualKeyCode: letter.toUpperCase().charCodeAt(0), modifiers
    });
    return settled();
  };
  try {
    await host('qaHostHistoryState.value=1;qaUndoService.persist()');
    await focusCanvas();
    const focus = await host('({tag:document.activeElement.tagName,view:document.body.dataset.activeView,claim:qaHistoryDelegate.claim(),reported:qaBridge.getFrameHistory(document.querySelector("iframe.plugin-frame").contentWindow)})');
    check((await buttons()).undo && (await buttons()).redo, `An empty focused Figura disables system history despite an existing host undo step: ${JSON.stringify(focus)}`);
    const empty = await read(); await click('undo');
    check((await read()).revision === empty.revision && await host('qaHostHistoryState.value===1'), 'Disabled Figura Undo never rolls back another module');
    const initial = await apply([
      { op: 'upsert', object: { id: 'history-art', type: 'vector', x: 120, y: 160, width: 180, height: 120,
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#73b4aa"/></svg>' } },
      { op: 'upsert', object: { id: 'history-label', type: 'text', text: 'Editable label', x: 140, y: 300, fontSize: 24 } },
      { op: 'group', id: 'history-group', name: 'Labeled component', ids: ['history-art', 'history-label'] }
    ]);
    check(!(await buttons()).undo && (await buttons()).redo, 'app.setHistory enables only the system Undo button after an edit');
    const edited = await apply([{ op: 'rotate', id: 'history-group', degrees: 35 }, { op: 'update', id: 'history-label', patch: { italic: true } }]);
    let result = await click('undo');
    check(JSON.stringify(result.objects) === JSON.stringify(initial.objects) && result.groups[0].id === 'history-group', 'A real system Undo click restores the group geometry and independent label');
    check(!(await buttons()).undo && !(await buttons()).redo, 'Both system buttons update after an undo');
    result = await click('undo');
    check(result.objects.length === 0 && result.groups.length === 0 && await host('qaHostHistoryState.value===1'), 'Repeated system Undo stays within Figura and preserves host state');
    check((await buttons()).undo && !(await buttons()).redo, 'Exhausted Figura Undo stays disabled while Redo remains available');
    await click('redo'); result = await click('redo');
    check(JSON.stringify(result.objects) === JSON.stringify(edited.objects), 'System Redo restores the final editable components');
    check(!(await buttons()).undo && (await buttons()).redo, 'Redo exhaustion is reported back to Hikari');
    await focusCanvas(); result = await key('z');
    check(JSON.stringify(result.objects) === JSON.stringify(initial.objects), 'Ctrl-Z inside the iframe performs exactly one Figura undo');
    result = await key('y');
    check(JSON.stringify(result.objects) === JSON.stringify(edited.objects), 'Ctrl-Y inside the iframe matches Gel and the system redo shortcut');
    await evaluate('document.getElementById("figure-title").focus();window.qaNativeUndo=new KeyboardEvent("keydown",{key:"z",ctrlKey:true,bubbles:true,cancelable:true});document.activeElement.dispatchEvent(qaNativeUndo)');
    check(await evaluate('!qaNativeUndo.defaultPrevented') && (await read()).revision === result.revision, 'Focused text fields retain native undo instead of changing scene history');
    await focusCanvas();
    await host('window.failSave=true'); const beforeFailure = await read(); result = await click('undo');
    check(result.revision === beforeFailure.revision && !(await buttons()).undo && await host('qaHostHistoryState.value===1'), 'A failed system Undo keeps scene, stack and host history unchanged');
    await host('window.failSave=false'); result = await click('undo');
    check(JSON.stringify(result.objects) === JSON.stringify(initial.objects), 'System Undo retries the same step after a save failure');
    await host('document.body.dataset.activeView="papers-view"'); await pause(60); await click('undo');
    check(await host('qaHostHistoryState.value===0') && JSON.stringify((await read()).objects) === JSON.stringify(initial.objects), 'Changing views returns the buttons to host history without touching hidden Figura');
    const viewId = await host('qaRegistry[0].viewId'); await host(`document.body.dataset.activeView=${JSON.stringify(viewId)}`);
    await focusCanvas();
    check(!(await buttons()).undo && !(await buttons()).redo, 'Returning to the editor restores its own independent history');
    const created = await tool({ action: 'create', title: 'Empty history', expected_library_revision: result.library_revision, request_id: randomUUID() });
    check(created.ok, created.error || 'Open another illustration'); await pause(80);
    check((await buttons()).undo && (await buttons()).redo && !await evaluate('Boolean(document.querySelector("#undo,#redo"))'), 'Changing illustrations resets system history and never recreates duplicate buttons');
  } finally { win.webContents.debugger.detach(); }
}

module.exports = { verifySystemHistory };
