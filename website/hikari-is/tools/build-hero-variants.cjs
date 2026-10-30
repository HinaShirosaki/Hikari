// Run with Electron to resize the original captures into responsive WebP assets.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const site=path.resolve(__dirname,'..');
const names=['home-hero','hero-protocols','hero-notebook','hero-papers','hero-samples','hero-workflows','hero-dna','hero-plate'];
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'hikari-hero-variants-')));
(async()=>{
 await app.whenReady();const win=new BrowserWindow({show:false,webPreferences:{sandbox:true}});await win.loadURL('about:blank');
 let originalBytes=0,smallBytes=0;
 for(const name of names){
  const input=fs.readFileSync(path.join(site,'shots',name+'.png'));originalBytes+=input.length;
  const source='data:image/png;base64,'+input.toString('base64');
  for(const width of [1280,2560,3840]){
   const encoded=await win.webContents.executeJavaScript(`(async()=>{const image=new Image();image.src=${JSON.stringify(source)};await image.decode();const canvas=document.createElement('canvas');canvas.width=${width};canvas.height=Math.round(image.naturalHeight*${width}/image.naturalWidth);const ctx=canvas.getContext('2d');ctx.imageSmoothingQuality='high';ctx.drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/webp',.9).split(',')[1];})()`);
   const bytes=Buffer.from(encoded,'base64');fs.writeFileSync(path.join(site,'shots',`${name}-${width}.webp`),bytes);if(width===1280)smallBytes+=bytes.length;
  }
 }
 console.log(JSON.stringify({originalBytes,mobileBytes:smallBytes,reduction:1-smallBytes/originalBytes}));app.quit();
})().catch(error=>{console.error(error);app.exit(1)});
