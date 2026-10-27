// Real Gel workspace with simulated images and storage scoped to this preview.
import { initGelAnalysis } from '../../../../src/plugins/gel/workspace/index.js';
import { createGelWorkspaceStore } from '../../../../src/plugins/gel/workspace-store.js';

const RealDate = Date;
const fixedNow = new RealDate('2026-10-25T10:30:00-05:00').getTime();
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [fixedNow])); }
  static now() { return fixedNow; }
};
const safeText = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const state = { gelAnalyses: [], settings: { storagePath: '/Tutorial workspace' } };
const files = new Map(), calls = [], exports = [];
let copiedText = '', writes = 0;
window.hikariApi = {
  readFileBase64: async file => files.has(file) ? {ok:true,dataBase64:files.get(file)} : {ok:false,error:'Missing preview file'},
  storeImportedFile: async data => { const filePath=data.targetFolder+'/'+data.fileName; files.set(filePath,data.dataBase64); return {ok:true,filePath,relativePath:filePath}; },
  writeJsonFile: async data => { const filePath=data.targetFolder+'/'+data.fileName; files.set(filePath,JSON.stringify(data.data)); return {ok:true,filePath,relativePath:filePath}; },
  exportBinaryFile: async data => { exports.push(data); return {saved:true}; },
  exportTextFile: async data => { exports.push(data); return {saved:true}; }
};
Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{copiedText=text;}}});
const workspacePersistence = createGelWorkspaceStore({isConfigured:()=>true,hikari:{call:async(verb,params)=>{
  if(verb==='files.read') {if(!files.has(params.path))throw Error('Plugin file not found.');return {dataBase64:files.get(params.path)};}
  if(verb!=='files.write')throw Error('Unexpected preview operation: '+verb);
  files.set(params.path,params.dataBase64);writes++;return {path:params.path};
}}});
const controller=initGelAnalysis({state,persist:async()=>{writes++;},createId:()=>crypto.randomUUID(),safeText,document,
  workspacePersistence,onNotify:(message,options={})=>calls.push({kind:options.kind==='error'||options.type==='error'?'error':'notice',message,...options})});
await controller.ready;
controller.render();

function makeImage(variant=0) {
  const canvas=document.createElement('canvas');canvas.width=900;canvas.height=610;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#e8e8e8';ctx.fillRect(0,0,900,610);
  let seed=38;
  const pixels=ctx.getImageData(0,0,900,610);
  for(let y=0;y<610;y++)for(let x=0;x<900;x++){const i=(y*900+x)*4;seed=(Math.floor(x/8)*73856093+Math.floor(y/8)*19349663)>>>0;const gray=229+(seed%4);pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=gray;}
  ctx.putImageData(pixels,0,0);
  for(let lane=0;lane<6;lane++) {
    const rows=lane===0?[80,135,190,240,310,365,420,480,545]:[195,365];
    for(const y of rows) {
      const shade=lane===0?38:y===195?145:variant?70:35+lane*20;
      const gradient=ctx.createLinearGradient(0,y-4,0,y+18);
      gradient.addColorStop(0,'rgba(40,40,40,0)');gradient.addColorStop(.25,`rgb(${shade},${shade},${shade})`);gradient.addColorStop(.75,`rgb(${shade},${shade},${shade})`);gradient.addColorStop(1,'rgba(40,40,40,0)');
      ctx.fillStyle=gradient;ctx.fillRect(lane*150+35,y-4,80,22);
    }
  }
  return canvas.toDataURL('image/png');
}
const image=makeImage(), controlImage=makeImage(1);
const loadImage=async(variant=0,selector='#gel-image-file')=>{
  const data=variant?controlImage:image;
  const bytes=Uint8Array.from(atob(data.split(',')[1]),c=>c.charCodeAt(0));
  const transfer=new DataTransfer();transfer.items.add(new File([bytes],variant?'simulated-control.png':'simulated-gel.png',{type:'image/png'}));
  const input=document.querySelector(selector);input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
};
const pointer=(type,x,y)=>{const c=document.getElementById('gel-canvas'),r=c.getBoundingClientRect();c.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,clientX:r.x+r.width*x,clientY:r.y+r.height*y,button:0}));};
window.tutorial={controller,state,calls,files,exports,image,controlImage,loadImage,pointer,get copiedText(){return copiedText;},get writes(){return writes;},
  moveGel:(id,stack=true)=>{
    const source=[...document.querySelectorAll('[data-figure-row]')].find(row=>row.dataset.figureRow===id),target=stack?document.querySelector('[data-figure-stack-view]'):document.querySelector('[data-figure-drop=root]');
    const a=source.getBoundingClientRect(),b=target.getBoundingClientRect(),point={clientX:b.left+b.width/2,clientY:b.top+b.height/2,pointerId:42,button:0,bubbles:true,cancelable:true};
    source.dispatchEvent(new PointerEvent('pointerdown',{...point,clientX:a.left+a.width/2,clientY:a.top+a.height/2}));
    document.dispatchEvent(new PointerEvent('pointermove',point));document.dispatchEvent(new PointerEvent('pointerup',point));
  }
};
window.tutorialReady=true;
