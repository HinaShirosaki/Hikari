// Regression probes use the existing isolated host and its real MCP transport.
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

async function verifyPlacement({ tool, evaluate, check, win, pause, temp }) {
  win.setSize(1300, 1000); await pause(100);
  let current;
  const apply = async operations => {
    current = await tool({ action: 'read' });
    current = await tool({ action: 'apply', illustration_id: current.illustration_id, expected_revision: current.revision, request_id: randomUUID(), operations });
    check(current.ok, current.error || 'Placement edit saved');
    await pause(40);
    return current;
  };
  const replace = async objects => {
    current = await tool({ action: 'read' });
    await apply([...current.objects.map(object => ({ op: 'delete', id: object.id })), ...objects.map(object => ({ op: 'upsert', object }))]);
  };
  const svg = (body, attributes = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" ${attributes}>${body}</svg>`;
  const geometry = id => evaluate(`(() => {
    const canvas=document.querySelector('#main-canvas > svg'), group=canvas.querySelector('[data-object-id="${id}"]');
    const shape=group.querySelector('svg').querySelector('circle,rect');
    const matrix=canvas.getScreenCTM().inverse().multiply(shape.getScreenCTM()), box=shape.getBBox();
    const points=[[box.x,box.y],[box.x+box.width,box.y],[box.x,box.y+box.height],[box.x+box.width,box.y+box.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(matrix));
    return {x:Math.min(...points.map(p=>p.x)),y:Math.min(...points.map(p=>p.y)),width:Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)),height:Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y))};
  })()`);
  const boundsMatch = (actual, expected) => ['x', 'y', 'width', 'height'].every(key => Math.abs(actual[key] - expected[key]) < 0.001);
  const preview = async () => {
    const rendered = await tool({ action: 'render', canvas: 'main' });
    check(rendered.ok, rendered.error || 'MCP preview rendered');
    const image = rendered.content.find(item => item.type === 'image');
    return `data:${image.mimeType};base64,${image.data}`;
  };
  const pixels = async points => evaluate(`(async () => {
    const image=new Image();image.src=${JSON.stringify(await preview())};await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
    return ${JSON.stringify(points)}.map(([x,y])=>[...ctx.getImageData(x,y,1,1).data]);
  })()`);

  for (const aspect of ['', 'preserveAspectRatio="xMidYMid meet"', 'preserveAspectRatio="none"']) {
    await replace([{ id: 'aspect', type: 'vector', x: 50, y: 50, width: 200, height: 100,
      svg: svg('<circle cx="50" cy="50" r="40" fill="#ff0000"/>', aspect) }]);
    const expected = aspect.endsWith('"none"') ? { x: 70, y: 60, width: 160, height: 80 } : { x: 110, y: 60, width: 80, height: 80 };
    const actual = await geometry('aspect');
    check(boundsMatch(actual, expected), `SVG preserves requested/default aspect ratio: ${JSON.stringify({ aspect, actual, expected })}`);
  }
  await replace([{ id: 'coordinate-control', type: 'vector', x: 150, y: 180, width: 200, height: 100, rotation: 90,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -20 100 50"><rect x="-10" y="-20" width="100" height="50" fill="#ff0000"/></svg>' }]);
  check(boundsMatch(await geometry('coordinate-control'), { x: 200, y: 130, width: 100, height: 200 }), 'Nonzero viewBox origin and rotation preserve exact canvas coordinates');

  await replace([{ id: 'rotated', type: 'vector', x: 350, y: 250, width: 160, height: 120, rotation: 37, svg: svg('<rect width="100" height="100" fill="#ff0000"/>') }]);
  await evaluate('document.querySelector("[data-layer-id=rotated] .layer-select").click()'); await pause(60);
  const corners = () => evaluate(`(() => {
    const group=document.querySelector('#main-canvas [data-object-id=rotated]'),matrix=group.getScreenCTM(),box=group.querySelector('.object-hit');
    return [new DOMPoint(0,0),new DOMPoint(Number(box.getAttribute('width')),Number(box.getAttribute('height')))].map(p=>p.matrixTransform(matrix)).map(p=>({x:p.x,y:p.y}));
  })()`);
  const before = await corners();
  win.webContents.debugger.attach('1.3');
  try {
    const mouse = async (type, x, y, buttons = 0) => {
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
      await pause(30);
    };
    await mouse('mouseMoved', before[1].x, before[1].y);
    await mouse('mousePressed', before[1].x, before[1].y, 1);
    await mouse('mouseMoved', before[1].x + 30, before[1].y + 18, 1);
    await mouse('mouseReleased', before[1].x + 30, before[1].y + 18);
  } finally { win.webContents.debugger.detach(); }
  await pause(80);
  const after = await corners();
  check(Math.hypot(after[0].x - before[0].x, after[0].y - before[0].y) < 0.1
    && Math.hypot(after[1].x - before[1].x - 30, after[1].y - before[1].y - 18) < 0.1, 'Rotated resize fixes the opposite corner and follows the pointer');
  current = await tool({ action: 'read' }); const original = current.objects[0];
  await apply([{ op: 'transfer', id: 'rotated', canvas: 'scratch', copy: true, new_id: 'rotated-copy' }]);
  const copied = current.objects.find(object => object.id === 'rotated-copy');
  check(['x', 'y', 'width', 'height', 'rotation'].every(key => original[key] === copied[key]), 'Scratch transfer preserves exact geometry');

  await replace([
    { id: 'cell-part', type: 'vector', x: 50, y: 50, width: 100, height: 100, svg: svg('<defs><clipPath id="outline"><rect width="50" height="100"/></clipPath></defs><rect width="100" height="100" fill="#ff0000" clip-path="url(#outline)"/>') },
    { id: 'cell', type: 'vector', x: 250, y: 50, width: 100, height: 100, svg: svg('<defs><clipPath id="part-outline"><rect x="50" width="50" height="100"/></clipPath></defs><rect width="100" height="100" fill="#0000ff" clip-path="url(#part-outline)"/>') },
    { id: 'preview-cell', type: 'vector', x: 400, y: 50, width: 100, height: 100, svg: svg('<defs><linearGradient id="part-outline"><stop stop-color="#ff0000"/><stop offset="1" stop-color="#ff0000"/></linearGradient></defs><rect width="100" height="100" fill="url(#part-outline)"/>') }
  ]);
  check(await evaluate('(()=>{const ids=[...document.querySelectorAll("[id]")].map(n=>n.id);return new Set(ids).size===ids.length})()'), 'Canvas objects, clip paths, gradients and thumbnails have unique DOM IDs');
  check(JSON.stringify(await pixels([[275, 75], [325, 75], [425, 75]])) === JSON.stringify([[255,255,255,255], [0,0,255,255], [255,0,0,255]]), 'Independent clip paths and gradients paint the intended regions');

  for (const [fontWeight, italic] of [[400, false], [700, true]]) {
    await replace([{ id: 'font-review', type: 'text', x: 50, y: 50, width: 800, height: 200, fontFamily: 'Inter', fontSize: 80, fontWeight, italic, text: 'iiiiiiiiWWWW', color: '#000000' }]);
    const imageUrl = await preview();
    const capture = await evaluate(`(() => {
      const text=document.querySelector('#main-canvas [data-object-id=font-review] text'),rect=text.getBoundingClientRect(),matrix=text.getScreenCTM();
      return {x:Math.floor(rect.x)-4,y:Math.floor(rect.y)-4,width:Math.ceil(rect.right)-Math.floor(rect.x)+8,height:Math.ceil(rect.bottom)-Math.floor(rect.y)+8,scale:Math.hypot(matrix.a,matrix.b)};
    })()`);
    const { scale, ...captureRect } = capture;
    const liveImage = await win.webContents.capturePage(captureRect);
    const metrics = await evaluate(`(async () => {
      const ink=async url=>{const image=new Image();image.src=url;await image.decode();
        const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
        const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;let left=canvas.width,right=-1,top=canvas.height,bottom=-1;
        for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const i=(y*canvas.width+x)*4;if(data[i+3]>100&&data[i]<100&&data[i+1]<100&&data[i+2]<100){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y)}}
        return {width:right-left+1,height:bottom-top+1,imageWidth:image.width};};
      const live=await ink(${JSON.stringify(liveImage.toDataURL())}),preview=await ink(${JSON.stringify(imageUrl)});
      const factor=live.imageWidth/${capture.width}*${scale};
      const text=document.querySelector('#main-canvas [data-object-id=font-review] text');
      return {liveWidth:live.width/factor,liveHeight:live.height/factor,previewWidth:preview.width,previewHeight:preview.height,opticalSizing:getComputedStyle(text).fontOpticalSizing};
    })()`);
    check(metrics.opticalSizing === 'none' && Math.abs(metrics.liveWidth - metrics.previewWidth) <= 2 && Math.abs(metrics.liveHeight - metrics.previewHeight) <= 2,
      `Inter preview matches the painted live text (${fontWeight}, italic=${italic}): ${JSON.stringify(metrics)}`);
    await fs.writeFile(path.join(temp, `font-${fontWeight}-live.png`), liveImage.toPNG());
    const exported = await evaluate('illustrationWorkspace.exportSvg("main")');
    check(exported.includes('data:font/woff2;base64,') && exported.includes('<text') && exported.includes('iiiiiiiiWWWW'), 'Export embeds Inter and preserves editable text');
    await fs.writeFile(path.join(temp, `font-${fontWeight}.svg`), exported);
  }

  await replace([
    { id: 'color-review', type: 'vector', x: 50, y: 50, width: 100, height: 100, svg: svg('<rect width="100" height="100" fill="currentColor"/>') },
    { id: 'explicit-color', type: 'vector', x: 250, y: 50, width: 100, height: 100, svg: svg('<rect width="100" height="100" fill="currentColor"/>', 'color="#ff0000"') }
  ]);
  for (const mode of ['day', 'night']) {
    await win.webContents.executeJavaScript(`qaState.settings.appearance={mode:${JSON.stringify(mode)},fontSize:16};qaBridge.broadcastAppContext("appearance")`); await pause(50);
    const fills = await evaluate('["color-review","explicit-color"].map(id=>getComputedStyle(document.querySelector(`#main-canvas [data-object-id="${id}"] svg rect`)).fill)');
    check(JSON.stringify(fills) === JSON.stringify(['rgb(0, 0, 0)', 'rgb(255, 0, 0)'])
      && JSON.stringify(await pixels([[100,100], [300,100]])) === JSON.stringify([[0,0,0,255], [255,0,0,255]]), `currentColor matches MCP preview in ${mode} mode, including explicit SVG color`);
  }
  await replace(['prompt', 'complexity', 'status', 'main-canvas', 'properties'].map((id, index) => ({ id, type: 'vector', x: index * 150, y: 50, width: 100, height: 100, svg: svg('<rect width="100" height="100" fill="#ff0000"/>') })));
  check(await evaluate('document.getElementById("prompt").tagName==="TEXTAREA" && document.getElementById("complexity").tagName==="SELECT" && document.getElementById("properties").tagName==="FORM"'), 'Logical item IDs cannot shadow editor controls');
  check(await evaluate('(()=>{const ids=[...document.querySelectorAll("[id]")].map(n=>n.id);return new Set(ids).size===ids.length})()'), 'User-facing IDs remain unique after placing reserved-name objects');
  const requests = await win.webContents.executeJavaScript('qaRequests.length');
  await evaluate('document.getElementById("prompt").value="Move the rectangle";document.getElementById("prompt-form").requestSubmit()');
  for (let i = 0; i < 50 && await win.webContents.executeJavaScript('qaRequests.length') === requests; i += 1) await pause(50);
  check(await win.webContents.executeJavaScript('qaRequests.length') === requests + 1, 'Agent chat still submits after an item is named prompt');
}

module.exports = { verifyPlacement };
