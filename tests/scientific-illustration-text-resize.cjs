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
    const group=document.querySelector('#${canvas}-canvas [data-object-id=${id}]'),m=group.getScreenCTM(),box=group.querySelector('.object-hit'),text=group.querySelector('text');
    const w=Number(box.getAttribute('width')),h=Number(box.getAttribute('height')),x=Number(box.getAttribute('x')||0),y=Number(box.getAttribute('y')||0),[hx,hy]=${JSON.stringify(directions[direction])},glyph=text.getBBox();
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
    const mouse = async (type, x, y, buttons = 0) => {
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
      await pause(30);
    };
    await apply({});
    await evaluate('document.getElementById("zoom-fit").click();for(let i=0;i<3;i++)document.getElementById("zoom-in").click()');
    const cases = [0, 37].flatMap(rotation => Object.keys(directions).map(direction => ({ canvas: 'main', rotation, direction })));
    cases.push({ canvas: 'scratch', rotation: 37, direction: 'se' });
    for (const { canvas, rotation, direction } of cases) {
      await apply({ canvas, rotation, x: canvas === 'scratch' ? 40 : 160, y: canvas === 'scratch' ? 40 : 140 });
      if (canvas === 'scratch') await evaluate('document.getElementById("zoom-fit").click();document.getElementById("zoom-in").click()');
      await evaluate(`document.getElementById('${canvas}-canvas').scrollTo(0,0)`);
      const start = await points(canvas, direction);
      const [horizontal, vertical] = directions[direction], angle = rotation * Math.PI / 180;
      const localX = horizontal ? horizontal * 24 : 9, localY = vertical ? vertical * 18 : 7;
      const dx = localX * Math.cos(angle) - localY * Math.sin(angle), dy = localX * Math.sin(angle) + localY * Math.cos(angle);
      await mouse('mousePressed', start.handle.x, start.handle.y, 1);
      await mouse('mouseMoved', start.handle.x + dx, start.handle.y + dy, 1);
      await mouse('mouseReleased', start.handle.x + dx, start.handle.y + dy); await pause(80);
      const end = await points(canvas, direction), saved = await read(), factor = end.fontSize / start.fontSize;
      const glyphTolerance = 1 / end.zoom;
      check(Math.abs(factor - 1) > 0.001 && Math.abs(saved.width / saved.height - fixture.width / fixture.height) < 0.0001
        && Math.abs(end.width - start.width * factor) < glyphTolerance && Math.abs(end.height - start.height * factor) < glyphTolerance,
      `Text ${direction} at ${rotation}° on ${canvas} scales the box and font at a fixed ratio: ${JSON.stringify({ start, end })}`);
      check(Math.hypot(end.opposite.x - start.opposite.x, end.opposite.y - start.opposite.y) < 0.1,
        'Proportional text resize fixes the opposite corner or edge midpoint at zoom');
      // Chromium rounds font metrics to screen pixels, even for fractional font sizes.
      check(Math.abs(end.glyph.width - start.glyph.width * factor) < glyphTolerance && Math.abs(end.glyph.height - start.glyph.height * factor) < glyphTolerance
        && Math.abs(end.glyph.x - start.glyph.x * factor) < glyphTolerance && Math.abs(end.glyph.y - start.glyph.y * factor) < glyphTolerance,
      `Rendered multiline glyphs and their alignment scale with the label box: ${JSON.stringify({ direction, rotation, start: start.glyph, end: end.glyph, factor })}`);
      check(Math.abs(saved.width-fixture.width*factor)<0.0001 && Math.abs(saved.height-fixture.height*factor)<0.0001 && saved.fontSize === end.fontSize
        && saved.text === fixture.text && saved.align === fixture.align && saved.anchor === fixture.anchor,
      'Agent readback keeps proportional layout geometry and the exact rendered font; selection bounds follow the glyphs');
    }
  } finally { win.webContents.debugger.detach(); }
  await apply({});
  await evaluate('document.getElementById("close-scratch").click();document.getElementById("zoom-fit").click()');
  await numericChange('width', 360);
  let saved = await read();
  check(saved.width === 360 && saved.height === 144 && saved.fontSize === 40 && saved.x === fixture.x && saved.y === fixture.y,
    'Numeric text width proportionally scales height and font without moving the layer');
  await evaluate('document.getElementById("undo").click()'); await pause(80); saved = await read();
  check(saved.width === 180 && saved.height === 72 && saved.fontSize === 20, 'Undo restores text geometry and font together');
  await evaluate('document.getElementById("redo").click()'); await pause(80); saved = await read();
  check(saved.width === 360 && saved.height === 144 && saved.fontSize === 40, 'Redo restores proportional text scaling');
  await numericChange('height', 36); saved = await read();
  check(saved.width === 90 && saved.height === 36 && saved.fontSize === 10, 'Numeric text height proportionally scales width and font');
  await numericChange('fontSize', 30); saved = await read();
  check(saved.fontSize === 30 && saved.width === 90 && saved.height === 36, 'Font size remains independently editable');
  await numericChange('width', 1800); saved = await read();
  check(saved.fontSize === 300 && saved.width === 900 && saved.height === 360,
    'Numeric dimensions stop at the font limit without breaking the ratio');
  await apply({ width: 270, height: 108, fontSize: 30, rotation: 37 });
  const rendered = await tool({ action: 'render', canvas: 'both' });
  check(rendered.ok && rendered.content.filter(item => item.type === 'image').length === 2, 'Both-canvas agent images render after proportional text edits');
  await fs.writeFile(path.join(temp, 'text-fixed-ratio.png'), (await win.webContents.capturePage()).toPNG());
  await fs.writeFile(path.join(temp, 'text-resize.json'), JSON.stringify(await read(), null, 2));
}

module.exports = { verifyTextResize };
