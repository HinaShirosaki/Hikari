// Prepare a fictional, editable Figura scene and an isolated browser capture host.
// No desktop storage, account, agent, or public Trial runtime is used.
//   node website/hikari-is-tools/prepare-figura-capture.mjs
// Serve tmp/hikari-is-figura/capture, then capture its index.html at 3840 × 2400.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDocument, normalizeDocument } from '../../plugins/scientific-illustration/model.mjs';
import { createAssetLibrary } from '../../plugins/scientific-illustration/reusable-assets.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(repo, 'tmp/hikari-is-figura');
const capture = path.join(out, 'capture');
const p = { ink:'#24383e', muted:'#667b80', line:'#d6e1e3', pale:'#f2f7f8', blue:'#628caf', teal:'#368b86', purple:'#9278ad', gold:'#d4a15f', rose:'#c97e82' };
const doc = createDocument();
Object.assign(doc, {title:'Engineering a receptor response', complexity:'detailed', revision:'figura-receptor-response-20261018'});
doc.canvases.main = {width:1600, height:1000, background:'#ffffff'};
let serial = 0;
const id = prefix => `${prefix}-${++serial}`;
function artwork(name,x,y,width,height,body) {
  const object = {id:id('art'), name, type:'vector', canvas:'main', x,y,width,height,
    svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" fill="none" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`};
  doc.objects.push(object); return object.id;
}
function text(name, value, x,y,width, size=22, color=p.ink, weight=400, align='start', rotation=0) {
  size=Math.max(18,size);
  const object = {id:id('label'),name,type:'text',canvas:'main',x,y,width,height:size*1.3,
    text:value,fontFamily:'Inter',fontSize:size,fontWeight:weight,color,align,rotation};
  doc.objects.push(object); return object.id;
}
function group(name, start) {
  const ids=doc.objects.slice(start).map(o=>o.id);
  if(ids.length>1)doc.groups.push({id:id('group'),name,canvas:'main',ids});
}
const rule = (x,y,w) => artwork('Panel divider',x,y,w,2,`<path d="M0 1H${w}" stroke="${p.line}" stroke-width="2"/>`);
function arrow(name,x1,y1,x2,y2,color=p.muted,dashed=false) {
  const x=Math.min(x1,x2)-8,y=Math.min(y1,y2)-8,w=Math.max(16,Math.abs(x2-x1)+16),h=Math.max(16,Math.abs(y2-y1)+16);
  const a=x1-x,b=y1-y,c=x2-x,d=y2-y,angle=Math.atan2(d-b,c-a);
  const left=[c-12*Math.cos(angle-.45),d-12*Math.sin(angle-.45)],right=[c-12*Math.cos(angle+.45),d-12*Math.sin(angle+.45)];
  return artwork(name,x,y,w,h,`<path d="M${a} ${b}L${c} ${d}" stroke="${color}" stroke-width="2.5"${dashed?' stroke-dasharray="6 6"':''}/><path d="M${left.join(' ')}L${c} ${d}L${right.join(' ')}" stroke="${color}" stroke-width="2.5"/>`);
}
text('Figure title',doc.title,48,31,1450,44,p.ink,600);
text('Figure subtitle','Modular design, intracellular signaling, and a multi-readout validation strategy',50,89,1460,23,p.muted);
rule(48,132,1504);

// A — a multi-compartment cell mechanism. All labels remain separate objects.
let start=doc.objects.length;
text('Panel A','A',48,157,38,28,p.ink,600);
text('Mechanism heading','Receptor-to-reporter signaling',92,158,850,27,p.ink,500);
text('Extracellular compartment','EXTRACELLULAR',78,218,230,16,p.muted,500);
text('Intracellular compartment','INTRACELLULAR',78,390,230,16,p.muted,500);
let membrane='';
for(let i=0;i<54;i++) {
  const x=8+i*16.5;
  membrane+=`<path d="M${x-2} 16v16m5-16v16M${x-2} 52V36m5 16V36" stroke="#b9c9c7" stroke-width="2"/><circle cx="${x}" cy="10" r="6" fill="#d6e4dc" stroke="#a4bbb0"/><circle cx="${x}" cy="58" r="6" fill="#d6e4dc" stroke="#a4bbb0"/>`;
}
artwork('Lipid bilayer',77,309,902,70,membrane);
text('Membrane label','Plasma membrane',760,280,210,17,p.muted);
artwork('Ligand complex',310,220,122,69,`<path d="M26 30 61 15 96 30 61 55Z" fill="#dce7ef" stroke="${p.blue}" stroke-width="3"/><circle cx="26" cy="30" r="16" fill="#c5d8e7" stroke="${p.blue}" stroke-width="2"/><circle cx="96" cy="30" r="16" fill="#c5d8e7" stroke="${p.blue}" stroke-width="2"/><circle cx="61" cy="15" r="12" fill="#c5d8e7" stroke="${p.blue}" stroke-width="2"/>`);
text('Ligand label','Ligand',451,235,130,20,p.blue,500);
artwork('Ligand leader',421,250,33,2,`<path d="M0 1H33" stroke="${p.blue}" stroke-width="1.5"/>`);
for(const [x,flip] of [[282,false],[414,true]]) {
  artwork('Receptor binding domains',x,266,48,170,`<rect x="8" y="2" width="32" height="54" rx="16" fill="#dce8f0" stroke="${p.blue}" stroke-width="3"/><rect x="12" y="62" width="24" height="47" rx="10" fill="#eaf1f6" stroke="${p.blue}" stroke-width="2.5"/><path d="M24 109v37l${flip?-12:12} 20" stroke="${p.purple}" stroke-width="7"/>`);
  artwork('Transmembrane segment',x+13,327,22,42,`<rect x="2" y="2" width="18" height="38" rx="7" fill="${p.teal}" stroke="#286d6a" stroke-width="2"/>`);
}
artwork('Phosphorylated receptor tails',311,404,142,45,`<circle cx="15" cy="18" r="8" fill="${p.gold}" stroke="#ad7d42" stroke-width="2"/><circle cx="122" cy="23" r="8" fill="${p.gold}" stroke="#ad7d42" stroke-width="2"/><path d="M23 18H60m54 5H78" stroke="${p.purple}" stroke-width="3"/><rect x="57" y="5" width="26" height="32" rx="8" fill="#e9dff1" stroke="${p.purple}" stroke-width="2"/>`);
text('Receptor label','Engineered receptor',251,468,300,20,p.ink,500);
arrow('Kinase activation',458,430,541,430,p.purple);
artwork('Kinase assembly',551,398,112,67,`<ellipse cx="43" cy="33" rx="39" ry="27" fill="#e7ddf1" stroke="${p.purple}" stroke-width="2.5"/><circle cx="86" cy="17" r="12" fill="#f3e2c9" stroke="${p.gold}" stroke-width="2"/><path d="M62 39c8-9 18-6 27-1" stroke="${p.purple}" stroke-width="3"/>`);
text('Kinase label','Kinase',559,479,120,19,p.purple,500);
arrow('Transcription factor activation',671,430,726,430,p.purple);
artwork('Transcription factor',735,405,55,55,`<path d="m28 3 22 12-4 27-18 10L8 40 4 15Z" fill="#f0dfc6" stroke="${p.gold}" stroke-width="2.5"/><path d="m17 20 11 9 12-12" stroke="#ae7e40" stroke-width="2.5"/>`);
text('TF label','TF',748,467,65,19,p.gold,500);
artwork('Endocytic vesicle',103,451,108,96,`<ellipse cx="54" cy="48" rx="46" ry="40" fill="#f3f8f7" stroke="#9cbcb4" stroke-width="2.5"/><ellipse cx="54" cy="48" rx="38" ry="32" stroke="#c4d8d2" stroke-width="2"/><path d="M39 24v28l12 14m22-42v28L61 66" stroke="${p.blue}" stroke-width="5"/><circle cx="52" cy="26" r="8" fill="#ccdfec"/><circle cx="63" cy="26" r="8" fill="#ccdfec"/>`);
arrow('Receptor internalization',267,430,208,475,p.muted,true);
text('Internalization label','Internalization',83,557,215,18,p.muted);
artwork('Nucleus and nuclear pores',804,434,169,143,`<ellipse cx="83" cy="72" rx="78" ry="62" fill="#f5f0fa" stroke="#b6a4cb" stroke-width="2.5"/><ellipse cx="83" cy="72" rx="69" ry="53" stroke="#d5c8e3" stroke-width="2"/><path d="M10 55 24 59M10 89l14-4m126-30-13 4m14 30-14-4" stroke="#ad99c2" stroke-width="5"/><path d="M42 68c21-22 36 22 65 0m-65 15c21-22 36 22 65 0M52 66v16m15-10v16m16-11v13m15-18v13" stroke="${p.purple}" stroke-width="2"/><path d="M70 40h40m-34-8 10 7-10 7" stroke="${p.gold}" stroke-width="3"/>`);
arrow('Nuclear translocation',777,454,817,478,p.gold);
text('Nucleus label','Nucleus',833,588,140,18,p.muted);
text('Reporter expression label','Reporter expression',620,553,220,18,p.ink,500);
artwork('Reporter RNA',656,518,103,21,`<path d="M3 13c8-19 16 19 24 0s16-19 24 0 16 19 24 0 16-19 24 0" stroke="${p.teal}" stroke-width="3"/>`);
arrow('Transcription output',818,526,765,526,p.teal);
group('Cell signaling mechanism',start);

// B — alternate receptor constructs, independent domain artwork and labels.
start=doc.objects.length;
text('Panel B','B',1040,157,38,28,p.ink,600);
text('Construct heading','Construct library',1084,158,470,27,p.ink,500);
text('Construct context','A shared scaffold, three signaling designs',1040,207,500,19,p.muted);
const constructs=[['REF',252,0],['V1',348,1],['V2',444,2]];
for(const [name,y,variant] of constructs) {
  text(`${name} identifier`,name,1045,y+20,74,21,p.ink,500);
  let blocks=`<path d="M5 32H390" stroke="#b9c8cc" stroke-width="2"/><rect x="8" y="8" width="93" height="48" rx="19" fill="#d8e7f1" stroke="${p.blue}" stroke-width="2"/><rect x="125" y="12" width="28" height="40" rx="6" fill="${p.teal}"/>`;
  const count=variant===2?3:2;
  for(let i=0;i<count;i++)blocks+=`<rect x="${179+i*45}" y="${variant===1?12:8}" width="34" height="${variant===1?40:48}" rx="8" fill="${variant===0?'#ddd2e8':variant===1?'#bca7cf':'#a78cbd'}" stroke="${p.purple}" stroke-width="1.8"/>`;
  blocks+=`<path d="M${variant===2?310:271} 32h25" stroke="${p.purple}" stroke-width="2" stroke-dasharray="3 4"/><circle cx="365" cy="32" r="23" fill="#eddbbc" stroke="${p.gold}" stroke-width="2"/>`;
  artwork(`${name} domain architecture`,1122,y,398,64,blocks);
}
const domainLegend=[['Binding',p.blue,1046],['Anchor',p.teal,1173],['Signal',p.purple,1292],['Reporter',p.gold,1406]];
for(const [name,color,x] of domainLegend) {
  artwork(`${name} key`,x,553,14,14,`<rect width="14" height="14" rx="3" fill="${color}"/>`);
  text(`${name} legend`,name,x+21,549,110,17,p.muted);
}
group('Modular construct library',start);
rule(48,625,1504);

// C — synthetic dose response, with independently editable axes and legend labels.
start=doc.objects.length;
text('Panel C','C',48,651,38,28,p.ink,600);
text('Dose heading','Dose response',92,652,400,26,p.ink,500);
const chart={x:105,y:726,w:352,h:158};
let axes=`<path d="M0 0V${chart.h}H${chart.w}" stroke="#9aafb3" stroke-width="1.6"/>`;
for(const yy of [0,chart.h/2,chart.h])axes+=`<path d="M0 ${yy}H${chart.w}" stroke="${p.line}" stroke-width="1"/>`;
artwork('Dose response axes',chart.x,chart.y,chart.w,chart.h,axes);
for(const [value,yy] of [['4',chart.y-11],['2',chart.y+chart.h/2-11],['0',chart.y+chart.h-11]])text('Response axis tick',value,66,yy,30,17,p.muted,400,'end');
for(const [value,xx] of [['0.1',chart.x],['1',chart.x+chart.w/3],['10',chart.x+chart.w*2/3],['100',chart.x+chart.w]])text('Dose axis tick',value,xx-25,chart.y+chart.h+10,50,17,p.muted,400,'middle');
text('Dose x axis','Ligand concentration (nM)',111,930,345,18,p.muted,400,'middle');
text('Dose y axis','Reporter (fold)',-16,804,170,17,p.muted,400,'middle',-90);
const series=[{name:'REF',color:p.blue,ec:7.2,max:2.6},{name:'V1',color:p.teal,ec:3.8,max:3.3},{name:'V2',color:p.purple,ec:1.7,max:3.9}];
series.forEach((s,i)=>{
  const points=[];
  for(let n=0;n<=80;n++){const xx=n/80*chart.w,dose=10**(-1+3*n/80),response=s.max*dose/(s.ec+dose);points.push([xx,chart.h-response/4*chart.h]);}
  let marks=`<path d="${points.map((v,j)=>(j?'L':'M')+v.map(n=>n.toFixed(2)).join(' ')).join(' ')}" stroke="${s.color}" stroke-width="3"/>`;
  for(const n of [8,24,40,56,72]){const [x,y]=points[n];marks+=`<path d="M${x} ${y-5}v10" stroke="${s.color}" stroke-width="1.5"/><circle cx="${x}" cy="${y}" r="3.5" fill="#ffffff" stroke="${s.color}" stroke-width="2"/>`;}
  artwork(`${s.name} dose-response curve`,chart.x,chart.y,chart.w,chart.h,marks);
  artwork(`${s.name} curve key`,139+i*111,701,24,2,`<path d="M0 1h24" stroke="${s.color}" stroke-width="3"/>`);
  text(`${s.name} curve legend`,s.name,169+i*111,690,70,17,p.muted);
});
group('Synthetic dose response',start);

// D — overlapping distributions show population structure, rather than means alone.
start=doc.objects.length;
text('Panel D','D',538,651,38,28,p.ink,600);
text('Cell response heading','Single-cell response',582,652,395,26,p.ink,500);
artwork('Single-cell axes',587,713,344,171,`<path d="M0 0v171h344" stroke="#9aafb3" stroke-width="1.6"/><path d="M0 86h344M0 0h344" stroke="${p.line}" stroke-width="1"/>`);
series.forEach((s,i)=>{
  const points=[];
  for(let n=0;n<=100;n++){const x=n/100*344,mu=[102,184,253][i],sigma=[38,44,31][i],y=171-142*Math.exp(-.5*((x-mu)/sigma)**2);points.push([x,y]);}
  const line=points.map((v,j)=>(j?'L':'M')+v.map(n=>n.toFixed(2)).join(' ')).join(' ');
  artwork(`${s.name} population distribution`,587,713,344,171,`<path d="M0 171 ${line.replace(/^M/,'L')} L344 171Z" fill="${s.color}" fill-opacity=".12"/><path d="${line}" stroke="${s.color}" stroke-width="3"/>`);
});
for(const [value,x] of [['10²',612],['10³',741],['10⁴',870]])text('Fluorescence tick',value,x-20,894,55,17,p.muted,400,'middle');
text('Fluorescence x axis','Reporter fluorescence (a.u.)',576,930,370,18,p.muted,400,'middle');
text('Density y axis','Density',496,803,110,17,p.muted,400,'middle',-90);
text('Cell distribution note','Synthetic populations · matched conditions',587,689,370,16,p.muted);
group('Synthetic single-cell readout',start);

// E — a time-resolved response matrix, with every row/column label editable.
start=doc.objects.length;
text('Panel E','E',1017,651,38,28,p.ink,600);
text('Landscape heading','Response landscape',1061,652,470,26,p.ink,500);
const values=[[0,.4,.8,.95,.55,.25],[0,.2,.5,.9,1,.75],[.1,.15,.4,.7,.95,.85],[0,.1,.2,.6,.9,1],[.8,.82,.79,.85,.8,.76]];
const colors=['#e6edf2','#d5e3e7','#b5d0cf','#8fb9b4','#649f98','#368b86'];
let heat='';
values.forEach((row,r)=>row.forEach((v,c)=>{heat+=`<rect x="${c*50}" y="${r*33}" width="46" height="29" rx="3" fill="${colors[Math.min(5,Math.round(v*5))]}"/>`;}));
artwork('Response matrix',1226,723,300,165,heat);
['Early','Sustained','Feedback','Reporter','Viability'].forEach((name,i)=>text('Response marker',name,1035,724+i*33,171,17,p.muted,400,'end'));
['0','1','2','4','8','16'].forEach((name,i)=>text('Time point',name,1226+i*50,896,46,17,p.muted,400,'middle'));
text('Time axis','Time after stimulation (h)',1204,930,340,18,p.muted,400,'middle');
let legend='';for(let i=0;i<6;i++)legend+=`<rect x="${i*18}" width="18" height="10" fill="${colors[i]}"/>`;
artwork('Normalized response color key',1407,703,108,10,legend);
text('Color legend label','Normalized response',1022,693,300,16,p.muted);
text('Color legend minimum','0',1379,693,20,16,p.muted,400,'middle');
text('Color legend maximum','1',1521,693,20,16,p.muted,400,'middle');
group('Synthetic time-response matrix',start);
text('Figure provenance','ILLUSTRATIVE SYSTEM  ·  SYNTHETIC MEASUREMENTS  ·  EDITABLE ARTWORK & LABELS',48,975,1490,15,p.muted);

const scene=normalizeDocument(doc);
await fs.mkdir(capture,{recursive:true});
await fs.writeFile(path.join(out,'receptor-response.figura.json'),JSON.stringify(scene,null,2)+'\n');
await fs.cp(path.join(repo,'plugins/scientific-illustration'),path.join(capture,'figura'),{
  recursive:true,
  filter:source=>!/(?:^|\/)(?:tests|README\.md|USER_GUIDE\.md|\.DS_Store)$/.test(source)
});
const figureId='receptor-response';
const files={
  'library.json':{version:1,revision:'capture-library',activeId:figureId,receipts:[],illustrations:[{id:figureId,title:scene.title,path:`illustrations/${figureId}/scene-a.json`,updatedAt:'2026-10-18T12:00:00Z'}]},
  [`illustrations/${figureId}/scene-a.json`]:scene,
  'reusable-assets.json':createAssetLibrary()
};
await fs.writeFile(path.join(capture,'seed.json'),JSON.stringify(files));
await fs.writeFile(path.join(capture,'index.html'),`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Figura · Isolated capture</title>
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#fcfbf8}iframe{display:block;position:absolute;left:0;top:0;width:1600px;height:1000px;border:0;transform:scale(2.4);transform-origin:top left}</style>
</head><body><iframe id="figura" title="Figura capture"></iframe><script type="module" src="host.mjs"></script></body></html>`);
await fs.writeFile(path.join(capture,'host.mjs'),`// Capture-only host. File access is confined to this in-memory fixture map.
const files=await (await fetch('./seed.json')).json();
const frame=document.getElementById('figura');
const encode=value=>btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));
addEventListener('message',event=>{
  if(event.source!==frame.contentWindow || event.origin!==location.origin || event.data?.hikari!==1 || !event.data.verb)return;
  const {id,verb,params}=event.data;
  let result={};
  try {
    if(verb==='storage.get')result={value:{version:2,libraryPath:'library.json',assetsPath:'reusable-assets.json'}};
    else if(verb==='files.read'){if(!Object.hasOwn(files,params.path))throw Error('Capture file not found');result={dataBase64:encode(files[params.path])};}
    else if(verb==='files.write'){files[params.path]=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(params.dataBase64),c=>c.charCodeAt(0))));}
    else if(verb==='app.info')result={appearance:{mode:'day',fontSize:14},permissions:['layout'],layout:{leftRail:{width:240,min:240,max:400,foldable:true,folded:true},agentChatRail:{available:false,expanded:false}}};
    else if(verb==='app.setWorkspaceTools')result={mounted:false};
    else if(verb==='downloads.save'){
      const bytes=Uint8Array.from(atob(params.dataBase64),c=>c.charCodeAt(0));
      const url=URL.createObjectURL(new Blob([bytes]));const a=document.createElement('a');a.href=url;a.download=params.fileName;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);result={saved:true};
    }
    frame.contentWindow.postMessage({hikari:1,id,ok:true,result},location.origin);
  } catch(error){frame.contentWindow.postMessage({hikari:1,id,ok:false,error:error.message},location.origin);}
});
frame.src='figura/index.html';
`);
console.log(JSON.stringify({capture,scene:path.join(out,'receptor-response.figura.json'),objects:scene.objects.length,groups:scene.groups.length,textLayers:scene.objects.filter(o=>o.type==='text').length},null,2));
