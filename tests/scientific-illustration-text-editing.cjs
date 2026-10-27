const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

async function verifyTextEditing({ tool, evaluate, check, win, pause, temp }) {
  const read = () => tool({ action: 'read' });
  const original = await read();
  check((await tool({ action: 'create', title: 'Text editing QA', expected_library_revision: original.library_revision,
    request_id: randomUUID() })).ok, 'Create an isolated text-editing figure');
  const apply = async operations => {
    const current = await read();
    const result = await tool({ action: 'apply', illustration_id: current.illustration_id, expected_revision: current.revision,
      request_id: randomUUID(), operations });
    check(result.ok, result.error || 'Save the text-editing fixture'); await pause(60);
  };
  await apply([
    { op: 'canvas', canvas: 'main', patch: { width: 800, height: 600 } },
    { op: 'upsert', object: { id: 'edit-label', type: 'text', name: 'Editable label', text: 'Cell\nmembrane',
      x: 220, y: 180, width: 180, height: 90, fontFamily: 'Arial', fontSize: 28, align: 'middle', anchor: 'middle', rotation: 27 } },
    { op: 'upsert', object: { id: 'edit-vector', type: 'vector', x: 160, y: 130, width: 300, height: 200,
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><rect width="300" height="200" fill="#cde7df"/></svg>' } },
    { op: 'order', canvas: 'main', ids: ['edit-vector', 'edit-label'] }
  ]);
  win.setSize(1400, 1000); await pause(80);
  await evaluate('document.getElementById("close-layers").click();document.getElementById("zoom-fit").click()');
  const label = async () => (await read()).objects.find(object => object.id === 'edit-label');
  const before = await label();
  const key = async (key, extra = {}) => {
    await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',${JSON.stringify({ key, bubbles: true, ...extra })}))`);
    await pause(80);
  };
  const type = value => evaluate(`(() => {
    const input=document.getElementById('canvas-text-editor');input.value=${JSON.stringify(value)};
    input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  const active = () => evaluate('document.activeElement.id==="canvas-text-editor"');
  const open = async () => {
    await evaluate('document.querySelector("#main-canvas [data-object-id=edit-label]").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}))');
    await pause(50);
    check(await active(), 'Double-click opens and focuses the inline editor');
  };
  win.webContents.debugger.attach('1.3');
  const click = async point => {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, ...point, button: 'left',
        buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
      await pause(25);
      if (type === 'mousePressed') {
        await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + 1, y: point.y,
          button: 'none', buttons: 1 });
      }
    }
  };
  try {
    const point = await evaluate(`(() => {
      const group=document.querySelector('#main-canvas [data-object-id=edit-label]'),box=group.querySelector('text').getBBox();
      const p=new DOMPoint(box.x+box.width/2,box.y+box.height/2).matrixTransform(group.getScreenCTM());return {x:p.x,y:p.y};
    })()`);
    const openingRevision = (await read()).revision;
    const openingScale = await evaluate('(()=>{const m=document.querySelector("#main-canvas > svg").getScreenCTM();return [m.a,m.b,m.c,m.d,m.e,m.f]})()');
    await click(point); await click(point); await pause(80);
    check(await active(), 'Two real pointer clicks open editing despite SVG replacement and pointer capture');
    check(await evaluate('document.activeElement.value==="Cell\\nmembrane" && document.activeElement.selectionStart===0 && document.activeElement.selectionEnd===13'), 'The existing multiline text is selected for replacement');
    check((await read()).revision === openingRevision && JSON.stringify(await label()) === JSON.stringify(before), 'Opening the editor preserves the saved label and geometry');
    check(await evaluate(`document.getElementById('layer-inspector').hidden && (()=>{const m=document.querySelector('#main-canvas > svg').getScreenCTM();return JSON.stringify([m.a,m.b,m.c,m.d,m.e,m.f])===${JSON.stringify(JSON.stringify(openingScale))}})()`), 'Opening inline text editing keeps the canvas scale, placement and closed panel unchanged');
    await key('Escape');
    await evaluate('document.getElementById("main-canvas").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    const edgePoint = await evaluate(`(() => {
      const group=document.querySelector('#main-canvas [data-object-id=edit-label]'),box=group.querySelector('text').getBBox(),m=group.getScreenCTM();
      const p=new DOMPoint(box.x+box.width-1/Math.hypot(m.a,m.b),box.y+box.height/2).matrixTransform(m);return {x:p.x,y:p.y};
    })()`);
    await click(edgePoint); await click(edgePoint); await pause(80);
    check(await active() && (await read()).revision === openingRevision && JSON.stringify(await label()) === JSON.stringify(before),
      'Double-clicking near a newly revealed resize handle opens editing without jitter resizing the font');
    await type('Nucleus\nEnvelope');
    check(await evaluate('document.getElementById("canvas-text-editor").getBoundingClientRect().width>0 && document.querySelector("#main-canvas [data-object-id=edit-label] text").style.visibility==="hidden"'), 'The rotated text editor replaces the visible label without duplicate glyphs');
    await fs.writeFile(path.join(temp, 'inline-text-editing.png'), (await win.webContents.capturePage()).toPNG());
    await key('Enter');
    check(!await active() && (await label()).text === 'Nucleus\nEnvelope', 'Enter commits multiline text');
    check(JSON.stringify({ ...await label(), text: before.text }) === JSON.stringify(before), 'Editing text preserves all layer geometry and formatting');
    await evaluate('illustrationWorkspace.history("undo")'); await pause(60);
    check((await label()).text === before.text, 'One undo restores the complete previous label');
    await evaluate('illustrationWorkspace.history("redo")'); await pause(60);
    check((await label()).text === 'Nucleus\nEnvelope', 'Redo restores the edited label');
    await open(); await type('Discard this'); await key('Escape');
    check((await label()).text === 'Nucleus\nEnvelope' && !await active(), 'Escape discards the draft');
    check(await evaluate('document.querySelector("#main-canvas [data-object-id=edit-label]").getAttribute("aria-pressed")==="true" && !document.querySelector("#main-canvas [data-object-id=edit-label] text").style.visibility'), 'Cancel restores rendered text and keeps the layer selected');
    await open();
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter',
      windowsVirtualKeyCode: 13, modifiers: 8, text: '\r' });
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter',
      windowsVirtualKeyCode: 13, modifiers: 8 });
    check(await active() && await evaluate('document.activeElement.value.includes("\\n")'), 'Shift+Enter inserts a newline and keeps editing active');
    await key('Enter', { isComposing: true });
    check(await active(), 'IME confirmation does not prematurely save the label');
    await type('Saved on blur');
    await evaluate('document.getElementById("figure-title").focus()'); await pause(100);
    check((await label()).text === 'Saved on blur' && !await active(), 'Focusing another control saves the text');
    await evaluate('document.getElementById("layers-tab").click()'); await pause(80);
    const row = await evaluate(`(() => {const box=document.querySelector('[data-layer-id=edit-label] .layer-select').getBoundingClientRect();return {x:box.x+box.width/2,y:box.y+box.height/2}})()`);
    await click(row); await click(row); await pause(60);
    check(await active(), 'Two real clicks on a text row in Layers open its editor');
    await type('Saved on canvas click');
    await click({ x: point.x + 160, y: point.y + 160 }); await pause(100);
    check((await label()).text === 'Saved on canvas click' && !await active(), 'Clicking the canvas saves without dragging the label');
    await open(); await type('Keep this draft');
    await evaluate('document.getElementById("zoom-in").click()'); await pause(60);
    check(await active() && await evaluate(`(() => {
      const editor=document.getElementById('canvas-text-editor'),a=new DOMMatrix(getComputedStyle(editor).transform);
      const b=document.querySelector('#main-canvas [data-object-id=edit-label]').getScreenCTM();
      return Math.abs(a.a-b.a)<0.00001 && Math.abs(a.b-b.b)<0.00001;
    })()`), 'The editor follows zoom and rotation without losing its draft');
    await win.webContents.executeJavaScript('window.failSave=true');
    await key('Enter');
    check(await active() && (await label()).text === 'Saved on canvas click'
      && await evaluate('document.activeElement.value==="Keep this draft" && !document.activeElement.readOnly'), 'A failed save retains the draft for retry');
    await win.webContents.executeJavaScript('window.failSave=false');
    await key('Enter');
    check((await label()).text === 'Keep this draft' && !await active(), 'The retained draft can be saved after retry');
    for (const typography of [
      { fontFamily: 'Inter', fontSize: 31.375, fontWeight: 400, italic: false },
      { fontFamily: 'Inter', fontSize: 31.375, fontWeight: 700, italic: true },
      { fontFamily: 'Arial', fontSize: 20.25, fontWeight: 400, italic: true },
      { fontFamily: 'Arial', fontSize: 48.5, fontWeight: 700, italic: false }
    ]) {
      await apply([{ op: 'update', id: 'edit-label', patch: typography }]);
      await evaluate(`document.fonts.load(${JSON.stringify(`${typography.italic ? 'italic ' : ''}${typography.fontWeight} ${typography.fontSize}px ${typography.fontFamily}`)}).then(()=>true)`);
      const savedTypography = await label();
      await open();
      const matchingFont = () => evaluate(`(() => {
        const input=document.getElementById('canvas-text-editor'),svg=document.querySelector('#main-canvas [data-object-id=edit-label] text');
        const a=getComputedStyle(input),b=getComputedStyle(svg);
        return ['fontFamily','fontSize','fontWeight','fontStyle','fontOpticalSizing','fontKerning','fontSynthesis'].every(key=>a[key]===b[key]);
      })()`);
      check(await matchingFont(), `Inline editing preserves SVG font settings for ${JSON.stringify(typography)}`);
      check(await evaluate('(()=>{const input=document.getElementById("canvas-text-editor");return input.scrollWidth<=input.clientWidth+1})()'), 'Matching font measurement keeps the complete label visible without horizontal clipping');
      await evaluate('document.getElementById("canvas-text-editor").dispatchEvent(new Event("input",{bubbles:true}))');
      check(await matchingFont(), 'Relayout during typing preserves optical sizing, kerning and fractional font size');
      await key('Enter');
      check(JSON.stringify(await label()) === JSON.stringify(savedTypography), 'Entering and leaving text editing preserves the exact saved font and geometry');
    }
    await apply([{ op: 'group', id: 'edit-group', name: 'Label and artwork', ids: ['edit-vector', 'edit-label'] }]);
    const vectorBefore = (await read()).objects.find(object => object.id === 'edit-vector');
    await open(); await type('Edited group label'); await key('Enter');
    check((await label()).text === 'Edited group label' && (await read()).groups[0].ids.includes('edit-label')
      && JSON.stringify((await read()).objects.find(object => object.id === 'edit-vector')) === JSON.stringify(vectorBefore),
    'A grouped label remains independently editable without changing its artwork or membership');
    await open(); await type('Stale draft');
    await apply([{ op: 'update', id: 'edit-label', patch: { text: 'Changed elsewhere' } }]);
    check(!await active() && (await label()).text === 'Changed elsewhere', 'A concurrent text update closes the stale draft instead of overwriting it');
    await open(); await type('Old illustration draft');
    const current = await read();
    check((await tool({ action: 'open', illustration_id: original.illustration_id,
      expected_library_revision: current.library_revision, request_id: randomUUID() })).ok, 'Restore the originating illustration');
    check(!await active() && await evaluate('!document.getElementById("canvas-text-editor")'), 'Switching illustrations dismisses the old text editor');
  } finally { win.webContents.debugger.detach(); }
}

module.exports = { verifyTextEditing };
