const fs = require('node:fs/promises');
const path = require('node:path');

async function verifyCanvasLayout({ tool, evaluate, check, win, pause, temp }) {
  const measure = () => evaluate(`(() => {
    const box=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
    const work=document.querySelector('.work-area').getBoundingClientRect(),panel=document.getElementById('layer-inspector');
    return {stage:box('main-canvas'),panel:box('layer-inspector'),work:{width:work.width,height:work.height},hidden:panel.hidden,inert:panel.inert,expanded:document.getElementById('toggle-layers').getAttribute('aria-expanded')};
  })()`);
  await win.webContents.executeJavaScript('qaRailRuntime.setExpanded(false)');
  await evaluate('document.getElementById("close-layers").click();document.getElementById("zoom-fit").click()');
  await pause(80);
  const before = await tool({ action: 'read' }), images = await tool({ action: 'render', canvas: 'both' }), closed = await measure();
  check(closed.hidden && closed.inert && closed.expanded === 'false' && closed.stage.width === closed.work.width,
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
    check(!(await measure()).hidden && await evaluate('document.activeElement.id==="label-content"'),
      `Double-clicking text opens its independent editing controls and focuses the label: ${JSON.stringify({target, panel:await measure(), focus:await evaluate('document.activeElement.id')})}`);
  } finally { win.webContents.debugger.detach(); }
  const opened = await measure();
  check(Math.abs(closed.stage.width - opened.stage.width - opened.panel.width - 12) < 1, 'Desktop Layers docks beside the canvas using only its panel width and gutter');
  await fs.writeFile(path.join(temp, 'canvas-layout-properties.png'), (await win.webContents.capturePage()).toPNG());
  await evaluate('document.getElementById("close-layers").click()'); await pause(80);
  check(await evaluate('document.activeElement.id==="toggle-layers"') && (await measure()).stage.width === closed.stage.width,
    'Closing the property panel restores canvas width and returns focus to its reopen button');
  win.webContents.debugger.attach('1.3');
  try {
    for (const type of ['keyDown', 'keyUp']) await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r', unmodifiedText: '\r' } : {}) });
    await pause(80);
    check(!(await measure()).hidden, 'Layers opens with the keyboard after closing');
  } finally { win.webContents.debugger.detach(); }
  await evaluate('document.getElementById("close-layers").click()');
  const after = await tool({ action: 'read' }), afterImages = await tool({ action: 'render', canvas: 'both' });
  check(before.revision === after.revision && JSON.stringify(before.objects) === JSON.stringify(after.objects)
    && JSON.stringify(before.canvases) === JSON.stringify(after.canvases), 'Panel and selection changes never alter saved scene coordinates');
  check(JSON.stringify(images.content.filter(item => item.type === 'image')) === JSON.stringify(afterImages.content.filter(item => item.type === 'image')),
    'Agent readbacks of both canvases are byte-identical across panel changes');
  await fs.writeFile(path.join(temp, 'canvas-layout-main.png'), (await win.webContents.capturePage()).toPNG());
  const narrow = [];
  for (const width of [980, 720, 480, 320]) {
    win.setSize(width, 800); await pause(80);
    await evaluate('document.getElementById("toggle-layers").click()'); await pause(80);
    const value = await measure(); narrow.push({ width, ...value });
    check(!value.hidden && value.panel.right <= width && value.panel.width > 200 && value.stage.width === value.work.width,
      `${width}px Layers overlays in bounds without reducing the canvas width`);
    check(await evaluate('document.documentElement.scrollWidth<=innerWidth && document.querySelector(".canvas-controls").getBoundingClientRect().bottom<=innerHeight && document.getElementById("complexity").getBoundingClientRect().width>=60'),
      `${width}px keeps the canvas controls inside the bounded workspace`);
    await evaluate('document.getElementById("close-layers").click();document.getElementById("canvas-size").value="custom";document.getElementById("canvas-size").dispatchEvent(new Event("change",{bubbles:true}))'); await pause(80);
    check(await evaluate('(()=>{const r=document.querySelector(".canvas-options .popover-panel").getBoundingClientRect();return r.top>=0&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&document.activeElement===document.getElementById("canvas-properties").elements.width})()'),
      `${width}px custom size opens upward in bounds with keyboard focus`);
    await evaluate('document.querySelector(".canvas-options").open=false');
  }
  await fs.writeFile(path.join(temp, 'canvas-layout-narrow.png'), (await win.webContents.capturePage()).toPNG());
  win.setSize(1300, 1000); await pause(80);
  await fs.writeFile(path.join(temp, 'canvas-layout.json'), JSON.stringify({ closed, opened, narrow, unchangedRevision: before.revision === after.revision, unchangedPreviews: true }, null, 2));
}

module.exports = { verifyCanvasLayout };
