const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

async function verifySmartGuides({ tool, evaluate, check, win, pause, temp }) {
  const read = () => tool({ action: 'read' });
  const apply = async operations => {
    const current = await read();
    const result = await tool({ action: 'apply', illustration_id: current.illustration_id,
      expected_revision: current.revision, request_id: randomUUID(), operations });
    check(result.ok, result.error || 'Save smart guide fixture'); await pause(60);
  };
  const object = (state, id = 'moving') => state.objects.find(item => item.id === id);
  const changed = async revision => {
    for (let i = 0; i < 100; i++) { const current = await read(); if (current.revision !== revision) return current; await pause(20); }
    throw new Error('Move did not persist');
  };
  const select = async (ids = ['moving'], close = true) => {
    await evaluate(`(()=>{const ids=${JSON.stringify(ids)};ids.forEach((id,i)=>document.querySelector('[data-layer-id="'+id+'"] .layer-select').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:i>0})));${close ? "document.getElementById('close-layers').click();" : ''}})()`);
    await pause(60);
  };
  const geometry = id => evaluate(`(()=>{const svg=document.querySelector('#main-canvas>svg'),m=svg.getScreenCTM(),hit=document.querySelector('[data-object-id="${id}"] .object-hit'),r=hit.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,scale:Math.hypot(m.a,m.b)}})()`);
  const mouse = async (type, p, modifiers = 0) => {
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, modifiers,
      button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1 });
    await pause(40);
  };
  const begin = async (dx, dy, modifiers = 0) => {
    const start = await geometry('moving'), end = { x: start.x + dx * start.scale, y: start.y + dy * start.scale };
    await mouse('mousePressed', start, modifiers); await mouse('mouseMoved', end, modifiers);
    return end;
  };
  const undo = async before => {
    await evaluate('illustrationWorkspace.history("undo")'); await pause(70);
    check(JSON.stringify((await read()).objects) === JSON.stringify(before.objects), 'One undo restores the complete move');
  };
  const bypass = process.platform === 'darwin' ? 4 : 2; // CDP Meta / Control
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="10" fill="#62a89a"/></svg>';
  await apply([
    { op: 'upsert', object: { id: 'a', type: 'vector', name: 'Reference A', x: 140, y: 240, width: 100, height: 80, svg } },
    { op: 'upsert', object: { id: 'b', type: 'vector', name: 'Reference B', x: 420, y: 240, width: 60, height: 80, svg } },
    { op: 'upsert', object: { id: 'moving', type: 'vector', name: 'Moving component', x: 300, y: 500, width: 80, height: 60, svg } }
  ]);
  await select();
  win.webContents.debugger.attach('1.3');
  try {
    let before = await read(), end = await begin(263, -127);
    check(await evaluate('document.querySelectorAll(".smart-guide-alignment").length>=2'), 'Canvas center produces horizontal and vertical guides during a real pointer drag');
    check((await read()).revision === before.revision, 'The magnetic preview does not save while dragging');
    check(await evaluate('(async()=>{const {svgSource}=await import("./artwork.mjs");return !(await svgSource(illustrationWorkspace.getDocument(),"main")).includes("smart-guide")})()'), 'Temporary guides do not enter SVG exports');
    await fs.writeFile(path.join(temp, 'smart-guides-center.png'), (await win.webContents.capturePage()).toPNG());
    await mouse('mouseReleased', end); let after = await changed(before.revision);
    check(object(after).x === 560 && object(after).y === 370, 'Release persists exact canvas centering on both axes');
    check(await evaluate('!document.querySelector(".smart-guides")'), 'Guides disappear immediately after release');
    await undo(before);

    before = await read(); end = await begin(-157, -257);
    check(await evaluate('Boolean(document.querySelector(".smart-guide-alignment"))'), 'Nearby component edges show magnetic guides');
    await mouse('mouseReleased', end); after = await changed(before.revision);
    check(object(after).x === 140 && object(after).y === 240, 'Moving component snaps to another component’s top and left');
    await undo(before);

    before = await read(); end = await begin(-8, -257);
    check(await evaluate('document.querySelectorAll(".smart-guide-label").length===2'), 'Equal spacing shows two measured gap markers');
    await fs.writeFile(path.join(temp, 'smart-guides-spacing.png'), (await win.webContents.capturePage()).toPNG());
    await mouse('mouseReleased', end); after = await changed(before.revision);
    check(object(after).x === 290 && object(after).y === 240, 'Different-sized neighbors get exact equal horizontal gaps');
    await undo(before);

    for (const disabled of ['modifier', 'setting']) {
      if (disabled === 'setting') await evaluate('document.getElementById("smart-guides").checked=false');
      before = await read(); end = await begin(263, -127, disabled === 'modifier' ? bypass : 0);
      check(await evaluate('!document.querySelector(".smart-guides")'), `${disabled} bypasses all magnetic guides`);
      await mouse('mouseReleased', end, disabled === 'modifier' ? bypass : 0); after = await changed(before.revision);
      check(Math.abs(object(after).x - 563) < 1.5 && Math.abs(object(after).y - 373) < 1.5, `${disabled} preserves free positioning near the canvas center`);
      await undo(before);
    }
    await evaluate('document.getElementById("smart-guides").checked=true');

    before = await read(); end = await begin(263, -127);
    await evaluate('document.getElementById("main-canvas").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    await mouse('mouseReleased', end);
    check((await read()).revision === before.revision && await evaluate('!document.querySelector(".smart-guides") && Boolean(document.querySelector(".selection"))'), 'Escape cancels a snapped drag without losing the selection or creating history');

    await evaluate('document.getElementById("main-canvas").addEventListener("pointerdown",e=>window.qaMovePointer=e.pointerId,{capture:true})');
    end = await begin(263, -127);
    await evaluate('document.getElementById("main-canvas").dispatchEvent(new PointerEvent("pointercancel",{pointerId:window.qaMovePointer,bubbles:true}))');
    await mouse('mouseReleased', end);
    check((await read()).revision === before.revision && await evaluate('!document.querySelector(".smart-guides")'), 'Pointer cancellation discards movement and clears guides');

    end = await begin(263, -127);
    await apply([{ op: 'update', id: 'a', patch: { name: 'Concurrent edit' } }]); before = await read();
    await mouse('mouseReleased', end);
    check((await read()).revision === before.revision && await evaluate('!document.querySelector(".smart-guides")'), 'Concurrent edits cancel a stale snapped move without overwriting the new revision');

    await apply([{ op: 'upsert', object: { id: 'child', type: 'vector', x: 300, y: 570, width: 30, height: 20, svg } },
      { op: 'group', id: 'assembly', ids: ['moving', 'child'] }]);
    await select(['moving', 'child']); before = await read(); end = await begin(263, -142);
    await mouse('mouseReleased', end); after = await changed(before.revision);
    check(object(after).x === 560 && object(after).y === 355
      && object(after, 'child').x - object(after).x === 0 && object(after, 'child').y - object(after).y === 70,
    'Group bounds snap to canvas center while all children move rigidly');
    const membership = groups => groups.map(group => ({ id: group.id, name: group.name, canvas: group.canvas, ids: group.ids }));
    check(JSON.stringify(membership(after.groups)) === JSON.stringify(membership(before.groups)), 'Snapping preserves group membership');
    const snappedGroup = after; end = await begin(40, 20, bypass);
    check(await evaluate('!document.querySelector(".smart-guides")'), 'Cmd/Ctrl bypasses guides while dragging a group');
    await mouse('mouseReleased', end, bypass); after = await changed(snappedGroup.revision);
    check(Math.abs(object(after).x - 600) < 1.5 && Math.abs(object(after).y - 375) < 1.5
      && object(after, 'child').x - object(after).x === 0 && object(after, 'child').y - object(after).y === 70,
    'Cmd/Ctrl-dragging a group moves the whole group freely');
    await undo(snappedGroup); after = snappedGroup;

    before = after;
    await evaluate('document.getElementById("main-canvas").focus();for(let i=0;i<5;i++)document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}));document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowUp",shiftKey:true,bubbles:true}))');
    for (let i = 0; i < 100; i++) { after = await read(); if (object(after).x === 565 && object(after).y === 345) break; await pause(20); }
    check(object(after).x === 565 && object(after).y === 345, 'Rapid arrow keys each nudge one pixel and Shift nudges ten, bypassing magnets');
    check(object(after, 'child').y - object(after).y === 70, 'Keyboard nudges preserve the complete group');

    await select(['moving', 'child'], false); before = await read();
    await evaluate('const input=document.querySelector("#properties input[name=name]");input.focus();input.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}))');
    await pause(60);
    check((await read()).revision === before.revision, 'Arrow keys in property fields do not move artwork');
  } finally { win.webContents.debugger.detach(); }
}

module.exports = { verifySmartGuides };
