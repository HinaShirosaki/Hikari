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
    assert.equal(result.status, 0, String(result.error || `Restriction layout QA failed (${result.signal || result.status})`));
    return;
  }

  const { app, BrowserWindow } = require('electron');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-restriction-layout-'));
  const output = path.join(root, 'artifacts/sequence-restriction-layout');
  fs.mkdirSync(output, { recursive: true });
  app.setPath('userData', path.join(temp, 'profile'));
  await app.whenReady();
  const url = file => pathToFileURL(path.join(root, file)).href;
  const fixture = path.join(temp, 'index.html');
  fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8">
    <link rel="stylesheet" href="${url('styles.css')}">
    <style>body{display:block;margin:0;padding:30px}.sequence-viewer-sequence-host{height:500px}</style>
    </head><body><div class="sequence-viewer-sequence-host" id="host"></div>
    <script type="module">
      import {computeSequenceLayoutMetrics} from '${url('src/renderer/modules/sequence-viewer/detail-layout.js')}';
      import {renderDualStrandSequenceLinesHtml} from '${url('src/renderer/modules/sequence-viewer/rendering.js')}';
      const host=document.getElementById('host');
      host.addEventListener('click',event=>{window.lastClicked=event.target.closest('[data-feature-index]')?.dataset.featureIndex});
      window.render=(width,selected,scenario='standard',theme='day')=>{
        document.body.className='theme-'+theme;
        host.style.width=width+'px';
        const metrics=computeSequenceLayoutMetrics(document,host);
        const standard=[
          {name:'BveI',site:'ACCTGC',cut:'',start:3},
          {name:'BstAPI',site:'GCATGGCCTGC',cut:'GCATGG^CCTGC',start:18},
          {name:'NruI',site:'TCGCGA',cut:'TCG^CGA',start:60},
          {name:'Split site',site:'GAATTC',cut:'G^AATTC',start:metrics.lineLength-3}
        ];
        const center=Math.floor(metrics.lineLength/2)-4;
        const dense=[
          ...Array.from({length:18},(_,i)=>({name:'Dense-'+String(i+1).padStart(2,'0'),site:'GAATTC',cut:'G^AATTC',start:center+(i%4)})),
          {name:'Long left boundary enzyme label for layout QA',site:'GAATTC',cut:'G^AATTC',start:0},
          {name:'Long right boundary enzyme label for layout QA',site:'GAATTC',cut:'G^AATTC',start:metrics.lineLength-2}
        ];
        const paired=[
          {name:'BsaAI',site:'TACGTG',cut:'TAC^GTG',start:5},
          {name:'PsyI',site:'GACGGGTC',cut:'GAC^GGGTC',start:10},
          {name:'Esp3I',site:'CGTCTC',cut:'',start:metrics.lineLength+3},
          {name:'PfoI',site:'TCCGGGA',cut:'T^CCGGGA',start:metrics.lineLength+8}
        ];
        window.scenario=scenario;
        window.features=({standard,dense,paired}[scenario]).map(({start,...feature})=>({...feature,type:'restriction_site',strand:1,
          segments:[{start,end:start+feature.site.length}]}));
        const bases=Array(Math.max(110,metrics.lineLength+10)).fill('A');
        features.forEach(feature=>[...feature.site].forEach((base,index)=>{bases[feature.segments[0].start+index]=base}));
        host.innerHTML=renderDualStrandSequenceLinesHtml(bases.join(''),selected<0?[]:features[selected].segments,{
          ...metrics,sequenceLineHeightPx:metrics.lineHeightPx,features,selectedFeatureIndex:selected});
      };
      window.measure=()=>{
        const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}};
        return [...host.querySelectorAll('.sequence-viewer-restriction-annot')].map(annot=>{
          const line=annot.closest('.sequence-viewer-dual-line'),index=Number(annot.dataset.featureIndex);
          const track=annot.closest('.sequence-viewer-line-restriction-track');
          const start=Number(line.dataset.lineStart),end=Number(line.dataset.lineEnd);
          const segment=features[index].segments[0];
          const first=Math.max(start,segment.start)-start,last=Math.min(end,segment.end)-start-1;
          const top=[...line.querySelectorAll('.sequence-viewer-strand-row-top .sequence-viewer-seq-base')];
          const bottom=[...line.querySelectorAll('.sequence-viewer-strand-row-bottom .sequence-viewer-seq-base')];
          return {index,name:features[index].name,box:rect(annot.querySelector('.sequence-viewer-restriction-box')),
            label:rect(annot.querySelector('.sequence-viewer-restriction-label')),
            lineStart:start,track:rect(track),line:rect(line),lanes:Number(track.style.getPropertyValue('--sequence-viewer-restriction-lanes')),
            title:annot.title,
            first:rect(top[first]),last:rect(top[last]),bottomFirst:rect(bottom[first]),bottomLast:rect(bottom[last])};
        });
      };
      window.labelHitTargets=()=>[...host.querySelectorAll('.sequence-viewer-restriction-label')].map(label=>{
        const r=label.getBoundingClientRect();
        const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('[data-feature-index]');
        return {expected:label.closest('[data-feature-index]').dataset.featureIndex,actual:hit?.dataset.featureIndex};
      });
      window.qaReady=true;
    </script></body></html>`);
  const win = new BrowserWindow({ width: 1200, height: 700, show: false,
    webPreferences: { sandbox: true, contextIsolation: true } });
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level >= 3) errors.push(event.message); });
  const exec = code => win.webContents.executeJavaScript(code, true);
  await win.loadFile(fixture);
  for (let i = 0; i < 100 && !await exec('Boolean(window.qaReady)'); i++) {
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.equal(await exec('Boolean(window.qaReady)'), true, errors.join('\n'));
  let cases = 0;
  for (const zoom of [1, 1.25, 0.8]) {
    win.webContents.setZoomFactor(zoom);
    for (const width of [480, 900]) {
      for (const selected of [-1, 2]) {
        for (const scenario of ['standard', 'paired', 'dense']) {
          for (const theme of ['day', 'night']) {
            await exec(`new Promise(resolve=>{
              render(${width},${selected},'${scenario}','${theme}');
              requestAnimationFrame(()=>requestAnimationFrame(resolve));
            })`);
            const sites = await exec('measure()');
            const context = `${scenario}, ${theme}, width=${width}, zoom=${zoom}, selected=${selected}`;
            if (scenario === 'standard') {
              assert.equal(sites.filter(site => site.index === 3).length, 2, 'wrapped site must render on both lines');
            }
            if (scenario === 'paired') {
              assert.equal(sites.every(site => site.lanes === 1), true, `${context}: overlapping recognition spans with separated labels share one row`);
            }
            if (scenario === 'dense') {
              assert.ok(sites[0].lanes <= 9, `${context}: dense site labels fan out into fewer rows (${sites[0].lanes})`);
              assert.equal(sites.filter(site => site.index === 19).length, 2, `${context}: dense boundary site wraps`);
              assert.ok(await exec("host.querySelectorAll('.sequence-viewer-restriction-guide').length > 0"));
            }
            for (const site of sites) {
              const close = (actual, expected, label) => assert.ok(
                Math.abs(actual - expected) < 0.05, `${context}: ${label} (${actual} vs ${expected})`
              );
              close(site.box.left, site.first.left, 'left edge');
              close(site.box.right, site.last.right, 'right edge');
              close(site.box.left, site.bottomFirst.left, 'complement left edge');
              close(site.box.right, site.bottomLast.right, 'complement right edge');
              assert.ok(site.label.left >= site.track.left - 0.05 && site.label.right <= site.track.right + 0.05,
                `${context}, ${site.name}: labels stay within sequence row (${JSON.stringify({label:site.label,track:site.track})})`);
              assert.ok(site.label.top >= site.line.top - 0.05 && site.label.bottom <= site.box.top,
                `${context}, ${site.name}: label is above bases with reserved vertical space`);
              assert.ok(site.title.includes(site.name), `${context}: full name remains in tooltip`);
              assert.ok(site.box.top <= site.first.top && site.box.bottom >= site.bottomLast.bottom,
                `${context}: box must cover both strands vertically`);
            }
            for (let i = 0; i < sites.length; i++) {
              for (const other of sites.slice(i + 1)) {
                if (sites[i].lineStart !== other.lineStart) continue;
                const a = sites[i].label, b = other.label;
                assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top,
                  `${context}: labels ${sites[i].name} and ${other.name} overlap`);
              }
            }
            for (const hit of await exec('labelHitTargets()')) {
              assert.equal(hit.actual, hit.expected, `${context}: each label is independently clickable`);
            }
            cases += 1;
            if (zoom === 1 && selected === -1 && theme === 'day') {
              fs.writeFileSync(path.join(output, 'restriction-sites.png'), (await win.webContents.capturePage({
                x: 30, y: 20, width: width + 10, height: 400
              })).toPNG());
              fs.copyFileSync(path.join(output, 'restriction-sites.png'), path.join(output, `${scenario}-${width}.png`));
            }
          }
        }
      }
    }
  }
  win.webContents.setZoomFactor(1);
  win.show();
  win.focus();
  await exec(`new Promise(resolve=>{
    render(900,-1,'dense');
    requestAnimationFrame(()=>requestAnimationFrame(resolve));
  })`);
  const firstLabel = await exec(`(()=>{
    const label=host.querySelector('.sequence-viewer-restriction-label');
    const r=label.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,index:label.closest('[data-feature-index]').dataset.featureIndex};
  })()`);
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', x: Math.round(firstLabel.x), y: Math.round(firstLabel.y), clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', x: Math.round(firstLabel.x), y: Math.round(firstLabel.y), clickCount: 1 });
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(await exec('window.lastClicked'), firstLabel.index, 'native label click selects its own enzyme');
  await exec("window.lastClicked=null;host.querySelector('.sequence-viewer-restriction-annot').focus()");
  assert.equal(await exec('document.activeElement.dataset.featureIndex'), firstLabel.index, 'enzyme annotation receives keyboard focus');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  win.webContents.sendInputEvent({ type: 'char', keyCode: 'Enter' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(await exec('window.lastClicked'), firstLabel.index, 'keyboard activation retains feature selection');
  assert.deepEqual(errors, []);
  console.log(`Restriction layout Electron QA passed: ${cases} size/zoom/theme/selection/density cases, both strands, non-overlapping bounded labels, compact lanes, native clicks, keyboard activation, and wrapped sites. Screenshots: ${output}`);
  win.destroy();
  await fs.promises.rm(temp, { recursive: true, force: true });
  app.quit();
}

main().catch(error => {
  console.error(error);
  if (process.versions.electron) require('electron').app.exit(1);
  else process.exitCode = 1;
});
