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
  try {
    await win.loadFile(fixture);
    for (let i = 0; i < 150 && !await js('Boolean(window.qa)'); i++) await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(await js('Boolean(window.qa)'), true, errors.join('\n'));
    await js("document.getElementById('assay-mode-create-btn').click();document.querySelector('[data-assay-edit=qa-workspace-assay]').click()");
    await settle();
    assert.equal(await js("document.querySelector('.assay-plate-toolbar .assay-mode-switch')"), null, 'the field switch is removed');
    assert.equal(await js("document.querySelectorAll('td.assay-well input[data-well-inline-field]').length"), 192, 'both fields are present in every well');

    await click(field('A1', 'sampleId'));
    await type('Direct <&>');
    await click(field('A1', 'concentration'));
    assert.deepEqual(await focus(), { well: 'A1', field: 'concentration' }, 'one click moves from an edited sample to its concentration');
    await type('25 nM');
    await click(field('A2', 'sampleId'));
    assert.deepEqual(await focus(), { well: 'A2', field: 'sampleId' }, 'one click moves from an edited concentration to another sample');
    assert.equal(await value(field('A1', 'sampleId')), 'Direct <&>');
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

    await click('#assay-save-btn');
    assert.deepEqual(await js("({mapping:qa.state.assays[0].wellLayout.find(item=>item.well==='A1'),unit:qa.state.assays[0].concentrationUnit})"),
      { mapping: { well: 'A1', sampleId: 'Direct <&>', concentration: '50 nM' }, unit: 'nM' }, 'saving keeps both fields and recognizes the concentration unit');
    await js("document.querySelector('[data-assay-edit=qa-workspace-assay]').click()");
    assert.equal(await value(field('A2', 'sampleId')), 'Next sample', 'reopening restores the direct edit');
    await click(field('A1', 'concentration'));
    await type('');
    await click(field('A1', 'sampleId'));
    assert.equal(await value(field('A1', 'concentration')), '', 'clearing concentration keeps the sample');
    assert.equal(await value(field('A1', 'sampleId')), 'Direct <&>');

    await click('#assay-sample-axis-column-btn');
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
    await js("qaI18n.setLocale('en')");
    assert.deepEqual(errors, []);
    console.log('Plate direct editing passed: native single clicks, Tab/Shift+Tab, both Enter directions, independent values, units, save/reopen, clearing and live localization.');
  } finally {
    win.destroy();
    await app.quit();
  }
}

main().catch(error => { console.error(error); if (process.versions.electron) require('electron').app.exit(1); else process.exitCode = 1; });
