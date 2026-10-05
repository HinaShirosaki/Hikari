const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

async function verifyTextBounds({ tool, evaluate, check, win, pause, temp }) {
  const read = () => tool({ action: 'read' });
  const original = await read();
  const created = await tool({ action: 'create', title: 'Text bounds QA', expected_library_revision: original.library_revision, request_id: randomUUID() });
  check(created.ok, 'Create an isolated text-bounds figure');
  const apply = async operations => {
    const current = await read();
    const result = await tool({ action: 'apply', illustration_id: current.illustration_id, expected_revision: current.revision, request_id: randomUUID(), operations });
    check(result.ok, result.error || 'Text-bounds edit saved'); await pause(50); return result;
  };
  const label = { id: 'bounds-label', name: 'Cell label', type: 'text', text: 'Cell', x: 100, y: 80,
    width: 300, height: 160, fontFamily: 'Inter', fontSize: 28, fontWeight: 400, align: 'start', anchor: 'top' };
  await apply([
    { op: 'upsert', object: { id: 'bounds-art', type: 'vector', x: 100, y: 80, width: 300, height: 160,
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 160"><rect width="300" height="160" fill="#bce8dc"/></svg>' } },
    { op: 'upsert', object: label }
  ]);
  await evaluate('document.fonts.ready.then(()=>true)');
  win.setSize(1300, 1000); await pause(80);
  await evaluate('document.getElementById("close-layers").click();document.getElementById("zoom-fit").click()');
  const selected = () => evaluate('[...document.querySelectorAll("#main-canvas [data-object-id][aria-pressed=true]")].map(node=>node.dataset.objectId).sort()');
  const screen = ([x, y]) => evaluate(`(()=>{const p=new DOMPoint(${x},${y}).matrixTransform(document.querySelector('#main-canvas > svg').getScreenCTM());return {x:p.x,y:p.y}})()`);
  const bounds = (canvas = 'main') => evaluate(`(()=>{
    const group=document.querySelector('#${canvas}-canvas [data-object-id=bounds-label]'),hit=group.querySelector('.object-hit'),glyph=group.querySelector('text').getBBox(),outline=document.querySelector('#${canvas}-canvas .selection > rect');
    const box=node=>({x:Number(node.getAttribute('x')||0),y:Number(node.getAttribute('y')||0),width:Number(node.getAttribute('width')),height:Number(node.getAttribute('height'))});
    const corners=node=>{const b=box(node),m=node.getScreenCTM();return [[b.x,b.y],[b.x+b.width,b.y],[b.x+b.width,b.y+b.height],[b.x,b.y+b.height]].map(([x,y])=>{const p=new DOMPoint(x,y).matrixTransform(m);return {x:p.x,y:p.y}})};
    const m=hit.getScreenCTM();
    return {zoom:Math.hypot(m.a,m.b),hit:box(hit),glyph:{x:glyph.x,y:glyph.y,width:glyph.width,height:glyph.height},hitCorners:corners(hit),outlineCorners:outline&&corners(outline)};
  })()`);
  const checkBounds = async (message, canvas = 'main') => {
    const b = await bounds(canvas);
    // Chromium rounds glyph metrics differently at the measuring and display
    // scales. The target must stay within one displayed pixel of the text.
    check(['x', 'y', 'width', 'height'].every(key => Math.abs(b.hit[key] - b.glyph[key]) * b.zoom < 1), `${message}: hit target fits the rendered glyph bounds ${JSON.stringify(b)}`);
    check(b.outlineCorners && b.outlineCorners.every((p, i) => Math.hypot(p.x - b.hitCorners[i].x, p.y - b.hitCorners[i].y) < 0.001), `${message}: rotated selection outline matches the hit target at zoom`);
  };
  win.webContents.debugger.attach('1.3');
  try {
    const mouse = async (type, point, buttons = 0) => {
      if (type === 'mousePressed') await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: 'none', buttons: 0 });
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, ...point, button: 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
      await pause(30);
    };
    const click = async position => { const p = await screen(position); await mouse('mousePressed', p, 1); await mouse('mouseReleased', p); };
    await click([330, 205]);
    check(JSON.stringify(await selected()) === JSON.stringify(['bounds-art']), 'Clicking empty space inside the old label box selects the artwork underneath');
    await click([120, 100]);
    check(JSON.stringify(await selected()) === JSON.stringify(['bounds-label']), 'Clicking the visible label selects its independent text layer');
    await checkBounds('Short label in an oversized authored box');
    await fs.writeFile(path.join(temp, 'text-short-bounds.png'), (await win.webContents.capturePage()).toPNG());
    for (const mode of ['pointer', 'freehand']) {
      await evaluate(`document.getElementById('selection-tool').value=${JSON.stringify(mode)};document.getElementById('selection-tool').dispatchEvent(new Event('change',{bubbles:true}))`);
      const region = mode === 'pointer' ? [[410, 250], [250, 170]] : [[410, 250], [410, 170], [250, 170], [250, 250]];
      await mouse('mousePressed', await screen(region[0]), 1);
      for (const point of region.slice(1)) await mouse('mouseMoved', await screen(point), 1);
      await mouse('mouseReleased', await screen(region.at(-1)));
      const actual = await selected();
      check(JSON.stringify(actual) === JSON.stringify(['bounds-art']), `${mode} selection ignores blank space in the label's authored box: ${JSON.stringify(actual)}`);
    }
    await evaluate('document.getElementById("selection-tool").value="pointer";document.getElementById("selection-tool").dispatchEvent(new Event("change",{bubbles:true}))');
    for (const align of ['start', 'middle', 'end']) for (const anchor of ['top', 'middle', 'bottom']) {
      await apply([{ op: 'update', id: label.id, patch: { x: 200, y: 180, text: 'ATP\ntransport', align, anchor, rotation: 37, italic: true, underline: true } }]);
      await evaluate('document.querySelector("[data-layer-id=bounds-label] .layer-select").click();document.getElementById("close-layers").click();document.getElementById("zoom-in").click()');
      await checkBounds(`${align}/${anchor} multiline italic label`);
      await evaluate('document.getElementById("zoom-fit").click()');
    }
    await apply([{ op: 'update', id: label.id, patch: { text: 'A longer independently editable label', fontSize: 35, fontWeight: 700, fontFamily: 'Arial', rotation: -25, underline: false } }]);
    await checkBounds('Text and typography edits refresh cached bounds');
    const before = await read(), previewBefore = await tool({ action: 'render', canvas: 'both' });
    await evaluate('document.getElementById("close-layers").click();document.getElementById("zoom-in").click();document.getElementById("zoom-fit").click()');
    const after = await read(), previewAfter = await tool({ action: 'render', canvas: 'both' });
    check(before.revision === after.revision && JSON.stringify(before.objects) === JSON.stringify(after.objects), 'Measuring and zooming text never rewrites saved alignment or placement');
    check(JSON.stringify(previewBefore.content.filter(item => item.type === 'image')) === JSON.stringify(previewAfter.content.filter(item => item.type === 'image')), 'Tight selection bounds leave both agent previews unchanged');
    await fs.writeFile(path.join(temp, 'text-tight-bounds.png'), (await win.webContents.capturePage()).toPNG());
    await apply([{ op: 'update', id: label.id, patch: { text: '', width: 300, height: 160 } }]);
    const empty = await bounds(); check(empty.hit.width === 1 && empty.hit.height === 1, 'An empty label has a tiny target instead of an invisible oversized obstacle');
    await apply([{ op: 'update', id: label.id, patch: { canvas: 'scratch', x: 40, y: 40, text: 'Cell', align: 'start', anchor: 'top', rotation: 37 } }]);
    await evaluate('document.querySelector("[data-layer-id=bounds-label] .layer-select").click();document.getElementById("close-layers").click()'); await pause(80);
    await evaluate('document.getElementById("zoom-fit").click();for(let i=0;i<12;i++)document.getElementById("zoom-in").click()');
    await checkBounds('Scratch label at maximum zoom', 'scratch');
  } finally { win.webContents.debugger.detach(); }
  const listing = await tool({ action: 'list' });
  check((await tool({ action: 'open', illustration_id: original.illustration_id, expected_library_revision: listing.library_revision, request_id: randomUUID() })).ok, 'Restore the originating illustration after text-bounds QA');
}

module.exports = { verifyTextBounds };
