// Source editor and source host toolbar, with storage isolated to this preview.
import { createPluginWorkspaceTools } from '../../../../src/renderer/app/plugin-workspace-tools.js';

const RealDate=Date, fixedNow=new RealDate('2026-10-25T10:30:00-05:00').getTime();
globalThis.Date=class extends RealDate {constructor(...args){super(...(args.length?args:[fixedNow]));}static now(){return fixedNow;}};
const files=new Map(), calls=[], downloads=[], listeners=new Map();
let stored=null, writes=0;
const info={appearance:{mode:'day',fontSize:16},permissions:['storage','files','layout','agent:chat','agent:canvas'],layout:{leftRail:{width:280,min:240,max:400,foldable:true,folded:false},workspaceTools:{available:true},agentChatRail:{available:true,expanded:false}}};
const emit=(event,payload)=>{for(const listener of listeners.get(event)||[])listener(payload);};
const registration={plugin:{id:'scientific-illustration',name:'Figura',enabled:true,permissions:info.permissions},origin:location.origin};
const frame={postMessage:message=>emit(message.event,message.payload)};
const hostTools=createPluginWorkspaceTools({windowObject:window,getRegistration:()=>registration});
// In Hikari, clicks in the host strip do not bubble into the plugin iframe.
document.getElementById('plugin-workspace-tools').addEventListener('click',event=>event.stopPropagation());
const hikari={
  on(event,callback){if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event).add(callback);return()=>listeners.get(event).delete(callback);},
  async call(verb,params={}){
    if(verb==='app.info')return structuredClone(info);
    if(verb==='storage.get')return {value:stored};
    if(verb==='storage.set'){stored=params.value;return {};}
    if(verb==='files.read'){if(!files.has(params.path))throw Error('Plugin file not found.');return {dataBase64:files.get(params.path)};}
    if(verb==='files.write'){files.set(params.path,params.dataBase64);writes++;return {path:params.path};}
    if(verb==='app.setWorkspaceTools')return hostTools.set(params,frame);
    if(verb==='app.setLeftRailWidth'||verb==='app.setLeftRailFolded'){Object.assign(info.layout.leftRail,params);emit('app.context',info);return {leftRail:structuredClone(info.layout.leftRail)};}
    if(verb==='app.setAgentChatExpanded'){info.layout.agentChatRail.expanded=params.expanded;emit('app.context',info);return {expanded:params.expanded};}
    if(['agent.setContext','app.setHistory','app.setUnsaved','app.setContextActions'].includes(verb)){calls.push({kind:verb,...params});return {};}
    if(verb==='downloads.save'){downloads.push(params);return {saved:true};}
    if(verb==='agent.chat')throw Error('Live AI calls are disabled in the tutorial preview.');
    throw Error('Unexpected tutorial operation: '+verb);
  }
};
window.HikariPlugin={hikari};
window.addEventListener('error',event=>calls.push({kind:'error',message:event.message}));
window.addEventListener('unhandledrejection',event=>calls.push({kind:'error',message:String(event.reason?.message||event.reason)}));
await import('../../../../plugins/scientific-illustration/main.mjs');
const workspace=window.illustrationWorkspace;await workspace.ready;
const cellSvg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 220"><ellipse cx="140" cy="110" rx="132" ry="99" fill="#d2e5e4" stroke="#438482" stroke-width="6"/><ellipse cx="147" cy="116" rx="55" ry="46" fill="#b3add7" stroke="#756ba6" stroke-width="4"/><path d="M35 90q25-25 43 0t30 0M191 150q22 20 42 0" fill="none" stroke="#7caeaa" stroke-width="7" stroke-linecap="round"/><circle cx="78" cy="155" r="12" fill="#94bdb6"/><circle cx="209" cy="74" r="11" fill="#94bdb6"/></svg>';
const arrowSvg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 60"><path d="M5 30h175M160 8l45 22-45 22" fill="none" stroke="#73618e" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const text=(id,value,x,y,width,size=30)=>({id,type:'text',name:value,text:value,canvas:'main',x,y,width,height:size*1.5,fontFamily:'Inter',fontSize:size,fontWeight:500,color:'#34334a',align:'middle',anchor:'middle'});
const objects=[text('title','Signal transfer · example',100,50,1000,38),
  {id:'sender',type:'vector',name:'Sender cell artwork',canvas:'main',x:145,y:215,width:280,height:220,svg:cellSvg},
  {id:'receiver',type:'vector',name:'Receiver cell artwork',canvas:'main',x:770,y:215,width:280,height:220,svg:cellSvg},
  {id:'signal-arrow',type:'vector',name:'Signal arrow',canvas:'main',x:480,y:295,width:220,height:60,svg:arrowSvg},
  text('sender-label','Sender cell',145,470,280),text('receiver-label','Receiver cell',770,470,280),text('signal-label','Signal',480,235,220,26),
  text('caption','Fictional teaching diagram',200,660,800,20)];
const apply=async operations=>{await workspace.flush();const current=workspace.getDocument(),id=workspace.getLibrary().active_illustration_id;const result=await workspace.request({action:'apply',illustration_id:id,expected_revision:current.revision,request_id:crypto.randomUUID(),operations});if(!result.ok)throw Error(result.error);return result;};
const seed=async()=>apply([{op:'title',title:'Signal transfer · example'},...objects.map(object=>({op:'upsert',object}))]);
await seed();
const canvas=document.createElement('canvas');canvas.width=480;canvas.height=360;
const ctx=canvas.getContext('2d');ctx.clearRect(0,0,480,360);ctx.fillStyle='#d2e5e4';ctx.strokeStyle='#438482';ctx.lineWidth=8;ctx.beginPath();ctx.ellipse(240,180,190,135,0,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#b3add7';ctx.strokeStyle='#756ba6';ctx.beginPath();ctx.ellipse(250,185,75,60,0,0,Math.PI*2);ctx.fill();ctx.stroke();
const raster=canvas.toDataURL('image/png');
let clip='';document.execCommand=action=>{if(!['copy','paste'].includes(action))return false;const data=new DataTransfer();if(action==='paste')data.setData('text/plain',clip);const event=new ClipboardEvent(action,{bubbles:true,cancelable:true,clipboardData:data});document.activeElement.dispatchEvent(event);if(action==='copy')clip=data.getData('text/plain');return event.defaultPrevented;};
window.tutorial={workspace,calls,files,downloads,apply,seed,cellSvg,raster,objects,get writes(){return writes;},get clipboard(){return clip;},
  choose:async(ids)=>{if(document.getElementById('layers-panel').hidden)document.querySelector('[data-workspace-tool-id=layers-tab]').click();for(let i=0;i<ids.length;i++)document.querySelector(`[data-layer-id="${ids[i]}"] .layer-select`).dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:i>0}));},
  clear:async()=>{const current=workspace.getDocument();if(current.objects.length)await apply(current.objects.map(object=>({op:'delete',id:object.id})));}
};
window.tutorialReady=true;
