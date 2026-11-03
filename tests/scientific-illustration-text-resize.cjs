const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

async function verifyTextResize({ tool, evaluate, check, win, pause, temp }) {
  const id = 'text-resize-fixture';
  const fixture = { id, type: 'text', text: 'Cell\nmembrane', canvas: 'main', x: 160, y: 140,
    width: 180, height: 72, fontSize: 20, fontFamily: 'Arial', align: 'middle', anchor: 'middle', rotation: 0 };
  const read = async () => (await tool({ action: 'read' })).objects.find(object => object.id === id);
  const apply = async patch => {
    const current = await tool({ action: 'read' });
    const result = await tool({ action: 'apply', illustration_id: current.illustration_id,
      expected_revision: current.revision, request_id: randomUUID(), operations: [{ op: 'upsert', object: { ...fixture, ...patch } }] });
    check(result.ok, result.error || 'Text resize fixture saved'); await pause(60);
    await evaluate(`document.querySelector('[data-layer-id=${id}] .layer-select').click()`); await pause(80);
  };
  const directions = { nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0] };
  const points = (canvas, direction) => evaluate(`(() => {
    const group=document.querySelector('#${canvas}-canvas .selection'),m=group.getScreenCTM(),text=document.querySelector('#${canvas}-canvas [data-object-id=${id}] text');
    const w=Number(group.dataset.selectionWidth),h=Number(group.dataset.selectionHeight),x=0,y=0,[hx,hy]=${JSON.stringify(directions[direction])},glyph=text.getBBox();
    const point=(x,y)=>{const p=new DOMPoint(x,y).matrixTransform(m);return {x:p.x,y:p.y}};
    return {handle:point(x+(hx+1)*w/2,y+(hy+1)*h/2),opposite:point(x+(1-hx)*w/2,y+(1-hy)*h/2),zoom:Math.hypot(m.a,m.b),
      width:w,height:h,fontSize:Number(text.getAttribute('font-size')),glyph:{x:glyph.x,y:glyph.y,width:glyph.width,height:glyph.height}};
  })()`);
  const numericChange = async (name, value) => {
    await evaluate(`(()=>{const input=document.querySelector('#properties [name=${name}]');input.value=${JSON.stringify(String(value))};input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await pause(100);
  };
  win.webContents.debugger.attach('1.3');
  try {
    const mouse = async (type, x, y, buttons = 0, modifiers = 0) => {
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x, y, modifiers, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
      await pause(30);
    };
    await apply({});
    await evaluate('document.getElementById("zoom-fit").click();for(let i=0;i<3;i++)document.getElementById("zoom-in").click()');
    const cases = [0, 37].flatMap(rotation => [false, true].flatMap(shift => Object.keys(directions).map(direction => ({ canvas: 'main', rotation, direction, shift }))));
    let lastResize;
    for (const { canvas, rotation, direction, shift } of cases) {
      await apply({ canvas, rotation, x: 160, y: 140 });
      await evaluate(`document.getElementById('${canvas}-canvas').scrollTo(0,0)`);
      const start = await points(canvas, direction);
      const [horizontal, vertical] = directions[direction], angle = rotation * Math.PI / 180;
      const localX = horizontal ? horizontal * 24 : 9, localY = vertical ? vertical * 18 : 7;
      const dx = (localX * Math.cos(angle) - localY * Math.sin(angle)) * start.zoom, dy = (localX * Math.sin(angle) + localY * Math.cos(angle)) * start.zoom;
      await mouse('mousePressed', start.handle.x, start.handle.y, 1, shift ? 8 : 0);
      await mouse('mouseMoved', start.handle.x + dx, start.handle.y + dy, 1, shift ? 8 : 0);
      await mouse('mouseReleased', start.handle.x + dx, start.handle.y + dy, 0, shift ? 8 : 0); await pause(80);
      const end = await points(canvas, direction), saved = await read();
      const glyphTolerance = 1 / end.zoom;
      check(saved.fontSize === fixture.fontSize && end.fontSize === start.fontSize
        && (shift ? Math.abs(saved.width / saved.height - fixture.width / fixture.height) < 0.0001
          : Math.abs(saved.width - fixture.width - (horizontal ? 24 : 0)) < 0.02 && Math.abs(saved.height - fixture.height - (vertical ? 18 : 0)) < 0.02),
      `Text ${direction} at ${rotation}° ${shift ? 'with Shift ' : ''}resizes the box and keeps the font fixed: ${JSON.stringify({ start, end, saved })}`);
      check(Math.hypot(end.opposite.x - start.opposite.x, end.opposite.y - start.opposite.y) < 0.1,
        'Text box resize fixes the opposite corner or edge midpoint at zoom');
      check(Math.abs(end.glyph.width - start.glyph.width) < glyphTolerance && Math.abs(end.glyph.height - start.glyph.height) < glyphTolerance,
        'Rendered multiline glyph sizes stay fixed while the text box changes');
      check(Math.abs(saved.width-end.width)<0.0001 && Math.abs(saved.height-end.height)<0.0001 && saved.fontSize === end.fontSize
        && saved.text === fixture.text && saved.align === fixture.align && saved.anchor === fixture.anchor,
      'Agent readback and selection handles use the same text box with unchanged typography');
      lastResize = saved;
    }
    await evaluate('illustrationWorkspace.history("undo")'); await pause(80);
    const undone = await read();
    check(undone.width === fixture.width && undone.height === fixture.height && undone.fontSize === fixture.fontSize, 'One undo restores the text box size without a font edit');
    await evaluate('illustrationWorkspace.history("redo")'); await pause(80);
    check(JSON.stringify(await read()) === JSON.stringify(lastResize), 'Redo restores the resized text box');
  } finally { win.webContents.debugger.detach(); }
  await apply({});
  await evaluate('document.getElementById("zoom-fit").click()');
  // Position & size fields were removed; font size is the remaining numeric text control.
  await numericChange('fontSize', 30);
  let saved = await read();
  check(saved.fontSize === 30 && saved.width === 180 && saved.height === 72 && saved.x === fixture.x && saved.y === fixture.y,
    'Font size remains independently editable without moving the layer');
  await evaluate('illustrationWorkspace.history("undo")'); await pause(80); saved = await read();
  check(saved.width === 180 && saved.height === 72 && saved.fontSize === 20, 'Undo restores the text font size');
  await evaluate('illustrationWorkspace.history("redo")'); await pause(80); saved = await read();
  check(saved.fontSize === 30, 'Redo restores the text font size');
  for (const rotation of [0, 37]) {
    await apply({ x: 180, y: 180, width: 300, height: 120, fontSize: 24, align: 'start', anchor: 'top', rotation });
    const before = await read();
    for (const [align, anchorX, css] of [['start', 0, 'left'], ['middle', 150, 'center'], ['end', 300, 'right']]) {
      await evaluate(`document.querySelector('[data-align="${align}"]').click()`); await pause(60);
      const aligned = await read();
      check(JSON.stringify({ ...aligned, align: before.align }) === JSON.stringify(before), `${align} aligns text without moving, resizing, or changing its font`);
      check(await evaluate(`(()=>{const text=document.querySelector('#main-canvas [data-object-id=${id}] text'),frame=document.querySelector('#main-canvas .selection');return Number(text.getAttribute('x'))===${anchorX}&&text.getAttribute('text-anchor')===${JSON.stringify(align)}&&[...text.querySelectorAll('tspan')].every(line=>Number(line.getAttribute('x'))===${anchorX})&&Number(frame.dataset.selectionWidth)===300&&Number(frame.dataset.selectionHeight)===120})()`), `${align} positions every line relative to the text box at ${rotation}°, independently of the canvas size`);
      await evaluate(`document.querySelector('#main-canvas [data-object-id=${id}]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
      check(await evaluate(`(()=>{const input=document.getElementById('canvas-text-editor');return input&&getComputedStyle(input).textAlign===${JSON.stringify(css)}&&parseFloat(input.style.width)>=300&&parseFloat(input.style.fontSize)===24})()`), 'Inline editing shares the text box width, alignment, and fixed font size');
      await evaluate('document.getElementById("canvas-text-editor").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
      const exported = await evaluate('illustrationWorkspace.exportSvg("main")');
      const text = exported.match(new RegExp(`<g[^>]+data-object-id="${id}"[^>]*>[\\s\\S]*?<text([^>]*)>`))?.[1] || '';
      check(text.includes(` x="${anchorX}"`) && text.includes(` text-anchor="${align}"`) && text.includes(' font-size="24"'), 'SVG exports preserve text alignment within the box and the exact font size');
    }
  }
  const rendered = await tool({ action: 'render', canvas: 'main' });
  check(rendered.ok && rendered.content.filter(item => item.type === 'image').length === 1, 'Canvas agent images render after independent text box edits');
  await fs.writeFile(path.join(temp, 'text-box-resize-alignment.png'), (await win.webContents.capturePage()).toPNG());
  await fs.writeFile(path.join(temp, 'text-resize.json'), JSON.stringify(await read(), null, 2));
}

module.exports = { verifyTextResize };
