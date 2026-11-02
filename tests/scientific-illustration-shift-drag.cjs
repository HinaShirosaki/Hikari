const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

async function verifyShiftDrag({ tool, evaluate, check, win, pause, temp }) {
  const read = () => tool({ action: 'read' });
  const object = (doc, id = 'shift-a') => doc.objects.find(item => item.id === id);
  const apply = async operations => {
    const current = await read();
    const result = await tool({ action: 'apply', illustration_id: current.illustration_id, expected_revision: current.revision,
      request_id: randomUUID(), operations });
    check(result.ok, result.error || 'Save Shift gesture fixture'); await pause(50);
  };
  const selection = () => evaluate('[...document.querySelectorAll("[data-object-id][aria-pressed=true]")].map(node=>node.dataset.objectId).sort()');
  const select = async ids => {
    await evaluate(`(()=>{const ids=${JSON.stringify(ids)};ids.forEach((id,i)=>document.querySelector('[data-layer-id="'+id+'"] .layer-select').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:i>0})));document.getElementById('close-layers').click();document.getElementById('zoom-fit').click()})()`);
    await pause(50);
  };
  const geometry = id => evaluate(`(()=>{const hit=document.querySelector('[data-object-id="${id}"] .object-hit'),r=hit.getBoundingClientRect(),m=document.querySelector('#main-canvas>svg').getScreenCTM();return {x:r.left+r.width/2,y:r.top+r.height/2,scale:Math.hypot(m.a,m.b)}})()`);
  const mouse = async (type, p, modifiers = 0) => {
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, modifiers, button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1 }); await pause(30);
  };
  const click = async (id, modifiers = 0) => { const p = await geometry(id); await mouse('mousePressed', p, modifiers); await mouse('mouseReleased', p, modifiers); };
  const begin = async (id, dx, dy, downModifiers = 8, moveModifiers = 8) => {
    const start = await geometry(id), end = { x: start.x + dx * start.scale, y: start.y + dy * start.scale };
    await mouse('mousePressed', start, downModifiers); await mouse('mouseMoved', end, moveModifiers); return { start, end };
  };
  const finish = async (end, modifiers = 8) => { await mouse('mouseReleased', end, modifiers); await evaluate('illustrationWorkspace.flush().then(()=>true)'); return read(); };
  const undo = async before => {
    await evaluate('illustrationWorkspace.history("undo")'); await pause(60);
    check(JSON.stringify((await read()).objects) === JSON.stringify(before.objects), 'One undo restores the entire constrained move');
  };
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><rect width="100" height="60" fill="#75aaa3"/></svg>';
  await tool({ action: 'asset_list' });
  await apply([
    { op: 'upsert', object: { id: 'shift-a', type: 'vector', name: 'Cell', svg, x: 180, y: 180, width: 100, height: 60 } },
    { op: 'upsert', object: { id: 'shift-b', type: 'vector', name: 'Vesicle', svg, x: 400, y: 184, width: 100, height: 60 } }
  ]);
  win.setSize(1300, 950); await pause(80);
  await evaluate('document.getElementById("close-layers").click();document.getElementById("smart-guides").checked=false');
  win.webContents.debugger.attach('1.3');
  try {
    const beforeClicks = await read();
    await click('shift-a'); await click('shift-b', 8);
    check(JSON.stringify(await selection()) === JSON.stringify(['shift-a', 'shift-b']), 'Shift-click adds another component');
    await click('shift-a', 8);
    check(JSON.stringify(await selection()) === JSON.stringify(['shift-b']), 'Shift-click removes an already-selected component');
    await click('shift-b', 8);
    check((await selection()).length === 0 && (await read()).revision === beforeClicks.revision, 'Shift-click can clear the last selection without saving an edit');
    let before = await read(), gesture = await begin('shift-a', 80, 22), after = await finish(gesture.end);
    check(Math.abs(object(after).x - object(before).x - 80) < .01 && object(after).y === object(before).y, 'Holding Shift from pointer-down moves an item horizontally');
    check(JSON.stringify(await selection()) === JSON.stringify(['shift-a']), 'Shift-drag retains the item instead of toggling it off');
    await undo(before);
    before = await read(); gesture = await begin('shift-a', 18, 90); after = await finish(gesture.end);
    check(object(after).x === object(before).x && Math.abs(object(after).y - object(before).y - 90) < .01, 'The initial vertical direction locks horizontal movement');
    await undo(before);
    before = await read(); gesture = await begin('shift-a', 80, 22);
    const crossed = { x: gesture.start.x + 50 * gesture.start.scale, y: gesture.start.y + 140 * gesture.start.scale };
    await mouse('mouseMoved', crossed, 8); after = await finish(crossed);
    check(Math.abs(object(after).x - object(before).x - 50) < .01 && object(after).y === object(before).y, 'The chosen axis stays stable when the pointer crosses the diagonal');
    await undo(before);
    before = await read(); gesture = await begin('shift-a', 70, 30, 0, 0);
    const locked = { x: gesture.start.x + 80 * gesture.start.scale, y: gesture.start.y + 35 * gesture.start.scale };
    await mouse('mouseMoved', locked, 8);
    check(await evaluate(`Math.abs(document.querySelector('[data-object-id=shift-a]').transform.baseVal.getItem(0).matrix.f-${object(before).y})<.001`), 'Pressing Shift during an existing drag locks its axis');
    const free = { x: gesture.start.x + 90 * gesture.start.scale, y: gesture.start.y + 45 * gesture.start.scale };
    await mouse('mouseMoved', free, 0); after = await finish(free, 0);
    check(Math.abs(object(after).x - object(before).x - 90) < .01 && Math.abs(object(after).y - object(before).y - 45) < .01, 'Releasing Shift restores free movement');
    await undo(before);
    await evaluate('document.getElementById("smart-guides").checked=true');
    before = await read(); gesture = await begin('shift-a', 119, 20);
    check(await evaluate('[...document.querySelectorAll(".smart-guide-alignment")].every(line=>line.getAttribute("x1")===line.getAttribute("x2"))'), 'Horizontal Shift-drag only shows guides for the movable coordinate');
    after = await finish(gesture.end);
    check(object(after).x === 300 && object(after).y === 180, 'Magnetic alignment snaps horizontally without pulling the item off its fixed row');
    await undo(before);
    await apply([{ op: 'update', id: 'shift-b', patch: { x: 184, y: 400 } }]);
    before = await read(); gesture = await begin('shift-a', 20, 159); after = await finish(gesture.end);
    check(object(after).x === 180 && object(after).y === 340, 'Vertical snapping preserves the fixed column');
    await undo(before);
    await evaluate('document.getElementById("smart-guides").checked=false');
    await select(['shift-a', 'shift-b']); before = await read(); gesture = await begin('shift-a', 70, 20); after = await finish(gesture.end);
    check(after.objects.every((o, i) => Math.abs(o.x - before.objects[i].x - 70) < .01 && o.y === before.objects[i].y), `Shift-dragging a selected member moves all selected components rigidly: ${JSON.stringify({before:before.objects.map(({id,x,y})=>({id,x,y})),after:after.objects.map(({id,x,y})=>({id,x,y})),selection:await selection(),gesture})}`);
    await undo(before);
    await apply([{ op: 'group', id: 'shift-group', ids: ['shift-a', 'shift-b'] }]);
    await select(['shift-group']); before = await read(); gesture = await begin('shift-a', 15, 75); after = await finish(gesture.end);
    check(after.objects.every((o, i) => o.x === before.objects[i].x && Math.abs(o.y - before.objects[i].y - 75) < .01)
      && JSON.stringify(after.groups[0].ids) === JSON.stringify(before.groups[0].ids), 'Shift-drag constrains an entire group while retaining its membership');
    await undo(before);
    await click('shift-a', 8);
    check((await selection()).length === 0, 'Shift-click toggles a complete group together');
    await click('shift-a', 9);
    check(JSON.stringify(await selection()) === JSON.stringify(['shift-a']), 'Alt-Shift-click still selects one group member independently');
    await apply([{ op: 'ungroup', id: 'shift-group' }]);
    await select(['shift-b']); before = await read(); gesture = await begin('shift-a', 60, 15);
    await evaluate('document.getElementById("main-canvas").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    after = await finish(gesture.end);
    check(after.revision === before.revision && JSON.stringify(await selection()) === JSON.stringify(['shift-b']), 'Escape cancels a Shift-drag and restores the prior selection');
    await select(['shift-a']);
    await evaluate('document.getElementById("zoom-in").click();document.getElementById("zoom-in").click()');
    before = await read(); gesture = await begin('shift-a', 45, 12); after = await finish(gesture.end);
    check(Math.abs(object(after).x - object(before).x - 45) < .01 && object(after).y === object(before).y, 'Shift movement uses exact canvas coordinates at higher zoom');
    await fs.writeFile(path.join(temp, 'shift-constrained-selection.png'), (await win.webContents.capturePage()).toPNG());
  } finally { win.webContents.debugger.detach(); }
}
module.exports = { verifyShiftDrag };
