const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-plugin-i18n-'));
app.setPath('userData', path.join(scratch, 'profile'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
let win;
const timeout = setTimeout(() => { console.error('Plugin i18n fixture timed out'); app.exit(1); }, 60000);
async function main() {
  await app.whenReady();
  let checks = 0;
  for (const [folder, ns, htmlPath, dynamic, translated] of [
    ['plugins/scientific-illustration', 'figura', 'index.html', 'Custom · {p0} × {p1}', 'Personalizado · {p0} × {p1}'],
    ['plugins/qpcr-analysis', 'qpcr', 'index.html', 'Saving inputs…', 'Guardando entradas…'],
    ['src/plugins/gel', 'gel', 'vendor/gel-view.html', 'Load a gel image before cropping.', 'Carga una imagen de gel antes de recortar.']
  ]) {
    const folderPath = path.join(root, folder);
    const source = fs.readFileSync(path.join(folderPath, htmlPath), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
    const fragmentStyles = ns === 'gel' ? [...fs.readFileSync(path.join(folderPath, 'index.html'), 'utf8').matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(match => match[0]).join('\n') : '';
    const fragment = ns === 'gel' ? `<div id="gel-host">${source.replace('id="gel-view" class="view"', 'id="gel-view" class="view is-active"')}</div>` : source;
    const markup = /<head>/.test(source) ? source.replace('<head>', `<head><base href="${pathToFileURL(folderPath + '/').href}">`) : `<!doctype html><html><head><base href="${pathToFileURL(folderPath + '/').href}">${fragmentStyles}</head><body class="${ns === 'gel' ? 'plugin-gel theme-day ui-neutral-compact' : ''}">${fragment}</body></html>`;
    const fixture = path.join(scratch, ns + '.html'); fs.writeFileSync(fixture, markup);
    win = new BrowserWindow({ show: false, width: 1300, height: 900, webPreferences: { sandbox: true, contextIsolation: true } });
    await win.loadFile(fixture);
    const result = await win.webContents.executeJavaScript(`(async () => {
      const { i18n, createPresentation } = await import(${JSON.stringify(pathToFileURL(path.join(folderPath, 'i18n.mjs')).href)});
      const ns = ${JSON.stringify(ns)}, dynamic = ${JSON.stringify(dynamic)};
      const ui = createPresentation(ns);
      let checks = 0;
      const check = (ok, message) => { if (!ok) throw new Error(ns + ': ' + message); checks++; };
      const beforeButtons = document.querySelectorAll('button').length;
      const beforeValues = [...document.querySelectorAll('select')].map(select => [...select.options].map(o => o.value));
      const editable = document.querySelector('textarea, input[type=text], input:not([type])');
      if (editable) { editable.value = 'Draft <&> — keep this'; editable.focus(); try { editable.setSelectionRange(2, 8); } catch {} }
      const text = document.createElement('p'); document.body.append(text);
      ui.setText(text, ui.message(dynamic, { p0: 300, p1: 200 }));
      const namespaceCatalog = Object.fromEntries([...document.querySelectorAll('[data-i18n]')].map(node => [node.dataset.i18n.slice(ns.length + 1), '⟦' + node.textContent + '⟧']));
      namespaceCatalog[i18n.keyFor(dynamic)] = ${JSON.stringify(translated)};
      i18n.registerMessages('es', ns, namespaceCatalog);
      check(i18n.setLocale('es-MX') === 'es', 'regional Spanish resolves locally');
      check(text.textContent === ${JSON.stringify(translated.replace('{p0}', '300').replace('{p1}', '200'))}, 'dynamic source-owned status translates');
      for (const node of document.querySelectorAll('[data-i18n]')) {
        if (node.children.length || node.matches('input, textarea, select')) continue;
        const params = JSON.parse(node.getAttribute('data-i18n-params') || '{}');
        check(node.textContent === i18n.t(node.dataset.i18n, params), 'static binding ' + node.dataset.i18n);
      }
      check(document.querySelectorAll('button').length === beforeButtons, 'translation keeps all controls');
      check(JSON.stringify([...document.querySelectorAll('select')].map(select => [...select.options].map(o => o.value))) === JSON.stringify(beforeValues), 'translation preserves option values');
      if (editable) check(editable.value === 'Draft <&> — keep this' && document.activeElement === editable, 'draft and focus survive');
      i18n.registerMessages('es', ns, { [i18n.keyFor('UI test')]: '<img src=x onerror=alert(1)>' });
      const safe = document.createElement('div'); safe.innerHTML = ui.html('UI test'); document.body.append(safe);
      check(!safe.querySelector('img') && safe.textContent.startsWith('<img'), 'translation is escaped text');
      if (ns !== 'qpcr') {
        for (const [preference, locale] of [['zh-CN','zh-Hans'],['zh-TW','zh-Hant'],['ja-JP','ja']]) {
          check(i18n.setLocale(preference) === locale, 'production locale resolves: ' + preference);
          check(document.documentElement.lang === locale, 'plugin document language follows the host');
          const catalog = window.HikariUiTranslations[locale][ns];
          const expected = catalog[i18n.keyFor(dynamic)].split('{p0}').join('300').split('{p1}').join('200');
          check(text.textContent === expected, 'production dynamic message translates: ' + locale);
          for (const node of document.querySelectorAll('[data-i18n]')) {
            if (node.children.length || node.matches('input, textarea, select')) continue;
            const params = JSON.parse(node.getAttribute('data-i18n-params') || '{}');
            check(node.textContent === i18n.t(node.dataset.i18n, params, node.textContent), 'production binding ' + locale + ' ' + node.dataset.i18n);
          }
          for (const attribute of ['title','placeholder','aria-label','alt','data-caption','data-hover-caption','label']) {
            const binding = 'data-i18n-' + attribute.replace(/^data-/, '');
            for (const node of document.querySelectorAll('[' + binding + ']')) {
              const params = JSON.parse(node.getAttribute(binding + '-params') || node.getAttribute('data-i18n-params') || '{}');
              check(node.getAttribute(attribute) === i18n.t(node.getAttribute(binding), params), 'production attribute ' + locale + ' ' + node.getAttribute(binding));
            }
          }
          check(document.querySelectorAll('button').length === beforeButtons, 'language preserves every control');
          check(JSON.stringify([...document.querySelectorAll('select')].map(select => [...select.options].map(o => o.value))) === JSON.stringify(beforeValues), 'language preserves scientific option values');
          if (editable) check(editable.value === 'Draft <&> — keep this' && document.activeElement === editable, 'language preserves draft and focus');
        }
      }
      if (ns === 'gel') {
        i18n.setLocale('en');
        const { initGelAnalysis } = await import(${JSON.stringify(pathToFileURL(path.join(folderPath, 'workspace/index.js')).href)});
        i18n.setLocale('ja');
        const controller = initGelAnalysis({ state: { gelAnalyses: [], settings: { storagePath: '' } },
          persist() {}, createId: () => crypto.randomUUID(), document,
          safeText(value) { const span = document.createElement('span'); span.textContent = String(value ?? ''); return span.innerHTML; }
        });
        await controller.ready; controller.render();
        check(document.getElementById('gel-figure-heading').textContent === 'ゲル', 'late-inserted Gel navigation uses the saved language on first load');
        check(document.getElementById('gel-figure-add-btn').getAttribute('aria-label') === 'ゲルを追加', 'late-inserted Gel accessibility copy uses the saved language');
        check(document.getElementById('gel-figure-stack-btn').title === 'スタックを追加', 'late-inserted Gel tooltips use the saved language');
        controller.destroy();
      }
      i18n.setLocale('en'); check(text.textContent === dynamic.replace('{p0}', '300').replace('{p1}', '200'), 'English status is restored');
      return { checks, bindings: document.querySelectorAll('[data-i18n]').length };
    })().catch(error => { throw new Error(error.stack); })`);
    assert.ok(result.bindings >= 30, `${ns} has substantial static coverage`); checks += result.checks;
    const output = path.join(root, 'artifacts/i18n-plugins'); fs.mkdirSync(output, { recursive: true });
    for (const locale of ns === 'qpcr' ? ['en'] : ['en','zh-Hans','zh-Hant','ja']) {
      await win.webContents.executeJavaScript(`window.HikariUi.setLocale(${JSON.stringify(locale)})`);
      for (const width of [1300, 800]) { win.setSize(width, 900); await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'); fs.writeFileSync(path.join(output, `${ns}-${locale}-${width}.png`), (await win.webContents.capturePage()).toPNG()); }
    }
    win.destroy(); win = null;
  }
  console.log(`Plugin i18n: ${checks} English/Spanish/Chinese/Japanese binding, draft, option, control, and escaping checks passed across Figura, qPCR, and Gel.`);
}
main().then(() => { clearTimeout(timeout); app.quit(); }).catch(error => { console.error(error); clearTimeout(timeout); win?.destroy(); app.exit(1); });
