const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function verifyPlotly({ tool, evaluate, check, win, pause, temp }) {
  const read = () => tool({ action: 'read', include_assets: true });
  const apply = async operations => {
    const current = await read();
    return tool({ action: 'apply', illustration_id: current.illustration_id, expected_revision: current.revision, request_id: randomUUID(), operations });
  };
  const data = [{ type: 'scatter', x: [0, 1, 2, 3], y: [2, 4, 3, 7], mode: 'lines+markers', name: 'Measured response', error_y: { type: 'data', array: [0.2, 0.4, 0.3, 0.5], visible: true }, line: { color: '#247a91' } }];
  const layout = { title: { text: 'Measured response over time' }, xaxis: { title: { text: 'Time (min)' } }, yaxis: { title: { text: 'Response (a.u.)' } }, margin: { l: 105, r: 45, t: 90, b: 95 }, font: { size: 26 } };
  let result = await apply([
    { op: 'canvas', canvas: 'main', patch: { width: 3840, height: 2160 } },
    { op: 'upsert', object: { id: 'response', name: 'Response plot', type: 'plot', x: 200, y: 200, width: 1400, height: 950, plotly: { data, layout, source: 'Fixture observations; error bars are supplied SD values, not inferred.' } } },
    { op: 'upsert', object: { id: 'caption', name: 'Panel label', type: 'text', text: 'A', x: 180, y: 110, fontSize: 64 } }
  ]);
  check(result.ok, result.error || 'The public canvas operation creates a Plotly layer');
  let current = await read(), plot = current.objects.find(o => o.id === 'response');
  check(plot.type === 'plot' && JSON.stringify(plot.plotly.data) === JSON.stringify(data), 'Plotly preserves the exact observations and error bars');
  check(plot.svg.includes('Time (min)') && plot.svg.includes('Response (a.u.)') && !plot.svg.includes('<script'), 'The cached chart contains real Plotly axes and safe SVG text');
  check(await win.webContents.executeJavaScript('Boolean(window.Plotly?.version)'), 'The host uses the existing vendored Plotly library');
  check(await evaluate('document.querySelectorAll("#main-canvas [data-object-id=response] svg text").length>4'), 'The plot renders as vector artwork with chart labels on the actual Figura canvas');
  check((await tool({ action: 'render', canvas: 'main', illustration_id: current.illustration_id })).content.some(item => item.type === 'image'), 'MCP render includes the data plot');
  await fs.writeFile(path.join(temp, 'plotly-scatter.svg'), await evaluate('illustrationWorkspace.exportSvg("main")'));
  await evaluate('document.getElementById("layers-tab").click()'); await pause(80);
  await fs.writeFile(path.join(temp, 'plotly-canvas.png'), (await win.webContents.capturePage()).toPNG());

  const before = current.revision;
  result = await apply([{ op: 'update', id: 'response', patch: { plotly: { data: [{ type: 'scattergeo', lat: [1], lon: [2] }], layout: {} } } }]);
  check(!result.ok && (await read()).revision === before, 'Unsupported remote-map traces fail atomically without changing the saved figure');
  await win.webContents.executeJavaScript(`window.qaOriginalPlotlyNewPlot=Plotly.newPlot;Plotly.newPlot=async function(...args){const g=await qaOriginalPlotlyNewPlot.apply(this,args);window.qaPlotlyBins=g.calcdata?.[0]?.map(d=>({position:d.p,count:d.s}));return g};true`);
  try {
    result = await apply([{ op: 'upsert', object: { id: 'histogram', name: 'Raw-data histogram', type: 'plot', x: 1850, y: 200, width: 1400, height: 950,
      plotly: { data: [{ type: 'histogram', x: [1, 1, 2, 2, 2, 3], xbins: { start: 0.5, end: 3.5, size: 1 }, marker: { color: '#c28b34' } }],
        layout: { title: { text: 'Raw observation counts' }, xaxis: { title: { text: 'Observed value' } }, yaxis: { title: { text: 'Count' } }, font: { size: 26 } }, source: 'Six raw observations; Plotly bins them, with expected counts 2, 3 and 1.' } } }]);
    check(result.ok, result.error || 'Plotly accepts raw observations for a histogram');
    const bins = await win.webContents.executeJavaScript('qaPlotlyBins');
    check(JSON.stringify(bins.map(bin => bin.count)) === '[2,3,1]', `The vendored Plotly engine processes raw data into correct counts: ${JSON.stringify(bins)}`);
  } finally { await win.webContents.executeJavaScript('Plotly.newPlot=qaOriginalPlotlyNewPlot;delete qaOriginalPlotlyNewPlot'); }
  result = await apply([{ op: 'upsert', object: { id: 'heatmap', name: 'Measured matrix', type: 'plot', x: 200, y: 1300, width: 1400, height: 700,
    plotly: { data: [{ type: 'heatmap', x: ['Control', 'Treatment'], y: ['Sample 1', 'Sample 2'], z: [[1, 2], [3, 4]], colorscale: 'Viridis' }],
      layout: { title: { text: 'Measured matrix' }, xaxis: { title: { text: 'Condition' } }, yaxis: { title: { text: 'Sample' } }, font: { size: 26 } }, source: 'Exact supplied 2 by 2 matrix.' } } }]);
  check(result.ok, result.error || 'Heatmaps render from measured matrix values');
  const heatmap = (await read()).objects.find(o => o.id === 'heatmap');
  check(heatmap.svg.includes('data:image/png;base64,') && !/\sstyle=/.test(heatmap.svg), 'Heatmap pixels are self-contained and inline CSS is removed before reaching the strict plugin frame');
  check(/image-rendering="(?:pixelated|crisp-edges)"/.test(heatmap.svg), 'Discrete heatmap cells retain Plotly’s nearest-neighbour rendering');
  check(await evaluate('(()=>{const s=document.querySelector("#main-canvas [data-object-id=heatmap] svg"),r=s.getBoundingClientRect();return [...s.querySelectorAll("text")].every(t=>{const b=t.getBoundingClientRect();return b.left>=r.left-1&&b.right<=r.right+1&&b.top>=r.top-1&&b.bottom<=r.bottom+1})})()'), 'Automatic axis margins keep heatmap labels inside the plot bounds');
  check(await evaluate('(async()=>{const {validateSvg}=await import("./artwork.mjs");const bad=[\'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script></svg>\',\'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="https://example.com/image.png"/></svg>\'];return bad.every(source=>{try{validateSvg(source,{plot:true});return false}catch{return true}})})()'), 'Plot SVG validation still rejects executable content and external image references');
  const pasted = await evaluate('(async()=>{const {copyComponents}=await import("./clipboard.mjs");const {validateSvg}=await import("./artwork.mjs");const w=illustrationWorkspace;return w.paste(copyComponents(w.getDocument(),["response"],validateSvg),{illustrationId:w.getLibrary().active_illustration_id,canvas:"main"})})()');
  check(pasted.ok && pasted.pasted_ids.length === 1, 'Copy/paste creates a new editable data plot');
  check(JSON.stringify((await read()).objects.find(o => o.id === pasted.pasted_ids[0]).plotly.data) === JSON.stringify(data), 'Pasted plots preserve exact source observations');
  await apply(pasted.pasted_ids.map(id => ({ op: 'delete', id })));
  current = await read();
  const assets = await tool({ action: 'asset_list' });
  const asset = await tool({ action: 'asset_save', illustration_id: current.illustration_id, expected_revision: current.revision,
    expected_assets_revision: assets.assets_revision, request_id: randomUUID(), id: 'response', name: 'Measured response plot' });
  check(asset.ok, asset.error || 'A plot saves as a reusable data-backed component');
  const inserted = await apply([{ op: 'insert_asset', asset_id: asset.asset_id, canvas: 'main', x: 1850, y: 1300, width: 1050 }]);
  check(inserted.ok, inserted.error || 'The reusable plot inserts with independent data and layout');
  current = await read();
  const svgBefore = current.objects.find(o => o.id === 'response').svg;
  check((await apply([{ op: 'update', id: 'response', patch: { width: 1600 } }])).ok, 'Resizing regenerates the plot from its data');
  check((await read()).objects.find(o => o.id === 'response').svg !== svgBefore, 'The resized plot has a new Plotly viewport rather than distorted labels');
  await evaluate('illustrationWorkspace.history("undo")');
  check((await read()).objects.find(o => o.id === 'response').width === 1400, 'Undo restores plot data, geometry and rendered snapshot');
  await evaluate('location.reload()'); await pause(400);
  await evaluate('illustrationWorkspace.ready.then(()=>true)');
  current = await read();
  check(current.ok, current.error || 'The reloaded plot workspace is ready');
  check(current.objects.filter(o => o.type === 'plot').length === 4 && current.objects.find(o => o.id === 'response').plotly.data[0].y[3] === 7, 'Plot data, reusable copies and cached renders survive reloading the installed plugin');
  const full = await evaluate('(async()=>{const {renderPreview}=await import("./artwork.mjs");return renderPreview(illustrationWorkspace.getDocument(),"main",8000)})()');
  check(full.width === 3840 && full.height === 2160, 'Data plots export at the full 4K canvas size');
  await fs.writeFile(path.join(temp, 'plotly-full.png'), Buffer.from(full.data_url.split(',')[1], 'base64'));
  await fs.writeFile(path.join(temp, 'plotly-final.svg'), await evaluate('illustrationWorkspace.exportSvg("main")'));
  await evaluate('document.getElementById("export-pptx").click()');
  for (let i = 0; i < 160 && await evaluate('document.getElementById("status").textContent!=="Exported PPTX"'); i++) await pause(50);
  check(await evaluate('document.getElementById("status").textContent==="Exported PPTX"'), 'PowerPoint export accepts separate plot SVGs and native figure text');
}
module.exports = { verifyPlotly };
