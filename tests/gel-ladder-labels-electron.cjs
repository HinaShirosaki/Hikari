'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

async function main() {
  if (!process.versions.electron) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-gel-ladder-labels-'));
    try {
      const result = require('node:child_process').spawnSync(require('electron'), [__filename, temp], { encoding: 'utf8', timeout: 90000 });
      process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
      assert.equal(result.status, 0, String(result.error || result.signal || result.stderr));
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
    return;
  }
  const { app, BrowserWindow } = require('electron');
  const temp = process.argv[2]; app.setPath('userData', path.join(temp, 'profile')); await app.whenReady();
  const plugin = process.env.HIKARI_GEL_TEST_PLUGIN || path.join(root, 'src/plugins/gel');
  const url = file => pathToFileURL(path.join(plugin, file)).href;
  const styles = ['vendor/cropperjs/cropper.min.css','vendor/tabulator/tabulator.min.css','vendor/css/base/palette.css','vendor/css/base/core.css',
    'vendor/css/themes/modes.css','vendor/css/views/gel-palette.css','vendor/css/views/gel-view.css','vendor/css/overrides/cross-view-fixes.css',
    'vendor/css/overrides/left-rail-template.css','vendor/css/overrides/folder-tree-template.css','vendor/css/overrides/universal-left-rail-lists.css',
    'vendor/css/overrides/universal-dialogs.css','style.css','floating-workspace.css'];
  const markup = fs.readFileSync(path.join(plugin,'vendor/gel-view.html'),'utf8').replace('class="view"','class="view is-active"');
  const fixture = path.join(temp,'index.html');
  fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8">${styles.map(file=>`<link rel="stylesheet" href="${url(file)}">`).join('')}
    <script src="${url('vendor/cropperjs/cropper.min.js')}"></script><script src="${url('vendor/tabulator/tabulator.min.js')}"></script>
    <script src="${url('vendor/pptxgenjs/pptxgen.bundle.js')}"></script></head><body class="plugin-gel"><div>${markup}</div><script type="module">
    import {initGelAnalysis} from '${url('workspace/index.js')}';
    import {serializeBlotProject} from '${url('workspace/figure/project.js')}';
    import {createGelFigureCanvas,createGelImageCanvas} from '${url('workspace/rendering/figure-export.js')}';
    import {createGelPowerPoint} from '${url('workspace/rendering/powerpoint-export.js')}';
    import {createBlotFigureCanvas} from '${url('workspace/figure/render.js')}';
    import {createBlotFigurePowerPoint} from '${url('workspace/figure/powerpoint.js')}';
    import {buildLadderLabels} from '${url('workspace/rendering/ladder-labels.js')}';
    import {bytesToBase64} from '${url('workspace/export.js')}';
    window.el=id=>document.getElementById(id);window.click=id=>el(id).click();window.exports=[];
    window.hikariApi={storeImportedFile:async p=>({ok:true,filePath:p.targetFolder+'/'+p.fileName}),writeJsonFile:async p=>({ok:true,filePath:p.targetFolder+'/'+p.fileName}),
      exportBinaryFile:async p=>{exports.push(p);return {saved:true}}};
    window.gelState={gelAnalyses:[],settings:{storagePath:'.'}};
    window.controller=initGelAnalysis({state:gelState,persist:async()=>{},createId:()=>crypto.randomUUID(),safeText:v=>String(v??''),document});controller.render();
    window.toUrl=data=>{const c=document.createElement('canvas');c.width=data.width;c.height=data.height;c.getContext('2d').putImageData(data,0,0);return c.toDataURL()};
    const makeRow=(id,width,height,top,bottom,markers)=>{
      const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d');ctx.fillStyle='#eee';ctx.fillRect(0,0,width,height);
      for(const band of markers){ctx.fillStyle='#333';ctx.fillRect(12,band.pixelY-2,35,5);for(let lane=1;lane<5;lane++){ctx.fillStyle=lane%2?'#777':'#aaa';ctx.fillRect(lane*width/5+12,band.pixelY-2,35,5)}}
      const imageData=ctx.getImageData(0,0,width,height),gray=new Float32Array(width*height);for(let i=0;i<gray.length;i++)gray[i]=imageData.data[i*4]/255;
      const image={name:id+'.png',width,height,imageData,gray};return {id,label:id,placement:{first:10,last:90,top:top/height*100,bottom:bottom/height*100},
        draft:{controls:{'gel-name':id,'gel-type':'western','gel-ladder-preset':'biorad-precision-plus','gel-denoise-strength':'0','gel-contrast-strength':'100'},
          currentImage:image,originalImage:image,viewerMode:'original',cropApplied:false,currentReport:null,
          manualOverrides:{ladderLane:1,ladderBands:markers,laneSegmentation:{gelLeft:0,gelRight:width-1,dividers:[width*.2,width*.4,width*.6,width*.8],dividerDone:true,bandTop:top,bandBottom:bottom-1}}}};
    };
    window.rows=[makeRow('ERK',900,610,180,380,[{pixelY:60,mw:150},{pixelY:200,mw:75},{pixelY:276,mw:50},{pixelY:352,mw:37},{pixelY:550,mw:20}]),
      makeRow('Actin',500,400,100,240,[{pixelY:50,mw:100},{pixelY:130,mw:50},{pixelY:190,mw:37},{pixelY:350,mw:15}])];
    window.single=show=>createGelFigureCanvas({documentObject:document,imageData:rows[0].draft.currentImage.imageData,imageWidth:900,imageHeight:610,
      manualOverrides:rows[0].draft.manualOverrides,includeLadder:false,showLadderLabels:show,ladderPreset:'biorad-precision-plus',rasterScale:3});
    window.stack=show=>createBlotFigureCanvas(rows,document,{showLadderLabels:show,trim:{mode:'manual',left:12,right:88}});
    window.testExports=async()=>{
      const off=single(false),on=single(true),sOff=stack(false),sOn=stack(true),image=createGelImageCanvas({documentObject:document,imageData:rows[0].draft.currentImage.imageData,
        imageWidth:900,imageHeight:610,manualOverrides:rows[0].draft.manualOverrides,includeLadder:false,showLadderLabels:true});
      const ppt=await createGelPowerPoint({plan:image.plan,gelImageDataUrl:image.canvas.toDataURL()});
      const stackPpt=await createBlotFigurePowerPoint({...sOn,title:'Ladder labels'});
      const xml=async bytes=>(await JSZip.loadAsync(bytes)).file('ppt/slides/slide1.xml').async('string');
      const ctx=on.canvas.getContext('2d'),ticks=on.plan.ladderLabels.labels.map(label=>{
        const x=Math.floor((on.plan.labelWidth+on.plan.ladderLabels.width-3)*on.scale),y=Math.floor((on.plan.tableHeight+label.markerY)*on.scale);
        const pixel=ctx.getImageData(x,y,1,1).data;return {text:label.text,y:label.markerY,pixel:[...pixel]};});
      const dense=buildLadderLabels({manualOverrides:{ladderBands:[{pixelY:180,mw:100},{pixelY:181,mw:75},{pixelY:182,mw:50},{pixelY:183,mw:37}]},sourceTop:180,sourceHeight:5});
      const tilted=buildLadderLabels({manualOverrides:{ladderLane:1,ladderBands:[{pixelY:200,mw:75}],laneSegmentation:{laneVertices:[{laneIndex:1,
        topLeft:{x:0,y:100},topRight:{x:100,y:100},bottomLeft:{x:0,y:500},bottomRight:{x:100,y:500}}]}},sourceHeight:610});
      const unit=id=>buildLadderLabels({manualOverrides:rows[0].draft.manualOverrides,ladderPreset:id,sourceTop:180,sourceHeight:200}).labels[0].text;
      return {off:off.plan,on:on.plan,ticks,stackOff:sOff.plan,stackOn:sOn.plan,dense,tilted,gutter:[...ctx.getImageData(1,1,1,1).data],units:[unit('neb-100bp'),unit('neb-ssrna')],
        png:on.canvas.toDataURL(),stackPng:sOn.canvas.toDataURL(),ppt:bytesToBase64(ppt.bytes),stackPpt:bytesToBase64(stackPpt),xml:await xml(ppt.bytes),stackXml:await xml(stackPpt),layout:ppt.layout};
    };
    window.openProject=()=>{const content=serializeBlotProject(rows,'Labels',toUrl,{stackIds:rows.map(row=>row.id),selectedId:'stack'});
      const transfer=new DataTransfer();transfer.items.add(new File([content],'labels.json'));el('gel-figure-project-file').files=transfer.files;el('gel-figure-project-file').dispatchEvent(new Event('change'));};
    window.lastPng=async()=>{const image=new Image();image.src='data:image/png;base64,'+exports.at(-1).dataBase64;await image.decode();return {width:image.width,height:image.height}};
    window.ready=true;
    </script></body></html>`);
  const win = new BrowserWindow({width:1400,height:900,show:true,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
  const errors=[];win.webContents.on('console-message',event=>{if(event.level>=3)errors.push(event.message)});
  const exec=async code=>{
    const result=await win.webContents.executeJavaScript(`(async()=>{try{return {value:await eval(${JSON.stringify(code)})}}catch(error){return {error:error.stack}}})()`,true);
    if(result.error)throw new Error(result.error+'\nDuring: '+code);
    return result.value;
  };
  async function waitFor(code){for(let i=0;i<180;i++){if(await exec(code))return;await new Promise(r=>setTimeout(r,25))}throw new Error('Timeout: '+code+' '+errors.join('\n'))}
  const output=path.join(root,'artifacts/gel-ladder-labels');fs.mkdirSync(output,{recursive:true});
  try {
    await win.loadFile(fixture);win.focus();await waitFor('Boolean(window.ready)');
    const result=await exec('testExports()');
    assert.equal(result.off.ladderLabels.width,0,'Labels default to off');
    assert.deepEqual(result.on.ladderLabels.labels.map(label=>label.text),['75 kDa','50 kDa','37 kDa'],'Only marked ladder rows within the clip are exported');
    assert.equal(result.on.includeLadder,false,'Labels also work when the ladder lane itself is excluded');
    assert.equal(result.on.gelWidth,result.off.gelWidth,'Annotations leave source-image scale unchanged');
    assert.equal(result.on.canvasWidth,result.off.canvasWidth+result.on.ladderLabels.width,'Labels get their own gutter');
    assert.deepEqual(result.gutter,[255,255,255,255],'The annotation gutter is readable on any PNG viewer background');
    assert.ok(Math.abs(result.tilted.labels[0].markerY-(100+200/609*400+.5))<.001,'Manual lane vertices map the marked ladder row back to source-image position');
    for(const [i,tick] of result.ticks.entries()){
      assert.ok(tick.pixel[0]<30&&tick.pixel[3]>200,'Each PNG tick is drawn at its image row');
      const row=[200,276,352][i];
      assert.ok(Math.abs(tick.y-result.on.ladderLabels.imageTop-(row+.5-180))<.001,'Crop-relative tick coordinates preserve pixel centers');
    }
    assert.deepEqual(result.units,['75 bp','75 nt'],'Existing DNA/RNA ladder presets supply the unit');
    assert.deepEqual(result.stackOn.rows.map(row=>row.ladderLabels.labels.map(label=>label.text)),[['75 kDa','50 kDa','37 kDa'],['50 kDa','37 kDa']],'Stack rows use their own ladder and crop');
    for(const row of result.stackOn.rows){for(const marker of row.ladderLabels.labels)assert.ok(marker.markerY>=row.ladderLabels.imageTop&&marker.markerY<=row.ladderLabels.imageTop+row.imageHeight)}
    for(let i=1;i<result.dense.labels.length;i++)assert.ok(result.dense.labels[i].y-result.dense.labels[i-1].y>=result.dense.fontSize,'Dense label text does not overlap');
    for(const xml of [result.xml,result.stackXml]){
      assert.match(xml,/Ladder label 75 kDa/);assert.match(xml,/Ladder tick 37 kDa/);assert.doesNotMatch(xml,/Ladder label 150 kDa/);
      assert.match(xml,/<a:t>75 kDa<\/a:t>/,'MW labels are editable PowerPoint text');
    }
    const tickShapes=result.xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g);
    for(const label of result.on.ladderLabels.labels){
      const shape=tickShapes.find(xml=>xml.includes(`name="Ladder tick ${label.text}"`));
      const y=Number(shape.match(/<a:off[^>]* y="(\d+)"/)[1]);
      const expected=result.layout.annotationTop+label.markerY*result.layout.gelWidth/result.on.gelWidth;
      assert.ok(Math.abs(y-expected)<=2,'Editable PPT ticks align with the same crop-relative rows as PNG');
    }
    for(const [file,key] of [['individual.png','png'],['stack.png','stackPng'],['individual.pptx','ppt'],['stack.pptx','stackPpt']]){
      fs.writeFileSync(path.join(output,file),Buffer.from(result[key].replace(/^data:image\/png;base64,/,''),'base64'));
    }
    await exec('openProject()');await waitFor("el('gel-figure-status').textContent==='Figure project opened.'");
    assert.equal(await exec("el('gel-export-ladder-labels').checked"),false);
    const clean=await exec('controller.hasUnsavedChanges()');
    await exec("click('gel-export-menu-btn')");await waitFor("el('gel-export-menu').matches(':popover-open')");
    const toggle=await exec("el('gel-export-ladder-labels').getBoundingClientRect().toJSON()");
    for(const type of ['mouseDown','mouseUp'])win.webContents.sendInputEvent({type,button:'left',clickCount:1,x:Math.round(toggle.left+toggle.width/2),y:Math.round(toggle.top+toggle.height/2)});
    await waitFor("el('gel-export-ladder-labels').checked");
    assert.equal(await exec('controller.hasUnsavedChanges()'),clean,'Export options do not change the saved gel');
    fs.writeFileSync(path.join(output,'export-switch.png'),(await win.webContents.capturePage()).toPNG());
    await exec("click('gel-export-image-btn')");await waitFor('exports.length===1');
    const stackLabels=await exec('lastPng()');
    await exec("click('gel-export-ladder-labels');click('gel-export-image-btn')");await waitFor('exports.length===2');
    assert.ok(stackLabels.width>(await exec('lastPng()')).width,'Stack PNG export reads the optional switch');
    await exec("[...document.querySelectorAll('[data-figure-row]')].find(button=>button.textContent==='ERK').click()");
    await waitFor("el('gel-name').value==='ERK'&&!el('gel-export-image-btn').disabled");
    await exec("click('gel-export-image-btn')");await waitFor('exports.length===3');const individualOff=await exec('lastPng()');
    await exec("click('gel-export-ladder-labels');click('gel-export-image-btn')");await waitFor('exports.length===4');
    assert.ok((await exec('lastPng()')).width>individualOff.width,'Individual PNG export reads the same switch');
    await exec("click('gel-export-pptx-btn')");await waitFor('exports.length===5');
    const hasPptLabels="(async()=>{const zip=await JSZip.loadAsync(exports.at(-1).dataBase64,{base64:true});return (await zip.file('ppt/slides/slide1.xml').async('string')).includes('Ladder label 75 kDa')})()";
    assert.equal(await exec(hasPptLabels),true,'Individual PPT export reads the switch');
    await exec("document.querySelector('[data-figure-stack-view]').click();click('gel-export-pptx-btn')");await waitFor('exports.length===6');
    assert.equal(await exec(hasPptLabels),true,'Stack PPT export reads the switch');
    await exec('controller.destroy()');assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(output,'geometry.json'),JSON.stringify({individual:result.on,stack:result.stackOn,dense:result.dense,pptLayout:result.layout},null,2));
    console.log('gel-ladder-labels-electron: passed (optional switch, cropped/excluded ladder, dense labels, per-gel Stack scaling, DNA/RNA units, PNG tick pixels, editable PPT labels, clean saved state)');
  } finally {win.destroy();app.quit()}
}
main().catch(error=>{console.error(error);process.exitCode=1;if(process.versions.electron)require('electron').app.exit(1)});
