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
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-header-left-rail-'));
  app.setPath('userData', path.join(scratch, 'profile'));
  app.disableHardwareAcceleration();
  let win;
  try {
    await app.whenReady();
    const url = file => pathToFileURL(path.join(root, file)).href;
    const fixture = path.join(scratch, 'fixture.html');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
      .replace(/<meta http-equiv="Content-Security-Policy"[\s\S]*?\/>/, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
      .replace('<head>', `<head><base href="${url('')}/">`);
    fs.writeFileSync(fixture, html);
    win = new BrowserWindow({ width: 1440, height: 960, show: false,
      webPreferences: { sandbox: true, contextIsolation: true } });
    await win.loadFile(fixture);
    const run = code => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
    await run(`
      const { initSharedLeftRailResizers } = await import(${JSON.stringify(url('src/renderer/app/shared-left-rail.js'))});
      const { createNavigationShell } = await import(${JSON.stringify(url('src/renderer/app/navigation-shell.js'))});
      const { APP_REGISTRY, APP_DOCK_ORDER } = await import(${JSON.stringify(url('src/renderer/modules/app-registry.generated.js'))});
      const { VIEWS, TITLES } = await import(${JSON.stringify(url('src/renderer/modules/views.js'))});
      const { setAgentAvailability } = await import(${JSON.stringify(url('src/renderer/lib/agent-availability.js'))});
      document.getElementById('app-loading-cover').remove();
      document.body.className = 'ui-neutral-compact theme-day';
      document.documentElement.dataset.windowChrome = 'mac';
      setAgentAvailability(true);
      window.rails = initSharedLeftRailResizers({ document, windowObject: window });
      window.shell = createNavigationShell({ VIEWS, TITLES, APP_REGISTRY, APP_DOCK_ORDER,
        sharedLeftRailRuntime: rails, moduleRuntime: { renderView() {}, renderAgentChatRail() {} },
        executeTopbarSearch() {}, documentObject: document, windowObject: window });
      shell.initNavigation();
      window.toggle = document.getElementById('topbar-left-rail-toggle');
      window.check = (value, message) => { if (!value) throw new Error(message); };
    `);
    const checked = await run(`
      const viewIds = ['agent-view', 'papers-view', 'biology-notebook-view', 'protocol-management-view',
        'workflow-management-view', 'lab-common-inventory-view', 'sample-registry-view', 'assay-view',
        'sequence-viewer-view', 'sequence-viewer-detail-view', 'setting-view', 'tool-box-view'];
      for (const id of viewIds) {
        shell.showView(id);
        check(!toggle.hidden && toggle.closest('.topbar'), id + ': header toggle is available');
        const rail = document.getElementById(toggle.getAttribute('aria-controls'));
        const layout = rail.parentElement;
        const main = layout.querySelector('.left-rail-template__main');
        const before = main.getBoundingClientRect().width;
        toggle.click();
        check(getComputedStyle(rail).display === 'none' && rail.inert, id + ': rail is hidden and inert');
        check(toggle.getAttribute('aria-expanded') === 'false', id + ': toggle reports hidden state');
        check(parseFloat(getComputedStyle(layout).gridTemplateColumns) >= layout.clientWidth - 1,
          id + ': content track fills the workspace without an empty rail column');
        check(main.getBoundingClientRect().width >= before, id + ': content keeps or gains width');
        check(layout.querySelector('[data-shared-left-rail-handle]').hidden, id + ': divider is hidden');
        toggle.click();
        check(getComputedStyle(rail).display !== 'none' && !rail.inert, id + ': rail reopens');
        check(Math.abs(main.getBoundingClientRect().width - before) < 1, id + ': original width is restored');
      }
      check(!document.querySelector('[data-left-rail-fold-toggle], .app-left-rail-fold-toggle'), 'Old fold controls are removed');
      shell.showView('biology-notebook-view');
      document.getElementById('biology-notebook-new-experiment-btn').focus();
      toggle.click();
      check(document.activeElement === toggle, 'Hiding a focused rail moves focus to the header');
      shell.showView('tool-box-view');
      check(toggle.getAttribute('aria-expanded') === 'true', 'Another workspace retains its expanded state');
      shell.showView('biology-notebook-view');
      check(toggle.getAttribute('aria-expanded') === 'false', 'Returning restores the workspace fold state');
      shell.showView('home-view');
      check(toggle.hidden && !toggle.hasAttribute('aria-controls'), 'Home has no rail toggle');
      shell.showView('sequence-viewer-view');
      document.getElementById('sequence-viewer-home-workspace').hidden = true;
      await new Promise(resolve => setTimeout(resolve, 0));
      check(toggle.hidden, 'Hiding a workspace updates header availability');
      document.getElementById('sequence-viewer-home-workspace').hidden = false;
      await new Promise(resolve => setTimeout(resolve, 0));
      check(!toggle.hidden, 'Showing a workspace restores the header toggle');
      const rail = document.getElementById(toggle.getAttribute('aria-controls'));
      const handle = rail.parentElement.querySelector('[data-shared-left-rail-handle]');
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 280, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 320 }));
      document.dispatchEvent(new PointerEvent('pointerup'));
      check(localStorage.getItem('hikari_shared_left_rail_width_v2') === '320', 'Divider resizing still persists width');
      toggle.click(); toggle.click();
      check(Math.abs(rail.getBoundingClientRect().width - 320) < 1, 'Reopening retains the resized width');
      return viewIds;
    `);
    win.setSize(1024, 850);
    await run(`
      shell.showView('papers-view');
      const layout = document.getElementById('papers-layout');
      const rail = document.getElementById('papers-library-rail');
      layout.classList.remove('is-left-rail-expanded');
      layout.classList.add('has-active-context');
      await new Promise(resolve => setTimeout(resolve, 0));
      check(toggle.getAttribute('aria-expanded') === 'false', 'Header reflects automatic Papers hiding');
      toggle.click();
      check(getComputedStyle(rail).display !== 'none' && !rail.inert, 'Header can reopen the compact Papers library');
      toggle.click();
      check(getComputedStyle(rail).display === 'none', 'Header can hide it again');
    `);
    win.setSize(700, 850);
    await run(`
      shell.showView('agent-view');
      check(!toggle.hidden, 'The header toggle remains available on narrow windows');
      toggle.click();
      check(getComputedStyle(document.getElementById('agent-session-rail')).display === 'none', 'Narrow rail hides');
      window.rails.ensureHandles();
      check(toggle.getAttribute('aria-expanded') === 'false', 'Responsive refresh preserves fold state');
      toggle.click();
      check(!document.getElementById('agent-session-rail').inert, 'Narrow rail reopens');
    `);
    win.setSize(1440, 960);
    await run(`shell.showView('biology-notebook-view'); if (toggle.getAttribute('aria-expanded') === 'false') toggle.click();`);
    const out = path.join(root, 'artifacts/shared-left-rail-review');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'header-expanded.png'), (await win.webContents.capturePage()).toPNG());
    await run('toggle.click();');
    fs.writeFileSync(path.join(out, 'header-hidden.png'), (await win.webContents.capturePage()).toPNG());
    console.log(`PASS header left rail: ${checked.length} workspaces, focus, switching, responsive layouts, Papers context, and resizing`);
  } finally {
    win?.destroy();
    fs.rmSync(scratch, { recursive: true, force: true });
    app.quit();
  }
}

main().catch(error => { console.error(error); process.exit(1); });
