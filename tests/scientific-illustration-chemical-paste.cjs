const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { jsPDF } = require('../vendor/jspdf.umd.min.js');
const { readChemicalClipboard } = require(path.join(process.env.HIKARI_PLUGIN_QA_ROOT || path.resolve(__dirname, '..'), 'src/main/preload/api/chemical-clipboard-api.js'));

async function verifyChemicalPaste({ tool, evaluate, check, win, pause, temp }) {
  const host = code => win.webContents.executeJavaScript(code);
  const read = () => tool({ action: 'read', include_assets: true });
  const wait = async predicate => {
    for (let i = 0; i < 100; i++) { const current = await read(); if (predicate(current)) return current; await pause(30); }
    throw new Error(`Chemical paste did not settle: ${JSON.stringify({ status: await evaluate('document.getElementById("status").textContent'), objects: (await read()).objects.map(object => ({ id: object.id, type: object.type })) })}`);
  };
  const sharp = await evaluate(`(()=>{const c=document.createElement('canvas');c.width=600;c.height=240;const x=c.getContext('2d');
    x.strokeStyle='#222';x.lineWidth=5;x.beginPath();x.moveTo(40,150);x.lineTo(130,95);x.lineTo(220,150);x.lineTo(310,95);x.stroke();
    x.fillStyle='#222';x.font='42px Arial';x.fillText('OH',320,110);x.fillText('NH₂',20,205);return c.toDataURL()})()`);
  const native = await evaluate(`(()=>{const c=document.createElement('canvas');c.width=100;c.height=40;c.getContext('2d').fillRect(1,1,90,30);return c.toDataURL()})()`);
  await host(`window.qaNativeClipboard={ok:true,formats:['com.cambridgesoft.chemdraw','public.tiff'],candidates:[
    {format:'com.cambridgesoft.chemdraw',text:'VjCD0100 native chemical bytes'},
    {format:'image/native',imageDataUrl:${JSON.stringify(native)}},{format:'public.tiff',imageDataUrl:${JSON.stringify(sharp)}}]}`);
  const current = await read();
  check((await tool({ action: 'apply', illustration_id: current.illustration_id, expected_revision: current.revision,
    request_id: randomUUID(), operations: [{ op: 'upsert', object: { id: 'old-copy', type: 'text', text: 'Previous Figura copy' } }] })).ok, 'Create clipboard precedence fixture');
  await evaluate(`window.qaClipText='';window.qaNoPasteEvent=false;
    document.execCommand=action=>{
      if(action==='paste'&&qaNoPasteEvent)return false;
      const data=new DataTransfer();if(action==='paste')data.setData('text/plain',qaClipText);
      const e=new ClipboardEvent(action,{bubbles:true,cancelable:true,clipboardData:data});document.activeElement.dispatchEvent(e);
      if(action==='copy')qaClipText=data.getData('text/plain');return e.defaultPrevented;
    };
    document.querySelector('[data-layer-id=old-copy] .layer-select').click();document.getElementById('close-layers').click();document.getElementById('main-canvas').focus();
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'c',ctrlKey:true,bubbles:true}));qaClipText='';`);
  const paste = async (metaKey = false) => evaluate(`document.getElementById('main-canvas').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'v',${metaKey ? 'metaKey' : 'ctrlKey'}:true,bubbles:true}))`);
  let before = await read(); await paste();
  let after = await wait(doc => doc.objects.length === 2);
  const structure = after.objects.find(object => object.chemicalStructure);
  check(structure?.type === 'raster' && structure.textFree === false, 'Native ChemDraw paste preserves atom labels in a chemical structure layer');
  const pixels = await evaluate(`new Promise(resolve=>{const i=new Image();i.onload=()=>resolve({width:i.width,height:i.height});i.src=${JSON.stringify(structure.dataUrl)}})`);
  check(pixels.width > 300 && pixels.height > 100, 'The sharp TIFF preview wins over the lower resolution native image');
  check(after.objects.filter(object => object.type === 'text').length === 1, 'Pasting from ChemDraw does not insert the stale Figura copy');
  check(structure.width <= 360 && structure.width / structure.height === pixels.width / pixels.height, 'Structure paste keeps proportions and fits the canvas');
  check(await evaluate(`document.querySelector('[data-object-id="${structure.id}"]').getAttribute('aria-pressed')==='true'`), 'The pasted structure is selected for movement and resizing');
  await fs.writeFile(path.join(temp, 'chemdraw-paste.png'), (await win.webContents.capturePage()).toPNG());
  const preview = await tool({ action: 'render', canvas: 'main' });
  check(preview.content.some(item => item.type === 'image'), 'Chemical structures remain available in exported canvas previews');
  await evaluate('illustrationWorkspace.history("undo")'); await pause(60);
  check(JSON.stringify((await read()).objects) === JSON.stringify(before.objects), 'One undo removes the complete structure paste');
  await evaluate('illustrationWorkspace.history("redo")'); await pause(60);
  check((await read()).objects.find(object => object.id === structure.id)?.dataUrl === structure.dataUrl, 'Redo restores the exact chemical image');

  // Native reads also cover hosts where execCommand does not emit a paste event.
  await evaluate('qaNoPasteEvent=true'); await paste(true); after = await wait(doc => doc.objects.length === 3);
  check(after.objects.filter(object => object.chemicalStructure).length === 2, 'Command-V uses the native reader when browser paste events are unavailable');
  before = after;
  await host(`window.qaNativeClipboard={ok:true,formats:['chemical/x-cdx'],candidates:[{format:'chemical/x-cdx',text:'VjCD0100 no preview'}]}`);
  await paste(); await pause(150);
  check((await read()).revision === before.revision && await evaluate('document.getElementById("status").textContent.includes("no image preview")'), 'Native-only data without a preview reports a useful message without creating a placeholder');
  await host(`window.qaNativeClipboard={ok:true,formats:['image/native'],candidates:[{format:'image/native',imageDataUrl:'data:image/png;base64,INVALID'}]}`);
  await paste(); await pause(150);
  check((await read()).revision === before.revision, 'Invalid image bytes do not alter the saved scene');

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 80"><path d="M10 50L60 20L110 50" fill="none" stroke="#222" stroke-width="3"/><text x="120" y="55" font-family="Arial" font-size="28">OH</text></svg>';
  await host(`window.qaNativeClipboard={ok:true,formats:['image/svg+xml'],candidates:[{format:'image/svg+xml',imageDataUrl:${JSON.stringify(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)}}]}`);
  await paste(); after = await wait(doc => doc.objects.length === 4);
  check(after.objects.at(-1).chemicalStructure && after.objects.at(-1).type === 'vector' && after.objects.at(-1).svg.includes('>OH</text>')
    && !after.objects.at(-1).dataUrl, 'SVG structure previews retain vector paths and atom text without PNG conversion');
  before = after;
  const unsafe = svg.replace('</svg>', '<script>alert(1)</script></svg>');
  await host(`window.qaNativeClipboard={ok:true,formats:['image/svg+xml'],candidates:[{format:'image/svg+xml',imageDataUrl:${JSON.stringify(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(unsafe)}`)}}]}`);
  await paste(); await pause(150);
  check((await read()).revision === before.revision, 'Executable SVG clipboard content is rejected');
  const reads = await host('qaNativeClipboardReads');
  await evaluate('document.getElementById("figure-title").focus();document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"v",ctrlKey:true,bubbles:true}))');
  await pause(80);
  check(await host('qaNativeClipboardReads') === reads && (await read()).revision === before.revision, 'Pasting into a text field never reads or inserts chemical artwork');
  await host('window.qaNativeClipboard={ok:false,formats:[],candidates:[]}');
  await evaluate(`(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(sharp.split(',')[1])}),c=>c.charCodeAt(0));
    const data=new DataTransfer();data.items.add(new File([bytes],'structure.png',{type:'image/png'}));document.getElementById('main-canvas').focus();
    document.activeElement.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));})()`);
  after = await wait(doc => doc.objects.length === 5);
  check(after.objects.at(-1).chemicalStructure && after.objects.at(-1).textFree === false, 'A browser-exposed PNG paste works even when the native clipboard bridge is unavailable');
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [220, 90] });
  pdf.setLineWidth(1.5); pdf.line(20, 55, 55, 35); pdf.line(55, 35, 90, 55); pdf.line(90, 55, 125, 35);
  pdf.setFontSize(18); pdf.text('OH', 132, 40); pdf.setFontSize(8); pdf.text('2', 153, 46);
  const pdfDataBase64 = Buffer.from(pdf.output('arraybuffer')).toString('base64');
  const hiddenPdfClipboard = readChemicalClipboard({ availableFormats: () => ['image/png'],
    readBuffer: format => format === 'com.adobe.pdf' ? Buffer.from(pdfDataBase64, 'base64') : Buffer.alloc(0),
    readImage: () => ({ isEmpty: () => false, toDataURL: () => native }) });
  check(hiddenPdfClipboard.candidates.some(candidate => candidate.pdfDataBase64 === pdfDataBase64), 'Native PDF is discovered even when macOS advertises only a PNG preview');
  await host(`window.qaNativeClipboard=${JSON.stringify(hiddenPdfClipboard)}`);
  await paste(); after = await wait(doc => doc.objects.length === 6);
  const pdfVector = after.objects.at(-1);
  check(pdfVector.type === 'vector' && pdfVector.chemicalStructure && !pdfVector.dataUrl
    && (pdfVector.svg.match(/<path/g) || []).length === 6 && !/<image|<text/.test(pdfVector.svg), 'The original PDF wins over a blurry preview and preserves bonds and atom glyphs as vector paths');
  await fs.writeFile(path.join(temp, 'chemical-vector.pdf'), Buffer.from(pdfDataBase64, 'base64'));
  await fs.writeFile(path.join(temp, 'chemical-vector.svg'), pdfVector.svg);
  check(await evaluate(`(async()=>{const {svgSource}=await import('./artwork.mjs');const source=await svgSource(illustrationWorkspace.getDocument(),'main');return source.includes('data-object-id="${pdfVector.id}"')&&source.includes(${JSON.stringify(pdfVector.svg.match(/d="[^"]+"/)[0])})})()`), 'Canvas SVG export keeps the PDF vector geometry');
  const scaleBefore = await read();
  check((await tool({ action: 'apply', illustration_id: scaleBefore.illustration_id, expected_revision: scaleBefore.revision,
    request_id: randomUUID(), operations: [{ op: 'update', id: pdfVector.id, patch: { width: 1760, height: 720 } }] })).ok, 'Scale the vector structure proportionally');
  after = await wait(doc => doc.objects.at(-1).width === 1760);
  check(after.objects.at(-1).svg === pdfVector.svg, 'Enlarging a pasted chemical vector eightfold never resamples or rewrites its source');
  await evaluate('illustrationWorkspace.history("undo")'); await pause(60);
  const exported = await evaluate(`(async()=>{const {exportPowerPoint}=await import('./powerpoint.mjs');const data=await exportPowerPoint(illustrationWorkspace.getDocument());const zip=await JSZip.loadAsync(data,{base64:true});const files=Object.keys(zip.files).filter(name=>name.endsWith('.svg'));const sources=await Promise.all(files.map(name=>zip.file(name).async('string')));return sources.some(source=>source.includes(${JSON.stringify(pdfVector.svg.match(/d="[^"]+"/)[0])})&&!source.includes('<image'))})()`);
  check(exported, 'PowerPoint export embeds the chemical drawing as SVG rather than flattening it');
  await fs.writeFile(path.join(temp, 'chemical-vector-canvas.png'), (await win.webContents.capturePage()).toPNG());
  after = await read();
  before = after;
  await evaluate('window.qaChemicalBeforeReload=true;location.reload()');
  for (let i = 0; i < 100; i++) {
    if (await evaluate('!window.qaChemicalBeforeReload && Boolean(window.illustrationWorkspace?.getDocument())').catch(() => false)) break;
    await pause(30);
  }
  await evaluate('illustrationWorkspace.ready.then(()=>true)');
  check(JSON.stringify((await read()).objects) === JSON.stringify(before.objects), 'Chemical structure bytes and metadata survive plugin reload');
}

module.exports = { verifyChemicalPaste };
