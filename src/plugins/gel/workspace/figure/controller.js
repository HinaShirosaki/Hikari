import { decodeImageFile } from '../images/image-io.js';
import { downloadBinaryFile, downloadDataUrlFile, downloadTextFile } from '../export.js';
import { createEmptyManualOverrides, safeFilePart } from '../shared.js';
import { MAX_BLOTS, buildBlotFigurePlan, dragPlacement, inferBlotPlacement, validatePlacement } from './model.js';
import { createBlotFigureCanvas } from './render.js';
import { createBlotFigurePowerPoint } from './powerpoint.js';
import { DRAFT_CONTROL_IDS, parseBlotProject, serializeBlotProject } from './project.js';
import { blotFigureMarkup, blotNavigationMarkup, blotToolsMarkup } from './markup.js';
import { bindFileDropTarget } from '../../lib/file-drop.js';
import { bindGelLayerDrag, renderGelLayers, rowsInStack, STACK_VIEW, startGelNavigationRename } from './layers.js';
import { DEFAULT_STACK_TRIM } from './trim.js';
import { createCanvasTrimEditor } from './trim-editor.js';
import { bindFigureWorkspaceActions } from './workspace-actions.js';
import { createSavedGelNavigation } from './saved-gels.js';
import { normalizeEnhancementSettings } from '../analysis/image-processing.js';
import { createWorkspaceAutosave } from './autosave.js';
import { mergeBlotProject, reconnectProjectRecords } from './project-merge.js';

const clone = value => JSON.parse(JSON.stringify(value));

export function createBlotFigureController({ runtime, elements, documentObject, deps }) {
  const main = documentObject.querySelector('.gel-main');
  if (!main) return null;
  const stage = elements.gelViewerStage;
  const workspace = documentObject.querySelector('.gel-workspace');
  const navigation = documentObject.getElementById('gel-navigation');
  const inspector = documentObject.getElementById('gel-figure-inspector');
  stage.insertAdjacentHTML('beforeend', blotFigureMarkup);
  navigation.insertAdjacentHTML('beforeend', blotNavigationMarkup);
  inspector.insertAdjacentHTML('beforeend', blotToolsMarkup);
  const panel = documentObject.getElementById('gel-blot-figure');
  const get = id => documentObject.getElementById(`gel-figure-${id}`);
  const launcher = documentObject.getElementById('gel-open-figure-btn');
  const hoverBox = documentObject.createElement('div');
  hoverBox.className = 'gel-figure-hover-box'; hoverBox.hidden = true;
  let rows = [];
  let navigationOrder = [];
  const savedLayerCache = new Map();
  let selectedId = '';
  // The blot last clicked in the Stack preview; its placement fields show in Layout.
  let focusedId = '';
  let stacks = [];
  let activeStackId = '';
  const emptyStack = { layerIds: [], name: 'Stack', layoutName: 'Layout', trim: { ...DEFAULT_STACK_TRIM } };
  const currentStack = () => stacks.find(stack => stack.id === activeStackId) || stacks[0] || emptyStack;
  const stackForLayer = id => stacks.find(stack => stack.layerIds.includes(id));
  let renderedListKey = '';
  let finishRename = null;
  let nextLayerNumber = 1;
  let previewPlan = null;
  let activeId = '';
  let activeSignature = '';
  let busy = false;
  let disposed = false;
  let savedFingerprint = '';
  let autosave = null;
  let restoring = Boolean(deps.workspacePersistence);
  let restoreFailed = false;
  let history = [];
  let historyIndex = -1;
  const disposers = [];
  function listen(node, event, handler, options) {
    node?.addEventListener(event, handler, options);
    disposers.push(() => node?.removeEventListener(event, handler, options));
  }
  const selected = () => rows.find(row => row.id === selectedId);
  // Layout composes the Stack; a single gel has no layout of its own.
  const previewRows = () => rowsInStack(rows, currentStack().layerIds);
  const previewOptions = () => ({ trim: currentStack().trim });
  const focused = () => previewRows().find(row => row.id === focusedId);
  const isOpen = () => !panel.hidden;
  const ownsHistory = () => isOpen() || navigation.contains(documentObject.activeElement);
  const status = (message, options) => { get('status').textContent = message; get('status').hidden = true; deps.notify?.(message, options); };
  const savedGels = createSavedGelNavigation({
    getRecords: () => runtime.state.gelAnalyses || [], getRows: () => rows,
    restoreImage: deps.restoreRecordImage, createId: runtime.createId
  });
  function navigationRows() {
    const available = new Map([...rows, ...savedGels.entries()].map(row => [row.id, row]));
    // Image loading is lazy. Keep its existing slot when a library entry
    // becomes an editor row, instead of moving opened gels ahead of the rest.
    for (const id of available.keys()) {
      if (navigationOrder.includes(id)) continue;
      navigationOrder.push(id);
      for (const entry of history) if (!entry.navigationOrder.includes(id)) entry.navigationOrder.push(id);
    }
    return navigationOrder.map(id => available.get(id)).filter(Boolean);
  }
  const controls = () => Object.fromEntries(DRAFT_CONTROL_IDS.map(id => [id, documentObject.getElementById(id)?.value || '']));
  const trimEditor = createCanvasTrimEditor({
    container: get('preview'), getPlan: () => previewPlan, onRender: renderFocusedView,
    onApply(trim) {
      buildBlotFigurePlan(previewRows(), { trim });
      currentStack().trim = trim; commit(); status('Stack trimmed to the two canvas edges.');
    }
  });
  function editorSignature() {
    return JSON.stringify({ controls: controls(), revision: runtime.imageRevision,
      overrides: runtime.manualOverrides, crop: runtime.cropApplied, report: runtime.currentReport });
  }
  function captureDraft() {
    return {
      token: runtime.createId(), currentImage: runtime.currentImage,
      originalImage: runtime.originalImage || runtime.currentImage, originalFile: runtime.originalFile,
      controls: controls(), manualOverrides: clone(runtime.manualOverrides),
      currentReport: runtime.currentReport ? clone(runtime.currentReport) : null,
      cropApplied: runtime.cropApplied, viewerMode: runtime.viewerMode,
      pendingNotebookLink: runtime.pendingNotebookLink ? clone(runtime.pendingNotebookLink) : null
    };
  }
  const rowState = row => ({ id: row.id, label: row.label, placement: row.placement, token: row.draft.token });
  function fingerprint() {
    navigationRows();
    // Restoring an already saved image is browsing, not a project edit. Once
    // edited, stacked, or deliberately moved, it belongs to the
    // project's change tracking just like an imported layer.
    const changedRows = rows.filter(row => !row.libraryBaseline || row.navigationMoved || stackForLayer(row.id)
      || JSON.stringify(rowState(row)) !== row.libraryBaseline);
    return JSON.stringify({ title: get('name').value, stacks,
      rows: changedRows.map(row => ({ ...rowState(row), order: navigationOrder.indexOf(row.id) })) });
  }
  function getHistoryState() {
    return { canUndo: historyIndex > 0, canRedo: historyIndex < history.length - 1,
      undoCount: Math.max(0, historyIndex), redoCount: Math.max(0, history.length - historyIndex - 1) };
  }
  function announceHistory() { if (ownsHistory()) deps.onHistoryChanged?.(getHistoryState()); }
  function commit() {
    const key = fingerprint();
    if (history[historyIndex]?.key === key) return;
    history = history.slice(0, historyIndex + 1);
    history.push({ key, title: get('name').value, stacks: clone(stacks), activeStackId, selectedId,
      navigationOrder: [...navigationOrder],
      rows: rows.map(row => ({ ...row, placement: { ...row.placement } })) });
    if (history.length > 60) history.shift();
    historyIndex = history.length - 1;
    announceHistory();
    if (!restoring) autosave?.schedule();
  }
  function syncActive() {
    const row = rows.find(row => row.id === activeId);
    if (!row || !runtime.currentImage || runtime.originalImage !== row.draft.originalImage) return;
    const signature = editorSignature();
    if (signature === activeSignature) return;
    const imageChanged = row.draft.currentImage !== runtime.currentImage;
    const previousSegmentation = row.draft.manualOverrides?.laneSegmentation || {};
    const nextSegmentation = runtime.manualOverrides?.laneSegmentation || {};
    const editorName = elements.gelNameInput?.value.trim();
    if (editorName && editorName !== row.draft.controls['gel-name']) row.label = editorName;
    row.draft = captureDraft(); row.displayData = null;
    // A new crop changes coordinates. Updated lane dividers and band windows
    // should also be reflected when returning from the individual editor.
    const horizontal = segmentation => [segmentation.gelLeft, segmentation.gelRight, segmentation.dividers, segmentation.laneVertices];
    const horizontalChanged = JSON.stringify(horizontal(previousSegmentation)) !== JSON.stringify(horizontal(nextSegmentation));
    const verticalChanged = previousSegmentation.bandTop !== nextSegmentation.bandTop || previousSegmentation.bandBottom !== nextSegmentation.bandBottom;
    if (imageChanged || horizontalChanged || verticalChanged) {
      const inferred = inferBlotPlacement(row.draft);
      row.placement = { ...row.placement,
        ...(imageChanged || horizontalChanged ? { first: inferred.first, last: inferred.last } : {}),
        ...(imageChanged || verticalChanged ? { top: inferred.top, bottom: inferred.bottom } : {}) };
    }
    activeSignature = signature;
    commit();
  }
  function detachEditor() { syncActive(); activeId = ''; activeSignature = ''; if (isOpen()) close(); }

  function prepareProcessedRow(row) {
    const image = row.draft.currentImage;
    const settings = normalizeEnhancementSettings({ denoiseStrength: row.draft.controls['gel-denoise-strength'], contrastBoost: row.draft.controls['gel-contrast-strength'] });
    const key = row.draft.viewerMode === 'processed' ? JSON.stringify(settings) : 'original';
    if (row.displayData && row.displayGray === image.gray && row.displayKey === key) return null;
    const result = key !== 'original' ? deps.peekProcessedImage?.(image.gray, image.width, image.height, settings) : null;
    if (key === 'original' || result) {
      row.displayData = result?.previewImageData || image.imageData; row.displayGray = image.gray; row.displayKey = key;
      return null;
    }
    if (!deps.prepareImage) return null;
    if (row.processingTask?.gray === image.gray && row.processingTask.key === key) return row.processingTask.promise;
    row.displayData ||= image.imageData;
    const task = { gray: image.gray, key };
    task.promise = deps.prepareImage(image.gray, image.width, image.height, settings).then(result => {
      if (disposed) return null;
      if (row.processingTask === task) row.processingTask = null;
      const current = normalizeEnhancementSettings({ denoiseStrength: row.draft.controls['gel-denoise-strength'], contrastBoost: row.draft.controls['gel-contrast-strength'] });
      if (result && row.draft.currentImage.gray === image.gray && row.draft.viewerMode === 'processed' && JSON.stringify(current) === key) {
        row.displayData = result.previewImageData; row.displayGray = image.gray; row.displayKey = key;
      }
      if (isOpen()) renderPreview();
      return result;
    }).catch(error => {
      if (row.processingTask === task) row.processingTask = null;
      if (!disposed) status(error.message, { type: 'error' });
      return null;
    });
    row.processingTask = task; return task.promise;
  }
  function renderPreview() {
    previewPlan = null;
    const preview = get('preview');
    const visibleRows = previewRows();
    visibleRows.forEach(prepareProcessedRow);
    get('preview').setAttribute('aria-busy', String(visibleRows.some(row => row.processingTask)));
    get('preview-title').textContent = currentStack().name;
    get('preview-detail').textContent = `${visibleRows.length} gel${visibleRows.length === 1 ? '' : 's'}`;
    preview.replaceChildren();
    if (!visibleRows.length) {
      if (!rows.length) preview.insertAdjacentHTML('beforeend', '<div class="gel-figure-empty"><button type="button" class="ghost-btn" data-figure-action="import">Choose images…</button></div>');
      return;
    }
    try {
      const { canvas, plan } = createBlotFigureCanvas(visibleRows, documentObject, {
        trim: trimEditor.isActive() ? undefined : currentStack().trim,
        rasterScale: 1
      });
      previewPlan = plan;
      canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Stack of selected gel layers with antibody labels');
      canvas.title = 'Drag a blot to move it, or up and down to reorder the Stack. Drag its top or bottom edge to crop, or a side grip to resize with proportions locked.';
      preview.append(canvas, hoverBox);
      if (trimEditor.isActive()) {
        hoverBox.hidden = true; canvas.title = 'Drag the left and right trim edges, or click near an edge to place it.';
        trimEditor.render();
      }
    } catch (error) { status(error.message, { type: 'error' }); }
  }
  function renderStackTrim() {
    const available = previewRows().length > 0;
    get('stack-trim').hidden = !available;
    const editing = trimEditor.isActive();
    const button = workspace.querySelector('[data-figure-action="trim"]');
    button.setAttribute('aria-pressed', String(editing));
    button.textContent = editing ? 'Adjusting trim edges' : currentStack().trim.mode === 'none' ? 'Set trim edges' : 'Adjust trim edges';
    button.disabled = !available || editing;
    get('trim-actions').hidden = !editing;
    workspace.querySelector('[data-figure-action="reset-trim"]').disabled = !available || editing || currentStack().trim.mode === 'none';
  }
  function renderList() {
    // Keep row nodes stable when a click only changes selection, so the browser
    // can recognize the second click as a double-click on the same entry.
    const available = navigationRows();
    const key = JSON.stringify([available.map(row => [row.id, row.label]), stacks.map(stack => [stack.id, stack.name, stack.layoutName, stack.layerIds])]);
    if (key === renderedListKey) { renderNavigationSelection(); return; }
    renderedListKey = key;
    renderGelLayers({ list: get('rows'), rows: available, focusedId: selectedId, stacks, activeStackId, documentObject });
  }
  function renderSelection() {
    const row = focused();
    get('placement').hidden = !row;
    if (!row) return;
    get('placement-title').textContent = row.label;
    workspace.querySelectorAll('[data-figure-field]').forEach(input => { input.value = String(Math.round(row.placement[input.dataset.figureField] * 10) / 10); });
  }
  function renderNavigationSelection() {
    get('rows').querySelectorAll('[data-figure-row],[data-figure-stack-view],[data-figure-layout-view]').forEach(button => {
      if (rows.some(row => row.id === button.dataset.figureRow)) delete button.dataset.figureSavedRecord;
      const active = button.hasAttribute('data-figure-row') ? button.dataset.figureRow === selectedId
        : selectedId === STACK_VIEW && (button.dataset.figureStackView || button.dataset.figureLayoutView) === activeStackId;
      button.setAttribute('aria-current', active ? 'page' : 'false'); button.classList.toggle('is-active', active);
    });
  }
  function renderFocusedView() {
    renderNavigationSelection();
    renderSelection(); renderPreview(); renderStackTrim();
    if (isOpen()) [elements.gelExportImageBtn, elements.gelExportPptxBtn].filter(Boolean).forEach(button => { button.disabled = !previewRows().length || busy; });
    workspace.querySelector('[data-figure-action="add"]').disabled = !runtime.currentImage || rows.length >= MAX_BLOTS;
    workspace.querySelector('[data-figure-action="import"]').disabled = rows.length >= MAX_BLOTS;
    launcher.querySelector('[data-layer-count]')?.replaceChildren(rows.length ? String(rows.length) : '');
  }
  function render() { renderList(); renderFocusedView(); }
  function show(stackId = activeStackId) {
    if (!stacks.length || busy || elements.gelForm?.getAttribute('aria-busy') === 'true') return;
    if (typeof stackId !== 'string' || !stacks.some(stack => stack.id === stackId)) stackId = currentStack().id;
    trimEditor.cancel(false);
    activeStackId = stackId;
    selectedId = STACK_VIEW; focusedId = '';
    syncActive(); deps.leaveCropMode(); deps.hideWindows();
    panel.hidden = false; inspector.hidden = false; workspace.classList.add('is-showing-layout'); stage.classList.add('is-showing-layers'); launcher.setAttribute('aria-expanded', 'true');
    [elements.gelImageRow, elements.gelLaneTablePanel].filter(Boolean).forEach(node => { node.inert = true; });
    render(); announceHistory();
    workspace.querySelector('[data-figure-action="back"]').focus();
  }
  function close() {
    trimEditor.cancel(false);
    panel.hidden = true; inspector.hidden = true; workspace.classList.remove('is-showing-layout'); stage.classList.remove('is-showing-layers');
    [elements.gelImageRow, elements.gelLaneTablePanel].filter(Boolean).forEach(node => { node.inert = false; });
    launcher.setAttribute('aria-expanded', 'false');
    selectedId = activeId || '';
    renderList();
    deps.renderEditor(); deps.onEditorHistory();
    // Focus stays in the rail, so Undo and Redo keep acting on the project.
    (get('rows').querySelector(`[data-figure-row="${activeId}"]`) || get('stack-btn')).focus({ preventScroll: true });
  }
  function addCurrent() {
    if (busy || !runtime.currentImage || elements.gelForm?.getAttribute('aria-busy') === 'true') return;
    syncActive();
    const existing = rows.find(row => row.id === activeId);
    if (existing) { render(); return; }
    if (rows.length >= MAX_BLOTS) throw new Error(`A project can contain up to ${MAX_BLOTS} gel layers.`);
    deps.leaveCropMode();
    const draft = captureDraft();
    const row = { id: runtime.createId(), label: `Gel ${nextLayerNumber++}`, draft, placement: inferBlotPlacement(draft) };
    rows.push(row); activeId = row.id; activeSignature = editorSignature();
    if (!isOpen()) selectedId = row.id;
    commit(); render();
  }
  function editSelected() {
    const row = selected(); if (!row) return;
    syncActive();
    // Preserve an unrelated editor draft before switching to an imported blot.
    if (runtime.currentImage && !rows.some(item => item.draft.originalImage === runtime.originalImage)) addCurrent();
    selectedId = row.id; activeId = row.id;
    restoreLayer(row);
    activeSignature = editorSignature();
    close(); deps.setStatus('');
  }
  function restoreLayer(row) {
    const upgraded = deps.upgradeBandReport?.(row.draft);
    if (upgraded) row.draft = { ...row.draft, currentReport: upgraded };
    deps.restoreDraft({ ...row.draft, controls: { ...row.draft.controls, 'gel-name': row.label } });
  }
  async function loadSavedLayer(id) {
    if (rows.some(row => row.id === id)) return id;
    if (rows.length >= MAX_BLOTS) throw new Error(`A project can contain up to ${MAX_BLOTS} gel layers.`);
    const row = await savedGels.load(id);
    if (!row || disposed) return false;
    row.libraryBaseline = JSON.stringify(rowState(row));
    savedLayerCache.set(row.id, { ...row, placement: { ...row.placement } });
    rows.push(row); rows.sort((a, b) => navigationOrder.indexOf(a.id) - navigationOrder.indexOf(b.id));
    commit(); return row.id;
  }
  function openSavedLayer(id, rename = false) {
    void runBusy(async () => {
      try { return await loadSavedLayer(id); }
      catch (error) {
        const entry = savedGels.entries().find(row => row.id === id);
        if (!entry || error.code !== 'GEL_IMAGE_UNAVAILABLE' || !deps.openSavedAnalysis) {
          throw error;
        }
        // Older records can contain analysis without an archived image. Keep
        // that analysis accessible even though it cannot become a Stack layer.
        detachEditor();
        await deps.openSavedAnalysis(entry.record);
        selectedId = id;
        return false;
      }
    }).then(loaded => {
      if (!loaded || disposed) return;
      selectedId = loaded; editSelected(); renderList();
      if (rename) renameNavigationEntry([...get('rows').querySelectorAll('[data-figure-row]')].find(button => button.dataset.figureRow === loaded));
    });
  }
  function createStack() {
    if (busy || elements.gelForm?.getAttribute('aria-busy') === 'true') return;
    syncActive();
    let number = stacks.length + 1;
    let name = stacks.length ? `Stack ${number}` : 'Stack';
    while (stacks.some(stack => stack.name === name)) name = `Stack ${++number}`;
    const stack = { id: `stack-${runtime.createId()}`, name, layoutName: 'Layout', layerIds: [],
      trim: { ...DEFAULT_STACK_TRIM } };
    stacks.push(stack); activeStackId = stack.id; selectedId = STACK_VIEW;
    commit(); show(); status('Created an empty Stack.');
  }
  function moveLayer(id, destination, beforeId = null) {
    if (busy || elements.gelForm?.getAttribute('aria-busy') === 'true' || beforeId === id) return;
    if (!rows.some(row => row.id === id) && savedGels.entries().some(row => row.id === id)) {
      void runBusy(() => loadSavedLayer(id)).then(loaded => { if (loaded && !disposed) moveLayer(loaded, destination, beforeId); });
      return;
    }
    const row = rows.find(item => item.id === id);
    const targetStack = stacks.find(stack => stack.id === (destination === 'stack' ? activeStackId : destination));
    if (!row || (destination !== 'root' && !targetStack)) return;
    const previousStack = stackForLayer(id);
    const intoStack = Boolean(targetStack);
    const available = navigationRows();
    const nextRows = available.filter(item => item.id !== id);
    const sameGroup = item => stackForLayer(item.id) === targetStack;
    if (beforeId && !nextRows.some(item => item.id === beforeId && sameGroup(item))) return;
    const peers = nextRows.filter(sameGroup);
    const index = beforeId ? nextRows.findIndex(item => item.id === beforeId)
      : peers.length ? nextRows.indexOf(peers[peers.length - 1]) + 1 : nextRows.length;
    nextRows.splice(index, 0, row);
    if (previousStack === targetStack && nextRows.every((item, offset) => item.id === available[offset].id)) return;
    trimEditor.cancel(false); syncActive();
    navigationOrder = nextRows.map(item => item.id);
    row.navigationMoved = true;
    const loadedRows = new Map(rows.map(item => [item.id, item]));
    rows = navigationOrder.map(id => loadedRows.get(id)).filter(Boolean);
    for (const stack of stacks) {
      const members = new Set(stack.layerIds); members.delete(id);
      if (stack === targetStack) members.add(id);
      stack.layerIds = rows.filter(item => members.has(item.id)).map(item => item.id);
    }
    if (targetStack) activeStackId = targetStack.id;
    commit(); if (stacks.length) show(); else render();
    status(previousStack === targetStack ? `Reordered ${row.label}.` : `Moved ${row.label} ${intoStack ? `into ${targetStack.name}` : 'outside the stacks'}.`);
    [...get('rows').querySelectorAll('[data-figure-row]')].find(button => button.dataset.figureRow === id)?.focus({ preventScroll: true });
  }
  async function runBusy(action) {
    if (busy) return false;
    busy = true; panel.setAttribute('aria-busy', 'true');
    const locked = [...workspace.querySelectorAll('.gel-figure-navigation button,.gel-figure-navigation input,.gel-figure-controls button,.gel-figure-controls input,.gel-figure-controls select')].map(node => ({ node, disabled: node.disabled }));
    locked.forEach(({ node }) => { node.disabled = true; });
    launcher.disabled = true;
    try { return await action(); }
    catch (error) { status(error?.message || 'The figure operation failed.', { type: 'error' }); return false; }
    finally {
      busy = false; panel.setAttribute('aria-busy', 'false');
      locked.forEach(({ node, disabled }) => { node.disabled = disabled; });
      launcher.disabled = false;
      if (!disposed) render();
    }
  }
  function projectContent() {
    const project = JSON.parse(serializeBlotProject(rows, get('name').value, deps.imageDataToDataUrl, {
      stacks, activeStackId, checkedIds: [], selectedId, nextLayerNumber
    }));
    project.navigationOrder = [...navigationOrder];
    return JSON.stringify(project);
  }
  async function saveWorkspace() {
    trimEditor.apply(); syncActive();
    if (!deps.workspacePersistence) return saveProject();
    await ready;
    return !restoreFailed && await autosave.flush();
  }
  async function saveProject() {
    trimEditor.apply();
    syncActive();
    if (!rows.length && !stacks.length) { savedFingerprint = fingerprint(); return true; }
    return runBusy(async () => {
      const key = fingerprint();
      status('Saving figure project…');
      const result = await downloadTextFile({
        content: serializeBlotProject(rows, get('name').value, deps.imageDataToDataUrl, {
          stacks, activeStackId, checkedIds: [], selectedId, nextLayerNumber
        }),
        fileName: `${safeFilePart(get('name').value || 'Gel layers')}.gel-figure.json`, mimeType: 'application/json'
      });
      if (result?.saved) { if (!deps.workspacePersistence) savedFingerprint = key; status('Figure project saved.'); return true; }
      status('Save canceled.'); return false;
    });
  }
  async function exportFigure(format) {
    trimEditor.apply();
    return runBusy(async () => {
      status(`Preparing ${format.toUpperCase()}…`);
      const visibleRows = previewRows();
      await Promise.all(visibleRows.map(prepareProcessedRow));
      if (disposed || visibleRows.some(row => row.draft.viewerMode === 'processed' && row.displayKey !== JSON.stringify(normalizeEnhancementSettings({ denoiseStrength: row.draft.controls['gel-denoise-strength'], contrastBoost: row.draft.controls['gel-contrast-strength'] })))) throw new Error('Image processing is incomplete. Try exporting again.');
      const output = createBlotFigureCanvas(visibleRows, documentObject, { ...previewOptions(),
        showLadderLabels: Boolean(elements.gelExportLadderLabelsInput?.checked) });
      const title = `${get('name').value || 'Gel layers'}-${currentStack().name}`;
      const fileName = `${safeFilePart(title)}.${format}`;
      const result = format === 'png'
        ? await downloadDataUrlFile({ dataUrl: output.canvas.toDataURL('image/png'), fileName })
        : await downloadBinaryFile({ bytes: await createBlotFigurePowerPoint({ ...output, title }),
          fileName, mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
      status(result?.saved ? `${format.toUpperCase()} exported.` : 'Export canceled.');
      return Boolean(result?.saved);
    });
  }
  async function importFiles(files, { openEditor = false } = {}) {
    if (busy || elements.gelForm?.getAttribute('aria-busy') === 'true') return;
    syncActive();
    const imported = await runBusy(async () => {
      const errors = [];
      let firstId = '';
      const importControls = { ...controls(), 'gel-id': '', 'gel-type': openEditor ? controls()['gel-type'] : 'western' };
      for (const file of files) {
        if (rows.length >= MAX_BLOTS) { errors.push(`Layer limit: ${MAX_BLOTS} gels.`); break; }
        status(`Loading ${file.name}…`);
        try {
          const image = await decodeImageFile(file);
          if (disposed) return;
          const draft = { token: runtime.createId(), currentImage: image, originalImage: image, originalFile: file,
            controls: { ...importControls, 'gel-name': file.name.replace(/\.[^.]+$/, '') },
            manualOverrides: createEmptyManualOverrides(), currentReport: null, cropApplied: false,
            viewerMode: 'original', pendingNotebookLink: null };
          const row = { id: runtime.createId(), label: `Gel ${nextLayerNumber++}`, draft, placement: inferBlotPlacement(draft) };
          rows.push(row);
          firstId ||= row.id;
          try {
            await deps.saveImportedGel(draft, row.label);
          } catch (error) {
            errors.push(`${file.name}: Could not automatically save gel: ${error.message}`);
          }
        } catch (error) { errors.push(`${file.name}: ${error.message}`); }
      }
      if (openEditor && firstId) selectedId = firstId;
      const error = errors.join(' ');
      commit(); status(error || `${rows.length} gel layers. Create a stack and drag gels into it.`);
      return { firstId, error };
    });
    if (openEditor && !disposed && imported) {
      if (imported.firstId) editSelected();
      deps.setStatus(imported.error);
    }
  }
  // Every workspace import creates layers, including drops while processing.
  // Consume busy/rejected drops too so they cannot replace the active image.
  function handleFileDrop(files) {
    if (!busy && elements.gelForm?.getAttribute('aria-busy') !== 'true') {
      if (files.length) void importFiles(files, { openEditor: !isOpen() });
      else {
        status('Drop image files to add gel layers.');
        if (!isOpen()) deps.setStatus('Drop image files to add gel layers.');
      }
    }
    return true;
  }

  disposers.push(bindFileDropTarget({
    target: navigation, accept: 'image/*,.tif,.tiff', multiple: true,
    onFiles: handleFileDrop,
    onRejected: () => handleFileDrop([])
  }));
  disposers.push(bindGelLayerDrag({ navigation,
    isBusy: () => busy || elements.gelForm?.getAttribute('aria-busy') === 'true', onMove: moveLayer }));
  listen(launcher, 'click', () => show(stackForLayer(activeId)?.id || activeStackId));
  disposers.push(bindFigureWorkspaceActions({ documentObject, elements, isOpen, isBusy: () => busy,
    resumeEditor: close, exportFigure, saveProject }));
  // These actions replace the editor's image; capture a figure row
  // first, before the existing controller clears its crop and lane settings.
  listen(elements.gelImageFileInput, 'change', detachEditor, true);
  listen(elements.gelCancelBtn, 'click', detachEditor, true);
  listen(elements.gelList, 'click', event => { if (event.target.closest('[data-gel-edit]')) detachEditor(); }, true);
  listen(get('files'), 'change', event => {
    const files = [...event.target.files]; event.target.value = ''; void importFiles(files, { openEditor: !isOpen() });
  });
  listen(get('project-file'), 'change', event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    void runBusy(async () => {
      if (file.size > 180000000) throw new Error('The figure project is too large to open.');
      // Merge by stable identity and verified library images. Reopening a
      // backup preserves ongoing edits without duplicating its navigation.
      syncActive();
      const project = await parseBlotProject(await file.text(), runtime.createId);
      await reconnectProjectRecords(project, runtime.state.gelAnalyses || [], deps.restoreRecordImage);
      if (disposed) return;
      const merged = mergeBlotProject(project, rows, stacks, MAX_BLOTS);
      const wasEmpty = !rows.length && !stacks.length;
      merged.replacements.forEach(({ existing, row }) => {
        row.draft.token = runtime.createId(); Object.assign(existing, row); delete existing.libraryBaseline;
      });
      merged.rows.forEach(row => { row.draft.token = runtime.createId(); });
      merged.rows.forEach(row => {
        if (!row.label.trim()) row.label = `Gel ${nextLayerNumber++}`;
        const number = /^Gel (\d+)$/.exec(row.label)?.[1];
        if (number) nextLayerNumber = Math.max(nextLayerNumber, Number(number) + 1);
      });
      rows.push(...merged.rows);
      if (wasEmpty) get('name').value = project.title;
      stacks.push(...merged.stacks);
      if (merged.activeStackId) activeStackId = merged.activeStackId;
      nextLayerNumber = Math.max(nextLayerNumber, project.nextLayerNumber);
      commit(); if (wasEmpty && !deps.workspacePersistence) savedFingerprint = fingerprint();
      status('Figure project opened.');
      return merged.firstId;
    }).then(firstId => {
      // A project with a Stack opens its Layout; otherwise its first gel opens for editing.
      if (firstId === false || disposed) return;
      if (stacks.length) show();
      else if (firstId) { selectedId = firstId; editSelected(); }
    });
  });
  listen(workspace, 'click', event => {
    if (busy) return;
    const target = event.target.closest('button'); if (!target) return;
    if (target.dataset.figureRow) {
      if (!rows.some(row => row.id === target.dataset.figureRow)) { openSavedLayer(target.dataset.figureRow); return; }
      if (activeId === target.dataset.figureRow && !isOpen()) return;
      syncActive(); selectedId = target.dataset.figureRow; status(''); editSelected(); renderList(); return;
    }
    if (target.hasAttribute('data-figure-stack-view') || target.hasAttribute('data-figure-layout-view')) {
      status(''); show(target.dataset.figureStackView || target.dataset.figureLayoutView); return;
    }
    const action = target.dataset.figureAction; const row = focused();
    try {
      if (action === 'back') close();
      else if (action === 'stack') createStack();
      else if (action === 'trim' && previewRows().length) trimEditor.start(previewPlan.crop);
      else if (action === 'apply-trim') trimEditor.apply();
      else if (action === 'cancel-trim') trimEditor.cancel();
      else if (action === 'reset-trim' && previewRows().length) {
        currentStack().trim = { ...DEFAULT_STACK_TRIM };
        commit(); render(); status('Stack trim reset.');
      }
      else if (action === 'add') addCurrent();
      else if (action === 'import') get('files').click();
      else if (action === 'open') get('project-file').click();
      else if (action === 'recover' && elements.gelForm?.getAttribute('aria-busy') !== 'true') void deps.recoverSavedGels?.();
      else if (action === 'edit' && row) { selectedId = row.id; editSelected(); }
      else if (action === 'detect' && row) {
        const inferred = inferBlotPlacement(row.draft);
        row.placement = { ...row.placement, first: inferred.first, last: inferred.last };
        status(''); commit(); render();
      }
    } catch (error) { status(error.message, { type: 'error' }); }
  });
  function renameNavigationEntry(button) {
    if (!button || busy || elements.gelForm?.getAttribute('aria-busy') === 'true') return;
    finishRename?.(true);
    const row = rows.find(row => row.id === button.dataset.figureRow);
    if (button.dataset.figureRow && !row) { openSavedLayer(button.dataset.figureRow, true); return; }
    const isStack = button.hasAttribute('data-figure-stack-view');
    const stackId = button.dataset.figureStackView || button.dataset.figureLayoutView;
    const stack = stacks.find(stack => stack.id === stackId);
    if (!row && !stack) return;
    const selector = row ? `[data-figure-row="${row.id}"]` : isStack ? `[data-figure-stack-view="${stackId}"]` : `[data-figure-layout-view="${stackId}"]`;
    finishRename = startGelNavigationRename(button, {
      value: row ? row.label : isStack ? stack.name : stack.layoutName,
      label: row ? 'Rename gel' : isStack ? 'Rename stack' : 'Rename layout',
      onFinish() { finishRename = null; },
      onCommit(name) {
        syncActive();
        if (row) {
          row.label = name;
          row.draft = { ...row.draft, controls: { ...row.draft.controls, 'gel-name': name } };
          if (activeId === row.id) { elements.gelNameInput.value = name; activeSignature = editorSignature(); }
        } else if (isStack) stack.name = name;
        else stack.layoutName = name;
        commit(); render();
        return get('rows').querySelector(selector);
      }
    });
  }
  listen(navigation, 'dblclick', event => {
    const button = event.target.closest('[data-figure-row],[data-figure-stack-view],[data-figure-layout-view]');
    if (!button) return;
    event.preventDefault(); renameNavigationEntry(button);
  });
  listen(navigation, 'keydown', event => {
    if (event.key !== 'F2') return;
    const button = event.target.closest('[data-figure-row],[data-figure-stack-view],[data-figure-layout-view]');
    if (!button) return;
    event.preventDefault(); event.stopPropagation(); renameNavigationEntry(button);
  });
  listen(navigation, 'focusin', announceHistory);
  listen(get('name'), 'change', commit);
  listen(workspace, 'change', event => {
    const key = event.target.dataset.figureField; if (!key || !focused()) return;
    const value = event.target.value === '' ? NaN : Number(event.target.value);
    try {
      focused().placement = validatePlacement({ ...focused().placement, [key]: value });
      status(''); commit(); renderPreview();
    } catch (error) { status(error.message, { type: 'error' }); renderSelection(); }
  });
  // Direct manipulation in the preview, as with placed images in slide and
  // design tools: drag a blot to slide it, a side to stretch it, the top or
  // bottom edge to crop it. Each drag rewrites the anchors and crop that
  // Exact values shows, so exports, projects and undo are unchanged.
  const EDGE_PX = 7;
  const CURSORS = { move: 'grab', left: 'ew-resize', right: 'ew-resize', top: 'ns-resize', bottom: 'ns-resize' };
  const view = documentObject.defaultView;
  let drag = null;
  let dragFrame = 0;
  function blotBox(index) {
    const canvas = get('preview').querySelector('canvas');
    const part = previewPlan?.rows[index];
    if (!canvas || !part) return null;
    const k = canvas.getBoundingClientRect().width / previewPlan.width;
    const areaLeft = previewPlan.imageLeft;
    const left = areaLeft + part.imageX; const right = left + part.imageWidth;
    return { canvas, k, left, right, top: part.imageY, bottom: part.imageY + part.imageHeight,
      shownLeft: Math.max(areaLeft, left), shownRight: Math.min(areaLeft + previewPlan.imageWidth, right) };
  }
  function hitBlot(event) {
    if (!previewPlan) return null;
    for (let index = 0; index < previewPlan.rows.length; index++) {
      const box = blotBox(index);
      if (!box || !(box.k > 0)) return null;
      const origin = box.canvas.getBoundingClientRect();
      const x = (event.clientX - origin.left) / box.k; const y = (event.clientY - origin.top) / box.k;
      const slack = EDGE_PX / box.k; const near = (a, b) => Math.abs(a - b) <= slack;
      if (x < box.shownLeft - slack || x > box.shownRight + slack || y < box.top - slack || y > box.bottom + slack) continue;
      const zone = near(y, box.top) ? 'top' : near(y, box.bottom) ? 'bottom'
        : near(x, box.left) ? 'left' : near(x, box.right) ? 'right' : 'move';
      return { index, row: previewRows()[index], zone, k: box.k };
    }
    return null;
  }
  function showHover(index) {
    const box = index == null ? null : blotBox(index);
    hoverBox.hidden = !box;
    if (!box) return;
    hoverBox.dataset.resizeLeft = String(box.shownLeft === box.left);
    hoverBox.dataset.resizeRight = String(box.shownRight === box.right);
    Object.assign(hoverBox.style, {
      left: `${box.canvas.offsetLeft + box.shownLeft * box.k}px`, top: `${box.canvas.offsetTop + box.top * box.k}px`,
      width: `${(box.shownRight - box.shownLeft) * box.k}px`, height: `${(box.bottom - box.top) * box.k}px` });
  }
  // Moving a blot up or down past another blot's middle changes the Stack
  // order, as when reordering layers; sideways movement still aligns it.
  function reorderUnderPointer() {
    const visible = previewRows();
    const canvas = get('preview').querySelector('canvas');
    if (visible.length < 2 || !canvas || !previewPlan) return false;
    const y = (drag.clientY - canvas.getBoundingClientRect().top) / drag.k;
    const middles = previewPlan.rows.map(part => part.imageY + part.imageHeight / 2);
    const others = visible.filter(row => row !== drag.row);
    const to = others.filter(row => middles[visible.indexOf(row)] < y).length;
    if (to === visible.indexOf(drag.row)) return false;
    rows.splice(rows.indexOf(drag.row), 1);
    const next = others[to];
    rows.splice(next ? rows.indexOf(next) : rows.indexOf(others[others.length - 1]) + 1, 0, drag.row);
    navigationOrder.splice(navigationOrder.indexOf(drag.row.id), 1);
    navigationOrder.splice(next ? navigationOrder.indexOf(next.id)
      : navigationOrder.indexOf(others[others.length - 1].id) + 1, 0, drag.row.id);
    return true;
  }
  function applyDrag() {
    dragFrame = 0;
    if (!drag) return;
    let moved = false;
    try {
      drag.row.placement = dragPlacement(drag.start, drag.row.draft.currentImage, drag.zone, drag.dx, drag.dy);
      moved = true;
    } catch { /* Past a limit the blot stays where it last fit. */ }
    const reordered = drag.zone === 'move' && reorderUnderPointer();
    if (!moved && !reordered) return;
    drag.changed = true;
    if (reordered) renderList();
    renderPreview();
    drag.index = previewRows().indexOf(drag.row);
    showHover(drag.index);
  }
  function endDrag(event) {
    if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    if (dragFrame) { view.cancelAnimationFrame(dragFrame); applyDrag(); }
    const { changed } = drag; drag = null;
    get('preview').style.cursor = '';
    if (changed) { status(''); commit(); renderSelection(); renderStackTrim(); }
  }
  listen(get('preview'), 'pointerdown', event => {
    if (busy || event.button !== 0) return;
    const hit = hitBlot(event); if (!hit) return;
    event.preventDefault();
    focusedId = hit.row.id; renderSelection();
    try { get('preview').setPointerCapture(event.pointerId); } catch { /* a synthetic pointer has nothing to capture */ }
    drag = { ...hit, pointerId: event.pointerId, x: event.clientX, y: event.clientY, clientY: event.clientY, dx: 0, dy: 0,
      start: { ...hit.row.placement }, changed: false };
    if (hit.zone === 'move') get('preview').style.cursor = 'grabbing';
  });
  listen(get('preview'), 'pointermove', event => {
    if (drag) {
      if (event.pointerId !== drag.pointerId) return;
      drag.dx = (event.clientX - drag.x) / drag.k; drag.dy = (event.clientY - drag.y) / drag.k; drag.clientY = event.clientY;
      if (!dragFrame) dragFrame = view.requestAnimationFrame(applyDrag);
      return;
    }
    const hit = busy ? null : hitBlot(event);
    get('preview').style.cursor = hit ? CURSORS[hit.zone] : '';
    showHover(hit?.index);
  });
  listen(get('preview'), 'pointerleave', () => { if (!drag) { showHover(null); get('preview').style.cursor = ''; } });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(get('preview'), type, endDrag);
  function moveHistory(direction) {
    if (busy) return false;
    const focused = documentObject.activeElement;
    const focusSelector = navigation.contains(focused)
      ? focused.dataset.figureRow ? `[data-figure-row="${focused.dataset.figureRow}"]`
        : focused.hasAttribute('data-figure-stack-view') ? `[data-figure-stack-view="${focused.dataset.figureStackView}"]` : `[data-figure-layout-view="${focused.dataset.figureLayoutView}"]`
      : null;
    trimEditor.cancel();
    commit(); const next = historyIndex + direction;
    if (next < 0 || next >= history.length) return false;
    historyIndex = next;
    const entry = history[next];
    stacks = clone(entry.stacks); activeStackId = entry.activeStackId;
    rows = entry.rows.map(row => ({ ...row, placement: { ...row.placement } }));
    // Browsing does not add undo steps or disappear when another edit is undone.
    for (const [id, row] of savedLayerCache) {
      if (!rows.some(item => item.id === id)) rows.push({ ...row, placement: { ...row.placement } });
    }
    navigationOrder = [...entry.navigationOrder, ...navigationOrder.filter(id => !entry.navigationOrder.includes(id))];
    rows.sort((a, b) => navigationOrder.indexOf(a.id) - navigationOrder.indexOf(b.id));
    get('name').value = entry.title;
    selectedId = isOpen() ? STACK_VIEW : rows.some(row => row.id === entry.selectedId) ? entry.selectedId : rows[0]?.id || '';
    const active = rows.find(row => row.id === activeId)
      || rows.find(row => row.draft.originalImage === runtime.originalImage);
    activeId = active?.id || '';
    if (active) { restoreLayer(active); activeSignature = editorSignature(); }
    render();
    // Undo can remove the Stack under an open Layout; redo brings both back.
    if (isOpen() && !stacks.length) close();
    else if (!isOpen() && stacks.length && entry.selectedId === STACK_VIEW) show();
    // If undo removed the focused entry, stay in the rail so redo still reaches the project.
    if (focusSelector) (get('rows').querySelector(focusSelector) || get('stack-btn')).focus();
    announceHistory(); autosave?.schedule(); return true;
  }
  // Escape while the Add menu is open is left to the browser, which closes just the menu.
  listen(workspace, 'keydown', event => {
    if (!ownsHistory()) return;
    if (trimEditor.isActive() && ['Escape', 'Enter'].includes(event.key) && !event.target.closest('input,textarea,select')) {
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Escape') trimEditor.cancel(); else trimEditor.apply();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      if (event.target.closest('input:not([type="checkbox"]),textarea')) return;
      event.preventDefault(); event.stopPropagation(); moveHistory(event.shiftKey ? 1 : -1);
    } else if (event.key === 'Escape' && !busy && !workspace.querySelector(':popover-open')) {
      event.preventDefault(); event.stopPropagation(); close();
    }
  });
  render(); commit(); savedFingerprint = fingerprint();
  if (deps.workspacePersistence) autosave = createWorkspaceAutosave({
    getKey: fingerprint, getContent: projectContent, save: deps.workspacePersistence.save,
    onError: error => status(`Could not automatically save the Gel workspace: ${error.message}`, { type: 'error' })
  });
  const ready = (async () => {
    if (!deps.workspacePersistence) return;
    try {
      const candidates = await deps.workspacePersistence.load();
      let project = null, restored = null, lastError = null;
      for (const candidate of candidates) {
        try { project = await parseBlotProject(candidate.content, runtime.createId, { local: true }); restored = candidate; break; }
        catch (error) { lastError = error; }
      }
      if (candidates.length && !project) throw lastError;
      if (disposed) return;
      if (project) {
        rows = project.rows; stacks = project.stacks; activeStackId = project.activeStackId;
        rows.forEach(row => { row.draft.token = runtime.createId(); });
        const order = JSON.parse(restored.content).navigationOrder;
        navigationOrder = Array.isArray(order) ? [...new Set(order.filter(id => typeof id === 'string'))] : rows.map(row => row.id);
        nextLayerNumber = project.nextLayerNumber; get('name').value = project.title;
        selectedId = project.selectedId;
        restored.accept?.();
        if (restored.previous) status('Restored the previous Gel workspace because the latest save was unavailable.', { type: 'warning' });
      }
      history = []; historyIndex = -1; render(); commit(); savedFingerprint = fingerprint();
      restoring = false; autosave.enable();
      if (stacks.length && selectedId === STACK_VIEW) show();
      else if (selectedId) editSelected();
    } catch (error) {
      restoring = false; restoreFailed = true;
      status(`Could not restore the Gel workspace: ${error.message} Your saved workspace has been kept.`, { type: 'error' });
    }
  })();
  return {
    ready,
    isOpen, ownsHistory, getHistoryState, processSelected: editSelected, undo: () => moveHistory(-1), redo: () => moveHistory(1),
    ownsEditor: () => rows.some(row => row.id === activeId && row.draft.originalImage === runtime.originalImage),
    hasUnsavedChanges() { if (restoring) return false; syncActive(); return trimEditor.isChanged() || (autosave && !restoreFailed ? autosave.dirty() : fingerprint() !== savedFingerprint); },
    saveProject, saveWorkspace, detachEditor, handleFileDrop,
    suspendWorkspace() { autosave?.dispose(); deps.workspacePersistence?.dispose?.(); },
    refreshSavedRecords() { syncActive(); renderList(); },
    destroy() { disposed = true; autosave?.dispose(); deps.workspacePersistence?.dispose?.(); finishRename?.(false); trimEditor.destroy(); disposers.forEach(dispose => dispose()); panel.remove(); navigation.replaceChildren(); inspector.replaceChildren(); inspector.hidden = true; workspace.classList.remove('is-showing-layout'); stage.classList.remove('is-showing-layers');
      [elements.gelImageRow, elements.gelLaneTablePanel].filter(Boolean).forEach(node => { node.inert = false; }); }
  };
}
