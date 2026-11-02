// Native pointer input and disposable storage; never edits a live figure.
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

async function verifySelectionToolbar({ tool, evaluate, check, win, pause, temp }) {
  const read = () => tool({ action: 'read', include_assets: true });
  const current = await read();
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><rect width="100" height="60" rx="12" fill="#79b6ad"/></svg>';
  check((await tool({ action: 'apply', illustration_id: current.illustration_id, expected_revision: current.revision,
    request_id: randomUUID(), operations: [120, 390, 700].map((x, index) => ({ op: 'upsert', object: {
      id: `floating-${index}`, type: 'vector', name: `Component ${index + 1}`, x, y: [150, 260, 180][index], width: 110, height: 70, svg
    } })) })).ok, 'Create a disposable floating-toolbar fixture');
  const select = async count => {
    await evaluate(`for(let i=0;i<${count};i++)document.querySelector('[data-layer-id="floating-'+i+'"] .layer-select').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:i>0}));document.getElementById('close-layers').click()`);
    await pause(60);
  };
  const click = async selector => {
    const position = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    for (const type of ['mousePressed', 'mouseReleased']) await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, ...position, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await pause(80);
  };
  const action = name => click(`#selection-toolbar [data-selection-action="${name}"]`);
  const geometry = () => evaluate(`(()=>{const bar=document.getElementById('selection-toolbar'),r=bar.getBoundingClientRect(),s=document.getElementById('main-canvas').getBoundingClientRect();return {hidden:bar.hidden,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,stage:{left:s.left,right:s.right,top:s.top,bottom:s.bottom}}})()`);
  const inBounds = async message => {
    const r = await geometry();
    check(!r.hidden && r.width > 90 && r.height > 20 && r.left >= r.stage.left && r.right <= r.stage.right && r.top >= r.stage.top && r.bottom <= r.stage.bottom, `${message}: ${JSON.stringify(r)}`);
  };
  win.setSize(1300, 950); await pause(80);
  win.webContents.debugger.attach('1.3');
  try {
    await select(1);
    check(await evaluate('document.getElementById("selection-toolbar").hidden && document.querySelectorAll(".resize-handle").length===8'), 'Single selection retains its eight resize handles without a floating multi-selection bar');
    await select(2);
    check(await evaluate('!document.querySelector(".selection,.selection-move") && document.querySelectorAll(".selection-member").length===2'), 'Several items have individual outlines with no outer frame or invisible shared hit box');
    await inBounds('The bar floats inside the canvas above the selected items');
    const beforeKeys = await read();
    await evaluate('document.querySelector("[data-selection-action=group]").focus();document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}))');
    check(await evaluate('document.activeElement.id==="selection-align"') && JSON.stringify((await read()).objects) === JSON.stringify(beforeKeys.objects), 'Toolbar arrows move focus between enabled controls without nudging artwork');
    await action('align');
    check(await evaluate('document.getElementById("align-menu").open && document.querySelector("[data-layout-action=distribute-horizontal]").disabled'), 'The floating alignment button opens the existing menu with distribution disabled for two items');
    await evaluate('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))'); await pause(50);
    check(await evaluate('!document.getElementById("align-menu").open && document.activeElement.id==="selection-align"'), 'Escape returns focus to the floating alignment button');
    await action('align'); await click('[data-layout-action=left]');
    let after = await read();
    check(after.objects[0].x === after.objects[1].x && after.objects[2].x === beforeKeys.objects[2].x, 'Floating alignment uses existing geometry rules and leaves unselected components alone');
    check(await evaluate('!document.getElementById("align-menu").open && document.activeElement.id==="selection-align"'), 'Alignment closes the menu and retains floating-toolbar focus');
    await evaluate('illustrationWorkspace.history("undo")'); await pause(70);
    check(JSON.stringify((await read()).objects) === JSON.stringify(beforeKeys.objects), 'One undo restores alignment');
    await action('group'); after = await read();
    check(after.groups[0]?.ids.length === 2 && await evaluate('!document.querySelector(".selection") && document.querySelectorAll(".selection-member").length===2'), 'Floating Group keeps individual outlines without creating an outer frame');
    check(await evaluate('document.querySelector("[data-selection-action=group]").disabled && !document.querySelector("[data-selection-action=ungroup]").disabled && document.getElementById("selection-align").disabled'), 'Grouped selection enables Ungroup and treats the group as one alignment unit');
    await action('ungroup');
    check((await read()).groups.length === 0 && JSON.stringify((await read()).objects) === JSON.stringify(beforeKeys.objects), 'Floating Ungroup preserves positions, styles and selection');
    await select(3); await action('align');
    check(await evaluate('!document.querySelector("[data-layout-action=distribute-horizontal]").disabled'), 'Three components enable the existing distribution actions');
    const beforeDistribution = await read(); await click('[data-layout-action=distribute-horizontal]'); after = await read();
    check(Math.abs(after.objects[1].x - after.objects[0].x - after.objects[0].width - (after.objects[2].x - after.objects[1].x - after.objects[1].width)) < .001, 'Floating distribution gives the three items equal gaps');
    await evaluate('illustrationWorkspace.history("undo")'); await pause(70);
    check(JSON.stringify((await read()).objects) === JSON.stringify(beforeDistribution.objects), 'One undo restores distribution');
    await evaluate('document.getElementById("zoom-in").click();document.getElementById("main-canvas").scrollTo(80,50)'); await pause(70);
    await inBounds('Zooming and panning keep the floating bar inside the visible canvas');
    await fs.writeFile(path.join(temp, 'selection-toolbar-wide.png'), (await win.webContents.capturePage()).toPNG());
    for (const width of [720, 480, 320]) {
      win.setSize(width, 850); await pause(100);
      await evaluate('if(document.getElementById("toggle-illustrations").getAttribute("aria-expanded")==="true")document.getElementById("toggle-illustrations").click();document.getElementById("zoom-fit").click()'); await pause(70);
      await select(3); await inBounds(`${width}px keeps the floating toolbar usable`);
      await action('align');
      check(await evaluate('(()=>{const r=document.querySelector("#align-menu .popover-panel").getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()'), `${width}px keeps the anchored alignment menu inside the window`);
      await fs.writeFile(path.join(temp, `selection-toolbar-${width}.png`), (await win.webContents.capturePage()).toPNG());
      await evaluate('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    }
    win.setSize(1300, 950); await pause(80); await select(2);
    const beforeGap = await read();
    const gap = await evaluate('(()=>{const svg=document.querySelector("#main-canvas > svg"),p=new DOMPoint(300,230).matrixTransform(svg.getScreenCTM());return {x:p.x,y:p.y}})()');
    for (const type of ['mousePressed', 'mouseReleased']) await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, ...gap, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await pause(60);
    check(await evaluate('document.getElementById("selection-toolbar").hidden && !document.querySelector("[data-object-id][aria-pressed=true]")') && (await read()).revision === beforeGap.revision, 'Clicking an empty gap clears selection instead of grabbing an invisible group box');
    await select(3);
    const source = await evaluate('(async()=>{const {svgSource}=await import("./artwork.mjs");return svgSource(illustrationWorkspace.getDocument(),"main")})()');
    check(!/selection-toolbar|selection-member|selection-move/.test(source), 'Floating controls and selection outlines never appear in SVG exports');
  } finally { win.webContents.debugger.detach(); }
}
module.exports = { verifySelectionToolbar };
