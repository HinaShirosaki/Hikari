const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
if(!process.versions.electron){
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'hikari-plate-import-storage-'));
 const result=require('node:child_process').spawnSync(require('electron'),[__filename,scratch],{encoding:'utf8',timeout:120000});
 process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
 fs.rmSync(scratch,{recursive:true,force:true});
 if(result.status!==0)throw result.error||new Error(`Plate import storage check failed: ${result.status}`);
}else{
 const {app,BrowserWindow,ipcMain}=require('electron');
 const {createStorageFileHelpers}=require('../src/main/ipc/register-data-ipc/storage-files.js');
 const {parseAssayResultImportFile}=require('../src/main/lib/chemical-import-parser.js');
 const scratch=process.argv[2],storagePath=path.join(scratch,'workspace');
 app.setPath('userData',path.join(scratch,'profile'));
 const helpers=createStorageFileHelpers({fs:fsp,cleanText:value=>String(value||'').trim(),getStorageRoot:()=>storagePath});
 let parseWait=null,parseStarted=null;
 const parse=async payload=>{parseStarted?.();if(parseWait)await parseWait;return parseAssayResultImportFile(payload);};
 for(const [channel,run] of [['qa:store',payload=>helpers.storeImportedFile(payload)],['qa:json',payload=>helpers.writeJsonStorageFile(payload)],['qa:parse',parse]])
  ipcMain.handle(channel,async(_event,payload)=>{try{return {ok:true,...await run(payload)};}catch(error){return {ok:false,error:error.message};}});
 const source1='100,90,80,70,60,50,40,30\r\n200,180,160,140,120,100,80,60\r\n';
 const source2='10,9,8,7,6,5,4,3\r\n20,18,16,14,12,10,8,6\r\n';
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 let win;
 async function main(){
  await app.whenReady();
  const preload=path.join(scratch,'preload.cjs');
  fs.writeFileSync(preload,`const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('hikariApi',{storeImportedFile:p=>ipcRenderer.invoke('qa:store',p),writeJsonFile:p=>ipcRenderer.invoke('qa:json',p),parseAssayResultImportFile:p=>ipcRenderer.invoke('qa:parse',p)});`);
  let html=require('./support/assay-workspace-qa.cjs')({root,url:file=>pathToFileURL(path.join(root,file)).href});
  html=html.replace('projects:[],notebookEntries:[],settings:{}',`projects:[],notebookEntries:[],settings:{storagePath:${JSON.stringify(storagePath)}}`);
  const fixture=path.join(scratch,'qa.html');fs.writeFileSync(fixture,html);
  win=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{preload,contextIsolation:true,nodeIntegration:false}});
  const errors=[];win.webContents.on('console-message',event=>{if(event.level==='error'&&!event.message.includes('Content Security Policy'))errors.push(event.message);});
  const js=code=>win.webContents.executeJavaScript(code);
  async function waitFor(check,message){for(let i=0;i<150;i++){if(await check())return;await pause(40);}throw new Error(message);}
  async function load(){await win.loadFile(fixture);await waitFor(()=>js('Boolean(window.qa)'),'Plate did not initialize');await js('qa.ready()');}
  async function read(file){try{return await fsp.readFile(file,'utf8');}catch{return '';}}
  await load();
  await waitFor(()=>js('Boolean(qa.state.assays[0].latestAnalysis?.chartPath)'),'The analysis chart was not saved');
  const preview=()=>js(`(() => {const analysis=qa.state.assays[0].latestAnalysis;
   return analysis && {analyzedAt:analysis.analyzedAt,chartPath:analysis.chartPath,hasImage:analysis.chartDataUrl.startsWith('data:image/svg+xml')};
  })()`);
  const beforeSave=await preview();
  assert.equal(beforeSave.hasImage,true);
  await js("document.getElementById('assay-save-results-btn').click()");
  assert.deepEqual(await preview(),beforeSave,'saving unchanged results keeps the completed analysis preview');
  const savedAssay=await js('(({updatedAt,analysisResultPath})=>({updatedAt,analysisResultPath}))(qa.state.assays[0])');
  await waitFor(async()=>{
   const saved=JSON.parse(await read(savedAssay.analysisResultPath)||'null');
   return saved?.updatedAt===savedAssay.updatedAt&&saved.latestAnalysis?.chartPath===beforeSave.chartPath;
  },'the saved analysis record did not retain the chart');
  async function importFile(content,drop){
   await js(`(() => {const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(content)}],'original-plate.csv',{type:'text/csv'}));
    ${drop ? "document.querySelector('.assay-results-layout').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));" : "const input=document.getElementById('assay-result-file-input');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));"}
   })()`);
  }
  await importFile(source1,false);
  await waitFor(async()=>{await js("if(!document.getElementById('assay-result-import-overlay').hidden)document.getElementById('assay-result-import-apply-btn').click()");return js('(qa.state.assays[0].resultAttachments||[]).length===1');},'Attached result was not retained');
  const first=await js('qa.state.assays[0].resultAttachments[0]');
  assert.equal(await read(first.filePath),source1,'Attach retains the complete original file');
  assert.equal(await js('qa.state.assays[0].resultValues.A1'),'100');
  await importFile(source2,true);
  await waitFor(async()=>{await js("if(!document.getElementById('assay-result-import-overlay').hidden)document.getElementById('assay-result-import-apply-btn').click()");return js('(qa.state.assays[0].resultAttachments||[]).length===2');},'Dropped result was not retained');
  const second=await js('qa.state.assays[0].resultAttachments[1]');
  assert.notEqual(first.filePath,second.filePath);
  assert.equal(await read(first.filePath),source1,'a second import preserves the previous source file');
  assert.equal(await read(second.filePath),source2,'Drop retains the complete original file');
  await waitFor(()=>js('Boolean(qa.state.assays[0].plateCsvFiles?.original?.filePath)'),'CSV files were not saved');
  const csv=await js('qa.state.assays[0].plateCsvFiles');
  await waitFor(async()=>/\r\nA,10,9,8,7,6,5,4,3,/.test(await read(csv.original.filePath)),'original CSV did not follow the import');
  await js("document.getElementById('assay-transform-open-btn').click()");await pause(100);
  await js("Tabulator.findTable(document.querySelector('#assay-derived-plate-table .tabulator'))[0].getRow(0).getCell('c1').setValue('=Table1:A1*2')");
  await waitFor(async()=>/\r\nA,20,/.test(await read(csv.transformed.filePath)),'transformed CSV did not save the formula result');
  await js("Tabulator.findTable(document.querySelector('#assay-result-table .tabulator'))[0].getRow(0).getCell('c1').setValue('6')");
  await waitFor(async()=>/\r\nA,6,9,/.test(await read(csv.original.filePath))&&/\r\nA,12,/.test(await read(csv.transformed.filePath)),'editing Table1 did not update both CSVs');
  await js("Tabulator.findTable(document.querySelector('#assay-derived-plate-table .tabulator'))[0].getRow(0).getCell('c2').setValue('=1/0')");
  await waitFor(async()=>/\r\nA,12,#ERROR,/.test(await read(csv.transformed.filePath)),'CSV did not preserve the formula error');
  assert.equal(await read(second.filePath),source2,'plate edits leave the original imported file untouched');
  await js("document.getElementById('assay-save-results-btn').click()");await pause(200);
  await load();
  assert.equal(await js('qa.state.assays[0].resultAttachments.length'),2,'source attachments survive reload');
  assert.equal(await js('qa.state.assays[0].transformSpec.formulas.A1'),'=Table1:A1*2','the transform survives reload');
  assert.equal(await read(csv.original.filePath).then(text=>/\r\nA,6,9,/.test(text)),true);
  assert.equal(await read(csv.transformed.filePath).then(text=>/\r\nA,12,#ERROR,/.test(text)),true);
  let releaseParse;
  parseWait=new Promise(resolve=>{releaseParse=resolve;});
  const parsing=new Promise(resolve=>{parseStarted=resolve;});
  await importFile(source1,false);await parsing;
  await js("qa.state.assays.push({id:'other-plate',name:'Other plate',plateType:'96',sampleAxis:'row',wellLayout:qa.state.assays[0].wellLayout,resultValues:{A1:'777'}});qa.module.renderList();document.querySelector('[data-assay-results-select=other-plate]').click()");
  releaseParse();
  await waitFor(()=>js("document.querySelector('[data-hikari-transient-toast]')?.textContent.includes('selected assay changed')"),'a changed assay was not detected during import');
  assert.equal(await js("qa.state.assays.find(assay=>assay.id==='other-plate').resultValues.A1"),'777','an in-flight import never overwrites a different plate');
  assert.equal(await js('qa.state.assays[0].resultAttachments.length'),2);
  assert.deepEqual(errors,[],'no renderer errors during import, saves or reload');
  console.log('Plate file retention, attach/drop, independent CSVs, edits, formulas, errors, reload and import targeting passed');
  win.destroy();app.exit(0);
 }
 main().catch(error=>{console.error(error);win?.destroy();app.exit(1);});
}
