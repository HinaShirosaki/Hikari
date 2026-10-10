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
      window.render=(width,selected)=>{
        host.style.width=width+'px';
        const metrics=computeSequenceLayoutMetrics(document,host);
        window.features=[
          {name:'BveI',site:'ACCTGC',cut:'',start:3},
          {name:'BstAPI',site:'GCATGGCCTGC',cut:'GCATGG^CCTGC',start:18},
          {name:'NruI',site:'TCGCGA',cut:'TCG^CGA',start:60},
          {name:'Split site',site:'GAATTC',cut:'G^AATTC',start:metrics.lineLength-3}
        ].map(({start,...feature})=>({...feature,type:'restriction_site',strand:1,
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
          const start=Number(line.dataset.lineStart),end=Number(line.dataset.lineEnd);
          const segment=features[index].segments[0];
          const first=Math.max(start,segment.start)-start,last=Math.min(end,segment.end)-start-1;
          const top=[...line.querySelectorAll('.sequence-viewer-strand-row-top .sequence-viewer-seq-base')];
          const bottom=[...line.querySelectorAll('.sequence-viewer-strand-row-bottom .sequence-viewer-seq-base')];
          return {index,name:features[index].name,box:rect(annot.querySelector('.sequence-viewer-restriction-box')),
            label:rect(annot.querySelector('.sequence-viewer-restriction-label')),
            first:rect(top[first]),last:rect(top[last]),bottomFirst:rect(bottom[first]),bottomLast:rect(bottom[last])};
        });
      };
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
        await exec(`new Promise(resolve=>{
          render(${width},${selected});
          requestAnimationFrame(()=>requestAnimationFrame(resolve));
        })`);
        const sites = await exec('measure()');
        assert.equal(sites.filter(site => site.index === 3).length, 2, 'wrapped site must render on both lines');
        for (const site of sites) {
          const context = `${site.name}, width=${width}, zoom=${zoom}, selected=${selected}`;
          const close = (actual, expected, label) => assert.ok(
            Math.abs(actual - expected) < 0.05, `${context}: ${label} (${actual} vs ${expected})`
          );
          close(site.box.left, site.first.left, 'left edge');
          close(site.box.right, site.last.right, 'right edge');
          close(site.box.left, site.bottomFirst.left, 'complement left edge');
          close(site.box.right, site.bottomLast.right, 'complement right edge');
          close((site.label.left + site.label.right) / 2, (site.first.left + site.last.right) / 2, 'label center');
          assert.ok(site.box.top <= site.first.top && site.box.bottom >= site.bottomLast.bottom,
            `${context}: box must cover both strands vertically`);
        }
        cases += 1;
        if (zoom === 1 && width === 900 && selected === -1) {
          fs.writeFileSync(path.join(output, 'restriction-sites.png'), (await win.webContents.capturePage({
            x: 100, y: 20, width: 810, height: 170
          })).toPNG());
        }
      }
    }
  }
  assert.deepEqual(errors, []);
  console.log(`Restriction layout Electron QA passed: ${cases} size/zoom/selection cases, both strands, label centering, and wrapped sites. Screenshot: ${output}`);
  win.destroy();
  await fs.promises.rm(temp, { recursive: true, force: true });
  app.quit();
}

main().catch(error => {
  console.error(error);
  if (process.versions.electron) require('electron').app.exit(1);
  else process.exitCode = 1;
});
