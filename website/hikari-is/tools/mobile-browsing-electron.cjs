// Run with Electron. Exercises mobile feature browsing without opening a lab workspace.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const site=path.resolve(__dirname,'..');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'hikari-mobile-browsing-')));app.disableHardwareAcceleration();
(async()=>{
 await app.whenReady();const win=new BrowserWindow({width:375,height:667,useContentSize:true,show:false,webPreferences:{sandbox:true,backgroundThrottling:false}});
 win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,done)=>done({cancel:true}));
 await win.loadFile(path.join(site,'index.html'));await new Promise(r=>setTimeout(r,2400));
 console.log(await win.webContents.executeJavaScript(`({heroSource:document.querySelector('.hero-product img').currentSrc,earlyScreenshotRequests:performance.getEntriesByType('resource').filter(x=>/shots\\//.test(x.name)).length})`));
 for(const [width,height] of [[320,568],[375,667],[390,844],[430,932],[740,390],[1440,1000]]){
  win.setContentSize(width,height);await new Promise(r=>setTimeout(r,100));
  console.log(await win.webContents.executeJavaScript(`(async()=>{
   const pause=ms=>new Promise(r=>setTimeout(r,ms)),mobile=innerWidth<=760;let rows=0,sections=0,minGap=Infinity;
   for(const page of ['product','agent']){
    location.hash='#'+page;await pause(100);
    const prefix=page==='agent'?'agent-':'',nav=document.getElementById(prefix+'dots'),links=[...nav.children],track=document.getElementById(prefix+'track'),stage=document.getElementById(prefix+'stage');
    const unit=mobile?stage.clientHeight:innerHeight;
    for(let i=0;i<links.length;i++){
     links[i].click();await pause(75);
     if(nav.children[i].getAttribute('aria-current')!=='location')throw Error('Feature menu not selected '+links[i].hash);
     if(mobile){
      const bounds=links[i].getBoundingClientRect();if(bounds.height<44||bounds.left<0||bounds.right>innerWidth+1)throw Error('Feature not reachable '+links[i].hash+' '+JSON.stringify(bounds));
      if(Math.abs(nav.getBoundingClientRect().top-64)>1)throw Error('Feature menu overlaps header');
     }
     const allRows=[...document.querySelectorAll('#'+prefix+'dList li')].filter(li=>li.getClientRects().length);
     if(mobile&&allRows.length!==3)throw Error('Missing feature highlights '+links[i].hash);
     for(const li of allRows){
      const text=document.createTreeWalker(li,NodeFilter.SHOW_TEXT).nextNode(),range=document.createRange();range.selectNodeContents(text);
      const pseudo=getComputedStyle(li,'::before'),ctx=document.createElement('canvas').getContext('2d');ctx.font=pseudo.font;
      const gap=range.getBoundingClientRect().left-li.getBoundingClientRect().left-ctx.measureText('—').width;minGap=Math.min(minGap,gap);if(gap<5)throw Error('Dash overlap');rows++;
     }
     if(mobile){
      const body=document.getElementById(prefix+'dBody'),title=document.getElementById(prefix+'dTitle'),targets=[title,body,...allRows];const readable=new Set();
      for(const p of [.1,.25,.46,.6,.7,.8,.86]){
       scrollTo(0,track.offsetTop+(i+p)*1.2*unit);await pause(22);
       targets.forEach((el,j)=>{const r=el.getBoundingClientRect();if(r.top>=112&&r.bottom<=innerHeight-12)readable.add(j);});
      }
      if(readable.size!==targets.length)throw Error('Content cannot scroll into view '+links[i].hash+' '+[...readable]+'/'+targets.length);
     }
     sections++;
    }
   }
   if(document.documentElement.scrollWidth>innerWidth)throw Error('Page overflow');
   return {width:innerWidth,height:innerHeight,sections,rows,minGap};
  })()`));
 }
 for(const hash of ['cloning','protocol-to-notebook','agent-codex','agent-papers','install','agent-end','plugins','trial']){
  win.setContentSize(375,667);await win.webContents.executeJavaScript('location.hash='+JSON.stringify('#'+hash));await new Promise(r=>setTimeout(r,1000));fs.writeFileSync(path.join(os.tmpdir(),'hikari-mobile-'+hash+'.png'),(await win.webContents.capturePage()).toPNG());
 }
 app.quit();
})().catch(error=>{console.error(error);app.exit(1)});
