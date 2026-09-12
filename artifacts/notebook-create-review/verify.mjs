import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '/Users/shiyifan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const root = process.cwd();
const output = path.join(root, 'artifacts/notebook-create-review');
const html = (await fs.readFile(path.join(root, 'index.html'), 'utf8'))
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
  .replace('</body>', '<script type="module" src="/artifacts/notebook-create-review/fixture.js"></script></body>');
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    res.setHeader('Content-Type', ({'.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)] || 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless:true,channel:'chrome'});
  const page = await browser.newPage({viewport:{width:1512,height:940},deviceScaleFactor:1});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.waitForFunction(() => window.review?.ready);
  const byId = id => page.locator('#biology-notebook-' + id);
  const projectDialog = byId('project-dialog-overlay');
  const experimentDialog = byId('experiment-dialog-overlay');
  const name = byId('project-name');
  const create = byId('project-create-btn');
  const focusId = () => page.evaluate(() => document.activeElement?.id);

  // The visible rail action opens a compact form and restores focus on cancel.
  await byId('header-add-project-btn').click();
  await name.waitFor({state:'visible'});
  await page.waitForFunction(() => document.activeElement?.id === 'biology-notebook-project-name');
  assert.equal(await byId('project-description').isVisible(), false);
  await create.click();
  assert.match(await byId('project-form-status').textContent(), /Enter a project name/);
  await name.fill(' calb lipase thermostability ');
  await create.click();
  assert.match(await byId('project-form-status').textContent(), /already exists/);
  await name.fill('Protein stability study');
  await page.locator('#biology-notebook-project-details summary').click();
  await byId('project-description').fill('Compare thermal tolerance across the variant panel.');
  await create.focus();
  await page.keyboard.press('Tab');
  assert.equal(await focusId(), 'biology-notebook-project-dialog-close-btn');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await focusId(), 'biology-notebook-project-create-btn');
  await page.keyboard.press('Escape');
  assert.equal(await projectDialog.isVisible(), false);
  assert.equal(await focusId(), 'biology-notebook-header-add-project-btn');

  const geometry = [];
  for (const width of [1512,1024,800,560]) {
    await page.setViewportSize({width,height:940});
    for (const theme of ['day','night']) {
      await page.evaluate(theme => {
        document.body.classList.toggle('theme-night', theme === 'night');
        document.body.classList.toggle('theme-day', theme === 'day');
      }, theme);
      await byId('header-add-project-btn').click();
      await name.fill('Protein stability study');
      const boxes = await page.evaluate(() => {
        const box = id => {
          const el = document.getElementById('biology-notebook-' + id);
          const r = el.getBoundingClientRect();
          return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,overflow:el.scrollWidth>el.clientWidth+1};
        };
        return {rail:box('rail'),toolbox:box('tool-sidebar'),experiment:box('new-experiment-btn'),add:box('header-add-project-btn'),dialog:(() => {
          const el = document.querySelector('.biology-notebook-project-dialog'); const r = el.getBoundingClientRect();
          return {x:r.x,right:r.right,y:r.y,bottom:r.bottom,overflow:el.scrollWidth>el.clientWidth+1};
        })()};
      });
      assert.equal(boxes.dialog.overflow, false);
      assert.ok(boxes.dialog.right - boxes.dialog.x <= 448, 'project dialog stays compact');
      assert.ok(boxes.dialog.x >= 0 && boxes.dialog.right <= width);
      assert.ok(boxes.dialog.y >= 0 && boxes.dialog.bottom <= 940);
      assert.ok(boxes.experiment.bottom <= boxes.add.y);
      assert.ok(boxes.experiment.right + 4 <= boxes.toolbox.x || boxes.experiment.bottom <= boxes.toolbox.y, 'new experiment stays clear of the toolbox');
      assert.equal(boxes.experiment.overflow, false);
      assert.equal(boxes.add.overflow, false);
      geometry.push({width,theme,...boxes});
      await page.screenshot({path:path.join(output, `project-${width}-${theme}.png`)});
      await byId('project-cancel-btn').click();
    }
  }
  await page.setViewportSize({width:1512,height:940});
  await page.evaluate(() => { document.body.classList.remove('theme-night'); document.body.classList.add('theme-day'); });
  await page.screenshot({path:path.join(output,'notebook-actions.png')});

  // Creating from the rail selects the new dashboard and saves its description.
  await byId('header-add-project-btn').click();
  await name.fill('Protein stability study');
  await page.locator('#biology-notebook-project-details summary').click();
  await byId('project-description').fill('Compare thermal tolerance across the variant panel.');
  await page.screenshot({path:path.join(output,'project-description.png')});
  await create.click();
  await projectDialog.waitFor({state:'hidden'});
  assert.equal(await page.evaluate(() => window.review.state.projects.at(-1).description), 'Compare thermal tolerance across the variant panel.');
  assert.equal(await byId('project-dashboard').isVisible(), true);
  assert.equal(await page.locator('[data-project-description]').getAttribute('data-project-description'), await page.evaluate(() => window.review.state.projects.at(-1).id));

  // Cancel, then create from experiment setup: retain search and selected protocol.
  await byId('new-experiment-btn').click();
  await byId('protocol-search').fill('thermal');
  await page.locator('[data-notebook-experiment-protocol-id="review-protocol"]').click();
  await page.screenshot({path:path.join(output,'experiment-setup.png')});
  await byId('experiment-add-project-btn').click();
  assert.equal(await experimentDialog.isVisible(), false);
  await name.fill('Discarded draft');
  await page.keyboard.press('Escape');
  assert.equal(await experimentDialog.isVisible(), true);
  assert.equal(await focusId(), 'biology-notebook-experiment-add-project-btn');
  assert.equal(await byId('protocol-search').inputValue(), 'thermal');
  assert.equal(await byId('protocol-select').inputValue(), 'review-protocol');
  await byId('experiment-add-project-btn').click();
  await name.fill('Follow-up screen');
  await name.press('Enter');
  await projectDialog.waitFor({state:'hidden'});
  assert.equal(await experimentDialog.isVisible(), true);
  assert.equal(await byId('project-dashboard').isVisible(), true, 'project refresh leaves the workspace behind setup intact');
  assert.equal(await byId('protocol-search').inputValue(), 'thermal');
  assert.equal(await byId('protocol-select').inputValue(), 'review-protocol');
  assert.equal(await byId('project-select').inputValue(), await page.evaluate(() => window.review.state.projects.at(-1).id));
  assert.equal(await byId('experiment-start-btn').isEnabled(), true);
  await byId('experiment-start-btn').click();
  assert.equal(await experimentDialog.isVisible(), false);
  assert.equal(await byId('protocol-area').isVisible(), true);

  // A fresh notebook can create its first project inside experiment setup.
  await page.reload();
  await page.waitForFunction(() => window.review?.ready);
  await page.evaluate(() => { window.review.state.projects = []; window.review.state.notebookEntries = []; window.review.notebook.renderProjectOptions(); window.review.notebook.renderEntries(); });
  await byId('new-experiment-btn').click();
  await byId('experiment-add-project-btn').click();
  await name.fill('My first project');
  await create.click();
  await projectDialog.waitFor({state:'hidden'});
  await page.locator('[data-notebook-experiment-protocol-id="review-protocol"]').click();
  assert.equal(await byId('experiment-start-btn').isEnabled(), true);
  assert.equal(await byId('protocol-select').inputValue(), 'review-protocol');
  assert.equal(errors.length, 0, errors.join('\n'));
  const report = {geometry,keyboardFocus:true,validation:true,descriptionSaved:true,experimentRoundTrip:true,firstProject:true,errors};
  await fs.writeFile(path.join(output,'verification.json'), JSON.stringify(report,null,2));
  console.log(JSON.stringify({layouts:geometry.length,keyboardFocus:true,validation:true,experimentRoundTrip:true,firstProject:true,errors}));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
