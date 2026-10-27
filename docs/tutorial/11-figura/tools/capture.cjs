// Run from the repository root: node docs/tutorial/11-figura/tools/capture.cjs
// Captures real Figura controls in a disposable Electron profile, then renders
// editable SVG callouts around the screenshots. No production files are edited.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../../../..');
if (!process.versions.electron) {
  const result = require('node:child_process').spawnSync(require(path.join(root, 'node_modules/electron')), [__filename], {
    stdio: 'inherit', env: { ...process.env, TZ: 'America/Chicago' }, timeout: 180000
  });
  if (result.error || result.signal) console.error(result.error || `Electron exited with signal ${result.signal}`);
  process.exit(result.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-figura-tutorial-'));
app.setPath('userData', path.join(scratch, 'profile'));
app.setPath('sessionData', path.join(scratch, 'session'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');
const folder = path.resolve(__dirname, '..');
const rawFolder = path.join(folder, 'images/raw');
const annotatedFolder = path.join(folder, 'images');
fs.mkdirSync(rawFolder, { recursive: true });
const url = file => pathToFileURL(path.join(root, file)).href;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const manifest = { sourceVersion: JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version,
  exampleDate: '2026-10-25', timezone: 'America/Chicago', viewport: [1600, 1000],
  mode: 'Real Figura renderer; fictional editable illustration; in-memory desktop adapters; no research workspace opened.', screenshots: [], checks: [] };
let win, annotationWin, server;
async function main() {
  await app.whenReady();
  const http = require('node:http');
  const mime = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
  let html;
  server = http.createServer((request,response) => {
    const pathname = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    if(pathname==='/tutorial.html'){response.writeHead(200,{'Content-Type':'text/html'});response.end(html);return;}
    const file=path.resolve(root,'.'+pathname);
    if(!file.startsWith(root+path.sep)){response.writeHead(403);response.end();return;}
    try{response.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});response.end(fs.readFileSync(file));}
    catch{response.writeHead(404);response.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const pluginRoot=path.join(root,'plugins/scientific-illustration');
  html=fs.readFileSync(path.join(pluginRoot,'index.html'),'utf8');
  html=html.replace(/(?:href|src)="([^":#]+)"/g,(match,file)=>match.slice(0,match.indexOf('=')+1)+'"'+origin+'/plugins/scientific-illustration/'+file+'"');
  html=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
  html=html.replace('</head>',`<link rel="stylesheet" href="${origin}/ui/css/components/plugin-workspace-tools.css"><link rel="stylesheet" href="${origin}/docs/tutorial/11-figura/tools/fixture.css"><script src="${origin}/plugins/scientific-illustration/vendor/cropperjs/cropper.min.js"></script><script src="${origin}/plugins/scientific-illustration/vendor/pptxgenjs/pptxgen.bundle.js"></script></head>`);
  html=html.replace('<body>','<body data-active-view="plugin-scientific-illustration-view">');
  html=html.replace('</body>',`<aside id="tutorial-host-tools" class="universal-agent-chat-rail"><div class="universal-agent-chat-rail__tools"><div id="plugin-workspace-tools" class="plugin-workspace-tools" role="toolbar" aria-label="Figura tools" aria-orientation="vertical"></div></div></aside><script type="module" src="${origin}/docs/tutorial/11-figura/tools/figura-fixture.mjs"></script></body>`);
  const fixture=origin+'/tutorial.html';
  win = new BrowserWindow({ width: 1600, height: 1000, useContentSize: true, enableLargerThanScreen: true, show: false,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  annotationWin = new BrowserWindow({ width: 1600, height: 1000, useContentSize: true, enableLargerThanScreen: true, show: false,
    webPreferences: { sandbox: true, contextIsolation: true } });
  // The fixture must not fetch any remote resource.
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: !_details.url.startsWith(origin + "/") }));
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error(`renderer: ${message}`); });
  const evaluate = code => win.webContents.executeJavaScript(`(async () => { ${code} })()`, true);
  const waitFor = async code => {
    for (let i = 0; i < 160; i++) {
      if (await evaluate(`return Boolean(${code});`)) return;
      await pause(30);
    }
    throw new Error(`Timed out: ${code}`);
  };
  const check = async (code, label) => {
    if (!await evaluate(`return Boolean(${code});`)) throw new Error(label);
    manifest.checks.push(label);
  };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click();`);
  const pointerClick = async selector => {
    const point = await evaluate(`const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};`);
    win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
  };
  const input = (selector, value) => evaluate(`const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));`);
  const editingInput = (selector, value) => evaluate(`const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true }));`);
  const key = async (selector, keyName) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus();`);
    const keyCode=keyName.startsWith('Arrow')?keyName.slice(5):keyName;
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  };
  // The menu opens at the pointer; right-click low on the row so the menu sits below it.
  const contextMenu = selector => evaluate(`const el = document.querySelector(${JSON.stringify(selector)}); const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 40, clientY: r.bottom - 2 }));`);
  // A selector, or a list of them, covers every element it matches.
  const box = async selector => {
    const boxes = (await Promise.all((Array.isArray(selector) ? selector : [selector]).map(item => evaluate(`const els = [...document.querySelectorAll(${JSON.stringify(item)})];
      if (!els.length) throw new Error('Missing ' + ${JSON.stringify(item)});
      const rects = els.map(el => el.getBoundingClientRect()).filter(r => r.width || r.height);
      if (!rects.length) throw new Error('Not visible ' + ${JSON.stringify(item)});
      return rects.map(r => ({ x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) }));`)))).flat();
    const x = Math.min(...boxes.map(r => r.x)), y = Math.min(...boxes.map(r => r.y));
    return { x, y, width: Math.max(...boxes.map(r => r.x + r.width)) - x, height: Math.max(...boxes.map(r => r.y + r.height)) - y };
  };
  const cropOf = async selector => {
    if (!selector) return { x: 0, y: 0, width: 1600, height: 1000 };
    const r = await box(selector);
    const x = Math.max(0, r.x - 18), y = Math.max(0, r.y - 18);
    return { x, y, width: Math.min(1600, r.x + r.width + 18) - x, height: Math.min(1000, r.y + r.height + 18) - y };
  };
  const shot = async (name, title, subtitle, cropSelector, targets, { side } = {}) => {
    // Notices are transient; a reported error means the preview drifted from the real flow.
    const errors = await evaluate('return tutorial.calls.filter(c => c.kind === "error").map(c => c.message);');
    if (errors.length) throw new Error(`Renderer reported an error before ${name}: ${errors.join('; ')}`);
    await evaluate('document.querySelectorAll("[data-hikari-transient-toast]").forEach(t => { t.hidden = true; }); await document.fonts.ready; await illustrationWorkspace.flush(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));');
    await pause(120);
    if (name === '06-add-layer-menu' || name === '18-align-distribute') {
      const paint=await evaluate(`const el=document.querySelector(${JSON.stringify(targets[0][0])}),r=el.getBoundingClientRect(),panel=el.parentElement,menu=panel.parentElement,hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {ok:el.contains(hit),open:menu.open,popover:panel.matches(':popover-open'),rect:r.toJSON(),css:[getComputedStyle(panel).display,getComputedStyle(panel).visibility,getComputedStyle(panel).position],hit:hit?.outerHTML.slice(0,200)};`);
      if(!paint.ok)throw Error('The hosted menu must be visible above the canvas: '+name+' '+JSON.stringify(paint));
    }
    const crop = await cropOf(cropSelector);
    const capture = (await win.webContents.capturePage()).resize({ width: 1600, height: 1000 }).crop(crop);
    fs.writeFileSync(path.join(rawFolder, `${name}.png`), capture.toPNG());
    const targetsWithRects = [];
    for (const [selector, label, badge] of targets) {
      const rect = await box(selector);
      if (rect.x < crop.x || rect.y < crop.y || rect.x + rect.width > crop.x + crop.width || rect.y + rect.height > crop.y + crop.height) throw new Error(`Annotation outside screenshot: ${name}: ${selector}`);
      targetsWithRects.push({ selector, label, rect, ...(badge ? { badge } : {}) });
    }
    const sideRail = side ?? (crop.width < 1000 && crop.height > 300);
    const width = Math.max(crop.width + (sideRail ? 400 : 48), 1000);
    const height = sideRail ? Math.max(crop.height + 140, targets.length * 84 + 160) : crop.height + 210;
    const imageX = sideRail ? 24 : Math.round((width - crop.width) / 2), imageY = 94;
    const laneWidth = (width - 64) / targets.length;
    const color = '#286983';
    const boxes = targetsWithRects.map(({ rect }) => ({ x: imageX + rect.x - crop.x - 4, y: imageY + rect.y - crop.y - 4, w: rect.width + 8, h: rect.height + 8 }));
    const labelAt = slot => {
      const labelX = sideRail ? imageX + crop.width + 32 : 32 + laneWidth * slot + 7;
      const labelY = sideRail ? imageY + (slot + .5) * (height - 140) / targets.length - 20 : imageY + crop.height + 35;
      const labelWidth = sideRail ? width - labelX - 24 : laneWidth - 14;
      return { labelX, labelY, labelWidth, ax: sideRail ? labelX - 7 : labelX + labelWidth / 2, ay: sideRail ? labelY + 20 : labelY - 9 };
    };
    // Arrows end at the nearest point of the highlight, so they cross as little of the UI as possible.
    const arrowFor = (b, l) => [[l.ax, l.ay], [Math.min(Math.max(l.ax, b.x), b.x + b.w), Math.min(Math.max(l.ay, b.y), b.y + b.h)]];
    // Label boxes take the order whose arrows cross each other and the other
    // highlights least, then the shortest; the numbers still follow the steps.
    const orient = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    const crosses = ([a, b], [c, d]) => orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;
    const hitsBox = (arrow, b) => [[[b.x, b.y], [b.x + b.w, b.y]], [[b.x + b.w, b.y], [b.x + b.w, b.y + b.h]], [[b.x, b.y + b.h], [b.x + b.w, b.y + b.h]], [[b.x, b.y], [b.x, b.y + b.h]]].some(edge => crosses(arrow, edge));
    const orders = items => items.length < 2 ? [items] : items.flatMap((item, i) => orders(items.filter((_item, j) => j !== i)).map(rest => [item, ...rest]));
    const cost = order => {
      const arrows = boxes.map((b, i) => arrowFor(b, labelAt(order[i])));
      return arrows.reduce((sum, arrow, i) => sum + Math.hypot(arrow[0][0] - arrow[1][0], arrow[0][1] - arrow[1][1])
        + arrows.filter((other, j) => j > i && crosses(arrow, other)).length * 1e6
        + boxes.filter((b, j) => j !== i && hitsBox(arrow, b)).length * 1e4, 0);
    };
    const slots = orders(boxes.map((_b, i) => i)).reduce((best, order) => cost(order) < cost(best) ? order : best);
    const callouts = targetsWithRects.map(({ label, badge }, i) => {
      const { x, y, w, h } = boxes[i];
      const { labelX, labelY, labelWidth } = labelAt(slots[i]);
      const [[ax, ay], [ex, ey]] = arrowFor(boxes[i], labelAt(slots[i]));
      // Badges sit on the top-left corner unless that would cover the target's text.
      const badgeX = badge === 'right' ? x + w - 1 : x + 1;
      const cx = labelX + labelWidth / 2, cy = labelY;
      const reach = Math.hypot(ax - ex, ay - ey) || 1;
      const arrow = `M${ax},${ay} L${ex + (ax - ex) / reach * 5},${ey + (ay - ey) / reach * 5}`;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${color}" fill-opacity=".045" stroke="${color}" stroke-width="3"/>
        <path d="${arrow}" stroke="${color}" stroke-width="2.5" fill="none" marker-end="url(#arrow)"/>
        <circle cx="${badgeX}" cy="${y + 1}" r="14" fill="${color}" stroke="white" stroke-width="2"/><text x="${badgeX}" y="${y + 6}" text-anchor="middle" fill="white" font-size="15" font-weight="700">${i + 1}</text>
        <rect x="${labelX}" y="${cy}" width="${labelWidth}" height="40" rx="8" fill="#fffaf3" stroke="#dfdad9"/>
        <text x="${cx}" y="${cy + 25}" text-anchor="middle" fill="#191724" font-size="16" font-weight="600">${i + 1}. ${esc(label)}</text>`;
    }).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, sans-serif"><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="${color}"/></marker></defs><rect width="100%" height="100%" fill="#f8f5ee"/><text x="24" y="33" fill="#191724" font-size="25" font-weight="700">${esc(title)}</text><text x="24" y="61" fill="#6e6a86" font-size="16">${esc(subtitle)}</text><image x="${imageX}" y="${imageY}" width="${crop.width}" height="${crop.height}" href="data:image/png;base64,${capture.toPNG().toString('base64')}"/>${callouts}<text x="24" y="${height - 12}" fill="#797593" font-size="12">HIKARI TUTORIAL · Fictional example data · Real Figura renderer · 25 October 2026</text></svg>`;
    fs.writeFileSync(path.join(annotatedFolder, `${name}.svg`), svg);
    const annotationFile = path.join(scratch, 'annotation.html');
    fs.writeFileSync(annotationFile, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}svg{display:block}</style>${svg}`);
    annotationWin.setContentSize(width, height);
    await annotationWin.loadFile(annotationFile);
    await annotationWin.webContents.executeJavaScript('Promise.all([...document.images].map(img => img.decode()))');
    await pause(150);
    fs.writeFileSync(path.join(annotatedFolder, `${name}.png`), (await annotationWin.webContents.capturePage()).resize({ width, height }).toPNG());
    manifest.screenshots.push({ name, title, crop, targets: targetsWithRects });
    console.log(`Captured ${name}`);
  };
  const markRect = async (name, expression) => {
    await evaluate(`(${expression}).setAttribute('data-tutorial-target', ${JSON.stringify(name)});`);
    return `[data-tutorial-target="${name}"]`;
  };
  const scrollTo = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'});`);
  const upload = (selector, content, name) => evaluate(`const d=new DataTransfer();d.items.add(new File([${JSON.stringify(content)}],${JSON.stringify(name)},{type:'text/csv'}));const el=document.querySelector(${JSON.stringify(selector)});el.files=d.files;el.dispatchEvent(new Event('change',{bubbles:true}));`);
  const tool = id => `[data-workspace-tool-id="${id}"]`;
  const settle = () => evaluate('await illustrationWorkspace.flush();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));');
  const choose = async ids => { await evaluate(`await tutorial.choose(${JSON.stringify(ids)});`); await settle(); };
  const closeLayers = async () => { if(await evaluate('return !document.getElementById("layer-inspector").hidden;'))await click('#close-layers'); };
  const point = async (x,y) => evaluate(`const svg=document.querySelector('#main-canvas > svg'),p=new DOMPoint(${x},${y}).matrixTransform(svg.getScreenCTM());return {x:Math.round(p.x),y:Math.round(p.y)};`);
  const dragCanvas = async coords => {
    const start=await point(...coords[0]);win.webContents.sendInputEvent({type:'mouseDown',...start,button:'left',clickCount:1});
    for(const xy of coords.slice(1)){win.webContents.sendInputEvent({type:'mouseMove',...await point(...xy)});await pause(40);}
    win.webContents.sendInputEvent({type:'mouseUp',...await point(...coords.at(-1)),button:'left',clickCount:1});await settle();
  };
  const menuAt = async(x,y)=>{const p=await point(x,y);await evaluate(`document.getElementById('main-canvas').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:${p.x},clientY:${p.y}}));`);};
  await win.loadURL(fixture);
  await waitFor('window.tutorialReady && document.querySelector("[data-workspace-tool-id=add-menu]")');
  fs.writeFileSync(path.join(folder,'examples/cell-component.svg'),await evaluate('return tutorial.cellSvg;'));
  fs.writeFileSync(path.join(folder,'examples/cell-artwork.png'),Buffer.from((await evaluate('return tutorial.raster;')).split(',')[1],'base64'));
  const originalId=await evaluate('return illustrationWorkspace.getLibrary().active_illustration_id;');
  await shot('01-figura-workspace','Open Figura and find its main controls','Use Illustrations on the left, the canvas in the center, and the tools on the right.',null,
    [['#illustrations-rail','Find saved illustrations'], ['#main-canvas','Edit the figure canvas'], ['#plugin-workspace-tools','Open drawing and layer tools']]);
  await click('#new-illustration');
  await waitFor('illustrationWorkspace.getDocument().objects.length===0');
  await input('#figure-title','Practice diagram · example');await settle();
  await shot('02-create-illustration','Create and name a new illustration','Click New illustration, then enter a descriptive title.',null,
    [['#new-illustration','Create a new illustration'], ['#figure-title','Enter the figure title']]);
  await input('#prompt','Draw a simple schematic of one sender cell, a signal arrow, and one receiver cell. Keep every label separately editable.');
  await input('#complexity','simple');await settle();
  await shot('03-drawing-prompt','Describe the figure you want to draw','Choose Complexity, describe the figure, then use Draw with Codex when ready.',['.toolbar','#prompt-form','#main-canvas'],
    [['#complexity','Choose a complexity level'], ['#prompt','Describe content and labels'], ['#generate','Draw with Codex']]);
  await click('#figure-menu > summary');
  await click('#image-generation-enabled');
  await input('#image-generation-percent','0');
  await input('#image-generation-style-prompt','Teal and lavender palette; keep labels separate.');
  await settle();
  await shot('04-generation-preferences','Set preferences for future AI edits','Figure options controls image-generation preference, image style, and style notes.','#figure-menu .popover-panel',
    [['#image-generation-enabled','Enable a percentage preference'], ['#image-generation-percent','Choose the image-generation share'], ['#image-generation-style','Choose an image style']]);
  await check('illustrationWorkspace.getDocument().imageGenerationPercent===0','Figure options saves a zero-percent image-generation preference without calling AI');
  await evaluate('document.getElementById("figure-menu").open=false;');
  await input('#canvas-size','custom');
  await shot('05-canvas-size','Choose a preset or an exact canvas size','Canvas size sets the figure bounds; it does not scale the objects.',['.canvas-controls','.canvas-options .popover-panel'],
    [['#canvas-size','Choose a canvas preset'], ['#canvas-properties [name=width]','Enter the canvas width'], ['#canvas-properties [name=height]','Enter the canvas height']]);
  await input('#canvas-properties [name=width]','1200');await settle();
  await evaluate('document.querySelector(".canvas-options").open=false;');
  await click(tool('add-menu'));
  await shot('06-add-layer-menu','Add an editable layer','Use Add layer for a text label, a vector component, or imported artwork.','#add-menu .popover-panel',
    [['#add-text','Add a text label'], ['#add-vector','Add a vector component'], ['#import','Import artwork']]);
  await click('#add-text');
  await waitFor('!document.getElementById("properties").hidden');
  await input('#label-content','Signal transfer · example');await settle();
  await input('#properties [name=fontSize]','38');await settle();
  await shot('07-edit-text','Edit a label independently','Use text controls for its content, font, size, color, and alignment.','#layer-inspector',
    [['#label-content','Edit the label text'], ['.font-row','Set font, size, and color'], ['#text-properties .field-grid','Set weight and anchor']]);
  await check('illustrationWorkspace.getDocument().objects.some(o=>o.type==="text"&&o.text.includes("Signal transfer")&&o.fontSize===38)','Adding and editing a text label saves its content and font size');
  await click(tool('add-menu'));await click('#add-vector');await settle();
  await input('#properties [name=fill]','#d2e5e4');await settle();
  await input('#properties [name=stroke]','#438482');await settle();
  await shot('08-style-vector','Style a vector component','Change the vector fill and stroke, or edit its source artwork when needed.','#layer-inspector',
    [['#vector-properties [name=fill]','Set the vector fill'], ['#vector-properties [name=stroke]','Set its outline color'], ['#edit-artwork','Open the SVG artwork editor']]);
  await evaluate('await tutorial.clear();await tutorial.seed();await tutorial.apply([{op:"title",title:"Practice diagram · example"}]);');
  await closeLayers();
  await click(tool('add-menu'));await click('#import');
  await evaluate('const d=new DataTransfer();const bytes=Uint8Array.from(atob(tutorial.raster.split(",")[1]),c=>c.charCodeAt(0));d.items.add(new File([bytes],"cell-artwork.png",{type:"image/png"}));const el=document.getElementById("asset-input");el.files=d.files;el.dispatchEvent(new Event("change",{bubbles:true}));');
  await waitFor('document.getElementById("raster-dialog").open');
  await shot('09-import-artwork','Inspect imported artwork before adding it','Review the image and confirm that labels are kept in separate text layers.','#raster-dialog',
    [['#raster-preview','Inspect the artwork'], ['#text-free','Confirm the image has no text'], ['#confirm-raster','Add artwork to the canvas']]);
  await click('#text-free');await click('#confirm-raster');
  await waitFor('illustrationWorkspace.getDocument().objects.some(o=>o.type==="raster")');
  const rasterId=await evaluate('return illustrationWorkspace.getDocument().objects.find(o=>o.type==="raster").id;');
  await click(tool('crop-raster'));
  await waitFor('document.querySelector("#canvas-crop-overlay [data-crop-field=width]")?.value');
  await input('[data-crop-field=x]','40');await input('[data-crop-field=y]','30');
  await input('[data-crop-field=width]','400');await input('[data-crop-field=height]','300');
  await shot('10-crop-image','Crop a selected raster image','Drag the crop handles or enter pixel bounds, then apply the crop.','#canvas-crop-overlay',
    [['.cropper-crop-box','Adjust the crop area'], ['.canvas-crop-fields','Enter exact pixel bounds'], ['#canvas-crop-apply','Apply crop']]);
  await click('#canvas-crop-apply');
  await waitFor('!document.getElementById("canvas-crop-overlay")');
  await check(`illustrationWorkspace.getDocument().objects.find(o=>o.id===${JSON.stringify(rasterId)}).dataUrl!==tutorial.raster`,'Applying a raster crop saves new image pixels on the selected layer');
  await evaluate(`await illustrationWorkspace.manage('open',${JSON.stringify(originalId)});`);await settle();await closeLayers();
  await click(tool('pointer-tool'));
  await dragCanvas([[115,180],[200,280],[300,420],[445,535]]);
  await shot('11-rectangle-selection','Select components with a rectangle','Drag empty canvas around components; the outer frame moves the selection.','#main-canvas',
    [['#main-canvas .selection','Review the selected components']]);
  await check('document.getElementById("group-selection").disabled===false','Rectangle selection includes the sender artwork and its independent label');
  await key('#main-canvas','Escape');
  await click(tool('freehand-tool'));
  await dragCanvas([[740,185],[1060,185],[1085,430],[1060,545],[745,545],[730,400],[740,185]]);
  await shot('12-freehand-selection','Select with a freehand outline','Use Freehand selection to outline components, then move or resize them.',['#main-canvas','#plugin-workspace-tools'],
    [[tool('freehand-tool'),'Choose Freehand selection'], ['#main-canvas .selection','Review the selected region']]);
  await click(tool('pointer-tool'));
  await choose(['sender']);
  await evaluate('document.querySelector(".geometry-options").open=true;');
  await shot('13-position-and-size','Set exact position, size, and opacity','Open Layers, select a component, and expand Position & size.','#layer-inspector',
    [['.geometry-options','Enter position and dimensions'], ['#properties [name=rotation]','Set a rotation angle'], ['#properties [name=opacity]','Adjust opacity']]);
  await input('#properties [name=x]','155');await settle();
  await check('illustrationWorkspace.getDocument().objects.find(o=>o.id==="sender").x===155','Position fields update the selected component in canvas coordinates');
  await choose(['signal-arrow']);await closeLayers();
  await shot('14-rotate-selection','Rotate a component with its handle','Drag the round rotation handle; hold Shift to snap to 15-degree steps.','#main-canvas',
    [['#main-canvas .rotation-handle','Use the rotation handle'], ['#main-canvas .selection','Resize or move the selected component']]);
  await key('#main-canvas .rotation-handle','ArrowRight');await settle();
  await waitFor('Math.abs(illustrationWorkspace.getDocument().objects.find(o=>o.id==="signal-arrow").rotation-1)<0.00001');
  manifest.checks.push('The rotation handle supports one-degree keyboard steps');
  await evaluate('await illustrationWorkspace.history("undo");');
  await choose(['caption']);
  await evaluate('document.querySelector(".geometry-options").open=false;');
  await evaluate('document.querySelector("[data-layer-id=caption] .layer-visibility").focus();');
  await shot('15-layer-actions','Manage layer order and visibility','Use Layers to select, hide, duplicate, reorder, or delete components.','#layer-inspector',
    [['#layers','Select a layer'], ['[data-layer-id=caption] .layer-visibility','Hide or show the layer'], ['.object-actions','Duplicate, reorder, or delete']]);
  await click('[data-layer-id=caption] .layer-visibility');await settle();
  await check('illustrationWorkspace.getDocument().objects.find(o=>o.id==="caption").visible===false','The layer visibility button hides a component without deleting it');
  await evaluate('await illustrationWorkspace.history("undo");');
  await choose(['sender','sender-label']);await closeLayers();
  await shot('16-group-selection','Group artwork and its label','Select related components and group them so they move and resize together.',['#main-canvas','#plugin-workspace-tools'],
    [[tool('group-selection'),'Group the selected components'], [tool('ungroup-selection'),'Ungroup when needed'], ['#main-canvas .selection','Inspect the shared selection frame']]);
  await click(tool('group-selection'));await settle();
  await check('illustrationWorkspace.getDocument().groups.some(g=>g.ids.includes("sender")&&g.ids.includes("sender-label"))','Grouping preserves separate artwork and text within one editable group');
  await menuAt(285,325);
  await shot('17-context-menu','Open component actions with a right-click','The same menu is available on the canvas or a layer row.','#canvas-context-menu',
    [['[data-context-action=copy]','Copy selected components'], ['[data-context-action=ungroup]','Ungroup the selected group'], ['[data-context-action=save-asset]','Save as a reusable asset']]);
  await key('#main-canvas','Escape');
  await choose(['sender-label','signal-label','receiver-label']);await closeLayers();
  await click(tool('align-menu'));
  await shot('18-align-distribute','Align components or distribute their spacing','Select two items to align them, or at least three to distribute equal gaps.','#align-menu .popover-panel',
    [['[data-layout-action=vertical-center]','Align vertical centers'], ['[data-layout-action=distribute-horizontal]','Distribute horizontally'], ['[data-layout-action=distribute-vertical]','Distribute vertically']]);
  await click('[data-layout-action=vertical-center]');await settle();
  await check('(()=>{const centers=["sender-label","signal-label","receiver-label"].map(id=>{const r=document.querySelector(`#main-canvas [data-object-id="${id}"] text`).getBoundingClientRect();return r.y+r.height/2;});return Math.max(...centers)-Math.min(...centers)<1;})()','Vertical-center alignment gives the three selected labels the same visible center');
  await evaluate('await illustrationWorkspace.history("undo");document.getElementById("align-menu").open=false;');
  const groupId=await evaluate('return illustrationWorkspace.getDocument().groups[0].id;');
  await choose([groupId]);await closeLayers();await menuAt(285,325);
  await click('[data-context-action=copy]');await settle();
  await menuAt(1100,650);
  await shot('19-copy-paste','Copy and paste editable components','Copy the selection, then paste on this canvas or another illustration.','#canvas-context-menu',
    [['[data-context-action=copy]','Copy the selection'], ['[data-context-action=paste]','Paste editable copies']]);
  const count=await evaluate('return illustrationWorkspace.getDocument().objects.length;');
  await click('[data-context-action=paste]');await settle();
  await check(`illustrationWorkspace.getDocument().objects.length===${count+2}`,'Pasting a copied group creates independent editable artwork and text layers');
  await evaluate('await illustrationWorkspace.history("undo");');
  await choose([groupId]);await closeLayers();await menuAt(285,325);await click('[data-context-action=save-asset]');
  await input('#asset-name','Sender cell component');
  await shot('20-save-asset','Save a reusable component','Give the selected artwork and label a reusable asset name.','#save-asset-dialog',
    [['#asset-name','Name the reusable component'], ['#confirm-save-asset','Save asset']]);
  await click('#confirm-save-asset');
  await waitFor('document.querySelector("[data-saved-asset]")');await settle();
  await shot('21-reusable-assets','Find and insert reusable assets','Search Assets and click a component to add an editable copy.','#layer-inspector',
    [['#asset-search','Search saved assets'], ['.asset-insert','Insert an editable copy'], ['#import-asset','Import an artwork asset']]);
  await click('.asset-insert');await settle();
  await check(`illustrationWorkspace.getDocument().objects.length===${count+2}`,'An asset inserts independent copies of its saved artwork and text');
  await evaluate('await illustrationWorkspace.history("undo");');await closeLayers();
  await shot('22-saved-illustrations','Find and reopen a saved illustration','Search titles in the Illustrations rail, then click a row to open it.','#illustrations-rail',
    [['#illustration-search','Search illustration titles'], ['#illustrations','Open a saved figure']]);
  await click('#figure-menu > summary');
  await shot('23-duplicate-illustration','Duplicate a figure before revising it','Figure options creates a separate illustration with the current canvas content.','#figure-menu .popover-panel',
    [['#duplicate-illustration','Duplicate this illustration']]);
  const oldLibraryCount=await evaluate('return illustrationWorkspace.getLibrary().illustrations.length;');
  await click('#duplicate-illustration');await settle();
  await check(`illustrationWorkspace.getLibrary().illustrations.length===${oldLibraryCount+1}`,'Duplicate illustration adds a separate saved figure to the library');
  await evaluate('document.getElementById("figure-menu").open=false;');
  await click('#export-menu > summary');
  await shot('24-export-figure','Export the figure in the format you need','Choose SVG, PNG, or PowerPoint; hidden layers are left out.','#export-menu .popover-panel',
    [['#export-svg','Export editable SVG'], ['#export-png','Export a PNG image'], ['#export-pptx','Export adjustable PowerPoint objects']]);
  await click('#export-svg');
  await waitFor('tutorial.downloads.some(d=>d.fileName.endsWith(".svg"))');
  await check('atob(tutorial.downloads.find(d=>d.fileName.endsWith(".svg")).dataBase64).includes("<svg")','SVG export produces a figure from the visible editable layers');
  fs.writeFileSync(path.join(folder,'examples/finished-figure.svg'),Buffer.from(await evaluate('return tutorial.downloads.find(d=>d.fileName.endsWith(".svg")).dataBase64;'),'base64'));
  await settle();
  fs.writeFileSync(path.join(folder,'capture-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(`Finished: ${manifest.screenshots.length} screenshots; ${manifest.checks.length} checks.`);
}
main().then(()=>{server?.close();app.quit();}).catch(error=>{console.error(error);server?.close();app.exit(1);});
