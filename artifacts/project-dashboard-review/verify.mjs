import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '/Users/shiyifan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const root = process.cwd();
const output = path.join(root, 'artifacts/project-dashboard-review');
const html = (await fs.readFile(path.join(root,'index.html'),'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace('</body>','<script type="module" src="/artifacts/project-dashboard-review/fixture.js"></script></body>');
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
  const page=await browser.newPage({viewport:{width:1512,height:940},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  await page.waitForFunction(()=>window.review?.ready);
  const checks=[];
  for(const width of [1512,1280,1024,800,560]) {
    await page.setViewportSize({width,height:940});
    for(const theme of ['day','night']) {
      await page.evaluate(theme=>{document.body.classList.toggle('theme-night',theme==='night');document.body.classList.toggle('theme-day',theme==='day');},theme);
      await page.waitForTimeout(150);
      const geometry=await page.evaluate(()=>{
        const q=s=>document.querySelector(s);const box=s=>{const r=q(s).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
        const host=q('.project-dashboard');
        return {host:box('.project-dashboard'),overflow:host.scrollWidth>host.clientWidth+1,stats:[...document.querySelectorAll('.project-stat-card')].map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,height:r.height,width:r.width};}),description:box('#project-description-heading'),heatmap:box('#biology-notebook-project-contribution-heading'),months:[...document.querySelectorAll('.project-contribution-month-label')].map(e=>({y:e.getBoundingClientRect().y})),grid:box('.project-contribution-grid'),legend:box('.project-contribution-legend'),schedule:box('.project-paper-finder-form'),toolbox:box('#biology-notebook-tool-sidebar'),actions:box('.project-dashboard-actions')};
      });
      assert.equal(geometry.overflow,false,'dashboard fits at '+width);
      assert.ok(geometry.toolbox.bottom<=geometry.stats[0].y,'default toolbox stays above statistics');
      if(width>980)assert.ok(geometry.actions.right+4<=geometry.toolbox.x,'toolbox stays clear of header actions');
      assert.equal(new Set(geometry.months.map(m=>m.y)).size,1,'months share one row');
      assert.ok(Math.abs(geometry.grid.right-geometry.legend.right)<1,'legend aligns with heatmap');
      if(geometry.host.width>896)assert.equal(geometry.description.y,geometry.heatmap.y,'overview headings align');
      checks.push({width,theme,...geometry});
      if(width===1512||width===1024||width===800||width===560)await page.screenshot({path:path.join(output,'dashboard-'+width+'-'+theme+'.png')});
    }
  }
  await page.setViewportSize({width:1512,height:940});
  await page.evaluate(()=>{document.body.classList.remove('theme-night');document.body.classList.add('theme-day');});
  await page.locator('.project-dashboard').screenshot({path:path.join(output,'dashboard-detail.png')});
  await page.locator('[data-project-description]').fill('Updated dashboard review notes.');
  await page.locator('[data-project-description]').blur();
  assert.equal(await page.evaluate(()=>window.review.state.projects[0].description),'Updated dashboard review notes.');
  assert.ok(await page.evaluate(()=>window.review.saves)>0);
  await page.locator('[data-paper-finder-frequency-unit]').selectOption('month');
  assert.equal(await page.locator('[data-paper-finder-monthday-field]').isVisible(),true);
  assert.equal(await page.locator('[data-paper-finder-weekday-field]').isVisible(),false);
  await page.locator('[data-paper-finder-frequency-unit]').selectOption('day');
  assert.equal(await page.locator('[data-paper-finder-monthday-field]').isVisible(),false);
  await page.locator('[data-paper-finder-frequency-unit]').selectOption('week');
  assert.equal(await page.locator('[data-paper-finder-weekday-field]').isVisible(),true);
  await page.locator('#biology-notebook-tool-fold-toggle').click();
  assert.equal(await page.locator('#biology-notebook-tool-fold-toggle').getAttribute('aria-expanded'),'true');
  await page.locator('#biology-notebook-tool-collapse-btn').click();
  assert.equal(await page.locator('#biology-notebook-tool-fold-toggle').getAttribute('aria-expanded'),'false');
  await page.keyboard.press('Tab');
  await page.locator('.project-contribution-cell').first().focus();
  assert.equal(await page.locator('.project-contribution-cell').first().evaluate(e=>getComputedStyle(e).outlineStyle),'solid');
  assert.equal(errors.length,0,errors.join('\n'));
  await fs.writeFile(path.join(output,'verification.json'),JSON.stringify({checks,descriptionSaved:true,scheduleFields:true,heatmapKeyboardFocus:true,errors},null,2));
  console.log(JSON.stringify({checks:checks.map(c=>({width:c.width,theme:c.theme,hostWidth:c.host.width,overflow:c.overflow})),errors},null,2));
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
