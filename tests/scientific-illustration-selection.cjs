// Real pointer gestures in an installed plugin, using disposable figures.
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

async function verifyAreaSelection({ tool, evaluate, check, win, pause, temp }) {
  const read = () => tool({ action: 'read', include_assets: true });
  const original = await read();
  const created = await tool({ action: 'create', title: 'Area selection QA', expected_library_revision: original.library_revision, request_id: randomUUID() });
  check(created.ok, created.error || 'Create an isolated area-selection figure');
  await tool({ action: 'asset_list' });
  const apply = async operations => {
    const current = await read();
    const result = await tool({ action: 'apply', illustration_id: current.illustration_id, expected_revision: current.revision, request_id: randomUUID(), operations });
    check(result.ok, result.error || 'Persist selection fixture through MCP'); await pause(60); return result;
  };
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><ellipse cx="50" cy="50" rx="48" ry="48" fill="#65b7ae"/></svg>';
  const raster = await evaluate('(()=>{const c=document.createElement("canvas");c.width=c.height=2;c.getContext("2d").fillRect(0,0,2,2);return c.toDataURL()})()');
  await apply([
    { op: 'canvas', canvas: 'main', patch: { width: 2000, height: 1400 } },
    { op: 'upsert', object: { id: 'select-a', type: 'vector', name: 'Cell', x: 100, y: 100, width: 80, height: 60, svg } },
    { op: 'upsert', object: { id: 'select-b', type: 'text', name: 'Cell label', text: 'Cell', x: 260, y: 100, width: 100, height: 40 } },
    { op: 'upsert', object: { id: 'select-c', type: 'raster', name: 'Notch image', x: 300, y: 280, width: 50, height: 50, dataUrl: raster, textFree: true } },
    { op: 'upsert', object: { id: 'select-d', type: 'vector', name: 'Vesicle', x: 110, y: 280, width: 60, height: 60, svg } },
    { op: 'upsert', object: { id: 'select-rotated', type: 'vector', name: 'Rotated component', x: 400, y: 300, width: 80, height: 80, rotation: 45, svg } },
    { op: 'upsert', object: { id: 'select-hidden', type: 'vector', x: 110, y: 110, width: 20, height: 20, visible: false, svg } },
    { op: 'upsert', object: { id: 'select-s1', type: 'vector', canvas: 'scratch', x: 40, y: 40, width: 60, height: 40, svg } },
    { op: 'upsert', object: { id: 'select-s2', type: 'text', canvas: 'scratch', text: 'Scratch', x: 140, y: 60, width: 90, height: 30 } }
  ]);
  win.setSize(1300, 1000); await pause(80);
  await evaluate('document.getElementById("close-layers").click();document.getElementById("zoom-fit").click()');
  const selection = () => evaluate('[...document.querySelectorAll("#layers .layer:not(.grouped-layer) .layer-select[aria-pressed=true]")].map(button=>button.closest("[data-layer-id]").dataset.layerId)');
  const selected = async (ids, message) => {
    const actual = (await selection()).sort(), expected = [...ids].sort();
    check(JSON.stringify(actual) === JSON.stringify(expected), `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  };
  const feedback = async (canvas, ids) => {
    const outlines = await evaluate(`(()=>{const stage=document.getElementById(${JSON.stringify(canvas + '-canvas')});return [...stage.querySelectorAll('.selection-member')].map(outline=>{
      const object=stage.querySelector('[data-object-id="'+outline.dataset.selectedObjectId+'"]'),matrix=node=>{const m=node.getScreenCTM();return [m.a,m.b,m.c,m.d,m.e,m.f]},hit=object?.querySelector('.object-hit');
      const hitMatrix=hit&&hit.getScreenCTM().translate(Number(hit.getAttribute('x')||0),Number(hit.getAttribute('y')||0));
      return {id:outline.dataset.selectedObjectId,outline:matrix(outline),object:hitMatrix&&[hitMatrix.a,hitMatrix.b,hitMatrix.c,hitMatrix.d,hitMatrix.e,hitMatrix.f],width:outline.getAttribute('width'),height:outline.getAttribute('height'),objectWidth:hit?.getAttribute('width'),objectHeight:hit?.getAttribute('height'),pointerEvents:getComputedStyle(outline).pointerEvents};
    })})()`);
    check(JSON.stringify(outlines.map(o=>o.id).sort()) === JSON.stringify([...ids].sort()), `${canvas} outlines each selected component individually`);
    check(outlines.every(o=>o.object && o.outline.every((n,i)=>Math.abs(n-o.object[i])<1e-6) && o.width===o.objectWidth && o.height===o.objectHeight && o.pointerEvents==='none'),
      `${canvas} selection outlines match component position, rotation, zoom and dimensions without intercepting input`);
  };
  const mode = value => evaluate(`document.getElementById('selection-tool').value=${JSON.stringify(value)};document.getElementById('selection-tool').dispatchEvent(new Event('change',{bubbles:true}))`);
  const screen = (canvas, p) => evaluate(`(()=>{const m=document.querySelector('#${canvas}-canvas > svg').getScreenCTM(),p=new DOMPoint(${p[0]},${p[1]}).matrixTransform(m);return {x:p.x,y:p.y}})()`);
  win.webContents.debugger.attach('1.3');
  const mouse = async (type, p, modifiers = 0) => {
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, ...p, modifiers, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1 });
    await pause(20);
  };
  const begin = async (canvas, points, modifiers = 0) => {
    await mouse('mousePressed', await screen(canvas, points[0]), modifiers);
    for (const p of points.slice(1)) await mouse('mouseMoved', await screen(canvas, p), modifiers);
  };
  const gesture = async (canvas, points, modifiers = 0) => {
    await begin(canvas, points, modifiers);
    await mouse('mouseReleased', await screen(canvas, points.at(-1)), modifiers);
  };
  const rectangle = (canvas, start, end, modifiers) => gesture(canvas, [start, end], modifiers);
  const undoTo = async before => {
    await evaluate('document.getElementById("undo").click()'); await pause(80);
    check(JSON.stringify((await read()).objects) === JSON.stringify(before.objects), 'Undo restores every component after a direct selection transform');
  };
  const moveWithoutSwitch = async (canvas, ids, from, to) => {
    const before = await read(), toolMode = await evaluate('document.getElementById("selection-tool").value');
    await gesture(canvas, [from, to]); await pause(80);
    const after = await read();
    check(after.objects.every((o,i)=>ids.includes(o.id)
      ? Math.abs(o.x-before.objects[i].x-to[0]+from[0])<.01 && Math.abs(o.y-before.objects[i].y-to[1]+from[1])<.01
        && JSON.stringify({...o,x:before.objects[i].x,y:before.objects[i].y})===JSON.stringify(before.objects[i])
      : JSON.stringify(o)===JSON.stringify(before.objects[i])), `${toolMode} immediately moves every selected ${canvas} component and leaves other components intact`);
    await selected(ids, 'Dragging a selected member retains the entire area selection');
    check(await evaluate(`document.getElementById('selection-tool').value===${JSON.stringify(toolMode)} && !document.querySelector('.selection-region')`), 'Movement needs no tool switch and does not start another selection box');
    await undoTo(before);
  };
  const resizeWithoutSwitch = async (canvas, ids) => {
    const handle = direction => evaluate(`(()=>{const r=document.querySelector('#${canvas}-canvas [data-resize-direction=${direction}]').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    const before = await read(), anchor = await handle('nw'), start = await handle('se');
    const toolMode = await evaluate('document.getElementById("selection-tool").value');
    await mouse('mousePressed', start); await mouse('mouseMoved', {x:start.x+24,y:start.y+14}); await mouse('mouseReleased', {x:start.x+24,y:start.y+14}); await pause(80);
    const after = await read(), fixed = await handle('nw'), first = before.objects.find(o=>o.id===ids[0]), scale = after.objects.find(o=>o.id===first.id).width/first.width;
    check(scale>1 && Math.hypot(fixed.x-anchor.x,fixed.y-anchor.y)<.1 && after.objects.every((o,i)=>ids.includes(o.id)
      ? Math.abs(o.width/before.objects[i].width-scale)<1e-8 && Math.abs(o.height/before.objects[i].height-scale)<1e-8
        && o.rotation===before.objects[i].rotation && (o.type!=='text'||Math.abs(o.fontSize/before.objects[i].fontSize-scale)<1e-8)
      : JSON.stringify(o)===JSON.stringify(before.objects[i])), `${toolMode} resize handles scale the full selection and its text while fixing the opposite anchor`);
    check(await evaluate(`document.getElementById('selection-tool').value===${JSON.stringify(toolMode)} && !document.querySelector('.selection-region')`), 'Resizing works without switching selection tools or drawing another region');
    await undoTo(before);
  };
  const snapshot = await read(), beforeImage = await tool({ action: 'render', canvas: 'both' });
  const evidence = {};
  try {
    check(await evaluate('document.getElementById("selection-tool").options.length===2 && document.getElementById("selection-tool").value==="pointer"'), 'Select & move is the default tool alongside Freehand');
    await begin('main', [[90, 90], [370, 180]]);
    check(await evaluate('Boolean(document.querySelector("#main-canvas .selection-region")) && document.getElementById("main-canvas").classList.contains("is-area-selecting")'), 'Rectangle gesture displays a transient outline');
    const during = await tool({ action: 'render', canvas: 'both' });
    check(JSON.stringify(during.content.filter(c => c.type === 'image')) === JSON.stringify(beforeImage.content.filter(c => c.type === 'image')), 'The active selection outline never leaks into agent readback');
    await fs.writeFile(path.join(temp, 'selection-rectangle-preview.png'), (await win.webContents.capturePage()).toPNG());
    await mouse('mouseReleased', await screen('main', [370, 180]));
    await selected(['select-a', 'select-b'], 'Rectangle selects vector and independent text while excluding hidden and scratch objects');
    await feedback('main', ['select-a', 'select-b']);
    check(await evaluate('!document.querySelector(".selection-region") && document.getElementById("layer-inspector").hidden'), 'Completing selection removes the outline and keeps the canvas dominant');
    await fs.writeFile(path.join(temp, 'selection-component-outlines.png'), (await win.webContents.capturePage()).toPNG());
    await rectangle('main', [365, 185], [95, 95]);
    await selected(['select-a', 'select-b'], 'Reverse-direction rectangle selects the same components');

    await mode('freehand');
    const lasso = [[70, 70], [580, 70], [580, 180], [190, 180], [190, 410], [70, 410]];
    await begin('main', lasso);
    await fs.writeFile(path.join(temp, 'selection-freehand-preview.png'), (await win.webContents.capturePage()).toPNG());
    await mouse('mouseReleased', await screen('main', lasso.at(-1)));
    await selected(['select-a', 'select-b', 'select-d'], 'Concave freehand selection excludes components in the notch rather than using a bounding rectangle');
    await mode('pointer'); await rectangle('main', [290, 270], [360, 340], 8);
    await selected(['select-a', 'select-b', 'select-c', 'select-d'], 'Shift adds raster artwork to the prior area selection');
    await rectangle('main', [384, 284], [402, 302]);
    await selected([], 'An empty corner of a rotated component bounding rectangle does not select it');
    await rectangle('main', [430, 275], [450, 290]);
    await selected(['select-rotated'], 'A region touching the rotated component itself selects it');

    await begin('main', [[90, 90], [370, 180]]);
    await evaluate('document.getElementById("main-canvas").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    await mouse('mouseReleased', await screen('main', [370, 180]));
    await selected(['select-rotated'], 'Escape cancels a live gesture and retains the prior selection');
    check(await evaluate('!document.querySelector(".selection-region") && !document.querySelector(".is-area-selecting")'), 'Cancelled selection releases its transient overlay');
    await begin('main', [[90, 90], [370, 180]]);
    await evaluate('document.getElementById("main-canvas").dispatchEvent(new PointerEvent("pointercancel",{pointerId:1,bubbles:true}))');
    await mouse('mouseReleased', await screen('main', [370, 180]));
    await selected(['select-rotated'], 'Pointer cancellation keeps the prior selection');
    await begin('main', [[90, 90], [370, 180]]);
    await evaluate('document.getElementById("main-canvas").releasePointerCapture(1)');
    await mouse('mouseMoved', await screen('main', [375, 185]));
    await mouse('mouseReleased', await screen('main', [375, 185]));
    await selected(['select-rotated'], 'Losing pointer capture cancels selection without selecting an incomplete region');

    await mode('pointer'); await rectangle('main', [90, 90], [370, 180]);
    await selected(['select-a', 'select-b'], 'Select & move selects a rectangle by dragging empty space');
    await evaluate('document.getElementById("main-canvas").dispatchEvent(new KeyboardEvent("keydown",{key:"l",bubbles:true}))');
    check(await evaluate('document.getElementById("selection-tool").value==="freehand"'), 'L activates the Freehand tool from the keyboard');
    await evaluate('document.getElementById("main-canvas").dispatchEvent(new KeyboardEvent("keydown",{key:"v",bubbles:true}))');
    check(await evaluate('document.getElementById("selection-tool").value==="pointer"'), 'V returns to Select & move');

    // Zoom and scroll change only the view; the region still maps to canvas units.
    await evaluate('for(let i=0;i<3;i++)document.getElementById("zoom-in").click();document.getElementById("main-canvas").scrollLeft=30;document.getElementById("main-canvas").scrollTop=40');
    await mode('pointer'); await rectangle('main', [90, 90], [370, 180]);
    await selected(['select-a', 'select-b'], 'Rectangle selection stays accurate after zoom and scrolling on a large canvas');
    evidence.zoom = await evaluate('document.getElementById("zoom-level").textContent');
    await mode('freehand'); await gesture('main', lasso);
    await selected(['select-a', 'select-b', 'select-d'], 'Freehand selection stays accurate at the same zoom and scroll');
    await feedback('main', ['select-a', 'select-b', 'select-d']);
    const outlinedPreview = await tool({ action: 'render', canvas: 'both' });
    check(JSON.stringify(outlinedPreview.content.filter(c=>c.type==='image')) === JSON.stringify(beforeImage.content.filter(c=>c.type==='image')), 'Individual selection outlines never appear in agent readback');
    const unchanged = await read();
    check(unchanged.revision === snapshot.revision && JSON.stringify(unchanged.objects) === JSON.stringify(snapshot.objects), 'All selection gestures preserve scene geometry and revision');

    await mode('pointer'); await rectangle('main', [90, 90], [370, 180]);
    await moveWithoutSwitch('main', ['select-a', 'select-b'], [140, 130], [160, 145]);
    await resizeWithoutSwitch('main', ['select-a', 'select-b']);
    await mode('freehand'); await gesture('main', lasso);
    check(await evaluate('getComputedStyle(document.querySelector("#main-canvas [data-object-id=select-a]")).cursor==="move" && getComputedStyle(document.querySelector("#main-canvas [data-object-id=select-c]")).cursor==="crosshair"'), 'Freehand uses a move cursor on selected members and a selection cursor on other components');
    await moveWithoutSwitch('main', ['select-a', 'select-b', 'select-d'], [140, 130], [160, 145]);
    await resizeWithoutSwitch('main', ['select-a', 'select-b', 'select-d']);
    await fs.writeFile(path.join(temp, 'select-move-resize.png'), (await win.webContents.capturePage()).toPNG());

    await apply([{ op: 'group', id: 'select-group', name: 'Cell and rotated component', ids: ['select-a', 'select-rotated'] }]);
    await mode('pointer'); await rectangle('main', [90, 90], [190, 175]);
    await selected(['select-a', 'select-rotated'], 'Touching a group member selects the entire group');
    await feedback('main', ['select-a', 'select-rotated']);
    await fs.writeFile(path.join(temp, 'selection-rotated-component-outlines.png'), (await win.webContents.capturePage()).toPNG());
    await rectangle('main', [90, 90], [190, 175], 1);
    await selected(['select-a'], 'Alt selects only the touched group member');
    check(await evaluate('document.querySelectorAll("#main-canvas .selection-member").length===0 && document.querySelectorAll("#main-canvas .resize-handle").length===8'), 'A single selected component keeps one outline and its eight resize handles');
    await begin('main', [[90, 90], [370, 180]]);
    await apply([{ op: 'title', title: 'Agent edit during selection' }]);
    check(await evaluate('!document.querySelector(".selection-region") && !document.querySelector(".is-area-selecting")'), 'An intervening agent edit cancels a stale selection gesture');
    await mouse('mouseReleased', await screen('main', [370, 180]));
    await selected(['select-a'], 'Releasing a cancelled stale gesture does not replace selection');

    const current = await read(); await tool({ action: 'scratch', illustration_id: current.illustration_id, visible: true }); await pause(80);
    await rectangle('scratch', [10, 10], [240, 100]);
    await selected(['select-s1', 'select-s2'], 'Rectangle selects only scratch objects and switches the active canvas');
    await feedback('scratch', ['select-s1', 'select-s2']);
    check(await evaluate('!document.querySelector("#main-canvas .selection-member")'), 'Scratch selection clears individual selection outlines from main');
    await moveWithoutSwitch('scratch', ['select-s1', 'select-s2'], [70, 60], [90, 70]);
    await mode('freehand'); await gesture('scratch', [[10, 10], [110, 10], [110, 90], [10, 90]]);
    await selected(['select-s1'], 'Freehand selection works independently on scratch');
    await begin('scratch', [[10, 10], [240, 100]]);
    await tool({ action: 'scratch', illustration_id: current.illustration_id, visible: false }); await pause(80);
    await mouse('mouseReleased', { x: 20, y: 20 });
    check(await evaluate('!document.querySelector(".selection-region") && !document.querySelector(".is-area-selecting") && document.getElementById("scratch-workspace").hidden'), 'Hiding scratch during selection safely cancels capture and its preview');

    // Selecting and moving a label use the same combined tool.
    await mode('pointer'); await rectangle('main', [250, 90], [370, 150]);
    await selected(['select-b'], 'Select a label for subsequent movement');
    const labelCenter = await evaluate(`(()=>{const hit=document.querySelector('#main-canvas [data-object-id=select-b] .object-hit'),b=hit.getBBox();
      const m=document.querySelector('#main-canvas > svg').getScreenCTM().inverse().multiply(hit.getScreenCTM());
      const p=new DOMPoint(b.x+b.width/2,b.y+b.height/2).matrixTransform(m);return [p.x,p.y]})()`);
    const beforeMove = await read(); await gesture('main', [labelCenter, [labelCenter[0]+20, labelCenter[1]+15]]); await pause(80);
    const moved = await read(), oldLabel = beforeMove.objects.find(o => o.id === 'select-b'), newLabel = moved.objects.find(o => o.id === 'select-b');
    check(Math.abs(newLabel.x - oldLabel.x - 20) < .01 && Math.abs(newLabel.y - oldLabel.y - 15) < .01, 'Select & move immediately drags an area-selected label by exactly the intended canvas delta');
    await evaluate('document.getElementById("zoom-fit").click()');
    await rectangle('main', [90, 90], [380, 180], 1);
    await fs.writeFile(path.join(temp, 'selection-result.png'), (await win.webContents.capturePage()).toPNG());
    win.setSize(480, 800); await pause(80);
    check(await evaluate('(()=>{const r=document.getElementById("pointer-tool").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth})()'), 'Selection tools stay accessible without horizontal overflow at narrow widths');
    await fs.writeFile(path.join(temp, 'selection-narrow.png'), (await win.webContents.capturePage()).toPNG());
    win.setSize(320, 800); await pause(80);
    check(await evaluate('(()=>{const r=document.getElementById("pointer-tool").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth})()'), 'Selection controls also remain accessible at 320px');
    evidence.geometryUnchangedBySelection = true; evidence.mainAndScratch = true; evidence.groupAndIndividual = true;
    evidence.realPointerInput = true; evidence.lassoUsesPolygon = true;
    evidence.combinedSelectAndMove = true; evidence.directFreehandMove = true; evidence.resizeInBothTools = true;
  } finally { win.webContents.debugger.detach(); }
  await fs.writeFile(path.join(temp, 'selection-evidence.json'), JSON.stringify(evidence, null, 2));
  await mode('pointer'); win.setSize(1300, 1000);
  const current = await read();
  const restored = await tool({ action: 'open', illustration_id: original.illustration_id, expected_library_revision: current.library_revision, request_id: randomUUID() });
  check(restored.ok, restored.error || 'Restore the previous disposable figure after selection tests');
}

module.exports = { verifyAreaSelection };
