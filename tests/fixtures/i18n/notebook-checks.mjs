// Real Notebook and Home note editing, disposable state and stubbed file IPC.
export async function checkLocalizedNotebook({ core, i18n, check }) {
  const { createNotebookViewerRender } = await import('../../../src/renderer/modules/biology-notebook/notebook/viewer-render.js');
  const { notebookStateLabel } = await import('../../../src/renderer/modules/biology-notebook/entry/entry-helpers.js');
  const byId = id => document.getElementById(id);
  const notebook = core.moduleRuntime.modules.biologyNotebook;
  const home = core.moduleRuntime.modules.homeDashboard;
  const settle = () => new Promise(resolve => setTimeout(resolve, 30));
  const waitFor = async condition => {
    for (let n = 0; n < 100; n++) { if (condition()) return; await settle(); }
    throw new Error('Notebook i18n fixture did not settle');
  };
  const switchLocale = () => { i18n.setLocale('en'); i18n.setLocale('es'); };
  const change = (element, value) => { element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); };
  const submit = form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  core.navigationShell.showView('biology-notebook-view');
  i18n.setLocale('es');
  byId('biology-notebook-header-add-project-btn').click();
  await settle();
  const projectForm = byId('biology-notebook-project-form');
  const projectName = byId('biology-notebook-project-name');
  check(byId('biology-notebook-project-dialog-title').textContent === 'Nuevo proyecto', 'Notebook project dialog translates');
  submit(projectForm);
  check(byId('biology-notebook-project-form-status').textContent === 'Introduce un nombre de proyecto.'
    && projectName.getAttribute('aria-invalid') === 'true', 'Project name validation translates');
  change(projectName, 'Notebook project <&>'); projectName.setSelectionRange(2, 10);
  const projectState = JSON.stringify(core.state.projects);
  switchLocale();
  check(byId('biology-notebook-project-name') === projectName && document.activeElement === projectName
    && projectName.value === 'Notebook project <&>' && projectName.selectionStart === 2
    && JSON.stringify(core.state.projects) === projectState, 'Project creation drafts, focus and data survive a locale change');
  submit(projectForm);
  await waitFor(() => byId('biology-notebook-project-dialog-overlay').hidden);
  const project = core.state.projects.find(item => item.name === 'Notebook project <&>');
  check(Boolean(project), 'Project creation saves the original name in Spanish');
  byId('biology-notebook-header-add-project-btn').click(); await settle();
  change(projectName, project.name); submit(projectForm);
  check(byId('biology-notebook-project-form-status').textContent.startsWith('Ya existe un proyecto'), 'Duplicate project validation translates');
  switchLocale();
  check(byId('biology-notebook-project-form-status').textContent.startsWith('Ya existe un proyecto'), 'Active project validation stays bound during switching');
  byId('biology-notebook-project-cancel-btn').click();

  const protocol = { id: 'i18n-notebook-protocol', name: 'User protocol <&>', steps: [
    { id: 's1', text: 'Add {{ph:vol}} of sample <&>', placeholders: [{ id: 'vol', name: 'User volume <&>' }] },
    { id: 's2', text: 'Record the observation <&>', placeholders: [] }
  ] };
  core.state.protocols.push(protocol);
  notebook.renderProjectOptions(); notebook.renderProtocolOptions(); notebook.renderEntries();
  notebook.openExperimentDialog({ projectId: project.id }); await settle();
  const projectSelect = byId('biology-notebook-project-select');
  const protocolSelect = byId('biology-notebook-protocol-select');
  const search = byId('biology-notebook-protocol-search');
  check(projectSelect.value === project.id && byId('biology-notebook-experiment-start-btn').disabled, 'Translated experiment setup preserves project ID and validation');
  change(search, 'NO_MATCHING_PROTOCOL');
  check(byId('biology-notebook-protocol-search-results').textContent.includes('No hay protocolos coincidentes.'), 'Protocol search empty state translates');
  change(search, 'User protocol'); search.focus(); search.setSelectionRange(1, 6);
  const results = byId('biology-notebook-protocol-search-results');
  const result = results.querySelector('[data-notebook-experiment-protocol-id="' + protocol.id + '"]');
  const options = [...projectSelect.options].map(option => option.value);
  switchLocale();
  check(byId('biology-notebook-protocol-search') === search && document.activeElement === search
    && search.value === 'User protocol' && search.selectionStart === 1 && result.isConnected, 'Experiment search draft and result nodes survive locale changes');
  check(projectSelect.value === project.id && JSON.stringify([...projectSelect.options].map(option => option.value)) === JSON.stringify(options), 'Translated project options retain their IDs and selection');
  result.click();
  check(protocolSelect.value === protocol.id && !byId('biology-notebook-experiment-start-btn').disabled, 'Protocol selection works in Spanish');
  byId('biology-notebook-experiment-start-btn').click(); await settle();
  check(byId('biology-notebook-experiment-dialog-overlay').hidden && !byId('biology-notebook-protocol-area').hidden, 'Translated start action opens a new notebook page');
  check(byId('biology-notebook-steps').textContent.includes('Paso 1:') && byId('biology-notebook-steps').textContent.includes('of sample <&>'), 'Only step chrome translates, preserving the actual protocol text');
  const notes = byId('biology-notebook-result');
  change(notes, 'Draft observations <&> — keep this'); notes.focus(); notes.setSelectionRange(3, 15);
  const selectedFiles = byId('biology-notebook-result-file'); const transfer = new DataTransfer();
  transfer.items.add(new File(['Fixture results'], 'result<&>.txt', { type: 'text/plain' }));
  selectedFiles.files = transfer.files; selectedFiles.dispatchEvent(new Event('change', { bubbles: true }));
  const file = selectedFiles.files[0];
  const token = byId('biology-notebook-steps').querySelector('[data-inline-token]');
  const before = JSON.stringify(core.state);
  switchLocale();
  check(byId('biology-notebook-result') === notes && notes.value === 'Draft observations <&> — keep this'
    && document.activeElement === notes && notes.selectionStart === 3 && notes.selectionEnd === 15, 'Notebook notes retain identity, focus, text and selection while translating');
  check(selectedFiles === byId('biology-notebook-result-file') && selectedFiles.files[0] === file
    && token === byId('biology-notebook-steps').querySelector('[data-inline-token]'), 'Locale changes preserve staged file selection and protocol controls');
  check(JSON.stringify(core.state) === before && notebook.hasUnsavedChanges(), 'Translation neither saves nor clears the active notebook draft');
  check(byId('save-biology-notebook-btn').getAttribute('aria-label') === 'Guardar página del cuaderno'
    && byId('save-biology-notebook-btn').getAttribute('data-hover-caption') === 'Guardar página del cuaderno', 'Save accessibility labels and hover captions translate together');

  const imported = []; const previousImport = window.hikariApi.storeImportedFile;
  window.hikariApi.storeImportedFile = async payload => {
    imported.push(payload);
    return { ok: true, fileName: payload.fileName, filePath: payload.targetFolder + '/' + payload.fileName, relativePath: 'fixture/results/' + payload.fileName };
  };
  try {
    byId('save-biology-notebook-btn').click();
    await waitFor(() => core.state.notebookEntries.some(item => item.projectId === project.id && item.protocolId === protocol.id));
  } finally { window.hikariApi.storeImportedFile = previousImport; }
  const entry = core.state.notebookEntries.find(item => item.projectId === project.id && item.protocolId === protocol.id);
  check(entry.result === 'Draft observations <&> — keep this' && entry.protocolSnapshot.name === protocol.name
    && entry.protocolSnapshot.steps[0].text === protocol.steps[0].text, 'Saving in Spanish preserves original notes and protocol snapshots');
  check(imported.length === 1 && imported[0].fileName === file.name && !imported[0].targetFolder.includes('Nuevo')
    && entry.resultFiles.includes(file.name), 'Imported files retain their names and canonical storage path in Spanish');
  const metadata = byId('biology-notebook-protocol-meta');
  check(metadata.textContent.includes('Ejecutado') && metadata.querySelector('[data-i18n-date]'), 'Saved notebook metadata uses live status/date bindings');
  i18n.setLocale('en'); check(metadata.textContent.includes('Executed'), 'Notebook metadata restores English');
  i18n.setLocale('es');
  check(!metadata.textContent.includes('Select a notebook page'), 'A cleared viewer fallback cannot replace saved metadata later');
  check(byId('biology-notebook-entry-list').querySelector('[data-notebook-entry-id="' + entry.id + '"]').textContent.includes('Ejecutado'), 'Notebook entry status badges translate');
  check(notebookStateLabel(entry) === 'Executed' && entry.notebookState === 'executed', 'Canonical state helpers and stored state IDs remain English');

  byId('biology-notebook-edit-protocol-btn').click();
  const copyName = byId('biology-notebook-page-protocol-name'); const copySteps = byId('biology-notebook-page-protocol-steps');
  change(copyName, 'Edited page copy <&>'); change(copySteps, 'Measure [Volume]\nIncubate [Time]');
  copySteps.focus(); copySteps.setSelectionRange(2, 12); switchLocale();
  check(copyName.value === 'Edited page copy <&>' && copySteps.value === 'Measure [Volume]\nIncubate [Time]'
    && document.activeElement === copySteps && copySteps.selectionStart === 2 && !byId('biology-notebook-protocol-editor').hidden, 'Page-copy editing survives a locale switch');
  byId('biology-notebook-cancel-protocol-edit-btn').click();
  check(core.state.protocols.find(item => item.id === protocol.id).name === protocol.name, 'Canceling translated copy editing leaves the original protocol intact');

  const currentNotes = byId('biology-notebook-result');
  const originalNotes = currentNotes.value;
  currentNotes.value = '';
  byId('clarify-save-biology-notebook-btn').click();
  const notice = document.querySelector('[data-hikari-transient-toast]');
  check(notice && notice.textContent === 'Añade notas al cuaderno antes de aclararlas.', 'Empty notebook clarification translates its local validation without an agent request');
  switchLocale();
  check(notice.textContent === 'Añade notas al cuaderno antes de aclararlas.', 'An active notebook validation notice stays translated');
  // This deliberately exercised notice has been checked; keep layout captures clear.
  notice.hidden = true;
  currentNotes.value = originalNotes;

  // Save/clarify busy labels are tested with an isolated toolbar, without AI calls.
  const toolbar = document.createElement('div'); document.body.append(toolbar);
  toolbar.innerHTML = '<button><span class="sr-only"></span></button><button></button>';
  const save = toolbar.querySelector('button'); const clarify = toolbar.querySelectorAll('button')[1];
  const viewer = createNotebookViewerRender({ elements: { saveNotebookBtn: save, clarifySaveNotebookBtn: clarify } });
  viewer.setNotebookSaveBusy(true, { clarify: true }); switchLocale();
  check(save.disabled && clarify.disabled && clarify.textContent === 'Aclarando...', 'Pending clarification status stays translated without triggering an agent');
  viewer.setNotebookSaveBusy(false);
  check(!save.disabled && !clarify.disabled && clarify.textContent === 'Aclarar y guardar', 'Save controls restore their translated idle state');
  toolbar.remove();

  // Workflow variants in the same dialog retain names and routing values.
  notebook.openExperimentDialog({ projectId: project.id, kind: 'workflow' }); await settle();
  check(byId('biology-notebook-experiment-start-btn').textContent === 'Iniciar proceso', 'Workflow experiment mode translates its distinct start action');
  const template = byId('biology-notebook-experiment-workflow'); const processName = byId('biology-notebook-experiment-process-name');
  change(processName, 'Draft process <&>'); processName.focus();
  const templateOptions = [...template.options].map(option => option.value); switchLocale();
  check(processName.value === 'Draft process <&>' && JSON.stringify([...template.options].map(option => option.value)) === JSON.stringify(templateOptions), 'Workflow setup keeps typed names and canonical template values');
  byId('biology-notebook-experiment-cancel-btn').click();

  core.navigationShell.showView('home-view'); home.render();
  const homeList = byId('dashboard-notebook-page-list');
  const homeRow = homeList.querySelector('[data-dashboard-notebook-entry="' + entry.id + '"]');
  check(homeRow && homeRow.getAttribute('aria-label').includes('Añadir una nota'), 'Home notebook page actions translate');
  homeRow.click(); await settle();
  const quickNote = homeList.querySelector('[data-dashboard-notebook-note-input]');
  change(quickNote, 'Quick note draft <&>'); quickNote.focus(); quickNote.setSelectionRange(1, 8);
  const homeBefore = JSON.stringify(core.state.notebookEntries); switchLocale();
  check(homeList.querySelector('[data-dashboard-notebook-note-input]') === quickNote && quickNote.value === 'Quick note draft <&>'
    && quickNote.selectionStart === 1 && document.activeElement === quickNote && JSON.stringify(core.state.notebookEntries) === homeBefore, 'Home note editing preserves text, focus and state on language changes');
  check(quickNote.placeholder === 'Añade una nota breve a esta página…' && quickNote.getAttribute('aria-label') === 'Nota de User protocol <&>', 'Home editor attributes escape user names once and translate');
  submit(homeList.querySelector('[data-dashboard-notebook-note-form]'));
  check(core.state.notebookEntries.find(item => item.id === entry.id).result.includes('Quick note draft <&>'), 'Home note save appends the original text in Spanish');
  check(homeList.textContent.includes('ahora') && homeList.textContent.includes('página'), 'Home relative time and plural page counts translate');
  homeList.querySelector('[data-dashboard-notebook-entry="' + entry.id + '"]').click(); await settle();
  change(homeList.querySelector('[data-dashboard-notebook-note-input]'), 'Discard this draft');
  homeList.querySelector('[data-dashboard-notebook-note-cancel]').click();
  check(!core.state.notebookEntries.find(item => item.id === entry.id).result.includes('Discard this draft'), 'Translated Home cancel leaves the notebook unchanged');
  window.qaI18nNotebook = { entryId: entry.id, projectId: project.id };
}
