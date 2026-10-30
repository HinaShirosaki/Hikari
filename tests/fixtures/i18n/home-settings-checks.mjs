// Real Home/shell controls and isolated Settings controllers; no live files,
// accounts, updater, plugin install or agent request is touched.
export async function checkLocalizedHomeAndSettings({ core, i18n, check }) {
  const { formatDateLocal } = await import('../../../src/renderer/modules/home-dashboard/utils.js');
  const { createUpdateSettings } = await import('../../../src/renderer/modules/settings/update-controller.js');
  const { createPluginsController } = await import('../../../src/renderer/modules/settings/plugins-controller.js');
  const { createPluginPreferencesController } = await import('../../../src/renderer/modules/settings/plugin-preferences-controller.js');
  const { escapeHtml } = await import('../../../src/renderer/lib/html.js');
  const { translateTree } = await import('../../../src/renderer/lib/i18n/dom.js');
  const { APP_REGISTRY } = await import('../../../src/renderer/modules/app-registry.generated.js');
  const { bindAppLabel, setAppSubtitle } = await import('../../../src/renderer/lib/i18n/shell.js');
  const byId = id => document.getElementById(id);
  const home = core.moduleRuntime.modules.homeDashboard;
  const settings = core.moduleRuntime.modules.settings;
  const dashboard = core.state.settings.dashboard;
  const today = formatDateLocal(new Date());
  const old = new Date(); old.setDate(old.getDate() - 4);
  dashboard.passageReminders = [
    { id: 'i18n-due', name: 'User <cell> & name', cellPassage: { lastPassageDate: formatDateLocal(old), intervalDays: 1, passageNumber: 3 } },
    { id: 'i18n-later', name: 'Future cell', cellPassage: { lastPassageDate: today, intervalDays: 5, passageNumber: 1 } }
  ];
  dashboard.incubationLocations = [{ name: 'Shaker <&>', reminderDate: today }, { name: 'Cold room', reminderDate: '' }];
  dashboard.timerTemplates = [{ name: 'Wash <&>', durationMinutes: 12 }];
  dashboard.activeTimers = [
    { name: 'Timer <&>', durationMinutes: 12, startedAtMs: Date.now(), endAtMs: Date.now() + 720000, isPaused: false, remainingMs: 0 },
    { name: 'Paused <&>', durationMinutes: 4, startedAtMs: Date.now(), endAtMs: Date.now(), isPaused: true, remainingMs: 120000 },
    { name: 'Finished <&>', durationMinutes: 1, startedAtMs: Date.now() - 120000, endAtMs: Date.now() - 60000, isPaused: false, remainingMs: 0 }
  ];
  core.navigationShell.showView('home-view');
  i18n.setLocale('en'); home.render();
  const root = byId('home-view');
  for (const element of root.querySelectorAll('[data-i18n]')) {
    const params = JSON.parse(element.getAttribute('data-i18n-params') || '{}');
    check(i18n.has(element.dataset.i18n) && element.textContent === i18n.t(element.dataset.i18n, params), 'Home English message: ' + element.dataset.i18n);
  }
  const input = byId('dashboard-quick-log-input');
  input.value = 'Unsaved experiment <&> — keep this'; input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus(); input.setSelectionRange(3, 15);
  const row = root.querySelector('[data-dashboard-timer-index="0"]');
  const toggle = row.querySelector('button');
  const serialized = JSON.stringify(core.state);
  const registry = JSON.stringify(APP_REGISTRY);
  i18n.setLocale('es');
  check(byId('dashboard-timer-heading').textContent.includes('Temporizadores del laboratorio'), 'Home headings translate');
  check(byId('dashboard-quick-log-status').textContent === 'Guardando borrador…', 'Pending experiment draft status translates');
  check(document.activeElement === input && input.selectionStart === 3 && input.selectionEnd === 15 && input.value.includes('Unsaved experiment'), 'Home locale switching preserves typing and selection');
  check(row === root.querySelector('[data-dashboard-timer-index="0"]') && toggle === row.querySelector('button'), 'Home locale switching preserves timer nodes and event targets');
  check(JSON.stringify(core.state) === serialized && JSON.stringify(APP_REGISTRY) === registry, 'Locale changes preserve all saved data and registry IDs/aliases');
  check(toggle.title === 'Pausar temporizador Timer <&>' && !row.querySelector('img'), 'Timer accessibility copy interpolates names safely');
  check(byId('topbar-active-timer').getAttribute('aria-valuetext').includes('restante'), 'Progress-bar value text translates');
  check(byId('dashboard-passage-summary').textContent === '1 por atender'
    && byId('dashboard-passage-summary').getAttribute('aria-label') === '1 por atender · 2 líneas celulares', 'Passage due count stays separate from total on a live locale change');
  check(byId('dashboard-incubation-summary').textContent === '1 por atender', 'Incubation due count stays separate from total');
  for (const button of document.querySelectorAll('.app-nav-btn[data-app-id]')) {
    const app = APP_REGISTRY.find(app => app.id === button.dataset.appId);
    if (app && i18n.has('shell.app.' + app.id)) check(button.getAttribute('aria-label') === i18n.t('shell.app.' + app.id), 'Dock label translates without changing routing: ' + app.id);
  }
  const more = byId('app-more-btn');
  if (!more.hidden) {
    more.click();
    const item = byId('app-more-menu').querySelector('[data-app-id="settings"]') || byId('app-more-menu').querySelector('button');
    if (item) {
      const view = item.dataset.view;
      item.click();
      check(byId(view).classList.contains('is-active'), 'Translated overflow navigation opens the original view ID');
    }
  }
  core.navigationShell.showView('home-view');
  const search = byId('topbar-search-toggle'); search.click();
  check(search.getAttribute('aria-label') === 'Buscar' && document.activeElement === byId('topbar-search'), 'Expanded search keeps translated accessibility labels');
  i18n.setLocale('en'); i18n.setLocale('es');
  check(search.getAttribute('aria-label') === 'Buscar', 'Expanded search label survives later locale switches');
  byId('topbar-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check(search.getAttribute('aria-label') === 'Abrir búsqueda', 'Collapsed search label translates');
  // Plugin-supplied names and subtitles never acquire a built-in translation.
  const pluginButton = document.createElement('button'); const pluginLabel = document.createElement('span');
  bindAppLabel(pluginButton, pluginLabel, { id: 'plugin-fixture', label: 'Custom plugin <&>' });
  const subtitle = document.createElement('p');
  setAppSubtitle(subtitle, 'home-view', { 'home-view': 'Custom workspace subtitle <&>' });
  check(pluginLabel.textContent === 'Custom plugin <&>' && !pluginLabel.hasAttribute('data-i18n')
    && subtitle.textContent === 'Custom workspace subtitle <&>' && !subtitle.hasAttribute('data-i18n'), 'Custom plugin titles and subtitle overrides remain literal');

  byId('dashboard-quick-log-save-btn').click();
  check(dashboard.quickLogEntries.at(-1).text === 'Unsaved experiment <&> — keep this' && input.value === '', 'Experiment save preserves the original user text in Spanish');
  check(byId('dashboard-quick-log-status').textContent === 'Registrado.' && byId('dashboard-quick-log-recent').textContent.includes('Guardado hoy'), 'Experiment save confirmation translates');
  toggle.click();
  check(dashboard.activeTimers[0].isPaused && dashboard.activeTimers[0].remainingMs > 0, 'Translated pause still freezes the countdown');
  const paused = root.querySelector('[data-dashboard-timer-index="0"]');
  check(paused.querySelector('button').title === 'Reanudar temporizador Timer <&>' && paused.textContent.includes('En pausa'), 'New paused timer markup translates');
  paused.querySelector('button').click();
  check(!dashboard.activeTimers[0].isPaused && dashboard.activeTimers[0].endAtMs > Date.now(), 'Translated resume still restarts the countdown');
  root.querySelector('[data-dashboard-start-timer-template="0"]').click();
  check(dashboard.activeTimers.at(-1).name === 'Wash <&>' && dashboard.activeTimers.at(-1).durationMinutes === 12, 'Translated preset keeps the user name and original duration');
  byId('dashboard-passage-list').querySelector('[data-dashboard-passage-action="extend"]').click();
  check(dashboard.passageReminders[0].cellPassage.deferredUntilDate > today, 'Translated passage reminder still schedules tomorrow');
  i18n.setLocale('en'); i18n.setLocale('es');
  check(byId('dashboard-passage-summary').textContent === '2', 'Zero due reminders retain their numeric total after switching languages');
  byId('dashboard-incubation-list').querySelector('[data-dashboard-incubation-remind="0"]').click();
  check(dashboard.incubationLocations[0].reminderDate > today
    && byId('dashboard-incubation-list').querySelector('button').title === 'Recordatorio para mañana', 'Incubation action still saves tomorrow and translates its new state');
  byId('dashboard-timer-open-btn').click();
  const name = byId('dashboard-timer-name-input'); name.value = 'Draft timer'; name.focus();
  const beforeForm = byId('dashboard-timer-dialog-form');
  i18n.setLocale('en'); i18n.setLocale('es');
  check(byId('dashboard-timer-dialog-form') === beforeForm && name.value === 'Draft timer' && document.activeElement === name, 'Open timer dialog drafts survive locale changes');
  byId('dashboard-timer-dialog-close-btn').click();

  core.navigationShell.showView('setting-view');
  document.querySelector('[data-settings-target="preferred-journal"]').click();
  core.state.settings.preferredJournals = ['User journal <&>']; settings.renderForms();
  const journal = document.querySelector('[data-preferred-journal-input="0"]');
  journal.value = 'Unsaved journal <&>'; journal.focus(); journal.setSelectionRange(2, 8);
  i18n.setLocale('en'); i18n.setLocale('es');
  check(journal === document.querySelector('[data-preferred-journal-input="0"]') && journal.value === 'Unsaved journal <&>' && journal.selectionStart === 2, 'Journal row drafts and selection survive locale changes');
  check(journal.getAttribute('aria-label') === 'Revista preferida 1', 'Journal input labels translate');
  document.querySelector('[data-preferred-journal-save="0"]').click();
  check(core.state.settings.preferredJournals[0] === 'Unsaved journal <&>' && document.querySelector('[data-preferred-journal-delete="0"]').title === 'Eliminar revista', 'Translated journal save preserves user content');
  document.querySelector('[data-settings-target="notebook-pdf"]').click();
  const page = byId('setting-notebook-pdf-page-size'); const edge = byId('setting-notebook-pdf-staple-edge');
  page.value = 'a4'; page.dispatchEvent(new Event('change', { bubbles: true }));
  edge.value = 'left'; edge.dispatchEvent(new Event('change', { bubbles: true }));
  i18n.setLocale('en'); i18n.setLocale('es');
  check(page.value === 'a4' && edge.value === 'left', 'PDF controls retain canonical draft option values');
  document.querySelector('#notebook-pdf-form [data-settings-discard]').click();

  document.querySelector('[data-settings-target="locations"]').click();
  const location = document.querySelector('[data-sample-inventory-location-input]');
  const originalLocation = location.value;
  location.value = 'Unsaved storage location <&>'; location.focus(); location.setSelectionRange(1, 9);
  const locationsBefore = JSON.stringify(core.state.settings.sampleInventoryLocations);
  i18n.setLocale('en'); i18n.setLocale('es');
  check(location === document.querySelector('[data-sample-inventory-location-input]') && location.value === 'Unsaved storage location <&>'
    && location.selectionStart === 1 && JSON.stringify(core.state.settings.sampleInventoryLocations) === locationsBefore, 'Sample-location typing stays separate from translated row labels');
  check(location.getAttribute('aria-label').startsWith('Ubicación de muestras')
    && location.parentElement.textContent.includes('contenedor'), 'Sample storage row labels and plural container counts translate');
  location.value = originalLocation;

  // Use detached service backends; updater actions never reach the real API.
  const fixture = document.createElement('section'); document.body.append(fixture);
  const updateStatus = document.createElement('p'); fixture.append(updateStatus);
  let update = { status: 'update-available', latestVersion: '1.2.3', currentVersion: '1.2.0' };
  const checkButton = document.createElement('button'); const installButton = document.createElement('button');
  const updater = createUpdateSettings({ api: { getUpdateStatus: async () => update, checkForUpdates() {}, installUpdate() {} }, statusElement: updateStatus, checkButton, installButton });
  await updater.refresh();
  check(updateStatus.textContent === 'Hikari 1.2.3 está disponible. Estás usando Hikari 1.2.0.' && !installButton.disabled, 'Update availability translates versions and keeps install availability');
  update = { status: 'error', error: 'Backend detail <&>' }; await updater.refresh();
  i18n.setLocale('en'); i18n.setLocale('es');
  check(updateStatus.textContent === 'No se pudo actualizar: Backend detail <&>' && updateStatus.dataset.error === 'true', 'Update errors preserve backend details across locale changes');
  update = { status: 'installing', installKind: 'app', latestVersion: '1.2.3' }; await updater.refresh();
  check(checkButton.disabled && installButton.disabled && updateStatus.textContent.includes('menos de un minuto'), 'Installing status remains translated and prevents duplicate actions');
  const plugin = { id: 'qa-i18n-plugin', name: 'User plugin <&>', permissions: ['settings'], settings: [
    { key: 'author', type: 'string', label: 'Plugin author label <&>', default: 'Default author' }
  ] };
  const pluginState = { settings: {} }; let saves = 0;
  const preferences = createPluginPreferencesController({ state: pluginState, persist: () => { saves++; }, windowObject: null, escapeHtml });
  const container = document.createElement('div'); fixture.append(container);
  container.innerHTML = preferences.markup(plugin); preferences.bind(container);
  const details = container.querySelector('details'); details.open = true;
  const author = container.querySelector('input'); author.value = 'Draft author <&>'; author.dispatchEvent(new Event('input', { bubbles: true }));
  i18n.setLocale('en'); i18n.setLocale('es'); translateTree(container);
  check(container.querySelector('input') === author && author.value === 'Draft author <&>'
    && container.textContent.includes('Plugin author label <&>') && container.querySelector('summary').textContent === 'Preferencias', 'Plugin preference chrome translates while schema labels and drafts stay literal');
  container.querySelector('form').requestSubmit();
  check(saves === 1 && container.querySelector('[data-plugin-settings-status]').textContent === 'Cambios guardados', 'Plugin preferences save in Spanish');
  const pluginPanel = document.createElement('div'); fixture.append(pluginPanel);
  pluginPanel.innerHTML = '<p data-qa-plugin-status></p><div data-qa-plugin-list></div><input><button></button>';
  const url = pluginPanel.querySelector('input'); url.value = 'https://github.com/example/i18n-fixture';
  const install = pluginPanel.querySelector('button'); const pluginStatus = pluginPanel.querySelector('p');
  const installedState = { settings: { plugins: [] } }; let finish;
  const pluginController = createPluginsController({ state: installedState, persist() {}, escapeHtml, windowObject: null,
    statusElement: pluginStatus, listElement: pluginPanel.querySelector('[data-qa-plugin-list]'), githubUrlInput: url, githubInstallButton: install,
    api: { installPluginFromGitHub: () => new Promise(resolve => { finish = resolve; }) }
  });
  pluginController.render();
  const installing = pluginController.onInstallFromGitHub();
  i18n.setLocale('en'); i18n.setLocale('es');
  check(install.disabled && install.textContent === 'Instalando…' && pluginStatus.textContent === 'Clonando y validando el complemento…'
    && url.value === 'https://github.com/example/i18n-fixture', 'Pending plugin installs retain translated progress and the repository URL');
  finish({ ok: true, id: 'qa-installed', name: 'Installed plugin <&>', path: '/fixture/plugin', repositoryUrl: 'https://github.com/example/i18n-fixture', permissions: ['settings'], settings: plugin.settings });
  await installing;
  check(installedState.settings.plugins[0].enabled === false && pluginStatus.textContent.includes('Installed plugin <&>')
    && !install.disabled && install.textContent === 'Instalar desde GitHub', 'Translated plugin install keeps its initial host-access behavior and literal name');
  const enabled = pluginPanel.querySelector('[data-plugin-toggle]'); enabled.checked = true; enabled.dispatchEvent(new Event('change', { bubbles: true }));
  check(installedState.settings.plugins[0].enabled && pluginStatus.textContent === 'Se activó "Installed plugin <&>".', 'Translated plugin enable action updates the original record');
  pluginPanel.querySelector('[data-plugin-remove]').click();
  check(installedState.settings.plugins.length === 0 && pluginStatus.textContent.includes('Su carpeta no se ha borrado.'), 'Translated plugin removal preserves the existing folder policy');
  fixture.remove();
  i18n.setLocale('es');
}
