// Reusable assets through the installed plugin UI and actual MCP transport.
// Uses disposable Hikari storage; no model or account access is required.
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

async function verifyReusableAssets({ tool, evaluate, check, win, pause, temp }) {
  win.setSize(1300, 1000); await pause(80);
  const read = () => tool({ action: 'read', include_assets: true });
  const original = await read();
  const create = async title => {
    const r = await read();
    const result = await tool({ action: 'create', title, expected_library_revision: r.library_revision, request_id: randomUUID() });
    check(result.ok, result.error || 'Create reusable component test figure');
    await tool({ action: 'asset_list' }); return result;
  };
  const apply = async operations => {
    const r = await read(), args = { action: 'apply', illustration_id: r.illustration_id, expected_revision: r.revision, request_id: randomUUID(), operations };
    const result = await tool(args); check(result.ok, result.error || 'Asset canvas edit persists through MCP'); await pause(50); return { result, args };
  };
  const settle = () => evaluate('illustrationWorkspace.flush().then(()=>true)');
  const openAssets = 'if(document.getElementById("assets-panel").hidden)document.getElementById("assets-tab").click();';
  const clickSwitch = async name => {
    const target = await evaluate(`(()=>{const r=document.getElementById(${JSON.stringify(name + '-tab')}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    win.webContents.debugger.attach('1.3');
    try {
      for (const type of ['mousePressed', 'mouseReleased']) await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, ...target, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
      await pause(50);
    } finally { win.webContents.debugger.detach(); }
  };
  await create('Reusable component QA');
  const raster = await evaluate('(()=>{const c=document.createElement("canvas");c.width=4;c.height=3;const ctx=c.getContext("2d");ctx.fillStyle="#537f9a";ctx.fillRect(0,0,4,3);return c.toDataURL()})()');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -10 100 60"><defs><linearGradient id="color"><stop offset="0" stop-color="#287c75"/><stop offset="1" stop-color="#d9ebf4"/></linearGradient></defs><ellipse cx="40" cy="20" rx="44" ry="24" fill="url(#color)" stroke="#287c75" stroke-width="2"/></svg>';
  await apply([
    { op: 'upsert', object: { id: 'asset-cell', name: 'Cell membrane', type: 'vector', x: 120, y: 100, width: 180, height: 120, rotation: 29, svg } },
    { op: 'upsert', object: { id: 'asset-image', name: 'Inset image', type: 'raster', x: 340, y: 140, width: 80, height: 60, rotation: -18, dataUrl: raster, textFree: true } },
    { op: 'upsert', object: { id: 'asset-label', name: 'Independent cell label', type: 'text', text: 'Cell α', x: 150, y: 250, width: 170, height: 40, fontSize: 25, fontFamily: 'Inter', fontWeight: 600, color: '#243746', anchor: 'middle', align: 'middle' } },
    { op: 'group', id: 'asset-source-group', name: 'Cell component', ids: ['asset-cell', 'asset-image', 'asset-label'] }
  ]);
  const before = await read(), beforePreview = await tool({ action: 'render', canvas: 'both' });
  const review = { layout: 'Mixed component lies within main; scratch is empty.', labels: 'Cell alpha is independent text.', artwork: 'Vector and embedded raster are text-free.', science: 'Geometry fixture only; no scientific interpretation.' };
  const inspected = await tool({ action: 'inspect', expected_revision: before.revision, inspection_id: beforePreview.inspection.inspection_id, review });
  check(inspected.ok, 'Inspection completes before saving an asset');
  await evaluate('document.querySelector("[data-layer-id=asset-source-group] .layer-select").click();document.getElementById("save-selection-asset").click()');
  check(await evaluate('document.getElementById("save-asset-dialog").open && document.getElementById("asset-name").value==="Cell component"'), 'UI saving a selected group opens its named snapshot dialog');
  await evaluate('document.getElementById("asset-name").value="Reusable cell";document.getElementById("save-asset-form").requestSubmit()'); await settle(); await pause(80);
  let list = await tool({ action: 'asset_list' }), entry = list.reusable_assets.find(asset => asset.name === 'Reusable cell');
  const otherAssetIds = list.reusable_assets.filter(asset => asset.id !== entry?.id).map(asset => asset.id);
  check(list.ok && entry?.name === 'Reusable cell' && entry.objectCount === 3, 'UI save persists vector, raster and text as one reusable asset');
  const afterSave = await read();
  check(afterSave.revision === before.revision && afterSave.inspection.complete && JSON.stringify(afterSave.objects) === JSON.stringify(before.objects), 'Saving leaves scene coordinates, revision and completed inspection intact');
  check(await evaluate('!document.getElementById("assets-panel").hidden && document.getElementById("layers-panel").hidden'), 'Saved components appear in Assets beside Layers');
  const railState = () => evaluate(`(()=>{
    const rail=document.getElementById('layer-inspector'),rect=rail.getBoundingClientRect();
    const panels=['layers','assets'].map(name=>({name,hidden:document.getElementById(name+'-panel').hidden,inert:document.getElementById(name+'-panel').inert,selected:document.getElementById(name+'-tab').getAttribute('aria-pressed'),expanded:document.getElementById(name+'-tab').getAttribute('aria-expanded')}));
    return {hidden:rail.hidden,inert:rail.inert,width:rect.width,canvasWidth:document.getElementById('main-canvas').getBoundingClientRect().width,panels};
  })()`);
  const expectRail = async active => {
    const value = await railState();
    check(value.hidden === !active && value.inert === !active && value.panels.every(p=>p.hidden === (p.name!==active) && p.inert === (p.name!==active) && p.selected === String(p.name===active) && p.expanded === String(p.name===active)),
      `Shared rail shows only ${active || 'neither panel'} with matching visibility, focus access and toolbar state`);
    return value;
  };
  const assetsOpen = await expectRail('assets');
  check(await evaluate('document.querySelectorAll("#workspace-tools #component-panel-switch button").length===2 && !document.querySelector("#layer-inspector #layers-tab, #layer-inspector #assets-tab") && !document.getElementById("toggle-components") && !document.getElementById("browse-assets")'), 'Layers and Assets share one toolbar switch with no duplicate panel tabs or toggle');
  await clickSwitch('layers'); const layersOpen = await expectRail('layers');
  check(Math.abs(assetsOpen.width-layersOpen.width)<1 && Math.abs(assetsOpen.canvasWidth-layersOpen.canvasWidth)<1, 'Layers and Assets use the same rail width without taking extra canvas space');
  await clickSwitch('assets'); await expectRail('assets');
  await clickSwitch('assets'); const closedRail = await expectRail(null);
  check(closedRail.canvasWidth>assetsOpen.canvasWidth, 'Clicking the active Assets toolbar button folds the rail and returns space to the canvas');
  await clickSwitch('assets'); await expectRail('assets');
  await evaluate('document.getElementById("layers-tab").click();document.getElementById("layers-tab").click()'); await expectRail(null);
  await evaluate('document.getElementById("layers-tab").click()'); await expectRail('layers');
  await evaluate(openAssets+'document.getElementById("assets-tab").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",bubbles:true}))');
  await expectRail('layers');
  const afterSwitch = await read();
  check(afterSwitch.revision===before.revision && JSON.stringify(afterSwitch.objects)===JSON.stringify(before.objects), 'Switching tabs with arrow keys never moves the selected canvas components');
  await evaluate(openAssets+'document.getElementById("asset-search").focus();document.getElementById("close-layers").click()');
  await expectRail(null);
  check(await evaluate('document.activeElement.id==="assets-tab"'), 'Closing Assets returns keyboard focus to its toolbar button');
  await evaluate('document.getElementById("assets-tab").click()'); await expectRail('assets');
  await evaluate('document.getElementById("asset-search").focus();document.getElementById("layers-tab").click()');
  check(await evaluate('document.activeElement.id==="layers-tab"'), 'Switching while a panel input is focused transfers focus to the new toolbar button');
  await evaluate(openAssets);
  for (let i = 0; i < 60; i++) { if (await evaluate('Boolean(document.querySelector(".asset-preview")?.naturalWidth)')) break; await pause(40); }
  check(await evaluate('document.querySelector(".asset-preview").naturalWidth>0'), 'Assets renders a thumbnail from the saved editable component');
  await fs.writeFile(path.join(temp, 'reusable-assets-library.png'), (await win.webContents.capturePage()).toPNG());
  const metadata = await tool({ action: 'asset_read', asset_id: entry.id });
  const full = await tool({ action: 'asset_read', asset_id: entry.id, include_assets: true });
  check(metadata.ok && !metadata.component.objects.find(o => o.type === 'raster').dataUrl && full.component.objects.find(o => o.type === 'raster').dataUrl === raster, 'Agent can read asset properties while raster bytes are opt-in');
  const assetPreview = await tool({ action: 'asset_render', asset_id: entry.id });
  check(assetPreview.ok && assetPreview.content.filter(c => c.type === 'image').length === 1 && assetPreview.previews[0].width <= 400, 'Agent receives a native image preview of the saved component');
  check((await read()).inspection.complete, 'Asset preview does not substitute for or invalidate canvas inspection');
  const forSave = await read();
  const agentSaved = await tool({ action: 'asset_save', illustration_id: forSave.illustration_id, expected_revision: forSave.revision,
    expected_assets_revision: forSave.assets_revision, request_id: randomUUID(), id: 'asset-label', name: 'Reusable label' });
  check(agentSaved.ok && agentSaved.reusable_assets.find(a => a.id === agentSaved.asset_id)?.objectCount === 1, 'Agent saves a single independent component through the real MCP transport');
  check((await tool({ action: 'asset_delete', asset_id: agentSaved.asset_id, expected_assets_revision: agentSaved.assets_revision, request_id: randomUUID() })).ok, 'Agent removes only its saved single-component snapshot through MCP');
  await evaluate('document.getElementById("asset-search").value="no match";document.getElementById("asset-search").dispatchEvent(new Event("input",{bubbles:true}))');
  check(await evaluate('document.querySelectorAll(".saved-asset").length===0 && !document.getElementById("assets-empty").hidden'), 'Reusable assets search has a useful empty state');
  await evaluate('document.getElementById("asset-search").value="";document.getElementById("asset-search").dispatchEvent(new Event("input",{bubbles:true}))');
  await create('Reuse in a new figure');
  await evaluate(openAssets+'document.getElementById("assets-tab").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",bubbles:true}))');
  check(await evaluate('document.activeElement.id==="layers-tab" && !document.getElementById("layers-panel").hidden'), 'The toolbar switch supports keyboard navigation');
  await evaluate(openAssets+`document.querySelector('[data-saved-asset="${entry.id}"] .asset-insert').click()`); await settle(); await pause(80);
  let placed = await read();
  check(placed.objects.length === 3 && placed.groups[0]?.name === 'Reusable cell' && placed.objects.every(o => !before.objects.some(old => old.id === o.id)), 'User inserts a fresh editable group into a different illustration');
  check(placed.objects.every((o, i) => o.rotation === before.objects[i].rotation && Math.abs(o.width-before.objects[i].width)<1e-8 && Math.abs(o.height-before.objects[i].height)<1e-8)
    && placed.objects[2].fontSize === 25 && placed.objects[1].dataUrl === raster, 'UI reuse preserves independent types, rotations, dimensions, typography and embedded raster bytes');
  const textId = placed.objects.find(o => o.type === 'text').id;
  await evaluate(`document.querySelector('#main-canvas [data-object-id="${textId}"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
  check(await evaluate('!document.getElementById("layers-panel").hidden && document.activeElement.id==="label-content"'), 'Double-clicking a placed label opens its text controls while Assets is active');
  await expectRail('layers');
  await evaluate(`document.querySelector('[data-layer-id="${textId}"] .layer-select').click();document.getElementById('label-content').value='Edited copy';document.getElementById('label-content').dispatchEvent(new Event('change',{bubbles:true}))`); await settle();
  check((await read()).objects.find(o => o.id === textId).text === 'Edited copy' && (await tool({ action: 'asset_read', asset_id: entry.id })).component.objects.find(o => o.type === 'text').text === 'Cell α', 'Placed child labels remain editable without changing the saved original');
  await create('Exact placement QA');
  const { x, y, width } = before.groups[0].bounds;
  const exact = await apply([{ op: 'insert_asset', asset_id: entry.id, canvas: 'main', x, y }]);
  const exactPreview = await tool({ action: 'render', canvas: 'both' });
  check(JSON.stringify(exactPreview.content.filter(c => c.type === 'image')) === JSON.stringify(beforePreview.content.filter(c => c.type === 'image')), 'Reinserting at original rotated bounds produces byte-identical main and scratch renders');
  check(!(await read()).inspection.complete, 'Inserting a saved asset requires fresh final canvas inspection');
  await evaluate('document.getElementById("undo").click()'); await settle();
  check((await read()).objects.length === 0, 'Undo removes the inserted group atomically');
  await evaluate('document.getElementById("redo").click()'); await settle();
  check((await read()).objects.length === 3, 'Redo restores the saved component as editable layers');
  const scaled = await apply([{ op: 'insert_asset', asset_id: entry.id, canvas: 'scratch', x: 20, y: 30, width: width * .5 }]);
  check(scaled.result.inserted_assets[0].canvas === 'scratch' && scaled.result.objects.filter(o => o.canvas === 'scratch').every((o,i) => Math.abs(o.width-before.objects[i].width*.5)<1e-8 && o.rotation === before.objects[i].rotation)
    && scaled.result.objects.find(o => o.canvas === 'scratch' && o.type === 'text').fontSize === 12.5, 'Agent inserts a proportional scratch copy with correct rotated placement and text scaling');
  check((await tool(scaled.args)).status === 'already_applied', 'Agent insertion retry returns the same copy IDs');
  // Resize retains enough editing area while the assets panel overlays on narrow windows.
  await evaluate(openAssets); win.setSize(480, 800); await pause(80);
  check(await evaluate('document.documentElement.scrollWidth<=innerWidth && document.getElementById("layer-inspector").getBoundingClientRect().right<=innerWidth'), 'Assets stays within a narrow viewport');
  await fs.writeFile(path.join(temp, 'reusable-assets-narrow.png'), (await win.webContents.capturePage()).toPNG());
  win.setSize(1300, 1000); await pause(80);
  const beforeReload = await read();
  await evaluate('window.assetsQaBeforeReload=true;location.reload()');
  for (let i = 0; i < 100; i++) { if (await evaluate('!window.assetsQaBeforeReload && Boolean(window.illustrationWorkspace?.getDocument())').catch(() => false)) break; await pause(40); }
  await evaluate('illustrationWorkspace.ready.then(()=>true)');
  placed = await read(); list = await tool({ action: 'asset_list' });
  check(list.reusable_assets.some(asset => asset.id === entry.id), 'Saved asset survives plugin reload');
  check(JSON.stringify(placed.objects) === JSON.stringify(beforeReload.objects), 'Independently inserted copies survive plugin reload');
  check((await tool(scaled.args)).status === 'already_applied', 'Insertion idempotency survives reload with its original IDs');
  await evaluate(openAssets+`document.querySelector('[data-saved-asset="${entry.id}"] .asset-remove').click()`); await settle();
  const remaining = await tool({ action: 'asset_list' });
  check(!remaining.reusable_assets.some(asset => asset.id === entry.id) && otherAssetIds.every(id => remaining.reusable_assets.some(asset => asset.id === id))
    && JSON.stringify((await read()).objects) === JSON.stringify(placed.objects), 'User removes one saved asset without changing other assets or any placed copy');
  check((await tool(scaled.args)).status === 'already_applied', 'Retrying a committed insertion after asset removal never reimports or duplicates it');
  const afterDelete = await tool({ action: 'render', canvas: 'both' });
  check(afterDelete.ok && afterDelete.content.filter(c => c.type === 'image').length === 2, 'Placed raster bytes remain renderable after their saved asset is removed');
  await fs.writeFile(path.join(temp, 'reusable-assets-result.png'), (await win.webContents.capturePage()).toPNG());
  await fs.writeFile(path.join(temp, 'reusable-assets-evidence.json'), JSON.stringify({ entry, exact: exact.result.inserted_assets, scaled: scaled.result.inserted_assets, copiesAfterAssetRemoval: (await read()).objects.map(({ dataUrl: _bytes, svg: _svg, ...o }) => o) }, null, 2));
  const r = await read();
  check((await tool({ action: 'open', illustration_id: original.illustration_id, expected_library_revision: r.library_revision, request_id: randomUUID() })).ok, 'Restore the original isolated figure');
}
module.exports = { verifyReusableAssets };
