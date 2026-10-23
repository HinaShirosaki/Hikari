'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

async function main() {
  if (!process.versions.electron) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-blot-figure-'));
    try {
      const result = require('node:child_process').spawnSync(require('electron'), [__filename, temp], {
        encoding: 'utf8', timeout: 90000, killSignal: 'SIGKILL'
      });
      process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
      assert.equal(result.status, 0, String(result.error || `Blot figure QA failed (${result.signal || result.status})`));
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
    return;
  }
  const { app, BrowserWindow } = require('electron');
  const temp = process.argv[2]; app.setPath('userData', path.join(temp, 'profile'));
  await app.whenReady();
  const dir = path.join(root, 'src/plugins/gel');
  const url = file => pathToFileURL(path.join(dir, file)).href;
  const output = path.join(root, 'artifacts/gel-blot-figure'); fs.mkdirSync(output, { recursive: true });
  const styles = ['vendor/cropperjs/cropper.min.css', 'vendor/tabulator/tabulator.min.css',
    'vendor/css/base/palette.css', 'vendor/css/base/core.css', 'vendor/css/themes/modes.css',
    'vendor/css/views/gel-palette.css', 'vendor/css/views/gel-view.css',
    'vendor/css/overrides/cross-view-fixes.css', 'vendor/css/overrides/left-rail-template.css',
    'vendor/css/overrides/folder-tree-template.css', 'vendor/css/overrides/universal-left-rail-lists.css',
    'vendor/css/overrides/universal-dialogs.css', 'style.css', 'floating-workspace.css'];
  const markup = fs.readFileSync(path.join(dir, 'vendor/gel-view.html'), 'utf8').replace('class="view"', 'class="view is-active"');
  const fixture = path.join(temp, 'index.html');
  fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8">
    ${styles.map(file => `<link rel="stylesheet" href="${url(file)}">`).join('\n')}
    <script src="${url('vendor/cropperjs/cropper.min.js')}"></script>
    <script src="${url('vendor/utif/UTIF.js')}"></script>
    <script src="${url('vendor/tabulator/tabulator.min.js')}"></script>
    <script src="${url('vendor/pptxgenjs/pptxgen.bundle.js')}"></script>
    </head><body class="plugin-gel"><div id="gel-host">${markup}</div>
    <script type="module">
      import { initGelAnalysis } from '${url('workspace/index.js')}';
      import { parseBlotProject, serializeBlotProject } from '${url('workspace/figure/project.js')}';
      import { buildBlotFigurePlan, validatePlacement, blotSizePercent } from '${url('workspace/figure/model.js')}';
      import { createBlotFigureCanvas } from '${url('workspace/figure/render.js')}';
      import { normalizeStackTrim } from '${url('workspace/figure/trim.js')}';
      import { createGelNotifications } from '${url('notifications.js')}';
      import { createGelWorkspaceStore } from '${url('workspace-store.js')}';
      import { decodeImageFile, encodeSourceGray16 } from '${url('workspace/images/image-io.js')}';
      window.exports=[]; window.cancelExport=false;
      window.useAutosave=new URL(location.href).searchParams.has('autosave');
      window.gelStorage=new Map(useAutosave?JSON.parse(localStorage.getItem('gel-files')||'[]'):[]); window.gelState={gelAnalyses:useAutosave?JSON.parse(localStorage.getItem('gel-records')||'[]'):[],settings:{storagePath:'.'}}; window.savedGelIndex=[]; window.failGelStorage=false;
      window.failWorkspaceSave=false; window.workspaceWrites=0;
      window.workspaceStore=createGelWorkspaceStore({isConfigured:()=>true,hikari:{call:async(verb,params)=>{
        const files=JSON.parse(localStorage.getItem('workspace-files')||'{}');
        if(verb==='files.read'){if(!files[params.path])throw new Error('Plugin file not found.');return {dataBase64:files[params.path]}}
        if(verb!=='files.write')throw new Error('Unexpected verb');
        if(failWorkspaceSave)throw new Error('Disk is full');
        files[params.path]=params.dataBase64;localStorage.setItem('workspace-files',JSON.stringify(files));workspaceWrites++;return {path:params.path};
      }}});
      window.hikariApi={
        readFileBase64:async p=>gelStorage.has(p)?{ok:true,dataBase64:gelStorage.get(p)}:{ok:false,error:'Missing file'},
        storeImportedFile:async data=>{if(failGelStorage)return {ok:false,error:'Disk is full'};const p=data.targetFolder+'/'+data.fileName;gelStorage.set(p,data.dataBase64);return {ok:true,filePath:p,relativePath:p}},
        writeJsonFile:async data=>{const p=data.targetFolder+'/'+data.fileName;gelStorage.set(p,JSON.stringify(data.data));return {ok:true,filePath:p,relativePath:p}},
        exportBinaryFile:async data=>{exports.push(data);return {saved:!cancelExport}},
        exportTextFile:async data=>{exports.push(data);return {saved:!cancelExport}}
      };
      window.recoveryRequests=0;
      window.notices=[];
      const notifications=createGelNotifications({hikari:{call:async(verb,params)=>{notices.push({verb,...params});return {shown:true}}}});
      window.controller=initGelAnalysis({state:gelState,persist:async()=>{savedGelIndex=JSON.parse(JSON.stringify(gelState.gelAnalyses));if(useAutosave){localStorage.setItem('gel-records',JSON.stringify(savedGelIndex));localStorage.setItem('gel-files',JSON.stringify([...gelStorage]));}},workspacePersistence:useAutosave?workspaceStore:null,onRecoverSavedGels:()=>{recoveryRequests++},onNotify:notifications.show,createId:()=>crypto.randomUUID(),
        safeText:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),document});
      controller.render();
      window.el=id=>document.getElementById(id);
      window.parseProject=content=>parseBlotProject(content,()=>crypto.randomUUID());
      window.click=id=>el(id).click();
      window.action=name=>(name==='save'?el('gel-save-btn'):document.querySelector('[data-figure-action="'+name+'"]')).click();
      window.set=(id,value)=>{el(id).value=value;el(id).dispatchEvent(new Event('input',{bubbles:true}));el(id).dispatchEvent(new Event('change',{bubbles:true}))};
      window.field=(name,value)=>{const input=document.querySelector('[data-figure-field="'+name+'"]');input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}))};
      window.savedSizeInfo=async(reopen=false)=>{
        const content=exports.findLast(item=>item.content).content;
        const project=reopen?await parseBlotProject(content,()=>crypto.randomUUID()):JSON.parse(content);
        const options={rasterScale:1,trim:{mode:'none'}};
        const plan=reopen ? createBlotFigureCanvas(project.rows,document,options).plan : buildBlotFigurePlan(project.rows,options);
        return {placement:project.rows.map(row=>row.placement),sizes:project.rows.map(row=>blotSizePercent(row.placement,row.draft.currentImage)),rows:plan.rows.map(row=>({width:row.imageWidth,height:row.imageHeight}))};
      };
      // These checks edit placement; navigation itself opens the gel's analysis tools.
      window.layer=value=>{const rows=[...document.querySelectorAll('[data-figure-row]')];return typeof value==='number'?rows[value]:rows.find(button=>button.textContent.trim()===value)};
      // A gel opens in the editor from the rail; Layout is the Stack, where clicking a blot shows its placement.
      window.edit=index=>layer(index).click();
      window.blotBoxes=()=>{const p=el('gel-figure-preview'),c=p.querySelector('canvas').getBoundingClientRect(),box=p.querySelector('.gel-figure-hover-box'),x=c.left+c.width*.6,found=[];
        for(let y=c.top+1;y<c.bottom;y+=3){p.dispatchEvent(new PointerEvent('pointermove',{clientX:x,clientY:y,bubbles:true}));if(!box.hidden){const r=box.getBoundingClientRect();if(!found.some(f=>Math.abs(f.top-r.top)<1))found.push({x,top:r.top,bottom:r.bottom,y:r.top+r.height/2});}}
        p.dispatchEvent(new PointerEvent('pointerleave',{bubbles:true}));return found};
      window.focusBlot=index=>{const b=blotBoxes()[index],p=el('gel-figure-preview');for(const type of ['pointerdown','pointerup'])p.dispatchEvent(new PointerEvent(type,{clientX:b.x,clientY:b.y,bubbles:true,button:0}));return b};
      window.renameRow=(from,name)=>{const rows=[...document.querySelectorAll('[data-figure-row]')],b=typeof from==='number'?rows[from]:rows.find(row=>row.textContent.trim()===from);b.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));const input=document.activeElement;input.value=name;input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))};
      window.stackView=(index=0)=>document.querySelectorAll('[data-figure-stack-view]')[index].click();
      window.stackTree=()=>[...document.querySelectorAll('.gel-figure-stack-group')].map(group=>({id:group.dataset.figureDrop,
        name:group.querySelector('[data-figure-stack-view] .gel-figure-layer-names').textContent,
        layout:group.querySelector('[data-figure-layout-view]').textContent.trim(),
        gels:[...group.querySelectorAll('[data-figure-row]')].map(button=>button.textContent.trim())}));
      window.renameStack=(index,name,layout=false)=>{const button=document.querySelectorAll(layout?'[data-figure-layout-view]':'[data-figure-stack-view]')[index];
        button.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));const input=document.activeElement;input.value=name;
        input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))};
      window.renameGeometry=selector=>{
        const button=document.querySelector(selector),rect=node=>node?.getBoundingClientRect().toJSON();
        const before={row:rect(button),name:rect(button.querySelector('.gel-figure-layer-names')),icon:rect(button.querySelector('svg'))};
        button.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
        const input=document.querySelector('[data-gel-navigation-rename]'),editor=input.closest('.gel-figure-rename-row');
        const after={row:rect(editor),input:rect(input),icon:rect(editor?.querySelector('svg')),iconVisible:Boolean(editor?.querySelector('svg')?.checkVisibility())};
        input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
        return {before,after,restored:button.checkVisibility()&&!document.querySelector('[data-gel-navigation-rename]')};
      };
      window.count=()=>document.querySelectorAll('[data-figure-row]:not([data-figure-saved-record])').length;
      window.hierarchy=()=>({outside:[...document.querySelectorAll('[data-figure-drop=root] [data-figure-row]')].map(b=>b.textContent.trim()),inside:[...document.querySelectorAll('[data-figure-stack-member]')].map(b=>b.textContent.trim()),ids:[...document.querySelectorAll('[data-figure-row]')].map(b=>b.dataset.figureRow)});
      window.moveGel=(name,destination,beforeName=null,after=false)=>{
        const source=[...document.querySelectorAll('[data-figure-row]')].find(b=>b.textContent.trim()===name);
        const target=beforeName?[...document.querySelectorAll('[data-figure-row]')].find(b=>b.textContent.trim()===beforeName):destination==='stack'?document.querySelector('[data-figure-stack-view]'):destination==='root'?document.querySelector('[data-figure-drop=root]'):([...document.querySelectorAll('[data-figure-stack-view]')].find(button=>button.dataset.figureStackView===destination)||el('gel-figure-preview'));
        target.scrollIntoView({block:'nearest'});
        const a=source.getBoundingClientRect(),b=target.getBoundingClientRect();
        const x=b.left+b.width/2,y=beforeName?(after?b.bottom-2:b.top+2):destination==='root'?b.bottom-3:b.top+b.height/2;
        source.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:42,button:0,clientX:a.left+a.width/2,clientY:a.top+a.height/2}));
        document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:42,button:0,clientX:x,clientY:y}));
        const feedback=Boolean(document.querySelector('.is-gel-drop-active'));
        document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:42,button:0,clientX:x,clientY:y}));
        return {feedback,cleared:!document.querySelector('.gel-figure-drag-label,.is-dragging-gel')};
      };

      window.file=async(name,width,height,first,last,laneCount=6)=>{
        const c=document.createElement('canvas');c.width=width;c.height=height;
        const ctx=c.getContext('2d');ctx.fillStyle='#eee';ctx.fillRect(0,0,width,height);
        ctx.fillStyle='#222';for(let i=0;i<laneCount;i++)ctx.fillRect(width*(first+(last-first)*i/(laneCount-1))-8,height*.45,16,12);
        return new File([await new Promise(r=>c.toBlob(r))],name,{type:'image/png'});
      };
      window.tiff=()=>new File([encodeSourceGray16({width:80,height:40,gray:new Float32Array(3200).fill(.5)},'')],'drop.tif');
      window.load=async(id,files)=>{const transfer=new DataTransfer();files.forEach(file=>transfer.items.add(file));el(id).files=transfer.files;el(id).dispatchEvent(new Event('change'))};
      window.drop=(target,files)=>{
        const transfer=new DataTransfer();files.forEach(file=>transfer.items.add(file));
        const event=new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true});
        (typeof target==='string'?el(target):target).dispatchEvent(event);return event.defaultPrevented;
      };
      window.pngInfo=async()=>{
        const data=exports.findLast(item=>item.fileName.endsWith('.png'));const image=new Image();
        image.src='data:image/png;base64,'+data.dataBase64;await image.decode();
        const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);
        const pixels=ctx.getImageData(0,0,c.width,c.height).data;let cyan=0;
        for(let i=0;i<pixels.length;i+=4)if(pixels[i]<50&&pixels[i+1]>100&&pixels[i+2]>100)cyan++;
        const bandRows=[];let lastBandY=-2;
        for(let y=300;y<c.height;y++){
          const centers=[];let start=-1;
          for(let x=642;x<=c.width;x++){
            const i=(y*c.width+x)*4;const dark=x<c.width&&pixels[i]<60&&pixels[i+1]<60&&pixels[i+2]<60;
            if(dark&&start<0)start=x;
            if(!dark&&start>=0){if(x-start>3)centers.push((start+x)/2);start=-1}
          }
          if(centers.length===6){if(y>lastBandY+1)bandRows.push(centers);lastBandY=y}
        }
        return {width:c.width,height:c.height,cyan,bandRows};
      };
      window.pptxInfo=async()=>{
        const data=exports.findLast(item=>item.fileName.endsWith('.pptx'));
        const zip=await JSZip.loadAsync(data.dataBase64,{base64:true});const xml=await zip.file('ppt/slides/slide1.xml').async('string');
        return {xml,images:Object.keys(zip.files).filter(p=>/^ppt\\/media\\/.+\\.png$/.test(p)).length};
      };
      window.precisionCheck=async()=>{
        const image=await decodeImageFile(await file('16-bit.png',80,40,.1,.9));image.grayBitDepth=16;image.gray[12]=0.12345678;
        const row={id:'a',label:'<β-actin & ERK>',placement:{first:10,last:90,top:0,bottom:100},draft:{
          currentImage:image,originalImage:image,cropApplied:false,controls:{'gel-id':'saved-record-id'},manualOverrides:{},viewerMode:'original'}};
        const toUrl=data=>{const c=document.createElement('canvas');c.width=data.width;c.height=data.height;c.getContext('2d').putImageData(data,0,0);return c.toDataURL()};
        const parsed=await parseBlotProject(serializeBlotProject([row],'test',toUrl),()=>crypto.randomUUID());
        const manual=await parseBlotProject(serializeBlotProject([row],'trimmed',toUrl,{stackTrim:{mode:'manual',left:12,right:87}}),()=>crypto.randomUUID());
        const legacy=JSON.parse(serializeBlotProject([row],'legacy',toUrl));legacy.version=1;delete legacy.stack;delete legacy.checked;delete legacy.view;delete legacy.stackTrim;
        const migrated=await parseBlotProject(JSON.stringify(legacy),()=>crypto.randomUUID());
        let rejected=0;for(const value of [{first:30,last:20,top:0,bottom:100},{first:0,last:1,top:0,bottom:100},{first:10,last:90,top:100,bottom:50}]){try{validatePlacement(value)}catch{rejected++}}
        const geometry=buildBlotFigurePlan([row,{...row,id:'b',draft:{...row.draft,currentImage:{...image,width:100}},placement:{first:20,last:80,top:20,bottom:80}}]);
        const auto=buildBlotFigurePlan([row,{...row,id:'b',draft:{...row.draft,currentImage:{...image,width:100}},placement:{first:20,last:80,top:20,bottom:80}}],{trim:{mode:'auto'}});
        let badTrim=0;for(const value of [{mode:'manual',left:70,right:40},{mode:'manual',left:-1,right:100},{mode:'manual',left:0,right:NaN}]){try{normalizeStackTrim(value)}catch{badTrim++}}
        return {grayEqual:image.gray[12]===parsed.rows[0].draft.currentImage.gray[12],label:parsed.rows[0].label,
          recordId:parsed.rows[0].draft.controls['gel-id'],rejected,legacyStack:migrated.stackIds.length===1&&migrated.selectedId==='stack'&&migrated.stackTrim.mode==='none',
          manualTrim:manual.stackTrim,badTrim,autoNarrower:auto.imageWidth<geometry.imageWidth,
          fullCoverage:auto.rows.every(part=>part.imageX<=.001&&part.imageX+part.imageWidth>=auto.imageWidth-.001),
          guides:[geometry.guideLeft,geometry.guideRight],
          noClipping:geometry.rows.every(part=>part.imageX>=0&&part.imageX+part.imageWidth<=geometry.imageWidth+.001),
          positions:geometry.rows.map((part,i)=>[part.imageX+[8,20][i]*part.imageWidth/[80,100][i],part.imageX+[72,80][i]*part.imageWidth/[80,100][i]])};
      };
      window.individualTablesProject=async()=>{
        const rows=[];
        for(const [id,label,width,count,prefix] of [['a','Treatment A',160,4,'A'],['b','Treatment B',240,6,'B'],['c','No table',180,0,'']]){
          const image=await decodeImageFile(await file(id+'.png',width,70,.1,.9,count||6));
          rows.push({id,label,placement:{first:10,last:90,top:0,bottom:100},draft:{currentImage:image,originalImage:image,
            controls:{'gel-type':'western'},viewerMode:'original',manualOverrides:{
              laneSegmentation:{gelLeft:0,gelRight:width-1,dividers:Array.from({length:Math.max(0,count-1)},(_,i)=>Math.round(width*(i+1)/count))},
              laneTable:{rows:count?[{label:label+' samples',values:Array.from({length:count},(_,i)=>prefix+(i+1))}]:[]}}}});
        }
        const project=JSON.parse(serializeBlotProject(rows,'Individual tables',image=>{const c=document.createElement('canvas');c.width=image.width;c.height=image.height;c.getContext('2d').putImageData(image,0,0);return c.toDataURL()},
          {stackIds:rows.map(row=>row.id),selectedId:'stack'}));
        // Old source selectors cannot hide or substitute a gel's own table.
        project.tableSource='none';project.stacks[0].tableSource=1;
        return JSON.stringify(project);
      };
      window.headerCheck=async()=>{
        const project=JSON.parse(exports.findLast(item=>item.content).content);
        const parsed=await parseBlotProject(JSON.stringify(project),()=>crypto.randomUUID());
        const members=parsed.rows.filter(row=>parsed.stackIds.includes(row.id));
        const plan=buildBlotFigurePlan(members,{trim:parsed.stackTrim});
        return plan.tables.map(table=>{
          const referenceIndex=members.findIndex(row=>row.id===table.sourceId);
          const part=plan.rows[referenceIndex],reference=members[referenceIndex];
          const source=reference.draft.manualOverrides.laneSegmentation;
          const boundaries=[source.gelLeft,...source.dividers,source.gelRight];
          const previous=plan.rows[referenceIndex-1];
          return {label:reference.label,tableTop:table.y,tableBottom:table.y+table.height,blotTop:part.imageY,
            previousBottom:previous?previous.imageY+previous.imageHeight:0,values:table.rows[0].values,
            centers:table.columns.map(column=>column.center),
            expected:table.columns.map(column=>{const i=column.laneIndex-1;return part.imageX+Math.round((boundaries[i]+boundaries[i+1]-1)/2)/reference.draft.currentImage.width*part.imageWidth})};
        });
      };
      window.trimCheck=async()=>{
        const parsed=await parseBlotProject(exports.findLast(item=>item.content).content,()=>crypto.randomUUID());
        const members=parsed.rows.filter(row=>parsed.stackIds.includes(row.id));
        const output=createBlotFigureCanvas(members,document,{trim:parsed.stackTrim});
        return {mode:parsed.stackTrim.mode,width:output.canvas.width,imageWidth:output.plan.imageWidth,fullImageWidth:output.plan.fullImageWidth,
          coverage:output.plan.rows.every(part=>part.imageX<=.001&&part.imageX+part.imageWidth>=output.plan.imageWidth-.001),
          edges:output.blotCanvases.map(canvas=>{const ctx=canvas.getContext('2d'),y=Math.floor(canvas.height*.15);return [ctx.getImageData(3,y,1,1).data[0],ctx.getImageData(canvas.width-4,y,1,1).data[0]]}),
          crop:output.plan.crop};
      };
      await controller.ready; window.ready=true;
    </script></body></html>`);
  const win = new BrowserWindow({ width: 1440, height: 950, show: true,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level >= 3) errors.push(event.message); });
  const exec = async code => {
    try { return await win.webContents.executeJavaScript(/\bawait\b/.test(code) ? `(async()=>{${code}})()` : code, true); }
    catch (error) { throw new Error(`${code}\n${errors.join('\n')}\n${error.message}`); }
  };
  async function waitFor(code) {
    for (let i = 0; i < 150; i++) { if (await exec(code)) return; await new Promise(r => setTimeout(r, 30)); }
    throw new Error(`Timed out: ${code}\n${errors.join('\n')}`);
  }
  const settle = () => exec('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  try {
    await win.loadFile(fixture); await waitFor('Boolean(window.ready)');
    assert.equal(await exec('controller.hasUnsavedChanges()'), false, 'An untouched Gel workspace is clean');
    assert.equal(await exec("Boolean(el('gel-browser-panel'))"), false, 'The project navigator replaces the separate Existing Gels section');
    assert.equal(await exec("Boolean(document.querySelector('[data-figure-stack-view],[data-figure-layout-view]'))"), false, 'A new workspace has no default Stack or nested Layout entry');
    assert.equal(await exec('recoveryRequests'), 0, 'Normal startup does not restore removed records');
    const individualProject=await exec('individualTablesProject()');
    await exec(`load('gel-figure-project-file',[new File([${JSON.stringify(individualProject)}],'individual-tables.json',{type:'application/json'})])`);
    await waitFor("el('gel-figure-status').textContent==='Figure project opened.'");
    assert.equal(await exec("Boolean(el('gel-figure-table-source'))"), false, 'Layout has no shared table source selector');
    await exec("action('save')");await waitFor("el('gel-figure-status').textContent==='Figure project saved.'");
    const ownTables=await exec('headerCheck()');
    assert.deepEqual(ownTables.map(table=>({label:table.label,values:table.values})),[
      {label:'Treatment A',values:[['A1'],['A2'],['A3'],['A4']]},
      {label:'Treatment B',values:[['B1'],['B2'],['B3'],['B4'],['B5'],['B6']]}
    ], 'Every gel keeps its own table and lane count; a gel with no table adds no header');
    for(const table of ownTables){
      assert.ok(table.tableTop>=table.previousBottom && table.tableBottom<table.blotTop, 'Each table sits between the previous gel and its own image');
      table.centers.forEach((center,i)=>assert.ok(Math.abs(center-table.expected[i])<.001, 'Each table aligns to its own lanes'));
    }
    await exec("click('gel-export-pptx-btn')");await waitFor("el('gel-figure-status').textContent==='PPTX exported.'");
    const individualPptx=await exec('pptxInfo()');
    assert.equal((individualPptx.xml.match(/<a:tbl>/g)||[]).length,10,'Both independent tables remain editable PowerPoint cells');
    assert.match(individualPptx.xml,/<a:t>A4<\/a:t>/);assert.match(individualPptx.xml,/<a:t>B6<\/a:t>/);
    await exec("click('gel-export-image-btn')");await waitFor("el('gel-figure-status').textContent==='PNG exported.'");
    fs.writeFileSync(path.join(output,'individual-lane-tables-export.png'),Buffer.from((await exec("exports.findLast(item=>item.fileName.endsWith('.png'))")).dataBase64,'base64'));
    fs.writeFileSync(path.join(output,'individual-lane-tables.png'),(await win.webContents.capturePage()).toPNG());
    await exec("moveGel('Treatment B','stack','Treatment A')");await settle();
    await exec("action('save')");await waitFor("el('gel-figure-status').textContent==='Figure project saved.'");
    assert.deepEqual((await exec('headerCheck()')).map(table=>table.label),['Treatment B','Treatment A'],'Tables follow their gels when reordered');
    await exec('controller.undo()');
    await exec("action('save')");await waitFor("el('gel-figure-status').textContent==='Figure project saved.'");
    assert.deepEqual(await exec('headerCheck()'),ownTables,'Undo restores each gel and its table together');
    await exec("edit('Treatment B');click('gel-open-lane-table-btn');const cell=document.querySelector('[data-gel-table-role=value]');cell.value='B changed';cell.dispatchEvent(new Event('input',{bubbles:true}));stackView();action('save')");
    await waitFor("el('gel-figure-status').textContent==='Figure project saved.'");
    const editedTables=await exec('headerCheck()');
    assert.deepEqual(editedTables[0].values,ownTables[0].values,'Editing the second gel leaves the first table intact');
    assert.equal(editedTables[1].values[0].join(' '),'B changed','Edits to a gel table appear only above that gel');
    await exec("moveGel('Treatment A','root');action('save')");await waitFor("el('gel-figure-status').textContent==='Figure project saved.'");
    assert.deepEqual((await exec('headerCheck()')).map(table=>table.label),['Treatment B'],'Moving a gel out removes only its own stack table');
    await win.loadFile(fixture); await waitFor('Boolean(window.ready)');
    await exec("action('recover')");
    assert.equal(await exec('recoveryRequests'), 1, 'Add gel includes an explicit saved-file recovery action');
    await exec(`{
      const image=await file('saved-source.png',160,80,.1,.9);
      const dataUrl=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(image)});
      gelState.gelAnalyses=Array.from({length:20},(_,i)=>({id:'saved-'+i,name:'Archived gel '+i,sourceImageDataUrl:dataUrl,analysisType:'western',parameters:{enhancement:{denoiseStrength:17,contrastBoost:125}},manualOverrides:{laneTable:{rows:[{label:'Condition',values:['A','B']}]}}}));
      gelState.gelAnalyses.push({id:'missing',name:'Missing image',sourceImageDataUrl:'data:image/png;base64,invalid'});
      controller.renderList();
    }`);
    assert.equal(await exec("document.querySelectorAll('[data-figure-saved-record]').length"), 21, 'Every saved record appears even when the library exceeds the figure layer limit');
    assert.equal(await exec('count()'), 0, 'Listing saved records does not load their images into the figure');
    assert.equal(await exec('controller.hasUnsavedChanges()'), false, 'Discovering saved records is not an edit');
    const libraryOrder = (await exec('hierarchy()')).ids;
    await exec(`(()=>{const list=el('gel-figure-rows');list.scrollTop=0;const button=list.querySelector('[data-figure-row]'),a=button.getBoundingClientRect(),b=list.getBoundingClientRect();
      button.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:91,clientX:a.left+20,clientY:a.top+10}));
      document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:91,clientX:b.left+30,clientY:b.bottom-4}));})()`);
    await settle();
    assert.ok(await exec("el('gel-figure-rows').scrollTop>0"), 'Holding a gel at the tree edge scrolls toward off-screen stacks');
    await exec("document.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:91}));el('gel-figure-rows').scrollTop=0");
    await exec("document.querySelector('[data-figure-saved-record=missing]').click()");
    await waitFor("el('gel-blot-figure').getAttribute('aria-busy')==='false'");
    assert.match(await exec("el('gel-status').textContent"), /image could not be restored/);
    assert.equal(await exec("document.querySelectorAll('[data-figure-saved-record]').length"), 21, 'An unavailable image leaves its saved record visible');
    assert.equal(await exec('controller.hasUnsavedChanges()'), false, 'Opening saved analysis without its image stays clean');
    for (const index of [15, 6, 15]) {
      await exec(`document.querySelector('[data-figure-row="saved:saved-${index}"]').click()`);
      await waitFor(`el('gel-name').value==='Archived gel ${index}' && el('gel-blot-figure').getAttribute('aria-busy')==='false'`);
      assert.deepEqual((await exec('hierarchy()')).ids, libraryOrder, 'Opening a middle saved entry preserves the entire navigation order');
      assert.equal(await exec('controller.hasUnsavedChanges()'), false, 'Browsing saved gels does not request a save on quit');
      assert.equal(await exec('controller.getHistoryState().canUndo'), false, 'Browsing does not add project undo steps');
    }
    await exec("click('gel-process-image-btn');click('gel-processed-preview')");
    assert.equal(await exec('controller.hasUnsavedChanges()'), false, 'Comparing processed and original previews is view state');
    await exec("renameRow('Archived gel 6','Edited saved gel')");
    assert.equal(await exec('controller.hasUnsavedChanges()'), true, 'Renaming a browsed gel is a real edit');
    await exec("document.querySelector('[data-figure-row=\"saved:saved-15\"]').click()");
    assert.equal(await exec('controller.hasUnsavedChanges()'), true, 'Browsing another gel does not clear an earlier edit');
    await exec('controller.undo()');
    assert.equal(await exec('controller.hasUnsavedChanges()'), false, 'Undoing the edit returns to a clean library');
    assert.deepEqual((await exec('hierarchy()')).ids, libraryOrder, 'Undo keeps browsed entries in their original slots');
    await exec("set('gel-denoise-strength','37')");
    assert.equal(await exec('controller.hasUnsavedChanges()'), true, 'Changing processing settings is a real edit');
    await exec("document.querySelector('[data-figure-row=\"saved:saved-12\"]').click()");
    await waitFor("el('gel-name').value==='Archived gel 12'");
    assert.equal(await exec('controller.hasUnsavedChanges()'), true, 'Loading a new saved image preserves pending edits on another gel');
    await exec('controller.undo()');
    assert.equal(await exec('controller.hasUnsavedChanges()'), false, 'Undo restores saved processing settings without losing newly browsed gels');
    await exec("moveGel('Archived gel 6','root','Archived gel 15')"); await settle();
    const reorderedLibrary = (await exec('hierarchy()')).ids;
    assert.equal(reorderedLibrary.indexOf('saved:saved-6') + 1, reorderedLibrary.indexOf('saved:saved-15'), 'Root reordering works relative to unopened saved entries');
    assert.equal(await exec('controller.hasUnsavedChanges()'), true, 'An intentional reorder is an edit');
    await exec('controller.undo()');
    assert.deepEqual((await exec('hierarchy()')).ids, libraryOrder, 'Undo restores the original library order');
    assert.equal(await exec('controller.hasUnsavedChanges()'), false);
    await exec('controller.redo()');
    assert.deepEqual((await exec('hierarchy()')).ids, reorderedLibrary, 'Redo restores an intentional library reorder');
    await exec('controller.undo()');
    const exportsBeforeCleanSave = await exec('exports.length');
    assert.equal(await exec('controller.saveUnsavedChanges()'), true, 'A clean browsed workspace can close directly');
    assert.equal(await exec('exports.length'), exportsBeforeCleanSave, 'Browsing alone does not request a project save');
    await exec("document.querySelector('[data-figure-saved-record=saved-0]').click()");
    await waitFor("el('gel-name').value==='Archived gel 0'");
    assert.equal(await exec("el('gel-id').value"), 'saved-0', 'Opening a saved gel retains its durable identity');
    assert.equal(await exec("el('gel-denoise-strength').value"), '17', 'Opening restores the saved processing settings');
    assert.equal(await exec("document.querySelectorAll('[data-figure-row]').length"), 21, 'Opening a saved gel replaces its library entry without duplication');
    await exec("renameRow('Archived gel 0','Edited and saved gel')");
    assert.equal(await exec('controller.saveUnsavedChanges()'), true, 'Real library edits still save through the quit guard');
    assert.equal(await exec('controller.hasUnsavedChanges()'), false);
    await exec("document.querySelector('[data-figure-saved-record=saved-8]').click()");
    await waitFor("el('gel-name').value==='Archived gel 8'");
    assert.equal(await exec('controller.hasUnsavedChanges()'), false, 'Browsing another saved gel keeps an explicitly saved project clean');
    assert.deepEqual((await exec('hierarchy()')).ids, libraryOrder, 'Saving and browsing do not reorder the library');
    const loadedBeforeStack = await exec('count()');
    await exec("action('stack')");
    for (const [width,height] of [[1440,950],[1440,420],[760,420],[430,350]]) {
      win.setSize(width,height); await settle();
      const tree = await exec(`(()=>{
        const list=el('gel-figure-rows'),root=list.querySelector('[data-figure-drop=root]'),stack=list.querySelector('[data-figure-stack-view]');
        const leaves=[...root.querySelectorAll('[data-figure-row]')].map(node=>node.getBoundingClientRect());
        return {rootBottom:root.getBoundingClientRect().bottom,lastBottom:leaves.at(-1).bottom,stackTop:stack.getBoundingClientRect().top,
          gaps:leaves.slice(1).map((rect,i)=>rect.top-leaves[i].bottom)};
      })()`);
      assert.ok(tree.rootBottom>=tree.lastBottom-1, `All saved gels fit their root group at ${width}×${height}: ${JSON.stringify(tree)}`);
      assert.ok(tree.stackTop>=tree.lastBottom, 'Stack follows the last root gel without overlapping any saved entry');
      assert.ok(tree.gaps.every(gap=>gap>=0), 'Root entries do not overlap each other');
      await exec("document.querySelector('[data-figure-layout-view]').scrollIntoView({block:'nearest'})");
      const layoutReachable=await exec("(()=>{const b=document.querySelector('[data-figure-layout-view]'),r=b.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('button')===b})()");
      assert.equal(layoutReachable, true, 'Layout remains reachable at the bottom of the scrolling tree');
    }
    win.setSize(1440,950); await settle();
    await exec("moveGel('Archived gel 1','stack')");
    await waitFor("document.querySelector('[data-figure-stack-member]')?.textContent.trim()==='Archived gel 1'");
    assert.equal(await exec('count()'), loadedBeforeStack + 1, 'Dragging an unopened saved gel loads it directly into Stack');
    assert.equal(await exec("document.querySelectorAll('[data-figure-row]').length"), 21, 'Stack membership leaves one entry per saved gel');
    await exec("moveGel('Archived gel 1','root')"); await settle();
    assert.deepEqual((await exec('hierarchy()')).inside, [], 'A restored gel can move back out of Stack');
    await win.loadFile(fixture); await waitFor('Boolean(window.ready)');
    assert.equal(await exec("el('gel-figure-stack-btn').disabled"), false, 'Add stack is available before any gel is loaded');
    await exec("click('gel-figure-stack-btn')"); await settle();
    assert.equal(await exec("document.querySelector('[data-figure-stack-view]').disabled"), false, 'Add stack creates a navigable empty Stack in one click');
    assert.equal(await exec("Boolean(document.querySelector('#gel-figure-stack-picker,[data-figure-include]'))"), false, 'Add stack has no gel picker');
    assert.equal(await exec('count()'), 0);
    assert.equal(await exec("el('gel-export-image-btn').disabled && el('gel-export-pptx-btn').disabled"), true, 'Empty Stacks cannot export an image or PowerPoint');
    await exec('controller.undo()');
    assert.equal(await exec("Boolean(document.querySelector('[data-figure-stack-view]'))"), false, 'Undo removes a newly created empty Stack');
    await exec('controller.redo()');
    assert.equal(await exec("Boolean(document.querySelector('[data-figure-stack-view]'))"), true, 'Redo restores the empty Stack');
    await exec("document.querySelector('[data-figure-stack-view]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));const input=document.querySelector('[data-gel-navigation-rename]');input.value='Future experiment';input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))");
    assert.equal(await exec("document.querySelector('[data-figure-stack-view] span').textContent"), 'Future experiment', 'An empty Stack can be renamed');
    await exec("click('gel-save-btn')"); await waitFor("el('gel-figure-status').textContent==='Figure project saved.'");
    const blankStackProject = await exec("exports.findLast(item=>item.content).content");
    assert.deepEqual(JSON.parse(blankStackProject).rows, []);
    assert.equal(JSON.parse(blankStackProject).hasStack, true);
    await win.loadFile(fixture); await waitFor('Boolean(window.ready)');
    await exec(`load('gel-figure-project-file',[new File([${JSON.stringify(blankStackProject)}],'empty-stack.json',{type:'application/json'})])`);
    await waitFor("el('gel-figure-status').textContent==='Figure project opened.'");
    assert.equal(await exec('count()'), 0);
    assert.equal(await exec("document.querySelector('[data-figure-stack-view] span').textContent"), 'Future experiment', 'Reopening a project restores the empty Stack and its name');
    await exec("drop('gel-figure-rows',[await file('future-gel.png',160,80,.1,.9)])");
    await waitFor("el('gel-blot-figure').getAttribute('aria-busy')==='false'");
    assert.equal(await exec('savedGelIndex.length'), 1, 'Dropping a gel automatically stores a durable record');
    assert.equal(await exec("savedGelIndex[0].imageName"), 'future-gel.png');
    assert.equal(await exec("gelStorage.has(savedGelIndex[0].originalImagePath) && gelStorage.has(savedGelIndex[0].sourceImagePath)"), true, 'The original file and decoded source are both stored');
    await exec("click('gel-figure-stack-btn')");
    assert.deepEqual((await exec('hierarchy()')).inside, [], 'Add stack creates an empty stack immediately when gels exist');
    assert.equal((await exec('stackTree()')).length, 2, 'One click adds exactly one stack');
    assert.deepEqual((await exec('hierarchy()')).outside, ['Gel 1'], 'Existing gels stay outside until dragged in');
    fs.writeFileSync(path.join(output, 'one-click-stack.png'), (await win.webContents.capturePage()).toPNG());
    assert.deepEqual(await exec("moveGel('Gel 1','stack')"), {feedback:true,cleared:true}); await settle();
    assert.deepEqual((await exec('hierarchy()')).inside, ['Gel 1'], 'A gel can be dragged into a Stack created before any images were loaded');
    await exec("action('stack')");
    assert.deepEqual((await exec('stackTree()')).map(stack=>stack.gels), [['Gel 1'],[],[]], 'Adding another empty stack preserves existing membership');
    await win.loadFile(fixture); await waitFor('Boolean(window.ready)');
    await exec("drop('gel-figure-rows',await Promise.all([file('one.png',160,80,.1,.9),file('two.png',160,80,.1,.9),file('three.png',160,80,.1,.9)]))");
    await waitFor("count()===3 && el('gel-blot-figure').getAttribute('aria-busy')==='false'");
    await exec("click('gel-figure-stack-btn');moveGel('Gel 1','stack');moveGel('Gel 2','stack');moveGel('Gel 3','stack')"); await settle();
    await exec("click('gel-figure-stack-btn');click('gel-figure-stack-btn')");
    assert.deepEqual((await exec('stackTree()')).map(stack=>({name:stack.name,gels:stack.gels})), [
      {name:'Stack',gels:['Gel 1','Gel 2','Gel 3']},{name:'Stack 2',gels:[]},{name:'Stack 3',gels:[]}
    ], 'Each Create Stack adds an independent stack and keeps existing membership');
    const multipleStackIds=(await exec('stackTree()')).map(stack=>stack.id);
    await exec(`moveGel('Gel 2',${JSON.stringify(multipleStackIds[1])});moveGel('Gel 3','root')`); await settle();
    for (const selector of ['[data-figure-drop=root] [data-figure-row]','[data-figure-stack-view]','[data-figure-stack-member]','[data-figure-layout-view]']) {
      const {before,after,restored}=await exec(`renameGeometry(${JSON.stringify(selector)})`);
      assert.equal(after.iconVisible, true, `Rename retains the ${selector} icon`);
      for (const key of ['left','top','width','height']) assert.ok(Math.abs(after.row[key]-before.row[key])<.6, `Rename keeps the row's ${key} for ${selector}`);
      for (const key of ['left','width']) assert.ok(Math.abs(after.input[key]-before.name[key])<.6, `Rename uses the name's original ${key} for ${selector}`);
      assert.deepEqual(after.icon, before.icon, 'Rename does not move the icon');
      assert.equal(restored, true, 'Escape restores the original row');
    }
    await exec("document.querySelectorAll('[data-figure-stack-view]')[1].dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");
    fs.writeFileSync(path.join(output, 'inline-rename.png'), (await win.webContents.capturePage()).toPNG());
    await exec("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))");
    await exec(`moveGel('Gel 3',${JSON.stringify(multipleStackIds[2])})`); await settle();
    assert.deepEqual((await exec('stackTree()')).map(stack=>stack.gels), [['Gel 1'],['Gel 2'],['Gel 3']], 'Gels move between stacks with exclusive membership');
    assert.equal((await exec('hierarchy()')).ids.length, 3, 'Moving between stacks never duplicates a gel');
    assert.equal(await exec("document.querySelectorAll('[aria-current=page][data-figure-stack-view]').length"), 1, 'Only the current stack is selected');
    await exec("stackView(1);renameStack(1,'Treatment');renameStack(1,'Treatment panel',true);action('trim');const edge=document.querySelector('[data-trim-edge=left]');edge.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));action('apply-trim');action('save')");
    await waitFor("el('gel-figure-status').textContent==='Figure project saved.'");
    const multiProject=await exec("exports.findLast(item=>item.content).content");
    const multi=JSON.parse(multiProject);
    assert.equal(multi.version, 4); assert.equal(multi.stacks.length, 3); assert.equal(multi.activeStack, 1);
    assert.deepEqual(multi.stacks.map(stack=>stack.trim.mode), ['none','manual','none'], 'Canvas trim belongs only to its stack');
    assert.equal(multi.stacks.some(stack=>'tableSource' in stack), false, 'Projects have no obsolete shared table setting');
    assert.equal(multi.stacks[1].name, 'Treatment'); assert.equal(multi.stacks[1].layoutName, 'Treatment panel');
    fs.writeFileSync(path.join(output, 'multiple-stacks.png'), (await win.webContents.capturePage()).toPNG());
    await exec("stackView(0)");
    assert.equal(await exec("Boolean(el('gel-figure-table-source'))"), false, 'Switching stacks does not restore a shared table selector');
    await exec("stackView(1);click('gel-export-pptx-btn')"); await waitFor("el('gel-figure-status').textContent==='PPTX exported.'");
    const multiPptx=await exec('pptxInfo()');
    assert.equal(multiPptx.images, 1); assert.match(multiPptx.xml, /<a:t>Gel 2<\/a:t>/); assert.doesNotMatch(multiPptx.xml, /<a:t>Gel [13]<\/a:t>/, 'Export uses only the active stack');
    await exec(`moveGel('Gel 2',${JSON.stringify(multipleStackIds[0])});controller.undo()`); await settle();
    assert.deepEqual((await exec('stackTree()')).map(stack=>stack.gels), [['Gel 1'],['Gel 2'],['Gel 3']], 'Undo restores membership across stacks');
    await exec("controller.redo()");
    assert.deepEqual((await exec('stackTree()')).map(stack=>stack.gels), [['Gel 1','Gel 2'],[],['Gel 3']], 'Redo reapplies a move without removing the empty source stack');
    await exec("moveGel('Gel 2','root')"); await settle();
    assert.deepEqual((await exec('hierarchy()')).outside, ['Gel 2'], 'A gel can move out of any stack');
    await win.loadFile(fixture); await waitFor('Boolean(window.ready)');
    await exec(`load('gel-figure-project-file',[new File([${JSON.stringify(multiProject)}],'multiple-stacks.json',{type:'application/json'})])`);
    await waitFor("el('gel-figure-status').textContent==='Figure project opened.'");
    assert.deepEqual((await exec('stackTree()')).map(({id,...stack})=>stack), [
      {name:'Stack',layout:'Layout',gels:['Gel 1']},{name:'Treatment',layout:'Treatment panel',gels:['Gel 2']},{name:'Stack 3',layout:'Layout',gels:['Gel 3']}
    ], 'Project reopening restores all stacks, names, layouts, and membership');
    assert.equal(await exec("el('gel-figure-preview-title').textContent"), 'Treatment', 'Project reopening restores the active stack');
    await exec(`load('gel-figure-project-file',[new File([${JSON.stringify(multiProject)}],'append-stacks.json',{type:'application/json'})])`);
    await waitFor("count()===3 && el('gel-blot-figure').getAttribute('aria-busy')==='false'");
    assert.equal(await exec('stackTree().length'), 3, 'Reopening the same project reuses all stacks');
    assert.equal(await exec('new Set(stackTree().map(stack=>stack.id)).size'), 3, 'Reopened stacks keep their original identities');
    const otherProject=JSON.parse(multiProject); otherProject.rows.forEach((row,index)=>row.id='other-row-'+index); otherProject.stacks.forEach((stack,index)=>stack.id='other-stack-'+index);
    await exec(`load('gel-figure-project-file',[new File([${JSON.stringify(JSON.stringify(otherProject))}],'other-project.json')])`);
    await waitFor("count()===6 && el('gel-blot-figure').getAttribute('aria-busy')==='false'");
    assert.equal(await exec('stackTree().length'), 6, 'A separate project adds its stacks while preserving current work');
    const invalidMulti=JSON.parse(multiProject); invalidMulti.stacks[1].layers=invalidMulti.stacks[0].layers;
    assert.match(await exec(`try{await parseProject(${JSON.stringify(JSON.stringify(invalidMulti))});return ''}catch(error){return error.message}`), /more than one stack/, 'Projects cannot assign one gel to multiple stacks');
    const versionTwo=JSON.parse(multiProject); versionTwo.version=2; delete versionTwo.stacks; delete versionTwo.activeStack;
    assert.deepEqual(await exec(`const project=await parseProject(${JSON.stringify(JSON.stringify(versionTwo))});return project.stacks.map(stack=>({name:stack.name,layers:stack.layerIds.length,trim:stack.trim.mode}))`),
      [{name:'Treatment',layers:1,trim:'manual'}], 'Version 2 projects migrate to one independent stack');
    await win.loadFile(fixture); await waitFor('Boolean(window.ready)');
    assert.equal(await exec("el('gel-open-figure-btn').hidden"), true, 'Without a Stack there is no Layout icon');
    const dragState = await exec(`(()=>{const transfer=new DataTransfer();transfer.items.add(new File(['x'],'gel.png',{type:'image/png'}));
      const target=el('gel-figure-rows'),stage=el('gel-viewer-stage');
      const enter=new DragEvent('dragenter',{dataTransfer:transfer,bubbles:true,cancelable:true});target.dispatchEvent(enter);
      const active=el('gel-navigation').classList.contains('is-file-drop-active');
      target.dispatchEvent(new DragEvent('dragleave',{dataTransfer:transfer,bubbles:true,cancelable:true}));
      return {accepted:enter.defaultPrevented,active,cleared:!el('gel-navigation').classList.contains('is-file-drop-active')};})()`);
    assert.deepEqual(dragState, { accepted: true, active: true, cleared: true }, 'Layers show and clear file-drop feedback');
    assert.equal(await exec("return drop('gel-figure-rows',[await file('drop-a.png',160,80,.1,.9),await file('drop-b.png',160,80,.2,.8),new File(['bad'],'broken.png',{type:'image/png'}),new File(['text'],'notes.txt',{type:'text/plain'})])"), true);
    await waitFor("el('gel-blot-figure').getAttribute('aria-busy')==='false'");
    assert.equal(await exec('count()'), 2, 'Dropping multiple images on the rail appends every valid image');
    assert.equal(await exec("Boolean(document.querySelector('[data-figure-stack-view]'))"), false, 'Importing gels does not create a Stack');
    assert.equal(await exec("el('gel-blot-figure').hidden"), true, 'A single gel has no Layout; the drop opens the editor');
    assert.equal(await exec("el('gel-crop-mode-btn').disabled"), false, 'The first dropped gel opens for editing');
    assert.match(await exec("el('gel-figure-status').textContent"), /broken.png/);
    await exec('controller.undo()'); assert.equal(await exec('count()'), 0, 'One undo removes the whole dropped batch');
    assert.equal(await exec("document.querySelectorAll('[data-figure-saved-record]').length"), 2, 'Undoing an import keeps its durably saved records available');
    await exec('controller.redo()'); assert.equal(await exec('count()'), 2);
    await exec("const files=[await file('drop-c.png',160,80,.1,.9),await file('busy.png',160,80,.1,.9)];drop('gel-canvas',[files[0]]);drop('gel-figure-rows',[files[1]])");
    await waitFor("el('gel-blot-figure').getAttribute('aria-busy')==='false'");
    assert.equal(await exec('count()'), 3, 'Drops on the canvas append a layer; a concurrent drop cannot replace the editor');
    await exec("drop('gel-figure-rows',[new File(['text'],'notes.txt',{type:'text/plain'})])");
    assert.equal(await exec('count()'), 3);
    assert.match(await exec("el('gel-figure-status').textContent"), /Drop.*image/i, 'Rejected files are explained');
    assert.equal(await exec("el('gel-blot-figure').hidden"), true);
    await exec("edit(0)");
    assert.equal(await exec("el('gel-crop-mode-btn').disabled"), false, 'A gel opened from the rail enables Crop');
    await exec("click('gel-crop-mode-btn')");
    await waitFor("Boolean(document.querySelector('.cropper-container'))");
    await exec("click('gel-cancel-crop-btn')");
    assert.equal(await exec("el('gel-blot-figure').hidden"), true);
    await exec("drop('gel-figure-rows',[tiff()])");
    await waitFor("el('gel-blot-figure').getAttribute('aria-busy')==='false'");
    assert.equal(await exec('count()'), 4, `TIFF drops without a MIME type are accepted: ${await exec("el('gel-figure-status').textContent")}`);
    assert.equal(await exec("el('gel-canvas').width"), 80, 'The dropped TIFF opens in the editor');
    await exec("const files=await Promise.all(Array.from({length:13},(_,i)=>file('limit-'+i+'.png',80,40,.1,.9)));drop('gel-figure-rows',files)");
    await waitFor("el('gel-blot-figure').getAttribute('aria-busy')==='false'");
    assert.equal(await exec('count()'), 16, 'Dropped batches respect the layer limit');
    assert.match(await exec("el('gel-figure-status').textContent"), /Layer limit: 16/);
    await exec("renameRow(document.querySelectorAll('[data-figure-row]').length-1,'Long gel name — replicate blot with a descriptive sample and treatment name')");
    for (const [width,height] of [[1440,420],[760,420],[430,350]]) {
      win.setSize(width,height); await settle();
      const fixedHeader = await exec("document.querySelector('.gel-figure-header').getBoundingClientRect().toJSON()");
      await exec("el('gel-figure-rows').scrollTop=el('gel-figure-rows').scrollHeight"); await settle();
      const scrolled = await exec("(()=>{const list=el('gel-figure-rows'),rail=el('gel-navigation'),header=document.querySelector('.gel-figure-header'),add=el('gel-figure-stack-btn'),r=add.getBoundingClientRect(),last=[...list.querySelectorAll('[data-figure-row]')].at(-1),label=last.querySelector('.gel-figure-layer-names');return {header:header.getBoundingClientRect().toJSON(),list:list.getBoundingClientRect().toJSON(),rail:rail.getBoundingClientRect().toJSON(),scroll:list.scrollTop,railScroll:rail.scrollTop,navScroll:rail.scrollTop,hit:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('button')?.id,rowHeight:last.getBoundingClientRect().height,labelClipped:label.scrollWidth>label.clientWidth,labelWhiteSpace:getComputedStyle(label).whiteSpace}})()");
      assert.ok(scrolled.scroll > 0, `The gel tree scrolls in a short ${width}×${height} window`);
      assert.deepEqual(scrolled.header, fixedHeader, 'The Gels header and add buttons stay fixed while entries scroll');
      assert.equal(scrolled.railScroll, 0); assert.equal(scrolled.navScroll, 0);
      assert.equal(scrolled.hit, 'gel-figure-stack-btn', 'Add stack remains visible and reachable above the tree');
      assert.ok(Math.abs(scrolled.list.bottom-scrolled.rail.bottom)<1, `The tree scrollbar reaches the bottom of the rail at ${width}×${height}: ${JSON.stringify({list:scrolled.list,rail:scrolled.rail})}`);
      assert.ok(Math.abs(scrolled.list.right-(scrolled.rail.right-1))<1 && Math.abs(scrolled.list.left-scrolled.rail.left)<1, 'The scroll region spans the rail width up to its divider');
      assert.ok(scrolled.rowHeight<=36 && scrolled.labelClipped && scrolled.labelWhiteSpace==='nowrap', 'Long names stay compact tree rows with ellipsis');
    }
    win.setSize(1440,950); await settle();
    await exec("el('gel-figure-rows').scrollTop=0");
    await exec("drop('gel-figure-rows',[await file('over-limit.png',80,40,.1,.9)])");
    await waitFor("el('gel-blot-figure').getAttribute('aria-busy')==='false'");
    assert.equal(await exec('count()'), 16);
    assert.equal(await exec("el('gel-blot-figure').hidden"), true);
    await exec('controller.destroy()');
    await win.loadFile(fixture); await waitFor('Boolean(window.ready)');
    await exec("drop('gel-canvas',[await file('first.png',160,80,.1,.9),await file('second.png',240,100,.2,.8),new File(['bad'],'broken.png',{type:'image/png'})])");
    await waitFor("el('gel-blot-figure').getAttribute('aria-busy')==='false' && el('gel-canvas').width===160");
    assert.deepEqual((await exec('hierarchy()')).outside, ['Gel 1','Gel 2'], 'A drop on the processing canvas creates an entry for every valid image');
    assert.equal(await exec("el('gel-blot-figure').hidden"), true, 'Canvas drops keep processing open with the first imported gel');
    assert.equal(await exec("el('gel-type').value"), 'sds-page', 'Canvas imports retain the chosen analysis type');
    assert.match(await exec("el('gel-status').textContent"), /broken.png/);
    assert.deepEqual(await exec('savedGelIndex.map(record=>record.imageName)'), ['first.png','second.png'], 'A multi-file drop stores every valid gel, without a record for an invalid file');
    assert.equal(await exec("el('gel-id').value===savedGelIndex[0].id"), true, 'The editor opens with the automatically saved record identity');
    await exec("el('gel-form').requestSubmit()");
    await waitFor("el('gel-form').getAttribute('aria-busy')==='false'");
    assert.equal(await exec('savedGelIndex.length'), 2, 'Saving after processing updates the imported record instead of duplicating it');
    await exec("set('gel-name','First processed');set('gel-contrast-strength','57');drop('gel-canvas',[tiff()])");
    await waitFor("el('gel-blot-figure').getAttribute('aria-busy')==='false' && el('gel-canvas').width===80");
    assert.equal(await exec('count()'), 3, 'A later canvas drop appends a gel instead of replacing a previous entry');
    assert.deepEqual((await exec('hierarchy()')).outside, ['First processed','Gel 2','Gel 3']);
    await exec("load('gel-image-file',[await file('picker.png',320,140,.1,.9)])");
    await waitFor("el('gel-blot-figure').getAttribute('aria-busy')==='false' && el('gel-canvas').width===320");
    assert.equal(await exec('count()'), 4, 'The processing image picker also creates a navigator entry');
    assert.equal(await exec("el('gel-blot-figure').hidden"), true);
    await exec('layer(0).click()');
    assert.equal(await exec("el('gel-canvas').width"), 160, 'Earlier gels reopen their own image');
    assert.equal(await exec("el('gel-contrast-strength').value"), '57', 'Earlier processing settings survive subsequent imports');
    await exec("drop('gel-canvas',[new File(['bad'],'broken.png',{type:'image/png'})])");
    await waitFor("el('gel-blot-figure').getAttribute('aria-busy')==='false'");
    assert.equal(await exec('count()'), 4, 'A failed canvas import creates no empty row');
    assert.equal(await exec("el('gel-canvas').width"), 160, 'A failed import keeps the active gel intact');
    // Without a Stack there is no Layout; closing the app saves the project instead.
    assert.equal(await exec('controller.saveUnsavedChanges()'), true);
    await waitFor("el('gel-figure-status').textContent==='Figure project saved.'");
    const canvasProject = await exec("exports.findLast(item=>item.content).content");
    assert.equal(JSON.parse(canvasProject).rows.length, 4, 'Canvas and picker imports are included in the saved project');
    assert.equal(JSON.parse(canvasProject).hasStack, false);
    assert.equal(JSON.parse(canvasProject).rows.every(row=>row.draft.controls['gel-id']===''), true, 'Portable projects do not carry local saved-record identities');
    await exec("failGelStorage=true;drop('gel-figure-rows',[await file('not-saved.png',80,40,.1,.9)])");
    await waitFor("el('gel-blot-figure').getAttribute('aria-busy')==='false'");
    assert.equal(await exec('count()'), 5, 'Storage failure keeps the imported image available for recovery');
    assert.equal(await exec('savedGelIndex.length'), 4, 'Storage failure does not claim an indexed record');
    assert.match(await exec("el('gel-figure-status').textContent"), /Could not automatically save gel:.*Disk is full/);
    assert.equal(await exec('controller.hasUnsavedChanges()'), true, 'A failed automatic save leaves the import dirty');
    await win.loadFile(fixture); await waitFor('Boolean(window.ready)');
    await exec(`load('gel-figure-project-file',[new File([${JSON.stringify(canvasProject)}],'canvas-imports.json',{type:'application/json'})])`);
    await waitFor("el('gel-figure-status').textContent==='Figure project opened.'");
    assert.deepEqual((await exec('hierarchy()')).outside, ['First processed','Gel 2','Gel 3','Gel 4'], 'Reopening restores every automatically created entry');
    assert.equal(await exec("Boolean(document.querySelector('[data-figure-stack-view]'))"), false, 'A project saved without Stack reopens without one');
    await win.loadFile(fixture); await waitFor('Boolean(window.ready)');
    const precision = await exec('precisionCheck()');
    assert.equal(precision.grayEqual, true); assert.equal(precision.label, '<β-actin & ERK>');
    assert.equal(precision.recordId, ''); assert.equal(precision.rejected, 3);
    assert.equal(precision.legacyStack, true, 'Earlier figure projects open as a Stack');
    assert.deepEqual(precision.manualTrim, { mode: 'manual', left: 12, right: 87 });
    assert.equal(precision.badTrim, 3); assert.equal(precision.autoNarrower, true); assert.equal(precision.fullCoverage, true);
    precision.positions.forEach(([first, last]) => { assert.ok(Math.abs(first - precision.guides[0]) < 0.001); assert.ok(Math.abs(last - precision.guides[1]) < 0.001); });
    assert.equal(precision.noClipping, true);
    await exec("drop('gel-canvas',[await file('ERK.png',900,220,.1,.9)])");
    await waitFor("!el('gel-crop-mode-btn').disabled");
    assert.equal(await exec("el('gel-canvas').width"), 900, 'The individual editor loads the dropped image');
    assert.equal(await exec('count()'), 1, 'The dropped gel appears in navigation before opening Layout');
    await exec("set('gel-contrast-strength','70');click('gel-process-image-btn');set('gel-expected-lane-count','6');click('gel-auto-detect-lanes-btn');click('gel-tool-dividers-btn');click('gel-open-lane-table-btn');click('gel-add-table-btn');const label=document.querySelector('[data-gel-table-role=label]');label.value='Condition';label.dispatchEvent(new Event('input',{bubbles:true}));document.querySelectorAll('[data-gel-table-role=value]').forEach((input,i)=>{input.value='S'+(i+1);input.dispatchEvent(new Event('input',{bubbles:true}))});action('add')");
    assert.equal(await exec('count()'), 1, 'Current gel does not duplicate an automatically imported layer');
    assert.match(await exec("document.querySelector('[data-figure-row]').textContent"), /^Gel 1/);
    assert.equal(await exec("el('gel-blot-figure').hidden"), true, 'Adding the current gel keeps it in the editor');
    assert.equal(await exec("el('gel-open-figure-btn').hidden"), true, 'A single gel has no Layout icon');
    assert.equal(await exec("document.querySelector('[data-figure-action=stack]').disabled"), false, 'Stack creation does not require multiple gels');
    assert.deepEqual(await exec("[...document.querySelectorAll('#gel-navigation .gel-figure-header > button')].map(button=>({label:button.getAttribute('aria-label'),title:button.title,text:button.textContent.trim(),icon:Boolean(button.querySelector('svg'))}))"), [
      {label:'Add gel',title:'Add gel',text:'',icon:true},{label:'Add stack',title:'Add stack',text:'',icon:true}
    ], 'Add gel and Add stack are labeled icon buttons');
    assert.equal(await exec("el('gel-navigation').querySelectorAll('img,canvas,input[type=checkbox]').length"), 0, 'The left navigator shows names without previews or checkboxes');
    assert.equal(await exec("document.querySelector('.gel-figure-controls [data-figure-action=save]')"), null, 'Layout has no duplicate Save project button');
    assert.equal(await exec("el('gel-figure-name').type"), 'hidden', 'Project metadata does not create an extra name field in Layout');
    const addMenu = await exec("(()=>{const picked=[],ids=['gel-figure-files','gel-figure-project-file'];ids.forEach(id=>{el(id).click=()=>picked.push(id)});const shown=[];for(const name of ['import','open']){click('gel-figure-add-btn');shown.push(el('gel-figure-add-menu').matches(':popover-open'));action(name)}ids.forEach(id=>delete el(id).click);return {picked,shown,open:el('gel-figure-add-menu').matches(':popover-open')}})()");
    assert.deepEqual(addMenu, { picked: ['gel-figure-files', 'gel-figure-project-file'], shown: [true, true], open: false }, 'The Add menu picks image files and projects, then closes');
    await exec("set('gel-name','p-ERK1/2');drop('gel-figure-rows',[await file('Actin.png',720,200,.2,.8),new File(['bad'],'bad.png',{type:'image/png'})])");
    await waitFor("el('gel-blot-figure').getAttribute('aria-busy')==='false'");
    assert.equal(await exec('count()'), 2, 'A bad file does not discard the good imports');
    assert.match(await exec("document.querySelectorAll('[data-figure-row]')[1].textContent"), /^Gel 2/);
    assert.match(await exec("el('gel-figure-status').textContent"), /bad.png/);
    await exec("click('gel-figure-stack-btn')");
    assert.deepEqual((await exec('stackTree()')).map(stack=>stack.gels), [[]], 'Add stack never includes existing gels automatically');
    assert.equal(await exec("Boolean(document.querySelector(':popover-open'))"), false, 'Stack creation needs no follow-up choice');
    await exec("el('gel-figure-stack-btn').focus();el('gel-figure-stack-btn').dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}))");
    assert.equal((await exec('stackTree()')).length, 0, 'Keyboard undo reverses one-click stack creation');
    await exec("set('gel-name','β-actin')");
    assert.equal(await exec("el('gel-blot-figure').hidden"), true);
    await exec("set('gel-contrast-strength','30');click('gel-process-image-btn');edit(0)");
    assert.equal(await exec("el('gel-contrast-strength').value"), '70', 'Each blot retains its enhancement settings');
    assert.equal(await exec("document.querySelector('[data-gel-table-role=label]').value"), 'Condition', 'Lane table edits remain with their blot');
    assert.equal(await exec("el('gel-processed-preview').checked"), true, 'Each blot retains its processed preview mode');
    await exec("edit(1)");
    assert.equal(await exec("el('gel-contrast-strength').value"), '30');
    assert.equal(await exec("el('gel-name').value"), 'β-actin', 'Processing uses the renamed layer name');
    assert.deepEqual(await exec("moveGel('β-actin','root','p-ERK1/2')"), {feedback:true,cleared:true}); await settle();
    assert.match(await exec("document.querySelector('[data-figure-row]').textContent"), /β-actin/, 'Gels reorder in the rail');
    await exec('controller.undo()'); assert.match(await exec("document.querySelector('[data-figure-row]').textContent"), /p-ERK/);
    await exec('controller.redo()'); assert.match(await exec("document.querySelector('[data-figure-row]').textContent"), /β-actin/);
    // Remove belongs to the gel being edited: the toolbar's More menu.
    await exec("edit(0);click('gel-record-menu-btn')");
    assert.equal(await exec("el('gel-remove-gel-btn').disabled"), false);
    await exec("click('gel-remove-gel-btn')"); assert.equal(await exec('count()'), 1);
    assert.equal(await exec("el('gel-name').value"), 'p-ERK1/2', 'Removing a gel opens the next one');
    await exec('controller.undo()'); assert.equal(await exec('count()'), 2);
    const layerBounds = await exec("document.querySelector('[data-figure-row]').getBoundingClientRect().toJSON()");
    const point = { x: Math.round(layerBounds.x + layerBounds.width / 2), y: Math.round(layerBounds.y + layerBounds.height / 2) };
    for (const clickCount of [1, 2]) {
      win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount, ...point });
      win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount, ...point });
      await settle();
    }
    await settle();
    assert.equal(await exec("document.activeElement.getAttribute('aria-label')"), 'Rename gel', 'A real double-click starts renaming directly in the navigation rail');
    assert.equal(await exec('document.activeElement.value'), 'β-actin');
    await exec("document.activeElement.value='Canceled name';document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))");
    assert.equal(await exec("document.querySelector('[data-figure-row]').textContent.trim()"), 'β-actin', 'Escape preserves the old name');
    await exec("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true,cancelable:true}));document.activeElement.value='  Actin loading control  ';document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))");
    assert.equal(await exec("document.querySelector('[data-figure-row]').textContent.trim()"), 'Actin loading control', 'Enter saves the trimmed inline name');
    assert.equal(await exec("el('gel-name').value"), 'Actin loading control', 'The processing editor stays in sync with an inline rename');
    assert.equal(await exec("el('gel-blot-figure').hidden"), true, 'Renaming keeps the gel processing canvas open');
    await exec('controller.undo()');
    assert.equal(await exec("document.querySelector('[data-figure-row]').textContent.trim()"), 'β-actin', 'Undo in the rail restores the prior name');
    await exec('controller.redo()');
    assert.equal(await exec("document.querySelector('[data-figure-row]').textContent.trim()"), 'Actin loading control', 'Redo in the rail reapplies the name');
    await exec("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true,cancelable:true}));document.activeElement.value=' ';document.activeElement.blur()");
    assert.equal(await exec("document.querySelector('[data-figure-row]').textContent.trim()"), 'Actin loading control', 'Blank names are ignored');
    await exec("const b=document.querySelector('[data-figure-row]');b.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));const input=document.activeElement;input.value='β-actin';input.blur();if(input.isConnected)input.dispatchEvent(new FocusEvent('blur'))");
    fs.writeFileSync(path.join(output, 'layer.png'), (await win.webContents.capturePage()).toPNG());
    await exec("action('stack')");
    assert.equal(await exec("Boolean(document.querySelector('[data-figure-stack-view]'))"), true, 'Create Stack adds its navigation entry');
    await exec('controller.undo()');
    assert.equal(await exec("Boolean(document.querySelector('[data-figure-stack-view]'))"), false, 'Undoing Stack creation removes the entry');
    await exec('controller.redo()');
    assert.equal(await exec("Boolean(document.querySelector('[data-figure-stack-view]'))"), true, 'Redo restores the created Stack');
    await exec("moveGel('β-actin','stack');moveGel('p-ERK1/2','stack')");
    assert.equal(await exec("el('gel-figure-preview-title').textContent"), 'Stack');
    assert.equal(await exec("el('gel-figure-preview-detail').textContent"), '2 gels');
    await exec("document.querySelector('[data-figure-stack-view]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));document.activeElement.value='ERK experiment';document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))");
    assert.equal(await exec("document.querySelector('[data-figure-stack-view] span').textContent"), 'ERK experiment', 'Stack renames inline');
    assert.equal(await exec("el('gel-figure-preview-title').textContent"), 'ERK experiment', 'Stack preview uses its renamed title');
    await exec('controller.undo()');
    assert.equal(await exec("el('gel-figure-preview-title').textContent"), 'Stack');
    await exec('controller.redo()');
    assert.equal(await exec("el('gel-figure-preview-title').textContent"), 'ERK experiment');
    // Chromium omits blur events when another app holds OS focus. Deliver the
    // same event explicitly in that case; real click-away is also checked in CUA.
    const layoutRename = await exec("(()=>{document.querySelector('[data-figure-layout-view]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));const a=document.activeElement,info={label:a.getAttribute('aria-label'),tag:a.tagName,connected:a.isConnected};a.value='Publication panel';a.blur();if(a.isConnected)a.dispatchEvent(new FocusEvent('blur'));return info})()");
    assert.equal(layoutRename.label, 'Rename layout', JSON.stringify(layoutRename));
    assert.equal(await exec("document.querySelector('[data-figure-layout-view]').textContent.trim()"), 'Publication panel', `Layout saves its inline name on blur: ${JSON.stringify(layoutRename)}`);
    assert.equal(await exec("el('gel-figure-placement').hidden"), true, 'Stack has its own view');
    assert.equal(await exec("el('gel-figure-stack-trim').hidden"), false);
    assert.equal(await exec("el('gel-figure-size')"), null, 'Layout sizing is edited directly on the canvas');
    await exec("action('save')"); await waitFor("el('gel-figure-status').textContent==='Figure project saved.'");
    assert.equal(await exec("notices.some(notice=>notice.message==='Figure project saved.'&&notice.type==='success')"), true, 'Project save completion reaches the overall notification callback');
    assert.equal(await exec("el('gel-figure-status').hidden"), true, 'The figure does not display a duplicate local status');
    // Clicking a blot in the Stack shows its placement; a single gel has no Layout of its own.
    await exec('focusBlot(0)');
    assert.equal(await exec("el('gel-figure-placement').hidden"), false, 'Clicking a Stack blot shows its placement');
    assert.equal(await exec("el('gel-figure-placement-title').textContent"), 'β-actin');
    await exec("field('first',20);field('last',80);field('top',25);field('bottom',75)");
    assert.equal(await exec("document.querySelector('[data-figure-field=first]').value"), '20');
    await exec("field('first',99)");
    assert.equal(await exec("document.querySelector('[data-figure-field=first]').value"), '20', 'Invalid coordinates are rejected');
    assert.equal(await exec("notices.at(-1).type"), 'error', 'Placement errors reach the overall error notification');
    const fieldValue = name => exec(`Number(document.querySelector('[data-figure-field=${name}]').value)`);
    const mouse = (type, x, y) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
    const middle = (await exec('blotBoxes()'))[0];
    mouse('mouseMove', middle.x, middle.y); await settle();
    const hover = await exec("(()=>{const box=document.querySelector('.gel-figure-hover-box');return {hidden:box.hidden,rect:box.getBoundingClientRect().toJSON(),cursor:el('gel-figure-preview').style.cursor}})()");
    assert.equal(hover.hidden, false, 'Hovering a blot outlines it');
    assert.equal(hover.cursor, 'grab');
    const grip = { x: hover.rect.right - 1, y: middle.y };
    mouse('mouseMove', grip.x, grip.y); await settle();
    assert.equal(await exec("el('gel-figure-preview').style.cursor"), 'ew-resize', 'A side grip offers proportional resizing');
    assert.equal(await exec("document.querySelector('.gel-figure-hover-box').dataset.resizeRight"), 'true', 'The right side displays its resize grip');
    await exec("action('save')"); await waitFor("el('gel-figure-status').textContent==='Figure project saved.'");
    const beforeGrip = await exec('savedSizeInfo()');
    mouse('mouseDown', grip.x, grip.y); mouse('mouseMove', grip.x - 25, grip.y); await settle();
    mouse('mouseUp', grip.x - 25, grip.y); await settle();
    await exec("action('save')"); await waitFor("el('gel-figure-status').textContent==='Figure project saved.'");
    const afterGrip = await exec('savedSizeInfo()');
    const widthFactor = afterGrip.rows[0].width / beforeGrip.rows[0].width;
    assert.ok(widthFactor < .99, 'Dragging the side grip reduces the selected gel size');
    assert.ok(Math.abs(afterGrip.rows[0].height / beforeGrip.rows[0].height - widthFactor) < 1e-8, 'A side drag keeps width and height proportional');
    assert.deepEqual(afterGrip.placement[1], beforeGrip.placement[1], 'A side drag leaves the other gel unchanged');
    assert.equal(afterGrip.placement[0].top, beforeGrip.placement[0].top, 'Canvas resizing preserves the top crop');
    assert.equal(afterGrip.placement[0].bottom, beforeGrip.placement[0].bottom, 'Canvas resizing preserves the bottom crop');
    assert.deepEqual((await exec('savedSizeInfo(true)')).rows, afterGrip.rows, 'Reopening preserves the canvas resize');
    await exec("controller.undo();action('save')"); await waitFor("el('gel-figure-status').textContent==='Figure project saved.'");
    assert.deepEqual((await exec('savedSizeInfo()')).placement, beforeGrip.placement, 'Undo restores the canvas resize');
    await exec("controller.redo();action('save')"); await waitFor("el('gel-figure-status').textContent==='Figure project saved.'");
    assert.deepEqual((await exec('savedSizeInfo()')).placement, afterGrip.placement, 'Redo reapplies the canvas resize');
    fs.writeFileSync(path.join(output, 'proportional-size.png'), (await win.webContents.capturePage()).toPNG());
    await exec('controller.undo()');
    const before = { first: await fieldValue('first'), last: await fieldValue('last'), top: await fieldValue('top') };
    mouse('mouseDown', middle.x, middle.y); mouse('mouseMove', middle.x + 40, middle.y); await settle();
    mouse('mouseUp', middle.x + 40, middle.y); await settle();
    const moved = { first: await fieldValue('first'), last: await fieldValue('last') };
    assert.ok(moved.first < before.first - 1, `Dragging right slides the blot: ${JSON.stringify({ before, moved })}`);
    assert.ok(Math.abs((moved.last - moved.first) - (before.last - before.first)) < 0.2, 'A move keeps the lane spacing');
    const edge = { x: middle.x, y: hover.rect.y + 2 };
    mouse('mouseMove', edge.x, edge.y); await settle();
    assert.equal(await exec("el('gel-figure-preview').style.cursor"), 'ns-resize', 'The top edge offers a crop');
    mouse('mouseDown', edge.x, edge.y); mouse('mouseMove', edge.x, edge.y + 15); await settle();
    mouse('mouseUp', edge.x, edge.y + 15); await settle();
    assert.ok(await fieldValue('top') > before.top + 1, 'Dragging the top edge down crops the blot');
    await exec('controller.undo()');
    assert.ok(Math.abs(await fieldValue('top') - before.top) < 0.05, 'Undo restores the crop');
    await exec('controller.undo()');
    assert.ok(Math.abs(await fieldValue('first') - before.first) < 0.05, 'Undo restores the position');
    // Place the first anchor at 20% again for the checks below.
    await exec("field('first',20);field('last',80)");
    await exec("click('gel-save-btn')"); await waitFor("el('gel-figure-status').textContent==='Figure project saved.'");
    assert.equal(JSON.parse(await exec("exports.findLast(item=>item.content).content")).stackName, 'ERK experiment', 'The toolbar Save icon saves the active figure project');
    const integrated = await exec("(()=>{const panel=el('gel-blot-figure'),stage=el('gel-viewer-stage'),rail=document.querySelector('.gel-setup-panel');return {inStage:panel.parentElement===stage,editorVisible:!document.querySelector('.gel-main-stack').hidden,railVisible:rail.checkVisibility(),railInteractive:!rail.inert,toolbarVisible:document.querySelector('.gel-viewer-toolbar').checkVisibility(),originalVisible:el('gel-image-row').checkVisibility()}})()");
    assert.deepEqual(integrated, { inStage: true, editorVisible: true, railVisible: true, railInteractive: true, toolbarVisible: true, originalVisible: false }, 'Stack stays inside the existing viewer with its sidebar and toolbars');
    await exec("click('gel-export-image-btn')"); await waitFor("el('gel-figure-status').textContent==='PNG exported.'");
    const untrimmedPng = await exec('pngInfo()');
    assert.equal(await exec("Boolean(el('gel-figure-trim-left') || el('gel-figure-trim-right'))"), false, 'Stack trim has no percentage fields');
    async function trimHandles() {
      return exec("['left','right'].map(edge=>{const h=document.querySelector('[data-trim-edge='+edge+']');return {rect:h.getBoundingClientRect().toJSON(),value:Number(h.getAttribute('aria-valuenow')),maximum:Number(h.getAttribute('aria-valuemax'))}})");
    }
    async function dragTrim(edge, delta) {
      const handle = (await trimHandles())[edge === 'left' ? 0 : 1].rect;
      const x = Math.round(handle.left + handle.width / 2), y = Math.round(handle.top + handle.height / 2);
      win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x,y});
      win.webContents.sendInputEvent({type:'mouseMove',button:'left',x:Math.round(x+delta),y});
      win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:Math.round(x+delta),y});
      await settle();
    }
    await exec("action('trim')"); await settle();
    assert.equal(await exec("document.querySelector('.gel-tool-panel-close').disabled && el('gel-open-figure-btn').inert"), true, 'Trim keeps Apply and Cancel accessible in the Layout panel');
    const fullEdges = await trimHandles();
    assert.equal(await exec("document.querySelectorAll('[data-trim-edge]').length"), 2, 'Trim opens two draggable edges on the full canvas');
    const inset = (fullEdges[1].rect.left - fullEdges[0].rect.left) * .15;
    await dragTrim('left', inset); await dragTrim('right', -inset);
    const placedEdges = await trimHandles();
    assert.ok(placedEdges[0].value > fullEdges[0].value && placedEdges[1].value < fullEdges[1].value, 'Dragging each edge narrows the kept area');
    await exec("const h=document.querySelector('[data-trim-edge=left]');h.focus();h.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}))");
    assert.ok((await trimHandles())[0].value > placedEdges[0].value, 'Arrow keys adjust the focused trim edge');
    await exec("document.querySelector('[data-trim-edge=left]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))");
    assert.equal(await exec("document.querySelectorAll('[data-trim-edge]').length"), 0, 'Escape cancels a pending trim');
    assert.equal(await exec("el('gel-blot-figure').hidden"), false, 'Canceling trim keeps the Stack open');
    await exec("action('save')"); await waitFor("el('gel-figure-status').textContent==='Figure project saved.'");
    assert.equal((await exec('trimCheck()')).mode, 'none', 'Cancel leaves the saved crop unchanged');
    await exec("action('trim')"); await settle();
    await dragTrim('left', inset); await dragTrim('right', -inset);
    await exec("action('apply-trim');action('save')"); await waitFor("el('gel-figure-status').textContent==='Figure project saved.'");
    const trimmed = await exec('trimCheck()');
    assert.equal(trimmed.mode, 'manual'); assert.equal(trimmed.coverage, true);
    assert.ok(trimmed.crop.left > 10 && trimmed.crop.right < 90, 'Canvas edges determine the saved trim');
    assert.ok(trimmed.imageWidth < trimmed.fullImageWidth);
    trimmed.edges.forEach(([left, right]) => assert.ok(left < 253 && right < 253, `Both blot edges contain image pixels (${left}, ${right})`));
    await exec("controller.undo();action('save')"); await waitFor("el('gel-figure-status').textContent==='Figure project saved.'");
    assert.equal((await exec('trimCheck()')).mode, 'none', 'Undo restores the full Stack');
    await exec("controller.redo();action('save')"); await waitFor("el('gel-figure-status').textContent==='Figure project saved.'");
    assert.deepEqual((await exec('trimCheck()')).crop, trimmed.crop, 'Redo restores the exact canvas trim');
    await exec("action('reset-trim');action('save')"); await waitFor("el('gel-figure-status').textContent==='Figure project saved.'");
    assert.equal((await exec('trimCheck()')).mode, 'none', 'Reset restores both full-image edges');
    await exec("controller.undo();action('save')"); await waitFor("el('gel-figure-status').textContent==='Figure project saved.'");
    for (const [width, height] of [[1440, 950], [1024, 768], [800, 700], [600, 800]]) {
      await exec("action('trim')");
      win.setSize(width, height); await settle();
      const resizedEdges = await trimHandles();
      const resizedCanvas = await exec("document.querySelector('#gel-figure-preview canvas').getBoundingClientRect().toJSON()");
      assert.ok(resizedEdges[0].rect.left + resizedEdges[0].rect.width / 2 >= resizedCanvas.left && resizedEdges[1].rect.left + resizedEdges[1].rect.width / 2 <= resizedCanvas.right, `Trim handles follow the canvas at ${width}×${height}`);
      assert.ok(Math.abs(resizedEdges[0].value / resizedEdges[0].maximum * 100 - trimmed.crop.left) < .15, 'Resizing preserves the chosen source edge');
      await exec("action('cancel-trim')");
      const bounds = await exec("(()=>{const p=el('gel-blot-figure').getBoundingClientRect();return {left:p.left,right:p.right,top:p.top,bottom:p.bottom,width:innerWidth,height:innerHeight,client:el('gel-blot-figure').clientWidth,scroll:el('gel-blot-figure').scrollWidth}})()");
      assert.ok(bounds.left >= 0 && bounds.right <= bounds.width + 1 && bounds.top >= 0 && bounds.bottom <= bounds.height + 1, `Board fits ${width}×${height}`);
      assert.ok(bounds.scroll <= bounds.client + 1, `No horizontal overflow at ${width}×${height}`);
      await exec("click('gel-figure-stack-btn')"); await settle();
      assert.equal((await exec('stackTree()')).length, 2, `Add stack creates one empty stack at ${width}×${height}`);
      assert.deepEqual((await exec('stackTree()'))[1].gels, []);
      assert.equal(await exec("Boolean(document.querySelector(':popover-open'))"), false, 'No picker opens at any viewport');
      await exec('controller.undo()');
      const geometry = await exec("(()=>{const rail=document.querySelector('.gel-setup-panel').getBoundingClientRect(),toolbar=document.querySelector('.gel-viewer-toolbar').getBoundingClientRect(),stage=el('gel-viewer-stage').getBoundingClientRect(),panel=el('gel-blot-figure').getBoundingClientRect();return {railRight:rail.right,stageLeft:stage.left,toolbarBottom:toolbar.bottom,toolbarLeft:toolbar.left,toolbarTop:toolbar.top,stageBottom:stage.bottom,stageTop:stage.top,stageRight:stage.right,panelRight:panel.right,previewWidth:el('gel-figure-preview').clientWidth}})()");
      assert.ok(geometry.railRight <= geometry.stageLeft && (geometry.toolbarLeft >= geometry.stageRight || geometry.toolbarTop >= geometry.stageBottom) && geometry.panelRight <= geometry.stageRight + 1 && geometry.previewWidth > 0, `Stack shares the Gel layout at ${width}×${height}`);
    }
    win.setSize(1440, 950); await settle();
    // Measure after the window is back to size: a resize round trip can return a
    // window one pixel taller, which is not what this check is about.
    const workspaceSettled = await exec("(()=>{const rail=document.querySelector('.gel-setup-panel'),toolbar=document.querySelector('.gel-viewer-toolbar');return {rail:rail.getBoundingClientRect().toJSON(),toolbar:toolbar.getBoundingClientRect().toJSON()}})()");
    fs.writeFileSync(path.join(output, 'figure.png'), (await win.webContents.capturePage()).toPNG());
    // focus() defers focusin until the window has OS focus, which another app can hold;
    // deliver the event the rail listens for so the check does not depend on the desktop.
    await exec("focusBlot(0);action('edit')"); await settle();
    await exec("if(el('gel-process-image-btn').getAttribute('aria-expanded')!=='true')click('gel-process-image-btn')"); await settle();
    await exec("const c=el('gel-contrast-strength');c.focus();if(!document.hasFocus())c.dispatchEvent(new FocusEvent('focusin',{bubbles:true}))");
    assert.equal(await exec("el('gel-blot-figure').hidden"), true, 'Process gel opens the selected layer with its editing tools on the right');
    assert.equal(await exec("el('gel-name').value"), 'β-actin');
    assert.equal(await exec('document.activeElement.id'), 'gel-contrast-strength', 'Keyboard focus stays on the requested processing control');
    const workspaceAfter = await exec("(()=>{const rail=document.querySelector('.gel-setup-panel'),toolbar=document.querySelector('.gel-viewer-toolbar');return {rail:rail.getBoundingClientRect().toJSON(),toolbar:toolbar.getBoundingClientRect().toJSON()}})()");
    assert.deepEqual(workspaceAfter.rail, workspaceSettled.rail, 'Switching back to processing retains the same sidebar geometry');
    assert.ok(Math.abs(workspaceAfter.toolbar.left - workspaceSettled.toolbar.left) < 1, 'The action card stays on the right in both processing and layout views');
    assert.equal(await exec("el('gel-navigation').checkVisibility() && !el('gel-navigation').querySelector('.gel-tool-group')"), true, 'The left rail remains navigation during processing');
    assert.equal(await exec("document.querySelectorAll('[data-figure-stack-member]').length"), 2, 'Stack lists its gel members as nested navigation');
    await exec("document.querySelector('[data-figure-row]').click()");
    assert.equal(await exec("el('gel-blot-figure').hidden"), true, 'Top-level gel navigation opens processing directly');
    await exec("document.querySelector('[data-figure-stack-member]').click()");
    assert.equal(await exec("el('gel-blot-figure').hidden"), true, 'Nested gel navigation opens processing directly');
    await exec("stackView()");
    await exec("document.body.classList.add('theme-night')"); await new Promise(r => setTimeout(r, 350));
    fs.writeFileSync(path.join(output, 'figure-night.png'), (await win.webContents.capturePage()).toPNG());
    await exec("click('gel-export-image-btn')"); await waitFor("el('gel-figure-status').textContent==='PNG exported.'");
    const png = await exec('pngInfo()'); assert.equal(png.width, trimmed.width, 'PNG dimensions follow the two saved trim edges'); assert.ok(png.height > 300); assert.equal(png.cyan, 0);
    assert.ok(png.width < untrimmedPng.width, 'PNG exports use the same cropped width as the preview');
    assert.equal(png.bandRows.length, 2);
    png.bandRows[0].forEach((center, index) => assert.ok(Math.abs(center - png.bandRows[1][index]) < 20, 'Exported band centers align across blots'));
    const pngData = await exec("exports.findLast(item=>item.fileName.endsWith('.png'))");
    fs.writeFileSync(path.join(output, 'export.png'), Buffer.from(pngData.dataBase64, 'base64'));
    await exec("click('gel-export-pptx-btn')"); await waitFor("el('gel-figure-status').textContent==='PPTX exported.'");
    const pptx = await exec('pptxInfo()'); assert.equal(pptx.images, 2, 'The existing viewer export includes the visible Stack');
    assert.match(pptx.xml, /<a:t>β-actin<\/a:t>/); assert.match(pptx.xml, /<a:t>p-ERK1\/2<\/a:t>/);
    assert.match(pptx.xml, /<a:t>Condition<\/a:t>/); assert.match(pptx.xml, /<a:t>S6<\/a:t>/);
    assert.equal((pptx.xml.match(/<a:tbl>/g) || []).length, 6, 'Shared lane table cells remain native PowerPoint tables');
    assert.equal((pptx.xml.match(/<p:pic>/g) || []).length, 2, 'Blots remain separate slide images');
    assert.doesNotMatch(pptx.xml, /anchor="mid"/);
    const pptxData = await exec("exports.findLast(item=>item.fileName.endsWith('.pptx'))");
    fs.writeFileSync(path.join(output, 'export.pptx'), Buffer.from(pptxData.dataBase64, 'base64'));
    await exec("action('save')"); await waitFor("el('gel-figure-status').textContent==='Figure project saved.'");
    const [header] = await exec('headerCheck()');
    assert.equal(header.label, 'p-ERK1/2', 'A table belongs only to the gel that owns it');
    assert.ok(header.tableTop > header.previousBottom && header.tableBottom < header.blotTop, 'The lower gel table sits below the preceding gel and above its own image');
    assert.deepEqual(header.values, [['S1'], ['S2'], ['S3'], ['S4'], ['S5'], ['S6']]);
    header.centers.forEach((center, index) => assert.ok(Math.abs(center - header.expected[index]) < 0.001, 'Table columns use the reference blot lane coordinates'));
    await exec("load('gel-figure-files',[await file('GAPDH.png',800,200,.1,.9)])");
    await waitFor("el('gel-blot-figure').getAttribute('aria-busy')==='false'");
    assert.equal(await exec('count()'), 3);
    assert.equal(await exec("el('gel-figure-preview-title').textContent"), 'ERK experiment', 'Importing in Layout keeps showing the Stack');
    await exec("renameRow('Gel 3','GAPDH');stackView()");
    assert.equal(await exec("el('gel-figure-preview-detail').textContent"), '2 gels', 'Importing a layer keeps the existing Stack intact');
    await exec("moveGel('p-ERK1/2','root');moveGel('GAPDH','stack');click('gel-export-pptx-btn')");
    await waitFor("el('gel-figure-status').textContent==='PPTX exported.'");
    const subset = await exec('pptxInfo()');
    assert.equal(subset.images, 2); assert.match(subset.xml, /<a:t>GAPDH<\/a:t>/);
    assert.match(subset.xml, /<a:t>β-actin<\/a:t>/); assert.doesNotMatch(subset.xml, /p-ERK1\/2|Condition/);
    assert.equal(await exec('count()'), 3, 'Stack keeps excluded gel layers available');
    await exec("controller.undo();controller.undo()");
    assert.equal(await exec("el('gel-figure-preview-title').textContent"), 'ERK experiment');
    await exec("click('gel-export-pptx-btn')"); await waitFor("el('gel-figure-status').textContent==='PPTX exported.'");
    assert.match((await exec('pptxInfo()')).xml, /p-ERK1\/2/, 'Undo restores the previous Stack membership');
    await exec("stackView()");
    await exec("edit('β-actin');click('gel-crop-mode-btn')");
    assert.equal(await exec("el('gel-blot-figure').hidden"), true, 'Crop acts on the gel opened from the rail');
    assert.equal(await exec("el('gel-name').value"), 'β-actin');
    await waitFor("el('gel-cropper-image').cropper?.ready");
    await exec("el('gel-cropper-image').cropper.setData({x:0,y:40,width:720,height:120,rotate:0});click('gel-apply-crop-btn');edit('p-ERK1/2')");
    assert.equal(await exec("el('gel-canvas').width"), 900, 'Cropping another blot leaves the first intact');
    await exec("edit('β-actin')");
    assert.equal(await exec("el('gel-canvas').height"), 120, 'Individual crops survive switching');
    // Reset lives in crop mode: it shows the full original, and Done keeps it.
    await exec("click('gel-crop-mode-btn')"); await waitFor("el('gel-cropper-image').cropper?.ready");
    await exec("click('gel-reset-crop-btn')"); await waitFor("el('gel-cropper-image').cropper?.ready");
    await exec("click('gel-apply-crop-btn')");
    assert.equal(await exec("el('gel-canvas').height"), 200, 'Reset restores this blot original');
    await exec("stackView()");
    await exec("cancelExport=true;action('save')"); await waitFor("el('gel-figure-status').textContent==='Save canceled.'");
    assert.equal(await exec('controller.hasUnsavedChanges()'), true);
    await exec("cancelExport=false;action('save')"); await waitFor("el('gel-figure-status').textContent==='Figure project saved.'");
    assert.equal(await exec('controller.hasUnsavedChanges()'), false);
    assert.equal(await exec('controller.saveUnsavedChanges()'), true);
    const savedProject = await exec("exports.findLast(item=>item.content).content");
    const savedLayers = JSON.parse(savedProject);
    assert.equal(savedLayers.version, 4); assert.equal(savedLayers.rows.length, 3);
    assert.equal(savedLayers.stackTrim.mode, 'manual');
    assert.equal(savedLayers.stackName, 'ERK experiment'); assert.equal(savedLayers.layoutName, 'Publication panel');
    assert.deepEqual(savedLayers.stack, [0, 1]); assert.deepEqual(savedLayers.checked, [], 'Projects do not retain unused stack-picker choices');
    await exec("window.savedProject=exports.findLast(item=>item.content).content;load('gel-figure-project-file',[new File([savedProject],'figure.json',{type:'application/json'})])");
    await waitFor("el('gel-figure-status').textContent==='Figure project opened.'");
    assert.equal(await exec('count()'), 3, 'Reopening a project reuses existing layers');
    assert.equal((await exec('stackTree()')).length, 1, 'Reopening a project reuses its Stack');
    await exec("load('gel-figure-project-file',[new File(['{}'],'bad.json',{type:'application/json'})])");
    await waitFor("el('gel-blot-figure').getAttribute('aria-busy')==='false'");
    assert.equal(await exec('count()'), 3); assert.match(await exec("el('gel-figure-status').textContent"), /supported/);
    await exec('controller.destroy()'); assert.equal(await exec("el('gel-blot-figure')"), null);
    await win.loadFile(fixture); await waitFor('Boolean(window.ready)');
    await exec(`window.savedProject=${JSON.stringify(savedProject)};load('gel-figure-project-file',[new File([savedProject],'layers.json',{type:'application/json'})])`);
    await waitFor("el('gel-figure-status').textContent==='Figure project opened.'");
    assert.equal(await exec('count()'), 3);
    assert.equal(await exec("document.querySelector('[data-figure-stack-view] span').textContent"), 'ERK experiment', 'Project reopening restores the Stack name');
    assert.equal(await exec("document.querySelector('[data-figure-layout-view]').textContent.trim()"), 'Publication panel', 'Project reopening restores the Layout name');
    assert.equal(await exec("Boolean(el('gel-figure-stack-picker'))"), false, 'Reopening a project does not restore a gel-picker step');
    await exec("stackView()");
    assert.equal(await exec("document.querySelector('[data-figure-action=reset-trim]').disabled"), false, 'Saved projects restore Stack trim');
    await exec("action('trim')");
    assert.ok((await trimHandles())[0].value > 0, 'Reopening trim places its left edge at the saved position');
    await exec("action('cancel-trim')");
    await exec("click('gel-export-pptx-btn')"); await waitFor("el('gel-figure-status').textContent==='PPTX exported.'");
    const restored = await exec('pptxInfo()');
    assert.equal(restored.images, 2); assert.match(restored.xml, /p-ERK1\/2/); assert.doesNotMatch(restored.xml, /GAPDH/);
    const originalHierarchy = await exec('hierarchy()');
    assert.deepEqual(originalHierarchy.outside, ['GAPDH']);
    assert.deepEqual(originalHierarchy.inside, ['β-actin', 'p-ERK1/2']);
    assert.equal(new Set(originalHierarchy.ids).size, 3, 'Every gel appears exactly once across the two groups');
    assert.deepEqual(await exec("moveGel('p-ERK1/2','stack','β-actin')"), {feedback:true,cleared:true}); await settle();
    assert.deepEqual((await exec('hierarchy()')).inside, ['p-ERK1/2','β-actin'], 'Dropping before another Stack member reorders it');
    await exec('controller.undo()');
    assert.deepEqual((await exec('hierarchy()')).inside, originalHierarchy.inside);
    await exec('stackView()');
    assert.deepEqual(await exec("moveGel('p-ERK1/2','root')"), {feedback:true,cleared:true}); await settle();
    const movedOut = await exec('hierarchy()');
    assert.deepEqual(movedOut.outside, ['GAPDH','p-ERK1/2']);
    assert.deepEqual(movedOut.inside, ['β-actin'], 'Dragging out removes the gel from Stack');
    assert.equal(new Set(movedOut.ids).size, 3, 'Moving out does not create a copy');
    await exec("action('save')"); await waitFor("el('gel-figure-status').textContent==='Figure project saved.'");
    const movedProject = await exec("exports.findLast(item=>item.content).content");
    const movedData = JSON.parse(movedProject);
    for (const row of savedLayers.rows) assert.deepEqual(movedData.rows.find(item=>item.label===row.label), row, 'Moving preserves image data, processing, and placement');
    assert.equal(movedData.stack.length, 1);
    assert.equal(await exec("el('gel-figure-preview-title').textContent"), 'ERK experiment', 'Dragging preserves the current Stack view');
    await exec("click('gel-export-pptx-btn')"); await waitFor("el('gel-figure-status').textContent==='PPTX exported.'");
    const movedExport = await exec('pptxInfo()');
    assert.equal(movedExport.images, 1, 'Exports immediately reflect membership after dragging');
    assert.doesNotMatch(movedExport.xml, /p-ERK1\/2|GAPDH/);
    await exec('controller.undo()');
    assert.deepEqual((await exec('hierarchy()')).inside, originalHierarchy.inside, 'Undo returns the gel to its original group and order');
    await exec('controller.redo()');
    assert.deepEqual((await exec('hierarchy()')).inside, ['β-actin']);
    await exec("moveGel('β-actin','root')"); await settle();
    assert.deepEqual((await exec('hierarchy()')).inside, [], 'The last gel can be dragged out');
    assert.equal(await exec("document.querySelector('[data-figure-stack-view]').disabled"), false, 'An empty Stack remains available as a drop target');
    assert.equal(await exec("Boolean(el('gel-figure-preview').querySelector('canvas'))"), false);
    await exec("action('save')"); await waitFor("el('gel-figure-status').textContent==='Figure project saved.'");
    const emptyStackProject = await exec("exports.findLast(item=>item.content).content");
    assert.equal(JSON.parse(emptyStackProject).hasStack, true, 'A previously created empty Stack is distinct from a new workspace');
    await exec("moveGel('β-actin','stack')"); await settle();
    assert.deepEqual((await exec('hierarchy()')).inside, ['β-actin'], 'Dragging into an empty Stack works');
    await exec("moveGel('p-ERK1/2','stack')"); await settle();
    assert.deepEqual((await exec('hierarchy()')).inside, originalHierarchy.inside);
    await exec("const b=[...document.querySelectorAll('[data-figure-row]')].find(b=>b.textContent.trim()==='GAPDH');b.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',altKey:true,bubbles:true,cancelable:true}))");
    assert.equal((await exec('hierarchy()')).inside.length, 3, 'Keyboard movement can add a gel to Stack');
    await exec("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',altKey:true,bubbles:true,cancelable:true}))");
    const beforeCanceledDrag = await exec('hierarchy()');
    assert.deepEqual(await exec("moveGel('p-ERK1/2','outside')"), {feedback:false,cleared:true}); await settle();
    assert.deepEqual(await exec('hierarchy()'), beforeCanceledDrag, 'A drop outside the navigator leaves all gels in place');
    await win.loadFile(fixture); await waitFor('Boolean(window.ready)');
    await exec(`load('gel-figure-project-file',[new File([${JSON.stringify(emptyStackProject)}],'empty-stack.json',{type:'application/json'})])`);
    await waitFor("el('gel-figure-status').textContent==='Figure project opened.'");
    assert.equal(await exec("Boolean(document.querySelector('[data-figure-stack-view]'))"), true, 'Reopening retains an explicitly created Stack after all gels have been moved out');
    assert.deepEqual((await exec('hierarchy()')).inside, []);
    await win.loadFile(fixture); await waitFor('Boolean(window.ready)');
    await exec(`load('gel-figure-project-file',[new File([${JSON.stringify(movedProject)}],'moved.json',{type:'application/json'})])`);
    await waitFor("el('gel-figure-status').textContent==='Figure project opened.'");
    assert.deepEqual((await exec('hierarchy()')).outside, movedOut.outside, 'Reopening preserves top-level membership');
    assert.deepEqual((await exec('hierarchy()')).inside, movedOut.inside, 'Reopening preserves Stack membership');
    await win.loadFile(fixture); await waitFor('Boolean(window.ready)');
    await exec(`load('gel-figure-project-file',[new File([${JSON.stringify(savedProject)}],'layers.json',{type:'application/json'})])`);
    await waitFor("el('gel-figure-status').textContent==='Figure project opened.'");
    // In a Stack, dragging one blot aligns that blot only.
    await exec("stackView()"); await settle();
    const firstOf = async position => { await exec(`focusBlot(${position})`); return Number(await exec("document.querySelector('[data-figure-field=first]').value")); };
    const stackBefore = [await firstOf(0), await firstOf(1)];
    const lower = await exec(`(()=>{const p=el('gel-figure-preview'),c=p.querySelector('canvas').getBoundingClientRect(),box=p.querySelector('.gel-figure-hover-box'),x=c.left+c.width*.6;
      for(let y=c.bottom-3;y>c.top;y-=4){p.dispatchEvent(new PointerEvent('pointermove',{clientX:x,clientY:y,bubbles:true}));if(!box.hidden){const r=box.getBoundingClientRect();return {x,y:r.top+r.height/2};}}return null})()`);
    assert.ok(lower, 'The lower Stack blot can be hovered');
    const stackMouse = (type, x) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(lower.y), button: 'left', clickCount: 1 });
    stackMouse('mouseMove', lower.x); await settle();
    fs.writeFileSync(path.join(output, 'stack-hover.png'), (await win.webContents.capturePage()).toPNG());
    stackMouse('mouseDown', lower.x); stackMouse('mouseMove', lower.x + 40); await settle(); stackMouse('mouseUp', lower.x + 40); await settle();
    const stackAfter = [await firstOf(0), await firstOf(1)];
    assert.equal(stackAfter[0], stackBefore[0], 'The other Stack blot stays put');
    assert.ok(stackAfter[1] < stackBefore[1] - 1, `The dragged Stack blot moves: ${JSON.stringify({ stackBefore, stackAfter })}`);
    await exec('controller.undo()'); await exec("stackView()");
    // Dragging a Stack blot up past the one above reorders the Stack and the layer list.
    const stackOrder = () => exec("[...document.querySelectorAll('[data-figure-stack-member]')].map(button=>button.textContent.trim())");
    const orderBefore = await stackOrder();
    const top = await exec("document.querySelector('#gel-figure-preview canvas').getBoundingClientRect().top");
    win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(lower.x), y: Math.round(lower.y), button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(lower.x), y: Math.round(top + 4), button: 'left' }); await settle();
    win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(lower.x), y: Math.round(top + 4), button: 'left', clickCount: 1 }); await settle();
    assert.deepEqual(await stackOrder(), [...orderBefore].reverse(), 'Dragging a blot above another reorders the Stack');
    await exec('controller.undo()');
    assert.deepEqual(await stackOrder(), orderBefore, 'Undo restores the Stack order');
    await exec("stackView()");
    await exec("load('gel-figure-files',[await file('next.png',600,120,.1,.9)])");
    await waitFor("el('gel-blot-figure').getAttribute('aria-busy')==='false'");
    assert.equal(await exec('count()'), 4);
    assert.equal(await exec("el('gel-figure-preview-title').textContent"), 'ERK experiment', 'Importing in Layout keeps showing the Stack');
    await exec('controller.destroy()');
    // Durable workspace recovery uses the real chunk/manifest adapter, with
    // browser storage standing in for Hikari's atomic plugin-file bridge.
    await exec('localStorage.clear()');
    await win.loadFile(fixture,{query:{autosave:'1'}}); await waitFor('Boolean(window.ready)');
    assert.equal(await exec('controller.hasUnsavedChanges()'),false);
    assert.equal(await exec('workspaceWrites'),0,'Opening an empty workspace does not write');
    await exec("load('gel-figure-files',[await file('auto-a.png',300,100,.1,.9),await file('auto-b.png',320,110,.2,.8)])");
    await waitFor('count()===2'); await waitFor("el('gel-blot-figure').getAttribute('aria-busy')==='false'");
    await exec("edit('Gel 1');set('gel-denoise-strength','42');set('gel-contrast-strength','160');controller.hasUnsavedChanges()");
    await exec("action('stack');renameStack(0,'Autosaved stack');renameStack(0,'Autosaved layout',true);moveGel('Gel 1','stack')"); await settle();
    await exec("action('stack');renameStack(1,'Empty control');stackView(0);action('trim');document.querySelector('[data-trim-edge=left]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));action('apply-trim')");
    await waitFor("workspaceWrites>0 && !controller.hasUnsavedChanges()");
    assert.equal(await exec('controller.saveUnsavedChanges()'),true,'Quit flushes workspace storage without a file dialog');
    assert.equal(await exec('exports.length'),0,'Automatic workspace save does not export a project');
    const durableTree=await exec('stackTree()');
    assert.deepEqual(durableTree.map(s=>({name:s.name,layout:s.layout,gels:s.gels})),[
      {name:'Autosaved stack',layout:'Autosaved layout',gels:['Gel 1']},{name:'Empty control',layout:'Layout',gels:[]}
    ]);
    const portable=await exec("action('save');exports.findLast(item=>item.content)?.content");
    await waitFor("el('gel-figure-status').textContent==='Figure project saved.'");
    const autoBackup=portable||await exec("exports.findLast(item=>item.content).content");
    await exec('controller.destroy()');
    await win.loadFile(fixture,{query:{autosave:'1'}}); await waitFor('Boolean(window.ready)');
    assert.deepEqual(await exec('stackTree()'),durableTree,'Restart restores multiple stacks, empty stacks, layout names and membership');
    assert.equal(await exec('controller.hasUnsavedChanges()'),false,'Restoration is clean');
    assert.equal(await exec("document.querySelector('[data-figure-action=reset-trim]').disabled"),false,'Restart restores canvas trim');
    await exec("edit('Gel 1')");
    assert.equal(await exec("el('gel-denoise-strength').value"),'42','Restart restores individual processing');
    assert.equal(await exec("el('gel-contrast-strength').value"),'160');
    const beforeBrowseWrites=await exec('workspaceWrites');
    await exec("edit('Gel 2');controller.hasUnsavedChanges()"); await settle();
    assert.equal(await exec('controller.hasUnsavedChanges()'),false,'Browsing restored gels stays clean');
    assert.equal(await exec('workspaceWrites'),beforeBrowseWrites);
    await exec(`load('gel-figure-project-file',[new File([${JSON.stringify(autoBackup)}],'same-backup.json')])`);
    await waitFor("el('gel-figure-status').textContent==='Figure project opened.'");
    assert.equal(await exec('count()'),2,'Reopening a backup reconnects saved library records');
    assert.equal((await exec('stackTree()')).length,2,'Reopening a backup does not duplicate stacks');
    await exec("failWorkspaceSave=true;renameStack(0,'Unsaved revision')");
    assert.equal(await exec('controller.saveUnsavedChanges()'),false,'A failed save is reported to the quit guard');
    assert.equal(await exec('controller.hasUnsavedChanges()'),true,'Failed writes remain dirty');
    await exec('failWorkspaceSave=false');
    assert.equal(await exec('controller.saveUnsavedChanges()'),true,'A failed workspace save can be retried');
    await exec('controller.undo()');
    assert.equal(await exec('controller.saveUnsavedChanges()'),true,'Undo is persisted');
    assert.equal((await exec('stackTree()'))[0].name,'Autosaved stack');
    await exec('controller.redo()');
    assert.equal(await exec('controller.saveUnsavedChanges()'),true,'Redo is persisted');
    await exec('controller.destroy()');
    await win.loadFile(fixture,{query:{autosave:'1'}}); await waitFor('Boolean(window.ready)');
    assert.equal((await exec('stackTree()'))[0].name,'Unsaved revision','Restart restores the redo result');
    fs.writeFileSync(path.join(output,'stack-autosave-restored.png'),(await win.webContents.capturePage()).toPNG());
    // First upgrade: legacy backups must reconnect the existing library, even
    // when no automatic workspace snapshot has ever been written.
    const legacyBackup=JSON.parse(autoBackup); legacyBackup.version=3;
    legacyBackup.rows.forEach(row=>{delete row.id;delete row.recordId});legacyBackup.stacks.forEach(stack=>delete stack.id);
    await exec("controller.destroy();localStorage.removeItem('workspace-files')");
    await win.loadFile(fixture,{query:{autosave:'1'}}); await waitFor('Boolean(window.ready)');
    assert.equal(await exec("document.querySelectorAll('[data-figure-row]').length"),2,'Saved library appears before restoring a legacy backup');
    await exec(`load('gel-figure-project-file',[new File([${JSON.stringify(JSON.stringify(legacyBackup))}],'legacy.json')])`);
    await waitFor("el('gel-figure-status').textContent==='Figure project opened.'");
    assert.equal(await exec("document.querySelectorAll('[data-figure-row]').length"),2,'Legacy import reuses matching saved images without extra rail entries');
    await exec(`load('gel-figure-project-file',[new File([${JSON.stringify(JSON.stringify(legacyBackup))}],'legacy-again.json')])`);
    await waitFor("el('gel-blot-figure').getAttribute('aria-busy')==='false'");
    assert.equal(await exec('count()'),2,'Legacy project identity is repeatable');
    assert.equal((await exec('stackTree()')).length,2,'Legacy reopening reuses empty stacks too');
    assert.equal(await exec('controller.saveUnsavedChanges()'),true);
    await exec('controller.destroy()');
    // A malformed saved workspace must leave the library available and must
    // never be replaced by the empty state shown after a failed restoration.
    await exec("const files=JSON.parse(localStorage.getItem('workspace-files'));files['Workspace/current.json']=btoa('{}');files['Workspace/previous.json']=btoa('{}');localStorage.setItem('workspace-files',JSON.stringify(files))");
    const corruptWorkspace=await exec("localStorage.getItem('workspace-files')");
    await win.loadFile(fixture,{query:{autosave:'1'}}); await waitFor('Boolean(window.ready)');
    assert.equal(await exec("document.querySelectorAll('[data-figure-row]').length"),2,'A failed workspace restore retains the saved gel library');
    assert.equal(await exec("notices.some(item=>item.type==='error'&&item.message.includes('Could not restore the Gel workspace'))"),true);
    await exec("action('stack')");
    assert.equal(await exec('controller.hasUnsavedChanges()'),true);
    assert.equal(await exec('controller.saveUnsavedChanges()'),false,'A failed restore blocks overwriting the saved workspace');
    assert.equal(await exec("localStorage.getItem('workspace-files')"),corruptWorkspace,'The unavailable saved workspace is preserved');
    await exec('controller.destroy()');
    assert.deepEqual(errors, []);
    console.log('gel-blot-figure-electron: passed (file drops, TIFF, import limits, scrolling tree, multiple stacks, exclusive membership, per-stack settings, undo/redo, shared workspace, toolbar, trim, processing, lane/table alignment, 4 viewports, PNG/PPTX, project migration/roundtrip, precision, automatic stack recovery, legacy deduplication, failed-save retry, disposal)');
  } finally { win.destroy(); app.quit(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; if (process.versions.electron) require('electron').app.exit(1); });
