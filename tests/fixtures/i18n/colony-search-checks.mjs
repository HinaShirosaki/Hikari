// Real search/lazy Colony UI; generated images and a deterministic model stub.
export async function checkLocalizedColonyAndSearch({ core, i18n, check }) {
  const { i18n: translator } = await import('../../../src/renderer/lib/i18n/index.js');
  const { bindToolMessage, toolDisplayText, toolError } = await import('../../../src/renderer/modules/tool-box/localization.js');
  const { createMaskAndModelCount } = await import('../../../src/renderer/modules/tool-box/colony-counter/mask-and-model.js');
  const { createColonyControlState } = await import('../../../src/renderer/modules/tool-box/colony-counter/control-state.js');
  const { colonySummaryMarkup } = await import('../../../src/renderer/modules/tool-box/colony-counter/summary.js');
  const { searchCandidateMarkup, createSearchFeedback } = await import('../../../src/renderer/app/topbar-search/localization.js');
  const byId = id => document.getElementById(id);
  const settle = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async predicate => { for (let n = 0; n < 160; n++) { if (predicate()) return; await settle(); } throw new Error('Colony/search UI did not settle: ' + JSON.stringify({ status: byId('colony-status').textContent, width: byId('colony-source-canvas').width, disabled: byId('colony-auto-count-btn').disabled })); };
  const hideNotice = () => { const notice = document.querySelector('[data-hikari-transient-toast]'); if (notice) notice.hidden = true; };
  const search = byId('topbar-search'); const suggestions = byId('topbar-search-suggestions');
  const controller = core.topbarSearchController;
  const chemicalSearchDraft = byId('chemical-search').value;
  const querySearch = text => { if (!search.closest('.topbar-search-shell').classList.contains('is-expanded')) byId('topbar-search-toggle').click(); search.value = text; search.dispatchEvent(new Event('input', { bubbles: true })); };

  i18n.setLocale('en'); core.navigationShell.showView('home-view');
  const searchName = 'QA Search <&>';
  core.state.labInventory.chemicals.push({ id: 'qa-search-chemical', name: searchName, casNumber: 'QA-CAS', location: 'Rack <&>' });
  core.state.samples.push({ id: 'qa-search-sample', name: searchName, code: 'QA-SEARCH', type: 'plasmid' });
  const canonical = controller.getSearchSuggestions('QA Search', { limit: 20 });
  const schema = JSON.stringify(canonical); const stateBefore = JSON.stringify(core.state);
  querySearch('QA Search'); search.focus(); search.setSelectionRange(3, 7);
  check(suggestions.textContent.includes('Chemical') && suggestions.textContent.includes('Sample'), 'Search initially renders canonical English record kinds');
  const rows = [...suggestions.children]; const selectedId = search.getAttribute('aria-activedescendant');
  i18n.setLocale('es');
  check(suggestions.textContent.includes('Sustancia química') && suggestions.textContent.includes('Muestra') && suggestions.textContent.includes(searchName)
    && !suggestions.querySelector('img'), 'Search translates record badges while names and sublabels remain escaped literal data');
  check(rows.every(node => node.isConnected) && search.getAttribute('aria-activedescendant') === selectedId && document.activeElement === search
    && search.value === 'QA Search' && search.selectionStart === 3 && search.selectionEnd === 7, 'An open search keeps result nodes, keyboard selection, focus and typed query');
  check(JSON.stringify(controller.getSearchSuggestions('QA Search', { limit: 20 })) === schema && JSON.stringify(core.state) === stateBefore,
    'Language changes preserve candidate kinds, IDs, query payloads, ranking, deduplication and data');
  search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  const active = suggestions.querySelector('[aria-selected="true"]');
  const candidate = canonical[Number(active.dataset.index)];
  search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await settle();
  check(document.body.dataset.activeView === candidate.target.viewId, 'Translated search results still route through their canonical kind handler');

  querySearch('tools');
  check(suggestions.textContent.includes('Herramientas') && suggestions.textContent.includes('Módulo'), 'Module suggestions translate their visible label, subtitle and kind');
  const moduleResult = controller.getSearchSuggestions('tools').find(item => item.kind === 'Module');
  check(moduleResult?.label === 'Tools' && moduleResult.target.viewId === 'tool-box-view', 'Localized module display preserves its canonical search API');
  const custom = { ...moduleResult, label: 'Custom label <&>', sublabel: 'Custom subtitle <&>' };
  const display = searchCandidateMarkup(custom); const customHost = document.createElement('div'); customHost.innerHTML = display.label + display.sublabel;
  check(customHost.textContent === 'Custom label <&>Custom subtitle <&>' && !customHost.querySelector('img'), 'Custom module labels/subtitles override translated defaults safely');
  search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  i18n.setLocale('en'); controller.executeTopbarSearch('chemicals: QA-CAS');
  check(search.title === 'Opened Chemicals and searched for "QA-CAS".', 'Search feedback retains exact English wording and query');
  const feedbackState = JSON.stringify(core.state); i18n.setLocale('es');
  check(search.title === 'Se abrió Sustancias químicas y se buscó "QA-CAS".' && JSON.stringify(core.state) === feedbackState,
    'Search feedback translates its target live without rerunning the search');
  const containerFeedback = document.createElement('input');
  createSearchFeedback(containerFeedback)('search.opened', {}, { viewId: 'sample-registry-view', label: 'Containers' });
  check(containerFeedback.title === 'Se abrió Contenedores.', 'Container search feedback translates its separate canonical scope label');
  i18n.setLocale('en'); check(containerFeedback.title === 'Opened Containers.', 'Container scope feedback keeps its English contract'); i18n.setLocale('es');
  controller.executeTopbarSearch(''); check(search.title === 'Escriba una consulta y pulse Intro.', 'Empty-query instruction translates');
  core.navigationShell.showView('home-view'); controller.executeTopbarSearch('zzuniquenothing928374');
  check(search.title.includes('No se encontraron coincidencias') && search.title.includes('assay: palabra'), 'No-match feedback translates while canonical scope aliases stay intact');
  core.state.labInventory.chemicals = core.state.labInventory.chemicals.filter(item => item.id !== 'qa-search-chemical');
  core.state.samples = core.state.samples.filter(item => item.id !== 'qa-search-sample');
  byId('chemical-search').value = chemicalSearchDraft; byId('chemical-search').dispatchEvent(new Event('input', { bubbles: true }));

  core.navigationShell.showView('tool-box-view'); i18n.setLocale('en');
  document.querySelector('[data-tool-view="tool-colony-counter-view"]').click();
  await wait(() => byId('colony-status').textContent === 'Choose or drop an image, then run auto count or click colonies manually.');
  const root = byId('tool-colony-counter-view'); const canvas = byId('colony-preview-canvas'); const source = byId('colony-source-canvas');
  check(byId('colony-auto-count-btn').disabled && byId('colony-start-mask-btn').textContent === 'Draw Mask', 'Lazy Colony tool retains its initial English controls');
  const plate = document.createElement('canvas'); plate.width = 240; plate.height = 180;
  const ctx = plate.getContext('2d'); ctx.fillStyle = '#eeeeee'; ctx.fillRect(0, 0, 240, 180);
  for (const [x, y] of [[40, 40], [180, 130]]) { ctx.fillStyle = '#333333'; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); }
  const blob = await new Promise(resolve => plate.toBlob(resolve, 'image/png'));
  const files = new DataTransfer(); files.items.add(new File([blob], 'Plate <&>.png', { type: 'image/png' }));
  byId('colony-image-file').files = files.files; byId('colony-image-file').dispatchEvent(new Event('change', { bubbles: true }));
  await wait(() => source.width === 240 && !byId('colony-auto-count-btn').disabled);
  const imagePixels = source.toDataURL(); const file = byId('colony-image-file').files[0];
  const pointer = (type, x, y, extra = {}) => {
    const box = canvas.getBoundingClientRect(); canvas.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true,
      clientX: box.left + x / canvas.width * box.width, clientY: box.top + y / canvas.height * box.height, button: 0, ...extra }));
  };
  pointer('click', 40, 40); pointer('click', 180, 130);
  check(byId('colony-status').textContent === 'Count: 2' && byId('colony-summary').textContent.trim() === 'Colonies counted: 2', 'Real image clicks retain the English manual count and summary');
  byId('colony-model-threshold').value = '0.65'; byId('colony-model-threshold').focus();
  const summaryNode = byId('colony-summary').firstElementChild; const canvasPixels = canvas.toDataURL();
  const draftState = JSON.stringify(core.state); i18n.setLocale('es');
  check(root.querySelector('h3').textContent === 'Contador de colonias' && byId('colony-status').textContent === 'Recuento: 2'
    && byId('colony-summary').textContent.trim() === 'Colonias contadas: 2', 'Colony heading, live count and summary translate');
  check(document.activeElement === byId('colony-model-threshold') && byId('colony-model-threshold').value === '0.65'
    && byId('colony-image-file').files[0] === file && canvas.toDataURL() === canvasPixels && source.toDataURL() === imagePixels
    && summaryNode.isConnected && JSON.stringify(core.state) === draftState, 'Language switching preserves the chosen file, input draft/focus, image pixels, markers, nodes and workspace data');
  pointer('click', 40, 40); check(byId('colony-status').textContent.startsWith('Ya existe un marcador'), 'Nearby-marker hint translates without adding a duplicate');
  byId('colony-start-mask-btn').click();
  check(byId('colony-start-mask-btn').textContent === 'Cancelar máscara', 'Active mask drawing control translates');
  const drawingPixels = canvas.toDataURL(); i18n.setLocale('en');
  check(byId('colony-start-mask-btn').textContent === 'Cancel Mask' && canvas.toDataURL() === drawingPixels, 'Language switch preserves an active mask drawing session');
  i18n.setLocale('es'); pointer('mousedown', 20, 20); pointer('mousemove', 90, 90); pointer('mouseup', 90, 90);
  check(byId('colony-status').textContent.startsWith('Máscara aplicada') && byId('colony-summary').textContent.includes('1 de 2 marcadores'), 'Mask application and included-marker plural summary translate');
  i18n.setLocale('en'); check(byId('colony-summary').textContent.includes('1 of 2 markers are inside the active mask.'), 'English mask summary retains its original count basis');
  i18n.setLocale('es'); pointer('click', 180, 130); pointer('click', 180, 130);
  check(byId('colony-status').textContent.startsWith('Ese punto está fuera'), 'Outside-mask hint translates');
  byId('colony-clear-mask-btn').click(); pointer('contextmenu', 180, 130, { button: 2 });
  check(byId('colony-status').textContent === 'Recuento: 1', 'Right-click marker removal retains count behavior');
  byId('colony-counter-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  check(byId('colony-status').textContent === 'Recuento de colonias guardado: 1', 'Manual confirmation status translates');

  byId('colony-crop-menu-btn').click();
  check(!byId('colony-crop-menu').hidden && byId('colony-start-crop-btn').textContent === 'Iniciar recorte', 'Crop menu opens with translated controls');
  byId('colony-start-crop-btn').click(); await wait(() => byId('colony-status').textContent.startsWith('Modo de recorte activo'));
  const cropper = byId('colony-cropper-image').cropper; await settle(80);
  check(Boolean(cropper) && byId('colony-auto-count-btn').disabled, 'Real CropperJS locks model controls while cropping');
  const cropData = JSON.stringify(cropper.getData()); const cropNode = root.querySelector('.cropper-container');
  i18n.setLocale('en');
  check(byId('colony-status').textContent === 'Crop mode active. Apply crop to continue counting.' && cropNode.isConnected
    && JSON.stringify(cropper.getData()) === cropData, 'An open crop session preserves its DOM, geometry and selection during translation');
  i18n.setLocale('es'); byId('colony-cancel-crop-btn').click();
  check(byId('colony-status').textContent === 'Recorte cancelado.' && source.toDataURL() === imagePixels, 'Translated crop cancellation keeps source pixels');

  // Factory uses the same real controls/status path with isolated model state.
  const modelState = { hasImage: true, mask: { kind: 'none' }, markers: [], isModelRunning: false, isDrawingMask: false, zoom: 1 };
  const controls = createColonyControlState({ state: modelState, elements: { colonyAutoCountBtn: byId('colony-auto-count-btn'), colonyStartMaskBtn: byId('colony-start-mask-btn') },
    isCropModeActive: () => false, hasActiveMask: () => false, closeColonyCropMenu() {} });
  let resolveModel; let modelCalls = 0; let modelRequest; let modelFailure = false;
  const model = createMaskAndModelCount({ state: modelState, colonySourceCanvas: source, getModelSettings: () => ({ threshold: 0.65, minDistance: 3 }),
    isCropModeActive: () => false, hasActiveMask: () => false, normalizeMask: value => ({ ...value }), renderPreviewCanvas() {}, renderColonySummary() { byId('colony-summary').innerHTML = colonySummaryMarkup({ count: modelState.markers.length, total: modelState.markers.length, hasMask: false, lastCountSource: modelState.lastCountSource }); },
    setColonyStatus: message => bindToolMessage(byId('colony-status'), message), updateControlState: controls.updateControlState,
    countWithModel: async (image, request) => { modelCalls++; modelRequest = { image, ...request }; if (modelFailure) throw new Error('Backend <&>'); return new Promise(resolve => { resolveModel = resolve; }); } });
  const running = model.runModelCount(); check(byId('colony-status').textContent === 'Cargando el modelo de colonias y contando...' && byId('colony-auto-count-btn').disabled, 'Deferred model run keeps translated busy text and disabled controls');
  const modelPixels = source.toDataURL(); i18n.setLocale('en'); i18n.setLocale('es');
  check(modelCalls === 1 && modelState.isModelRunning && source.toDataURL() === modelPixels, 'Locale updates never repeat model inference or alter its source image');
  resolveModel({ colonies: [{ x: 35, y: 40, score: 0.9 }], maskSource: 'plate-model', detectedPlateMask: { kind: 'circle', x: 0, y: 0, width: 200, height: 160 },
    threshold: 0.65, minDistance: 3, elapsedMs: 5, totalPeaks: 1, plateThreshold: 0.5, plateArea: 500 }); await running;
  check(modelState.markers[0].x === 35 && modelState.markers[0].score === 0.9 && modelState.markers[0].source === 'model'
    && modelState.mask.kind === 'circle' && modelState.lastModelStats.threshold === 0.65 && modelRequest.image === source && !byId('colony-auto-count-btn').disabled,
    'Model completion keeps geometry, scores, settings, detected-mask fields and normal unlock behavior');
  check(byId('colony-summary').textContent === 'Colonias contadas por el modelo: 1', 'Model count summary uses the same translated presentation as the real controller');
  i18n.setLocale('en'); check(byId('colony-summary').textContent === 'Model colonies counted: 1', 'Model count summary retains exact English');
  modelFailure = true; await model.runModelCount(); i18n.setLocale('en');
  check(byId('colony-status').textContent === 'Backend <&>' && !byId('colony-status').hasAttribute('data-i18n'), 'Raw model-provider errors clear any earlier translated binding');
  const localError = toolError('colony.error.read', { path: 'model<&>.onnx' });
  check(localError.message === 'Failed to read model<&>.onnx', 'Local model Error.message remains canonical English');
  i18n.setLocale('es'); check(toolDisplayText(localError) === 'No se pudo leer model<&>.onnx', 'Local model errors carry translated UI metadata around literal paths');
  check(translator.getLocale() === 'es', 'Colony fixture finishes in QA Spanish');
  hideNotice(); byId('colony-reset-btn').click();
  check(byId('colony-auto-count-btn').disabled && !byId('colony-summary').textContent && !byId('colony-image-file').value && source.width === 0, 'Translated reset clears the actual tool normally');
  // Deterministic capture setup reuses the genuine image loader and click handlers.
  window.qaI18nColony = { async prepareCapture() {
    core.navigationShell.showView('tool-box-view'); document.querySelector('[data-tool-view="tool-colony-counter-view"]').click();
    const captureFiles = new DataTransfer(); captureFiles.items.add(file);
    byId('colony-image-file').files = captureFiles.files; byId('colony-image-file').dispatchEvent(new Event('change', { bubbles: true }));
    await wait(() => source.width === 240 && !byId('colony-auto-count-btn').disabled);
    pointer('click', 40, 40); pointer('click', 180, 130); i18n.setLocale('es'); hideNotice();
  } };
}
