// Disposable Electron fixture: exercises the public MCP bridge and real
// pointer input, without touching the user's illustration library.
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

async function verifyGrouping({ tool, evaluate, check, win, pause, temp }) {
  const read = () => tool({ action: 'read', include_assets: true });
  const original = await read();
  let result = await tool({ action: 'create', title: 'Grouping QA', expected_library_revision: original.library_revision, request_id: randomUUID() });
  check(result.ok, result.error || 'Create isolated grouping fixture');
  const apply = async operations => {
    const current = await read();
    const result = await tool({ action: 'apply', illustration_id: current.illustration_id, expected_revision: current.revision, request_id: randomUUID(), operations });
    check(result.ok, result.error || 'Group operation persists through MCP'); await pause(60); return result;
  };
  win.setSize(1300, 1000); await pause(80);
  const raster = await evaluate('(()=>{const c=document.createElement("canvas");c.width=c.height=2;c.getContext("2d").fillRect(0,0,2,2);return c.toDataURL()})()');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#56a7a5"/></svg>';
  await apply([
    { op: 'upsert', object: { id: 'group-a', name: 'Membrane', type: 'vector', x: 80, y: 80, width: 140, height: 80, rotation: 37, svg } },
    { op: 'upsert', object: { id: 'group-b', name: 'Cargo', type: 'vector', x: 260, y: 120, width: 90, height: 70, rotation: -12, svg } },
    { op: 'upsert', object: { id: 'group-text', name: 'ER label', type: 'text', x: 90, y: 240, width: 200, height: 40, fontSize: 24, fontFamily: 'Inter', text: 'Rough ER' } },
    { op: 'upsert', object: { id: 'group-image', name: 'Raster inset', type: 'raster', x: 400, y: 80, width: 80, height: 60, dataUrl: raster, textFree: true } }
  ]);
  const initial = await read(), beforeImage = await tool({ action: 'render', canvas: 'both' });
  const selection = () => evaluate('[...document.querySelectorAll("#layers .layer-select[aria-pressed=true]")].map(b=>b.closest("[data-layer-id]").dataset.layerId)');
  const clickToolbar = async id => {
    const target = await evaluate(`(()=>{const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    win.webContents.debugger.attach('1.3');
    try {
      for (const type of ['mousePressed', 'mouseReleased']) await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, ...target, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
      await pause(80);
    } finally { win.webContents.debugger.detach(); }
  };
  check(await evaluate('document.getElementById("group-selection").disabled && document.getElementById("ungroup-selection").disabled'), 'Grouping toolbar disables both actions without a selection');
  await evaluate('document.querySelector("[data-layer-id=group-a] .layer-select").click()');
  check(await evaluate('document.getElementById("group-selection").disabled && document.getElementById("ungroup-selection").disabled'), 'An independent single layer cannot be grouped or ungrouped');
  await evaluate('document.querySelector("[data-layer-id=group-a] .layer-select").click();document.querySelector("[data-layer-id=group-b] .layer-select").dispatchEvent(new MouseEvent("click",{bubbles:true,shiftKey:true}));document.querySelector("[data-layer-id=group-text] .layer-select").dispatchEvent(new MouseEvent("click",{bubbles:true,shiftKey:true}));document.querySelector("[data-layer-id=group-image] .layer-select").dispatchEvent(new MouseEvent("click",{bubbles:true,shiftKey:true}))');
  check((await selection()).length === 4, 'Shift-click selects four independent layer types');
  check(await evaluate('!document.getElementById("group-selection").disabled && document.querySelectorAll("#main-canvas .resize-handle").length===8'), 'Multi-selection has group controls and eight shared handles');
  await evaluate('document.getElementById("close-layers").click()');
  await clickToolbar('group-selection');
  let grouped = await read(), group = grouped.groups[0];
  check(group?.ids.length === 4 && JSON.stringify(grouped.objects) === JSON.stringify(initial.objects), 'UI grouping preserves every object property');
  check(await evaluate('document.getElementById("layer-inspector").hidden && document.getElementById("group-selection").disabled && !document.getElementById("ungroup-selection").disabled'), 'Toolbar grouping works with Layers closed and switches enabled actions');
  const afterImage = await tool({ action: 'render', canvas: 'both' });
  check(JSON.stringify(beforeImage.content.filter(c => c.type === 'image')) === JSON.stringify(afterImage.content.filter(c => c.type === 'image')), 'Grouping leaves both rendered canvases pixel-identical');
  await fs.writeFile(path.join(temp, 'grouping-toolbar.png'), (await win.webContents.capturePage()).toPNG());
  await clickToolbar('ungroup-selection');
  const toolbarUngrouped = await read();
  check(toolbarUngrouped.groups.length === 0 && JSON.stringify(toolbarUngrouped.objects) === JSON.stringify(initial.objects), 'Toolbar ungrouping releases children without changing geometry or styling');
  check(await evaluate('document.getElementById("layer-inspector").hidden && !document.getElementById("group-selection").disabled && document.getElementById("ungroup-selection").disabled'), 'Toolbar ungrouping keeps Layers closed and restores Group for the retained selection');
  await evaluate('document.getElementById("undo").click()'); await pause(80);
  check((await read()).groups[0]?.id === group.id && await evaluate('document.getElementById("group-selection").disabled && !document.getElementById("ungroup-selection").disabled'), 'Undo restores group membership and toolbar availability');
  await evaluate('document.getElementById("layers-tab").click()');
  await evaluate('document.querySelector("#properties [name=name]").value="ER component";document.querySelector("#properties [name=name]").dispatchEvent(new Event("change",{bubbles:true}))'); await pause(80);
  grouped = await read(); group = grouped.groups[0];
  check(group.name === 'ER component' && await evaluate(`Boolean(document.querySelector('[data-layer-id="${group.id}"] .layer-select'))`), 'Named group is shown above its independently selectable child rows');
  await evaluate('document.getElementById("close-layers").click();document.getElementById("zoom-fit").click();document.getElementById("zoom-in").click();document.getElementById("zoom-in").click()');
  const center = id => evaluate(`(()=>{const g=document.querySelector('#main-canvas [data-object-id="${id}"]'),r=g.querySelector('.object-hit'),m=g.getScreenCTM(),p=new DOMPoint(Number(r.getAttribute('width'))/2,Number(r.getAttribute('height'))/2).matrixTransform(m);return {x:p.x,y:p.y}})()`);
  const handle = direction => evaluate(`(()=>{const h=document.querySelector('#main-canvas [data-resize-direction=${direction}]'),r=h.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  const zoom = await evaluate('(()=>{const m=document.querySelector("#main-canvas > svg").getScreenCTM();return Math.hypot(m.a,m.b)})()');
  win.webContents.debugger.attach('1.3');
  const mouse = async (type, p, modifiers = 0) => {
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, modifiers, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1 });
    await pause(30);
  };
  try {
    // Clear, then click one member: the whole group must be selected.
    await evaluate('document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    let p = await center('group-a'); await mouse('mousePressed', p); await mouse('mouseReleased', p);
    check((await selection()).filter(id => !id.startsWith('group-') || group.ids.includes(id)).length === 4 && await evaluate('document.getElementById("layer-inspector").hidden'), 'A canvas member click selects its group without opening the inspector');
    const beforeMove = await read(); p = await center('group-a');
    await mouse('mousePressed', p); await mouse('mouseMoved', { x: p.x + 30, y: p.y + 18 }); await mouse('mouseReleased', { x: p.x + 30, y: p.y + 18 }); await pause(80);
    const moved = await read();
    check(moved.objects.every((o, i) => Math.abs(o.x - beforeMove.objects[i].x - 30 / zoom) < 0.01 && Math.abs(o.y - beforeMove.objects[i].y - 18 / zoom) < 0.01), 'Dragging a group at zoom translates each member exactly once in canvas units');
    const anchor = await handle('nw'), start = await handle('se');
    await mouse('mousePressed', start); await mouse('mouseMoved', { x: start.x + 36, y: start.y + 25 }); await mouse('mouseReleased', { x: start.x + 36, y: start.y + 25 }); await pause(80);
    const resized = await read(), fixed = await handle('nw'), ratio = resized.objects[0].width / moved.objects[0].width;
    check(Math.hypot(anchor.x - fixed.x, anchor.y - fixed.y) < 0.1, 'Group resize fixes its opposite anchor despite rotated children');
    check(resized.objects.every((o, i) => Math.abs(o.width / moved.objects[i].width - ratio) < 1e-8 && Math.abs(o.height / moved.objects[i].height - ratio) < 1e-8 && o.rotation === moved.objects[i].rotation)
      && Math.abs(resized.objects.find(o => o.id === 'group-text').fontSize / 24 - ratio) < 1e-8, 'Mixed group resize preserves every member ratio, rotation and text typography');
    await fs.writeFile(path.join(temp, 'grouping-selection.png'), (await win.webContents.capturePage()).toPNG());
    p = await center('group-image'); await mouse('mousePressed', p, 1); await mouse('mouseReleased', p, 1);
    check(JSON.stringify(await selection()) === JSON.stringify(['group-image']), 'Alt-click selects the raster member independently');
    // Native Shift-pointer selection works outside the Layers panel too.
    p = await center('group-text'); await mouse('mousePressed', p, 9); await mouse('mouseReleased', p, 9);
    check((await selection()).length === 2, 'Alt-Shift-click adds a second individual component on the canvas');
  } finally { win.webContents.debugger.detach(); }
  await evaluate('document.querySelector("[data-layer-id=group-text] .layer-select").click();document.getElementById("label-content").value="Edited label";document.getElementById("label-content").dispatchEvent(new Event("change",{bubbles:true}))'); await pause(80);
  let edited = await read();
  check(edited.objects.find(o => o.id === 'group-text').text === 'Edited label' && edited.groups[0].ids.length === 4, 'Editing a child label preserves its group');
  await evaluate(`document.querySelector('[data-layer-id="${group.id}"] .layer-select').click();document.getElementById('duplicate').click()`); await pause(100);
  const duplicated = await read(), copy = duplicated.groups.find(item => item.id !== group.id);
  check(copy?.ids.length === 4 && copy.ids.every(id => !group.ids.includes(id)), 'Group duplicate creates fresh member IDs and preserves membership');
  check(copy.ids.every((id, index) => { const o = duplicated.objects.find(o => o.id === id), old = edited.objects[index]; return Math.abs(o.x - old.x - 15) < 1e-8 && Math.abs(o.y - old.y - 15) < 1e-8; }), 'Group duplicate offsets every member once');
  await apply([{ op: 'delete', id: copy.id }]);
  await evaluate(`document.querySelector('[data-layer-id="${group.id}"] .layer-select').click();document.getElementById('transfer').click()`); await pause(100);
  let transferred = await read(), scratchGroup = transferred.groups.find(item => item.canvas === 'scratch');
  check(scratchGroup?.ids.length === 4 && transferred.scratch_visible, 'Copy-to-scratch retains grouping and summons scratch');
  const scratchMembers = transferred.objects.filter(o => scratchGroup.ids.includes(o.id));
  check(scratchMembers.every((o, i) => o.x === edited.objects[i].x && o.y === edited.objects[i].y && o.width === edited.objects[i].width && o.height === edited.objects[i].height), 'Scratch group copy retains exact canvas-unit geometry');
  await apply([{ op: 'transfer', id: scratchGroup.id, canvas: 'main' }]);
  transferred = await read(); check(transferred.groups.find(item => item.id === scratchGroup.id).canvas === 'main', 'Agent transfers every group member together');
  await apply([{ op: 'delete', id: scratchGroup.id }]);
  await evaluate(`document.querySelector('[data-layer-id="${group.id}"] .layer-select').click();document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'g',ctrlKey:true,shiftKey:true,bubbles:true}))`); await pause(80);
  const ungrouped = await read(); check(ungrouped.groups.length === 0 && JSON.stringify(ungrouped.objects) === JSON.stringify(edited.objects), 'Ctrl-Shift-G ungroups without moving or flattening children');
  await evaluate('document.getElementById("undo").click()'); await pause(80);
  check((await read()).groups[0].id === group.id, 'Undo restores grouping');
  await evaluate('document.getElementById("redo").click()'); await pause(80);
  check((await read()).groups.length === 0, 'Redo restores ungrouping');
  await evaluate('document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"g",metaKey:true,bubbles:true}))'); await pause(80);
  const regrouped = await read(); check(regrouped.groups.length === 1, 'Command-G groups the retained multi-selection');
  await evaluate('document.getElementById("export-svg").click()'); await pause(100);
  const source = await fs.readFile(path.join(temp, 'Grouping_QA.svg'), 'utf8');
  check(source.includes('data-illustration-groups') && source.includes('data-group-id') && source.includes('<text') && source.includes('<image'), 'SVG export retains group metadata plus independent editable text and raster');
  await evaluate('window.groupingQaBeforeReload=true;location.reload()');
  let reloadReady = false;
  for (let i = 0; i < 100; i++) {
    if (await evaluate('!window.groupingQaBeforeReload && Boolean(window.illustrationWorkspace?.getDocument())').catch(() => false)) { reloadReady = true; break; }
    await pause(30);
  }
  check(reloadReady, 'Reload reaches a newly initialized plugin document');
  await evaluate('illustrationWorkspace.ready.then(()=>true)');
  const reloaded = await read(); check(JSON.stringify(reloaded.groups) === JSON.stringify(regrouped.groups) && JSON.stringify(reloaded.objects) === JSON.stringify(regrouped.objects), 'Groups, bounds and artwork survive plugin reload');
  result = await tool({ action: 'open', illustration_id: original.illustration_id, expected_library_revision: reloaded.library_revision, request_id: randomUUID() });
  check(result.ok, result.error || 'Restore previous isolated figure after grouping fixture');
}
module.exports = { verifyGrouping };
