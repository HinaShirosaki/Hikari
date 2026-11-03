// Real vendored Plotly notices, forwarded through the shared Hikari toast.
// Run: node tests/plotly-notifications-electron.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(require('electron'), [__filename], { encoding: 'utf8', timeout: 60000 });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.error) throw result.error;
  if (result.signal) console.error(`Electron stopped with ${result.signal}`);
  process.exit(result.status ?? 1);
} else {
  const { app, BrowserWindow } = require('electron');
  const root = path.resolve(__dirname, '..');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-plotly-notices-'));
  const url = file => pathToFileURL(path.join(root, file)).href;
  app.setPath('userData', path.join(scratch, 'profile'));
  app.setPath('sessionData', path.join(scratch, 'session'));
  app.disableHardwareAcceleration();
  let win;
  const timeout = setTimeout(() => { console.error('Plotly notification QA timed out'); app.exit(1); }, 45000);

  async function run() {
    await app.whenReady();
    const fixture = path.join(scratch, 'index.html');
    fs.writeFileSync(fixture, `<!doctype html><meta charset="utf-8">
      <script src="${url('vendor/plotly/plotly.min.js')}"></script>
      <div id="chart" style="width:800px;height:500px"></div>`);
    win = new BrowserWindow({ show: false, width: 1100, height: 700,
      webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const errors = [];
    const js = async code => {
      try { return await win.webContents.executeJavaScript(code); }
      catch (error) { console.error('Renderer command failed:', code, errors); throw error; }
    };
    win.webContents.on('console-message', event => {
      if (event.level === 'error' && !String(event.message).includes('Content Security Policy')) errors.push(event.message);
    });
    win.webContents.session.on('will-download', (_event, item) => item.setSavePath(path.join(scratch, item.getFilename())));
    await win.loadFile(fixture);
    await js(`(async () => {
      const { installPlotlyNotifications } = await import(${JSON.stringify(url('src/renderer/app/plotly-notifications.js'))});
      const { showTransientNotice } = await import(${JSON.stringify(url('src/renderer/lib/notify.js'))});
      window.notices = []; window.reported = [];
      window.hikariApi = { reportError: error => reported.push(error) };
      window.installNotices = () => installPlotlyNotifications({ notify: (message, options) => {
        notices.push({ message, ...options }); showTransientNotice(message, options);
      }});
      window.disconnectNotices = installNotices();
      if (installNotices() !== disconnectNotices) throw new Error('Installer must be idempotent');
      window.chart = document.getElementById('chart');
      await Plotly.newPlot(chart, [
        { x: [1,2,3], y: [2,4,3], name: 'Control' },
        { x: [1,2,3], y: [4,3,5], name: 'Treatment' }
      ], { title: { text: 'Notification routing QA' } }, { displayModeBar: true });
    })()`);
    async function waitFor(expression) {
      for (let attempt = 0; attempt < 220; attempt++) {
        if (await js(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      throw new Error(`Timed out: ${expression}`);
    }
    const toast = () => js(`(() => {
      const node = document.querySelector('[data-hikari-transient-toast]');
      return { text: node?.textContent, hidden: node?.hidden, background: node?.style.background,
        live: node?.getAttribute('aria-live'), nativeHidden: Array.from(document.querySelectorAll('.plotly-notifier')).every(n => getComputedStyle(n).display === 'none') };
    })()`);

    // A real legend click emits Plotly's one-time interaction hint.
    await js(`(() => {
      const toggle = document.querySelector('.legendtoggle');
      for (const type of ['mousedown','mouseup']) toggle.dispatchEvent(new MouseEvent(type, { bubbles: true }));
    })()`);
    await waitFor(`notices.some(n => n.message === 'Double-click on legend to isolate one trace')`);
    let current = await toast();
    assert.equal(current.text, 'Double-click on legend to isolate one trace');
    assert.equal(current.hidden, false);
    assert.equal(current.live, 'polite');
    assert.equal(current.nativeHidden, true);
    assert.equal(await js('notices.length'), 1, 'Repeated installation must not forward twice');

    // The actual camera button reports both progress and successful download.
    await js(`document.querySelector('[data-title="Download plot as a PNG"]').click()`);
    await waitFor(`notices.some(n => n.message.startsWith('Snapshot succeeded'))`);
    assert.ok(await js(`notices.some(n => n.message.startsWith('Taking snapshot'))`));
    current = await toast();
    assert.match(current.text, /^Snapshot succeeded/);
    assert.equal(current.nativeHidden, true);

    // An invalid image format makes the same native export path reject.
    await js(`chart._context.toImageButtonOptions.format = 'invalid'; document.querySelector('[data-title="Download plot as a PNG"]').click()`);
    await waitFor(`notices.some(n => n.type === 'error')`);
    current = await toast();
    assert.equal(current.text, 'Sorry, there was a problem downloading your snapshot!');
    assert.equal(current.background, 'rgba(167, 75, 58, 0.96)');
    assert.ok(await js(`reported.some(n => n.message === 'Sorry, there was a problem downloading your snapshot!')`));
    await waitFor(`document.querySelectorAll('.plotly-notifier .notifier-note').length === 0`);
    await waitFor(`document.querySelector('[data-hikari-transient-toast]').hidden`);

    // Async content and a replacement notifier container exercise DOM timing.
    await js(`(() => {
      document.querySelector('.plotly-notifier').remove();
      const container = document.createElement('div'); container.className = 'plotly-notifier';
      const note = document.createElement('div'); note.className = 'notifier-note';
      container.append(note); document.body.append(container);
      window.lateNote = note;
    })()`);
    await js(`lateNote.innerHTML = '<button>×</button><p><span>Line one &lt;safe&gt;</span><br><span>Line two</span></p>'`);
    await waitFor(`notices.some(n => n.message === ${JSON.stringify('Line one <safe>\nLine two')})`);
    current = await toast();
    assert.equal(current.text, 'Line one <safe>\nLine two');
    assert.equal(current.nativeHidden, true);
    const before = await js('notices.length');
    await js(`lateNote.append(document.createElement('span')); document.body.append(document.createElement('p'))`);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(await js('notices.length'), before, 'Redraws must not repeat an existing notice');
    await js(`document.querySelector('[data-hikari-transient-toast]').hidden = true`);
    await js(`lateNote.parentElement.append(lateNote.cloneNode(true))`);
    await waitFor(`notices.length === ${before + 1}`);
    assert.equal((await toast()).hidden, false, 'A later identical notice can be displayed again');

    assert.deepEqual(errors, []);
    await js('disconnectNotices()');
    console.log('Plotly notifications: passed (legend hint, export progress/success/failure, shared toast/error log, native cleanup and toast expiry, idempotence, late content, container replacement, safe multiline text, repeat actions).');
  }

  run().then(() => {
    clearTimeout(timeout); win?.destroy(); fs.rmSync(scratch, { recursive: true, force: true }); app.exit(0);
  }, error => {
    console.error(error); clearTimeout(timeout); win?.destroy(); fs.rmSync(scratch, { recursive: true, force: true }); app.exit(1);
  });
}
