const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

async function verifyAlignment({ tool, evaluate, check, win, pause, temp }) {
  const host = code => win.webContents.executeJavaScript(code);
  const read = () => tool({ action: 'read' });
  const apply = async operations => {
    const current = await read();
    const result = await tool({ action: 'apply', illustration_id: current.illustration_id,
      expected_revision: current.revision, request_id: randomUUID(), operations });
    check(result.ok, result.error || 'Save alignment fixture'); await pause(80);
  };
  const select = async ids => {
    await evaluate(`(()=>{const ids=${JSON.stringify(ids)};for(let i=0;i<ids.length;i++) document.querySelector('[data-layer-id="'+ids[i]+'"] .layer-select').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:i>0}));document.getElementById('close-layers').click()})()`);
    await pause(80);
  };
  const bounds = async ids => evaluate(`(${JSON.stringify(ids)}).map(id=>{const hit=document.querySelector('[data-object-id="'+id+'"] .object-hit'),r=hit.getBoundingClientRect(),matrix=hit.closest('.canvas-stage').querySelector('svg').getScreenCTM().inverse(),a=new DOMPoint(r.left,r.top).matrixTransform(matrix),b=new DOMPoint(r.right,r.bottom).matrixTransform(matrix);return {x:a.x,y:a.y,width:b.x-a.x,height:b.y-a.y}})`);
  const hosted = await evaluate('document.body.classList.contains("has-host-tools")');
  const open = async () => {
    if (hosted) await host('document.querySelector("[data-workspace-tool-id=align-menu]").click()');
    else await evaluate('document.querySelector("#align-menu summary").click()');
    await pause(80);
  };
  const undo = async before => {
    await host('document.getElementById("global-undo-btn").click()'); await pause(100);
    check(JSON.stringify((await read()).objects) === JSON.stringify(before.objects), 'One system undo restores the entire arrangement');
  };
  const act = async action => {
    await open();
    await evaluate(`document.querySelector('[data-layout-action="${action}"]').click()`); await pause(100);
  };
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="15" fill="#9acabc"/></svg>';
  const dataUrl = await evaluate('(()=>{const c=document.createElement("canvas");c.width=50;c.height=30;const x=c.getContext("2d");x.fillStyle="#bfd1e6";x.fillRect(0,0,50,30);return c.toDataURL()})()');
  await open();
  check(await evaluate('[...document.querySelectorAll("[data-layout-action]")].length===8 && [...document.querySelectorAll("[data-layout-action]")].every(b=>b.disabled)'), 'Eight layout actions are present and disabled without a selection');
  await evaluate('document.getElementById("align-menu").open=false');
  for (const canvas of ['main']) {
    await apply([
      { op: 'upsert', object: { id: `${canvas}-a`, canvas, type: 'vector', x: 40, y: 55, width: 110, height: 50, rotation: 25, svg } },
      { op: 'upsert', object: { id: `${canvas}-b`, canvas, type: 'text', x: 190, y: 130, width: 240, height: 80, text: 'Cell', align: 'middle', anchor: 'middle', fontSize: 22, rotation: -18 } },
      { op: 'upsert', object: { id: `${canvas}-c`, canvas, type: 'raster', x: 460, y: 260, width: 60, height: 40, dataUrl, textFree: true } }
    ]);
    const ids = ['a', 'b', 'c'].map(name => `${canvas}-${name}`);
    await select([ids[0]]); await open();
    check(await evaluate('[...document.querySelectorAll("[data-layout-action]")].every(b=>b.disabled)'), 'A single selected item cannot be aligned to itself');
    await evaluate('document.getElementById("align-menu").open=false');
    await select(ids.slice(0, 2)); await open();
    check(await evaluate('[...document.querySelectorAll("[data-layout-action]")].filter(b=>b.disabled).length===2'), 'Two selected items enable alignment while distribution requires three');
    await evaluate('document.getElementById("align-menu").open=false');
    await select(ids);
    await open();
    const beforeKeyboard = await read();
    await evaluate('document.querySelector("[data-layout-action=left]").focus();document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true}))');
    check(await evaluate('document.activeElement.dataset.layoutAction==="horizontal-center"') && JSON.stringify((await read()).objects) === JSON.stringify(beforeKeyboard.objects), 'Menu arrow navigation changes focus without moving the selected artwork');
    await evaluate('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))'); await pause(80);
    check(await evaluate('!document.getElementById("align-menu").open') && (hosted
      ? await host('document.activeElement.dataset.workspaceToolId==="align-menu"')
      : await evaluate('document.activeElement===document.querySelector("#align-menu summary")')), 'Escape returns focus to the alignment tool');
    for (const [action, axis, size, factor] of [
      ['left', 'x', 'width', 0], ['right', 'x', 'width', 1], ['horizontal-center', 'x', 'width', .5],
      ['top', 'y', 'height', 0], ['bottom', 'y', 'height', 1], ['vertical-center', 'y', 'height', .5]
    ]) {
      const before = await read(), original = await bounds(ids);
      const start = Math.min(...original.map(b => b[axis])), end = Math.max(...original.map(b => b[axis] + b[size]));
      await act(action);
      const after = await read(), moved = await bounds(ids), target = start + (end - start) * factor;
      check(moved.every(b => Math.abs(b[axis] + b[size] * factor - target) < .2), `${canvas} ${action} aligns rendered bounds for vector, raster and rotated text: ${JSON.stringify({ target, original, moved, objects: after.objects, status: await evaluate('document.getElementById("status").textContent'), selected: await evaluate('[...document.querySelectorAll(".canvas-stage [data-object-id][aria-pressed=true]")].map(n=>n.dataset.objectId)') })}`);
      check(after.objects.every((object, i) => JSON.stringify({ ...object, x: before.objects[i].x, y: before.objects[i].y }) === JSON.stringify(before.objects[i])), 'Alignment preserves sizes, fonts, rotation, artwork and every unrelated component');
      check(await evaluate('!document.getElementById("align-menu").open && Boolean(document.querySelector(".selection")) && !document.getElementById("delete").disabled'), 'The menu closes while retaining an editable selection');
      await undo(before);
    }
    for (const [action, axis, size] of [['distribute-horizontal', 'x', 'width'], ['distribute-vertical', 'y', 'height']]) {
      const before = await read(); await act(action);
      const moved = await bounds(ids), gap1 = moved[1][axis] - moved[0][axis] - moved[0][size], gap2 = moved[2][axis] - moved[1][axis] - moved[1][size];
      check(Math.abs(gap1 - gap2) < .2, `${canvas} ${action} gives differently sized rendered items equal gaps`);
      const after = await read();
      check(ids.filter(id => id !== ids[1]).every(id => JSON.stringify(after.objects.find(o => o.id === id)) === JSON.stringify(before.objects.find(o => o.id === id))), 'Distribution keeps both outer components fixed');
      await undo(before);
    }
    await apply([{ op: 'group', id: `${canvas}-group`, name: 'Cell and label', ids: ids.slice(0, 2) }]);
    await open();
    check(await evaluate('document.querySelector("[data-layout-action=distribute-horizontal]").disabled && !document.querySelector("[data-layout-action=right]").disabled'), 'A complete group counts as one layout item');
    await evaluate('document.getElementById("align-menu").open=false');
    const beforeGroup = await read(); await act('right');
    const afterGroup = await read(), a = afterGroup.objects.find(o => o.id === ids[0]), b = afterGroup.objects.find(o => o.id === ids[1]);
    check(Math.abs((a.x - beforeGroup.objects.find(o => o.id === a.id).x) - (b.x - beforeGroup.objects.find(o => o.id === b.id).x)) < 1e-8
      && JSON.stringify(afterGroup.groups.map(({ bounds, ...group }) => group)) === JSON.stringify(beforeGroup.groups.map(({ bounds, ...group }) => group)), 'Group arrangement translates its members together and preserves membership');
    await undo(beforeGroup);
    await apply([{ op: 'ungroup', id: `${canvas}-group` }]);
  }
  await open();
  check(await evaluate('(()=>{const r=document.querySelector("#align-menu .popover-panel").getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()'), 'Alignment menu fits within the workspace');
  await fs.writeFile(path.join(temp, `alignment-${hosted ? 'hosted' : 'local'}.png`), (await win.webContents.capturePage()).toPNG());
  await evaluate('document.getElementById("align-menu").open=false');
  const preview = await tool({ action: 'render', canvas: 'main' });
  check(preview.content.filter(content => content.type === 'image').length === 1, 'The canvas remains available through agent rendering after arrangement');
}
module.exports = { verifyAlignment };
