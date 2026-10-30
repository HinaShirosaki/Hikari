// Real Protocols UI with isolated state and deterministic agent/LLM stubs.
// No network request, export, or user workspace operation is performed.
export async function checkLocalizedProtocols({ core, i18n, check }) {
  const byId = id => document.getElementById(id);
  const protocol = core.moduleRuntime.modules.protocol;
  const root = byId('protocol-management-view');
  const settle = () => new Promise(resolve => setTimeout(resolve, 25));
  const waitFor = async condition => {
    for (let n = 0; n < 120; n++) { if (condition()) return; await settle(); }
    throw new Error('Protocol i18n fixture did not settle');
  };
  const switchLocale = () => { i18n.setLocale('en'); i18n.setLocale('es'); };
  const input = (id, value) => { const node = byId(id); node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); return node; };
  const create = () => byId('create-protocol-btn').click();
  const save = () => byId('protocol-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  const hideNotice = () => { const toast = document.querySelector('[data-hikari-transient-toast]'); if (toast) toast.hidden = true; };
  const assertBindings = container => {
    for (const node of container.querySelectorAll('[data-i18n]')) {
      if (node.children.length) continue;
      const params = JSON.parse(node.getAttribute('data-i18n-params') || '{}');
      check(i18n.has(node.dataset.i18n) && node.textContent === i18n.t(node.dataset.i18n, params), 'Protocol label binding: ' + node.dataset.i18n);
    }
  };
  core.navigationShell.showView('protocol-management-view');
  i18n.setLocale('en');
  assertBindings(root);
  create();
  check(byId('protocol-editor-heading').textContent === 'Create Protocol', 'Protocol creation retains its English default');
  const name = input('protocol-name', 'User protocol name <&>');
  input('protocol-purpose', 'User purpose <&>');
  input('protocol-materials', 'Buffer <&>\nSample B');
  const steps = input('protocol-steps', 'Transfer sample [time].');
  input('protocol-troubleshooting', 'Keep this scientific note <&>');
  steps.focus(); steps.setSelectionRange(0, 0);
  const volume = root.querySelector('[data-protocol-placeholder-preset="volume"]');
  const canonicalPreset = volume.dataset.protocolPlaceholderPreset;
  switchLocale();
  check(byId('protocol-editor-heading').textContent === 'Crear protocolo' && volume.textContent === 'volumen'
    && canonicalPreset === 'volume', 'Protocol headings and parameter display labels translate independently from tokens');
  volume.click();
  check(steps.value.includes('[volume]') && !steps.value.includes('[volumen]'), 'Translated parameter preset inserts the original canonical placeholder name');
  steps.focus(); steps.setSelectionRange(2, 11);
  const stateBefore = JSON.stringify(core.state);
  const editor = byId('protocol-form'); const draft = steps.value;
  switchLocale();
  check(byId('protocol-form') === editor && byId('protocol-steps') === steps && steps.value === draft
    && document.activeElement === steps && steps.selectionStart === 2 && steps.selectionEnd === 11, 'Protocol translation preserves draft controls, focus and selection');
  check(name.value === 'User protocol name <&>' && JSON.stringify(core.state) === stateBefore
    && protocol.hasUnsavedChanges(), 'Protocol locale switching neither changes nor saves user content');
  const notebookNotes = byId('biology-notebook-result');
  const notebookDraft = notebookNotes.value;
  notebookNotes.value = 'Independent notebook draft <&>';
  notebookNotes.dispatchEvent(new Event('input', { bubbles: true }));
  save();
  const saved = core.state.protocols.find(item => item.name === 'User protocol name <&>');
  check(saved && saved.purpose === 'User purpose <&>' && saved.materials[0] === 'Buffer <&>'
    && saved.troubleshooting === 'Keep this scientific note <&>', 'Protocol save preserves literal names and scientific text in Spanish');
  check(saved.steps.flatMap(step => step.placeholders).some(item => item.name === 'volume'), 'Saved placeholder names remain canonical');
  check(notebookNotes.value === 'Independent notebook draft <&>', 'Protocol saves preserve a different module’s unsaved notebook text');
  check(byId('protocol-view-title').textContent === saved.name && !byId('protocol-view-title').hasAttribute('data-i18n')
    && !byId('protocol-view-content').querySelector('img'), 'Saved protocol titles remain literal and escaped');
  check(byId('protocol-view-content').textContent.includes('Objetivo') && byId('protocol-view-content').textContent.includes('User purpose <&>'), 'Protocol previews translate headings while retaining content');
  const savedSteps = JSON.stringify(saved.steps);
  const search = input('protocol-search', 'NO_MATCH_I18N');
  check(byId('protocol-list').textContent.includes('No hay protocolos coincidentes.'), 'Protocol library search empty state translates');
  input('protocol-search', 'User protocol name'); search.focus(); search.setSelectionRange(1, 6);
  const row = byId('protocol-list').querySelector('[data-protocol-select="' + saved.id + '"]');
  switchLocale();
  check(row.isConnected && byId('protocol-search') === search && search.value === 'User protocol name'
    && document.activeElement === search && search.selectionStart === 1, 'Search results and typed queries survive language changes');
  check(row.textContent.includes('Actualizado') && row.querySelector('[data-i18n-date]'), 'Protocol library dates and update labels translate');
  row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  check(!byId('protocol-view-panel').hidden && byId('protocol-view-title').textContent === saved.name, 'Keyboard navigation still opens the original protocol');
  byId('protocol-list').querySelector('[data-protocol-menu-trigger="' + saved.id + '"]').click();
  const menu = byId('protocol-list').querySelector('.protocol-action-menu'); const edit = menu.querySelector('[data-protocol-action="edit"]');
  edit.focus(); switchLocale();
  check(menu.isConnected && document.activeElement === edit && edit.textContent === 'Editar', 'Open protocol menus retain their controls and focus when translating');
  edit.click();
  check(byId('protocol-editor-heading').textContent === 'Editar protocolo', 'Edit mode has its own translated heading');
  input('protocol-name', 'Renamed protocol <&>'); save();
  check(core.state.protocols.find(item => item.id === saved.id).name === 'Renamed protocol <&>'
    && JSON.stringify(core.state.protocols.find(item => item.id === saved.id).steps) === savedSteps, 'Editing in Spanish preserves existing placeholder IDs');
  check(protocol.history.undo() && core.state.protocols.find(item => item.id === saved.id).name === saved.name, 'Protocol undo restores the original saved record');
  check(protocol.history.redo() && core.state.protocols.find(item => item.id === saved.id).name === 'Renamed protocol <&>', 'Protocol redo restores the edit');
  check(notebookNotes.value === 'Independent notebook draft <&>', 'Protocol history keeps independent notebook drafts intact');
  notebookNotes.value = notebookDraft;

  i18n.setLocale('es'); input('protocol-search', ''); create();
  input('protocol-name', 'Unsubmitted draft behind import');
  byId('open-protocol-json-import-btn').click();
  byId('import-protocol-json-btn').click();
  await waitFor(() => byId('protocol-json-import-status').classList.contains('is-error'));
  check(byId('protocol-json-import-status').textContent === 'Primero pega el JSON del protocolo o elige un archivo JSON.', 'Empty JSON imports show translated validation');
  switchLocale(); check(byId('protocol-json-import-status').textContent.startsWith('Primero pega'), 'Active import validation stays bound'); hideNotice();
  const paste = input('protocol-json-import-input', '{invalid'); paste.focus(); paste.setSelectionRange(1, 4);
  const beforeImport = JSON.stringify(core.state.protocols); switchLocale();
  check(paste.value === '{invalid' && document.activeElement === paste && paste.selectionStart === 1
    && JSON.stringify(core.state.protocols) === beforeImport, 'JSON text and selection are never translated or imported during a locale change');
  byId('import-protocol-json-btn').click(); await settle();
  check(byId('protocol-json-import-status').textContent.startsWith('JSON de protocolo no válido.'), 'Invalid JSON feedback translates'); hideNotice();
  const apiInvalid = protocol.importProtocolsFromJson('{invalid');
  check(!apiInvalid.ok && apiInvalid.error.startsWith('Invalid protocol JSON payload.'), 'Public import errors retain their existing English API contract');
  input('protocol-json-import-input', '');
  const incoming = { id: 'i18n-import', name: 'Imported protocol <&>', purpose: 'Original imported purpose', steps: [{ text: 'Mix sample <&>', placeholders: [] }] };
  const fileInput = byId('protocol-json-import-file'); const transfer = new DataTransfer();
  transfer.items.add(new File([JSON.stringify({ protocols: [incoming] })], 'protocol<&>.json', { type: 'application/json' }));
  fileInput.files = transfer.files; const staged = fileInput.files[0]; switchLocale();
  check(fileInput.files[0] === staged && byId('protocol-name').value === 'Unsubmitted draft behind import', 'Import file selection and the underlying editor draft survive translation');
  byId('import-protocol-json-btn').click(); await waitFor(() => byId('protocol-json-import-overlay').hidden);
  check(core.state.protocols.find(item => item.id === incoming.id)?.name === incoming.name
    && byId('protocol-json-import-status').textContent === 'Se importó "Imported protocol <&>".', 'JSON file import preserves field names and displays a translated confirmation');
  const duplicate = protocol.importProtocolsFromJson(JSON.stringify({ protocols: [incoming] }));
  check(duplicate.ok && duplicate.importedProtocols[0].name.includes('(Imported Copy)'), 'Imported-copy names retain their canonical stored suffix');

  // Generation uses the same real controls with a deferred local API stub.
  let generatedRequest; let resolveGeneration; let generationCalls = 0;
  window.qaProtocolAgent = payload => { generationCalls++; generatedRequest = payload; return new Promise(resolve => { resolveGeneration = resolve; }); };
  create(); byId('protocol-generate-btn').click();
  byId('protocol-generate-send-btn').click();
  check(byId('protocol-generate-input-status').textContent.startsWith('Añade instrucciones'), 'Generation validates an empty composer without requesting an agent');
  check(generationCalls === 0, 'Empty generation validation performs no request'); hideNotice();
  const prompt = input('protocol-generate-prompt-input', 'User instruction <&> — keep literal');
  const attachmentInput = byId('protocol-generate-attachment-input'); const files = new DataTransfer();
  files.items.add(new File(['Reference notes'], 'reference<&>.txt', { type: 'text/plain' }));
  attachmentInput.files = files.files; attachmentInput.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => byId('protocol-generate-attachment-list').querySelector('[data-protocol-generate-remove-attachment]'));
  const pill = byId('protocol-generate-attachment-list').firstElementChild;
  prompt.focus(); prompt.setSelectionRange(2, 10); switchLocale();
  check(prompt.value.includes('User instruction') && prompt.selectionStart === 2 && document.activeElement === prompt
    && pill.isConnected && attachmentInput.files[0].name === 'reference<&>.txt', 'Generation composer and staged attachments survive translation');
  check(pill.textContent.includes('Archivo') && pill.querySelector('button').getAttribute('aria-label') === 'Eliminar reference<&>.txt'
    && byId('protocol-generate-input-status').textContent === '1 archivo adjunto listo.', 'Attachment type, remove labels and ready counts translate');
  byId('protocol-generate-send-btn').click();
  const loading = byId('protocol-generate-result-preview').firstElementChild; switchLocale();
  check(generationCalls === 1 && byId('protocol-generate-send-btn').disabled && byId('protocol-generate-send-btn').textContent === 'Generando...'
    && loading.isConnected && loading.textContent.includes('El agente está investigando'), 'Generation progress translates without restarting or replacing the pending request');
  check(generatedRequest.message.includes(prompt.value) && generatedRequest.attachments[0].name === 'reference<&>.txt'
    && generatedRequest.attachments[0].kind === 'file' && generatedRequest.attachments[0].dataUrl.startsWith('data:text/plain;base64,'), 'Agent request keys, prompt and attachment data stay canonical');
  const generated = { name: 'Generated name <&>', purpose: 'Generated purpose <&>', materials: ['Buffer A'], steps: [{ text: 'Transfer sample [volume]', placeholders: [] }] };
  resolveGeneration({ ok: true, protocol: generated });
  await waitFor(() => !byId('protocol-generate-apply-btn').disabled);
  check(byId('protocol-generate-result-preview').textContent.includes('Protocolo · Borrador')
    && !core.state.protocols.some(item => item.name === generated.name), 'Generated reviews translate while remaining unsaved');
  byId('protocol-generate-apply-btn').click();
  check(byId('protocol-name').value === generated.name && protocol.hasUnsavedChanges(), 'Apply generated protocol fills a draft without persisting it');
  save();
  const generatedSaved = core.state.protocols.find(item => item.name === generated.name);
  check(Boolean(generatedSaved), 'Generated protocol still saves through the regular form in Spanish');

  create(); byId('protocol-generate-btn').click(); input('protocol-generate-prompt-input', 'Backend error fixture');
  window.qaProtocolAgent = async () => ({ ok: false, error: 'Backend detail <&>' });
  byId('protocol-generate-send-btn').click();
  await waitFor(() => byId('protocol-generate-status').dataset.state === 'error');
  switchLocale();
  check(byId('protocol-generate-status').textContent === 'Backend detail <&>' && !byId('protocol-generate-status').hasAttribute('data-i18n')
    && byId('protocol-generate-result-preview').textContent.includes('Backend detail <&>'), 'Backend generation errors stay verbatim and clear older bindings'); hideNotice();
  byId('protocol-generate-result-close-btn').click();
  byId('protocol-generate-btn').click(); input('protocol-generate-prompt-input', 'Late response fixture');
  window.qaProtocolAgent = () => new Promise(resolve => { resolveGeneration = resolve; });
  byId('protocol-generate-send-btn').click(); byId('protocol-generate-result-close-btn').click();
  const beforeLateReply = byId('protocol-name').value; switchLocale();
  resolveGeneration({ ok: true, protocol: generated }); await settle();
  check(byId('protocol-generate-result-overlay').hidden && byId('protocol-name').value === beforeLateReply, 'Closing a translated generation dialog still discards stale responses');

  // Polish stubs are installed only after Notebook checks so they cannot trigger naming.
  const previousDirect = window.hikariApi.runDirectLlmPrompt;
  let polishRequest; let resolvePolish; let polishCalls = 0;
  window.hikariApi.runDirectLlmPrompt = payload => { polishCalls++; polishRequest = payload; return new Promise(resolve => { resolvePolish = resolve; }); };
  try {
    create(); byId('protocol-polish-btn').click();
    check(byId('protocol-polish-status').textContent.startsWith('Primero añade contenido') && polishCalls === 0, 'Empty polish validation translates without an LLM request'); hideNotice();
    byId('protocol-polish-close-btn').click();
    input('protocol-name', 'Original polish draft <&>'); input('protocol-purpose', 'Original purpose <&>'); input('protocol-steps', 'Mix [volume]');
    byId('protocol-polish-btn').click(); const originalPreview = byId('protocol-polish-original-preview'); switchLocale();
    check(polishCalls === 1 && byId('protocol-polish-btn').disabled && byId('protocol-polish-btn').textContent === 'Mejorando...'
      && originalPreview.textContent.includes('Original polish draft <&>') && byId('protocol-polish-status').textContent.startsWith('Generando una versión mejorada'), 'Polish progress and source previews translate without changing the source draft');
    check(polishRequest.moduleId === 'protocol' && polishRequest.task === 'protocol-polish'
      && polishRequest.prompt.includes('Original polish draft <&>'), 'Polish routing and actual prompt content remain unchanged');
    const polished = { ...generated, name: 'Polished name <&>' };
    resolvePolish({ ok: true, text: JSON.stringify(polished) });
    await waitFor(() => !byId('protocol-polish-apply-btn').disabled);
    check(byId('protocol-polish-result-preview').textContent.includes('Objetivo')
      && !core.state.protocols.some(item => item.name === polished.name), 'Polished review copy translates and remains unsaved');
    byId('protocol-polish-apply-btn').click();
    check(byId('protocol-name').value === polished.name && protocol.hasUnsavedChanges(), 'Applying polished output preserves the normal unsaved draft workflow');
    save();
    check(core.state.protocols.some(item => item.name === polished.name), 'Polished protocols still save through the regular form');
  } finally { window.hikariApi.runDirectLlmPrompt = previousDirect; }

  // The deletion fixture is unreferenced, so no other module’s records are involved.
  input('protocol-search', ''); protocol.renderList();
  const importedRow = byId('protocol-list').querySelector('[data-protocol-select="' + incoming.id + '"]');
  importedRow.querySelector('[data-protocol-delete]').click();
  check(!core.state.protocols.some(item => item.id === incoming.id), 'Translated delete still removes the selected protocol');
  check(protocol.history.undo() && core.state.protocols.some(item => item.id === incoming.id), 'Protocol delete remains undoable');
  i18n.setLocale('es');
  window.qaI18nProtocol = { savedId: saved.id, generatedId: generatedSaved.id, importedId: incoming.id,
    preparePolishCapture: async () => {
      create(); input('protocol-name', 'Example protocol'); input('protocol-purpose', 'Compare the original draft'); input('protocol-steps', 'Mix [volume] of sample');
      const previous = window.hikariApi.runDirectLlmPrompt;
      try {
        window.hikariApi.runDirectLlmPrompt = async () => ({ ok: true, text: JSON.stringify({ ...generated, name: 'Reviewed protocol' }) });
        byId('protocol-polish-btn').click();
        await waitFor(() => !byId('protocol-polish-apply-btn').disabled);
      } finally { window.hikariApi.runDirectLlmPrompt = previous; }
    }
  };
  hideNotice();
  assertBindings(root);
}
