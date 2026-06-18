import {
  createChartStylePicker,
  SHAPE_OPTIONS,
  LINE_STYLE_OPTIONS,
  FRAME_STYLE_OPTIONS,
  POINT_SIZE_OPTIONS,
  LINE_WIDTH_OPTIONS,
  STROKE_WIDTH_OPTIONS,
  CORNER_RADIUS_OPTIONS,
  FRAME_WIDTH_OPTIONS,
  FRAME_HEIGHT_OPTIONS
} from './chart-style-pickers.js';
import { createChartTextControls } from './chart-text-controls.js';

const PANEL_HTML = `
  <details class="assay-chart-style">
    <summary class="assay-chart-style-summary">Chart Style</summary>
    <div class="assay-chart-style-body">
      <fieldset class="assay-chart-style-group">
        <legend>Axes</legend>
        <label>X column<select data-cc="xColumn"><option value="auto">Auto</option></select></label>
        <label>Y column<select data-cc="yColumn"><option value="auto">Auto</option></select></label>
        <label>Series column<select data-cc="seriesColumn"><option value="auto">Auto</option></select></label>
      </fieldset>
      <fieldset class="assay-chart-style-group">
        <legend>Scale &amp; range</legend>
        <label>X scale<select data-cc="xScale">
          <option value="auto">Auto</option><option value="linear">Linear</option>
          <option value="log">Log</option><option value="ordinal">Ordinal</option>
        </select></label>
        <label>Y scale<select data-cc="yScale">
          <option value="linear">Linear</option><option value="log">Log</option>
        </select></label>
        <label class="assay-chart-style-checkbox"><input type="checkbox" data-cc="xRangeAuto" checked />X auto range</label>
        <div class="assay-chart-style-row">
          <label>X min<input type="number" step="any" data-cc="xMin" /></label>
          <label>X max<input type="number" step="any" data-cc="xMax" /></label>
        </div>
        <label class="assay-chart-style-checkbox"><input type="checkbox" data-cc="yRangeAuto" checked />Y auto range</label>
        <div class="assay-chart-style-row">
          <label>Y min<input type="number" step="any" data-cc="yMin" /></label>
          <label>Y max<input type="number" step="any" data-cc="yMax" /></label>
        </div>
      </fieldset>
      <fieldset class="assay-chart-style-group">
        <legend>Points</legend>
        <label>Shape<div data-cc="pointShape" class="assay-chart-picker-mount"></div></label>
        <label>Size<div data-cc="pointSize" class="assay-chart-picker-mount"></div></label>
      </fieldset>
      <fieldset class="assay-chart-style-group">
        <legend>Lines</legend>
        <label>Style<div data-cc="lineStyle" class="assay-chart-picker-mount"></div></label>
        <label>Curve<select data-cc="curve">
          <option value="curveMonotoneX">Monotone</option><option value="curveLinear">Linear</option>
          <option value="curveStep">Step</option>
        </select></label>
        <label>Width<div data-cc="lineWidth" class="assay-chart-picker-mount"></div></label>
      </fieldset>
      <fieldset class="assay-chart-style-group">
        <legend>Frame</legend>
        <label>Style<div data-cc="frameStyle" class="assay-chart-picker-mount"></div></label>
        <label>Stroke<input type="color" data-cc="frameStroke" /></label>
        <label>Stroke width<div data-cc="frameStrokeWidth" class="assay-chart-picker-mount"></div></label>
        <label>Corner radius<div data-cc="frameCornerRadius" class="assay-chart-picker-mount"></div></label>
        <label>Background<input type="color" data-cc="backgroundColor" /></label>
      </fieldset>
      <fieldset class="assay-chart-style-group">
        <legend>Size</legend>
        <label class="assay-chart-style-checkbox"><input type="checkbox" data-cc="sizeAuto" checked />Auto size</label>
        <label>Width (px)<div data-cc="frameWidth" class="assay-chart-picker-mount"></div></label>
        <label>Height (px)<div data-cc="frameHeight" class="assay-chart-picker-mount"></div></label>
      </fieldset>
      <fieldset class="assay-chart-style-group">
        <legend>Grid lines</legend>
        <label class="assay-chart-style-checkbox"><input type="checkbox" data-cc="gridVertical" checked />Vertical lines</label>
        <label class="assay-chart-style-checkbox"><input type="checkbox" data-cc="gridHorizontal" checked />Horizontal lines</label>
        <label>Color<input type="color" data-cc="gridColor" /></label>
        <label>Width<div data-cc="gridStrokeWidth" class="assay-chart-picker-mount"></div></label>
      </fieldset>
      <fieldset class="assay-chart-style-group">
        <legend>Text</legend>
        <div data-cc="textBar"></div>
      </fieldset>
      <fieldset class="assay-chart-style-group">
        <legend>Series colors</legend>
        <div data-cc="seriesColors" class="assay-chart-style-series"></div>
      </fieldset>
      <div class="form-actions assay-chart-style-actions">
        <button type="button" data-cc="resetBtn" class="ghost-btn">Reset to defaults</button>
      </div>
    </div>
  </details>
`;

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

// Builds the full chart-style adjust panel into `container` and binds it to `store`.
// store: { getStyle, setStyle(patch), resetStyle, getContext } (see chart-style-store.js)
export function mountChartControls(container, { store, safeText } = {}) {
  if (!container || !store) {
    return { refresh() {}, destroy() {} };
  }
  const escape = typeof safeText === 'function' ? safeText : defaultSafeText;
  container.innerHTML = PANEL_HTML;
  const q = (key) => container.querySelector(`[data-cc="${key}"]`);

  let suppressInputEvents = false;
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
    pickers.frameCornerRadius = createChartStylePicker(q('frameCornerRadius'), {
      kind: 'corner-radius', options: CORNER_RADIUS_OPTIONS, value: 0, onChange: onFormInput
    });
    pickers.frameWidth = createChartStylePicker(q('frameWidth'), {
      kind: 'dim-width',
      options: FRAME_WIDTH_OPTIONS,
      value: 720,
      min: FRAME_WIDTH_OPTIONS[0].value,
      max: FRAME_WIDTH_OPTIONS[FRAME_WIDTH_OPTIONS.length - 1].value,
      onChange: onFormInput
    });
    pickers.frameHeight = createChartStylePicker(q('frameHeight'), {
      kind: 'dim-height',
      options: FRAME_HEIGHT_OPTIONS,
      value: 360,
      min: FRAME_HEIGHT_OPTIONS[0].value,
      max: FRAME_HEIGHT_OPTIONS[FRAME_HEIGHT_OPTIONS.length - 1].value,
      onChange: onFormInput
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

  function populateColumnOptions(select, headers) {
    if (!select) return;
    const current = select.value || 'auto';
    const options = ['<option value="auto">Auto</option>'];
    headers.forEach((header) => {
      const label = String(header || '').trim();
      if (!label) return;
      options.push(`<option value="${escape(label)}">${escape(label)}</option>`);
    });
    select.innerHTML = options.join('');
    select.value = headers.includes(current) || current === 'auto' ? current : 'auto';
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

  function syncFormFromStyle() {
    const style = store.getStyle();
    const ctx = store.getContext();
    populateColumnOptions(q('xColumn'), ctx.headers);
    populateColumnOptions(q('yColumn'), ctx.headers);
    populateColumnOptions(q('seriesColumn'), ctx.headers);
    q('xColumn') && (q('xColumn').value = ctx.headers.includes(style.xColumn) ? style.xColumn : 'auto');
    q('yColumn') && (q('yColumn').value = ctx.headers.includes(style.yColumn) ? style.yColumn : 'auto');
    q('seriesColumn') && (q('seriesColumn').value = ctx.headers.includes(style.seriesColumn) ? style.seriesColumn : 'auto');

    setValueIfPresent(q('xScale'), style.xScale);
    setValueIfPresent(q('yScale'), style.yScale);
    setValueIfPresent(q('xRangeAuto'), style.xRange.auto);
    setValueIfPresent(q('xMin'), style.xRange.min);
    setValueIfPresent(q('xMax'), style.xRange.max);
    setValueIfPresent(q('yRangeAuto'), style.yRange.auto);
    setValueIfPresent(q('yMin'), style.yRange.min);
    setValueIfPresent(q('yMax'), style.yRange.max);

    if (pickers.pointShape) pickers.pointShape.setValue(style.pointShape);
    setPickerValue(pickers.pointSize, style.pointSize, POINT_SIZE_OPTIONS);
    if (pickers.pointSize) pickers.pointSize.setShapeContext(style.pointShape);
    if (pickers.lineStyle) pickers.lineStyle.setValue(style.lineStyle);
    setValueIfPresent(q('curve'), style.curve);
    setPickerValue(pickers.lineWidth, style.lineWidth, LINE_WIDTH_OPTIONS);
    if (pickers.frameStyle) pickers.frameStyle.setValue(style.frameStyle);
    setValueIfPresent(q('frameStroke'), style.frameStroke);
    setPickerValue(pickers.frameStrokeWidth, style.frameStrokeWidth, STROKE_WIDTH_OPTIONS);
    setPickerValue(pickers.frameCornerRadius, style.frameCornerRadius, CORNER_RADIUS_OPTIONS);
    setValueIfPresent(q('backgroundColor'), style.backgroundColor);
    setValueIfPresent(q('sizeAuto'), style.sizeAuto !== false);
    setPickerValue(pickers.frameWidth, Number.isFinite(style.frameWidth) ? style.frameWidth : 720, FRAME_WIDTH_OPTIONS);
    setPickerValue(pickers.frameHeight, Number.isFinite(style.frameHeight) ? style.frameHeight : 360, FRAME_HEIGHT_OPTIONS);
    setValueIfPresent(q('gridVertical'), style.showVerticalGrid !== false);
    setValueIfPresent(q('gridHorizontal'), style.showHorizontalGrid !== false);
    setValueIfPresent(q('gridColor'), style.gridColor);
    setPickerValue(pickers.gridStrokeWidth, style.gridStrokeWidth, STROKE_WIDTH_OPTIONS);
    if (textControls) textControls.setValue(style.text || {});

    applyRangeDisabledState();
    applySizeDisabledState();
    renderSeriesColors(style, ctx.seriesLabels);
  }

  function applyRangeDisabledState() {
    const xAuto = Boolean(q('xRangeAuto')?.checked);
    const yAuto = Boolean(q('yRangeAuto')?.checked);
    if (q('xMin')) q('xMin').disabled = xAuto;
    if (q('xMax')) q('xMax').disabled = xAuto;
    if (q('yMin')) q('yMin').disabled = yAuto;
    if (q('yMax')) q('yMax').disabled = yAuto;
  }

  function applySizeDisabledState() {
    const auto = Boolean(q('sizeAuto')?.checked);
    if (q('frameWidth')) q('frameWidth').classList.toggle('is-disabled', auto);
    if (q('frameHeight')) q('frameHeight').classList.toggle('is-disabled', auto);
  }

  function clearSeriesColorListeners() {
    while (seriesColorListeners.length) {
      const { input, handler } = seriesColorListeners.pop();
      input.removeEventListener('input', handler);
    }
  }

  function renderSeriesColors(style, seriesLabels) {
    const host = q('seriesColors');
    if (!host) return;
    clearSeriesColorListeners();
    host.innerHTML = '';
    if (!seriesLabels.length) {
      const empty = document.createElement('p');
      empty.className = 'assay-chart-style-series-empty';
      empty.textContent = 'Run analysis to configure series colors.';
      host.appendChild(empty);
      return;
    }
    seriesLabels.forEach((label, index) => {
      const row = document.createElement('div');
      row.className = 'assay-chart-style-series-row';
      const labelEl = document.createElement('span');
      labelEl.textContent = label || `Series ${index + 1}`;
      const input = document.createElement('input');
      input.type = 'color';
      input.value = style.seriesColors[label] || style.palette[index % style.palette.length] || '#1f77b4';
      const handler = () => applyPatch({ seriesColors: { ...style.seriesColors, [label]: input.value } });
      input.addEventListener('input', handler);
      seriesColorListeners.push({ input, handler });
      row.appendChild(labelEl);
      row.appendChild(input);
      host.appendChild(row);
    });
  }

  function parseRangeNumber(input) {
    if (!input) return null;
    const raw = input.value;
    if (raw === '' || raw === null || raw === undefined) return null;
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
  }

  function pickerNumberValue(picker, fallback) {
    if (!picker) return fallback;
    const v = Number(picker.value);
    return Number.isFinite(v) ? v : fallback;
  }

  function readFormPatch() {
    const style = store.getStyle();
    return {
      xColumn: q('xColumn')?.value || 'auto',
      yColumn: q('yColumn')?.value || 'auto',
      seriesColumn: q('seriesColumn')?.value || 'auto',
      xScale: q('xScale')?.value || 'auto',
      yScale: q('yScale')?.value || 'linear',
      xRange: { auto: Boolean(q('xRangeAuto')?.checked), min: parseRangeNumber(q('xMin')), max: parseRangeNumber(q('xMax')) },
      yRange: { auto: Boolean(q('yRangeAuto')?.checked), min: parseRangeNumber(q('yMin')), max: parseRangeNumber(q('yMax')) },
      pointShape: pickers.pointShape ? pickers.pointShape.value : style.pointShape,
      pointSize: pickerNumberValue(pickers.pointSize, style.pointSize),
      lineStyle: pickers.lineStyle ? pickers.lineStyle.value : style.lineStyle,
      curve: q('curve')?.value || style.curve,
      lineWidth: pickerNumberValue(pickers.lineWidth, style.lineWidth),
      frameStyle: pickers.frameStyle ? pickers.frameStyle.value : style.frameStyle,
      frameStroke: q('frameStroke')?.value || style.frameStroke,
      frameStrokeWidth: pickerNumberValue(pickers.frameStrokeWidth, style.frameStrokeWidth),
      frameCornerRadius: pickerNumberValue(pickers.frameCornerRadius, style.frameCornerRadius),
      backgroundColor: q('backgroundColor')?.value || style.backgroundColor,
      sizeAuto: q('sizeAuto') ? Boolean(q('sizeAuto').checked) : style.sizeAuto,
      frameWidth: pickerNumberValue(pickers.frameWidth, style.frameWidth),
      frameHeight: pickerNumberValue(pickers.frameHeight, style.frameHeight),
      showVerticalGrid: q('gridVertical') ? Boolean(q('gridVertical').checked) : style.showVerticalGrid,
      showHorizontalGrid: q('gridHorizontal') ? Boolean(q('gridHorizontal').checked) : style.showHorizontalGrid,
      gridColor: q('gridColor')?.value || style.gridColor,
      gridStrokeWidth: pickerNumberValue(pickers.gridStrokeWidth, style.gridStrokeWidth)
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

  function onResetClick() {
    store.resetStyle();
    suppressInputEvents = true;
    syncFormFromStyle();
    suppressInputEvents = false;
  }

  const nativeInputKeys = [
    'xColumn', 'yColumn', 'seriesColumn', 'xScale', 'yScale',
    'xRangeAuto', 'xMin', 'xMax', 'yRangeAuto', 'yMin', 'yMax',
    'curve', 'frameStroke', 'backgroundColor', 'sizeAuto',
    'gridVertical', 'gridHorizontal', 'gridColor'
  ];

  buildPickers();
  nativeInputKeys.forEach((key) => {
    const input = q(key);
    if (!input) return;
    const event = input.tagName === 'SELECT' || input.type === 'checkbox' ? 'change' : 'input';
    input.addEventListener(event, onFormInput);
  });
  q('resetBtn')?.addEventListener('click', onResetClick);

  suppressInputEvents = true;
  syncFormFromStyle();
  suppressInputEvents = false;

  return {
    refresh() {
      suppressInputEvents = true;
      syncFormFromStyle();
      suppressInputEvents = false;
    },
    destroy() {
      nativeInputKeys.forEach((key) => {
        const input = q(key);
        if (!input) return;
        const event = input.tagName === 'SELECT' || input.type === 'checkbox' ? 'change' : 'input';
        input.removeEventListener(event, onFormInput);
      });
      q('resetBtn')?.removeEventListener('click', onResetClick);
      clearSeriesColorListeners();
      Object.values(pickers).forEach((picker) => picker && picker.destroy());
      if (textControls) textControls.destroy();
      container.innerHTML = '';
    }
  };
}
