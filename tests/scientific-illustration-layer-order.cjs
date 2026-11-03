const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

async function verifyLayerOrder({ tool, evaluate, check, win, pause, temp, reloadPlugin }) {
  const read = () => tool({ action: 'read', include_assets: true });
  const apply = async operations => {
    const doc = await read();
    const result = await tool({ action: 'apply', illustration_id: doc.illustration_id,
      expected_revision: doc.revision, request_id: randomUUID(), operations });
    check(result.ok, result.error || 'Layer fixture saved');
    return read();
  };
  const ids = doc => doc.objects.map(object => object.id);
  const order = async () => ids(await read());
  const waitOrder = async expected => {
    for (let i = 0; i < 100; i++) { if (JSON.stringify(await order()) === JSON.stringify(expected)) return; await pause(30); }
    throw new Error(`Layer order did not settle: ${JSON.stringify(await order())}; expected ${JSON.stringify(expected)}`);
  };
  const select = id => evaluate(`document.querySelector('[data-layer-id="${id}"] .layer-select').click()`);
  const original = await read();
  await apply(['a', 'b', 'c', 'd'].map((id, i) => ({ op: 'upsert', object: { id, type: 'text', text: `Layer ${id.toUpperCase()}`,
    x: 100 + i * 50, y: 100 + i * 30, width: 220, height: 60, fontFamily: 'Inter', fontWeight: 600, anchor: 'middle' } })));
  await select('a');
  check(await evaluate('!document.querySelector("#raise,#lower,[name=fontWeight],[name=anchor]")'), 'Weight, Anchor, and layer arrow controls are removed');
  check(await evaluate('document.querySelectorAll("[data-text-style]").length===3 && document.querySelectorAll("[data-align]").length===3'), 'Bold, italic, underline, and text alignment remain available');
  const baseline = await read();
  const point = (id, after = false) => evaluate(`(()=>{const row=document.querySelector('[data-layer-id="${id}"]');row.scrollIntoView({block:'nearest'});const r=row.getBoundingClientRect();return {x:r.left+60,y:r.top+r.height*${after ? '.85' : '.15'}}})()`);
  win.webContents.debugger.attach('1.3');
  const mouse = async (type, p) => {
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x: p.x, y: p.y,
      button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1 });
    await pause(35);
  };
  const begin = async (source, target, after = false) => {
    const start = await point(source), end = await point(target, after);
    await mouse('mousePressed', start);
    await mouse('mouseMoved', { x: start.x + 7, y: start.y });
    await mouse('mouseMoved', end);
    return end;
  };
  const drag = async (source, target, after = false) => { const end = await begin(source, target, after); await mouse('mouseReleased', end); await pause(80); };
  try {
    // Real clicks still select rows; dragging does not enter label editing.
    const click = await point('b'); await mouse('mousePressed', click); await mouse('mouseReleased', click);
    check(await evaluate('document.querySelector("[data-layer-id=b] .layer-select").getAttribute("aria-pressed")==="true"'), 'Clicking a row still selects it');
    await select('a');
    const before = await read(), end = await begin('a', 'd');
    check(await evaluate('document.querySelector("[data-layer-id=d]").dataset.orderDrop==="before" && document.querySelector("[data-layer-id=a]").classList.contains("is-ordering")'), 'Dragging shows an insertion line and marks the moving layer');
    check((await read()).revision === before.revision, 'Drag previews do not save intermediate changes');
    await fs.writeFile(path.join(temp, 'layers-drag-indicator.png'), (await win.webContents.capturePage()).toPNG());
    await mouse('mouseReleased', end); await waitOrder(['b', 'c', 'd', 'a']);
    check(await evaluate('[...document.querySelectorAll("#layers [data-layer-id]")].map(row=>row.dataset.layerId).join(",")==="a,d,c,b"'), 'The frontmost layer appears first in the list');
    check(await evaluate('[...document.querySelectorAll("#main-canvas > svg > [data-object-id]")].map(row=>row.dataset.objectId).join(",")==="b,c,d,a"'), 'Canvas paint order follows the dropped row');
    const moved = await read();
    check(moved.objects.every(object => JSON.stringify(object) === JSON.stringify(baseline.objects.find(previous => previous.id === object.id))), 'Reordering preserves geometry, weight, anchor, and all layer content');
    await evaluate('illustrationWorkspace.history("undo")'); await waitOrder(['a', 'b', 'c', 'd']);
    await evaluate('illustrationWorkspace.history("redo")'); await waitOrder(['b', 'c', 'd', 'a']);
    check(true, 'One undo and redo restore the complete drag');
    await drag('a', 'b', true); await waitOrder(['a', 'b', 'c', 'd']);
    check(true, 'Dragging down sends a layer behind its destination');
    const unchanged = await read();
    await drag('a', 'b', true);
    check((await read()).revision === unchanged.revision, 'Dropping in the current position creates no edit');
    const cancelled = await begin('a', 'd');
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', windowsVirtualKeyCode: 27 });
    await mouse('mouseReleased', cancelled);
    check((await read()).revision === unchanged.revision && await evaluate('!document.querySelector("[data-order-drop],.layer.is-ordering")'), 'Escape cancels the drag and removes its indicator');
    const outside = await begin('a', 'd');
    await mouse('mouseReleased', { x: outside.x - 400, y: outside.y });
    check((await read()).revision === unchanged.revision, 'Dropping outside the layer list cancels without saving');
    await select('b');
    await evaluate('document.querySelector("[data-layer-id=d] .layer-select").dispatchEvent(new MouseEvent("click",{bubbles:true,shiftKey:true}))');
    await drag('b', 'a', true); await waitOrder(['b', 'd', 'a', 'c']);
    check(true, 'Dragging selected layers keeps their relative stack order');
    await apply([{ op: 'order', canvas: 'main', ids: ['a', 'b', 'c', 'd'] }, { op: 'group', id: 'pair', name: 'Pair', ids: ['b', 'c'] }]);
    await select('pair');
    await drag('pair', 'd'); await waitOrder(['a', 'd', 'b', 'c']);
    check((await read()).groups[0].ids.join(',') === 'b,c', 'Dragging a group preserves its members and internal order');
    await select('d');
    await drag('d', 'b'); await waitOrder(['a', 'b', 'c', 'd']);
    check(true, 'Dropping onto a grouped member places the layer beside the entire group');
    await evaluate('document.querySelector("[data-layer-id=d] .layer-select").focus()');
    await evaluate('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",altKey:true,bubbles:true}))');
    await waitOrder(['a', 'd', 'b', 'c']);
    check((await read()).objects.every(object => object.x === baseline.objects.find(previous => previous.id === object.id).x), 'Alt+ArrowDown reorders without nudging layer geometry');
    const conflict = await begin('d', 'a', true);
    await apply([{ op: 'title', title: 'Concurrent edit' }]);
    const revision = (await read()).revision;
    await mouse('mouseReleased', conflict);
    check((await read()).revision === revision, 'A concurrent edit cancels the stale drag');
    await win.webContents.executeJavaScript('window.failSave=true');
    await drag('d', 'a', true);
    check((await read()).revision === revision && (await order()).join(',') === 'a,d,b,c', 'A failed save retains the original stacking order');
    await win.webContents.executeJavaScript('window.failSave=false');
    await fs.writeFile(path.join(temp, 'layers-after-reorder.png'), (await win.webContents.capturePage()).toPNG());
    await apply(Array.from({ length: 10 }, (_, i) => ({ op: 'upsert', object: { id: `scroll-${i}`, type: 'text',
      text: `Scrolling layer ${i}`, x: 600, y: 100 + i * 40, width: 200, height: 40 } })));
    await evaluate('document.getElementById("layers").scrollTop=0');
    const scrollBefore = await read(), start = await point('scroll-9');
    const edge = await evaluate('(()=>{const r=document.getElementById("layers").getBoundingClientRect();return {x:r.left+60,y:r.bottom-4}})()');
    await mouse('mousePressed', start); await mouse('mouseMoved', { x: start.x + 7, y: start.y }); await mouse('mouseMoved', edge);
    await pause(400);
    check(await evaluate('document.getElementById("layers").scrollTop>20'), 'Dragging near the list edge scrolls to hidden layers');
    check((await read()).revision === scrollBefore.revision, 'Auto-scrolling keeps the reorder preview transient');
    await mouse('mouseReleased', edge); await pause(100);
    const scrolled = await read();
    check(scrolled.objects.length === 14 && ids(scrolled).indexOf('scroll-9') < 13, 'Dropping after scrolling saves the layer at its new stack position');
    check(await evaluate('document.getElementById("layers").scrollTop>20'), 'The layer list retains its scroll position after saving');
  } finally { win.webContents.debugger.detach(); }
  const saved = await order();
  await evaluate('illustrationWorkspace.flush()');
  await reloadPlugin(); await waitOrder(saved);
  check(true, 'Layer stacking persists after reloading Figura');
  check((await read()).illustration_id === original.illustration_id, 'Layer drags keep the current illustration');
}

module.exports = { verifyLayerOrder };
