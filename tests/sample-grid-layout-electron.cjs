'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

async function main() {
  if (!process.versions.electron) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-sample-grid-'));
    try {
      const result = require('node:child_process').spawnSync(require('electron'), [__filename, temp], {
        encoding: 'utf8', timeout: 60000
      });
      process.stdout.write(result.stdout || '');
      process.stderr.write(result.stderr || '');
      assert.equal(result.status, 0, String(result.error || `Sample grid QA failed (${result.signal || result.status})`));
    } finally {
      fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
    }
    return;
  }

  const { app, BrowserWindow } = require('electron');
  const temp = process.argv[2];
  const output = path.join(root, 'artifacts/sample-grid-layout');
  fs.mkdirSync(output, { recursive: true });
  app.setPath('userData', path.join(temp, 'profile'));
  app.on('window-all-closed', () => {});
  await app.whenReady();
  const url = file => pathToFileURL(path.join(root, file)).href;
  const fixture = path.join(temp, 'index.html');
  fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8">
    <link rel="stylesheet" href="${url('styles.css')}">
    <style>body{display:block;margin:0;padding:24px}</style>
    </head><body><main id="host"></main><script type="module">
      import {createContainerDetailRenderer} from '${url('src/renderer/modules/personal-inventory/detail-container-rendering.js')}';
      import {createDefaultWells} from '${url('src/renderer/lib/inventory-containers.js')}';
      const host = document.getElementById('host');
      const uiState = {editingWellIndex:8, cloningSampleId:'sample-1'};
      const renderer = createContainerDetailRenderer({
        safeText: value => String(value), uiState,
        helpers: {
          getLinkedSamples: (_section, _id, index) => index === 8 ? [{id:'sample-1',name:'Example',type:'protein'}] : [],
          getSampleTypeColor: () => 'var(--theme-accent)', getSampleTypeLabel: () => 'Protein',
          renderSampleLegendForContainer: () => '', getWellDataForType: (_container, well) => well,
          buildSampleDotFill: types => types.length ? 'var(--theme-accent)' : ''
        },
        renderWellEditor: () => '<div class="well-side-editor">Selected well</div>',
        renderSingleContainerEditor: () => ''
      });
      window.render = (container, width, night) => {
        document.body.classList.toggle('theme-night', night);
        host.style.width = width + 'px';
        container.wells = createDefaultWells(container);
        host.innerHTML = renderer.renderContainerDetail('-20 Degree', {...container,id:'box-1',name:'Grid check'});
      };
      window.measure = () => ({dividerWidth:Number.parseFloat(getComputedStyle(host.querySelector('.well-grid')).borderRightWidth),
        cells:[...host.querySelectorAll('.well')].map(element => {
        const style = getComputedStyle(element), rect = element.getBoundingClientRect();
        return {right:Number.parseFloat(style.borderRightWidth),bottom:Number.parseFloat(style.borderBottomWidth),
          top:Number.parseFloat(style.borderTopWidth),left:Number.parseFloat(style.borderLeftWidth),
          borderColor:style.borderRightColor,background:style.backgroundColor,
          x:rect.x,y:rect.y,width:rect.width,height:rect.height};
      })});
      window.qaReady = true;
    </script></body></html>`);
  const win = new BrowserWindow({ width: 1400, height: 1000, show: false,
    webPreferences: { sandbox: true, contextIsolation: true } });
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level >= 3) errors.push(event.message); });
  const exec = code => win.webContents.executeJavaScript(code, true);
  try {
    await win.loadFile(fixture);
    for (let i = 0; i < 100 && !await exec('Boolean(window.qaReady)'); i++) {
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.equal(await exec('Boolean(window.qaReady)'), true, errors.join('\n'));
    const layouts = [
      {type:'customGrid',gridRows:9,gridCols:10,rows:9,cols:10},
      {type:'customGrid',gridRows:10,gridCols:9,rows:10,cols:9},
      ...[5,7,8,9,10].map(size => ({type:'box'+size*size,rows:size,cols:size})),
      ...[[1,10],[9,1],[1,1],[24,24]].map(([rows,cols]) => ({type:'customGrid',gridRows:rows,gridCols:cols,rows,cols})),
      {type:'plate96',rows:8,cols:12}
    ];
    let cases = 0;
    for (const night of [false, true]) {
      for (const zoom of [1, 0.8, 1.25]) {
        win.webContents.setZoomFactor(zoom);
        for (const width of [700, 1000]) {
          for (const layout of layouts) {
            await exec(`new Promise(resolve => {
              render(${JSON.stringify(layout)}, ${width}, ${night});
              requestAnimationFrame(() => requestAnimationFrame(resolve));
            })`);
            const { cells, dividerWidth } = await exec('measure()');
            const context = `${layout.rows}x${layout.cols} ${layout.type}, night=${night}, zoom=${zoom}, width=${width}`;
            assert.equal(cells.length, layout.rows * layout.cols, context);
            if (layout.type !== 'plate96') assert.ok(dividerWidth > 0, `${context}: grid outline`);
            cells.forEach((cell, index) => {
              const lastColumn = index % layout.cols === layout.cols - 1;
              const lastRow = index >= (layout.rows - 1) * layout.cols;
              if (layout.type === 'plate96') {
                for (const edge of ['left','top','right','bottom']) {
                  assert.ok(cell[edge] > 0, `${context}: well ${index + 1} missing ${edge} outline`);
                }
                return;
              }
              assert.equal(cell.right, lastColumn ? 0 : dividerWidth, `${context}: well ${index + 1} right divider`);
              assert.equal(cell.bottom, lastRow ? 0 : dividerWidth, `${context}: well ${index + 1} bottom divider`);
              assert.equal(cell.left, 0, `${context}: duplicate left divider`);
              assert.equal(cell.top, 0, `${context}: duplicate top divider`);
              if (!lastColumn) {
                assert.notEqual(cell.borderColor, cell.background, `${context}: invisible divider`);
                assert.ok(Math.abs(cell.x + cell.width - cells[index + 1].x) < 0.05, `${context}: adjacent columns`);
              }
              if (!lastRow) {
                assert.ok(Math.abs(cell.y + cell.height - cells[index + layout.cols].y) < 0.05, `${context}: adjacent rows`);
              }
            });
            if (layout.type === 'customGrid' && layout.rows === 9 && layout.cols === 10 && zoom === 1 && width === 1000) {
              fs.writeFileSync(path.join(output, night ? '9x10-night.png' : '9x10-day.png'), (await win.webContents.capturePage()).toPNG());
            }
            cases += 1;
          }
        }
      }
    }
    assert.deepEqual(errors, []);
    console.log(`Sample grid Electron QA passed: ${cases} layout/theme/zoom/width cases, every internal divider and plate outline. Screenshots: ${output}`);
  } finally {
    win.destroy();
  }
  app.quit();
}

main().catch(error => {
  console.error(error);
  if (process.versions.electron) require('electron').app.exit(1);
  else process.exitCode = 1;
});
