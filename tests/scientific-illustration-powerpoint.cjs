const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

async function verifyPowerPoint({ tool, evaluate, check, win, pause, temp }) {
  const read = () => tool({ action: 'read', include_assets: true });
  let current = await read();
  const bytes = await evaluate(`(()=>{const canvas=document.createElement('canvas');canvas.width=160;canvas.height=100;const ctx=canvas.getContext('2d');ctx.fillStyle='#247a72';ctx.fillRect(8,8,144,84);return {png:canvas.toDataURL('image/png'),webp:canvas.toDataURL('image/webp')}})()`);
  const vector = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g"><stop stop-color="#b7dfcc"/><stop offset="1" stop-color="#5a8b72"/></linearGradient><clipPath id="c"><circle cx="50" cy="50" r="46"/></clipPath></defs><rect width="100" height="100" fill="url(#g)" clip-path="url(#c)"/></svg>';
  const result = await tool({ action: 'apply', illustration_id: current.illustration_id, expected_revision: current.revision, request_id: randomUUID(), operations: [
    { op: 'title', title: 'Figura PPTX editable fixture' },
    { op: 'canvas', canvas: 'main', patch: { width: 1200, height: 800, background: '#f7fafc' } },
    { op: 'upsert', object: { id: 'cell', name: 'Cell & membrane', type: 'vector', svg: vector, x: 160, y: 160, width: 240, height: 180, rotation: -15, opacity: 0.625 } },
    { op: 'upsert', object: { id: 'cell-label', name: 'Cell label', type: 'text', text: 'Cell & receptor\nα < β', x: 160, y: 350, width: 300, height: 70, fontFamily: 'Arial', fontSize: 24, fontWeight: 700, align: 'middle', anchor: 'top' } },
    { op: 'upsert', object: { id: 'arrow', name: 'Arrow', type: 'vector', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 30"><path d="M5 15h75M65 5l15 10-15 10" fill="none" stroke="#000000" stroke-width="4"/></svg>', stroke: '#cc6633', strokeWidth: 3, x: 440, y: 225, width: 180, height: 54 } },
    { op: 'upsert', object: { id: 'image', name: 'PNG component', type: 'raster', dataUrl: bytes.png, textFree: true, x: 660, y: 160, width: 240, height: 150, opacity: 0.8, rotation: 10 } },
    { op: 'upsert', object: { id: 'webp', name: 'WebP component', type: 'raster', dataUrl: bytes.webp, textFree: true, x: 660, y: 410, width: 240, height: 150 } },
    { op: 'upsert', object: { id: 'rotated-label', name: 'Editable rotated label', type: 'text', text: 'Separate editable text', fontFamily: 'Arial', fontSize: 28, fontWeight: 400, italic: true, underline: true, align: 'end', anchor: 'middle', color: '#11223380', opacity: 0.8, x: -24, y: 630, width: 480, height: 90, rotation: 15 } },
    { op: 'upsert', object: { id: 'hidden-label', name: 'Hidden label', type: 'text', text: 'SHOULD NOT EXPORT', visible: false } },
    { op: 'upsert', object: { id: 'scratch-label', name: 'Scratch label', type: 'text', text: 'SCRATCH ONLY', canvas: 'scratch' } },
    { op: 'group', id: 'cell-group', name: 'Cell component', ids: ['cell', 'cell-label'] }
  ] });
  check(result.ok, result.error || 'Save PPTX fixture'); await pause(80);
  current = await read();
  check(await evaluate('!window.PptxGenJS'), 'The PowerPoint dependency loads only when exporting');
  await evaluate('document.getElementById("export-menu").open=true;document.getElementById("export-pptx").click()');
  for (let i = 0; i < 200; i++) { if (await evaluate('document.getElementById("status").textContent==="Exported PPTX"')) break; await pause(50); }
  check(await evaluate('document.getElementById("status").textContent==="Exported PPTX"'), await evaluate('document.getElementById("status").textContent'));
  check(await evaluate('!document.getElementById("export-pptx").disabled && !document.getElementById("export-svg").disabled'), 'Export controls recover after saving');
  const file = path.join(temp, 'Figura_PPTX_editable_fixture.pptx');
  const data = await fs.readFile(file);
  check(data.subarray(0, 2).toString() === 'PK', 'The real downloads IPC saves a PPTX archive');
  const parts = await evaluate(String.raw`(async()=>{
    const zip=await JSZip.loadAsync(${JSON.stringify(data.toString('base64'))},{base64:true});
    const parse=async name=>new DOMParser().parseFromString(await zip.file(name).async('string'),'application/xml');
    const slide=await parse('ppt/slides/slide1.xml'), pres=await parse('ppt/presentation.xml');
    const ns='http://schemas.openxmlformats.org/presentationml/2006/main',drawing='http://schemas.openxmlformats.org/drawingml/2006/main';
    const tree=slide.getElementsByTagNameNS(ns,'spTree')[0];
    const objects=[...tree.children].filter(n=>['sp','pic'].includes(n.localName)).map(node=>{
      const props=node.getElementsByTagNameNS(ns,'cNvPr')[0],transform=node.getElementsByTagNameNS(drawing,'xfrm')[0];
      const off=transform?.getElementsByTagNameNS(drawing,'off')[0],extent=transform?.getElementsByTagNameNS(drawing,'ext')[0];
      const run=node.getElementsByTagNameNS(drawing,'rPr')[0],body=node.getElementsByTagNameNS(drawing,'bodyPr')[0];
      return {kind:node.localName,name:props.getAttribute('name'),text:[...node.getElementsByTagNameNS(drawing,'t')].map(n=>n.textContent).join('\n'),
        x:Number(off?.getAttribute('x')),y:Number(off?.getAttribute('y')),w:Number(extent?.getAttribute('cx')),h:Number(extent?.getAttribute('cy')),rotation:Number(transform?.getAttribute('rot')||0),
        fontSize:run?.getAttribute('sz'),bold:run?.getAttribute('b'),italic:run?.getAttribute('i'),underline:run?.getAttribute('u'),anchor:body?.getAttribute('anchor'),
        lineSpacing:node.getElementsByTagNameNS(drawing,'spcPts')[0]?.getAttribute('val'),
        alpha:node.getElementsByTagNameNS(drawing,'alphaModFix')[0]?.getAttribute('amt'),
        svg:node.getElementsByTagNameNS('http://schemas.microsoft.com/office/drawing/2016/SVG/main','svgBlip').length>0};
    });
    const media={};for(const name of Object.keys(zip.files).filter(name=>/^ppt\/media\/.*\.(svg|png)$/.test(name)))media[name]=await zip.file(name).async('base64');
    const size=pres.getElementsByTagNameNS(ns,'sldSz')[0];
    return {objects,media,width:Number(size.getAttribute('cx')),height:Number(size.getAttribute('cy')),slides:Object.keys(zip.files).filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name)),invalid:slide.querySelector('parsererror')!==null};
  })()`);
  check(parts.slides.length === 1 && !parts.invalid, 'One well-formed slide contains the main canvas');
  check(parts.width === 1200 * 9525 && parts.height === 800 * 9525, 'PPTX preserves the canvas aspect and physical scale');
  check(parts.objects.length === 6 && parts.objects.filter(o => o.kind === 'sp').length === 2 && parts.objects.filter(o => o.kind === 'pic').length === 4, 'Artwork and native text export as six separate selectable components');
  check(parts.objects.map(o => o.name).join('|') === 'Cell & membrane|Cell label|Arrow|PNG component|WebP component|Editable rotated label', 'Names, grouped member independence and paint order survive export');
  const cell = parts.objects[0], label = parts.objects[1], image = parts.objects[3], rotated = parts.objects[5];
  check(cell.svg && parts.objects[2].svg, 'SVG components retain vector media in PowerPoint');
  check(cell.x === 160 * 9525 && cell.y === 160 * 9525 && cell.w === 240 * 9525 && cell.h === 180 * 9525 && cell.rotation === 345 * 60000, 'Independent vector placement, stretch and rotation match the figure');
  check(cell.alpha === '62500' && image.alpha === '80000', 'Layer opacity stays adjustable outside the source image');
  check(label.text === 'Cell & receptor\nα < β' && label.fontSize === '1800' && label.bold === '1' && label.lineSpacing === '2160', 'Unicode multiline labels remain native editable text with fixed canvas line spacing, font size and weight');
  check(rotated.x === -24 * 9525 && rotated.rotation === 15 * 60000 && rotated.italic === '1' && rotated.underline && rotated.anchor === 'ctr', 'Signed text placement, rotation, alignment and emphasis remain native');
  const svgs = Object.entries(parts.media).filter(([name]) => name.endsWith('.svg')).map(([, bytes]) => Buffer.from(bytes, 'base64').toString());
  check(svgs.length === 2 && svgs.some(svg => svg.includes('linearGradient') && svg.includes('clipPath')) && svgs.some(svg => svg.includes('#cc6633')), 'Gradient/clip artwork and manual stroke overrides remain in SVG media');
  const pngs = Object.values(parts.media).filter(bytes => bytes.startsWith('iVBOR'));
  check(pngs.length >= 4 && pngs.includes(current.objects.find(object => object.id === 'image').dataUrl.split(',')[1]), 'Placed PNG raster bytes and real SVG fallback previews are embedded');
  check(JSON.stringify((await read()).objects) === JSON.stringify(current.objects) && (await read()).revision === current.revision, 'Export preserves source artwork, groups and revision');
  await fs.writeFile(path.join(temp, 'pptx-structure.json'), JSON.stringify(parts, null, 2));
  await evaluate(`import('./artwork.mjs').then(async m=>{window.pptxReference=(await m.renderPreview(illustrationWorkspace.getDocument(),'main',1200)).data_url})`);
  await fs.writeFile(path.join(temp, 'pptx-reference.png'), Buffer.from((await evaluate('window.pptxReference')).split(',')[1], 'base64'));
  check(await evaluate(`import('./artwork.mjs').then(m=>{const object=illustrationWorkspace.getDocument().objects.find(o=>o.id==='cell');const svg=new DOMParser().parseFromString(m.componentSvgSource({...object,width:8000,height:4000}),'image/svg+xml').documentElement;return svg.getAttribute('width')==='2048'&&svg.getAttribute('height')==='1024'&&svg.getAttribute('viewBox')==='0 0 8000 4000'})`), 'Large vector components retain vector resolution with bounded fallback preview memory');
  for (const width of [1300, 480, 320]) {
    win.setSize(width, 850); await pause(80);
    await evaluate('document.getElementById("export-menu").open=true');
    check(await evaluate('(()=>{const r=document.querySelector("#export-menu .popover-panel").getBoundingClientRect(),b=document.getElementById("export-pptx").getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&b.width>0&&document.documentElement.scrollWidth<=innerWidth})()'), `${width}px keeps PowerPoint export available in the existing menu`);
    await fs.writeFile(path.join(temp, `pptx-export-${width}.png`), (await win.webContents.capturePage()).toPNG());
    await evaluate('document.getElementById("export-menu").open=false');
  }
  win.setSize(1300, 1000);
  const host = code => win.webContents.executeJavaScript(code);
  for (const mode of ['cancel', 'fail', '']) {
    await host(`window.qaExportDialogMode=${JSON.stringify(mode)}`);
    await evaluate('document.getElementById("export-pptx").click()');
    const expected = mode === 'cancel' ? 'Export canceled' : mode === 'fail' ? 'Injected export disk failure' : 'Exported PPTX';
    for (let i = 0; i < 200; i++) { if (await evaluate('!document.getElementById("export-pptx").disabled')) break; await pause(30); }
    check(await evaluate(`!document.getElementById('export-pptx').disabled && document.getElementById('status').textContent.includes(${JSON.stringify(expected)})`), `${mode || 'retry'} restores the Export controls with an accurate result`);
    check((await read()).revision === current.revision, `${mode || 'retry'} leaves saved artwork unchanged`);
  }
}
module.exports = { verifyPowerPoint };
