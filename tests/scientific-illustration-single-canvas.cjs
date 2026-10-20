const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

async function verifySingleCanvas({ tool, evaluate, check, win, pause, temp, storage, reloadPlugin }) {
  const read = () => tool({ action: 'read', include_assets: true });
  const apply = async operations => {
    const current = await read();
    const result = await tool({ action: 'apply', illustration_id: current.illustration_id,
      expected_revision: current.revision, request_id: randomUUID(), operations });
    check(result.ok, result.error || 'Save single-canvas fixture'); await pause(80); return result;
  };
  const initial = await read(), schema = initial.agent_contract.request_schema.properties;
  check(Object.keys(initial.canvases).join() === 'main' && !('scratch_visible' in initial), 'Agent reads one canvas without obsolete view state');
  check(schema.canvas.enum.join() === 'main' && !schema.action.enum.includes('scratch')
    && !/scratch|both canvases/i.test(initial.agent_contract.instructions), 'Agent schema and instructions describe a single canvas');
  check(await evaluate('document.querySelectorAll(".canvas-stage").length===1 && !document.querySelector("#scratch-workspace,#scratch-canvas,#toggle-scratch,#transfer,#properties [name=canvas]")'), 'Canvas, toolbar and property controls contain no scratch surface');
  check(!(await tool({ action: 'scratch', visible: true })).ok && !(await tool({ action: 'render', canvas: 'scratch' })).ok, 'Obsolete scratch requests cannot create a second canvas');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><ellipse cx="60" cy="40" rx="58" ry="38" fill="#b6d8c8" stroke="#547966" stroke-width="3"/></svg>';
  const dataUrl = await evaluate('(()=>{const c=document.createElement("canvas");c.width=50;c.height=30;const x=c.getContext("2d");x.fillStyle="#bfd1e6";x.fillRect(0,0,50,30);return c.toDataURL()})()');
  await apply([
    { op: 'upsert', object: { id: 'main-cell', name: 'Cell', canvas: 'main', type: 'vector', x: 100, y: 120, width: 160, height: 100, svg } },
    { op: 'upsert', object: { id: 'main-label', name: 'Cell label', canvas: 'main', type: 'text', x: 125, y: 235, width: 100, height: 40, text: 'Cell', fontSize: 28 } },
    { op: 'upsert', object: { id: 'main-raster', name: 'Raster component', canvas: 'main', type: 'raster', x: 350, y: 150, width: 90, height: 54, dataUrl, textFree: true } },
    { op: 'group', id: 'main-group', name: 'Labeled cell', ids: ['main-cell', 'main-label'] }
  ]);
  check(await evaluate('document.getElementById("prompt-form").hidden'), 'A populated canvas uses the agent rail without a second composer');
  const review = { layout: 'The visible canvas has no clipping or ambiguous overlaps.', labels: 'The cell label remains independently editable.', artwork: 'SVG and raster components contain no embedded text.', science: 'This fixture tests placement and does not assert a biological mechanism.' };
  const inspect = preview => tool({ action: 'inspect', illustration_id: preview.illustration_id,
    expected_revision: preview.revision, inspection_id: preview.inspection?.inspection_id || 'missing', review });
  check(!(await inspect(await read())).ok, 'Inspection still requires an actual rendered image');
  const preview = await tool({ action: 'render' });
  check(preview.content.filter(item => item.type === 'image').length === 1 && Boolean(preview.inspection.inspection_id)
    && !preview.inspection.complete, 'A single render delivers one native image and an inspection receipt');
  check((await inspect(preview)).inspection.complete, 'Mandatory visual inspection completes for the canvas');
  await apply([{ op: 'update', id: 'main-label', patch: { color: '#287c75' } }]);
  check(!(await inspect(preview)).ok, 'An edit invalidates the previous visual inspection');
  const current = await read();
  const saved = await tool({ action: 'asset_save', illustration_id: current.illustration_id, expected_revision: current.revision,
    expected_assets_revision: current.assets_revision, request_id: randomUUID(), id: 'main-group', name: 'Reusable cell' });
  check(saved.ok, saved.error || 'Groups remain reusable assets on the single canvas');
  const beforeCopy = await read();
  await apply([{ op: 'insert_asset', asset_id: saved.asset_id, canvas: 'main', x: 600, y: 120 }]);
  check((await read()).objects.length === beforeCopy.objects.length + 2, 'Reusable components insert as independent editable copies');
  await evaluate('illustrationWorkspace.history("undo")'); await pause(80);
  check(JSON.stringify((await read()).objects) === JSON.stringify(beforeCopy.objects), 'One undo restores the single canvas after insertion');
  // Simulate an existing installed figure before reloading, using only the
  // fixture's temporary plugin storage. The old file must stay recoverable.
  const root = path.join(storage, 'Plugins/Figura');
  const library = JSON.parse(await fs.readFile(path.join(root, 'library.json'), 'utf8'));
  const entry = library.illustrations.find(item => item.id === current.illustration_id);
  const legacy = JSON.parse(await fs.readFile(path.join(root, entry.path), 'utf8'));
  const legacyObjects = [
    { id: 'legacy-cell', name: 'Legacy cell', canvas: 'scratch', type: 'vector', x: 550, y: 350, width: 180, height: 120, rotation: 25, svg },
    { id: 'legacy-label', name: 'Legacy label', canvas: 'scratch', type: 'text', x: 600, y: 495, width: 120, height: 40, text: 'Legacy cell', fontSize: 24, color: '#287c75' }
  ];
  legacy.canvases.scratch = { width: 500, height: 350, background: '#ffffff' };
  legacy.objects.push(...legacyObjects);
  legacy.groups.push({ id: 'legacy-group', name: 'Legacy assembly', canvas: 'scratch', ids: legacyObjects.map(object => object.id) });
  const originalBytes = JSON.stringify(legacy);
  await fs.writeFile(path.join(root, entry.path), originalBytes);
  await reloadPlugin();
  const migrated = await read();
  check(migrated.objects.length === legacy.objects.length && migrated.objects.every(object => object.canvas === 'main')
    && Object.keys(migrated.canvases).join() === 'main', 'Installed-plugin reload migrates all legacy scratch components to the canvas');
  check(legacyObjects.every(original => Object.entries(original).every(([key, value]) => migrated.objects.find(object => object.id === original.id)[key] === (key === 'canvas' ? 'main' : value))), 'Migration preserves artwork, independent text, coordinates, dimensions and styling');
  check(migrated.groups.find(group => group.id === 'legacy-group').ids.join() === 'legacy-cell,legacy-label', 'Migrated components retain their named group');
  const afterLibrary = JSON.parse(await fs.readFile(path.join(root, 'library.json'), 'utf8'));
  check(afterLibrary.illustrations.find(item => item.id === entry.id).path !== entry.path
    && await fs.readFile(path.join(root, entry.path), 'utf8') === originalBytes, 'The migrated file is committed separately and the original remains recoverable');
  await evaluate('document.querySelector("[data-layer-id=legacy-group] .layer-select").click();document.getElementById("close-layers").click();document.getElementById("zoom-in").click()'); await pause(100);
  const point = await evaluate('(()=>{const r=document.querySelector("#main-canvas [data-object-id=legacy-cell] .object-hit").getBoundingClientRect(),m=document.querySelector("#main-canvas > svg").getScreenCTM();return {x:r.x+r.width/2,y:r.y+r.height/2,scale:m.a}})()');
  win.webContents.debugger.attach('1.3');
  try {
    for (const [type, dx, dy] of [['mousePressed', 0, 0], ['mouseMoved', 24, 12], ['mouseReleased', 24, 12]]) {
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x: point.x + dx, y: point.y + dy,
        button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: type === 'mousePressed' ? 1 : 0 }); await pause(30);
    }
  } finally { win.webContents.debugger.detach(); }
  await pause(100);
  const moved = await read();
  check(legacyObjects.every(original => { const object = moved.objects.find(item => item.id === original.id); return Math.abs(object.x - original.x - 24 / point.scale) < .1 && Math.abs(object.y - original.y - 12 / point.scale) < .1; }), `The migrated group can be selected and dragged normally on the canvas: ${JSON.stringify({ point, before: legacyObjects, after: moved.objects.filter(object => object.id.startsWith('legacy-')), status: await evaluate('document.getElementById("status").textContent'), selection: await evaluate('[...document.querySelectorAll("#main-canvas [data-object-id][aria-pressed=true]")].map(n=>n.dataset.objectId)') })}`);
  const finalPreview = await tool({ action: 'render', canvas: 'main' });
  check((await inspect(finalPreview)).inspection.complete, 'The migrated and manually moved figure can complete visual inspection');
  await fs.writeFile(path.join(temp, 'single-canvas.png'), (await win.webContents.capturePage()).toPNG());
  const revision = (await read()).revision;
  await reloadPlugin();
  check((await read()).revision === revision && await evaluate('document.querySelectorAll(".canvas-stage").length===1'), 'Reopening keeps the saved single canvas without repeating migration');
}
module.exports = { verifySingleCanvas };
