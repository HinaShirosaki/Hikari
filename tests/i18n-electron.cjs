// Real renderer and Settings, disposable profile and stubbed workspace IPC.
// Uses the bundled Spanish preview; its missing keys exercise the English fallback.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-i18n-'));
const output = path.join(root, 'artifacts', 'i18n-es');
app.setPath('userData', path.join(scratch, 'profile'));
app.setPath('sessionData', path.join(scratch, 'session'));
app.disableHardwareAcceleration();
let win;
const timeout = setTimeout(() => { console.error('i18n UI check timed out'); app.exit(1); }, 60000);

async function main() {
  await app.whenReady();
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace('<head>', `<head><base href="${pathToFileURL(root + path.sep).href}">`)
    .replace(/<script type="module" src="src\/renderer\/renderer.js"><\/script>/, '');
  const fixture = path.join(scratch, 'index.html');
  fs.writeFileSync(fixture, html);
  // The PDF viewer loads PDF.js and its worker relative to the page URL.
  for (const folder of ['vendor', 'src']) fs.symlinkSync(path.join(root, folder), path.join(scratch, folder), 'junction');
  win = new BrowserWindow({ show: false, width: 1300, height: 900,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadFile(fixture);
  const result = await win.webContents.executeJavaScript(`(async () => {
    const base = ${JSON.stringify(pathToFileURL(root + '/').href)};
    let checks = 0;
    const check = (condition, message) => { if (!condition) throw new Error(message); checks++; };
    const clean = value => value.replace(/\\s+/g, ' ').trim();
    const english = [...document.querySelectorAll('[data-i18n]')].map(element => [element, clean(element.textContent), element.dataset.i18n, JSON.parse(element.getAttribute('data-i18n-params') || '{}')]);
    const attributeBindings = { 'data-i18n-title': 'title', 'data-i18n-aria-label': 'aria-label',
      'data-i18n-placeholder': 'placeholder', 'data-i18n-alt': 'alt', 'data-i18n-hover-caption': 'data-hover-caption',
      'data-i18n-caption': 'data-caption', 'data-i18n-aria-valuetext': 'aria-valuetext', 'data-i18n-label': 'label' };
    const englishAttributes = Object.entries(attributeBindings).flatMap(([binding, attribute]) =>
      [...document.querySelectorAll('[' + binding + ']')].map(element => ({
        key: element.getAttribute(binding), params: JSON.parse(element.getAttribute('data-i18n-params') || '{}'),
        original: element.getAttribute(attribute)
      })));
    const { defaultState, STORAGE_KEY } = await import(base + 'src/renderer/modules/app-state/index.js');
    const initial = structuredClone(defaultState);
    initial.settings.storagePath = '/fixture/i18n-workspace';
    initial.settings.plugins = [];
    delete initial.settings.locale; // Upgrade an existing English workspace.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    window.hikariApi = {
      ensureStorageDirectory: async () => ({ ok: true }),
      importStorageRoot: async () => ({ ok: true, statePatch: {}, summary: {} }),
      autoSaveDataFile: async () => ({ ok: true }),
      agentChatLogListSessions: async () => ({ ok: true, items: [] }),
      agentChatLogGetSession: async () => ({ ok: true, messages: [] }),
      getCodexLlmStatus: async () => ({ ok: true, loggedIn: false, source: 'none', cliAvailable: true }),
      sequenceLibraryList: async () => ({ ok: true, entries: [], folders: [] }),
      listPaperFindingTasks: async () => ({ ok: true, tasks: [] }),
      agentGenerateProtocol: async request => window.qaProtocolAgent(request),
      reportError() {}
    };
    const { startHikariCore } = await import(base + 'src/renderer/core/start-hikari-core.js');
    const { i18n } = await import(base + 'src/renderer/lib/i18n/index.js');
    const { translateTree } = await import(base + 'src/renderer/lib/i18n/dom.js');
    const { settingsSpanish } = await import(base + 'src/renderer/modules/settings/locales/es.js');
    const { installDialogLayout } = await import(base + 'src/renderer/app/dialog-layout.js');
    installDialogLayout();
    const core = startHikariCore();
    check((await core.whenReady()).ok, 'The real renderer must boot');
    check(core.state.settings.locale === 'en' && document.documentElement.lang === 'en', 'Existing workspaces boot in English');
    for (const [element, original, originalKey, originalParams] of english) {
      check(i18n.has(originalKey), 'Catalog missing ' + originalKey);
      check(clean(i18n.t(originalKey, originalParams)) === original, 'English changed for ' + originalKey);
    }
    for (const { key, params, original } of englishAttributes) {
      check(i18n.has(key) && i18n.t(key, params) === original, 'English attribute changed for ' + key);
    }
    core.navigationShell.showView('setting-view');
    const settings = core.moduleRuntime.modules.settings;
    const font = document.getElementById('setting-font-size');
    const appearance = document.getElementById('appearance-form');
    const status = appearance.querySelector('[data-settings-save-status]');
    const options = [...document.getElementById('setting-startup-default-view').options].map(option => option.value);
    font.value = '18';
    font.dispatchEvent(new Event('change', { bubbles: true }));
    const selected = document.getElementById('setting-startup-default-view');
    selected.value = 'papers-view';
    selected.dispatchEvent(new Event('change', { bubbles: true }));
    const notebookDraft = document.getElementById('biology-notebook-result');
    notebookDraft.value = 'My unsaved experiment notes — keep these.';
    document.querySelector('[data-settings-target="preferred-journal"]').click();
    const focusedInput = document.getElementById('setting-preferred-journal');
    focusedInput.value = 'Revista de investigación';
    focusedInput.focus();
    focusedInput.setSelectionRange(3, 11);
    const field = document.activeElement;
    check(field === focusedInput, 'Focus preservation starts with a visible editable input');
    let inputEvents = 0;
    document.addEventListener('input', () => inputEvents++);
    document.addEventListener('change', () => inputEvents++);
    // Text without bindings (every app view now has some) must never change.
    const unbound = document.createElement('p');
    unbound.textContent = 'Unbound English copy';
    document.body.append(unbound);
    const untouched = unbound.textContent;
    const sentinel = document.createElement('div');
    sentinel.innerHTML = '<p data-i18n="missing.message">Keep this English fallback</p>'
      + '<div data-i18n="settings.appearance.title"><button>Keep my handler</button></div>'
      + '<textarea data-i18n="settings.appearance.title">Editable text</textarea>'
      + '<span contenteditable="true" data-i18n="settings.appearance.title">Editable label</span>'
      + '<select><option data-i18n="settings.appearance.title">Stable implicit value</option></select>'
      + '<span data-i18n="fixture.markup"></span>'
      + '<input value="Keep my value" data-i18n-placeholder="settings.appearance.title" data-i18n-title="settings.appearance.title" data-i18n-aria-label="settings.appearance.title">';
    document.body.append(sentinel);
    let clicked = 0;
    const button = sentinel.querySelector('button');
    button.addEventListener('click', () => clicked++);
    i18n.registerMessages('en', 'fixture', { markup: '<img src=x onerror=alert(1)>' });
    // Modules register the bundled (partial) Spanish catalogs themselves; missing keys use the English fallback.
    i18n.setLocale('es-MX');
    check(document.documentElement.lang === 'es', 'Regional Spanish resolves to the Spanish catalog');
    check(document.querySelector('[data-settings-panel="appearance"] h3').textContent === 'Apariencia', 'Marked labels translate live');
    check(document.querySelector('[data-settings-panel="appearance"] .settings-description').textContent === settingsSpanish['appearance.description'], 'Bundled Spanish Settings copy is used');
    check(status.textContent === 'Cambios sin guardar', 'Current dynamic save state translates live');
    check(font.value === '18' && selected.value === 'papers-view', 'Translation preserves draft values');
    check(document.activeElement === field && focusedInput.selectionStart === 3 && focusedInput.selectionEnd === 11
      && focusedInput.value === 'Revista de investigación', 'Translation preserves focus, selection, and active typing');
    check(notebookDraft.value === 'My unsaved experiment notes — keep these.', 'Unmigrated editor contents are untouched');
    check(inputEvents === 0, 'Translation emits no user input or change events');
    check(unbound.textContent === untouched, 'Unmigrated module text is untouched');
    unbound.remove();
    check(JSON.stringify([...selected.options].map(option => option.value)) === JSON.stringify(options), 'Translated option labels retain their routing IDs');
    check(sentinel.querySelector('p').textContent === 'Keep this English fallback', 'Unknown DOM keys preserve original content');
    check(sentinel.querySelector('button') === button, 'Container annotations never replace child controls');
    button.click();
    check(clicked === 1, 'Existing event handlers survive');
    check(sentinel.querySelector('textarea').value === 'Editable text' && sentinel.querySelector('[contenteditable]').textContent === 'Editable label', 'Editable text is excluded');
    check(sentinel.querySelector('option').value === 'Stable implicit value', 'Implicit option values are excluded');
    check(!sentinel.querySelector('img') && sentinel.querySelector('[data-i18n="fixture.markup"]').textContent.startsWith('<img'), 'Catalog text is never parsed as HTML');
    const annotatedInput = sentinel.querySelector('input');
    check(annotatedInput.value === 'Keep my value' && annotatedInput.placeholder === 'Apariencia'
      && annotatedInput.title === 'Apariencia' && annotatedInput.getAttribute('aria-label') === 'Apariencia', 'Only allowlisted input attributes translate');
    translateTree(document);
    for (const [element] of english) {
      if (!element.isConnected || !element.dataset.i18n) continue; // Select-option renderers replace their pre-boot markup.
      check(clean(element.textContent) === clean(i18n.t(element.dataset.i18n, JSON.parse(element.getAttribute('data-i18n-params') || '{}'))), 'Spanish label missing for ' + element.dataset.i18n);
    }
    check(document.querySelector('.settings-nav').getAttribute('aria-label') === 'Secciones de ajustes', 'Navigation accessibility labels translate');
    document.querySelector('[data-settings-target="appearance"]').click();
    settings.renderForms();
    check(font.value === '18' && selected.value === 'papers-view', 'Settings rerenders preserve independent drafts');
    appearance.querySelector('[data-settings-discard]').click();
    check(font.value === '16' && selected.value === 'papers-view', 'Discard still affects only its own form');
    font.value = '18'; font.dispatchEvent(new Event('change', { bubbles: true }));
    const language = document.getElementById('setting-language');
    language.value = 'es'; language.dispatchEvent(new Event('change', { bubbles: true }));
    appearance.querySelector('[type="submit"]').click();
    await new Promise(resolve => setTimeout(resolve, 50));
    check(core.state.settings.appearance.fontSize === 18 && status.textContent === 'Cambios guardados', 'Appearance saves normally in Spanish');
    check(JSON.parse(localStorage.getItem(STORAGE_KEY)).settings.locale === 'es', 'The selected product language is persisted');
    settings.history.undo();
    check(core.state.settings.appearance.fontSize === 16 && document.documentElement.lang === 'en', 'Settings undo resynchronizes localization');
    check(document.querySelector('[data-settings-panel="appearance"] h3').textContent === 'Appearance', 'Switching back restores English');
    sentinel.remove();
    i18n.setLocale('es');
    const { checkLocalizedModules } = await import(base + 'tests/fixtures/i18n/module-checks.mjs');
    await checkLocalizedModules({ core, i18n, check });
    const { checkLocalizedHomeAndSettings } = await import(base + 'tests/fixtures/i18n/home-settings-checks.mjs');
    await checkLocalizedHomeAndSettings({ core, i18n, check });
    const { checkLocalizedNotebook } = await import(base + 'tests/fixtures/i18n/notebook-checks.mjs');
    await checkLocalizedNotebook({ core, i18n, check });
    const { checkLocalizedProtocols } = await import(base + 'tests/fixtures/i18n/protocol-checks.mjs');
    await checkLocalizedProtocols({ core, i18n, check });
    const { checkLocalizedChemicals } = await import(base + 'tests/fixtures/i18n/chemicals-checks.mjs');
    await checkLocalizedChemicals({ core, i18n, check });
    const { checkLocalizedSamples } = await import(base + 'tests/fixtures/i18n/samples-checks.mjs');
    await checkLocalizedSamples({ core, i18n, check });
    const { checkLocalizedSampleEditors } = await import(base + 'tests/fixtures/i18n/samples-editor-checks.mjs');
    await checkLocalizedSampleEditors({ core, i18n, check });
    const { checkLocalizedPlate } = await import(base + 'tests/fixtures/i18n/plate-checks.mjs');
    await checkLocalizedPlate({ core, i18n, check });
    const { checkLocalizedPapers } = await import(base + 'tests/fixtures/i18n/papers-checks.mjs');
    await checkLocalizedPapers({ core, i18n, check });
    const { checkLocalizedAgent } = await import(base + 'tests/fixtures/i18n/agent-checks.mjs');
    await checkLocalizedAgent({ core, i18n, check });
    const { checkLocalizedDna } = await import(base + 'tests/fixtures/i18n/dna-checks.mjs');
    await checkLocalizedDna({ core, i18n, check });
    const { checkLocalizedSharedGaps } = await import(base + 'tests/fixtures/i18n/shared-gaps-checks.mjs');
    await checkLocalizedSharedGaps({ core, i18n, check });
    const { checkLocalizedColonyAndSearch } = await import(base + 'tests/fixtures/i18n/colony-search-checks.mjs');
    await checkLocalizedColonyAndSearch({ core, i18n, check });
    const { checkCompletedPresentation } = await import(base + 'tests/fixtures/i18n/completion-checks.mjs');
    await checkCompletedPresentation({ i18n, check });
    core.navigationShell.showView('setting-view');
    i18n.setLocale('es');
    window.qaSpanish = { core, i18n };
    return { checks, englishLabels: english.length, modules: Object.keys(core.moduleRuntime.modules).length };
  })().catch(error => { throw new Error(error.stack || error.message); })`);
  assert.ok(result.englishLabels > 50 && result.modules >= 13);
  fs.mkdirSync(output, { recursive: true });
  // Give the real boot cover time to finish, then inspect longer Spanish copy
  // at desktop and narrow widths with the normal Settings CSS.
  await win.webContents.executeJavaScript(`new Promise(resolve => {
    window.dispatchEvent(new CustomEvent('hikari:app-ready'));
    const wait = () => document.documentElement.classList.contains('app-booting') || document.getElementById('app-loading-cover')
      ? setTimeout(wait, 30) : requestAnimationFrame(() => requestAnimationFrame(resolve));
    wait();
  })`);
  const notice = await win.webContents.executeJavaScript(
    'document.querySelector("[data-hikari-transient-toast]:not([hidden])")?.textContent || ""'
  );
  assert.equal(notice, '', `Isolated backend stubs should not obscure the Spanish layout captures: ${notice}`);
  result.checks++;
  for (const width of [1300, 800]) {
    win.setSize(width, 900);
    for (const panel of ['appearance', 'startup', 'storage', 'updates', 'notebook-pdf', 'locations', 'preferred-journal', 'plugins', 'tutorial']) {
      const layout = await win.webContents.executeJavaScript(`(async () => {
        document.querySelector('[data-settings-target="${panel}"]').click();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const visible = element => element.getClientRects().length > 0;
        const root = document.getElementById('setting-view');
        const clipped = [...root.querySelectorAll('[data-i18n]')].filter(visible).filter(element =>
          element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1
        ).map(element => element.dataset.i18n);
        return { width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1,
          clipped, title: root.querySelector('[data-settings-panel="${panel}"] h3').textContent };
      })()`);
      assert.equal(layout.overflow, false, `${panel} overflows at ${width}px`);
      assert.deepEqual(layout.clipped, [], `Spanish labels are clipped in ${panel} at ${width}px`);
      fs.writeFileSync(path.join(output, `${panel}-${width}.png`), (await win.webContents.capturePage()).toPNG());
      result.checks += 2;
    }
  }
  const scenes = [
    { name: 'tools-colony', root: 'tool-box-view', setup: `await qaI18nColony.prepareCapture();` },
    { name: 'tools-colony-crop-menu', root: 'tool-colony-counter-view', setup: `
      document.getElementById('colony-crop-menu-btn').scrollIntoView({ block: 'center' });
      document.getElementById('colony-crop-menu-btn').click();` },
    { name: 'shared-quit', root: 'qa-unsaved-changes-overlay', setup: `qaI18nShared.prepareCapture();` },
    { name: 'dna-detail', root: 'sequence-viewer-detail-view', setup: `
      qaSpanish.core.navigationShell.showView('sequence-viewer-detail-view');` },
    { name: 'dna-new', root: 'sequence-viewer-new-overlay', setup: `
      qaSpanish.core.navigationShell.showView('sequence-viewer-view');
      document.getElementById('sequence-viewer-home-paste-btn').click();` },
    { name: 'agent-view', root: 'agent-view', setup: `
      document.body.dataset.agentAvailability = 'connected';
      qaSpanish.core.navigationShell.showView('agent-view');
      qaSpanish.core.moduleRuntime.modules.agentChat.render();` },
    { name: 'papers-viewer', root: 'papers-view', setup: `
      qaSpanish.core.navigationShell.showView('papers-view');
      await qaSpanish.core.moduleRuntime.modules.papers.openStoredPaper({ relativePath: 'Papers/i18n.pdf' });
      if (document.getElementById('paper-details-sidebar').hidden) document.getElementById('paper-details-toggle-btn').click();` },
    { name: 'plate-setup', root: 'assay-view', setup: `
      qaSpanish.core.navigationShell.showView('assay-view');
      document.querySelector('[data-assay-edit="' + qaI18nPlate.assayId + '"]').click();` },
    { name: 'plate-dilution', root: 'assay-serial-dilution-overlay', setup: `
      document.getElementById('assay-serial-dilution-btn').click();` },
    { name: 'plate-analyze', root: 'assay-view', setup: `
      document.getElementById('assay-serial-dilution-close-btn').click();
      document.getElementById('assay-mode-results-btn').click();
      document.querySelector('[data-assay-results-select="' + qaI18nPlate.assayId + '"]').click();` },
    { name: 'samples-grid', root: 'sample-registry-view', setup: `
      qaSpanish.core.navigationShell.showView('sample-registry-view');
      qaSpanish.core.moduleRuntime.modules.personalInventory.openSample('i18n-storage-sample');` },
    { name: 'samples-editor', root: 'sample-registry-view', setup: `
      document.querySelector('#inventory-sections .well-side-editor').scrollIntoView({ block: 'center' });` },
    { name: 'samples-plate', root: 'sample-registry-view', setup: `
      document.querySelector('[data-container-open="' + qaI18nSamples.plateId + '"]').click();` },
    { name: 'samples-tube', root: 'sample-registry-view', setup: `
      document.querySelector('[data-container-open="' + qaI18nSamples.tubeId + '"]').click();` },
    { name: 'samples-container', root: 'inventory-add-container-overlay', setup: `
      const folder = [...document.querySelectorAll('[data-folder-add-container]')].find(node => node.dataset.folderAddContainer === qaI18nSamples.folderId);
      folder.click();
      const type = document.getElementById('inventory-add-container-type');
      type.value = 'customGrid'; type.dispatchEvent(new Event('change', { bubbles: true }));` },
    { name: 'samples-folder', root: 'inventory-add-container-overlay', setup: `
      document.getElementById('inventory-add-container-cancel').click();
      const folder = [...document.querySelectorAll('[data-inventory-folder-context]')].find(node => node.dataset.inventoryFolderContext === qaI18nSamples.folderId);
      folder.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 240 }));
      document.querySelector('[data-folder-context-add-folder]').click();` },
    { name: 'chemicals-list', root: 'lab-common-inventory-view', setup: `
      qaSpanish.core.navigationShell.showView('lab-common-inventory-view');
      document.querySelector('[data-chemical-open="' + qaI18nChemicals.id + '"]').click();` },
    { name: 'chemicals-edit', root: 'chemical-dialog-overlay', setup: `
      document.getElementById('chemical-detail-edit-btn').click();` },
    { name: 'chemicals-add', root: 'chemical-dialog-overlay', setup: `
      document.getElementById('chemical-cancel-btn').click();
      document.getElementById('chemical-open-add-btn').click();` },
    { name: 'protocol-view', root: 'protocol-management-view', setup: `
      qaSpanish.core.navigationShell.showView('protocol-management-view');
      document.querySelector('[data-protocol-select="' + qaI18nProtocol.savedId + '"]').click();` },
    { name: 'protocol-editor', root: 'protocol-management-view', setup: `
      qaSpanish.core.moduleRuntime.modules.protocol.editProtocol(qaI18nProtocol.savedId);` },
    { name: 'protocol-import', root: 'protocol-json-import-overlay', setup: `
      document.getElementById('create-protocol-btn').click();
      document.getElementById('open-protocol-json-import-btn').click();` },
    { name: 'protocol-generation', root: 'protocol-generate-input-overlay', setup: `
      document.getElementById('protocol-json-import-close-btn').click();
      document.body.dataset.agentAvailability = 'connected';
      document.getElementById('protocol-generate-btn').click();` },
    { name: 'protocol-polish', root: 'protocol-polish-overlay', setup: `
      document.getElementById('protocol-generate-close-btn').click();
      await qaI18nProtocol.preparePolishCapture();` },
    { name: 'notebook-page', root: 'biology-notebook-view', setup: `
      qaSpanish.core.navigationShell.showView('biology-notebook-view');
      qaSpanish.core.moduleRuntime.modules.biologyNotebook.openEntry(qaI18nNotebook.entryId);` },
    { name: 'notebook-experiment', root: 'biology-notebook-experiment-dialog-overlay', setup: `
      qaSpanish.core.moduleRuntime.modules.biologyNotebook.openExperimentDialog({ projectId: qaI18nNotebook.projectId });` },
    { name: 'notebook-project', root: 'biology-notebook-project-dialog-overlay', setup: `
      document.getElementById('biology-notebook-experiment-cancel-btn').click();
      document.getElementById('biology-notebook-header-add-project-btn').click();` },
    { name: 'home', root: 'home-view', setup: `qaSpanish.core.navigationShell.showView('home-view');` },
    { name: 'home-timer', root: 'home-view', setup: `
      qaSpanish.core.navigationShell.showView('home-view');
      document.getElementById('dashboard-timer-open-btn').click();` },
    { name: 'tools-molarity', root: 'tool-box-view', setup: `
      qaSpanish.core.navigationShell.showView('tool-box-view');
      document.querySelector('[data-tool-view="tool-molarity-view"]').click();` },
    { name: 'tools-peptide', root: 'tool-box-view', setup: `
      qaSpanish.core.navigationShell.showView('tool-box-view');
      document.querySelector('[data-tool-view="tool-peptide-view"]').click();` },
    { name: 'workflow-list', root: 'workflow-management-view', setup: `
      qaSpanish.core.navigationShell.showView('workflow-management-view');
      document.getElementById('workflow-entry-back-btn').click();` },
    { name: 'workflow-execution', root: 'workflow-management-view', setup: `
      qaSpanish.core.navigationShell.showView('workflow-management-view');
      qaSpanish.core.moduleRuntime.modules.workflowManagement.openProcess(qaI18nExecution.workflowId);
      const step = document.querySelector('[data-workflow-drawer-toggle="' + qaI18nExecution.firstBlockId + '"]');
      if (!step.closest('details').open) step.click();` },
    { name: 'workflow-editor', root: 'workflow-management-view', setup: `
      document.getElementById('workflow-entry-template-btn').click();
      document.getElementById('workflow-template-name').value = 'Ensayo de control';
      const blockType = document.querySelector('input[name="workflow-block-type-option"][value="text"]');
      blockType.checked = true; blockType.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('workflow-block-text').value = 'Incubar durante 10 minutos';
      document.getElementById('workflow-block-add-btn').click();` },
    { name: 'workflow-process', root: 'workflow-process-dialog', setup: `
      qaSpanish.core.moduleRuntime.modules.workflowManagement.openProcessDialog({
        templateId: qaSpanish.core.state.workflowTemplates[0].id });` }
  ];
  for (const width of [1300, 800]) {
    win.setSize(width, 900);
    for (const scene of scenes) {
      const layout = await win.webContents.executeJavaScript(`(async () => {
        ${scene.setup}
        qaSpanish.i18n.setLocale('es');
        await new Promise(resolve => setTimeout(resolve, 60));
        const root = document.getElementById(${JSON.stringify(scene.root)});
        // Opening the saved Plate fixture emits this already-verified success notice.
        const sceneNotice = document.querySelector('[data-hikari-transient-toast]');
        if (sceneNotice?.dataset.i18n === 'plate.results.loaded') sceneNotice.hidden = true;
        const clipped = [...root.querySelectorAll('[data-i18n]')].filter(element =>
          !element.closest('.sr-only, [aria-hidden="true"]') && element.getClientRects().length > 0
          && element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1
        ).map(element => element.dataset.i18n);
        const dialogHeading = root.matches('.app-dialog-overlay')
          ? root.querySelector('.app-dialog-head h3') : null;
        const headingVisible = !dialogHeading || dialogHeading.getBoundingClientRect().top >= document.querySelector('.topbar').getBoundingClientRect().bottom;
        return { clipped, headingVisible, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
      })()`).catch(error => { throw new Error(scene.name + ' at ' + width + 'px: ' + error.message); });
      assert.equal(layout.overflow, false, `${scene.name} overflows at ${width}px`);
      assert.deepEqual(layout.clipped, [], `Spanish labels are clipped in ${scene.name} at ${width}px`);
      assert.equal(layout.headingVisible, true, `${scene.name} header is hidden behind navigation at ${width}px`);
      fs.writeFileSync(path.join(output, `${scene.name}-${width}.png`), (await win.webContents.capturePage()).toPNG());
      result.checks += 2;
      if (scene.name === 'tools-colony-crop-menu') await win.webContents.executeJavaScript(`
        document.getElementById('colony-crop-menu-btn').click();
        for (let node = document.getElementById('colony-counter-form'); node; node = node.parentElement) node.scrollTop = 0;
      `);
      if (scene.name === 'samples-editor') await win.webContents.executeJavaScript(`
        for (let node = document.querySelector('#inventory-sections .well-side-editor'); node; node = node.parentElement) node.scrollTop = 0;
      `);
      if (scene.name === 'shared-quit') await win.webContents.executeJavaScript('qaI18nShared.close()');
      if (scene.name === 'dna-new') await win.webContents.executeJavaScript('document.getElementById("sequence-viewer-new-cancel-btn").click()');
      if (scene.name === 'agent-view') await win.webContents.executeJavaScript('document.body.dataset.agentAvailability = "offline"');
      if (scene.name === 'samples-folder') await win.webContents.executeJavaScript('document.getElementById("inventory-add-container-cancel").click()');
      if (scene.name === 'chemicals-add') await win.webContents.executeJavaScript('document.getElementById("chemical-cancel-btn").click()');
      if (scene.name === 'protocol-polish') await win.webContents.executeJavaScript('document.getElementById("protocol-polish-close-btn").click(); document.body.dataset.agentAvailability = "offline"');
      if (scene.name === 'notebook-project') await win.webContents.executeJavaScript('document.getElementById("biology-notebook-project-cancel-btn").click()');
      if (scene.name === 'home-timer') await win.webContents.executeJavaScript('document.getElementById("dashboard-timer-dialog-close-btn").click()');
      if (scene.name === 'workflow-process') await win.webContents.executeJavaScript('document.getElementById("workflow-process-cancel").click()');
    }
  }
  // Return the fixture to its English product preference before closing.
  await win.webContents.executeJavaScript('qaSpanish.i18n.setLocale("en")');
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
  console.log(`i18n Spanish UI: ${result.checks} checks passed; ${result.englishLabels} labels in English and Spanish, ${result.modules} initialized modules. Screenshots: ${output}`);
}

main().then(() => { clearTimeout(timeout); win?.destroy(); app.exit(0); })
  .catch(error => { console.error(error); clearTimeout(timeout); win?.destroy(); app.exit(1); });
