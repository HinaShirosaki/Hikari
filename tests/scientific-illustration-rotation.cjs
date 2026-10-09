// Real pointer gestures in an isolated Electron profile and illustration library.
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

async function verifyRotation({ tool, evaluate, check, win, pause, temp }) {
  const read = () => tool({ action: 'read', include_assets: true });
  const apply = async operations => {
    const current = await read();
    const result = await tool({ action: 'apply', illustration_id: current.illustration_id,
      expected_revision: current.revision, request_id: randomUUID(), operations });
    check(result.ok, result.error || 'Save rotation fixture'); await pause(70); return result;
  };
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="12" fill="#56a7a5"/><path d="M20 70L50 20L80 70Z" fill="#f3cd77"/></svg>';
  const dataUrl = await evaluate('(()=>{const c=document.createElement("canvas");c.width=c.height=2;c.getContext("2d").fillRect(0,0,2,2);return c.toDataURL()})()');
  await apply([
    { op: 'upsert', object: { id: 'rotate-vector', type: 'vector', name: 'Membrane', svg, x: 300, y: 200, width: 180, height: 120, rotation: 17 } },
    { op: 'upsert', object: { id: 'rotate-raster', type: 'raster', name: 'Cargo', dataUrl, textFree: true, x: 550, y: 300, width: 80, height: 60, rotation: -12 } },
    { op: 'upsert', object: { id: 'rotate-text', type: 'text', name: 'Independent label', text: 'Receptor', x: 250, y: 150, width: 600, height: 300, fontSize: 28, align: 'end', anchor: 'bottom', rotation: -23 } },
    { op: 'upsert', object: { id: 'rotate-scratch', type: 'vector', canvas: 'scratch', name: 'Scratch component', svg, x: 80, y: 50, width: 90, height: 60 } }
  ]);
  const object = (state, id) => state.objects.find(item => item.id === id);
  const select = async id => {
    await evaluate(`document.querySelector('[data-layer-id="${id}"] .layer-select').click();document.getElementById('close-layers').click();document.getElementById('zoom-fit').click()`);
    await pause(60);
  };
  const geometry = (canvas = 'main') => evaluate(`(()=>{
    const stage=document.getElementById('${canvas}-canvas'),frame=stage.querySelector('.selection'),handle=frame.querySelector('.rotation-handle');
    const point=(m,x,y)=>{const p=new DOMPoint(x,y).matrixTransform(m);return {x:p.x,y:p.y}};
    const area=stage.getBoundingClientRect(),m=handle.getScreenCTM();
    return {handle:point(m,0,0),pivot:point(frame.getScreenCTM(),Number(frame.dataset.selectionWidth)/2,Number(frame.dataset.selectionHeight)/2),
      radius:Number(handle.querySelector('.rotation-knob').getAttribute('r'))*Math.hypot(m.a,m.b),
      hitRadius:Number(handle.querySelector('.rotation-hit').getAttribute('r'))*Math.hypot(m.a,m.b),
      area:{left:area.left,top:area.top,right:area.left+stage.clientWidth,bottom:area.top+stage.clientHeight},placement:JSON.parse(handle.dataset.placement)};
  })()`);
  const destination = (g, degrees) => {
    const angle = degrees * Math.PI / 180, dx = g.handle.x - g.pivot.x, dy = g.handle.y - g.pivot.y;
    return { x: g.pivot.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: g.pivot.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
  };
  const angularError = (a, b) => Math.abs(((a - b + 180) % 360 + 360) % 360 - 180);
  const waitForChange = async revision => {
    for (let i = 0; i < 100; i++) { const current = await read(); if (current.revision !== revision) return current; await pause(20); }
    throw new Error('Rotation did not persist');
  };
  const unchanged = async before => {
    await pause(70); const current = await read();
    return current.revision === before.revision && JSON.stringify(current.objects) === JSON.stringify(before.objects);
  };
  win.webContents.debugger.attach('1.3');
  const mouse = async (type, p, modifiers = 0) => {
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, ...p, modifiers,
      button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1 });
    await pause(35);
  };
  const gesture = async (degrees, modifiers = 0, canvas = 'main') => {
    const g = await geometry(canvas), end = destination(g, degrees);
    await mouse('mousePressed', g.handle, modifiers); await mouse('mouseMoved', end, modifiers);
    await mouse('mouseReleased', end, modifiers);
  };
  try {
    await select('rotate-vector');
    let g = await geometry();
    check(Math.abs(g.radius - 6) < 0.01 && Math.abs(g.hitRadius - 12) < 0.01, 'Rotation control has a fixed screen size and larger hit target');
    check(await evaluate('document.querySelector(".rotation-handle").getAttribute("role")==="button" && document.querySelector(".rotation-handle").tabIndex===0'), 'Rotation control is keyboard accessible');
    let before = await read(), end = destination(g, 43);
    await mouse('mousePressed', g.handle); await mouse('mouseMoved', end);
    check(await unchanged(before), 'Drag preview leaves persisted geometry and revision untouched');
    const preview = await evaluate('({active:document.getElementById("main-canvas").classList.contains("is-rotating"),transform:document.querySelector("#main-canvas [data-object-id=rotate-vector]").getAttribute("transform")})');
    check(preview.active && angularError(Number(preview.transform.match(/rotate\(([^ ]+)/)[1]), 60) < 0.5, `Pointer drag previews rotation directly on canvas: ${JSON.stringify(preview)}`);
    await mouse('mouseReleased', end); let after = await waitForChange(before.revision);
    const rotated = object(after, 'rotate-vector'), original = object(before, 'rotate-vector');
    check(angularError(rotated.rotation, 60) < 0.01 && rotated.width === original.width && rotated.height === original.height && rotated.svg === original.svg, 'Release saves rotation while retaining editable artwork and size');
    check(Math.hypot(rotated.x - original.x, rotated.y - original.y) < 1e-8 && after.objects.filter(o => o.id !== original.id).every(o => JSON.stringify(o) === JSON.stringify(object(before, o.id))), 'Single component rotates about its center without changing other components');
    await evaluate('illustrationWorkspace.history("undo")'); after = await waitForChange(after.revision);
    check(JSON.stringify(after.objects) === JSON.stringify(before.objects), 'One undo restores the entire drag');
    await evaluate('illustrationWorkspace.history("redo")'); after = await waitForChange(after.revision);
    check(angularError(object(after, 'rotate-vector').rotation, 60) < 0.01, 'Redo restores rotation');
    await apply([{ op: 'update', id: 'rotate-vector', patch: { rotation: 17 } }]); before = await read();
    await gesture(27, 8); after = await waitForChange(before.revision);
    check(angularError(object(after, 'rotate-vector').rotation, 45) < 0.01, 'Shift drag snaps absolute orientation to 15 degree increments');

    before = await read(); g = await geometry(); end = destination(g, -40);
    await mouse('mousePressed', g.handle); await mouse('mouseMoved', end);
    await evaluate('document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    await mouse('mouseReleased', end);
    check(await unchanged(before) && await evaluate('Boolean(document.querySelector(".rotation-handle")) && !document.getElementById("main-canvas").classList.contains("is-rotating")'), 'Escape cancels rotation and retains selection');
    await evaluate('document.getElementById("main-canvas").addEventListener("pointerdown",e=>window.qaRotatePointer=e.pointerId,{capture:true})');
    g = await geometry(); end = destination(g, 20); await mouse('mousePressed', g.handle); await mouse('mouseMoved', end);
    await evaluate('document.getElementById("main-canvas").releasePointerCapture(window.qaRotatePointer)');
    await mouse('mouseReleased', end);
    check(await unchanged(before), 'Lost pointer capture cancels the preview without committing');
    g = await geometry(); await mouse('mousePressed', g.handle); await mouse('mouseReleased', g.handle);
    check(await unchanged(before), 'Clicking the handle without dragging adds no history entry');
    g = await geometry(); end = destination(g, 30); await mouse('mousePressed', g.handle); await mouse('mouseMoved', end);
    await apply([{ op: 'update', id: 'rotate-raster', patch: { name: 'Concurrent agent edit' } }]); before = await read();
    await mouse('mouseReleased', end);
    check(await unchanged(before) && await evaluate('!document.getElementById("main-canvas").classList.contains("is-rotating")'), 'Concurrent agent changes cancel a stale rotation without overwriting artwork');

    await select('rotate-text'); before = await read(); g = await geometry(); await gesture(50); after = await waitForChange(before.revision);
    const textBefore = object(before, 'rotate-text'), textAfter = object(after, 'rotate-text'), textCenter = (await geometry()).pivot;
    check(Math.hypot(g.pivot.x - textCenter.x, g.pivot.y - textCenter.y) < 0.05, 'Oversized right/bottom anchored text rotates about its visible center');
    check(angularError(textAfter.rotation, textBefore.rotation + 50) < 0.01 && ['width', 'height', 'fontFamily', 'fontSize', 'fontWeight', 'text', 'align', 'anchor'].every(key => textBefore[key] === textAfter[key]), 'Text rotation preserves independent text, typography and layout dimensions');
    await evaluate('document.querySelector(".rotation-handle").focus();document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true,shiftKey:true}))');
    after = await waitForChange(after.revision);
    check(angularError(object(after, 'rotate-text').rotation, textAfter.rotation + 15) < 0.01 && await evaluate('document.activeElement.classList.contains("rotation-handle")'), 'Keyboard rotation keeps focus on the handle after saving');
    before = after;
    await evaluate('for(let i=0;i<4;i++)document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}))');
    for (let i = 0; i < 100; i++) {
      after = await read();
      if (angularError(object(after, 'rotate-text').rotation, object(before, 'rotate-text').rotation + 4) < 0.01) break;
      await pause(20);
    }
    check(angularError(object(after, 'rotate-text').rotation, object(before, 'rotate-text').rotation + 4) < 0.01, 'Rapid keyboard repeats each save without revision conflicts');

    await apply([{ op: 'group', id: 'rotation-group', name: 'Editable assembly', ids: ['rotate-vector', 'rotate-raster', 'rotate-text'] }]);
    await select('rotation-group'); before = await read(); g = await geometry(); end = destination(g, 70);
    await mouse('mousePressed', g.handle); await mouse('mouseMoved', end);
    check(Math.hypot((await geometry()).pivot.x - g.pivot.x, (await geometry()).pivot.y - g.pivot.y) < 0.01, 'Group preview retains its original rotation pivot');
    await fs.writeFile(path.join(temp, 'rotation-group-preview.png'), (await win.webContents.capturePage()).toPNG());
    await mouse('mouseReleased', end); after = await waitForChange(before.revision);
    const center = o => ({ x: o.x + o.width / 2, y: o.y + o.height / 2 });
    const distance = (a, b) => Math.hypot(center(a).x - center(b).x, center(a).y - center(b).y);
    check(['rotate-vector', 'rotate-raster', 'rotate-text'].every(id => angularError(object(after, id).rotation, object(before, id).rotation + 70) < 0.01
      && object(after, id).width === object(before, id).width && object(after, id).height === object(before, id).height), 'Mixed group rotation turns each independent component without scaling');
    check(Math.abs(distance(object(before, 'rotate-vector'), object(before, 'rotate-text')) - distance(object(after, 'rotate-vector'), object(after, 'rotate-text'))) < 0.01
      && ['id', 'name', 'canvas', 'ids'].every(key => JSON.stringify(before.groups[0][key]) === JSON.stringify(after.groups[0][key])), 'Group rotation preserves spacing and membership');
    await evaluate('illustrationWorkspace.history("undo")'); after = await waitForChange(after.revision);
    check(JSON.stringify(after.objects) === JSON.stringify(before.objects), 'Group rotation is one undoable edit');

    await tool({ action: 'scratch', illustration_id: before.illustration_id, visible: true }); await select('rotate-scratch');
    before = await read(); await gesture(-55, 0, 'scratch'); after = await waitForChange(before.revision);
    check(angularError(object(after, 'rotate-scratch').rotation, -55) < 0.01 && after.objects.filter(o => o.canvas === 'main').every(o => JSON.stringify(o) === JSON.stringify(object(before, o.id))), 'Scratch rotation keeps Main artwork unchanged');
    await tool({ action: 'scratch', illustration_id: before.illustration_id, visible: false });
    await apply([{ op: 'ungroup', id: 'rotation-group' }, { op: 'update', id: 'rotate-vector', patch: { x: 0, y: 0, rotation: 0 } }]);
    await select('rotate-vector');
    for (const narrow of [false, true]) {
      if (narrow) { win.setSize(320, 760); await pause(100); }
      for (const zoom of [0, 5]) {
        await evaluate(`document.getElementById('zoom-fit').click();for(let i=0;i<${zoom};i++)document.getElementById('zoom-in').click()`); await pause(80);
        g = await geometry();
        check(Math.abs(g.radius - 6) < 0.01 && g.handle.x - 12 >= g.area.left && g.handle.x + 12 <= g.area.right
          && g.handle.y - 12 >= g.area.top && g.handle.y + 12 <= g.area.bottom, `Rotation control remains visible near canvas edge at ${narrow ? 320 : 1300}px width and zoom step ${zoom}`);
      }
      await fs.writeFile(path.join(temp, `rotation-handles-${narrow ? 320 : 1300}.png`), (await win.webContents.capturePage()).toPNG());
      await evaluate('document.getElementById("main-canvas").scrollTo(120,100)'); await pause(70); g = await geometry();
      check(g.handle.x - 12 >= g.area.left && g.handle.x + 12 <= g.area.right && g.handle.y - 12 >= g.area.top && g.handle.y + 12 <= g.area.bottom, 'Panning repositions the handle inside the visible editing area');
    }
    win.setSize(1300, 1000); await pause(80);
    await evaluate('document.getElementById("zoom-fit").click();document.getElementById("export-svg").click()'); await pause(150);
    const sources = (await fs.readdir(temp)).filter(name => name.endsWith('.svg'));
    check(sources.length === 1 && !(await fs.readFile(path.join(temp, sources[0]), 'utf8')).includes('rotation-handle'), 'SVG exports omit interactive handles');
  } finally { win.webContents.debugger.detach(); }
}

module.exports = { verifyRotation };
