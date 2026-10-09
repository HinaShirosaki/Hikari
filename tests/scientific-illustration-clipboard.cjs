// Native keyboard input; clipboard events use an isolated in-frame clipboard
// so the fixture never replaces the user's operating-system clipboard.
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

async function verifyClipboard({ tool, evaluate, check, win, pause, temp }) {
  const read = () => tool({ action: 'read', include_assets: true });
  const apply = async operations => {
    const current = await read();
    const result = await tool({ action: 'apply', illustration_id: current.illustration_id,
      expected_revision: current.revision, request_id: randomUUID(), operations });
    check(result.ok, result.error || 'Save copy/paste fixture'); return result;
  };
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="#73b4aa"/><circle cx="50" cy="50" r="30" fill="#f3cd77"/></svg>';
  const dataUrl = await evaluate('(()=>{const c=document.createElement("canvas");c.width=c.height=4;c.getContext("2d").fillRect(0,0,4,4);return c.toDataURL()})()');
  await apply([
    { op: 'upsert', object: { id: 'copy-vector', name: 'Receptor', type: 'vector', svg, x: 180, y: 120, width: 170, height: 100, rotation: 37, fill: '#73b4aa', stroke: '#376e65', strokeWidth: 2, opacity: 0.8 } },
    { op: 'upsert', object: { id: 'copy-raster', name: 'Cargo', type: 'raster', dataUrl, textFree: true, x: 390, y: 160, width: 70, height: 90, rotation: -12 } },
    { op: 'upsert', object: { id: 'copy-text', name: 'Independent label', type: 'text', text: 'α Receptor\nATP', x: 190, y: 300, width: 300, height: 80, fontSize: 26, italic: true, align: 'end', anchor: 'middle' } },
    { op: 'upsert', object: { id: 'copy-other', name: 'Ungrouped label', type: 'text', text: 'Unchanged', x: 650, y: 120 } }
  ]);
  await evaluate(`window.qaClipboard='';window.qaClipboardUnavailable=false;
    document.execCommand=action=>{
      if(window.qaClipboardUnavailable)return false;
      const data=new DataTransfer();if(action==='paste')data.setData('text/plain',qaClipboard);
      const event=new ClipboardEvent(action,{bubbles:true,cancelable:true,clipboardData:data});
      document.activeElement.dispatchEvent(event);
      if(action==='copy')qaClipboard=data.getData('text/plain');return event.defaultPrevented;
    };`);
  const select = async id => {
    await evaluate(`document.querySelector('[data-layer-id="${id}"] .layer-select').click();document.getElementById('close-layers').click();document.getElementById('${id === 'scratch-copy' ? 'scratch' : 'main'}-canvas').focus()`);
    await pause(40);
  };
  const selection = () => evaluate('[...document.querySelectorAll("#layers .layer-select[aria-pressed=true]")].map(button=>button.closest("[data-layer-id]").dataset.layerId)');
  const content = ({ id, canvas, x, y, ...rest }) => rest;
  const sameCopy = (copy, original, offset, canvas = 'main') => copy.id !== original.id && copy.canvas === canvas && copy.x === original.x + offset && copy.y === original.y + offset
    && JSON.stringify(content(copy)) === JSON.stringify(content(original));
  win.webContents.debugger.attach('1.3');
  const key = async (letter, modifiers = 2) => {
    for (const type of ['rawKeyDown', 'keyUp']) await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
      type, modifiers, key: letter, code: `Key${letter.toUpperCase()}`, windowsVirtualKeyCode: letter.toUpperCase().charCodeAt(0)
    });
  };
  const settled = async () => { await evaluate('illustrationWorkspace.flush().then(()=>true)'); await pause(50); return read(); };
  try {
    await select('copy-vector');
    await evaluate('document.getElementById("figure-title").focus()');
    const point = await evaluate('(()=>{const r=document.querySelector("#main-canvas [data-object-id=copy-vector]").getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()');
    for (const type of ['mousePressed', 'mouseReleased']) await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, ...point, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    check(await evaluate('document.activeElement.id==="main-canvas"'), 'Selecting on canvas leaves text-field focus so shortcuts act on the component');
    let before = await read(); await key('c');
    check((await read()).revision === before.revision, 'Ctrl-C does not save or change history');
    check(await evaluate('JSON.parse(qaClipboard).format==="hikari.figura.components"'), 'Copy event carries editable scene data');
    await key('v'); let after = await settled(), copied = after.objects.filter(object => !before.objects.some(old => old.id === object.id));
    check(copied.length === 1 && sameCopy(copied[0], before.objects[0], 15), 'Ctrl-V creates an independent vector with exact artwork, styling, rotation and size');
    check(JSON.stringify(await selection()) === JSON.stringify([copied[0].id]), 'Pasted component is selected');
    await evaluate('illustrationWorkspace.history("undo")'); after = await settled();
    check(JSON.stringify(after.objects) === JSON.stringify(before.objects), 'One undo removes the paste');
    await evaluate('illustrationWorkspace.history("redo")'); after = await settled();
    check(after.objects.some(object => object.id === copied[0].id), 'Redo restores the same pasted component IDs');
    await select('copy-raster'); before = await read(); await key('c', 4); await key('v', 4); after = await settled();
    copied = after.objects.filter(object => !before.objects.some(old => old.id === object.id));
    check(copied.length === 1 && sameCopy(copied[0], before.objects.find(object => object.id === 'copy-raster'), 15), 'Command-C/V copies raster bytes without changing intentional stretch');

    await apply([{ op: 'group', id: 'copy-group', name: 'Labeled receptor', ids: ['copy-text', 'copy-vector', 'copy-raster'] }]);
    await select('copy-group'); before = await read(); await key('c');
    await apply([{ op: 'update', id: 'copy-vector', patch: { name: 'Changed after copy', x: 25 } }, { op: 'delete', id: 'copy-group' }]);
    const deleted = await read(); await key('v'); after = await settled();
    copied = after.objects.filter(object => !deleted.objects.some(old => old.id === object.id));
    const sources = before.objects.filter(object => ['copy-vector', 'copy-raster', 'copy-text'].includes(object.id));
    check(copied.length === 3 && copied.every((object, index) => sameCopy(object, sources[index], 15)), 'Copy remains a frozen snapshot after its source group changes and is deleted');
    const group = after.groups.find(group => group.name === 'Labeled receptor');
    check(group?.id !== 'copy-group' && JSON.stringify(group.ids) === JSON.stringify([copied[2].id, copied[0].id, copied[1].id]), 'Paste remaps the whole group while retaining its name and membership order');
    const groupSelection = await selection();
    check(copied.every(object => groupSelection.includes(object.id)) && await evaluate('!document.getElementById("ungroup-selection").disabled'), `Pasted group stays selected and editable: ${JSON.stringify(groupSelection)}`);
    await fs.writeFile(path.join(temp, 'clipboard-group.png'), (await win.webContents.capturePage()).toPNG());
    await evaluate('illustrationWorkspace.history("undo")'); after = await settled();
    check(JSON.stringify(after.objects) === JSON.stringify(deleted.objects) && after.groups.length === 0, 'Group paste is one undoable edit');
    await key('v'); after = await settled();
    const pastedGroup = after.groups[0];
    await select(pastedGroup.id); await key('c');
    before = await read(); await key('v'); await key('v'); await key('v'); after = await settled();
    check(after.objects.length === before.objects.length + 9 && after.groups.length === before.groups.length + 3, 'Rapid paste shortcuts each commit without revision conflicts');
    const last = after.objects.slice(-3), source = before.objects.filter(object => pastedGroup.ids.includes(object.id));
    check(last.every((object, index) => sameCopy(object, source[index], 45)), 'Repeated pastes cascade their position and retain layer order');

    await tool({ action: 'scratch', illustration_id: after.illustration_id, visible: true });
    await evaluate('document.querySelector("button[data-canvas=scratch]").click();document.getElementById("scratch-canvas").focus()');
    before = await read(); await key('v'); after = await settled();
    const scratch = after.objects.filter(object => object.canvas === 'scratch');
    check(scratch.length === 3 && after.groups.some(group => group.canvas === 'scratch' && group.ids.length === 3), 'Paste targets Scratch and retains grouping');
    check(JSON.stringify(after.objects.filter(object => object.canvas === 'main')) === JSON.stringify(before.objects.filter(object => object.canvas === 'main')), 'Scratch paste preserves all Main components');
    await tool({ action: 'scratch', illustration_id: after.illustration_id, visible: false });
    const created = await tool({ action: 'create', title: 'Paste destination', expected_library_revision: after.library_revision, request_id: randomUUID() });
    check(created.ok, created.error || 'Create separate paste destination');
    await evaluate('document.getElementById("main-canvas").focus()'); await key('v'); after = await settled();
    check(after.objects.length === 3 && after.groups.length === 1 && after.objects.every((object, index) => sameCopy(object, source[index], 75)), 'Clipboard works between illustrations without changing the snapshot');

    await evaluate('document.getElementById("figure-title").focus();window.qaTextCopyEvent=new ClipboardEvent("copy",{bubbles:true,cancelable:true,clipboardData:new DataTransfer()});document.activeElement.dispatchEvent(qaTextCopyEvent)');
    check(await evaluate('document.activeElement.id==="figure-title" && !qaTextCopyEvent.defaultPrevented'), 'Copy in a text field retains native text editing');
    before = await read(); await key('c'); await key('v'); after = await settled();
    check(after.revision === before.revision, 'Text-field shortcuts never clone the canvas selection');
    await evaluate('qaClipboard="ordinary external text";document.getElementById("main-canvas").focus()');
    await key('v'); after = await settled();
    check(after.revision === before.revision, 'Unrelated clipboard text does not paste stale components');
    await select(after.groups[0].id); await key('c');
    await win.webContents.executeJavaScript('window.failSave=true'); before = await read(); await key('v'); after = await settled();
    check(after.revision === before.revision && after.objects.length === before.objects.length, 'Failed paste leaves scene geometry and history unchanged');
    await win.webContents.executeJavaScript('window.failSave=false'); await key('v'); after = await settled();
    check(after.objects.length === before.objects.length + 3, 'Paste can retry after a disk failure');
    await select(after.groups[0].id); await evaluate('window.qaClipboardUnavailable=true'); await key('c');
    before = await read(); await key('v'); after = await settled();
    check(after.objects.length === before.objects.length + 3, 'Ctrl shortcuts still work when the browser clipboard command is unavailable');
    await evaluate('window.qaClipboardUnavailable=false');
    const member = after.groups[0].ids.find(id => after.objects.find(object => object.id === id).type === 'text');
    await select(member); await key('c'); before = await read(); await key('v'); after = await settled();
    copied = after.objects.filter(object => !before.objects.some(old => old.id === object.id));
    check(copied.length === 1 && sameCopy(copied[0], before.objects.find(object => object.id === member), 15) && after.groups.length === before.groups.length, 'A separately selected group label pastes as an independent text component');
    const solo = copied[0].id, second = after.groups[0].ids.find(id => after.objects.find(object => object.id === id).type === 'vector');
    await select(solo); await evaluate(`document.querySelector('[data-layer-id="${second}"] .layer-select').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));document.getElementById('close-layers').click();document.getElementById('main-canvas').focus()`);
    await key('c'); before = await read(); await key('v'); after = await settled();
    copied = after.objects.filter(object => !before.objects.some(old => old.id === object.id));
    check(copied.length === 2 && after.groups.length === before.groups.length && copied.every((object, index) => sameCopy(object, before.objects.filter(object => [solo, second].includes(object.id))[index], 15)), 'Multiple independently selected components paste without creating an unintended group');
    await evaluate('window.qaClipboardUnavailable=false;qaClipboard=JSON.stringify({format:"hikari.figura.components",version:1,objects:[{id:"bad",type:"vector",svg:"<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 1 1\\"><script>alert(1)</script></svg>"}],groups:[]})');
    before = await read(); await key('v'); after = await settled();
    check(after.revision === before.revision, 'Malformed or executable clipboard SVG is rejected before saving');
    await evaluate('window.clipboardQaBeforeReload=true;location.reload()');
    for (let i = 0; i < 100; i++) {
      if (await evaluate('!window.clipboardQaBeforeReload && Boolean(window.illustrationWorkspace?.getDocument())').catch(() => false)) break;
      await pause(30);
    }
    await evaluate('illustrationWorkspace.ready.then(()=>true)');
    check(JSON.stringify((await read()).objects) === JSON.stringify(before.objects), 'Pasted editable components survive plugin reload');
  } finally { win.webContents.debugger.detach(); }
}

module.exports = { verifyClipboard };
