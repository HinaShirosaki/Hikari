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
    assert.equal(result.status, 0, String(result.error || `Primer hover QA failed (${result.signal || result.status})`));
    return;
  }

  const { app, BrowserWindow } = require('electron');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-primer-hover-'));
  app.setPath('userData', path.join(temp, 'profile'));
  app.on('window-all-closed', () => {});
  await app.whenReady();
  const url = file => pathToFileURL(path.join(root, file)).href;
  const fixture = path.join(temp, 'index.html');
  fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8">
    <link rel="stylesheet" href="${url('styles.css')}">
    <style>
      body{margin:0;display:block}
      .host{position:fixed;inset:20px}
      .host[hidden]{display:none}
      .background{position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:0}
      .source{position:absolute;width:360px;height:16px;padding:0;z-index:1}
    </style></head><body>
    ${['sequence', 'map'].map(surface => `<div id="${surface}" class="host" hidden>
      <button class="background" data-feature-index="1" aria-label="Neighbor feature">Neighbor feature</button>
      <button class="source" data-feature-index="0" aria-label="Construct F">Construct F</button>
    </div>`).join('')}
    <script type="module">
      import {createSequenceHoverTooltipController} from '${url('src/renderer/modules/sequence-viewer/detail-hover.js')}';
      import {bindSequenceHostEvents} from '${url('src/renderer/modules/sequence-viewer/detail-events/sequence-host-bindings.js')}';
      import {attachMapHoverLabel} from '${url('src/renderer/modules/sequence-viewer/vector-builder/map-hover.js')}';
      const primer={name:'Construct F',type:'primer_bind',strand:1,primerSequence:'GGTCTCATGAAATAA',segments:[{start:0,end:9}]};
      let record={sequence:'ATGAAATAA',features:[primer,{name:'Neighbor feature',type:'misc_feature',segments:[{start:0,end:9}]}]};
      const sequenceHover=createSequenceHoverTooltipController(document);
      bindSequenceHostEvents({elements:{sequenceHost:document.getElementById('sequence')},state:{},
        getSelectedRecord:()=>record,getVisibleFeaturesForRecord:()=>record.features,
        hideSequenceHoverTooltip:sequenceHover.hide,
        showSequenceHoverTooltip:(event,feature,length)=>sequenceHover.show(event,feature,length,record.sequence),
        resolveSequenceBoundaryFromEvent:()=>null,updateSequenceCursor:()=>{}});
      const mapHover=attachMapHoverLabel({host:document.getElementById('map'),rootDocument:document,
        getFeature:index=>record.features[index],getSequence:()=>record.sequence});
      mapHover.bind();
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copied=value}}});
      window.prepare=(surface,left,top,neighborType)=>{
        document.activeElement?.blur();sequenceHover.hideNow();mapHover.hide();
        record.features[1]={...record.features[1],type:neighborType,primerSequence:'TTTTTTTTT'};
        for(const host of document.querySelectorAll('.host')){
          host.hidden=host.id!==surface;
          const source=host.querySelector('.source');source.style.left=left+'px';source.style.top=top+'px';
        }
        window.copied='';window.neighborVisits=0;
      };
      document.addEventListener('mouseover',event=>{
        if(event.target.closest('[data-feature-index="1"]'))window.neighborVisits++;
      });
      window.qaReady=true;
    </script></body></html>`);
  const win = new BrowserWindow({ width: 1200, height: 780, show: false,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level >= 3) errors.push(event.message); });
  const exec = async code => {
    try { return await win.webContents.executeJavaScript(code, true); }
    catch (error) { throw new Error(`${error.message}\nScript: ${code}\n${errors.join('\n')}`); }
  };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const move = async point => {
    win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(point.x), y: Math.round(point.y) });
    await pause(20);
  };
  const geometry = selector => exec(`(()=>{
    const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();
    return {hidden:e.hidden,left:r.left,top:r.top,right:r.right,bottom:r.bottom,
      x:r.left+r.width/2,y:r.top+r.height/2,text:e.textContent};
  })()`);
  try {
    await win.loadFile(fixture);
    for (let i = 0; i < 100 && !await exec('Boolean(window.qaReady)'); i++) await pause(30);
    assert.equal(await exec('Boolean(window.qaReady)'), true, errors.join('\n'));
    win.show();win.focus();

    for (const surface of ['sequence', 'map']) {
      const card = `[data-sequence-hover-tooltip="${surface === 'sequence' ? 'feature' : 'map'}"]`;
      for (const neighborType of ['misc_feature', 'primer_bind', 'cds']) {
        for (const edge of [false, true]) {
          await move({ x: 10, y: 720 });
          const left = edge ? 810 : 100;
          const top = edge ? 650 : 100;
          await exec(`prepare(${JSON.stringify(surface)},${left},${top},${JSON.stringify(neighborType)})`);
          const source = await geometry(`#${surface} .source`);
          const origin = { x: source.left + 20, y: source.top + 8 };
          await move(origin);
          const initial = await geometry(card);
          assert.equal(initial.hidden, false, `${surface}: primer opens`);
          assert.match(initial.text, /Construct F/);

          // A map must not chase the pointer while it is still over the same arc.
          await move({ x: origin.x + 4, y: origin.y });
          const stable = await geometry(card);
          assert.equal(stable.left, initial.left, `${surface}: stable horizontal anchor`);
          assert.equal(stable.top, initial.top, `${surface}: stable vertical anchor`);
          const from = { x: origin.x + 4, y: origin.y };
          const button = `${card} [data-sequence-primer-copy-kind="sequence"]`;
          const destination = await geometry(button);
          for (let step = 1; step <= 30; step++) {
            await move({ x: from.x + (destination.x - from.x) * step / 30,
              y: from.y + (destination.y - from.y) * step / 30 });
            const current = await geometry(card);
            assert.equal(current.hidden, false, `${surface}: card survives the path to Copy`);
            assert.match(current.text, /Construct F/, `${surface}: neighboring ${neighborType} cannot steal the card`);
            assert.equal(current.left, initial.left);
            assert.equal(current.top, initial.top);
          }
          await pause(600);
          assert.equal((await geometry(card)).hidden, false, 'Card stays open under the pointer');
          assert.equal(await exec(`document.elementFromPoint(${destination.x},${destination.y}).closest('[data-sequence-primer-copy-kind="sequence"]')!==null`), true);
          win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1,
            x: Math.round(destination.x), y: Math.round(destination.y) });
          win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1,
            x: Math.round(destination.x), y: Math.round(destination.y) });
          await pause(40);
          assert.equal(await exec('window.copied'), 'GGTCTCATGAAATAA', `${surface}: native Copy click`);
          if (!edge) assert.ok(await exec('window.neighborVisits') > 0, 'The path crosses another feature');

          // Leaving the protected path must still allow inspecting another feature.
          await move({ x: 40, y: 400 });
          assert.match((await geometry(card)).text, /Neighbor feature/);
          await move({ x: 10, y: 720 });
          await pause(600);
          assert.equal((await geometry(card)).hidden, true, 'Card dismisses after leaving the workspace');
        }
      }

      await exec(`prepare(${JSON.stringify(surface)},100,100,'misc_feature');
        document.querySelector('#${surface} .source').focus();
        document.querySelector('#${surface} .source').dispatchEvent(new FocusEvent('focusin',{bubbles:true}))`);
      assert.equal((await geometry(card)).hidden, false, `${surface}: keyboard readout opens`);
      assert.match((await geometry(card)).text, /Construct F/, `${surface}: keyboard readout shows the primer`);
      const button = `${card} [data-sequence-primer-copy-kind="name"]`;
      await exec(`document.querySelector(${JSON.stringify(button)}).focus()`);
      await move({ x: 40, y: 400 });
      await pause(600);
      const focused = await geometry(card);
      assert.equal(focused.hidden, false, `${surface}: focused card remains visible`);
      assert.match(focused.text, /Construct F/, 'Focused copy actions retain their card');
      assert.equal(await exec(`document.activeElement.matches(${JSON.stringify(button)})`), true, `${surface}: Copy retains keyboard focus`);
      win.webContents.focus();
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      win.webContents.sendInputEvent({ type: 'char', keyCode: 'Enter' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      await pause(40);
      assert.equal(await exec('window.copied'), 'Construct F', 'Keyboard Copy still works');
      await exec('document.activeElement.blur()');
      assert.equal((await geometry(card)).hidden, true);
    }
    assert.deepEqual(errors, []);
    console.log('Primer hover Electron QA passed: native paths across plain/primer/CDS neighbors, fixed anchors, flipped/clamped edges, Copy clicks, switching/dismissal, and keyboard focus on sequence tracks and maps.');
  } finally {
    win.destroy();
    await fs.promises.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  app.quit();
}
main().catch(error => { console.error(error); if (process.versions.electron) require('electron').app.exit(1); else process.exitCode = 1; });
