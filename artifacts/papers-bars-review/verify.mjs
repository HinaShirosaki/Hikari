import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '/Users/shiyifan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const root = process.cwd();
const output = path.join(root, 'artifacts/papers-bars-review');
const html = (await fs.readFile(path.join(root,'index.html'),'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace('</body>','<script type="module" src="/artifacts/papers-bars-review/fixture.js"></script></body>');
const server = http.createServer(async (req,res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname === '/') { res.setHeader('Content-Type','text/html');res.end(html);return; }
    const file = path.resolve(root,'.'+pathname);
    if(!file.startsWith(root+path.sep)) {res.writeHead(403).end();return;}
    const mime = {'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.pdf':'application/pdf','.json':'application/json','.svg':'image/svg+xml','.wasm':'application/wasm'};
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(await fs.readFile(file));
  } catch {res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser = await chromium.launch({headless:true,channel:"chrome"});
try {
  const page = await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  await page.waitForFunction(()=>window.review?.ready,{timeout:30000});
  const box=async selector=>page.locator(selector).boundingBox();
  const checks=[];
  const foldChecks=[];
  async function assertToolbarVisible(label) {
    const rail=await box('.universal-agent-chat-rail__tools');
    const bounds=await page.locator('#paper-viewer-toolbar button:visible, #paper-viewer-page-input, #paper-viewer-page-count, #paper-viewer-zoom-label').evaluateAll(nodes=>nodes.map(node=>({id:node.id,left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right})));
    for(const bound of bounds){
      assert.ok(bound.right<=rail.x+rail.width+1,label+': '+bound.id+' fits the right bar');
      assert.ok(bound.left>=rail.x-1,label+': '+bound.id+' stays inside the right bar');
    }
  }
  async function capture(name) {
    await page.locator('#paper-viewer-stage').evaluate(stage=>{stage.scrollTop=0;});
    await page.waitForTimeout(350);
    await page.mouse.move(10,950);
    await page.screenshot({path:path.join(output,name)});
  }
  async function verifyFold(layoutSelector, railSelector, label, theme) {
    const layout=page.locator(layoutSelector);
    const toggle=layout.locator(':scope > .app-left-rail-fold-toggle');
    const main=layout.locator(':scope > .left-rail-template__main');
    const expanded=await main.boundingBox();
    await toggle.focus();await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    assert.equal(await toggle.getAttribute('aria-expanded'),'false');
    assert.equal(await page.locator(railSelector).evaluate(el=>el.inert),true);
    assert.equal(await page.locator(railSelector).isVisible(),false);
    const folded=await main.boundingBox();const track=await layout.boundingBox();const button=await toggle.boundingBox();
    assert.equal(Math.round(folded.x-track.x),24,'collapsed column is exactly 24 pixels');
    assert.ok(button.x>=track.x && button.x+button.width<=folded.x+1,'button stays entirely within collapsed column');
    assert.ok(folded.width>expanded.width,'folding reclaims reading space');
    assert.equal(await toggle.evaluate(el=>getComputedStyle(el).boxShadow),'none');
    assert.equal(await toggle.evaluate(el=>getComputedStyle(el).borderWidth),'0px');
    assert.equal(await toggle.evaluate(el=>getComputedStyle(el).outlineStyle),'solid','keyboard focus remains visible');
    await toggle.evaluate(el=>el.blur());await page.mouse.move(10,950);
    if(label==='papers')await page.locator('#paper-viewer-stage').evaluate(el=>{el.scrollTop=0;});
    await page.waitForTimeout(250);
    if((await page.viewportSize()).width===1440)await page.screenshot({path:path.join(output,label+'-folded-'+theme+'.png')});
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'),'true');
    assert.equal(await page.locator(railSelector).evaluate(el=>el.inert),false);
    assert.equal(Math.round((await main.boundingBox()).width),Math.round(expanded.width),'unfolding restores the previous width');
    foldChecks.push({label,theme,viewport:page.viewportSize().width,columnWidth:folded.x-track.x,buttonWidth:button.width,restored:true,keyboardFocus:true});
  }
  const outline=page.locator('#paper-comment-toggle-btn');
  const chat=page.locator('#agent-chat-rail-toggle-btn');
  const brief=page.locator('#paper-brief-toggle-btn');
  const details=page.locator('#paper-details-toggle-btn');
  for(const width of [1440,1024,800]){
    await page.setViewportSize({width,height:960});
    for(const theme of ['day','night']){
      await page.evaluate(theme=>{document.body.classList.toggle('theme-night',theme==='night');document.body.classList.toggle('theme-day',theme==='day');},theme);
      await page.waitForTimeout(250);
      if(width>980)await verifyFold('#papers-layout','#papers-library-rail','papers',theme);
      const before=await box('#paper-viewer-shell');
      const rail=await box('#universal-agent-chat-rail');
      assert.ok(before.x+before.width<=rail.x+1,'the PDF stays clear of the right bar');
      assert.equal(await page.locator('#paper-comment-sidebar').isVisible(),false);
      assert.equal(await page.locator('.papers-viewer-summary').isVisible(),false);
      assert.equal(await page.locator('.universal-agent-chat-rail__tools button:visible').count(),12);
      assert.equal(await page.locator('#paper-viewer-focus-btn').count(),0,'Focus is removed from the document');
      const controls=await page.locator('#paper-viewer-toolbar button:visible').evaluateAll(buttons=>buttons.map(b=>{const r=b.getBoundingClientRect();return{id:b.id,x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
      await assertToolbarVisible('Reader at '+width);
      assert.equal(await page.locator('#paper-viewer-toolbar').getAttribute('aria-orientation'),'vertical');
      assert.equal((await box('.papers-viewer-head')).height,0,'no toolbar space remains above the PDF');
      const previous=await box('#paper-viewer-prev-btn');const next=await box('#paper-viewer-next-btn');
      assert.ok(next.y>previous.y && Math.abs(next.x-previous.x)<1,'page controls run up and down');
      await outline.focus();await page.keyboard.press('Enter');
      assert.equal(await page.locator('#paper-comment-sidebar').isVisible(),true);
      await assertToolbarVisible('Outline at '+width);
      const sidebar=await box('#paper-comment-sidebar');const openedReader=await box('#paper-viewer-shell');
      assert.ok(openedReader.x+openedReader.width<=sidebar.x+1,'outline does not overlap the PDF');
      await page.locator('[data-paper-bookmark-page="2"]').click();
      await page.waitForFunction(()=>window.review.viewer.getCurrentPageNumber()===2);
      await page.locator('#paper-viewer-prev-btn').click();
      await page.waitForFunction(()=>window.review.viewer.getCurrentPageNumber()===1);
      await details.focus();await page.keyboard.press('Enter');
      assert.equal(await page.locator('#paper-details-sidebar').isVisible(),true);
      assert.equal(await page.locator('#paper-comment-sidebar').isVisible(),false);
      const metadata=await page.evaluate(()=>window.review.paper.pdfMetadata);
      for(const value of Object.values(metadata).filter(Boolean))assert.ok((await page.locator('#paper-summary-list').innerText()).includes(value),'PDF metadata is visible');
      assert.equal(await page.locator('#paper-summary-list').evaluate(el=>el.scrollWidth<=el.clientWidth),true,'metadata fits its column');
      if(width===1440)await capture('papers-details-'+theme+'.png');
      await brief.focus();await page.keyboard.press('Enter');
      assert.equal(await page.locator('#paper-details-sidebar').isVisible(),false,'brief closes details');
      await page.waitForFunction(()=>document.querySelectorAll('.papers-brief-experiment').length===3);
      assert.equal(await page.locator('#paper-comment-sidebar').isVisible(),false,'brief replaces outline');
      assert.equal(await brief.getAttribute('aria-expanded'),'true');
      const briefBox=await box('#paper-research-brief');const briefReader=await box('#paper-viewer-shell');
      assert.ok(briefReader.x+briefReader.width<=briefBox.x+1,'brief does not overlap PDF');
      assert.equal(await page.locator('#paper-brief-content').evaluate(el=>el.scrollWidth<=el.clientWidth),true,'brief wraps inside column');
      const source=page.locator('.papers-brief-evidence summary').first();
      await source.focus();await page.keyboard.press('Enter');
      assert.equal(await page.locator('.papers-brief-evidence blockquote').first().isVisible(),true);
      if(width===1440)await capture('papers-brief-'+theme+'.png');
      await chat.click();
      assert.equal(await page.locator('#paper-research-brief').isVisible(),false,'Hikari closes brief');
      await brief.click();
      assert.equal(await chat.getAttribute('aria-expanded'),'false','brief closes Hikari');
      await brief.click();
      assert.equal(await page.locator('#papers-right-column').isVisible(),false,'closing brief returns its entire space');
      await chat.click();
      assert.equal(await page.locator('#paper-comment-sidebar').isVisible(),false);
      assert.equal(await page.locator('#agent-rail-message-input').isVisible(),true);
      await assertToolbarVisible('Hikari at '+width);
      if(width===1440)await capture('papers-hikari-'+theme+'.png');
      await outline.click();
      assert.equal(await chat.getAttribute('aria-expanded'),'false');
      if(width===1440)await capture('papers-outline-'+theme+'.png');
      await outline.click();
      if(width===1440)await capture('papers-reader-'+theme+'.png');
      checks.push({width,theme,readerWidth:before.width,toolbarControls:controls.length});
    }
  }
  await page.locator('#paper-viewer-zoom-in-btn').click();
  const zoomed=await page.locator('#paper-viewer-zoom-label').innerText();
  await page.locator('#paper-viewer-zoom-reset-btn').click();
  assert.equal(await page.locator('#paper-viewer-zoom-label').innerText(),'100%');
  await page.locator('#paper-viewer-fit-width-btn').click();
  await page.waitForFunction(()=>document.getElementById('paper-viewer-zoom-label').textContent.includes('fit'));
  await page.evaluate(()=>window.review.navigation.showView('biology-notebook-view'));
  assert.equal(await details.isVisible(),false,'Paper details is absent from other modules');
  assert.equal(await brief.isVisible(),false,'Research brief is absent from other modules');
  assert.equal(await outline.isVisible(),false,'Papers outline is absent from other modules');
  assert.equal(await page.locator('#paper-viewer-toolbar').isVisible(),false,'PDF controls are absent from other modules');
  await chat.click();assert.equal(await page.locator('#agent-rail-message-input').isVisible(),true,'other modules retain their chat');
  await page.setViewportSize({width:1440,height:960});
  await page.evaluate(()=>window.review.navigation.showView('agent-view'));
  for(const theme of ['day','night']){
    await page.evaluate(theme=>{document.body.classList.toggle('theme-night',theme==='night');document.body.classList.toggle('theme-day',theme==='day');},theme);
    await verifyFold('.agent-chat-layout','#agent-session-rail','agent',theme);
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.agent-chat-layout .app-left-rail-fold-toggle__chevron').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
  assert.equal(errors.length,0,errors.join('\n'));
  await fs.writeFile(path.join(output,'verification.json'),JSON.stringify({checks,foldChecks,zoomed,errors,actualPdf:true,chatBackend:'not invoked'},null,2));
  console.log(JSON.stringify({checks,errors},null,2));
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
