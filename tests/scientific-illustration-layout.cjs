const fs = require('node:fs/promises');
const path = require('node:path');

async function verifyCanvasRulers({ tool, evaluate, check, win, temp }) {
  const paint = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const measure = () => evaluate(`(() => {
    const stage = document.getElementById('main-canvas'), svg = stage.querySelector(':scope > svg'), matrix = svg.getScreenCTM();
    const axes = [...document.querySelectorAll('[data-ruler-axis]')].map(ruler => {
      const x = ruler.dataset.rulerAxis === 'x', marker = ruler.querySelector('.canvas-ruler-cursor');
      const labels = [...ruler.querySelectorAll('text')].map(label => {
        const value = Number(label.textContent);
        const origin = x ? new DOMPoint(Number(label.getAttribute('x')), 0) : new DOMPoint();
        const actual = origin.matrixTransform(label.getScreenCTM())[x ? 'x' : 'y'];
        const expected = (x ? new DOMPoint(value, 0) : new DOMPoint(0, value)).matrixTransform(matrix)[x ? 'x' : 'y'];
        return { value, error: Math.abs(actual - expected) };
      });
      const point = marker.hasAttribute('hidden') ? null : marker.getPointAtLength(0).matrixTransform(marker.getScreenCTM());
      return { labels, marker: point?.[x ? 'x' : 'y'] ?? null, bounds: ruler.getBoundingClientRect().toJSON() };
    });
    return { axes, stage: stage.getBoundingClientRect().toJSON(), scroll: [stage.scrollLeft, stage.scrollTop], scale: matrix.a };
  })()`);
  const ticksAlign = value => value.axes.every(axis => axis.labels.length >= 2 && axis.labels.every(label => label.error < 0.6));
  const cursorAligns = (value, pointer) => value.axes.every((axis, index) => axis.marker !== null && Math.abs(axis.marker - pointer[index]) < 0.6);
  await evaluate('document.getElementById("zoom-fit").click()'); await paint();
  const before = await tool({ action: 'read' }), fit = await measure();
  const [x, y] = fit.axes;
  check(Math.abs(x.bounds.bottom - fit.stage.top) < 0.6 && Math.abs(y.bounds.right - fit.stage.left) < 0.6, 'The fixed X and Y rulers sit above and beside the canvas viewport');
  check(ticksAlign(fit) && fit.axes.every(axis => axis.labels.some(label => label.value === 0)), 'Both ruler scales align to the fitted canvas and show its origin');
  await evaluate('document.getElementById("layers-tab").click()'); await paint(); await paint();
  const docked = await measure();
  check(docked.stage.width < fit.stage.width && ticksAlign(docked), 'Both ruler scales refit when the Layers panel docks');
  await evaluate('document.getElementById("close-layers").click()'); await paint(); await paint();
  const pointer = [Math.round(fit.stage.left + fit.stage.width * 0.58), Math.round(fit.stage.top + fit.stage.height * 0.42)];
  win.webContents.debugger.attach('1.3');
  const move = ([x, y]) => win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  try {
    await move(pointer); await paint();
    check(cursorAligns(await measure(), pointer), 'Pointer movement places a cursor on both rulers');
    await fs.writeFile(path.join(temp, 'canvas-rulers-fit.png'), (await win.webContents.capturePage()).toPNG());
    await evaluate(`for (let i = 0; i < 5; i++) document.getElementById('zoom-in').click();
      const stage = document.getElementById('main-canvas'); stage.scrollLeft = 240; stage.scrollTop = 160;`);
    await paint();
    const zoomed = await measure();
    check(zoomed.scale > fit.scale && zoomed.scroll.every(offset => offset > 0) && ticksAlign(zoomed), 'Ruler labels stay aligned through zoom and two-axis panning');
    const fitInterval = fit.axes[0].labels[1].value - fit.axes[0].labels[0].value;
    const zoomInterval = zoomed.axes[0].labels[1].value - zoomed.axes[0].labels[0].value;
    check(zoomInterval < fitInterval && cursorAligns(zoomed, pointer), 'Tick intervals adapt to zoom and both cursors stay under a stationary pointer during panning');
    await move([pointer[0], Math.round(zoomed.stage.top - 10)]); await paint();
    check((await measure()).axes.every(axis => axis.marker === null), 'Both ruler cursors clear when the pointer leaves the stage');
  } finally {
    win.webContents.debugger.detach();
    await evaluate('document.getElementById("zoom-fit").click()'); await paint();
  }
  check((await tool({ action: 'read' })).revision === before.revision, 'Ruler interaction leaves the saved scene revision intact');
  check(await evaluate(`import('./artwork.mjs').then(async ({ svgSource }) =>
    !(await svgSource(illustrationWorkspace.getDocument(), 'main')).includes('canvas-ruler'))`), 'Rulers are outside the exported artwork');
}

async function verifyCanvasLayout({ tool, evaluate, check, win, pause, temp }) {
  const measure = () => evaluate(`(() => {
    const box=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
    const work=document.querySelector('.work-area').getBoundingClientRect(),panel=document.getElementById('layer-inspector');
    return {stage:box('main-canvas'),rulerWidth:document.querySelector('[data-ruler-axis="y"]').getBoundingClientRect().width,panel:box('layer-inspector'),tools:box('workspace-tools'),work:{width:work.width,height:work.height,gap:parseFloat(getComputedStyle(document.querySelector('.work-area')).columnGap)},hidden:panel.hidden,inert:panel.inert,expanded:document.getElementById('layers-tab').getAttribute('aria-expanded')};
  })()`);
  await win.webContents.executeJavaScript('qaRailRuntime.setExpanded(false)');
  await evaluate('document.getElementById("close-layers").click();document.getElementById("zoom-fit").click()');
  await pause(80);
  const before = await tool({ action: 'read' }), images = await tool({ action: 'render', canvas: 'main' }), closed = await measure();
  check(closed.hidden && closed.inert && closed.expanded === 'false' && Math.abs(closed.stage.width+closed.rulerWidth+closed.tools.width+8-closed.work.width)<1,
    'Closed Layers releases the entire editing width and removes its controls from focus');
  check(closed.stage.height > closed.work.height * 0.85, 'The main stage dominates the editing height');
  const matrix = () => evaluate('(()=>{const m=document.querySelector("#main-canvas > svg").getScreenCTM();return [m.a,m.d,m.e,m.f]})()');
  const initialMatrix = await matrix();
  win.webContents.debugger.attach('1.3');
  try {
    const target = await evaluate('(()=>{const r=document.querySelector("#main-canvas [data-object-id=label]").getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()');
    for (const type of ['mousePressed', 'mouseReleased']) await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, ...target, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await pause(80);
    check((await measure()).hidden && JSON.stringify(await matrix()) === JSON.stringify(initialMatrix),
      'Pointer selection keeps the inspector closed and the fitted canvas transform steady');
    for (const type of ['mousePressed', 'mouseReleased']) await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, ...target, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 2 });
    await pause(80);
    check((await measure()).hidden && JSON.stringify(await matrix()) === JSON.stringify(initialMatrix)
      && await evaluate('document.activeElement.id==="canvas-text-editor"'),
    `Double-clicking text opens its inline editor without refitting the canvas: ${JSON.stringify({target, panel:await measure(), focus:await evaluate('document.activeElement.id')})}`);
  } finally { win.webContents.debugger.detach(); }
  await evaluate('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));document.getElementById("layers-tab").click()');
  await pause(80);
  const opened = await measure();
  check(Math.abs(closed.stage.width - opened.stage.width - opened.panel.width - 2*opened.work.gap + closed.work.gap) < 1, 'Desktop Layers docks beside the canvas using only its panel width and gutters');
  await fs.writeFile(path.join(temp, 'canvas-layout-properties.png'), (await win.webContents.capturePage()).toPNG());
  await evaluate('document.getElementById("close-layers").focus();document.getElementById("close-layers").click()'); await pause(80);
  check(await evaluate('document.activeElement.id==="layers-tab"') && (await measure()).stage.width === closed.stage.width,
    'Closing the property panel restores canvas width and returns focus to its reopen button');
  win.webContents.debugger.attach('1.3');
  try {
    for (const type of ['keyDown', 'keyUp']) await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r', unmodifiedText: '\r' } : {}) });
    await pause(80);
    check(!(await measure()).hidden, 'Layers opens with the keyboard after closing');
  } finally { win.webContents.debugger.detach(); }
  await evaluate('document.getElementById("close-layers").click()');
  const after = await tool({ action: 'read' }), afterImages = await tool({ action: 'render', canvas: 'main' });
  check(before.revision === after.revision && JSON.stringify(before.objects) === JSON.stringify(after.objects)
    && JSON.stringify(before.canvases) === JSON.stringify(after.canvases), 'Panel and selection changes never alter saved scene coordinates');
  check(JSON.stringify(images.content.filter(item => item.type === 'image')) === JSON.stringify(afterImages.content.filter(item => item.type === 'image')),
    'Agent readbacks of the canvas are byte-identical across panel changes');
  await fs.writeFile(path.join(temp, 'canvas-layout-main.png'), (await win.webContents.capturePage()).toPNG());
  const narrow = [];
  for (const width of [980, 720, 480, 320]) {
    win.setSize(width, 800); await pause(80);
    await evaluate('document.getElementById("layers-tab").click()'); await pause(80);
    const value = await measure(); narrow.push({ width, ...value });
    check(!value.hidden && value.panel.right <= width && value.panel.width > 200 && Math.abs(value.stage.width+value.rulerWidth+value.tools.width+8-value.work.width)<1,
      `${width}px Layers overlays in bounds without reducing the canvas width`);
    check(await evaluate('document.documentElement.scrollWidth<=innerWidth && document.querySelector(".canvas-controls").getBoundingClientRect().bottom<=innerHeight && document.getElementById("complexity").getBoundingClientRect().width>=60'),
      `${width}px keeps the canvas controls inside the bounded workspace`);
    check(await evaluate('["group-selection","ungroup-selection"].every(id=>{const button=document.getElementById(id),r=button.getBoundingClientRect();return button.closest("#workspace-tools") && r.width===30 && r.height===30 && r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight})'),
      `${width}px keeps both grouping toolbar buttons visible and in bounds`);
    check(await evaluate('["layers-tab","assets-tab"].every(id=>{const button=document.getElementById(id),r=button.getBoundingClientRect();return button.closest("#workspace-tools") && r.width===30 && r.height===30 && r.left>=0 && r.right<=innerWidth && getComputedStyle(button).visibility==="visible" && r.bottom<=innerHeight})'),
      `${width}px keeps Layers and Assets accessible in the right toolbar`);
    await evaluate('document.getElementById("close-layers").click();document.getElementById("canvas-size").value="custom";document.getElementById("canvas-size").dispatchEvent(new Event("change",{bubbles:true}))'); await pause(80);
    check(await evaluate('(()=>{const r=document.querySelector(".canvas-options .popover-panel").getBoundingClientRect();return r.top>=0&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&document.activeElement===document.getElementById("canvas-properties").elements.width})()'),
      `${width}px custom size opens below the top controls in bounds with keyboard focus`);
    await evaluate('document.querySelector(".canvas-options").open=false');
  }
  await fs.writeFile(path.join(temp, 'canvas-layout-narrow.png'), (await win.webContents.capturePage()).toPNG());
  win.setSize(1300, 1000); await pause(80);
  await fs.writeFile(path.join(temp, 'canvas-layout.json'), JSON.stringify({ closed, opened, narrow, unchangedRevision: before.revision === after.revision, unchangedPreviews: true }, null, 2));
}

module.exports = { verifyCanvasLayout, verifyCanvasRulers };
