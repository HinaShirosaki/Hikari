// Disposable installed-plugin UI + native MCP image/reuse verification.
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

async function verifyAssetDescriptions({ tool, evaluate, check, win, pause, temp }) {
  win.setSize(1300, 1000);
  const read = () => tool({ action: 'read', include_assets: true });
  const settle = async () => { await evaluate('illustrationWorkspace.flush().then(()=>true)'); await pause(100); };
  const apply = async operations => {
    const current = await read();
    const result = await tool({ action: 'apply', illustration_id: current.illustration_id, expected_revision: current.revision, request_id: randomUUID(), operations });
    check(result.ok, result.error || 'Apply asset fixture'); return result;
  };
  await tool({ action: 'asset_list' });
  const raster = await evaluate(`(()=>{const canvas=document.createElement('canvas');canvas.width=40;canvas.height=40;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#9572b4';ctx.fillRect(0,0,40,40);return canvas.toDataURL('image/png')})()`);
  const initial = await apply([
    { op: 'upsert', object: { id: 'cell', name: 'Cell membrane', type: 'vector', canvas: 'main', x: 60, y: 50, width: 160, height: 140,
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 140"><ellipse cx="80" cy="70" rx="78" ry="68" fill="#69b7ac"/></svg>' } },
    { op: 'upsert', object: { id: 'insert', name: 'Purple insert', type: 'raster', canvas: 'main', x: 100, y: 90, width: 40, height: 40, dataUrl: raster, textFree: true } },
    { op: 'upsert', object: { id: 'label', name: 'Cell label', type: 'text', canvas: 'main', x: 70, y: 200, width: 150, height: 30, text: 'Cell α', fontSize: 22 } },
    { op: 'group', id: 'cell-group', name: 'Reusable cell', ids: ['cell', 'insert', 'label'] }
  ]);
  const render = await tool({ action: 'render', canvas: 'main' });
  check((await tool({ action: 'inspect', illustration_id: initial.illustration_id, expected_revision: initial.revision,
    inspection_id: render.inspection.inspection_id, review: { layout: 'Fixture fits the canvas.', labels: 'Cell alpha is a separate label.', artwork: 'Teal ellipse with a purple square.', science: 'Geometry fixture, no biological claims.' } })).ok, 'Inspect initial scene');
  const before = await read();
  await evaluate(`document.getElementById('layers-tab').click();document.querySelector('[data-layer-id="cell-group"] .layer-select').click();
    document.getElementById('main-canvas').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
    document.querySelector('[data-context-action="save-asset"]').click()`);
  check(await evaluate(`document.getElementById('save-asset-dialog').open && document.getElementById('asset-description').value===''`), 'Save dialog offers an optional description');
  const description = 'Teal schematic cell with a purple insert and a separate α label.';
  await evaluate(`document.getElementById('asset-description').value=${JSON.stringify(description)}`);
  await pause(100);
  await fs.writeFile(path.join(temp, 'asset-description-save.png'), (await win.webContents.capturePage()).toPNG());
  await evaluate(`document.getElementById('save-asset-form').requestSubmit()`); await settle();
  let list = await tool({ action: 'asset_list' });
  const entry = list.reusable_assets.find(asset => asset.description === description);
  check(entry?.name === 'Reusable cell' && entry.objectCount === 3, 'UI description persists in agent asset inventory');
  const tile = `[data-saved-asset="${entry.id}"]`;
  check(await evaluate(`(()=>{const grid=document.getElementById('saved-assets'),tiles=[...grid.children].map(node=>node.getBoundingClientRect());
    return getComputedStyle(grid).display==='grid' && tiles[0].top===tiles[1].top && tiles[0].left!==tiles[1].left
      && tiles.every(rect=>Math.abs(rect.width-rect.height)<1) && !document.querySelector('${tile} .asset-insert .asset-description');})()`), 'Assets appear as square thumbnails in multiple columns with details outside the tiles');
  const dock = `document.getElementById('asset-dock')`;
  const dockShows = name => `(${dock}.querySelector('.asset-name').textContent===${JSON.stringify(name)})`;
  check(await evaluate(`!${dock}.hidden && ${dock}.parentElement.id==='illustrations-rail'`), 'Asset details are docked in the rail before any hover');
  await pause(100);
  await fs.writeFile(path.join(temp, 'asset-grid.png'), (await win.webContents.capturePage()).toPNG());
  if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3');
  const move = async selector => {
    const point = await evaluate(`(()=>{const rect=document.querySelector('${selector}').getBoundingClientRect();return {x:rect.left+rect.width/2,y:rect.top+rect.height/2}})()`);
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: 'none', buttons: 0 }); await pause(100);
  };
  await move(`${tile} .asset-insert`);
  check(await evaluate(`${dockShows('Reusable cell')} && ${dock}.querySelector('.asset-summary').textContent===${JSON.stringify(description)}`), 'Pointer hover shows the complete asset description');
  check(await evaluate(`[...document.querySelectorAll('.saved-asset')].every(row=>{const rect=row.getBoundingClientRect();return row.contains(document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2));})`), 'Details never cover a tile in the grid');
  check(await evaluate(`document.querySelector('${tile} .asset-edit').getBoundingClientRect().width>0 && getComputedStyle(document.querySelector('${tile} .asset-edit')).opacity==='1'`), 'The hovered tile offers its details control');
  await fs.writeFile(path.join(temp, 'asset-grid-hover.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1200, y: 900, button: 'none', buttons: 0 }); await pause(220);
  check(await evaluate(dockShows('Reusable cell')), 'Leaving the thumbnail keeps its details in the dock');
  await evaluate(`document.querySelector('.saved-asset:not(${tile}) .asset-insert').focus()`);
  check(await evaluate(`!${dockShows('Reusable cell')}`), 'Keyboard focus also shows asset details');
  await evaluate(`document.querySelector('${tile} .asset-insert').focus()`);
  const source = await tool({ action: 'asset_read', asset_id: entry.id });
  check(source.component.description === description && !source.component.objects.find(object => object.type === 'raster').dataUrl, 'Agent reads description and editable sources without base64 raster bytes');
  const preview = await tool({ action: 'asset_render', asset_id: entry.id });
  check(preview.ok && preview.content.filter(item => item.type === 'image').length === 1 && preview.previews[0].width <= 400, 'Agent sees the saved asset through a native MCP image');
  check(preview.description === description && preview.previews[0].description === description && preview.previews[0].asset_id === entry.id, 'Native image metadata identifies and describes the asset');
  await evaluate(`document.querySelector('${tile} .asset-edit').focus();document.querySelector('${tile} .asset-edit').click()`);
  check(await evaluate(`document.getElementById('asset-description').value===${JSON.stringify(description)}`), 'Asset details opens the saved description');
  const updatedDescription = description + '\nFor endocytosis diagrams.';
  await evaluate(`document.getElementById('asset-description').value=${JSON.stringify(updatedDescription)};document.getElementById('save-asset-form').requestSubmit()`); await settle();
  check((await tool({ action: 'asset_read', asset_id: entry.id })).component.description === updatedDescription, 'Details edits reach the agent');
  const after = await read();
  check(before.revision === after.revision && JSON.stringify(before.objects) === JSON.stringify(after.objects) && after.inspection.complete, 'Descriptions and asset previews preserve the canvas and its completed inspection');
  await evaluate(`document.getElementById('asset-search').value='ENDOCYTOSIS';document.getElementById('asset-search').dispatchEvent(new Event('input',{bubbles:true}))`);
  check(await evaluate(`document.querySelectorAll('.saved-asset').length===1 && document.querySelector('.saved-asset').dataset.savedAsset==='${entry.id}'`), 'Search matches descriptions case-insensitively');
  await pause(100);
  await fs.writeFile(path.join(temp, 'asset-description-search.png'), (await win.webContents.capturePage()).toPNG());
  win.setSize(320, 800); await pause(100);
  await evaluate(`document.querySelector('${tile} .asset-insert').focus()`);
  await pause(100);
  check(await evaluate(`(()=>{const rect=${dock}.getBoundingClientRect();
    return rect.width>0 && rect.left>=0 && rect.top>=0 && rect.right<=innerWidth && rect.bottom<=innerHeight;})()`), 'The dock remains within a narrow viewport');
  await fs.writeFile(path.join(temp, 'asset-grid-narrow.png'), (await win.webContents.capturePage()).toPNG());
  await evaluate(`document.getElementById('asset-search').focus()`); win.setSize(1300, 1000); await pause(100);
  list = await tool({ action: 'asset_list' });
  const updated = await tool({ action: 'asset_update', asset_id: entry.id, expected_assets_revision: list.assets_revision,
    request_id: randomUUID(), description: updatedDescription + ' Editable vector, raster and text layers.' });
  check(updated.status === 'asset_updated', 'Agent updates asset descriptions through MCP');
  await evaluate('window.beforeDescriptionReload=true;location.reload()');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('!window.beforeDescriptionReload && Boolean(window.illustrationWorkspace)').catch(() => false)) break;
    await pause(40);
  }
  await evaluate('illustrationWorkspace.ready.then(()=>true)');
  const persisted = await tool({ action: 'asset_read', asset_id: entry.id, include_assets: true });
  check(persisted.component.description === updated.reusable_assets.find(asset => asset.id === entry.id).description
    && persisted.component.objects.find(object => object.type === 'raster').dataUrl === raster, 'Description and original media survive reload');
  const current = await read();
  check((await tool({ action: 'create', expected_library_revision: current.library_revision, request_id: randomUUID(), title: 'Reuse described artwork' })).ok, 'Create a different figure');
  await tool({ action: 'asset_list' });
  await tool({ action: 'asset_read', asset_id: entry.id });
  await tool({ action: 'asset_render', asset_id: entry.id });
  const reused = await apply([{ op: 'insert_asset', asset_id: entry.id, canvas: 'main', x: 80, y: 90, width: 240 }]);
  check(reused.objects.length === 3 && reused.inserted_assets[0].ids.every(id => !before.objects.some(object => object.id === id))
    && reused.groups[0].name === 'Reusable cell', 'Agent reuses the described and previewed asset as independent editable layers');
  await fs.writeFile(path.join(temp, 'asset-description-reused.png'), (await win.webContents.capturePage()).toPNG());
}

module.exports = { verifyAssetDescriptions };
