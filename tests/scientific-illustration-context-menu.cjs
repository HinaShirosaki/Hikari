// Real pointer/keyboard input in disposable plugin storage. Clipboard data stays
// inside the fixture so exercising Copy never replaces the user's clipboard.
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

async function verifyContextMenu({ tool, evaluate, check, win, pause, temp }) {
  const read = () => tool({ action: 'read', include_assets: true });
  const settle = async () => { await pause(40); await evaluate('illustrationWorkspace.flush().then(()=>true)'); await pause(40); return read(); };
  const selection = () => evaluate('[...document.querySelectorAll("#layers .layer-select[aria-pressed=true]")].map(button=>button.closest("[data-layer-id]").dataset.layerId)');
  const availability = () => evaluate('Object.fromEntries([...document.querySelectorAll("#canvas-context-menu [data-context-action]")].map(button=>[button.dataset.contextAction,!button.disabled]))');
  const center = selector => evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  const object = id => center(`#main-canvas [data-object-id="${id}"] .object-hit`);
  const chooseLayers = async ids => {
    await evaluate(`if(document.getElementById('layers-panel').hidden)document.getElementById('layers-tab').click();
      ${ids.map((id, index) => `document.querySelector('[data-layer-id="${id}"] .layer-select').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:${index > 0}}));`).join('\n')}
      document.getElementById('close-layers').click();document.getElementById('main-canvas').focus();`);
    await pause(80);
  };
  await evaluate(`window.qaContextClipboard='';document.execCommand=action=>{
    const data=new DataTransfer();if(action==='paste')data.setData('text/plain',qaContextClipboard);
    const event=new ClipboardEvent(action,{bubbles:true,cancelable:true,clipboardData:data});
    document.activeElement.dispatchEvent(event);
    if(action==='copy')qaContextClipboard=data.getData('text/plain');return event.defaultPrevented;
  };`);
  win.webContents.debugger.attach('1.3');
  const mouse = async (p, button = 'right', modifiers = 0) => {
    for (const type of ['mousePressed', 'mouseReleased']) await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type, ...p, button, buttons: type === 'mousePressed' ? button === 'right' ? 2 : 1 : 0, clickCount: 1, modifiers
    });
    await pause(40);
  };
  const key = async (key, code, modifiers = 0) => {
    for (const type of ['rawKeyDown', 'keyUp']) await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type, key, windowsVirtualKeyCode: code, modifiers });
    await pause(30);
  };
  const clickAction = async action => { await mouse(await center(`#canvas-context-menu [data-context-action="${action}"]`), 'left'); return settle(); };
  const menuHidden = () => evaluate('document.getElementById("canvas-context-menu").hidden');
  try {
    const empty = await center('#main-canvas'); await mouse(empty);
    let available = await availability();
    check(!await menuHidden() && available.paste && !available.copy && !available.group && !available.ungroup && !available['save-asset'], 'Empty canvas opens a menu with only Paste available');
    await key('Escape', 27);
    check(await menuHidden() && await evaluate('document.activeElement.id==="main-canvas"'), 'Escape closes the menu and returns focus to canvas');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><ellipse cx="50" cy="30" rx="48" ry="28" fill="#70aca7"/></svg>';
    let before = await read();
    const result = await tool({ action: 'apply', illustration_id: before.illustration_id, expected_revision: before.revision, request_id: randomUUID(), operations: [
      { op: 'upsert', object: { id: 'context-shape', type: 'vector', name: 'Membrane', x: 180, y: 120, width: 160, height: 100, rotation: 15, svg } },
      { op: 'upsert', object: { id: 'context-label', type: 'text', name: 'Membrane label', text: 'Membrane α', x: 200, y: 280, width: 240, height: 40, fontSize: 25 } },
      { op: 'upsert', object: { id: 'context-other', type: 'vector', name: 'Separate component', x: 650, y: 450, width: 90, height: 60, svg } }
    ] });
    check(result.ok, result.error || 'Create editable context menu fixture'); before = await read();
    await mouse(await object('context-shape')); available = await availability();
    check(JSON.stringify(await selection()) === JSON.stringify(['context-shape']) && available.copy && available['save-asset'] && !available.group && !available.ungroup, 'Right-click selects an unselected component and enables its actions');
    check((await read()).revision === before.revision, 'Opening the menu does not move components or save an edit');
    await mouse(await center('#figure-title'), 'left');
    check(await menuHidden() && await evaluate('document.activeElement.id==="figure-title"'), 'Outside click dismisses the menu and permits text-field focus');
    check(await evaluate(`(()=>{const event=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});document.getElementById('figure-title').dispatchEvent(event);return !event.defaultPrevented})()`) && await menuHidden(), 'Text fields keep their native right-click menus');
    await chooseLayers(['context-shape', 'context-label']);
    await mouse(await center('#main-canvas [data-resize-direction=se]'));
    check((await selection()).length === 2 && (await availability()).group, 'Right-clicking a shared selection handle keeps its real members');
    await key('Escape', 27);
    await mouse(await object('context-shape')); available = await availability();
    check((await selection()).length === 2 && available.group && !available.ungroup, 'Right-clicking a selected member retains the multi-selection');
    await key('ArrowDown', 40); await key('ArrowDown', 40);
    check(await evaluate('document.activeElement.dataset.contextAction==="group"') && (await read()).revision === before.revision, 'Menu arrows navigate actions without moving the selection');
    await key('Enter', 13); let grouped = await settle(), group = grouped.groups[0];
    check(await menuHidden() && group?.ids.length === 2 && JSON.stringify(grouped.objects) === JSON.stringify(before.objects), 'Enter groups the selection without changing artwork or geometry');
    await key('Escape', 27); await mouse(await object('context-shape')); available = await availability();
    check((await selection()).includes(group.id) && available.ungroup && !available.group, 'Right-click on a group member selects the complete group');
    await key('Escape', 27); await mouse(await object('context-shape'), 'left', 2);
    check(!await menuHidden() && (await read()).revision === grouped.revision, 'Mac Control-click opens the menu without starting a drag');
    await fs.writeFile(path.join(temp, 'context-menu-group.png'), (await win.webContents.capturePage()).toPNG());
    let ungrouped = await clickAction('ungroup');
    check(ungrouped.groups.length === 0 && JSON.stringify(ungrouped.objects) === JSON.stringify(before.objects), 'Ungroup from the menu keeps all editable components in place');
    await evaluate('illustrationWorkspace.history("undo")'); await settle();
    await mouse(await object('context-shape')); await clickAction('copy');
    check(await evaluate('JSON.parse(qaContextClipboard).objects.length===2 && JSON.parse(qaContextClipboard).groups.length===1'), 'Menu Copy uses the editable group clipboard');
    const blank = await evaluate('(()=>{const svg=document.querySelector("#main-canvas > svg"),p=new DOMPoint(1000,700).matrixTransform(svg.getScreenCTM());return {x:p.x,y:p.y}})()');
    await mouse(blank); let pasted = await clickAction('paste');
    const copy = pasted.groups.find(item => item.id !== group.id);
    check(pasted.objects.length === 5 && copy?.ids.length === 2 && copy.ids.every(id => !group.ids.includes(id)), 'Menu Paste inserts independent editable group copies');
    check(pasted.objects.filter(item => copy.ids.includes(item.id)).every((item, index) => item.x === before.objects[index].x + 15 && item.y === before.objects[index].y + 15), 'Menu Paste preserves relative layout with the shared clipboard offset');
    await evaluate('illustrationWorkspace.history("undo")'); await settle();
    check((await read()).objects.length === 3 && (await read()).groups.length === 1, 'Menu paste is a single undoable edit');
    await mouse(await object('context-shape')); const beforeAsset = await clickAction('save-asset');
    check(await menuHidden() && await evaluate('document.getElementById("save-asset-dialog").open && document.activeElement.id==="asset-name"'), 'Save as an asset opens the existing naming dialog');
    await evaluate('document.getElementById("asset-name").value="Context membrane";document.getElementById("save-asset-form").requestSubmit()'); await settle();
    const list = await tool({ action: 'asset_list' }), asset = list.reusable_assets.find(item => item.name === 'Context membrane');
    check(asset?.objectCount === 2 && (await read()).revision === beforeAsset.revision, 'Menu asset save persists editable components without changing the canvas revision');
    const saved = await tool({ action: 'asset_read', asset_id: asset.id, include_assets: true });
    check(saved.component.objects.some(item => item.type === 'text' && item.text === 'Membrane α') && saved.component.objects.some(item => item.type === 'vector'), 'Saved menu asset preserves artwork and independent text');
    await evaluate('document.getElementById("main-canvas").focus()'); await key('Escape', 27);
    await evaluate('document.getElementById("layers-tab").click()');
    await mouse(await center('[data-layer-id=context-label] .layer-select'));
    check(JSON.stringify(await selection()) === JSON.stringify(['context-label']) && !(await availability()).ungroup, 'Layer row menu targets an individual child');
    await key('Escape', 27);
    await chooseLayers([group.id]); await mouse(await object('context-shape'), 'right', 1);
    check(JSON.stringify(await selection()) === JSON.stringify(['context-shape']), `Alt-right-click targets one member of a canvas group: ${JSON.stringify(await selection())}`);
    await key('Escape', 27); await chooseLayers(['context-label', 'context-other']);
    await evaluate('document.getElementById("layers-tab").click()');
    await mouse(await center('[data-layer-id=context-label] .layer-select'));
    check((await selection()).length === 2, 'Layer row menu also preserves an existing multi-selection');
    await key('Escape', 27); await evaluate('document.getElementById("close-layers").click();document.getElementById("main-canvas").focus()');
    await key('F10', 121, 8);
    check(!await menuHidden(), 'Shift+F10 opens the menu from the focused canvas');
    await key('End', 35);
    check(await evaluate('document.activeElement.dataset.contextAction==="save-asset"'), 'End focuses the last available menu item');
    await key('Escape', 27);
    await evaluate(`document.body.classList.add('theme-night');document.getElementById('main-canvas').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:innerWidth-1,clientY:innerHeight-1}));`);
    check(await evaluate('(()=>{const r=document.getElementById("canvas-context-menu").getBoundingClientRect();return r.left>=8 && r.top>=8 && r.right<=innerWidth-7 && r.bottom<=innerHeight-7})()'), 'Menu stays inside the viewport at its bottom-right corner');
    await fs.writeFile(path.join(temp, 'context-menu-night.png'), (await win.webContents.capturePage()).toPNG());
    await evaluate('document.getElementById("main-canvas").dispatchEvent(new Event("scroll"))');
    check(await menuHidden(), 'Panning dismisses the menu');
    await mouse(await object('context-shape'));
    await evaluate('illustrationWorkspace.history("redo")'); await settle();
    check(await menuHidden(), 'A scene revision change dismisses stale menu actions');
    await evaluate('document.body.classList.remove("theme-night")');
  } finally { win.webContents.debugger.detach(); }
}

module.exports = { verifyContextMenu };
