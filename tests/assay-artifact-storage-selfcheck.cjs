const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadEsmStyleModule, createMockDocument } = require('./support/runtime.js');
const { createStorageFileHelpers } = require('../src/main/ipc/register-data-ipc/storage-files.js');
const root = path.resolve(__dirname, '..');
const modulePath = path.join(root, 'src/renderer/modules/assay/artifact-storage.js');
const { buildAssayPlateCsvFiles } = loadEsmStyleModule(path.join(root, 'src/renderer/modules/assay/plate-csv.js'));
const makeAssay = () => ({ id:'plate-1',name:'Protein assay',plateType:'6',resultValues:{A1:'0',A2:'1,234',A3:'蛋白 "α"\nready',B1:'3'},
  analysisGroups:{row:'Controls: B',column:''},transformSpec:{mode:'cells',enabled:true,formulas:{A1:'=Table1:A1*2',A2:'=Table1:B1+2',A3:'=1/0',B1:'=Table2:A2*2',B2:'=MEAN(Table1:Controls)'}} });
const originalCsv = ',1,2,3\r\nA,0,"1,234","蛋白 ""α""\nready"\r\nB,3,,\r\n';
const transformedCsv = ',1,2,3\r\nA,0,5,#ERROR\r\nB,10,3,\r\n';
async function fixture(work) {
  const storageRoot=await fs.mkdtemp(path.join(os.tmpdir(),'hikari-plate-csv-'));
  const state={settings:{storagePath:storageRoot},notebookEntries:[],assays:[makeAssay()]};
  const helpers=createStorageFileHelpers({fs,cleanText:value=>String(value||'').trim(),getStorageRoot:()=>storageRoot});
  const api={storeImportedFile:async payload=>({ok:true,...await helpers.storeImportedFile(payload)}),writeJsonFile:async payload=>({ok:true,...await helpers.writeJsonStorageFile(payload)})};
  let saves=0,ids=0;
  const {createAssayArtifactStorage}=loadEsmStyleModule(modulePath,{window:{hikariApi:api},document:createMockDocument(),console:{...console,warn(){}}});
  const createStorage=()=>createAssayArtifactStorage({state,createId:()=>`file-${++ids}`,getAssayById:id=>state.assays.find(assay=>assay.id===id),getActiveResultsAssay:()=>state.assays[0],persist:()=>{saves++;}});
  try { await work({storageRoot,state,api,storage:createStorage(),createStorage,getSaves:()=>saves}); }
  finally { await fs.rm(storageRoot,{recursive:true,force:true}); }
}

test('CSV snapshots retain plate coordinates, zero, Unicode, quotes, computed values and errors', () => {
  const assay=makeAssay(),before=JSON.stringify(assay),files=buildAssayPlateCsvFiles(assay);
  assert.equal(files.original.content,originalCsv);
  assert.equal(files.transformed.content,transformedCsv);
  assert.equal(JSON.stringify(assay),before,'exports never mutate plate data or formulas');
  const large=buildAssayPlateCsvFiles({plateType:'1536',resultValues:{AF48:'42'}}).original.content;
  assert.equal(large.split('\r\n').length,34,'all 32 rows are saved even when hidden in the UI');
  assert.ok(large.endsWith(',42\r\n'));
  assert.match(large,/\r\nAF,/);
});

test('original result bytes survive separate CSV saves, duplicate names, edits and reload', async () => {
  await fixture(async ({storageRoot,state,storage,createStorage}) => {
    const source=Buffer.from(originalCsv,'utf8');
    const attachment=await storage.persistAssayResultAttachment({assayId:'plate-1',fileName:'original-plate.csv',dataBase64:source.toString('base64'),candidate:{format:'csv',rows:2,columns:3}});
    state.assays[0].resultAttachments=[attachment];
    const folder=storage.buildAssayArtifactFolder(state.assays[0]);
    assert.equal(path.dirname(attachment.filePath),path.join(folder,'result-files'));
    assert.equal((await storage.persistAssayArtifacts('plate-1')).ok,true);
    assert.deepEqual(await fs.readFile(attachment.filePath),source);
    assert.equal(await fs.readFile(path.join(folder,'original-plate.csv'),'utf8'),originalCsv);
    assert.equal(await fs.readFile(path.join(folder,'transformed-plate.csv'),'utf8'),transformedCsv);
    const second=await storage.persistAssayResultAttachment({fileName:'original-plate.csv',dataBase64:source.toString('base64')});
    assert.notEqual(second.filePath,attachment.filePath,'repeated imports retain both source files');
    const simultaneous=await Promise.all(['third source','fourth source'].map(content=>storage.persistAssayResultAttachment({fileName:'original-plate.csv',dataBase64:Buffer.from(content).toString('base64')})));
    assert.notEqual(simultaneous[0].filePath,simultaneous[1].filePath,'simultaneous imports cannot overwrite each other');
    assert.equal(await fs.readFile(simultaneous[0].filePath,'utf8'),'third source');
    assert.equal(await fs.readFile(simultaneous[1].filePath,'utf8'),'fourth source');
    const workbookBytes=Buffer.from([0x50,0x4b,0x03,0x04,0,0xff,0x80]);
    const workbook=await storage.persistAssayResultAttachment({fileName:'instrument.xlsx',dataBase64:workbookBytes.toString('base64')});
    assert.deepEqual(await fs.readFile(workbook.filePath),workbookBytes,'binary result files are retained byte for byte');
    const definition=JSON.parse(await fs.readFile(path.join(folder,'assay-definition.json'),'utf8'));
    const analysis=JSON.parse(await fs.readFile(path.join(folder,'analysis-result.json'),'utf8'));
    assert.equal(definition.plateCsvFiles.original.relativePath,path.relative(storageRoot,path.join(folder,'original-plate.csv')).split(path.sep).join('/'));
    assert.equal(analysis.plateCsvFiles.transformed.fileName,'transformed-plate.csv');
    state.assays[0]={...definition,...analysis,id:'plate-1'};
    assert.equal((await createStorage().persistAssayArtifacts('plate-1')).ok,true);
    assert.equal(await fs.readFile(path.join(folder,'transformed-plate.csv'),'utf8'),transformedCsv,'saved group references and formulas rebuild the same transformed CSV');
    state.assays[0].resultValues.B1='4';
    await storage.persistAssayArtifacts('plate-1');
    assert.match(await fs.readFile(path.join(folder,'transformed-plate.csv'),'utf8'),/A,0,6,#ERROR\r\nB,12,4,/);
    assert.deepEqual(await fs.readFile(attachment.filePath),source,'updating either plate never overwrites the imported source');
    state.assays[0].transformSpec={mode:'cells',enabled:false,formulas:{}};
    await storage.persistAssayArtifacts('plate-1');
    assert.equal(await fs.readFile(path.join(folder,'transformed-plate.csv'),'utf8'),',1,2,3\r\nA,,,\r\nB,,,\r\n','removing the transform clears stale CSV values');
    assert.deepEqual((await fs.readdir(folder)).sort(),['analysis-result.json','assay-definition.json','original-plate.csv','result-files','transformed-plate.csv']);
  });
});

test('linked plates keep their result files and separate CSVs in the notebook plate folder', async () => {
  await fixture(async ({storageRoot,state,storage}) => {
    const notebook=path.join(storageRoot,'Project','Study','Notebook','Page');
    state.notebookEntries=[{id:'note-1',storageFolder:notebook}];state.assays[0].notebookEntryId='note-1';
    assert.equal((await storage.persistAssayArtifacts('plate-1')).ok,true);
    assert.equal(path.dirname(state.assays[0].storageFolder),path.join(notebook,'plate'));
    assert.equal(await fs.readFile(state.assays[0].plateCsvFiles.original.filePath,'utf8'),originalCsv);
  });
});

test('queued saves freeze data and cannot let an older write replace the latest CSV', async () => {
  await fixture(async ({state,storage,api}) => {
    const store=api.storeImportedFile;let release,entered;
    const started=new Promise(resolve=>{entered=resolve;});const blocked=new Promise(resolve=>{release=resolve;});let first=true;
    api.storeImportedFile=async payload=>{if(first){first=false;entered();await blocked;}return store(payload);};
    const older=storage.persistAssayArtifacts('plate-1');await started;
    state.assays[0].resultValues.A1='42';const newer=storage.persistAssayArtifacts('plate-1');
    state.assays[0].resultValues.A1='999';release();
    assert.equal((await older).ok,true);assert.equal((await newer).ok,true);
    assert.match(await fs.readFile(state.assays[0].plateCsvFiles.original.filePath,'utf8'),/\r\nA,42,/);
    assert.match(await fs.readFile(state.assays[0].plateCsvFiles.transformed.filePath,'utf8'),/\r\nA,84,/);
    assert.equal(state.assays[0].resultValues.A1,'999','completion never writes a stale plate model back into the current state');
  });
});

test('failed CSV writes report failure and allow the next save to recover', async () => {
  await fixture(async ({storage,api,state,getSaves}) => {
    const store=api.storeImportedFile;api.storeImportedFile=async()=>({ok:false,error:'Disk full'});
    const failed=await storage.persistAssayArtifacts('plate-1');assert.equal(failed.ok,false);assert.match(failed.error.message,/Disk full/);
    assert.equal(state.assays[0].plateCsvFiles,undefined);assert.equal(getSaves(),0,'failed artifacts are not marked saved');
    api.storeImportedFile=store;
    assert.equal((await storage.persistAssayArtifacts('plate-1')).ok,true);
    assert.equal(await fs.readFile(state.assays[0].plateCsvFiles.original.filePath,'utf8'),originalCsv);
  });
});
