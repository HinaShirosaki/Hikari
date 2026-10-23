// Real Electron/MCP pressure test. All edits and exports use disposable storage.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');

async function verifyFiguraStress({ tool, evaluate, check, win, pause, temp, reloadPlugin }) {
  const output = process.env.HIKARI_FIGURA_STRESS_OUTPUT || temp;
  await fs.mkdir(output, { recursive: true });
  const report = { started: new Date().toISOString(), status: 'running', temporaryStorage: temp,
    metrics: [], assertions: 0, fixtures: [], failures: [], findings: [], caveats: [
      'Hidden Electron window on this machine; timings include the plugin bridge and local disk.',
      'Generated artwork is reused from existing local figures; no new generation request is made.'
    ] };
  const verify = (condition, message) => { check(condition, message); report.assertions++; };
  const timed = async (name, action) => {
    const start = performance.now();
    const result = await action();
    const durationMs = Math.round((performance.now() - start) * 10) / 10;
    report.metrics.push({ name, durationMs }); console.log(`Stress: ${name}: ${durationMs} ms`);
    return result;
  };
  const read = () => tool({ action: 'read', include_assets: true });
  const apply = async (operations, name = 'edit') => {
    const current = await read();
    const result = await timed(name, () => tool({ action: 'apply', illustration_id: current.illustration_id,
      expected_revision: current.revision, request_id: randomUUID(), operations }));
    verify(result.ok, result.error || name);
    await evaluate('illustrationWorkspace.flush().then(()=>true)');
    return result;
  };
  const wait = async (predicate, message, limit = 60000) => {
    const start = performance.now();
    while (performance.now() - start < limit) { if (await predicate()) return; await pause(50); }
    throw new Error(message);
  };
  const digest = objects => createHash('sha256').update(JSON.stringify(objects)).digest('hex');
  const frameCount = () => evaluate('document.querySelectorAll("#main-canvas > svg > [data-object-id]").length');
  const selection = () => evaluate('[...document.querySelectorAll("#main-canvas > svg > [data-object-id][aria-pressed=true]")].map(node=>node.dataset.objectId)');
  const escape = () => evaluate('document.getElementById("main-canvas").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  const selectAll = () => evaluate('document.getElementById("main-canvas").focus();document.getElementById("main-canvas").dispatchEvent(new KeyboardEvent("keydown",{key:"a",ctrlKey:true,bubbles:true}))');
  const sourceRoot = process.env.HIKARI_FIGURA_STRESS_SOURCE || path.join(__dirname, '../TestData3/Plugins/Figura');
  let attached = false;
  try {
    // Copy only image bytes into the fixture, never modify or open real figures.
    const library = JSON.parse(await fs.readFile(path.join(sourceRoot, 'library.json'), 'utf8'));
    const originals = [];
    for (const title of ['Protein secretion: ER to cell surface', 'QA · Photorealistic red blood cell']) {
      const entry = library.illustrations.find(item => item.title === title);
      if (!entry) continue;
      const scene = JSON.parse(await fs.readFile(path.join(sourceRoot, entry.path), 'utf8'));
      const image = scene.objects.find(object => object.type === 'raster');
      if (image) originals.push({ title, name: image.name, dataUrl: image.dataUrl });
    }
    verify(originals.length === 2, 'Two existing generated scientific images are available for realistic stress coverage');
    // Fill to the plugin's own object cap, so the harness follows any change to it.
    const capacity = await evaluate("import('./model.mjs').then(module=>module.MAX_OBJECTS)");
    report.capacity = capacity;
    const current = await read();
    verify((await tool({ action: 'create', title: 'Figura mixed component pressure test',
      expected_library_revision: current.library_revision, request_id: randomUUID() })).ok, 'Create disposable pressure-test figure');
    await evaluate(`window.stressOriginals=${JSON.stringify(originals)};true`);
    const rasterFixtures = await timed('prepare mixed raster fixtures', () => evaluate(`(async()=>{
      const results=[];
      for(const source of stressOriginals){
        const image=new Image();image.src=source.dataUrl;await image.decode();
        results.push({kind:'original generated PNG',name:source.name,dataUrl:source.dataUrl,width:image.naturalWidth,height:image.naturalHeight});
      }
      for(let i=0;i<14;i++){
        const image=new Image();image.src=stressOriginals[i%2].dataUrl;await image.decode();
        const canvas=document.createElement('canvas');canvas.width=i<2?4096:1024;canvas.height=i<2?4096:768;
        canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
        results.push({kind:i<2?'4K generated-artwork test copy':'generated-artwork WebP copy',name:'Generated artwork '+i,
          dataUrl:canvas.toDataURL('image/webp',.72),width:canvas.width,height:canvas.height});
      }
      for(let i=0;i<32;i++){
        const canvas=document.createElement('canvas');canvas.width=canvas.height=i<16?256:512;
        const context=canvas.getContext('2d'),size=canvas.width;
        if(i>=16){context.fillStyle='#f0f5f9';context.fillRect(0,0,size,size);}
        const gradient=context.createRadialGradient(size*.4,size*.35,4,size*.5,size*.5,size*.46);
        gradient.addColorStop(0,'#ffdd99');gradient.addColorStop(1,'#267e88');context.fillStyle=gradient;
        context.beginPath();context.arc(size/2,size/2,size*.44,0,Math.PI*2);context.fill();
        context.clearRect(size*.4,size*.4,size*.2,size*.2);
        context.fillStyle='rgba(0,0,0,.02)';context.fillRect(0,0,1,1);context.fillRect(size-1,size-1,1,1);
        const mime=i<16?'image/png':i<24?'image/jpeg':'image/webp';
        results.push({kind:mime.split('/')[1],name:'Transparent and opaque raster '+i,
          dataUrl:canvas.toDataURL(mime,.8),width:size,height:size});
      }
      delete window.stressOriginals;return results;
    })()`));
    report.fixtures = rasterFixtures.map(({ dataUrl, ...fixture }) => ({ ...fixture, bytes: Math.floor(dataUrl.split(',')[1].length * .75) }));
    const vector = index => {
      const cells = Array.from({ length: index % 4 === 0 ? 180 : 24 }, (_, n) =>
        `<circle cx="${8 + n % 15 * 6}" cy="${8 + Math.floor(n / 15) * 6}" r="1.4" fill="#ffffff" fill-opacity="0.45"/>`).join('');
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="paint"><stop stop-color="#60bdaf"/><stop offset="1" stop-color="#4666b6"/></linearGradient><clipPath id="clip"><circle cx="50" cy="50" r="46"/></clipPath><mask id="mask"><rect width="100" height="100" fill="white"/><circle cx="50" cy="50" r="12" fill="black"/></mask></defs><g clip-path="url(#clip)" mask="url(#mask)"><rect width="100" height="100" fill="url(#paint)"/>${cells}<path d="M20 50Q50 10 80 50T20 70" fill="none" stroke="#efbb52" stroke-width="4"/></g></svg>`;
    };
    const objects = [];
    let rasterIndex = 0, plots = 0;
    for (let i = 0; i < capacity; i++) {
      const base = { id: `pressure-${i}`, name: `Component ${i + 1}`, x: 16 + i % 20 * 158,
        y: 40 + Math.floor(i / 20) * 190, width: 128, height: 128, rotation: i % 9 === 0 ? 15 : 0 };
      // Past the original 200-component mix, add the label and leader-line pairs
      // that push agent figures past 200; the heavy fixtures keep their byte weight.
      if (i >= 200) { objects.push(i % 2 ? { ...base, type: 'text', height: 40, fontSize: 17, fontFamily: 'Inter', text: `Label ${i + 1}` }
        : { ...base, type: 'vector', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10 90L80 20" fill="none" stroke="#33475b" stroke-width="3"/><polygon points="88,12 70,22 78,30" fill="#33475b"/></svg>' }); continue; }
      if (i % 10 < 4) objects.push({ ...base, type: 'vector', svg: vector(i) });
      else if (i % 10 < 7) objects.push({ ...base, type: 'text', width: 145, height: 120, fontSize: 17,
        fontFamily: i % 2 ? 'Inter' : 'Arial', fontWeight: i % 3 ? 400 : 700, italic: i % 5 === 0,
        text: `Layer ${i + 1}\nα + β → γ\n25 µM · 37 °C` });
      else if (plots++ < 12) objects.push({ ...base, type: 'plot', plotly: {
        data: [{ type: i % 2 ? 'scatter' : 'bar', x: [0, 1, 2, 3, 4], y: [1, 4, 2, 6, 5], marker: { color: '#298f87' } }],
        layout: { margin: { t: 10, b: 25, l: 25, r: 8 }, font: { family: 'Arial', size: 9 }, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)' }, source: 'Deterministic stress fixture values' } });
      else { const fixture = rasterFixtures[rasterIndex++]; objects.push({ ...base, type: 'raster',
        name: `${fixture.kind} · ${fixture.name}`, dataUrl: fixture.dataUrl, textFree: true }); }
    }
    report.composition = Object.fromEntries(['vector', 'text', 'raster', 'plot'].map(type => [type, objects.filter(object => object.type === type).length]));
    await apply([{ op: 'canvas', canvas: 'main', patch: { width: 3200, height: Math.max(2000, 80 + Math.ceil(capacity / 20) * 190), background: '#f5f8fb' } }], 'set stress canvas');
    await evaluate(`window.stressLongTasks=[];window.stressObserver=new PerformanceObserver(list=>stressLongTasks.push(...list.getEntries().map(entry=>({start:entry.startTime,duration:entry.duration}))));stressObserver.observe({entryTypes:['longtask']});true`);
    for (const [from, to] of [[0, 50], [50, 100], ...Array.from({ length: Math.ceil((capacity - 100) / 200) }, (_, k) => [100 + k * 200, Math.min(capacity, 300 + k * 200)])]) {
      await apply(objects.slice(from, to).map(object => ({ op: 'upsert', object })), `load ${to} components`);
      await pause(150);
      verify(await frameCount() === to, `All ${to} mixed components render on the canvas`);
      const snapshot = await read();
      report.metrics.push({ name: `scene at ${to} components`, sceneChars: JSON.stringify(snapshot.objects).length,
        domNodes: await evaluate('document.getElementById("main-canvas").querySelectorAll("*").length') });
      await fs.writeFile(path.join(output, `stress-screen-${to}.png`), (await win.webContents.capturePage()).toPNG());
    }
    win.webContents.debugger.attach('1.3'); attached = true;
    report.memoryAtCapacity = await win.webContents.debugger.sendCommand('Runtime.getHeapUsage');
    await evaluate('document.fonts.ready.then(()=>true);document.getElementById("close-layers").click();document.getElementById("zoom-fit").click()');
    const before = await read();
    report.sceneChars = JSON.stringify(before.objects).length;
    const paintReady = await evaluate(`Promise.all([...document.querySelectorAll('#main-canvas image')].map(node=>new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(true);image.onerror=()=>resolve(false);image.src=node.getAttribute('href')}))).then(results=>results.every(Boolean))`);
    verify(paintReady, 'All original generated images and PNG/JPEG/WebP components decode');
    const selectionTimes = await timed(`20 single selections at ${capacity} components`, () => evaluate(`(()=>{
      const times=[];for(let i=0;i<20;i++){const start=performance.now();document.querySelector('[data-layer-id="pressure-'+i+'"] .layer-select').click();times.push(performance.now()-start)}return times;
    })()`));
    report.selectionTimesMs = selectionTimes;
    await timed(`select all ${capacity} components`, selectAll);
    verify((await selection()).length === capacity, 'Select all includes every mixed component');
    verify(await evaluate('document.querySelectorAll("#main-canvas .resize-handle").length===8'), `${capacity} selected components share eight resize handles`);
    await fs.writeFile(path.join(output, `stress-${capacity}-selected.png`), (await win.webContents.capturePage()).toPNG());
    await escape();
    const zoom = await timed(`12 zoom steps at ${capacity} components`, () => evaluate(`(()=>{for(let i=0;i<6;i++)document.getElementById('zoom-in').click();for(let i=0;i<6;i++)document.getElementById('zoom-out').click();return document.getElementById('zoom-level').textContent})()`));
    report.zoomAfterCycle = zoom;
    await evaluate('document.getElementById("zoom-fit").click()');
    verify(digest((await read()).objects) === digest(before.objects), 'Selection and zoom preserve all artwork bytes and geometry');

    // Real pointer hit tests with every component present, including transparent overlap.
    const pngIndex = objects.findIndex(object => object.type === 'raster' && object.name.startsWith('png'));
    const png = (await read()).objects.find(object => object.id === `pressure-${pngIndex}`);
    const originalVector = before.objects.find(object => object.id === 'pressure-0');
    await apply([{ op: 'update', id: 'pressure-0', patch: { x: png.x, y: png.y, width: png.width, height: png.height, rotation: png.rotation,
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#cf7655"/></svg>' } }], 'prepare transparent overlap at capacity');
    await pause(150); await escape();
    const screen = (id, x, y) => evaluate(`(()=>{const g=document.querySelector('#main-canvas [data-object-id="${id}"]'),p=new DOMPoint(${x},${y}).matrixTransform(g.getScreenCTM());return {x:p.x,y:p.y}})()`);
    const mouse = async (type, point, buttons = 0) => win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',
      { type, ...point, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const point = await screen(png.id, png.width / 2, png.height / 2);
    await mouse('mousePressed', point, 1); await mouse('mouseReleased', point); await pause(50);
    verify(JSON.stringify(await selection()) === '["pressure-0"]', `At ${capacity} components a transparent PNG hole selects only the visible component underneath`);
    const start = await screen(png.id, png.width / 2, png.height / 2);
    await timed(`24 pointer drag previews at ${capacity} components`, async () => {
      await mouse('mousePressed', start, 1);
      report.dragPreviewTimesMs = [];
      for (let step = 1; step <= 24; step++) {
        const t = performance.now();
        await mouse('mouseMoved', { x: start.x + step, y: start.y + step / 2 }, 1);
        report.dragPreviewTimesMs.push(performance.now() - t);
      }
      await mouse('mouseReleased', { x: start.x + 24, y: start.y + 12 });
      await evaluate('illustrationWorkspace.flush().then(()=>true)');
    });
    const moved = await read();
    verify(moved.objects.find(object => object.id === 'pressure-0').x !== png.x
      && digest(moved.objects.filter(object => object.id !== 'pressure-0')) === digest(before.objects.filter(object => object.id !== 'pressure-0')),
    'A drag through transparent PNG pixels moves one underlying component without corrupting other layers');
    await apply([{ op: 'upsert', object: originalVector }], 'restore overlap fixture');

    // Capacity errors must reject the complete transaction and preserve revision.
    const full = await read();
    const overflow = await tool({ action: 'apply', illustration_id: full.illustration_id, expected_revision: full.revision,
      request_id: randomUUID(), operations: [{ op: 'upsert', object: { id: 'overflow', type: 'text', text: 'One past capacity' } }] });
    verify(!overflow.ok && overflow.error.includes(`maximum ${capacity}`) && (await read()).revision === full.revision, 'One component past capacity is rejected atomically');
    const oversized = await tool({ action: 'apply', illustration_id: full.illustration_id, expected_revision: full.revision,
      request_id: randomUUID(), operations: full.objects.filter(object => object.type === 'raster').slice(2, 8)
        .map(object => ({ op: 'update', id: object.id, patch: { dataUrl: rasterFixtures[0].dataUrl } })) });
    report.oversizedRejection = { ok: oversized.ok, status: oversized.status, error: oversized.error };
    verify(!oversized.ok && /too large|size|exceed|limit|at most/i.test(oversized.error) && (await read()).revision === full.revision,
      `Oversized image payloads reject atomically without losing the existing scene: ${JSON.stringify(report.oversizedRejection)}`);
    const sceneOversized = await tool({ action: 'apply', illustration_id: full.illustration_id, expected_revision: full.revision,
      request_id: randomUUID(), operations: full.objects.filter(object => object.type === 'raster').slice(2, 5)
        .map(object => ({ op: 'update', id: object.id, patch: { dataUrl: rasterFixtures[0].dataUrl } })) });
    verify(!sceneOversized.ok && /too large/.test(sceneOversized.error) && (await read()).revision === full.revision,
      `The scene size limit rejects a smaller request atomically: ${sceneOversized.error}`);

    const groupOps = Array.from({ length: capacity / 10 }, (_, g) => ({ op: 'group', id: `pressure-group-${g}`, name: `Mixed group ${g + 1}`,
      ids: objects.slice(g * 10, g * 10 + 10).map(object => object.id) }));
    await apply(groupOps, `group all ${capacity} components into ${capacity / 10} mixed groups`);
    await evaluate('document.querySelector("[data-layer-id=pressure-group-0] .layer-select").click()');
    verify((await selection()).length === 10 && await evaluate('!document.querySelector("#main-canvas .selection-member")'), 'A selected dense mixed group has only its outer selection frame');
    const grouped = await read();
    await timed(`move ${capacity} grouped components`, () => apply([{ op: 'transform', ids: objects.map(object => object.id), patch: { x: 20, y: 20 } }], 'persist group move'));
    await timed('undo grouped move', () => evaluate('illustrationWorkspace.history("undo").then(()=>true)'));
    verify(digest((await read()).objects) === digest(grouped.objects), `Undo restores all ${capacity} component geometries and image bytes`);
    await timed('redo grouped move', () => evaluate('illustrationWorkspace.history("redo").then(()=>true)'));
    await evaluate('illustrationWorkspace.history("undo").then(()=>true)');
    await apply([{ op: 'rotate', ids: groupOps[0].ids, degrees: 17, pivot: { x: 760, y: 100 } }], 'rotate mixed group');
    await evaluate('illustrationWorkspace.history("undo").then(()=>true)');
    verify(digest((await read()).objects) === digest(grouped.objects), 'Mixed-group rotation and undo retain exact SVG, raster, chart and text geometry');
    const bounds = await evaluate(`(async()=>{const {selectionBounds}=await import('./grouping.mjs');const {interactionBox}=await import('./artwork.mjs');const scene=illustrationWorkspace.getDocument();return selectionBounds(scene.objects.filter(object=>scene.groups[0].ids.includes(object.id)).map(interactionBox))})()`);
    await apply([{ op: 'transform', id: 'pressure-group-0', patch: { width: bounds.width * 1.1, height: bounds.height * 1.1 } }], 'resize mixed group');
    await evaluate('illustrationWorkspace.history("undo").then(()=>true)');
    verify(digest((await read()).objects) === digest(grouped.objects), 'Mixed-group resize and undo retain exact typography, images and plot specifications');
    await apply([{ op: 'update', id: png.id, patch: { visible: false } }], 'hide PNG at capacity');
    verify(await frameCount() === capacity - 1, 'Visibility removes exactly one component from a full scene');
    await evaluate('illustrationWorkspace.history("undo").then(()=>true)');
    verify(await frameCount() === capacity, 'Undo restores hidden image visibility at capacity');
    await evaluate('document.querySelector("[data-layer-id=pressure-group-0] .layer-select").click();document.getElementById("close-layers").click();document.getElementById("main-canvas").focus()');
    const nudgeStart = (await read()).objects.find(object => object.id === 'pressure-0').x;
    await timed('12 rapid keyboard nudges at capacity', async () => {
      await evaluate('for(let i=0;i<12;i++)document.getElementById("main-canvas").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}))');
      await wait(() => evaluate(`Math.abs(illustrationWorkspace.getDocument().objects.find(object=>object.id==='pressure-0').x-${nudgeStart}-12)<.01
        || document.getElementById('status').textContent.includes('Read it again before applying')`), 'Rapid keyboard edits did not settle', 30000);
      await evaluate('illustrationWorkspace.flush().then(()=>true)');
    });
    const nudgeEnd = (await read()).objects.find(object => object.id === 'pressure-0').x;
    report.rapidNudge = { requested: 12, actualDelta: nudgeEnd - nudgeStart,
      status: await evaluate('document.getElementById("status").textContent') };
    verify(Math.abs(nudgeEnd - nudgeStart - 12) < .01, 'All 12 rapid keyboard nudges persist in order at component capacity');
    // Restore this disposable group before testing the remaining independent paths.
    await apply(grouped.objects.filter(object => groupOps[0].ids.includes(object.id)).map(object => ({ op: 'upsert', object })), 'restore group after rapid-input probe');
    await selectAll();
    await evaluate(`(async()=>{window.stressSnapshot=(await import('./clipboard.mjs')).copyComponents(illustrationWorkspace.getDocument(),illustrationWorkspace.getDocument().objects.map(o=>o.id),(await import('./artwork.mjs')).validateSvg);return true})()`);
    const paste = await timed(`reject over-capacity paste of ${capacity} components`, () => evaluate('illustrationWorkspace.paste(stressSnapshot,{illustrationId:illustrationWorkspace.getLibrary().active_illustration_id,canvas:"main"})'));
    verify(!paste.ok && (await read()).objects.length === capacity, 'Pasting beyond capacity fails without partial duplicates');

    // Exports must contain the same components and omit editing guides.
    const rendered = await timed(`render ${capacity}-component inspection PNG`, () => tool({ action: 'render', canvas: 'main' }));
    verify(rendered.ok, rendered.error || 'Agent render succeeds at component capacity');
    const pngPreview = rendered.content.find(item => item.type === 'image');
    if (pngPreview) await fs.writeFile(path.join(output, 'stress-inspection.png'), Buffer.from(pngPreview.data, 'base64'));
    let exportRestores = [];
    for (const format of ['svg', 'png', 'pptx']) {
      await timed(`export ${format.toUpperCase()} with ${capacity} components`, async () => {
        await evaluate(`document.getElementById('export-${format}').click()`);
        await wait(() => evaluate('!document.getElementById("export-pptx").disabled'), `${format} export stalled`, 90000);
        const status = await evaluate('document.getElementById("status").textContent');
        if (format === 'pptx' && status.includes('exceeds the export size limit')) {
          report.findings.push({ kind: 'pptx-size-limit', status, sceneChars: report.sceneChars });
          verify(digest((await read()).objects) === digest(grouped.objects), 'Oversized PPTX rejection preserves every component and restores Export controls');
          exportRestores = grouped.objects.filter(object => object.name.startsWith('4K generated-artwork test copy'));
          const patches = [];
          for (const object of exportRestores) {
            const dataUrl = await evaluate(`(async()=>{const image=new Image();image.src=${JSON.stringify(object.dataUrl)};await image.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;canvas.getContext('2d').drawImage(image,0,0,1024,1024);return canvas.toDataURL('image/webp',.72)})()`);
            patches.push({ op: 'update', id: object.id, patch: { dataUrl } });
          }
          await apply(patches, 'use 1024px test copies for PPTX retry');
          await timed(`retry PPTX with smaller test copies and ${capacity} components`, async () => {
            await evaluate('document.getElementById("export-pptx").click()');
            await wait(() => evaluate('!document.getElementById("export-pptx").disabled'), 'PPTX retry stalled', 90000);
          });
        }
        verify(await evaluate(`document.getElementById('status').textContent==='Exported ${format.toUpperCase()}'`), await evaluate('document.getElementById("status").textContent'));
      });
      const filename = path.join(temp, `Figura_mixed_component_pressure_test.${format}`);
      const bytes = await fs.readFile(filename);
      await fs.copyFile(filename, path.join(output, `stress-${capacity}.${format}`));
      report.metrics.push({ name: `${format} export bytes`, bytes: bytes.length });
      if (format === 'svg') {
        const svg = bytes.toString();
        verify((svg.match(/data-object-id=/g) || []).length === capacity && !/selection-member|resize-handle|rotation-handle/.test(svg), `SVG export preserves ${capacity} editable objects without selection guides`);
      } else if (format === 'png') verify(bytes.subarray(1, 4).toString() === 'PNG', 'PNG export contains valid PNG bytes');
      else {
        const result = await evaluate(`(async()=>{const zip=await JSZip.loadAsync(${JSON.stringify(bytes.toString('base64'))},{base64:true});const xml=await zip.file('ppt/slides/slide1.xml').async('string');const doc=new DOMParser().parseFromString(xml,'application/xml');const tree=doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/presentationml/2006/main','spTree')[0];return {objects:[...tree.children].filter(n=>['sp','pic'].includes(n.localName)).length,texts:tree.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main','t').length,invalid:Boolean(doc.querySelector('parsererror'))}})()`);
        verify(result.objects === capacity && result.texts >= 60 && !result.invalid, `PPTX exports ${capacity} separate components with native editable text`);
      }
    }
    if (exportRestores.length) await apply(exportRestores.map(object => ({ op: 'upsert', object })), 'restore 4K copies after PPTX retry');
    const saved = await read(), savedHash = digest(saved.objects), savedGroups = digest(saved.groups);
    report.longTasksBeforeReload = await evaluate('window.stressLongTasks || []');
    await timed(`save and reload ${capacity} mixed components`, async () => { await evaluate('illustrationWorkspace.flush().then(()=>true)'); await reloadPlugin(); });
    const reloaded = await read();
    verify(digest(reloaded.objects) === savedHash && digest(reloaded.groups) === savedGroups && await frameCount() === capacity,
      'Reload restores every component, group, source specification and exact original raster bytes');
    // Clipboard survives opening another figure within the same editor instance.
    await evaluate(`(async()=>{window.stressSnapshot=(await import('./clipboard.mjs')).copyComponents(illustrationWorkspace.getDocument(),illustrationWorkspace.getDocument().objects.map(o=>o.id),(await import('./artwork.mjs')).validateSvg);return true})()`);
    const destination = await tool({ action: 'create', title: 'Stress paste destination', expected_library_revision: reloaded.library_revision, request_id: randomUUID() });
    verify(destination.ok, 'Create disposable destination for full-scene paste');
    const copied = await timed(`paste all ${capacity} components into empty figure`, () => evaluate('illustrationWorkspace.paste(stressSnapshot,{illustrationId:illustrationWorkspace.getLibrary().active_illustration_id,canvas:"main",offset:0})'));
    verify(copied.ok && (await read()).objects.length === capacity && (await read()).groups.length === capacity / 10, copied.error || 'Full-scene paste retains all components and groups');
    await timed(`undo ${capacity}-component paste`, () => evaluate('illustrationWorkspace.history("undo").then(()=>true)'));
    verify((await read()).objects.length === 0, `One undo removes the complete ${capacity}-component paste`);
    await timed(`redo ${capacity}-component paste`, () => evaluate('illustrationWorkspace.history("redo").then(()=>true)'));
    verify((await read()).objects.length === capacity, `One redo restores the complete ${capacity}-component paste`);
    report.memoryAfterWorkload = await win.webContents.debugger.sendCommand('Runtime.getHeapUsage');
    report.status = report.findings.length ? 'completed_with_findings' : 'passed';
  } catch (error) {
    report.status = 'failed'; report.failures.push(error.stack || String(error));
    await fs.writeFile(path.join(output, 'stress-failure.png'), (await win.webContents.capturePage()).toPNG()).catch(() => {});
    throw error;
  } finally {
    if (attached) win.webContents.debugger.detach();
    report.longTasks = await evaluate('window.stressLongTasks || []').catch(() => []);
    report.finished = new Date().toISOString();
    await fs.writeFile(path.join(output, 'stress-report.json'), JSON.stringify(report, null, 2));
    console.log(`Figura pressure-test report: ${path.join(output, 'stress-report.json')}`);
  }
}

module.exports = { verifyFiguraStress };
