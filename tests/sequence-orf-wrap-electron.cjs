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
    assert.equal(result.status, 0, String(result.error || `ORF wrap QA failed (${result.signal || result.status})`));
    return;
  }
  const { app, BrowserWindow } = require('electron');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-orf-wrap-'));
  const output = path.join(root, 'artifacts/sequence-orf-wrap');
  fs.mkdirSync(output, { recursive: true });
  app.setPath('userData', path.join(temp, 'profile'));
  await app.whenReady();
  const url = file => pathToFileURL(path.join(root, file)).href;
  const fixture = path.join(temp, 'index.html');
  fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8">
    <link rel="stylesheet" href="${url('styles.css')}">
    <style>body{display:block;margin:0;padding:24px}.sequence-viewer-sequence-host{height:500px}</style>
    </head><body><div class="sequence-viewer-sequence-host" id="host"></div>
    <script type="module">
      import {computeSequenceLayoutMetrics} from '${url('src/renderer/modules/sequence-viewer/detail-layout.js')}';
      import {renderDualStrandSequenceLinesHtml} from '${url('src/renderer/modules/sequence-viewer/rendering.js')}';
      import {buildSelectedOrfTranslationContext} from '${url('src/renderer/modules/sequence-viewer/orf-analysis.js')}';
      import {complementBase} from '${url('src/renderer/modules/sequence-viewer/shared.js')}';
      import {createSequenceViewerAminoAcidEditingController} from '${url('src/renderer/modules/sequence-viewer/detail-amino-acid-editing.js')}';
      const host=document.getElementById('host');
      const editor=createSequenceViewerAminoAcidEditingController();
      window.render=(width,strand,split,origin=false,single=false)=>{
        host.style.width=width+'px';host.scrollTop=0;
        const metrics=computeSequenceLayoutMetrics(document,host);
        const coding=single?'ATGTAA':'ATGAAATTTGGGCCCGTTTGG'+'TAA';
        const length=metrics.lineLength*2+1;
        const start=(origin?length:metrics.lineLength)-split-(strand===-1?3:0);
        const genomic=strand===-1?[...coding].reverse().map(complementBase).join(''):coding;
        const bases=Array(length).fill('C');
        [...genomic].forEach((base,i)=>{bases[(start+i)%length]=base});
        window.record={sequence:bases.join('')};
        const end=start+coding.length;
        const feature={type:'open_reading_frame',strand,segments:end>length
          ?[{start,end:length},{start:0,end:end-length}]:[{start,end}]};
        window.context=buildSelectedOrfTranslationContext(record.sequence,feature);
        host.innerHTML=renderDualStrandSequenceLinesHtml(record.sequence,[],{
          ...metrics,sequenceLineHeightPx:metrics.lineHeightPx,orfTranslationContext:context});
      };
      window.measure=()=>{
        const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}};
        return {anchors:context.anchors,fragments:[...host.querySelectorAll('.sequence-viewer-aa-chip')].map(chip=>{
          const line=chip.closest('.sequence-viewer-dual-line');
          const start=Number(line.dataset.lineStart),end=Number(line.dataset.lineEnd);
          const positions=chip.dataset.aaCodonPositions.split(',').map(Number);
          const local=positions.filter(p=>p>=start&&p<end).sort((a,b)=>a-b);
          const top=[...line.querySelectorAll('.sequence-viewer-strand-row-top .sequence-viewer-seq-base')];
          const bottom=[...line.querySelectorAll('.sequence-viewer-strand-row-bottom .sequence-viewer-seq-base')];
          const style=getComputedStyle(chip),labelRange=document.createRange();labelRange.selectNodeContents(chip);
          return {positions,start,end,local,box:rect(chip),first:rect(top[local[0]-start]),last:rect(top[local.at(-1)-start]),
            bottomFirst:rect(bottom[local[0]-start]),bottomLast:rect(bottom[local.at(-1)-start]),label:rect(labelRange),
            text:chip.textContent,title:chip.title,split:chip.classList.contains('sequence-viewer-aa-chip-split'),
            continuesLeft:chip.classList.contains('sequence-viewer-aa-chip-continues-left'),
            continuesRight:chip.classList.contains('sequence-viewer-aa-chip-continues-right'),
            leftBorder:style.borderLeftStyle,rightBorder:style.borderRightStyle,
            edit:editor.resolveContext(record,{target:chip})};
        })};
      };
      window.qaReady=true;
    </script></body></html>`);
  const win = new BrowserWindow({ width: 1200, height: 700, show: false,
    webPreferences: { sandbox: true, contextIsolation: true } });
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level >= 3) errors.push(event.message); });
  const exec = code => win.webContents.executeJavaScript(code, true);
  await win.loadFile(fixture);
  assert.equal(await exec('Boolean(window.qaReady)'), true, errors.join('\n'));
  let cases = 0;
  for (const zoom of [0.8, 1, 1.25]) {
    win.webContents.setZoomFactor(zoom);
    for (const width of [400, 900]) {
      for (const strand of [1, -1]) {
        for (const split of [0, 1, 2]) {
          for (const single of [false, true]) {
            await exec(`new Promise(resolve=>{
              render(${width},${strand},${split},false,${single});
              requestAnimationFrame(()=>requestAnimationFrame(resolve));
            })`);
            const { anchors, fragments } = await exec('measure()');
            const label = `width=${width}, zoom=${zoom}, strand=${strand}, split=${split}, single=${single}`;
            assert.equal(anchors.length, single ? 1 : 7, label);
            verifyFragments(anchors, fragments, label);
            assert.equal(fragments.filter(f => f.split).length, split ? 2 : 0, label);
            cases++;
            if (zoom === 1 && width === 400 && strand === 1 && split === 1 && !single) {
              fs.writeFileSync(path.join(output, 'split-codon.png'), (await win.webContents.capturePage({
                x: 60, y: 15, width: 360, height: 175
              })).toPNG());
            }
          }
        }
        for (const split of [1, 2]) {
          await exec(`new Promise(resolve=>{
            render(${width},${strand},${split},true);
            requestAnimationFrame(()=>requestAnimationFrame(resolve));
          })`);
          const { anchors, fragments } = await exec('measure()');
          verifyFragments(anchors, fragments, `origin, width=${width}, zoom=${zoom}, strand=${strand}, split=${split}`);
          cases++;
        }
      }
    }
  }
  assert.deepEqual(errors, []);
  console.log(`ORF wrap Electron QA passed: ${cases} cases across widths, zoom, both strands, 1+2/2+1 splits, and circular origins. Screenshot: ${output}`);
  win.destroy();
  await fs.promises.rm(temp, { recursive: true, force: true });
  app.quit();
}

function verifyFragments(anchors, fragments, label) {
  const close = (actual, expected, edge) => assert.ok(Math.abs(actual - expected) < 0.05,
    `${label}: ${edge} (${actual} vs ${expected})`);
  for (const anchor of anchors) {
    const parts = fragments.filter(f => f.positions.join(',') === anchor.codonPositions.join(','));
    assert.ok(parts.length, `${label}: amino acid ${anchor.aa} must be visible`);
    assert.deepEqual(parts.flatMap(part => part.local).sort((a,b) => a-b),
      [...anchor.codonPositions].sort((a,b) => a-b), `${label}: every codon base must have one fragment`);
    for (const part of parts) {
      assert.equal(part.text, anchor.displayText, `${label}: readable label on each fragment`);
      close(part.box.left, part.first.left, 'left');
      close(part.box.right, part.last.right, 'right');
      close(part.box.left, part.bottomFirst.left, 'complement left');
      close(part.box.right, part.bottomLast.right, 'complement right');
      assert.ok(part.label.left >= part.box.left && part.label.right <= part.box.right,
        `${label}: label must fit inside even a one-base fragment`);
      assert.deepEqual(part.edit.codonPositions, anchor.codonPositions, `${label}: full codon remains editable`);
      assert.equal(part.edit.codon, anchor.codon);
      assert.equal(part.edit.aminoAcid, anchor.aa);
      if (part.split) assert.match(part.title, /Split codon, bases/);
      if (part.continuesLeft) assert.equal(part.leftBorder, 'dashed');
      if (part.continuesRight) assert.equal(part.rightBorder, 'dashed');
    }
  }
}

main().catch(error => {
  console.error(error);
  if (process.versions.electron) require('electron').app.exit(1);
  else process.exitCode = 1;
});
