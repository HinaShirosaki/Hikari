const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function verifyAutomaticAssets({ tool, evaluate, check, win, temp, nativeImageFolder, pause }) {
  const read = () => tool({ action: 'read', include_assets: true });
  const list = () => tool({ action: 'asset_list' });
  const reload = async () => {
    await evaluate('window.beforeAutomaticAssetReload=true;location.reload()');
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate('!window.beforeAutomaticAssetReload && Boolean(window.illustrationWorkspace)').catch(() => false)) break;
      await pause(40);
    }
    await evaluate('illustrationWorkspace.ready.then(()=>true)');
  };
  const apply = async (operations, assets) => {
    const current = await read();
    const args = { action: 'apply', illustration_id: current.illustration_id, expected_revision: current.revision, request_id: randomUUID(), operations };
    return { args, result: await tool(args, assets) };
  };
  const save = async (name, file) => {
    const current = await read();
    const args = { action: 'asset_save', illustration_id: current.illustration_id, expected_revision: current.revision,
      expected_assets_revision: current.assets_revision, request_id: randomUUID(), name, raster_asset: 'output', textFree: true };
    const assets = [{ id: 'output', source: 'codex', path: file }];
    return { args, assets, result: await tool(args, assets) };
  };
  const fixtureImage = async (name, mode) => {
    const data = await evaluate(`(()=>{const canvas=document.createElement('canvas');canvas.width=160;canvas.height=120;const ctx=canvas.getContext('2d');
      ${mode === 'empty' ? '' : mode === 'opaque' ? "ctx.fillStyle='#efc972';ctx.fillRect(0,0,160,120);" : `ctx.fillStyle='${mode === 'variant' ? '#8877aa' : '#66cabb'}';ctx.fillRect(60,45,32,20);ctx.fillStyle='rgba(255,0,0,0.004)';ctx.fillRect(58,44,1,1);`}
      return canvas.toDataURL('image/png');})()`);
    const file = path.join(nativeImageFolder, name);
    await fs.writeFile(file, Buffer.from(data.split(',')[1], 'base64')); return { file, data };
  };
  const initial = await read();
  const denied = await apply([{ op: 'title', title: 'Must check assets' }]);
  check(denied.result.status === 'assets_required' && (await read()).revision === initial.revision, 'Agent edits are blocked until asset_list is checked in the current run');
  check((await list()).reusable_assets.length === 0, 'An empty asset inventory still satisfies the required first check');
  const original = await fixtureImage('padded-component.png', 'padded');
  const candidate = await save('Textured vesicle candidate', original.file);
  check(candidate.result.ok && candidate.result.raster_import.trimmed && candidate.result.raster_import.width === 34 && candidate.result.raster_import.height === 21,
    'Saving an unused generated result trims the PNG to visible alpha bounds, including its faint edge pixel');
  check(candidate.result.reusable_assets.find(asset => asset.id === candidate.result.asset_id)?.origin === 'codex', 'Host forwards native image provenance to the plugin asset library');
  check((await read()).revision === initial.revision && (await read()).objects.length === 0, 'Direct raster asset saving does not place or modify canvas objects');
  const full = await tool({ action: 'asset_read', asset_id: candidate.result.asset_id, include_assets: true });
  const cropped = full.component.objects[0].dataUrl;
  const alpha = await evaluate(`(async()=>{const image=new Image();image.src=${JSON.stringify(cropped)};await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return {width:image.width,height:image.height,edgeAlpha:ctx.getImageData(0,0,1,1).data[3]};})()`);
  check(alpha.width === 34 && alpha.height === 21 && alpha.edgeAlpha === 1, 'Saved cropped pixels retain even alpha=1 content');
  check((await tool(candidate.args, candidate.assets)).status === 'already_applied', 'Direct image-save retry returns the same durable asset');
  const duplicate = await save('Same pixels again', original.file);
  check(duplicate.result.asset_id === candidate.result.asset_id && (await list()).reusable_assets.length === 1, 'Repeated identical image results are deduplicated in the shared library');
  const empty = await fixtureImage('empty.png', 'empty');
  check(!(await save('Invisible image', empty.file)).result.ok && (await list()).reusable_assets.length === 1, 'Fully transparent images are rejected without corrupting the asset index');
  const opaque = await fixtureImage('opaque.png', 'opaque');
  const retained = await save('Opaque artwork', opaque.file);
  check(retained.result.ok && !retained.result.raster_import.trimmed && retained.result.raster_import.width === 160, 'Opaque PNGs keep their original extent');
  const variant = await fixtureImage('variant.png', 'variant');
  const changed = await save('Purple vesicle variant', variant.file);
  check(changed.result.ok && changed.result.asset_id !== candidate.result.asset_id && (await tool({ action: 'asset_read', asset_id: candidate.result.asset_id, include_assets: true })).component.objects[0].dataUrl === cropped,
    'Modified image results become new assets while the original remains intact');
  const placed = await apply([{ op: 'insert_asset', asset_id: candidate.result.asset_id, canvas: 'main', x: 100, y: 80, width: 102 }]);
  check(placed.result.ok && placed.result.objects[0].width === 102 && placed.result.objects[0].height === 63 && placed.result.objects[0].x === 100 && placed.result.objects[0].y === 80,
    'Trimmed asset placement uses its tight aspect ratio and exact requested position');
  const imported = await apply([{ op: 'upsert', raster_asset: 'direct', object: { id: 'direct-raster', name: 'Direct candidate', type: 'raster', x: 350, y: 80, width: 170, height: 90, textFree: true } }],
    [{ id: 'direct', source: 'codex', path: original.file }]);
  check(imported.result.ok && imported.result.objects.find(object => object.id === 'direct-raster').height === 105 && imported.result.raster_imports[0].crop.x === 58 && imported.result.auto_saved_assets[0].asset_id === candidate.result.asset_id,
    'Direct canvas imports are trimmed and automatically archived without duplicate assets');
  check((await tool(imported.args, [{ id: 'direct', source: 'codex', path: original.file }])).status === 'already_applied', 'Import retry preserves the same placement and reusable asset');
  check((await fs.readFile(original.file)).equals(Buffer.from(original.data.split(',')[1], 'base64')), 'Trimming leaves the original Codex output file intact');
  const assembly = await apply([
    { op: 'upsert', object: { id: 'outer', name: 'Vesicle', type: 'vector', x: 600, y: 120, width: 100, height: 100, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="#ddeeff"/></svg>' } },
    { op: 'upsert', object: { id: 'receptor', name: 'Receptor', type: 'vector', x: 650, y: 120, width: 30, height: 50, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 50"><rect x="5" y="0" width="20" height="50" fill="#aabbcc"/></svg>' } },
    { op: 'upsert', object: { id: 'caption', type: 'text', x: 600, y: 235, text: 'Receptor', width: 120, height: 32 } },
    { op: 'group', id: 'assembly', name: 'Vesicle receptor assembly', ids: ['outer', 'receptor', 'caption'] }
  ]);
  check(assembly.result.ok && (await list()).reusable_assets.length === 3, 'Compound groups wait for final review before being archived');
  const render = await tool({ action: 'render', canvas: 'both' });
  let inspect = { action: 'inspect', illustration_id: assembly.result.illustration_id, expected_revision: assembly.result.revision,
    inspection_id: render.inspection.inspection_id, review: { layout: 'Trimmed objects fit their selection bounds.', labels: 'Caption is an independent editable text layer.', artwork: 'Faint transparent edges preserved; components have no baked-in text.', science: 'Fixture depicts a receptor overlapping the vesicle outline.' } };
  check(!(await tool({ ...inspect, inspection_id: 'invalid' })).ok && (await list()).reusable_assets.length === 3, 'Invalid review tokens cannot save unfinished group snapshots');
  await win.webContents.executeJavaScript('window.qaFailAssets=true');
  check(!(await tool(inspect)).ok && !(await tool({ action: 'inspection_status' })).inspection.complete, 'Asset persistence failure blocks agent completion');
  await reload();
  check((await read()).pendingAssetGroups?.includes('assembly'), 'Pending compound saves survive a reload during an asset-write failure');
  await list();
  const recoveredRender = await tool({ action: 'render', canvas: 'both' });
  inspect = { ...inspect, inspection_id: recoveredRender.inspection.inspection_id };
  await win.webContents.executeJavaScript('window.qaFailAssets=false');
  await win.webContents.executeJavaScript('window.qaFailGroupAck=true');
  check(!(await tool(inspect)).ok && !(await tool({ action: 'inspection_status' })).inspection.complete && (await list()).reusable_assets.length === 4,
    'A failed scene acknowledgement also blocks completion after the group asset index commits');
  await win.webContents.executeJavaScript('window.qaFailGroupAck=false');
  const reviewed = await tool(inspect);
  check(reviewed.ok && reviewed.auto_saved_assets.length === 1 && reviewed.auto_saved_assets[0].reused && (await list()).reusable_assets.length === 4 && !(await read()).pendingAssetGroups?.length,
    'Retry completes final inspection without duplicating the named group and durably acknowledges its save');
  const groupId = reviewed.auto_saved_assets[0].asset_id;
  const group = await tool({ action: 'asset_read', asset_id: groupId });
  check(group.component.objects.length === 3 && group.component.objects.filter(object => object.type === 'text').length === 1, 'Archived groups retain separate editable vector and text layers');
  check((await tool(inspect)).ok && (await list()).reusable_assets.length === 4, 'Repeating final inspection never duplicates an identical group');
  const rerender = await tool({ action: 'render', canvas: 'both' });
  check(JSON.stringify(rerender.content.filter(item => item.type === 'image')) === JSON.stringify(render.content.filter(item => item.type === 'image')), 'Automatic saving leaves both rendered canvases unchanged');
  await apply([{ op: 'update', id: 'caption', patch: { text: 'Modified receptor' } }]);
  const edited = await read(), images = await tool({ action: 'render', canvas: 'both' });
  const variantReview = await tool({ ...inspect, expected_revision: edited.revision, inspection_id: images.inspection.inspection_id });
  check(variantReview.ok && variantReview.auto_saved_assets[0].asset_id !== groupId && (await tool({ action: 'asset_read', asset_id: groupId })).component.objects.find(object => object.type === 'text').text === 'Receptor',
    'Changed assemblies create immutable variants instead of overwriting saved originals');
  const beforeMove = (await list()).reusable_assets.length;
  await apply([{ op: 'update', id: 'assembly', patch: { x: 700, y: 120 } }]);
  const moved = await read(), movedRender = await tool({ action: 'render', canvas: 'both' });
  await tool({ ...inspect, expected_revision: moved.revision, inspection_id: movedRender.inspection.inspection_id });
  check((await list()).reusable_assets.length === beforeMove, 'Moving an assembly does not create redundant reusable assets');
  const removable = variantReview.auto_saved_assets[0].asset_id, assetsBeforeDelete = await list();
  check((await tool({ action: 'asset_delete', asset_id: removable, expected_assets_revision: assetsBeforeDelete.assets_revision, request_id: randomUUID() })).ok,
    'Completed automatic snapshots can be explicitly removed');
  const afterRemoval = await tool({ ...inspect, expected_revision: moved.revision, inspection_id: movedRender.inspection.inspection_id });
  check(afterRemoval.ok && !(await list()).reusable_assets.some(asset => asset.id === removable), 'Repeating inspection respects explicit deletion of an already saved assembly');
  const persistedCount = (await list()).reusable_assets.length;
  await fs.unlink(original.file); await reload();
  const restored = await list(), restoredRender = await tool({ action: 'asset_render', asset_id: candidate.result.asset_id });
  check(restored.reusable_assets?.length === persistedCount && restoredRender.ok, `Saved raster and compound assets survive reload and deletion of native generation files: ${JSON.stringify({ count: restored.reusable_assets?.length, expected: persistedCount, status: restoredRender.status, error: restoredRender.error })}`);
  const refreshed = await read();
  await tool({ action: 'create', expected_library_revision: refreshed.library_revision, request_id: randomUUID(), title: 'Reuse saved components' });
  const deniedReuse = await apply([{ op: 'insert_asset', asset_id: groupId, canvas: 'main', x: 50, y: 80 }]);
  check(deniedReuse.result.status === 'assets_required', 'A newly selected figure requires a fresh asset check');
  await list(); await tool({ action: 'asset_read', asset_id: groupId }); await tool({ action: 'asset_render', asset_id: groupId });
  const reused = await apply([{ op: 'insert_asset', asset_id: groupId, canvas: 'main', x: 50, y: 80 }]);
  check(reused.result.ok && reused.result.objects.length === 3 && reused.result.objects.every(object => !group.component.objects.some(original => original.id === object.id)), 'Agent reuses an inspected assembly with fresh independent object IDs');
  await fs.writeFile(path.join(temp, 'automatic-assets-result.json'), JSON.stringify({ candidate: candidate.result, imported: imported.result, reviewed, variantReview, reused: reused.result }, null, 2));
}
module.exports = { verifyAutomaticAssets };
