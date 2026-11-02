// Disposable figures/storage, real slider input, and persistence failure checks.
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

async function verifyOpacity({ tool, evaluate, check, win, pause, temp }) {
  const read = () => tool({ action: 'read' });
  const apply = async operations => {
    const current = await read();
    const result = await tool({ action: 'apply', illustration_id: current.illustration_id, expected_revision: current.revision,
      request_id: randomUUID(), operations });
    check(result.ok, result.error || 'Save opacity fixture'); await pause(50);
  };
  const wait = async predicate => {
    for (let i = 0; i < 100; i++) { const doc = await read(); if (await predicate(doc)) return doc; await pause(30); }
    throw new Error(`Opacity did not settle: ${await evaluate('document.getElementById("status").textContent')}`);
  };
  const select = async id => { await evaluate(`document.querySelector('[data-layer-id="${id}"] .layer-select').click()`); await pause(50); };
  const value = (doc, id = 'opacity-a') => doc.objects.find(object => object.id === id).opacity;
  const inputs = () => evaluate('({range:Number(document.getElementById("opacity-range").value),number:Number(document.getElementById("opacity-number").value)})');
  const number = async (percent, commit = true) => {
    await evaluate(`(()=>{const n=document.getElementById('opacity-number');n.focus();n.dispatchEvent(new Event('pointerdown'));n.value=${JSON.stringify(String(percent))};n.dispatchEvent(new Event('input',{bubbles:true}));${commit ? "n.dispatchEvent(new Event('change',{bubbles:true}))" : ''}})()`);
  };
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><rect x="1" y="1" width="98" height="58" rx="12" fill="#348e8b"/></svg>';
  await tool({ action: 'asset_list' });
  await apply([
    { op: 'upsert', object: { id: 'opacity-a', type: 'vector', name: 'Cell membrane', svg, x: 180, y: 180, width: 260, height: 160, opacity: .8 } },
    { op: 'upsert', object: { id: 'opacity-b', type: 'text', text: 'Receptor', x: 500, y: 250, fontSize: 30, opacity: .35 } }
  ]);
  win.setSize(1300, 950); await pause(80); await select('opacity-a');
  const initialInputs = await inputs();
  check(initialInputs.range === 80 && initialInputs.number === 80, 'Slider and numeric percentage show the selected layer opacity');
  check(await evaluate('(()=>{const a=document.getElementById("opacity-range").getBoundingClientRect(),b=document.getElementById("opacity-number").getBoundingClientRect();return a.width>60&&b.left>a.right&&Math.abs(a.top+a.height/2-b.top-b.height/2)<2})()'), 'The draggable bar is followed by a compact aligned numeric field');
  await fs.writeFile(path.join(temp, 'opacity-day.png'), (await win.webContents.capturePage()).toPNG());
  const beforeDrag = await read();
  const slider = await evaluate('(()=>{const r=document.getElementById("opacity-range").getBoundingClientRect();return {left:r.left+6,width:r.width-12,y:r.top+r.height/2}})()');
  win.webContents.debugger.attach('1.3');
  try {
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: slider.left + slider.width * .8, y: slider.y, buttons: 0 });
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: slider.left + slider.width * .8, y: slider.y, button: 'left', buttons: 1, clickCount: 1 });
    await pause(30);
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: slider.left + slider.width * .4, y: slider.y, button: 'left', buttons: 1 });
    await pause(60);
    const preview = await inputs();
    check(preview.range === preview.number && Math.abs(preview.range - 40) < 2, `Native thumb dragging synchronizes both controls: ${JSON.stringify({preview,slider,temp})}`);
    check(await evaluate(`Math.abs(Number(document.querySelector('[data-object-id=opacity-a]').getAttribute('opacity'))-${preview.range / 100})<.00001`), 'The canvas previews opacity continuously while dragging');
    check((await read()).revision === beforeDrag.revision && value(await read()) === .8, 'Dragging a preview does not write intermediate changes to the document');
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: slider.left + slider.width * .4, y: slider.y, button: 'left', buttons: 0, clickCount: 1 });
    const saved = await wait(doc => doc.revision !== beforeDrag.revision);
    check(Math.abs(value(saved) - preview.range / 100) < .00001, 'Releasing the slider persists its final value');
    await evaluate('illustrationWorkspace.history("undo")'); await wait(doc => value(doc) === .8);
    check((await inputs()).number === 80, 'One undo restores the complete drag and both controls');
    await evaluate('illustrationWorkspace.history("redo")'); await wait(doc => value(doc) === value(saved));
    check(Math.abs((await inputs()).number - value(saved) * 100) < .0001, 'Redo restores the chosen percentage');
    for (const percent of [0, 100, 43.2]) {
      await number(percent); const doc = await wait(doc => Math.abs(value(doc) - percent / 100) < .00001);
      check((await inputs()).range === percent && (await inputs()).number === percent && value(doc, 'opacity-b') === .35, `${percent}% is exact and changes only the selected layer`);
    }
    const beforeKeyboard = await read();
    await evaluate('document.getElementById("opacity-range").focus()');
    for (const type of ['rawKeyDown', 'keyUp']) await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type, key: 'ArrowRight', windowsVirtualKeyCode: 39 });
    const keyboard = await wait(doc => value(doc) > value(beforeKeyboard));
    check(Math.abs(value(keyboard) - .433) < .00001 && keyboard.objects.every((o, i) => o.x === beforeKeyboard.objects[i].x && o.y === beforeKeyboard.objects[i].y), 'Slider arrow keys adjust opacity without nudging the artwork');
    await evaluate(`(()=>{const n=document.getElementById('opacity-number');for(const value of [41,42,43]){n.dispatchEvent(new Event('pointerdown'));n.value=value;n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));}})()`);
    await wait(doc => value(doc) === .43);
    check((await inputs()).number === 43 && !await evaluate('document.getElementById("status").textContent.includes("changed")'), 'Rapid adjustments save in order without revision conflicts');
    const beforeEscape = await read(); await number(20, false);
    await evaluate('document.getElementById("opacity-number").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    check((await read()).revision === beforeEscape.revision && (await inputs()).number === 43 && await evaluate('Number(document.querySelector("[data-object-id=opacity-a]").getAttribute("opacity"))===.43'), 'Escape cancels an unfinished preview without adding history');
    const beforeInvalid = await read();
    for (const invalid of [-1, 101, '']) await number(invalid);
    check((await read()).revision === beforeInvalid.revision && (await inputs()).number === 43, 'Invalid percentages and an empty field never save opacity');
    await win.webContents.executeJavaScript('window.failSave=true'); await number(23);
    await wait(async () => (await inputs()).number === 43);
    check((await read()).revision === beforeInvalid.revision && await evaluate('Number(document.querySelector("[data-object-id=opacity-a]").getAttribute("opacity"))===.43'), 'A failed save restores the persisted value and canvas appearance');
    await win.webContents.executeJavaScript('window.failSave=false');
    await number(12, false); await select('opacity-b');
    const beforeSwitch = await read();
    await evaluate('(()=>{const r=document.getElementById("opacity-range");r.value=12;r.dispatchEvent(new Event("change",{bubbles:true}))})()'); await pause(70);
    check((await read()).revision === beforeSwitch.revision && (await inputs()).number === 35, 'A trailing slider event cannot apply an old preview to a newly selected layer');
    await select('opacity-a'); await number(11, false);
    await apply([{ op: 'update', id: 'opacity-a', patch: { opacity: .66 } }]);
    const agentEdit = await read();
    await evaluate('(()=>{const r=document.getElementById("opacity-range");r.value=11;r.dispatchEvent(new Event("change",{bubbles:true}))})()'); await pause(60);
    check((await read()).revision === agentEdit.revision && (await inputs()).number === 66, 'An agent edit cancels a stale preview instead of being overwritten');
    await win.webContents.executeJavaScript('qaState.settings.appearance={mode:"night",fontSize:16};qaBridge.broadcastAppContext("appearance")'); await pause(80);
    check(await evaluate('document.body.classList.contains("theme-night")'), 'The opacity control follows the host night theme');
    await fs.writeFile(path.join(temp, 'opacity-night.png'), (await win.webContents.capturePage()).toPNG());
    for (const width of [480, 320]) {
      win.setSize(width, 850); await pause(80);
      check(await evaluate('(()=>{const row=document.querySelector(".opacity-control").getBoundingClientRect(),bar=document.getElementById("opacity-range").getBoundingClientRect(),n=document.getElementById("opacity-number").getBoundingClientRect();return row.width>100&&bar.width>35&&n.width>=60&&row.left>=0&&row.right<=innerWidth})()'), `${width}px keeps the slider and numeric value usable without overflow`);
    }
    const beforeOpen = await read(); await number(10, false);
    const opened = await tool({ action: 'create', title: 'Opacity context switch', expected_library_revision: beforeOpen.library_revision, request_id: randomUUID() });
    check(opened.ok, 'Open a disposable second figure during an opacity preview');
    await evaluate('document.getElementById("opacity-range").dispatchEvent(new Event("change",{bubbles:true}))');
    check((await read()).objects.length === 0 && await evaluate('document.getElementById("opacity-range").disabled'), 'Changing figures discards the old preview safely');
  } finally { win.webContents.debugger.detach(); }
}
module.exports = { verifyOpacity };
