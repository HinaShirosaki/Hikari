'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

async function main() {
  if (!process.versions.electron) {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
      encoding: 'utf8', timeout: 60000
    });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    assert.equal(result.status, 0, String(result.error || result.signal));
    return;
  }
  const { app, BrowserWindow } = require('electron');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-codex-usage-ui-'));
  app.setPath('userData', path.join(scratch, 'profile'));
  app.disableHardwareAcceleration();
  let win;
  try {
    await app.whenReady();
    const url = file => pathToFileURL(path.join(root, file)).href;
    const fixture = path.join(scratch, 'fixture.html');
    fs.writeFileSync(fixture, `<!doctype html><html><head><link rel="stylesheet" href="${url('styles.css')}">
      <style>body{display:block;padding:16px}#setting-view{display:block;width:100%;height:auto}.settings-panel[hidden]{display:none}</style>
      </head><body class="theme-day">${fs.readFileSync(path.join(root, 'ui/html/views/setting-view.html'), 'utf8')}</body></html>`);
    win = new BrowserWindow({ width: 1024, height: 900, show: false, webPreferences: { sandbox: true, contextIsolation: true } });
    await win.loadFile(fixture);
    await win.webContents.executeJavaScript(`(async () => {
      const { createCodexAccountSettings } = await import(${JSON.stringify(url('src/renderer/modules/settings/codex-account.js'))});
      const { getSettingsElements } = await import(${JSON.stringify(url('src/renderer/modules/settings/dom.js'))});
      const dom = getSettingsElements(document);
      for (const panel of dom.settingsPanels) panel.hidden = panel.dataset.settingsPanel !== 'llm';
      window.fixtureUsage = { ok: true, fiveHour: { usedPercent: 25.5, resetsAt: 1900000000 }, weekly: { usedPercent: 67, resetsAt: 1900400000 } };
      window.usageReads = 0;
      window.hikariApi = {
        getCodexLlmStatus: async () => ({ ok: true, loggedIn: true, source: 'stored', cliAvailable: true,
          email: 'account@example.test', planType: 'free', accountKey: 'free-account' }),
        getCodexLlmUsage: async () => { window.usageReads += 1; return window.fixtureUsage; },
        clearCodexLlmLogin: async () => ({ ok: true, status: { ok: true, loggedIn: false, source: 'none' } })
      };
      window.fixtureAccount = createCodexAccountSettings({ ...dom, state: { settings: {} }, persist() {},
        llmModelCatalog: { hasCodexModels: () => true } });
      dom.refreshCodexUsageBtn.addEventListener('click', () => { void window.fixtureAccount.refreshCodexUsage(); });
      await window.fixtureAccount.refreshCodexLoginStatus();
      await window.fixtureAccount.refreshCodexUsage();
      if (!document.getElementById('setting-codex-status').textContent.includes('account@example.test · free')) throw new Error('Settings must identify the connected account and plan');
    })()`);
    for (const theme of ['theme-day', 'theme-night']) {
      for (const width of [1024, 720, 480, 320]) {
        win.setSize(width, 900);
        const layout = await win.webContents.executeJavaScript(`(async () => {
          document.body.className = ${JSON.stringify(theme)};
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const section = document.getElementById('setting-codex-usage');
          const rows = [...section.querySelectorAll('.settings-codex-usage-window')];
          return {
            visible: section.getClientRects().length > 0,
            columns: getComputedStyle(section.querySelector('.settings-codex-usage-windows')).gridTemplateColumns.split(' ').length,
            overflow: rows.some(row => row.scrollWidth > row.clientWidth),
            percentages: rows.map(row => row.querySelector('[data-codex-usage-value]').textContent),
            progress: rows.map(row => ({ width: row.querySelector('progress').getBoundingClientRect().width,
              height: row.querySelector('progress').getBoundingClientRect().height, value: row.querySelector('progress').value }))
          };
        })()`);
        assert.equal(layout.visible, true);
        assert.equal(layout.columns, width <= 600 ? 1 : 2);
        assert.equal(layout.overflow, false, `${theme} ${width}px usage rows fit`);
        assert.deepEqual(layout.percentages, ['25.5% used', '67% used']);
        assert.ok(layout.progress.every(progress => progress.width > 0 && progress.height === 6));
      }
    }
    const interactions = await win.webContents.executeJavaScript(`(async () => {
      const section = document.getElementById('setting-codex-usage');
      const refresh = document.getElementById('refresh-codex-usage-btn');
      const model = document.getElementById('setting-model');
      model.innerHTML = '<option value="draft">Unsaved model</option>';
      const before = window.usageReads;
      window.fixtureUsage = { ok: true, planType: 'free', windows: [{ usedPercent: 0, resetsAt: null, windowDurationMins: 43200 }] };
      refresh.click();
      await window.fixtureAccount.refreshCodexUsage();
      const refreshed = window.usageReads > before && section.querySelector('[data-codex-usage-value]').textContent === '0% used';
      const draftPreserved = model.value === 'draft';
      const monthly = section.querySelector('[data-codex-usage-label]').textContent === '30-day usage'
        && section.querySelector('[data-codex-usage-window="weekly"]').hidden
        && document.getElementById('setting-codex-usage-status').textContent.includes('free plan');
      window.fixtureUsage = { ok: true, planType: 'plus', windows: [
        { usedPercent: 10, resetsAt: 1900000000, windowDurationMins: 300 },
        { usedPercent: 20, resetsAt: 1900400000, windowDurationMins: 10080 }
      ] };
      await window.fixtureAccount.refreshCodexUsage();
      const plus = section.querySelector('[data-codex-usage-label]').textContent === '5-hour usage'
        && !section.querySelector('[data-codex-usage-window="weekly"]').hidden;
      window.fixtureUsage = { ok: false, error: 'Usage unavailable' };
      await window.fixtureAccount.refreshCodexUsage();
      const errorCleared = [...section.querySelectorAll('progress')].every(progress => getComputedStyle(progress).display === 'none');
      await window.fixtureAccount.onClearCodexLogin();
      return { refreshed, draftPreserved, monthly, plus, errorCleared, signedOut: refresh.disabled,
        signedOutMessage: document.getElementById('setting-codex-usage-status').textContent };
    })()`);
    assert.deepEqual(interactions, { refreshed: true, draftPreserved: true, monthly: true, plus: true, errorCleared: true,
      signedOut: true, signedOutMessage: 'Sign in to view account usage.' });
    console.log('PASS Codex usage Electron: day/night at 1024/720/480/320px, refresh, zero usage, missing window, errors, drafts, sign-out.');
  } finally {
    win?.destroy();
    fs.rmSync(scratch, { recursive: true, force: true });
    app.quit();
  }
}

main().catch(error => { console.error(error); process.exit(1); });
