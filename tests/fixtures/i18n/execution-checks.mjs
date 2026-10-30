// Exercises the real Workflow execution UI in the isolated Electron host.
export async function checkLocalizedExecution({ core, i18n, check }) {
  const { createWorkflowModel, getBlockType } = await import('../../../src/renderer/modules/workflow/model.js');
  const { createWorkflowRenderer } = await import('../../../src/renderer/modules/workflow/renderer.js');
  const { createWorkflowArtifactStorage } = await import('../../../src/renderer/modules/workflow/artifact-storage.js');
  const { showTransientNotice } = await import('../../../src/renderer/lib/notify.js');
  const { escapeHtml } = await import('../../../src/renderer/lib/html.js');
  const byId = id => document.getElementById(id);
  const board = () => byId('workflow-execution-board');
  const workflows = core.moduleRuntime.modules.workflowManagement;
  const settle = () => new Promise(resolve => setTimeout(resolve, 30));
  const waitFor = async condition => {
    for (let n = 0; n < 100; n++) { if (condition()) return; await settle(); }
    throw new Error('Workflow execution fixture did not settle');
  };
  core.navigationShell.showView('workflow-management-view');
  i18n.setLocale('en');
  let nextId = 0;
  const model = createWorkflowModel({ createId: () => `i18n-execution-${++nextId}` });
  const protocol = { id: 'i18n-execution-protocol', name: 'User protocol <&>',
    steps: [{ id: 'instruction', text: 'Add sample volume', placeholders: [{ id: 'volume', name: 'Sample volume <&>' }] }] };
  core.state.protocols.push(protocol);
  const template = model.normalizeTemplate({ id: 'i18n-execution-template', name: 'Execution template <&>',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    blocks: [
      { id: 'main-a', type: 'protocol', protocolId: protocol.id, x: 40, y: 40 },
      { id: 'main-b', type: 'text', text: 'Record yield <&>', x: 300, y: 40 },
      { id: 'branch-c', type: 'text', text: 'Optional check <&>', x: 300, y: 220 }
    ], links: [{ fromBlockId: 'main-a', toBlockId: 'main-b' }, { fromBlockId: 'main-a', toBlockId: 'branch-c' }] });
  core.state.workflowTemplates.push(template);
  const workflow = workflows.createProcess({ templateId: template.id, workflowName: 'Execution run <&>', projectId: 'i18n-project' });
  const id = workflow.id;
  const current = () => core.state.workflows.find(item => item.id === id);
  const first = workflow.blocks.find(block => block.protocolId === protocol.id).id;
  const second = workflow.blocks.find(block => block.text === 'Record yield <&>').id;
  const branch = workflow.blocks.find(block => block.text === 'Optional check <&>').id;
  const entry = () => current().entries[0];
  const stateFor = blockId => entry().stepStates[blockId];
  const stepButton = (status, blockId) => board().querySelector(`[data-workflow-step-status="${status}"][data-workflow-block-id="${blockId}"]`);
  const resultInput = blockId => board().querySelector(`[data-workflow-step-result-field="${blockId}"]`);
  const valueInput = () => board().querySelector(`[data-workflow-step-value="volume"][data-workflow-block-id="${first}"]`);
  const fileInput = () => board().querySelector(`[data-workflow-step-files="${first}"]`);
  const chooseFile = (input, name) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['test content'], name, { type: 'text/plain' }));
    input.files = transfer.files;
    return input.files[0];
  };
  workflows.openProcess(id);
  check(board().querySelector('th').textContent === 'Process', 'Execution table retains English by default');
  check(board().querySelector(`[data-workflow-step-open="${second}"]`).disabled, 'Later workflow steps start locked');
  for (const element of board().querySelectorAll('[data-i18n]')) {
    const params = JSON.parse(element.getAttribute('data-i18n-params') || '{}');
    check(i18n.has(element.dataset.i18n) && element.textContent === i18n.t(element.dataset.i18n, params), 'English execution label parity: ' + element.dataset.i18n);
  }
  i18n.setLocale('es');
  check(board().querySelector('th').textContent === 'Proceso' && board().textContent.includes('Sin iniciar'), 'Execution table headers and run status translate');
  check(board().querySelector(`[data-workflow-step-open="${second}"]`).title.includes('Bloqueado'), 'Locked step hints translate');
  check(valueInput().placeholder === 'Introduce un valor' && valueInput().getAttribute('aria-label') === 'Sample volume <&>', 'Protocol input placeholders translate while user field names remain literal');

  const volume = valueInput();
  const observations = resultInput(first);
  const selectedFileInput = fileInput();
  volume.value = '10 uL';
  observations.value = 'Observación sin guardar <&>';
  observations.focus(); observations.setSelectionRange(2, 10);
  const staged = chooseFile(selectedFileInput, 'staged<&>.txt');
  const beforeLocale = JSON.stringify(current());
  const drawer = board().querySelector('.workflow-drawer');
  i18n.setLocale('en'); i18n.setLocale('es');
  check(valueInput() === volume && resultInput(first) === observations && board().querySelector('.workflow-drawer') === drawer, 'Language changes do not rebuild the execution drawer or inputs');
  check(document.activeElement === observations && observations.selectionStart === 2 && observations.selectionEnd === 10
    && observations.value === 'Observación sin guardar <&>' && volume.value === '10 uL', 'Active result drafts, selection, and numeric protocol values are preserved');
  check(fileInput() === selectedFileInput && fileInput().files[0] === staged, 'A staged file selection survives language changes');
  check(JSON.stringify(current()) === beforeLocale, 'Language changes never persist unsubmitted execution edits');
  volume.dispatchEvent(new Event('change', { bubbles: true }));
  const savedObservations = resultInput(first);
  savedObservations.value = 'Saved observations <&>';
  savedObservations.dispatchEvent(new Event('change', { bubbles: true }));
  check(stateFor(first).values.volume === '10 uL' && stateFor(first).result === 'Saved observations <&>', 'Execution fields still save normally in Spanish');

  // The stable title API is used by filesystem paths and saved notebook data;
  // display titles can localize independently, including missing protocols.
  const stableRenderer = createWorkflowRenderer({ state: core.state, getBlockType, safeText: escapeHtml });
  const storage = createWorkflowArtifactStorage({ state: core.state, renderer: stableRenderer,
    getTemplateById: templateId => core.state.workflowTemplates.find(item => item.id === templateId) });
  const missing = { id: 'missing-protocol-block', type: 'protocol', protocolId: 'missing-protocol' };
  const empty = { id: 'empty-text-block', type: 'text', text: '' };
  i18n.setLocale('en');
  const missingPath = storage.buildWorkflowStepResultsFolderPath(current(), entry(), missing);
  const emptyPath = storage.buildWorkflowStepResultsFolderPath(current(), entry(), empty);
  i18n.setLocale('es');
  check(storage.buildWorkflowStepResultsFolderPath(current(), entry(), missing) === missingPath
    && storage.buildWorkflowStepResultsFolderPath(current(), entry(), empty) === emptyPath, 'Missing/empty step fallback folder names are locale independent');
  check(stableRenderer.titleForBlock(missing) === 'Missing protocol (missing-protocol)'
    && stableRenderer.displayTitleForBlock(missing) === 'Protocolo no encontrado (missing-protocol)', 'Persistence and display title APIs remain separate');

  const oldStore = window.hikariApi.storeImportedFile;
  const imports = [];
  window.hikariApi.storeImportedFile = async payload => {
    imports.push(payload);
    return { ok: true, fileName: payload.fileName, filePath: `${payload.targetFolder}/${payload.fileName}`, relativePath: `fixture/${payload.fileName}` };
  };
  let input = fileInput(); chooseFile(input, 'data<&>.txt'); input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => stateFor(first).resultFiles.includes('data<&>.txt'));
  check(imports.length === 1 && stateFor(first).resultFileRecords[0].name === 'data<&>.txt', 'Translated file controls still import through the real workflow action');
  check(board().querySelector('.workflow-drawer-files').getAttribute('aria-label') === 'Archivos adjuntos'
    && board().querySelector('.workflow-drawer-files').textContent.includes('data<&>.txt'), 'Attached filenames are preserved and their UI label translates');

  window.hikariApi.storeImportedFile = async () => ({ ok: false });
  input = fileInput(); chooseFile(input, 'failed<&>.txt'); input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => document.querySelector('[data-hikari-transient-toast]')?.dataset.i18n === 'workflow.file.storeFailed');
  let notice = document.querySelector('[data-hikari-transient-toast]');
  check(notice.textContent === 'No se pudo guardar failed<&>.txt.' && !notice.querySelector('img'), 'Local file errors translate with literal user filenames');
  i18n.setLocale('en');
  check(notice.textContent === 'Failed to store failed<&>.txt.', 'An active localized error notice changes language');
  notice.remove();
  window.hikariApi.storeImportedFile = async () => ({ ok: false, error: 'Backend <&> exact failure' });
  input = fileInput(); chooseFile(input, 'backend.txt'); input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => document.querySelector('[data-hikari-transient-toast]')?.textContent === 'Backend <&> exact failure');
  notice = document.querySelector('[data-hikari-transient-toast]');
  i18n.setLocale('es');
  check(notice.textContent === 'Backend <&> exact failure' && !notice.hasAttribute('data-i18n'), 'Backend errors remain verbatim and have no stale translation binding');
  notice.remove();
  delete window.hikariApi.storeImportedFile;
  input = fileInput(); chooseFile(input, 'unavailable.txt'); input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => document.querySelector('[data-hikari-transient-toast]')?.dataset.i18n === 'workflow.file.apiUnavailable');
  notice = document.querySelector('[data-hikari-transient-toast]');
  check(notice.textContent.includes('API de almacenamiento'), 'Unavailable storage errors are localized');
  i18n.setLocale('en');
  showTransientNotice('Imported file storage API is unavailable.', { type: 'error' });
  check(!notice.hasAttribute('data-i18n'), 'An identical plain notice clears the earlier translation binding');
  i18n.setLocale('es');
  check(notice.textContent === 'Imported file storage API is unavailable.', 'Other modules retain ownership of subsequent plain notices');
  notice.remove();
  if (oldStore === undefined) delete window.hikariApi.storeImportedFile;
  else window.hikariApi.storeImportedFile = oldStore;

  stepButton('completed', first).querySelector('[data-i18n]').click();
  check(stateFor(first).status === 'completed' && !board().querySelector(`[data-workflow-step-open="${second}"]`).disabled, 'Completing a Spanish step unlocks its successor');
  check(board().querySelector(`[data-workflow-step-open="${second}"]`).title.includes('Pendiente'), 'Newly rendered execution hints use Spanish');
  const date = board().querySelector('[data-i18n-date]');
  check(date && date.textContent === i18n.formatDate(new Date(date.dataset.i18nDate), JSON.parse(date.dataset.i18nDateOptions)), 'Execution dates use the active language');
  i18n.setLocale('en');
  check(date.textContent === date.dataset.i18nDateFallback, 'Returning to English restores the exact original date format');
  i18n.setLocale('es');
  stepButton('failed', second).querySelector('[data-i18n]').click();
  check(stateFor(second).status === 'failed' && stepButton('pending', second).textContent === 'Reintentar', 'Failed-step controls and retry labels translate');
  stepButton('pending', second).querySelector('[data-i18n]').click();
  check(stateFor(second).status === 'pending', 'Retry retains the canonical pending status ID');
  const activate = board().querySelector(`[data-workflow-branch-toggle="${branch}"]`);
  check(activate.textContent === 'Activar' && board().textContent.includes('Rama opcional'), 'Optional branch guidance translates');
  activate.click();
  check(entry().activeBranchRootIds.includes(branch), 'Branch activation still records the canonical root ID');
  const skip = board().querySelector(`[data-workflow-branch-toggle="${branch}"]`);
  check(skip.textContent === 'Omitir rama', 'The active branch action translates');
  i18n.setLocale('en'); i18n.setLocale('es');
  check(skip.isConnected && entry().activeBranchRootIds.includes(branch), 'An active branch survives locale changes without replacing controls');
  skip.click();
  check(!entry().activeBranchRootIds.includes(branch), 'Skipping an untouched branch works normally');
  stepButton('not_done', first).querySelector('[data-i18n]').click();
  check(stateFor(first).status === 'not_done' && board().querySelector(`[data-workflow-step-open="${second}"]`).disabled, 'Reopening a completed step restores locking');
  stepButton('completed', first).querySelector('[data-i18n]').click();
  stepButton('completed', second).querySelector('[data-i18n]').click();
  check(stateFor(first).status === 'completed' && stateFor(second).status === 'completed' && board().textContent.includes('Completado'), 'Completing the run renders the Spanish done state');
  const finalState = JSON.stringify(core.state.workflows);
  await settle(); workflows.history.undo(); await settle();
  check(JSON.stringify(core.state.workflows) !== finalState, 'Execution status changes remain undoable');
  workflows.history.redo(); await settle();
  check(JSON.stringify(core.state.workflows) === finalState, 'Execution redo restores statuses, values, and attached-file metadata');
  const notebook = core.state.notebookEntries.find(record => record.workflowContext?.workflowId === id
    && record.protocolId === protocol.id && record.notebookState === 'executed');
  workflows.renderNotebookOptions();
  const notebooks = byId('workflow-notebook-pages');
  const selectedNotebook = [...notebooks.options].find(option => option.value === notebook.id);
  selectedNotebook.selected = true;
  i18n.setLocale('en');
  check(selectedNotebook.textContent.startsWith('Biology | Executed | User protocol <&>'), 'Notebook option metadata retains its original English and literal protocol name');
  i18n.setLocale('es');
  check(selectedNotebook.textContent.startsWith('Biología | Ejecutado | User protocol <&>')
    && selectedNotebook.selected && [...notebooks.options].includes(selectedNotebook), 'Notebook option metadata translates without replacing selected options or record IDs');
  check(board().querySelector('.workflow-ledger-updated').textContent === 'hoy', 'Relative update times translate');
  workflows.openProcess(id);
  return { workflowId: id, firstBlockId: first, secondBlockId: second, branchBlockId: branch };
}
