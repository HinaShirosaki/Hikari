import { decodeImageFile } from '../images/image-io.js';
import { downloadBinaryFile, downloadDataUrlFile, downloadTextFile } from '../export.js';
import { createEmptyManualOverrides, safeFilePart } from '../shared.js';
import { MAX_BLOTS, buildBlotFigurePlan, dragPlacement, inferBlotPlacement, validatePlacement } from './model.js';
import { createBlotFigureCanvas } from './render.js';
import { createBlotFigurePowerPoint } from './powerpoint.js';
import { DRAFT_CONTROL_IDS, parseBlotProject, serializeBlotProject } from './project.js';
import { blotFigureMarkup } from './markup.js';
import { renderGelLayers, rowsInStack, STACK_VIEW } from './layers.js';
import { DEFAULT_STACK_TRIM, normalizeStackTrim } from './trim.js';
import { bindFigureWorkspaceActions } from './workspace-actions.js';

const clone = value => JSON.parse(JSON.stringify(value));

export function createBlotFigureController({ runtime, elements, documentObject, deps }) {
  const main = documentObject.querySelector('.gel-main');
  if (!main) return null;
  const stage = elements.gelViewerStage;
  stage.insertAdjacentHTML('beforeend', blotFigureMarkup);
  const panel = documentObject.getElementById('gel-blot-figure');
  const get = id => documentObject.getElementById(`gel-figure-${id}`);
  const launcher = documentObject.getElementById('gel-open-figure-btn');
  const hoverBox = documentObject.createElement('div');
  hoverBox.className = 'gel-figure-hover-box'; hoverBox.hidden = true;
  let rows = [];
  let selectedId = '';
  let checkedIds = new Set();
  let stackIds = [];
  let nextLayerNumber = 1;
  let tableSource = 'auto';
  let stackTrim = { ...DEFAULT_STACK_TRIM };
  let previewPlan = null;
  let activeId = '';
  let activeSignature = '';
  let busy = false;
  let disposed = false;
  let savedFingerprint = '';
  let history = [];
  let historyIndex = -1;
  const disposers = [];
  function listen(node, event, handler, options) {
    node?.addEventListener(event, handler, options);
    disposers.push(() => node?.removeEventListener(event, handler, options));
  }
  const selected = () => rows.find(row => row.id === selectedId);
  const previewRows = () => selectedId === STACK_VIEW ? rowsInStack(rows, stackIds) : rows.filter(row => row.id === selectedId);
  const isOpen = () => !panel.hidden;
  const status = message => { get('status').textContent = message; };
  const controls = () => Object.fromEntries(DRAFT_CONTROL_IDS.map(id => [id, documentObject.getElementById(id)?.value || '']));
  function editorSignature() {
    return JSON.stringify({ controls: controls(), revision: runtime.imageRevision,
      overrides: runtime.manualOverrides, crop: runtime.cropApplied, mode: runtime.viewerMode, report: runtime.currentReport });
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
  function fingerprint() {
    return JSON.stringify({ title: get('name').value, tableSource, stackTrim, checkedIds: [...checkedIds].sort(), stackIds, rows: rows.map(row => ({
      id: row.id, label: row.label, placement: row.placement, token: row.draft.token
    })) });
  }
  function getHistoryState() {
    return { canUndo: historyIndex > 0, canRedo: historyIndex < history.length - 1,
      undoCount: Math.max(0, historyIndex), redoCount: Math.max(0, history.length - historyIndex - 1) };
  }
  function announceHistory() { if (isOpen()) deps.onHistoryChanged?.(getHistoryState()); }
  function commit() {
    const key = fingerprint();
    if (history[historyIndex]?.key === key) return;
    history = history.slice(0, historyIndex + 1);
    history.push({ key, title: get('name').value, tableSource, stackTrim: { ...stackTrim }, checkedIds: [...checkedIds], stackIds: [...stackIds], selectedId,
      rows: rows.map(row => ({ ...row, placement: { ...row.placement } })) });
    if (history.length > 60) history.shift();
    historyIndex = history.length - 1;
    announceHistory();
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
    row.draft = captureDraft(); row.displayData = null; row.thumbnailDataUrl = null;
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

  function renderPreview() {
    previewPlan = null;
    const preview = get('preview');
    const visibleRows = previewRows();
    get('preview-title').textContent = selectedId === STACK_VIEW ? 'Stack' : selected()?.label || 'Gel layers';
    get('preview-detail').textContent = selectedId === STACK_VIEW
      ? `${visibleRows.length} gel${visibleRows.length === 1 ? '' : 's'}` : selected()?.draft.currentImage.name || '';
    get('preview-options').hidden = !visibleRows.length;
    preview.replaceChildren();
    if (!visibleRows.length) return;
    try {
      const { canvas, plan } = createBlotFigureCanvas(visibleRows, documentObject, {
        tableSource,
        trim: selectedId === STACK_VIEW ? stackTrim : undefined,
        rasterScale: 1, guides: get('guides').checked ? Math.max(2, Math.min(40, Number(get('lane-count').value) || 6)) : 0
      });
      previewPlan = plan;
      canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', selectedId === STACK_VIEW ? 'Stack of selected gel layers with antibody labels' : `${selected()?.label} layer`);
      canvas.title = 'Drag a blot to move it, or up and down to reorder the Stack. Drag its top or bottom edge to crop, or a side to stretch it.';
      preview.append(canvas, hoverBox);
    } catch (error) { status(error.message); }
  }
  function renderStackTrim() {
    const available = selectedId === STACK_VIEW && previewRows().length > 0;
    get('stack-trim').hidden = !available;
    const effective = previewPlan?.crop || stackTrim;
    get('trim-left').value = String(Number(effective.left.toFixed(2)));
    get('trim-right').value = String(Number(effective.right.toFixed(2)));
    panel.querySelector('[data-figure-action="trim"]').setAttribute('aria-pressed', String(stackTrim.mode === 'auto'));
    panel.querySelector('[data-figure-action="trim"]').disabled = !available;
    panel.querySelector('[data-figure-action="reset-trim"]').disabled = !available || stackTrim.mode === 'none';
  }
  function renderList() {
    renderGelLayers({ list: get('rows'), rows, checkedIds, focusedId: selectedId, stackIds, documentObject });
    const count = rows.filter(row => checkedIds.has(row.id)).length;
    get('select-all').checked = Boolean(rows.length && count === rows.length);
    get('select-all').indeterminate = count > 0 && count < rows.length;
    get('select-all').disabled = !rows.length;
    panel.querySelector('[data-figure-action="stack"]').disabled = count < 2;
  }
  function renderSelection() {
    const row = selected();
    get('placement').hidden = !row;
    if (!row) return;
    get('antibody').value = row.label;
    panel.querySelectorAll('[data-figure-field]').forEach(input => { input.value = String(Math.round(row.placement[input.dataset.figureField] * 10) / 10); });
    panel.querySelector('[data-figure-action="up"]').disabled = rows.indexOf(row) === 0;
    panel.querySelector('[data-figure-action="down"]').disabled = rows.indexOf(row) === rows.length - 1;
  }
  function renderFocusedView() {
    const sourceSelect = get('table-source');
    sourceSelect.replaceChildren();
    for (const [value, text] of [['auto', 'First available'], ['none', 'None'],
      ...previewRows().filter(row => row.draft.manualOverrides?.laneTable?.rows?.length || row.id === tableSource).map(row => [row.id, row.label])]) {
      const option = documentObject.createElement('option'); option.value = value; option.textContent = text;
      sourceSelect.append(option);
    }
    sourceSelect.value = tableSource;
    get('rows').querySelectorAll('[data-figure-row]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.figureRow === selectedId)));
    get('rows').querySelector('[data-figure-stack-view]')?.setAttribute('aria-pressed', String(selectedId === STACK_VIEW));
    renderSelection(); renderPreview(); renderStackTrim();
    panel.querySelector('[data-figure-action="save"]').disabled = !rows.length;
    if (isOpen()) [elements.gelExportImageBtn, elements.gelExportPptxBtn].filter(Boolean).forEach(button => { button.disabled = !previewRows().length || busy; });
    panel.querySelector('[data-figure-action="add"]').disabled = !runtime.currentImage || rows.length >= MAX_BLOTS;
    panel.querySelector('[data-figure-action="import"]').disabled = rows.length >= MAX_BLOTS;
    launcher.querySelector('[data-layer-count]')?.replaceChildren(rows.length ? String(rows.length) : '');
  }
  function render() { renderList(); renderFocusedView(); }
  function show() {
    if (busy || elements.gelForm?.getAttribute('aria-busy') === 'true') return;
    syncActive(); deps.leaveCropMode(); deps.hideWindows();
    panel.hidden = false; stage.classList.add('is-showing-layers'); launcher.setAttribute('aria-expanded', 'true');
    [elements.gelImageRow, elements.gelLaneTablePanel].filter(Boolean).forEach(node => { node.inert = true; });
    render(); announceHistory();
    panel.querySelector('[data-figure-action="back"]').focus();
  }
  function close() {
    panel.hidden = true; stage.classList.remove('is-showing-layers');
    [elements.gelImageRow, elements.gelLaneTablePanel].filter(Boolean).forEach(node => { node.inert = false; });
    launcher.setAttribute('aria-expanded', 'false');
    deps.renderEditor(); deps.onEditorHistory(); launcher.focus();
  }
  function addCurrent(open = true) {
    if (busy || !runtime.currentImage || elements.gelForm?.getAttribute('aria-busy') === 'true') return;
    syncActive();
    const existing = rows.find(row => row.id === activeId);
    if (existing) { selectedId = existing.id; checkedIds.add(existing.id); commit(); if (open) show(); return; }
    if (rows.length >= MAX_BLOTS) throw new Error(`A project can contain up to ${MAX_BLOTS} gel layers.`);
    deps.leaveCropMode();
    const draft = captureDraft();
    const row = { id: runtime.createId(), label: `Gel ${nextLayerNumber++}`, draft, placement: inferBlotPlacement(draft) };
    rows.push(row); checkedIds.add(row.id); selectedId = activeId = row.id; activeSignature = editorSignature();
    commit(); if (open) show(); else render();
  }
  function editSelected() {
    const row = selected(); if (!row) return;
    syncActive();
    // Preserve an unrelated editor draft before switching to an imported blot.
    if (runtime.currentImage && !rows.some(item => item.draft.originalImage === runtime.originalImage)) addCurrent(false);
    selectedId = row.id; activeId = row.id;
    restoreLayer(row);
    activeSignature = editorSignature();
    close(); deps.setStatus('');
  }
  function restoreLayer(row) {
    deps.restoreDraft({ ...row.draft, controls: { ...row.draft.controls, 'gel-name': row.label } });
  }
  function stackSelected() {
    const members = rows.filter(row => checkedIds.has(row.id));
    if (members.length < 2) { status('Select at least two gel layers to Stack.'); return; }
    stackIds = members.map(row => row.id); selectedId = STACK_VIEW;
    commit(); render(); status(`Stacked ${members.map(row => row.label).join(', ')}.`);
  }
  async function runBusy(action) {
    if (busy) return false;
    busy = true; panel.setAttribute('aria-busy', 'true');
    const locked = [...panel.querySelectorAll('button,input,select')].map(node => ({ node, disabled: node.disabled }));
    locked.forEach(({ node }) => { node.disabled = true; });
    launcher.disabled = true;
    try { return await action(); }
    catch (error) { status(error?.message || 'The figure operation failed.'); return false; }
    finally {
      busy = false; panel.setAttribute('aria-busy', 'false');
      locked.forEach(({ node, disabled }) => { node.disabled = disabled; });
      launcher.disabled = false;
      if (!disposed) render();
    }
  }
  async function saveProject() {
    syncActive();
    if (!rows.length) { savedFingerprint = fingerprint(); return true; }
    return runBusy(async () => {
      const key = fingerprint();
      status('Saving figure project…');
      const result = await downloadTextFile({
        content: serializeBlotProject(rows, get('name').value, deps.imageDataToDataUrl, {
          tableSource, stackTrim, stackIds, checkedIds: [...checkedIds], selectedId, nextLayerNumber
        }),
        fileName: `${safeFilePart(get('name').value || 'Gel layers')}.gel-figure.json`, mimeType: 'application/json'
      });
      if (result?.saved) { savedFingerprint = key; status('Figure project saved.'); return true; }
      status('Save canceled.'); return false;
    });
  }
  async function exportFigure(format) {
    return runBusy(async () => {
      status(`Preparing ${format.toUpperCase()}…`);
      const output = createBlotFigureCanvas(previewRows(), documentObject, {
        tableSource, trim: selectedId === STACK_VIEW ? stackTrim : undefined
      });
      const title = selectedId === STACK_VIEW ? `${get('name').value || 'Gel layers'}-Stack` : selected()?.label || 'Gel';
      const fileName = `${safeFilePart(title)}.${format}`;
      const result = format === 'png'
        ? await downloadDataUrlFile({ dataUrl: output.canvas.toDataURL('image/png'), fileName })
        : await downloadBinaryFile({ bytes: await createBlotFigurePowerPoint({ ...output, title }),
          fileName, mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
      status(result?.saved ? `${format.toUpperCase()} exported.` : 'Export canceled.');
      return Boolean(result?.saved);
    });
  }
  async function importFiles(files) {
    await runBusy(async () => {
      const errors = [];
      for (const file of files) {
        if (rows.length >= MAX_BLOTS) { errors.push(`Layer limit: ${MAX_BLOTS} gels.`); break; }
        status(`Loading ${file.name}…`);
        try {
          const image = await decodeImageFile(file);
          if (disposed) return;
          const draft = { token: runtime.createId(), currentImage: image, originalImage: image, originalFile: file,
            controls: { ...controls(), 'gel-id': '', 'gel-name': file.name.replace(/\.[^.]+$/, ''), 'gel-type': 'western' },
            manualOverrides: createEmptyManualOverrides(), currentReport: null, cropApplied: false,
            viewerMode: 'original', pendingNotebookLink: null };
          const row = { id: runtime.createId(), label: `Gel ${nextLayerNumber++}`, draft, placement: inferBlotPlacement(draft) };
          rows.push(row); checkedIds.add(row.id); selectedId = row.id;
        } catch (error) { errors.push(`${file.name}: ${error.message}`); }
      }
      commit(); status(errors.join(' ') || `${rows.length} gel layers. Rename them, select the gels to combine, and click Stack.`);
    });
  }

  listen(launcher, 'click', show);
  disposers.push(bindFigureWorkspaceActions({ documentObject, elements, isOpen, isBusy: () => busy,
    resumeEditor: () => selected() ? editSelected() : close(), exportFigure }));
  // These actions replace the editor's image; capture a figure row
  // first, before the existing controller clears its crop and lane settings.
  listen(elements.gelImageFileInput, 'change', detachEditor, true);
  listen(elements.gelCancelBtn, 'click', detachEditor, true);
  listen(elements.gelList, 'click', event => { if (event.target.closest('[data-gel-edit]')) detachEditor(); }, true);
  listen(get('files'), 'change', event => {
    const files = [...event.target.files]; event.target.value = ''; void importFiles(files);
  });
  listen(get('project-file'), 'change', event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    void runBusy(async () => {
      if (file.size > 180000000) throw new Error('The figure project is too large to open.');
      // Open appends so importing a project cannot discard work already on the board.
      const project = await parseBlotProject(await file.text(), runtime.createId);
      if (disposed) return;
      if (rows.length + project.rows.length > MAX_BLOTS) throw new Error(`The project exceeds ${MAX_BLOTS} gel layers.`);
      const wasEmpty = !rows.length;
      project.rows.forEach(row => { row.draft.token = runtime.createId(); });
      project.rows.forEach(row => {
        if (!row.label.trim()) row.label = `Gel ${nextLayerNumber++}`;
        const number = /^Gel (\d+)$/.exec(row.label)?.[1];
        if (number) nextLayerNumber = Math.max(nextLayerNumber, Number(number) + 1);
      });
      rows.push(...project.rows); selectedId = project.rows[0].id;
      project.checkedIds.forEach(id => checkedIds.add(id));
      if (wasEmpty) {
        get('name').value = project.title; tableSource = project.tableSource;
        stackIds = project.stackIds; selectedId = project.selectedId; stackTrim = project.stackTrim;
      }
      nextLayerNumber = Math.max(nextLayerNumber, project.nextLayerNumber);
      commit(); if (wasEmpty) savedFingerprint = fingerprint();
      status('Figure project opened.');
    });
  });
  listen(panel, 'click', event => {
    if (busy) return;
    const target = event.target.closest('button'); if (!target) return;
    if (target.dataset.figureRow) {
      selectedId = target.dataset.figureRow; status(''); renderFocusedView(); return;
    }
    if (target.hasAttribute('data-figure-stack-view')) { selectedId = STACK_VIEW; status(''); renderFocusedView(); return; }
    const action = target.dataset.figureAction; const row = selected();
    try {
      if (action === 'back') close();
      else if (action === 'stack') stackSelected();
      else if ((action === 'trim' || action === 'reset-trim') && selectedId === STACK_VIEW && previewRows().length) {
        const nextTrim = { ...DEFAULT_STACK_TRIM, mode: action === 'trim' ? 'auto' : 'none' };
        buildBlotFigurePlan(previewRows(), { tableSource, trim: nextTrim });
        stackTrim = nextTrim;
        commit(); render(); status(action === 'trim' ? 'Trimmed the Stack to matching left and right edges.' : 'Stack trim reset.');
      }
      else if (action === 'add') addCurrent();
      else if (action === 'import') get('files').click();
      else if (action === 'open') get('project-file').click();
      else if (action === 'save') void saveProject();
      else if (action === 'edit') editSelected();
      else if (row && ['up', 'down', 'remove', 'detect'].includes(action)) {
        const index = rows.indexOf(row);
        if (action === 'remove') {
          rows.splice(index, 1); checkedIds.delete(row.id); stackIds = stackIds.filter(id => id !== row.id);
          if (activeId === row.id) activeId = ''; if (tableSource === row.id) tableSource = 'auto';
          selectedId = rows[Math.min(index, rows.length - 1)]?.id || '';
        }
        if (action === 'detect') {
          const inferred = inferBlotPlacement(row.draft);
          row.placement = { ...row.placement, first: inferred.first, last: inferred.last };
        }
        const next = index + (action === 'up' ? -1 : 1);
        if (['up', 'down'].includes(action) && next >= 0 && next < rows.length) [rows[index], rows[next]] = [rows[next], rows[index]];
        status(''); commit(); render();
      }
    } catch (error) { status(error.message); }
  });
  listen(panel, 'dblclick', event => {
    if (event.target.closest('[data-figure-row]')) { get('antibody').focus(); get('antibody').select(); }
  });
  listen(get('antibody'), 'input', () => {
    if (!selected()) return; selected().label = get('antibody').value;
    renderList(); renderPreview();
  });
  listen(get('antibody'), 'change', () => {
    const row = selected();
    if (row && !row.label.trim()) { row.label = `Gel ${nextLayerNumber++}`; get('antibody').value = row.label; renderList(); renderPreview(); }
    commit();
  });
  listen(get('name'), 'change', commit);
  listen(panel, 'change', event => {
    const trimEdge = event.target.dataset.figureTrim;
    if (trimEdge && ['left', 'right'].includes(trimEdge) && selectedId === STACK_VIEW) {
      try {
        const current = previewPlan?.crop || stackTrim;
        const nextTrim = normalizeStackTrim({ mode: 'manual', left: current.left, right: current.right,
          [trimEdge]: event.target.value === '' ? NaN : Number(event.target.value) });
        buildBlotFigurePlan(previewRows(), { tableSource, trim: nextTrim });
        stackTrim = nextTrim;
        status(''); commit(); renderFocusedView();
      } catch (error) { status(error.message); renderStackTrim(); }
      return;
    }
    const includeId = event.target.dataset.figureInclude;
    if (includeId && rows.some(row => row.id === includeId)) {
      if (event.target.checked) checkedIds.add(includeId); else checkedIds.delete(includeId);
      commit(); renderList();
      [...get('rows').querySelectorAll('[data-figure-include]')].find(input => input.dataset.figureInclude === includeId)?.focus();
      return;
    }
    const key = event.target.dataset.figureField; if (!key || !selected()) return;
    const value = event.target.value === '' ? NaN : Number(event.target.value);
    try {
      selected().placement = validatePlacement({ ...selected().placement, [key]: value });
      status(''); commit(); renderPreview();
    } catch (error) { status(error.message); renderSelection(); }
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
  listen(get('guides'), 'change', renderPreview); listen(get('lane-count'), 'input', renderPreview);
  listen(get('select-all'), 'change', () => {
    checkedIds = new Set(get('select-all').checked ? rows.map(row => row.id) : []); commit(); renderList();
  });
  listen(get('table-source'), 'change', () => { tableSource = get('table-source').value; commit(); renderPreview(); });
  function moveHistory(direction) {
    if (busy) return false;
    commit(); const next = historyIndex + direction;
    if (next < 0 || next >= history.length) return false;
    historyIndex = next;
    const entry = history[next];
    tableSource = entry.tableSource; stackTrim = { ...entry.stackTrim };
    checkedIds = new Set(entry.checkedIds); stackIds = [...entry.stackIds];
    rows = entry.rows.map(row => ({ ...row, placement: { ...row.placement } }));
    get('name').value = entry.title;
    selectedId = entry.selectedId === STACK_VIEW || rows.some(row => row.id === entry.selectedId) ? entry.selectedId : rows[0]?.id || '';
    const active = rows.find(row => row.id === activeId)
      || rows.find(row => row.draft.originalImage === runtime.originalImage);
    activeId = active?.id || '';
    if (active) { restoreLayer(active); activeSignature = editorSignature(); }
    render(); announceHistory(); return true;
  }
  // Escape while the Add menu is open is left to the browser, which closes just the menu.
  listen(panel, 'keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      if (event.target.closest('input:not([type="checkbox"]),textarea')) return;
      event.preventDefault(); event.stopPropagation(); moveHistory(event.shiftKey ? 1 : -1);
    } else if (event.key === 'Escape' && !busy && !panel.querySelector(':popover-open')) {
      event.preventDefault(); event.stopPropagation(); close();
    }
  });
  commit(); savedFingerprint = fingerprint();
  return {
    isOpen, getHistoryState, undo: () => moveHistory(-1), redo: () => moveHistory(1),
    ownsEditor: () => rows.some(row => row.id === activeId && row.draft.originalImage === runtime.originalImage),
    hasUnsavedChanges() { syncActive(); return fingerprint() !== savedFingerprint; },
    saveProject, detachEditor,
    destroy() { disposed = true; disposers.forEach(dispose => dispose()); panel.remove(); stage.classList.remove('is-showing-layers');
      [elements.gelImageRow, elements.gelLaneTablePanel].filter(Boolean).forEach(node => { node.inert = false; }); }
  };
}
