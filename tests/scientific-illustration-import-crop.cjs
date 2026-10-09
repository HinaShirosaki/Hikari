// Native installed plugin, vendored Cropper, real files/storage, disposable profile.
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

async function verifyImportCrop({ tool, evaluate, check, win, pause, temp }) {
  const read = () => tool({ action: 'read', include_assets: true });
  const list = () => tool({ action: 'asset_list' });
  const wait = async (script, message) => {
    for (let i = 0; i < 100; i++) { if (await evaluate(script)) return; await pause(25); }
    throw new Error(`${message}: ${await evaluate('document.getElementById("status").textContent+" / "+document.getElementById("raster-error").textContent')}`);
  };
  const settle = () => evaluate('illustrationWorkspace.flush().then(()=>true)');
  const apply = async operations => {
    const current = await read();
    const result = await tool({ action: 'apply', illustration_id: current.illustration_id, expected_revision: current.revision, request_id: randomUUID(), operations });
    check(result.ok, result.error || 'Canvas changes save'); return result;
  };
  const original = await read();
  await evaluate(`(() => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 100;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 80, 100); ctx.fillStyle = '#00ff00'; ctx.fillRect(80, 0, 80, 100); ctx.clearRect(60, 30, 1, 1);
    window.importQaPng = canvas.toDataURL('image/png');
    window.importQaJpeg = canvas.toDataURL('image/jpeg'); window.importQaWebp = canvas.toDataURL('image/webp');
    ctx.fillStyle = '#0000ff'; ctx.fillRect(0, 0, 160, 100); window.importQaBlue = canvas.toDataURL('image/png');
    document.getElementById('asset-input').click = () => {};
    if(document.getElementById('assets-panel').hidden)document.getElementById('assets-tab').click();
  })()`);
  const choose = async (button, data, name, type) => {
    await evaluate(`(async () => {
      document.getElementById(${JSON.stringify(button)}).click();
      const transfer = new DataTransfer(), bytes = ${data};
      const content = bytes.startsWith('data:') ? Uint8Array.from(atob(bytes.split(',')[1]), character => character.charCodeAt(0)) : bytes;
      const blob = new Blob([content], { type: ${JSON.stringify(type)} });
      transfer.items.add(new File([blob], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} }));
      document.getElementById('asset-input').files = transfer.files;
      document.getElementById('asset-input').dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await wait('document.getElementById("raster-dialog").open && !document.getElementById("confirm-raster").disabled', 'Import preview opens');
  };
  const submit = async (review = true) => {
    await evaluate(`document.getElementById('text-free').checked=${review};document.getElementById('raster-form').requestSubmit()`);
    if (await evaluate('document.getElementById("text-free").required && !document.getElementById("text-free").checked')) return;
    await wait('!document.getElementById("raster-dialog").open || Boolean(document.getElementById("raster-error").textContent)', 'Import submission completes');
    await settle();
  };
  const cropReady = () => wait('Boolean(document.getElementById("canvas-crop-preview")?.cropper?.ready)', 'Vendored Cropper initializes in the canvas');
  const crop = async () => {
    await cropReady();
    await evaluate(`for(const [key,value] of Object.entries({width:80,height:50,x:40,y:20})){
      const input=document.querySelector('[data-crop-field="'+key+'"]');input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));
    }`);
    check(await evaluate('(()=>{const data=document.getElementById("canvas-crop-preview").cropper.getData(true);return data.width===80&&data.height===50&&data.x===40&&data.y===20})()'), 'Keyboard crop controls update the selected pixel region');
  };
  const applyCrop = async () => {
    await evaluate('document.getElementById("canvas-crop-apply").click()');
    await wait('!document.getElementById("canvas-crop-overlay")', 'Canvas crop applies'); await settle();
  };
  await choose('import-asset', 'window.importQaPng', 'Cell.png', 'image/png');
  check(await evaluate('document.getElementById("raster-preview").naturalWidth===160 && document.getElementById("text-free").required && document.getElementById("import-asset-name").value==="Cell" && !document.getElementById("raster-preview").cropper && !document.getElementById("start-raster-crop")'), 'Named import preview requires review and contains no cropping UI');
  await submit(false);
  check(await evaluate('document.getElementById("raster-dialog").open'), 'Unreviewed raster never imports');
  await submit();
  const cell = (await list()).reusable_assets.find(asset => asset.name === 'Cell');
  check(cell?.width === 160 && cell.height === 100 && (await read()).revision === original.revision && (await read()).objects.length === 0, 'File import saves directly to Assets without changing the canvas');
  const originalAsset = await tool({ action: 'asset_read', asset_id: cell.id, include_assets: true });
  check(originalAsset.component.objects[0].dataUrl === await evaluate('window.importQaPng'), 'Original PNG bytes and transparency are retained');
  await choose('import-asset', 'window.importQaPng', 'Cell copy.png', 'image/png'); await submit();
  check((await list()).reusable_assets.length === 1, 'Identical imports reuse one durable asset');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100" fill="#237c75"/></svg>';
  await choose('import-asset', JSON.stringify(svg), 'Vesicle.svg', 'image/svg+xml'); await submit(false);
  const vector = (await list()).reusable_assets.find(asset => asset.name === 'Vesicle');
  check(vector.width === 200 && vector.height === 100 && (await tool({ action: 'asset_read', asset_id: vector.id })).component.objects[0].type === 'vector', 'SVG import retains native proportions and editable vector artwork');
  for (const [kind, data] of [['jpeg', 'window.importQaJpeg'], ['webp', 'window.importQaWebp']]) {
    await choose('import-asset', data, `${kind}.${kind}`, `image/${kind}`); await submit();
    const entry = (await list()).reusable_assets.find(asset => asset.name === kind);
    check(entry?.width === 160 && (await tool({ action: 'asset_read', asset_id: entry.id, include_assets: true })).component.objects[0].dataUrl.startsWith(`data:image/${kind};`), `${kind} imports and persists`);
  }
  await evaluate(`document.querySelector('[data-saved-asset="${cell.id}"] .asset-insert').click()`); await settle();
  let placed = (await read()).objects[0];
  await apply([{ op: 'update', id: placed.id, patch: { x: 70, y: 80, width: 320, height: 150, rotation: 40 } }]);
  await evaluate(`document.querySelector('[data-layer-id="${placed.id}"] .layer-select').click();document.getElementById('crop-raster').click()`); await cropReady();
  check(await evaluate('document.getElementById("workspace-tools").contains(document.getElementById("crop-raster")) && !document.querySelector("dialog[open]") && document.getElementById("main-canvas").parentElement.contains(document.getElementById("canvas-crop-overlay"))'), 'The toolbar crops directly on the active canvas without any dialog');
  const handle = await evaluate(`(()=>{const rect=document.querySelector('#canvas-crop-overlay .cropper-point.point-e').getBoundingClientRect();return {x:rect.left+rect.width/2,y:rect.top+rect.height/2}})()`);
  win.webContents.debugger.attach('1.3');
  try {
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...handle, button: 'left', buttons: 1, clickCount: 1 });
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x - 40, y: handle.y, button: 'left', buttons: 1 });
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: handle.x - 40, y: handle.y, button: 'left', buttons: 0, clickCount: 1 });
  } finally { win.webContents.debugger.detach(); }
  check(await evaluate('document.getElementById("canvas-crop-preview").cropper.getData(true).width<160'), 'Dragging the inline crop handle changes the selected region');
  await evaluate('document.getElementById("canvas-crop-reset").click()');
  check(await evaluate('document.getElementById("canvas-crop-preview").cropper.getData(true).width===160'), 'Reset restores the full image crop');
  await crop();
  const beforeCancel = await read();
  await evaluate('document.getElementById("canvas-crop-cancel").click()');
  check((await read()).revision === beforeCancel.revision && (await list()).assets_revision === beforeCancel.assets_revision, 'Cancel discards the crop without writing any artwork or assets');
  await evaluate('document.getElementById("crop-raster").click()'); await crop(); await applyCrop();
  placed = (await read()).objects[0];
  check(placed.width === 160 && placed.height === 75 && placed.rotation === 40 && Math.abs(placed.x - (150 + 7.5 * Math.sin(40 * Math.PI / 180))) < 1e-8, 'Cropping a stretched, rotated layer retains the selected pixels in their original visual positions');
  const croppedBytes = placed.dataUrl;
  const pixel = await evaluate(`(async () => {
    const image=new Image();image.src=${JSON.stringify(croppedBytes)};await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
    return {width:image.width,height:image.height,left:[...ctx.getImageData(0,0,1,1).data],right:[...ctx.getImageData(79,0,1,1).data],alpha:ctx.getImageData(20,10,1,1).data[3]};
  })()`);
  check(pixel.width === 80 && pixel.height === 50 && pixel.left.join(',') === '255,0,0,255' && pixel.right.join(',') === '0,255,0,255' && pixel.alpha === 0, 'Crop stores exact selected PNG pixels and preserves transparency');
  check((await tool({ action: 'asset_read', asset_id: cell.id, include_assets: true })).component.objects[0].dataUrl === originalAsset.component.objects[0].dataUrl, 'Cropping a placed image leaves its original reusable asset unchanged');
  await evaluate('illustrationWorkspace.history("undo")'); await settle();
  check((await read()).objects[0].width === 320 && (await read()).objects[0].dataUrl === originalAsset.component.objects[0].dataUrl, 'Undo restores original pixels and geometry');
  await evaluate('illustrationWorkspace.history("redo")'); await settle();
  check((await read()).objects[0].dataUrl === croppedBytes, 'Redo restores the exact cropped image');
  await evaluate('if(document.getElementById("layers-panel").hidden)document.getElementById("layers-tab").click();document.getElementById("save-selection-asset").click();document.getElementById("asset-name").value="Cell cropped";document.getElementById("save-asset-form").requestSubmit()'); await settle();
  check((await list()).reusable_assets.some(asset => asset.name === 'Cell cropped'), 'A cropped canvas selection can be saved as a new reusable asset');
  await evaluate('document.getElementById("crop-raster").click()'); await cropReady();
  await apply([{ op: 'title', title: 'Concurrent edit' }]);
  check(await evaluate('!document.getElementById("canvas-crop-overlay")') && (await read()).objects[0].dataUrl === croppedBytes, 'Concurrent scene edits cancel stale crops before they can overwrite artwork');
  await choose('replace-raster', 'window.importQaBlue', 'Replacement.png', 'image/png'); await submit();
  check((await read()).objects[0].id === placed.id && (await read()).objects[0].width === 160 && (await read()).objects[0].height === 100 && (await read()).objects[0].rotation === 40, 'Replacement keeps layer identity and width while adopting the image proportions');
  await evaluate('if(document.getElementById("assets-panel").hidden)document.getElementById("assets-tab").click()');
  await choose('import-asset', 'window.importQaBlue', 'Blue.png', 'image/png');
  const beforeFailure = await list(); await win.webContents.executeJavaScript('window.qaFailAssets=true'); await submit();
  check((await list()).assets_revision === beforeFailure.assets_revision && await evaluate('document.getElementById("raster-dialog").open && /disk failure/.test(document.getElementById("raster-error").textContent) && !document.getElementById("confirm-raster").disabled'), 'An index write failure retains the committed library and offers retry');
  await win.webContents.executeJavaScript('window.qaFailAssets=false'); await submit();
  check((await list()).reusable_assets.length === beforeFailure.reusable_assets.length + 1, 'Retry saves the imported asset once');
  for (const width of [1300, 480, 320]) {
    win.setSize(width, 900); await pause(100);
    await evaluate(`if(document.getElementById('layers-panel').hidden)document.getElementById('layers-tab').click();document.querySelector('[data-layer-id="${placed.id}"] .layer-select').click();document.getElementById('crop-raster').click()`); await cropReady();
    const layout = await evaluate('(()=>{const d=document.getElementById("canvas-crop-overlay"),r=d.getBoundingClientRect();return {left:r.left,right:r.right,viewport:innerWidth,width:d.clientWidth,scrollWidth:d.scrollWidth,height:d.clientHeight,scrollHeight:d.scrollHeight,crop:document.getElementById("canvas-crop-preview").cropper.getContainerData(),dialog:Boolean(document.querySelector("dialog[open]"))}})()');
    check(layout.left>=0 && layout.right<=layout.viewport && layout.scrollWidth<=layout.width && layout.scrollHeight<=layout.height && layout.crop.width>0 && !layout.dialog, `${width}px inline crop fits the canvas without a dialog: ${JSON.stringify(layout)}`);
    await fs.writeFile(path.join(temp, `crop-canvas-${width}.png`), (await win.webContents.capturePage()).toPNG());
    await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    check(await evaluate('!document.getElementById("canvas-crop-overlay") && !document.getElementById("main-canvas").inert'), 'Escape exits cropping and restores canvas interaction');
  }
  win.setSize(1300, 1000);
  const beforeScratch = await read();
  check((await tool({action:'scratch',visible:true})).ok, 'Scratch opens for inline crop');
  const scratchCopy = await apply([{op:'insert_asset',asset_id:cell.id,canvas:'scratch',x:20,y:20,width:160}]), scratchId = scratchCopy.inserted_assets[0].ids[0];
  await evaluate(`document.querySelector('button[data-canvas="scratch"]').click();document.querySelector('[data-layer-id="${scratchId}"] .layer-select').click();document.getElementById('crop-raster').click()`); await crop();
  check(await evaluate('document.getElementById("scratch-workspace").contains(document.getElementById("canvas-crop-overlay")) && document.getElementById("canvas-crop-overlay").scrollHeight<=document.getElementById("canvas-crop-overlay").clientHeight && !document.querySelector("dialog[open]")'), 'Scratch cropping stays inside its own canvas');
  await applyCrop();
  check((await read()).objects.find(object=>object.id===scratchId).width===80 && JSON.stringify((await read()).objects.filter(object=>object.canvas==='main'))===JSON.stringify(beforeScratch.objects.filter(object=>object.canvas==='main')), 'Scratch crops leave Main artwork unchanged');
  const beforeReload = await read(), assetsBeforeReload = await list();
  await evaluate('window.importQaReload=true;location.reload()');
  await wait('!window.importQaReload && Boolean(window.illustrationWorkspace?.getDocument())', 'Plugin reloads'); await settle();
  check(JSON.stringify((await list()).reusable_assets) === JSON.stringify(assetsBeforeReload.reusable_assets) && JSON.stringify((await read()).objects) === JSON.stringify(beforeReload.objects), 'Imported assets and cropped layers survive plugin reload');
  const invalidBefore = await list();
  check(!(await evaluate('illustrationWorkspace.importAsset({type:"raster",name:"Invalid",dataUrl:"data:image/png;base64,AAAA",textFree:true})')).ok && (await list()).assets_revision === invalidBefore.assets_revision, 'Undecodable raster data cannot commit an asset');
  check(!(await evaluate('illustrationWorkspace.importAsset({type:"vector",name:"Text",svg:\'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>Label</text></svg>\'})')).ok, 'Text inside imported SVG is rejected');
}
module.exports = { verifyImportCrop };
