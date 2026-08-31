import {
  createChartStylePicker,
  SHAPE_OPTIONS,
  LINE_STYLE_OPTIONS,
  FRAME_STYLE_OPTIONS,
  POINT_SIZE_OPTIONS,
  LINE_WIDTH_OPTIONS,
  STROKE_WIDTH_OPTIONS
} from './chart-style-pickers.js';
import { createChartTextControls } from './chart-text-controls.js';
import {
  deleteChartPreset,
  getChartPreset,
  listChartPresets,
  sanitizePresetName,
  saveChartPreset
} from './chart-presets.js';
import { PANEL_HTML, TABS, TAB_KEYS } from './chart-controls-markup.js';
import { createChartControlsForm } from './chart-controls-form.js';

function defaultSafeText(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function nearestOption(value, options) {
  if (!options.length) return value;
  if (!Number.isFinite(value)) return options[0].value;
  let best = options[0].value;
  let bestDist = Math.abs(value - best);
  for (let i = 1; i < options.length; i++) {
    const dist = Math.abs(value - options[i].value);
    if (dist < bestDist) {
      bestDist = dist;
      best = options[i].value;
    }
  }
  return best;
}

// Builds the tabbed chart format panel into `container` and binds it to `store`.
// store: { getStyle, setStyle(patch), resetStyle, getContext } (see chart-style-store.js)
export function mountChartControls(container, {
  store,
  safeText,
  promptForName
} = {}) {
  if (!container || !store) {
    return { refresh() {}, destroy() {} };
  }
  const escape = typeof safeText === 'function' ? safeText : defaultSafeText;
  const askName = typeof promptForName === 'function'
    ? promptForName
    : (message, initial) => globalThis.prompt?.(message, initial);
  container.innerHTML = PANEL_HTML;
  const q = (key) => container.querySelector(`[data-cc="${key}"]`);

  let suppressInputEvents = false;
  let activeTab = TABS[0].id;
  const seriesColorListeners = [];
  const pickers = {};
  let textControls = null;

  function buildPickers() {
    pickers.pointShape = createChartStylePicker(q('pointShape'), {
      kind: 'shape',
      options: SHAPE_OPTIONS,
      value: 'circle',
      onChange: () => {
        if (pickers.pointSize) pickers.pointSize.setShapeContext(pickers.pointShape.value);
        onFormInput();
      }
    });
    pickers.pointSize = createChartStylePicker(q('pointSize'), {
      kind: 'point-size',
      options: POINT_SIZE_OPTIONS,
      value: POINT_SIZE_OPTIONS[1].value,
      shapeContext: pickers.pointShape ? pickers.pointShape.value : 'circle',
      onChange: onFormInput
    });
    pickers.lineStyle = createChartStylePicker(q('lineStyle'), {
      kind: 'line-style', options: LINE_STYLE_OPTIONS, value: 'solid', onChange: onFormInput
    });
    pickers.lineWidth = createChartStylePicker(q('lineWidth'), {
      kind: 'line-width', options: LINE_WIDTH_OPTIONS, value: 1.5, onChange: onFormInput
    });
    pickers.frameStyle = createChartStylePicker(q('frameStyle'), {
      kind: 'frame-style', options: FRAME_STYLE_OPTIONS, value: 'box', onChange: onFormInput
    });
    pickers.frameStrokeWidth = createChartStylePicker(q('frameStrokeWidth'), {
      kind: 'stroke-width', options: STROKE_WIDTH_OPTIONS, value: 1, onChange: onFormInput
    });
    pickers.gridStrokeWidth = createChartStylePicker(q('gridStrokeWidth'), {
      kind: 'grid-width', options: STROKE_WIDTH_OPTIONS, value: 1, onChange: onFormInput
    });
    textControls = createChartTextControls(q('textBar'), {
      value: store.getStyle().text || {},
      onChange: (textValue) => {
        if (suppressInputEvents) return;
        applyPatch({ text: textValue });
      }
    });
  }

  function setValueIfPresent(input, value) {
    if (!input) return;
    if (input.type === 'checkbox') {
      input.checked = Boolean(value);
    } else if (value === null || value === undefined) {
      input.value = '';
    } else {
      input.value = String(value);
    }
  }

  function setPickerValue(picker, value, options) {
    if (!picker) return;
    const snapped = options ? nearestOption(Number(value), options) : value;
    picker.setValue(snapped);
  }

  function selectTab(tabId) {
    activeTab = TABS.some((tab) => tab.id === tabId) ? tabId : TABS[0].id;
    container.querySelectorAll('[data-cc-tab]').forEach((button) => {
      button.setAttribute('aria-selected', button.getAttribute('data-cc-tab') === activeTab ? 'true' : 'false');
    });
    container.querySelectorAll('[data-cc-panel]').forEach((panel) => {
      panel.hidden = panel.getAttribute('data-cc-panel') !== activeTab;
    });
  }

  // Hide what this figure cannot use: bar-only settings on a line chart and vice
  // versa, and error-bar geometry when nothing draws error bars.
  function applyContextVisibility(context) {
    const chartType = context.chartType || 'line';
    container.querySelectorAll('[data-cc-when]').forEach((element) => {
      element.hidden = element.getAttribute('data-cc-when') !== chartType;
    });
    container.querySelectorAll('[data-cc-needs="errorBars"]').forEach((element) => {
      element.hidden = !context.hasErrorBars;
    });
  }

  // Y can only carry a column that parses as a number; X and series can be either a
  // category or a continuous column (a dose-response X is numeric), so they get all of
  // them. On a fitted curve no override applies at all, so the selects are hidden.
  function renderColumnOptions(context) {
    const headers = context.headers;
    const note = q('columnNote');
    const fields = q('columnFields');
    if (fields) {
      fields.hidden = context.hasFittedCurve;
    }
    ['xColumn', 'yColumn', 'seriesColumn'].forEach((key) => {
      const select = q(key);
      if (!select) return;
      const options = key === 'yColumn' ? context.numericHeaders : headers;
      const current = store.getStyle()[key] || 'auto';
      select.innerHTML = `<option value="auto">Auto</option>${options
        .map((header) => `<option value="${escape(header)}">${escape(header)}</option>`)
        .join('')}`;
      select.value = options.includes(current) ? current : 'auto';
      select.disabled = !options.length;
    });
    if (note) {
      if (context.hasFittedCurve) {
        note.textContent = 'This analysis draws its own fitted curve, so the plotted columns are fixed.';
      } else {
        note.textContent = headers.length
          ? 'Auto picks the column the analysis intends. Override to plot a different metric.'
          : 'Run an analysis to choose which columns are plotted.';
      }
    }
  }

  function refreshPresetOptions(selected = '') {
    const select = q('presetSelect');
    if (!select) return;
    const names = listChartPresets();
    select.innerHTML = `<option value="">Custom</option>${names
      .map((name) => `<option value="${escape(name)}">${escape(name)}</option>`)
      .join('')}`;
    select.value = names.includes(selected) ? selected : '';
  }


  const {
    syncFormFromStyle,
    applyRangeDisabledState,
    applySizeDisabledState,
    clearSeriesColorListeners,
    clampDim,
    parseRangeNumber,
    pickerNumberValue,
    selectValue
  } = createChartControlsForm({
    q,
    store,
    pickers,
    textControls,
    seriesColorListeners,
    setValueIfPresent,
    setPickerValue,
    applyContextVisibility,
    renderColumnOptions,
    applyPatch: (patch) => applyPatch(patch)
  });

  function readFormPatch() {
    const style = store.getStyle();
    // Opacity has a control on both the line and bar panels; the visible one wins.
    const barOpacity = q('opacityBar');
    const opacityInput = barOpacity && !barOpacity.hidden && barOpacity.offsetParent !== null
      ? barOpacity
      : q('opacity');
    return {
      xColumn: selectValue('xColumn', style.xColumn),
      yColumn: selectValue('yColumn', style.yColumn),
      seriesColumn: selectValue('seriesColumn', style.seriesColumn),
      xScale: q('xScale')?.value || 'linear',
      yScale: q('yScale')?.value || 'linear',
      xRange: { auto: Boolean(q('xRangeAuto')?.checked), min: parseRangeNumber(q('xMin')), max: parseRangeNumber(q('xMax')) },
      yRange: { auto: Boolean(q('yRangeAuto')?.checked), min: parseRangeNumber(q('yMin')), max: parseRangeNumber(q('yMax')) },
      xTick: parseRangeNumber(q('xTick')),
      yTick: parseRangeNumber(q('yTick')),
      pointShape: pickers.pointShape ? pickers.pointShape.value : style.pointShape,
      pointSize: pickerNumberValue(pickers.pointSize, style.pointSize),
      lineStyle: pickers.lineStyle ? pickers.lineStyle.value : style.lineStyle,
      lineWidth: pickerNumberValue(pickers.lineWidth, style.lineWidth),
      frameStyle: pickers.frameStyle ? pickers.frameStyle.value : style.frameStyle,
      frameStroke: q('frameStroke')?.value || style.frameStroke,
      frameStrokeWidth: pickerNumberValue(pickers.frameStrokeWidth, style.frameStrokeWidth),
      backgroundColor: q('backgroundColor')?.value || style.backgroundColor,
      sizeAuto: q('sizeAuto') ? Boolean(q('sizeAuto').checked) : style.sizeAuto,
      frameWidth: clampDim(parseRangeNumber(q('frameWidth')), 320, 2000),
      frameHeight: clampDim(parseRangeNumber(q('frameHeight')), 180, 1200),
      showVerticalGrid: q('gridVertical') ? Boolean(q('gridVertical').checked) : style.showVerticalGrid,
      showHorizontalGrid: q('gridHorizontal') ? Boolean(q('gridHorizontal').checked) : style.showHorizontalGrid,
      gridColor: q('gridColor')?.value || style.gridColor,
      gridStrokeWidth: pickerNumberValue(pickers.gridStrokeWidth, style.gridStrokeWidth),
      title: q('title') ? q('title').value : style.title,
      xTitle: q('xTitle') ? q('xTitle').value : style.xTitle,
      yTitle: q('yTitle') ? q('yTitle').value : style.yTitle,
      xTitlePos: parseRangeNumber(q('xTitlePos')),
      yTitlePos: parseRangeNumber(q('yTitlePos')),
      xTitleOffset: parseRangeNumber(q('xTitleOffset')),
      yTitleOffset: parseRangeNumber(q('yTitleOffset')),
      mode: q('mode')?.value || 'lines+markers',
      legendPosition: q('legendPosition')?.value || 'top',
      tickDir: q('tickDir')?.value || 'outside',
      tickLen: parseRangeNumber(q('tickLen')),
      minorTicks: q('minorTicks') ? Boolean(q('minorTicks').checked) : style.minorTicks,
      tickFormat: q('tickFormat')?.value || 'auto',
      markerFill: q('markerFill')?.value || 'filled',
      opacity: parseRangeNumber(opacityInput),
      errorCapWidth: parseRangeNumber(q('errorCapWidth')),
      errorThickness: parseRangeNumber(q('errorThickness')),
      refLineAxis: q('refLineAxis')?.value || 'y',
      refLineValue: parseRangeNumber(q('refLineValue')),
      barMode: q('barMode')?.value || 'group',
      barLabels: q('barLabels') ? Boolean(q('barLabels').checked) : style.barLabels,
      barCornerRadius: parseRangeNumber(q('barCornerRadius'))
    };
  }

  function applyPatch(patch) {
    store.setStyle(patch);
    applyRangeDisabledState();
    applySizeDisabledState();
  }

  function onFormInput() {
    if (suppressInputEvents) return;
    applyPatch(readFormPatch());
  }

  function resync() {
    suppressInputEvents = true;
    syncFormFromStyle();
    suppressInputEvents = false;
  }

  function onResetClick() {
    store.resetStyle();
    refreshPresetOptions();
    resync();
  }

  // Reset only the fields the active tab owns, so tuning one section can't discard
  // the title you typed on another.
  function onResetTabClick() {
    const defaults = store.getDefaultStyle();
    const patch = {};
    (TAB_KEYS[activeTab] || []).forEach((key) => {
      patch[key] = defaults[key];
    });
    applyPatch(patch);
    resync();
  }

  function onTabClick(event) {
    const button = event.target.closest('[data-cc-tab]');
    if (!button || !container.contains(button)) return;
    selectTab(button.getAttribute('data-cc-tab'));
  }

  function onTabKeyDown(event) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const index = TABS.findIndex((tab) => tab.id === activeTab);
    const next = event.key === 'ArrowRight'
      ? TABS[(index + 1) % TABS.length]
      : TABS[(index - 1 + TABS.length) % TABS.length];
    event.preventDefault();
    selectTab(next.id);
    container.querySelector(`[data-cc-tab="${next.id}"]`)?.focus();
  }

  function onPresetChange() {
    const name = q('presetSelect')?.value || '';
    if (!name) return;
    const preset = getChartPreset(name);
    if (preset) {
      applyPatch(preset);
      resync();
    }
  }

  function onPresetSave() {
    const current = q('presetSelect')?.value || '';
    const name = sanitizePresetName(askName('Save this chart style as:', current));
    if (!name) return;
    if (saveChartPreset(name, store.getStyle())) {
      refreshPresetOptions(name);
    }
  }

  function onPresetDelete() {
    const name = q('presetSelect')?.value || '';
    if (name && deleteChartPreset(name)) {
      refreshPresetOptions();
    }
  }

  const nativeInputKeys = [
    'xColumn', 'yColumn', 'seriesColumn',
    'xScale', 'yScale',
    'xRangeAuto', 'xMin', 'xMax', 'yRangeAuto', 'yMin', 'yMax',
    'xTick', 'yTick',
    'frameStroke', 'backgroundColor', 'sizeAuto', 'frameWidth', 'frameHeight',
    'gridVertical', 'gridHorizontal', 'gridColor',
    'title', 'xTitle', 'yTitle',
    'xTitlePos', 'yTitlePos', 'xTitleOffset', 'yTitleOffset',
    'mode', 'legendPosition',
    'tickDir', 'tickLen', 'minorTicks', 'tickFormat',
    'markerFill', 'opacity', 'opacityBar', 'errorCapWidth', 'errorThickness',
    'refLineAxis', 'refLineValue', 'barMode', 'barLabels', 'barCornerRadius'
  ];

  function inputEventName(input) {
    return input.tagName === 'SELECT' || input.type === 'checkbox' || input.type === 'color'
      ? 'change'
      : 'input';
  }

  buildPickers();
  nativeInputKeys.forEach((key) => {
    const input = q(key);
    if (!input) return;
    // Colour inputs still fire `input` while dragging; listening on both keeps the
    // live preview without duplicating work (the store patches are idempotent).
    input.addEventListener(inputEventName(input), onFormInput);
    if (input.type === 'color') {
      input.addEventListener('input', onFormInput);
    }
  });
  container.addEventListener('click', onTabClick);
  container.querySelector('.assay-chart-style-tabs')?.addEventListener('keydown', onTabKeyDown);
  q('resetBtn')?.addEventListener('click', onResetClick);
  q('resetTabBtn')?.addEventListener('click', onResetTabClick);
  q('presetSelect')?.addEventListener('change', onPresetChange);
  q('presetSaveBtn')?.addEventListener('click', onPresetSave);
  q('presetDeleteBtn')?.addEventListener('click', onPresetDelete);

  refreshPresetOptions();
  selectTab(activeTab);
  resync();

  return {
    refresh: resync,
    selectTab,
    destroy() {
      nativeInputKeys.forEach((key) => {
        const input = q(key);
        if (!input) return;
        input.removeEventListener(inputEventName(input), onFormInput);
        if (input.type === 'color') {
          input.removeEventListener('input', onFormInput);
        }
      });
      container.removeEventListener('click', onTabClick);
      container.querySelector('.assay-chart-style-tabs')?.removeEventListener('keydown', onTabKeyDown);
      q('resetBtn')?.removeEventListener('click', onResetClick);
      q('resetTabBtn')?.removeEventListener('click', onResetTabClick);
      q('presetSelect')?.removeEventListener('change', onPresetChange);
      q('presetSaveBtn')?.removeEventListener('click', onPresetSave);
      q('presetDeleteBtn')?.removeEventListener('click', onPresetDelete);
      clearSeriesColorListeners();
      Object.values(pickers).forEach((picker) => picker && picker.destroy());
      if (textControls) textControls.destroy();
      container.innerHTML = '';
    }
  };
}
