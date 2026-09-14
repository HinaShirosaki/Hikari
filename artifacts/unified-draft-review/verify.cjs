const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
async function main(){
if(!process.versions.electron){const r=require('node:child_process').spawnSync(require('electron'),[__filename],{encoding:'utf8',timeout:60000});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');assert.equal(r.status,0);return;}
const {app,BrowserWindow}=require('electron');app.setPath('userData',fs.mkdtempSync('/tmp/hikari-review-'));app.disableHardwareAcceleration();await app.whenReady();
const win=new BrowserWindow({width:1100,height:950,show:false,webPreferences:{sandbox:true,contextIsolation:true}});await win.loadFile(path.join(__dirname,'review.html'));
const run=c=>win.webContents.executeJavaScript(c);
assert.equal(await run('window.ready'),true);
const results=[];
for(const theme of ['day','night'])for(const [width,height] of [[1100,950],[390,700]]){
win.setContentSize(width,height);await run(`document.body.className='ui-neutral-compact theme-${theme}'`);
for(const kind of ['notebook','protocol','generation']){
await run(kind==='generation'?'showProtocol()':`showAgent();${kind==='protocol'?"document.getElementById('agent-review-next-btn').click();document.getElementById('agent-review-next-btn').click();":''}`);
await new Promise(r=>setTimeout(r,100));
const metrics=await run(`(()=>{const overlay=[...document.querySelectorAll('.app-dialog-overlay')].find(n=>!n.hidden);const surface=overlay.querySelector('.draft-review-dialog');const card=overlay.querySelector('.agent-review-card:not([hidden])')||overlay.querySelector('.draft-review-document');const actions=overlay.querySelector('.agent-review-card:not([hidden]) .draft-review-actions')||overlay.querySelector('.draft-review-actions');const r=surface.getBoundingClientRect(),a=actions.getBoundingClientRect();return {kind:${JSON.stringify(kind)},theme:${JSON.stringify(theme)},width:innerWidth,visibleCards:overlay.querySelectorAll('.agent-review-card:not([hidden])').length,heading:card.querySelector('.draft-review-heading h4')?.textContent,titleSize:getComputedStyle(card.querySelector('.draft-review-heading h4')).fontSize,sectionSize:getComputedStyle(card.querySelector('.agent-review-section h5,.protocol-view-section h4')).fontSize,surface:{left:r.left,right:r.right,bottom:r.bottom},actions:{top:a.top,bottom:a.bottom},overflow:card.scrollWidth>card.clientWidth+1};})()`);
assert.ok(metrics.surface.left>=0&&metrics.surface.right<=width+1,JSON.stringify(metrics));assert.ok(metrics.actions.bottom<=height&&metrics.actions.top>0,JSON.stringify(metrics));assert.equal(metrics.overflow,false,JSON.stringify(metrics));if(kind!=='generation')assert.equal(metrics.visibleCards,1);
results.push(metrics);fs.writeFileSync(path.join(__dirname,`${kind}-${theme}-${width}.png`),(await win.webContents.capturePage()).toPNG());
}
}
await run('showAgent()');assert.equal(await run("document.getElementById('agent-review-page-label').textContent"),'1 / 3');
await run("document.getElementById('agent-review-next-btn').click()");assert.equal(await run("document.getElementById('agent-review-page-label').textContent"),'2 / 3');
await run("document.getElementById('agent-review-prev-btn').click();document.querySelector('.agent-review-card:not([hidden]) [data-agent-review-approve]').click()");assert.equal(await run("events.includes('notebook approved')"),true);
await run("document.querySelector('.agent-review-card:not([hidden]) [data-agent-review-approve]').click()");await new Promise(r=>setTimeout(r,30));assert.equal(await run("events.includes('append approved')"),true);
await run("document.querySelector('.agent-review-card:not([hidden]) [data-agent-review-approve]').click()");assert.equal(await run("events.includes('protocol approved')"),true);assert.equal(await run("document.getElementById('agent-review-overlay').hidden"),true);
await run('showProtocol()');await run("document.getElementById('protocol-generate-apply-btn').click()");assert.equal(await run("events.includes('generation applied')"),true);assert.equal(await run("document.getElementById('protocol-generate-result-overlay').hidden"),true);
fs.writeFileSync(path.join(__dirname,'verification.json'),JSON.stringify(results,null,2));console.log('12 rendered layouts passed; navigation, notebook/append/protocol approvals, and generated protocol apply passed.');win.destroy();app.quit();
}main().catch(e=>{console.error(e);if(process.versions.electron)require('electron').app.exit(1);else process.exitCode=1;});
