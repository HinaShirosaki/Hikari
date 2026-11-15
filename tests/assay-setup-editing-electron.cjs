'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  if (!process.versions.electron) {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename], { encoding: 'utf8', timeout: 60000 });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    assert.equal(result.status, 0, String(result.error || result.signal));
    return;
  }
  const { app, BrowserWindow } = require('electron');
  const root = path.resolve(__dirname, '..');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'assay-setup-editing-'));
  app.setPath('userData', path.join(scratch, 'profile'));
  app.disableHardwareAcceleration();
  await app.whenReady();
  const url = file => pathToFileURL(path.join(root, file)).href;
  const fixture = path.join(scratch, 'index.html');
  fs.writeFileSync(fixture, require('./support/assay-workspace-qa.cjs')({ root, url }));
  const win = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = () => js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const field = (well, name) => `[data-well="${well}"][data-well-inline-field="${name}"]`;
  const focus = () => js('({well:document.activeElement.dataset.well,field:document.activeElement.dataset.wellInlineField})');
  const value = selector => js(`document.querySelector(${JSON.stringify(selector)}).value`);
  const rowAxis = '#assay-row-axis';
  const columnAxis = '#assay-column-axis';
  const axisAssignments = () => Promise.all([value(rowAxis), value(columnAxis)]);
  const selectAxis = (selector, fieldName) => js(`(() => {
    const select = document.querySelector(${JSON.stringify(selector)});
    select.value = ${JSON.stringify(fieldName)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const click = async selector => {
    const point = await js(`(() => {const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'nearest',inline:'nearest'});const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    win.webContents.focus();
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    await settle();
  };
  const type = async text => {
    await js('document.activeElement.select()');
    await win.webContents.insertText(text);
  };
  const key = async (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await settle();
  };
  const exportChoice = format => `[data-assay-layout-export="${format}"]`;
  const chooseExport = async (format) => {
    await click('#assay-export-layout-btn');
    assert.equal(await js("document.querySelector('#assay-layout-export-menu').matches(':popover-open')"), true);
    await click(exportChoice(format));
  };
  const downloadLayout = async (format) => {
    const download = new Promise((resolve, reject) => {
      win.webContents.session.once('will-download', (_event, item) => {
        const file = path.join(scratch, item.getFilename());
        item.setSavePath(file);
        item.once('done', (_event, state) => {
          if (state === 'completed') resolve(file);
          else reject(new Error(`Layout ${format} download ended with ${state}`));
        });
      });
    });
    const [file] = await Promise.all([download, chooseExport(format)]);
    return file;
  };
  const importLayout = async (csv) => {
    await js(`(() => {
      const input = document.getElementById('assay-import-file');
      const transfer = new DataTransfer();
      transfer.items.add(new File([${JSON.stringify(csv)}], 'layout.csv', { type: 'text/csv' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    for (let i = 0; i < 50; i++) {
      if (await js("document.getElementById('assay-import-file').files.length === 0")) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail('Layout CSV import did not finish');
  };
  try {
    await win.loadFile(fixture);
    for (let i = 0; i < 150 && !await js('Boolean(window.qa)'); i++) await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(await js('Boolean(window.qa)'), true, errors.join('\n'));
    await js("document.getElementById('assay-mode-create-btn').click();document.querySelector('[data-assay-edit=qa-workspace-assay]').click()");
    await settle();
    assert.equal(await js("document.querySelector('.assay-plate-toolbar .assay-mode-switch')"), null, 'the field switch is removed');
    assert.equal(await js("document.querySelectorAll('td.assay-well input[data-well-inline-field]').length"), 192, 'both fields are present in every well');
    assert.deepEqual(await axisAssignments(), ['sample', 'concentration'], 'the legacy assay restores its axis assignment');
    assert.deepEqual(await js(`[...document.querySelectorAll('.assay-axis-config-grid select')].map(select => ({
      label: select.labels[0].firstElementChild.textContent,
      options: [...select.options].map(option => option.textContent),
      visible: select.getBoundingClientRect().width > 0
    }))`), [
      { label: 'Row', options: ['Sample ID', 'Concentration', 'Temperature', 'Time', 'pH', 'Treatment'], visible: true },
      { label: 'Column', options: ['Sample ID', 'Concentration', 'Temperature', 'Time', 'pH', 'Treatment'], visible: true }
    ]);
    await click('#assay-export-layout-btn');
    assert.deepEqual(await js("Array.from(document.querySelectorAll('#assay-layout-export-menu button'), button => button.textContent)"),
      ['CSV', 'PDF', 'PNG', 'Print']);
    assert.equal(await js('document.activeElement.dataset.assayLayoutExport'), 'csv', 'the menu focuses its first item');
    await key('Escape');
    assert.equal(await js("document.querySelector('#assay-layout-export-menu').matches(':popover-open')"), false);

    await click(field('A1', 'sampleId'));
    const sampleId = 'Direct, "<&>"';
    await type(sampleId);
    await click(field('A1', 'concentration'));
    assert.deepEqual(await focus(), { well: 'A1', field: 'concentration' }, 'one click moves from an edited sample to its concentration');
    await type('25 nM');
    await click(field('A2', 'sampleId'));
    assert.deepEqual(await focus(), { well: 'A2', field: 'sampleId' }, 'one click moves from an edited concentration to another sample');
    assert.equal(await value(field('A1', 'sampleId')), sampleId);
    assert.equal(await value(field('A1', 'concentration')), '25 nM');
    await type('Next sample');
    await key('Tab');
    assert.deepEqual(await focus(), { well: 'A2', field: 'concentration' }, 'Tab retains the next field after committing a sample edit');
    await key('Tab', ['shift']);
    assert.deepEqual(await focus(), { well: 'A2', field: 'sampleId' });
    await key('Enter');
    assert.deepEqual(await focus(), { well: 'A3', field: 'sampleId' }, 'Enter follows the sample axis');
    await click(field('A1', 'concentration'));
    await type('50 nM');
    await key('Enter');
    assert.deepEqual(await focus(), { well: 'B1', field: 'concentration' }, 'Enter follows the concentration axis');

    await type('5');
    const file = await downloadLayout('csv');
    assert.equal(path.basename(file), 'Reporter-dose-response-96well-layout.csv');
    const csv = fs.readFileSync(file, 'utf8');
    const rows = csv.trimEnd().split(/\r?\n/);
    assert.equal(rows.length, 97, 'the CSV includes every well');
    assert.equal(rows[0], 'well,row,column,sample_id,concentration');
    assert.equal(rows[1], 'A1,A,1,"Direct, ""<&>""",50 nM', 'the CSV quotes sample IDs and preserves explicit units');
    assert.equal(rows[13], 'B1,B,1,Compound B,5 nM', 'the CSV includes unsaved edits and the plate unit');
    assert.equal(rows[96], 'H12,H,12,,', 'empty wells keep their coordinates');
    assert.equal(await js("qa.state.assays[0].wellLayout.find(item=>item.well==='B1').concentration"), '1', 'export leaves the saved assay alone');
    const pdf = fs.readFileSync(await downloadLayout('pdf')).toString('latin1');
    assert.ok(pdf.startsWith('%PDF-'));
    assert.equal(pdf.match(/\/Type \/Page\b/g).length, 1, 'a 96-well layout fits on one PDF page');
    const png = fs.readFileSync(await downloadLayout('png'));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.ok(png.readUInt32BE(16) > 2400 && png.readUInt32BE(20) > 1400, 'the PNG includes the complete 96-well grid');

    // Use the actual print frame path with a stub for the operating system dialog.
    await js(`(() => {
      const source = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
      Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
        ...source,
        set(value) {
          if (!value.startsWith('blob:')) {
            source.set.call(this, value);
            return;
          }
          window.platePrintPdf = fetch(value).then(response => response.text());
          this.addEventListener('load', () => {
            this.contentWindow.print = () => { window.platePrintCalled = true; };
          }, { capture: true, once: true });
          this.srcdoc = '<!doctype html><title>Plate print fixture</title>';
          Object.defineProperty(HTMLIFrameElement.prototype, 'src', source);
        }
      });
    })()`);
    await chooseExport('print');
    assert.ok(await js("platePrintPdf.then(content => content.startsWith('%PDF-'))"));
    assert.equal(await js('Boolean(window.platePrintCalled)'), true, 'Print opens the print dialog for the layout PDF');

    await click('#assay-save-btn');
    assert.deepEqual(await js("({mapping:qa.state.assays[0].wellLayout.find(item=>item.well==='A1'),unit:qa.state.assays[0].concentrationUnit})"),
      { mapping: { well: 'A1', sampleId, concentration: '50 nM' }, unit: 'nM' }, 'saving keeps both fields and recognizes the concentration unit');
    await js("document.querySelector('[data-assay-edit=qa-workspace-assay]').click()");
    assert.equal(await value(field('A2', 'sampleId')), 'Next sample', 'reopening restores the direct edit');
    await click(field('A1', 'concentration'));
    await type('');
    await click(field('A1', 'sampleId'));
    assert.equal(await value(field('A1', 'concentration')), '', 'clearing concentration keeps the sample');
    assert.equal(await value(field('A1', 'sampleId')), sampleId);

    await selectAxis(rowAxis, 'concentration');
    assert.deepEqual(await axisAssignments(), ['concentration', 'sample'], 'changing Row swaps Column');
    await selectAxis(columnAxis, 'concentration');
    assert.deepEqual(await axisAssignments(), ['sample', 'concentration'], 'changing Column swaps Row');
    await selectAxis(columnAxis, 'sample');
    await click(field('A1', 'sampleId'));
    await type('Column sample');
    await key('Enter');
    assert.deepEqual(await focus(), { well: 'B1', field: 'sampleId' }, 'sample navigation follows a column axis');
    await click(field('A1', 'concentration'));
    await type('10 nM');
    await key('Enter');
    assert.deepEqual(await focus(), { well: 'A2', field: 'concentration' }, 'concentration navigation follows the opposite axis');

    await js(`(async()=>{window.qaI18n=(await import(${JSON.stringify(url('src/renderer/lib/i18n/index.js'))})).i18n;document.activeElement.value='Unsaved 25 nM';document.activeElement.setSelectionRange(2,6);qaI18n.setLocale('es')})()`);
    assert.deepEqual(await focus(), { well: 'A2', field: 'concentration' }, 'locale switching retains the active field');
    assert.equal(await js("document.activeElement.value"), 'Unsaved 25 nM');
    assert.equal(await js("document.activeElement.title.startsWith('A2 • ID de muestra:')"), true, 'well field titles retain localized well context');
    assert.equal(await js("document.activeElement.getAttribute('aria-label')===document.activeElement.title"), true);
    assert.equal(await js("document.querySelector('#assay-row-axis').selectedOptions[0].textContent"), 'Concentración');
    assert.deepEqual(await axisAssignments(), ['concentration', 'sample'], 'translation preserves the selected roles');
    await js("qaI18n.setLocale('en')");

    await click('#assay-save-btn');
    assert.deepEqual(await js("(({sampleAxis, concentrationAxis}) => [sampleAxis, concentrationAxis])(qa.state.assays[0])"),
      ['column', 'row'], 'saving writes the existing axis fields');
    await click('#assay-new-btn');
    assert.deepEqual(await axisAssignments(), ['sample', 'concentration'], 'a new plate restores the defaults');
    await js("document.querySelector('[data-assay-edit=qa-workspace-assay]').click()");
    assert.deepEqual(await axisAssignments(), ['concentration', 'sample'], 'reopening restores the saved assignments');

    await click('#assay-new-btn');
    await importLayout(csv);
    assert.equal(await value(field('A1', 'sampleId')), sampleId, 'the existing CSV importer restores the quoted sample ID');
    assert.equal(await value(field('B1', 'concentration')), '5 nM', 'reimport retains the concentration unit');

    await click('#assay-new-btn');
    await js("document.getElementById('assay-name').value = 'Temperature and time'");
    await selectAxis(rowAxis, 'temperature');
    await selectAxis(columnAxis, 'time');
    const axisInput = (axis, index) => `[data-axis-dimension="${axis}"][data-axis-index="${index}"]`;
    await click(axisInput('row', 0));
    await type('37 °C');
    await click(axisInput('column', 0));
    await type('15 min');
    await click(field('A1', 'sampleId'));
    assert.equal(await value(field('A1', 'temperature')), '37 °C');
    assert.equal(await value(field('A1', 'time')), '15 min');
    assert.equal(await value(field('A1', 'concentration')), '', 'temperature and time never populate concentration');
    assert.equal(await js("document.getElementById('assay-dilution-fill-btn').disabled"), true);
    await type('Reference sample');
    await click(field('A1', 'time'));
    await type('20 min');
    await selectAxis(columnAxis, 'temperature');
    assert.deepEqual(await axisAssignments(), ['time', 'temperature'], 'selecting an assigned field swaps the axes');
    assert.equal(await value(axisInput('column', 0)), '37 °C');
    assert.equal(await value(axisInput('row', 0)), '15 min');
    await click('#assay-save-btn');
    assert.deepEqual(await js(`qa.state.assays.find(assay => assay.name === 'Temperature and time').wellLayout[0]`),
      { well: 'A1', sampleId: 'Reference sample', concentration: '', temperature: '37 °C', time: '20 min' });
    await click('#assay-new-btn');
    await js(`(() => {
      const id = qa.state.assays.find(assay => assay.name === 'Temperature and time').id;
      document.querySelector('[data-assay-edit="' + id + '"]').click();
    })()`);
    assert.deepEqual(await axisAssignments(), ['time', 'temperature'], 'reopen restores both condition assignments');
    assert.equal(await value(field('A1', 'time')), '20 min', 'reopen keeps per-well condition overrides');
    const conditionCsv = fs.readFileSync(await downloadLayout('csv'), 'utf8');
    assert.match(conditionCsv, /^well,row,column,sample_id,concentration,temperature,time,row_axis,column_axis\nA1,A,1,Reference sample,,37 °C,20 min,time,temperature\n/);
    const conditionPdf = await downloadLayout('pdf');
    assert.ok(fs.readFileSync(conditionPdf).toString('latin1').startsWith('%PDF-'));
    await downloadLayout('png');
    await click('#assay-new-btn');
    await importLayout(conditionCsv);
    assert.deepEqual(await axisAssignments(), ['time', 'temperature'], 'condition CSV restores the row and column selections');
    assert.equal(await value(field('A1', 'temperature')), '37 °C');
    assert.equal(await value(field('A1', 'time')), '20 min');
    await selectAxis(rowAxis, 'ph');
    await selectAxis(columnAxis, 'treatment');
    await click(axisInput('row', 1));
    await type('7.4');
    await click(axisInput('column', 1));
    await type('Vehicle');
    await click(field('B2', 'sampleId'));
    assert.equal(await value(field('B2', 'ph')), '7.4');
    assert.equal(await value(field('B2', 'treatment')), 'Vehicle');
    await click('#assay-new-btn');

    await js(`(() => {
      document.getElementById('assay-name').value = 'Large plate';
      const type = document.getElementById('assay-plate-type');
      type.value = '1536';
      type.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await importLayout('well,sample_id,concentration\nAF48,試料,12 µM\n');
    const largePdf = fs.readFileSync(await downloadLayout('pdf')).toString('latin1');
    assert.equal(largePdf.match(/\/Type \/Page\b/g).length, 16, 'the PDF tiles every well of a 1536-well plate');
    const largePng = fs.readFileSync(await downloadLayout('png'));
    assert.ok(largePng.readUInt32BE(16) > 5000 && largePng.readUInt32BE(20) > 2300, 'the PNG includes wells outside the editor preview');

    assert.deepEqual(errors, []);
    console.log('Plate setup passed: condition axes and overrides, save and reopen, localization, CSV round trip, PNG, PDF and Print.');
  } finally {
    win.destroy();
    await app.quit();
  }
}

main().catch(error => { console.error(error); if (process.versions.electron) require('electron').app.exit(1); else process.exitCode = 1; });
