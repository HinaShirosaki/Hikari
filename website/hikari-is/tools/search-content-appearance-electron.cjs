// Compare the existing tour's text, geometry, focus, and section structure before/after pre-rendering.
// Usage: electron tools/search-content-appearance-electron.cjs /absolute/path/to/baseline/index.html
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const baseline=process.argv[2],current=path.resolve(__dirname,'../index.html');if(!baseline)throw Error('Pass the original page as the baseline.');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'hikari-copy-appearance-')));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
(async()=>{
 await app.whenReady();const all=[];
 for(const file of [baseline,current]){
  const w=new BrowserWindow({width:1440,height:900,useContentSize:true,show:false,webPreferences:{sandbox:true,backgroundThrottling:false}});
  w.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,done)=>done({cancel:true}));
  await w.loadURL('about:blank');w.webContents.debugger.attach('1.3');await w.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await w.loadFile(file);const samples=[];
  for(const [width,height]of [[375,667],[390,844],[1440,900]]){
   w.setContentSize(width,height);await new Promise(r=>setTimeout(r,100));
   samples.push(...await w.webContents.executeJavaScript(`(async()=>{
    const pause=ms=>new Promise(r=>setTimeout(r,ms)),result=[];
    for(const page of ['product','agent']){
     location.hash='#'+page;await pause(70);const prefix=page==='agent'?'agent-':'',links=[...document.getElementById(prefix+'dots').children];
     for(const link of links){
      link.click();await pause(65);
      const nodes=['head','dTitle','dBody','dList','shot'].map(name=>document.getElementById(prefix+name));
      if(document.activeElement!==nodes[1])throw Error('Feature heading focus lost: '+link.hash);
      const visible=[...document.querySelectorAll('#'+prefix+'detail>.feature-copy')].filter(x=>x.getClientRects().length);if(visible.length!==1)throw Error('Additional feature copy visible');
      result.push({width:innerWidth,height:innerHeight,page,feature:link.hash,text:nodes.slice(1,4).map(x=>x.innerText),boxes:nodes.map(x=>{const b=x.getBoundingClientRect();return [b.x,b.y,b.width,b.height];}),sections:document.querySelectorAll('section').length});
     }
    }
    return result;
   })()`));
  }
  all.push(samples);w.destroy();
 }
 const [before,after]=all;if(before.length!==after.length)throw Error('Different feature count');let maxDelta=0;
 for(let i=0;i<before.length;i++){
  if(JSON.stringify(before[i].text)!==JSON.stringify(after[i].text)||before[i].feature!==after[i].feature||before[i].sections!==after[i].sections)throw Error('Visible content or sections changed: '+before[i].feature);
  before[i].boxes.forEach((box,j)=>box.forEach((value,k)=>{maxDelta=Math.max(maxDelta,Math.abs(value-after[i].boxes[j][k]));}));
 }
 if(maxDelta>1)throw Error('Visible geometry changed by '+maxDelta+' px');
 console.log({featureViews:before.length,viewports:3,maxDelta,visibleCopyPanels:1,focusPreserved:true,sectionsUnchanged:true});app.quit();
})().catch(error=>{console.error(error);app.exit(1)});
