'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

async function main() {
  if (!process.versions.electron) {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
      encoding: 'utf8', timeout: 60000
    });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    assert.equal(result.status, 0, String(result.error || `Cursor menu QA failed (${result.signal || result.status})`));
    return;
  }
  const { app, BrowserWindow } = require('electron');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-cursor-menu-'));
  const output = path.join(root, 'artifacts/sequence-cursor-menu');
  fs.mkdirSync(output, { recursive: true });
  app.setPath('userData', path.join(temp, 'profile'));
  await app.whenReady();
  const url = file => pathToFileURL(path.join(root, file)).href;
  const fixture = path.join(temp, 'index.html');
  fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8">
    <link rel="stylesheet" href="${url('styles.css')}">
    <style>body{display:block;margin:0}.view{height:100vh}</style></head><body>
    ${fs.readFileSync(path.join(root, 'ui/html/views/sequence-viewer-view.html'), 'utf8')}
    ${fs.readFileSync(path.join(root, 'ui/html/views/sequence-viewer-detail-view.html'), 'utf8')}
    <script type="module">
      import {initSequenceViewer} from '${url('src/renderer/modules/sequence-viewer/index.js')}';
      const show=id=>document.querySelectorAll('.view').forEach(e=>{e.classList.toggle('is-active',e.id===id);e.hidden=e.id!==id});
      window.viewer=initSequenceViewer({document,state:{settings:{},projects:[]},
        onNavigateHome:()=>show('sequence-viewer-view'),onNavigateDetail:()=>show('sequence-viewer-detail-view')});
      window.sequence='AAAACCCCGGGGTTTT'.repeat(4);
      window.host=document.getElementById('sequence-viewer-sequence-host');
      window.menu=document.getElementById('sequence-viewer-feature-context-menu');
      window.load=(topology='circular')=>viewer.loadFromExternal({name:'Cursor actions',topology,sequence,
        features:[{id:'feature',name:'Example feature',type:'cds',strand:-1,segments:[{start:8,end:29}]}]});
      window.readSequence=()=>[...host.querySelectorAll('.sequence-viewer-strand-row-top .sequence-viewer-seq-base')].map(e=>e.textContent).join('');
      window.openCursor=(boundary)=>{
        const base=[...host.querySelectorAll('.sequence-viewer-strand-row-top .sequence-viewer-seq-base')][boundary];
        const r=base.getBoundingClientRect();
        base.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left,clientY:r.top+2}));
      };
      window.frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      load();window.qaReady=true;
    </script></body></html>`);
  const win = new BrowserWindow({ width: 1200, height: 820, show: false,
    webPreferences: { sandbox: true, contextIsolation: true } });
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level >= 3) errors.push(event.message); });
  const exec = code => win.webContents.executeJavaScript(code, true);
  await win.loadFile(fixture);
  assert.equal(await exec('Boolean(window.qaReady)'), true, errors.join('\n'));
  let cases = 0;
  for (const width of [760, 1200]) {
    win.setSize(width, 820);
    for (const zoom of [0.8, 1, 1.25]) {
      win.webContents.setZoomFactor(zoom);
      await exec('load();frames()');
      // An unrelated selected feature must not replace the cursor menu.
      await exec("host.querySelector('[data-feature-index=\"0\"]').click();openCursor(5);frames()");
      const readout = await exec(`(()=>{
        const r=menu.getBoundingClientRect();return {hidden:menu.hidden,text:menu.textContent,
          left:r.left,right:r.right,top:r.top,bottom:r.bottom,w:innerWidth,h:innerHeight,
          cursor:host.querySelector('.sequence-viewer-line-cursor').style.left};
      })()`);
      assert.equal(readout.hidden, false);
      assert.match(readout.text, /Before base 6/);
      assert.match(readout.text, /Insert Sequence/);
      assert.match(readout.text, /Set Sequence Start Here/);
      assert.ok(readout.left >= 0 && readout.right <= readout.w && readout.top >= 0 && readout.bottom <= readout.h);
      await exec("host.dispatchEvent(new MouseEvent('mouseleave'));host.dispatchEvent(new MouseEvent('mousemove',{bubbles:true}));frames()");
      assert.equal(await exec("host.querySelector('.sequence-viewer-line-cursor').style.left"), readout.cursor);
      if (width === 1200 && zoom === 1) {
        fs.writeFileSync(path.join(output, 'cursor-menu.png'), (await win.webContents.capturePage()).toPNG());
      }
      await exec("menu.querySelector('[data-sequence-cursor-action=\"set-origin\"]').click();frames()");
      assert.equal(await exec('readSequence()'), await exec('sequence.slice(5)+sequence.slice(0,5)'));
      assert.equal(await exec('menu.hidden'), true);
      assert.equal(await exec("document.getElementById('sequence-viewer-stat-length').textContent"), '64');

      await exec('openCursor(4);frames()');
      await exec("menu.querySelector('[data-sequence-cursor-action=\"insert\"]').click();frames()");
      assert.equal(await exec("document.getElementById('sequence-viewer-sequence-edit-overlay').hidden"), false);
      assert.equal(await exec("document.activeElement.id"), 'sequence-viewer-sequence-edit-textarea');
      const before = await exec('readSequence()');
      await exec("document.getElementById('sequence-viewer-sequence-edit-textarea').value='ATG';document.getElementById('sequence-viewer-sequence-edit-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));frames()");
      assert.equal(await exec('readSequence()'), before.slice(0, 4) + 'ATG' + before.slice(4));
      assert.equal(await exec("document.getElementById('sequence-viewer-sequence-edit-overlay').hidden"), true);

      await exec("load('linear');openCursor(4);frames()");
      assert.equal(await exec("Boolean(menu.querySelector('[data-sequence-cursor-action=\"set-origin\"]'))"), false);
      assert.equal(await exec("Boolean(menu.querySelector('[data-sequence-cursor-action=\"insert\"]'))"), true);
      await exec("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));frames()");
      assert.equal(await exec('menu.hidden'), true);
      await exec('load();openCursor(0);frames()');
      assert.equal(await exec("menu.querySelector('[data-sequence-cursor-action=\"set-origin\"]').disabled"), true);
      cases++;
    }
  }
  assert.deepEqual(errors, []);
  console.log(`Cursor menu Electron QA passed: ${cases} size/zoom cases, pinned cursor, feature selection, plasmid origin, insertion, linear sequences, and Escape. Screenshot: ${output}`);
  win.destroy();
  await fs.promises.rm(temp, { recursive: true, force: true });
  app.quit();
}

main().catch(error => {
  console.error(error);
  if (process.versions.electron) require('electron').app.exit(1);
  else process.exitCode = 1;
});
