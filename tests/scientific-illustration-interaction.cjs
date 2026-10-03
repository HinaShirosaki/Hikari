const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

async function verifyCanvasInteraction({ tool, evaluate, check, win, pause, temp }) {
  win.setSize(1300, 1000); await pause(100);
  const read = () => tool({ action: 'read' });
  const apply = async operations => {
    const current = await read();
    const result = await tool({ action: 'apply', illustration_id: current.illustration_id,
      expected_revision: current.revision, request_id: randomUUID(), operations });
    check(result.ok, result.error || 'Interaction fixture saved'); await pause(60);
  };
  const scale = canvas => evaluate(`Math.hypot(...(()=>{const m=document.querySelector('#${canvas}-canvas > svg').getScreenCTM();return [m.a,m.b]})())`);
  await evaluate('document.querySelector("button[data-canvas=main]").click();document.getElementById("zoom-fit").click()');
  const before = await read(), imageBefore = await tool({ action: 'render', canvas: 'both' });
  const fitted = await scale('main');
  await evaluate('document.getElementById("zoom-in").click()');
  check(Math.abs(await scale('main') - fitted * 1.25) < 0.001, 'Zoom in uses the displayed canvas scale');
  await evaluate('document.getElementById("zoom-out").click()');
  check(Math.abs(await scale('main') - fitted) < 0.001, 'Zoom out reverses zoom in');
  for (let step = 0; step < 20 && await scale('main') < 1.5; step += 1) await evaluate('document.getElementById("zoom-in").click()');
  check(await scale('main') >= 1.5, 'Zoom controls reach a useful detail scale');
  const mainZoom = await scale('main');
  await evaluate('document.getElementById("toggle-scratch").click();document.querySelector("button[data-canvas=scratch]").click()'); await pause(80);
  const scratchFit = await scale('scratch');
  await evaluate('document.getElementById("zoom-in").click()');
  check(Math.abs(await scale('scratch') - scratchFit * 1.25) < 0.001 && Math.abs(await scale('main') - mainZoom) < 0.001, 'Main and scratch keep independent zoom levels');
  const zoomed = await read(), imageAfter = await tool({ action: 'render', canvas: 'both' });
  check(zoomed.revision === before.revision && JSON.stringify(zoomed.objects) === JSON.stringify(before.objects)
    && JSON.stringify(zoomed.canvases) === JSON.stringify(before.canvases), 'Zoom never changes saved canvas dimensions or object geometry');
  check(JSON.stringify(imageBefore.content.filter(item => item.type === 'image')) === JSON.stringify(imageAfter.content.filter(item => item.type === 'image')), 'MCP images of both canvases are identical before and after view zoom');
  await evaluate('document.getElementById("zoom-fit").click();document.getElementById("close-scratch").click();document.querySelector("button[data-canvas=main]").click()');
  await apply([{ op: 'upsert', object: { id: 'resize-fixture', type: 'vector', x: 40, y: 40, width: 130, height: 80,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 130 80"><rect width="130" height="80" fill="#ff0000"/></svg>' } }]);
  await evaluate('document.querySelector("[data-layer-id=resize-fixture] .layer-select").click();document.getElementById("zoom-fit").click();for(let i=0;i<6;i++)document.getElementById("zoom-in").click()');
  check(await evaluate('(()=>{const stage=document.getElementById("main-canvas"),area=stage.getBoundingClientRect();return [...stage.querySelectorAll(".resize-handle")].every(h=>{const b=h.getBoundingClientRect();return b.left>=area.left && b.top>=area.top && b.right<=area.left+stage.clientWidth && b.bottom<=area.top+stage.clientHeight})})()'), 'Button zoom keeps all handles visible for a selected component near the canvas edge');
  await fs.writeFile(path.join(temp, 'zoom-handles.png'), (await win.webContents.capturePage()).toPNG());
  const directions = { nw: [-1,-1], n: [0,-1], ne: [1,-1], e: [1,0], se: [1,1], s: [0,1], sw: [-1,1], w: [-1,0] };
  const points = direction => evaluate(`(() => {
    const group=document.querySelector('#main-canvas [data-object-id=resize-fixture]'),m=group.getScreenCTM(),box=group.querySelector('.object-hit');
    const w=Number(box.getAttribute('width')),h=Number(box.getAttribute('height')),[hx,hy]=${JSON.stringify(directions[direction])};
    const point=(x,y)=>{const p=new DOMPoint(x,y).matrixTransform(m);return {x:p.x,y:p.y}};
    return {handle:point((hx+1)*w/2,(hy+1)*h/2),opposite:point((1-hx)*w/2,(1-hy)*h/2),width:w,height:h};
  })()`);
  win.webContents.debugger.attach('1.3');
  try {
    const mouse = async (type, x, y, buttons = 0) => {
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
      await pause(30);
    };
    for (const rotation of [0, 37]) {
      for (const direction of Object.keys(directions)) {
        await apply([{ op: 'upsert', object: { id: 'resize-fixture', type: 'vector', canvas: 'main', x: 100, y: 80, width: 130, height: 80, rotation,
          svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 130 80"><rect width="130" height="80" fill="#ff0000"/></svg>' } }]);
        await evaluate('document.querySelector("[data-layer-id=resize-fixture] .layer-select").click();document.getElementById("main-canvas").scrollTo(0,0)');
        const start = await points(direction), [horizontal, vertical] = directions[direction];
        check(await evaluate('document.querySelectorAll("#main-canvas .resize-handle").length===8 && [...document.querySelectorAll("#main-canvas .resize-handle")].every(h=>Math.abs(Number(h.getAttribute("width"))*Math.hypot(h.getScreenCTM().a,h.getScreenCTM().b)-9)<0.01)'), 'All eight handles retain their screen size at high zoom');
        await mouse('mousePressed', start.handle.x, start.handle.y, 1);
        await mouse('mouseMoved', start.handle.x + 24, start.handle.y + 18, 1);
        await mouse('mouseReleased', start.handle.x + 24, start.handle.y + 18);
        await pause(80);
        const end = await points(direction), angle = rotation * Math.PI / 180;
        const localX = horizontal ? 24 * Math.cos(angle) + 18 * Math.sin(angle) : 0;
        const localY = vertical ? -24 * Math.sin(angle) + 18 * Math.cos(angle) : 0;
        const dx = localX * Math.cos(angle) - localY * Math.sin(angle), dy = localX * Math.sin(angle) + localY * Math.cos(angle);
        check(Math.hypot(end.opposite.x - start.opposite.x, end.opposite.y - start.opposite.y) < 0.1
          && Math.hypot(end.handle.x - start.handle.x - dx, end.handle.y - start.handle.y - dy) < 0.1,
        `${direction} at ${rotation}° follows the pointer and fixes its opposite anchor at zoom ${mainZoom}`);
        check((horizontal || end.width === start.width) && (vertical || end.height === start.height), 'Edge handles resize only their active dimension');
        const paint = await evaluate(`(() => {
          const group=document.querySelector('#main-canvas [data-object-id=resize-fixture]'),art=group.querySelector('svg'),rect=art.querySelector('rect');
          const matrix=group.getScreenCTM().inverse().multiply(rect.getScreenCTM()),box=rect.getBBox();
          const first=new DOMPoint(box.x,box.y).matrixTransform(matrix),last=new DOMPoint(box.x+box.width,box.y+box.height).matrixTransform(matrix);
          return {x:first.x,y:first.y,width:last.x-first.x,height:last.y-first.y,aspect:art.getAttribute('preserveAspectRatio')};
        })()`);
        check(paint.aspect === 'none' && Math.abs(paint.x) < 0.001 && Math.abs(paint.y) < 0.001
          && Math.abs(paint.width - end.width) < 0.001 && Math.abs(paint.height - end.height) < 0.001,
        'Painted SVG follows the resized box on both axes, without fixed-ratio letterboxing');
        check((await read()).objects.find(object => object.id === 'resize-fixture').svg.includes('preserveAspectRatio="none"'), 'Free SVG resize is saved for agent readback, preview and export');
      }
    }
    // A zoomed move uses canvas units and preserves scroll during selection and previews.
    const start = await points('se'), zoom = await scale('main');
    const center = { x: (start.handle.x + start.opposite.x) / 2, y: (start.handle.y + start.opposite.y) / 2 };
    const original = (await read()).objects.find(object => object.id === 'resize-fixture');
    await mouse('mousePressed', center.x, center.y, 1); await mouse('mouseMoved', center.x + 20, center.y + 10, 1); await mouse('mouseReleased', center.x + 20, center.y + 10);
    await pause(80);
    const moved = (await read()).objects.find(object => object.id === 'resize-fixture');
    check(Math.abs(moved.x - original.x - 20 / zoom) < 0.01 && Math.abs(moved.y - original.y - 10 / zoom) < 0.01, 'Moving at high zoom maps screen motion to exact canvas coordinates');
    await fs.writeFile(path.join(temp, 'zoom-rotated-handles.png'), (await win.webContents.capturePage()).toPNG());
    const anchor = await evaluate(`(() => {
      const stage=document.getElementById('main-canvas'),r=stage.getBoundingClientRect(),svg=stage.querySelector('svg');
      const x=r.left+stage.clientWidth/2,y=r.top+stage.clientHeight/2,p=new DOMPoint(x,y).matrixTransform(svg.getScreenCTM().inverse());
      return {x,y,canvasX:p.x,canvasY:p.y};
    })()`);
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', x: anchor.x, y: anchor.y, deltaX: 0, deltaY: -100, modifiers: 2 });
    await pause(80);
    check(Math.abs(await scale('main') - zoom * Math.exp(0.2)) < 0.001, 'Ctrl-scroll zooms the canvas instead of the page');
    const held = await evaluate(`(() => {const p=new DOMPoint(${anchor.canvasX},${anchor.canvasY}).matrixTransform(document.querySelector('#main-canvas > svg').getScreenCTM());return {x:p.x,y:p.y}})()`);
    check(Math.hypot(held.x - anchor.x, held.y - anchor.y) < 1.5, 'Wheel zoom holds the canvas point under the pointer');
  } finally { win.webContents.debugger.detach(); }
  await apply([{ op: 'update', id: 'resize-fixture', patch: { rotation: 0, width: 130, height: 80,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 130 80" preserveAspectRatio="xMidYMid meet"><rect width="130" height="80" fill="#ff0000"/></svg>' } }]);
  await evaluate('(()=>{const width=document.querySelector("#properties [name=width]");width.value="260";width.dispatchEvent(new Event("change",{bubbles:true}))})()'); await pause(80);
  let resized = (await read()).objects.find(object => object.id === 'resize-fixture');
  check(resized.width === 260 && resized.height === 80 && resized.svg.includes('preserveAspectRatio="none"'), 'Numeric width also stretches artwork independently of height');
  await evaluate('document.getElementById("undo").click()'); await pause(80);
  resized = (await read()).objects.find(object => object.id === 'resize-fixture');
  check(resized.width === 130 && resized.height === 80 && resized.svg.includes('preserveAspectRatio="xMidYMid meet"'), 'Undo restores the original source aspect ratio with its geometry');
  await evaluate('document.getElementById("redo").click()'); await pause(80);
  resized = (await read()).objects.find(object => object.id === 'resize-fixture');
  check(resized.width === 260 && resized.svg.includes('preserveAspectRatio="none"'), 'Redo restores free stretching and its geometry');
  await evaluate('document.getElementById("main-canvas").scrollTo(120,100)');
  const pan = await evaluate('({x:document.getElementById("main-canvas").scrollLeft,y:document.getElementById("main-canvas").scrollTop})');
  await evaluate('document.querySelector("[data-layer-id=resize-fixture] .layer-select").click()');
  check(await evaluate(`document.getElementById('main-canvas').scrollLeft===${pan.x} && document.getElementById('main-canvas').scrollTop===${pan.y}`), 'Selection rerenders preserve the zoomed scroll position');
  await evaluate('document.getElementById("main-canvas").scrollTo(100000,100000)');
  check(await evaluate('(()=>{const stage=document.getElementById("main-canvas"),area=stage.getBoundingClientRect(),svg=stage.querySelector("svg").getBoundingClientRect();return stage.scrollLeft>0 && stage.scrollTop>0 && svg.right<=area.right && svg.bottom<=area.bottom})()'), 'Scrolling can reach the bottom-right canvas corner at high zoom');
  await evaluate('document.getElementById("zoom-fit").click()');
  check(await evaluate('document.getElementById("main-canvas").scrollLeft===0 && document.getElementById("main-canvas").scrollTop===0 && document.getElementById("zoom-fit").getAttribute("aria-pressed")==="true"'), 'Fit restores the complete canvas and resets pan');
}
module.exports = { verifyCanvasInteraction };
