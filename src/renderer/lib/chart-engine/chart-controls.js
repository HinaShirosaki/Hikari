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

const PANEL_HTML = `
  <details class="assay-chart-style">
    <summary class="assay-chart-style-summary">Chart Style</summary>
    <div class="assay-chart-style-body">
      <fieldset class="assay-chart-style-group">
        <legend>Figure</legend>
        <label>Title<input type="text" data-cc="title" placeholder="(none)" /></label>
        <label>Display<select data-cc="mode">
          <option value="lines+markers">Line + points</option>
          <option value="lines">Line only</option>
          <option value="markers">Points only</option>
        </select></label>
        <label>Legend<select data-cc="legendPosition">
          <option value="top">Top</option><option value="bottom">Bottom</option>
          <option value="right">Right</option><option value="none">Hidden</option>
        </select></label>
      </fieldset>
      <fieldset class="assay-chart-style-group">
        <legend>Scale &amp; range</legend>
        <label>X scale<select data-cc="xScale">
          <option value="linear">Linear</option><option value="log10">Log10</option>
          <option value="log2">Log2</option><option value="ln">Ln</option>
        </select></label>
        <label>Y scale<select data-cc="yScale">
          <option value="linear">Linear</option><option value="log10">Log10</option>
          <option value="log2">Log2</option><option value="ln">Ln</option>
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
        <div class="assay-chart-style-row">
          <label>X tick interval<input type="number" step="any" min="0" data-cc="xTick" /></label>
          <label>Y tick interval<input type="number" step="any" min="0" data-cc="yTick" /></label>
        </div>
      </fieldset>
      <fieldset class="assay-chart-style-group">
        <legend>Ticks</legend>
        <label>Marks<select data-cc="tickDir">
          <option value="outside">Outside</option><option value="inside">Inside</option><option value="none">None</option>
        </select></label>
        <label>Length<input type="number" min="0" max="20" step="1" data-cc="tickLen" /></label>
        <label class="assay-chart-style-checkbox"><input type="checkbox" data-cc="minorTicks" />Minor ticks</label>
        <label>Number format<select data-cc="tickFormat">
          <option value="auto">Auto</option><option value="fixed1">0.0</option><option value="fixed2">0.00</option>
          <option value="sci">1e3</option><option value="si">SI (k/M)</option><option value="power">10ⁿ</option>
        </select></label>
      </fieldset>
      <fieldset class="assay-chart-style-group">
        <legend>Points</legend>
        <label>Shape<div data-cc="pointShape" class="assay-chart-picker-mount"></div></label>
        <label>Size<div data-cc="pointSize" class="assay-chart-picker-mount"></div></label>
        <label>Fill<select data-cc="markerFill"><option value="filled">Filled</option><option value="open">Open</option></select></label>
        <label>Opacity<input type="number" min="0.1" max="1" step="0.1" data-cc="opacity" /></label>
      </fieldset>
      <fieldset class="assay-chart-style-group">
        <legend>Lines</legend>
        <label>Style<div data-cc="lineStyle" class="assay-chart-picker-mount"></div></label>
        <label>Width (pt)<div data-cc="lineWidth" class="assay-chart-picker-mount"></div></label>
      </fieldset>
      <fieldset class="assay-chart-style-group">
        <legend>Error bars</legend>
        <label>Cap width<input type="number" min="0" max="20" step="1" data-cc="errorCapWidth" /></label>
        <label>Thickness<input type="number" min="0.5" max="6" step="0.5" data-cc="errorThickness" /></label>
      </fieldset>
      <fieldset class="assay-chart-style-group">
        <legend>Frame</legend>
        <label>Style<div data-cc="frameStyle" class="assay-chart-picker-mount"></div></label>
        <label>Stroke<input type="color" data-cc="frameStroke" /></label>
        <label>Stroke width (pt)<div data-cc="frameStrokeWidth" class="assay-chart-picker-mount"></div></label>
      </fieldset>
      <fieldset class="assay-chart-style-group">
        <legend>Reference line</legend>
        <label>Axis<select data-cc="refLineAxis">
          <option value="y">Horizontal (Y)</option><option value="x">Vertical (X)</option>
        </select></label>
        <label>Value<input type="number" step="any" data-cc="refLineValue" placeholder="(off)" /></label>
      </fieldset>
      <fieldset class="assay-chart-style-group">
        <legend>Size</legend>
        <label class="assay-chart-style-checkbox"><input type="checkbox" data-cc="sizeAuto" checked />Auto size</label>
        <label>Width (px)<input type="number" min="320" max="2000" step="1" data-cc="frameWidth" /></label>
        <label>Height (px)<input type="number" min="180" max="1200" step="1" data-cc="frameHeight" /></label>
      </fieldset>
      <fieldset class="assay-chart-style-group">
        <legend>Bars</legend>
        <label>Mode<select data-cc="barMode"><option value="group">Grouped</option><option value="stack">Stacked</option></select></label>
        <label class="assay-chart-style-checkbox"><input type="checkbox" data-cc="barLabels" />Value labels</label>
        <label>Corner radius<input type="number" min="0" max="30" step="1" data-cc="barCornerRadius" /></label>
      </fieldset>
      <fieldset class="assay-chart-style-group">
        <legend>Grid lines</legend>
        <label class="assay-chart-style-checkbox"><input type="checkbox" data-cc="gridVertical" checked />Vertical lines</label>
        <label class="assay-chart-style-checkbox"><input type="checkbox" data-cc="gridHorizontal" checked />Horizontal lines</label>
        <label>Color<input type="color" data-cc="gridColor" /></label>
        <label>Width (px)<div data-cc="gridStrokeWidth" class="assay-chart-picker-mount"></div></label>
      </fieldset>
      <fieldset class="assay-chart-style-group">
        <legend>Text</legend>
        <div data-cc="textBar"></div>
      </fieldset>
      <fieldset class="assay-chart-style-group">
        <legend>Series colors &amp; shapes</legend>
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

  function syncFormFromStyle() {
    const style = store.getStyle();
    const ctx = store.getContext();

    setValueIfPresent(q('xScale'), style.xScale);
    setValueIfPresent(q('yScale'), style.yScale);
    setValueIfPresent(q('xRangeAuto'), style.xRange.auto);
    setValueIfPresent(q('xMin'), style.xRange.min);
    setValueIfPresent(q('xMax'), style.xRange.max);
    setValueIfPresent(q('yRangeAuto'), style.yRange.auto);
    setValueIfPresent(q('yMin'), style.yRange.min);
    setValueIfPresent(q('yMax'), style.yRange.max);
    setValueIfPresent(q('xTick'), style.xTick);
    setValueIfPresent(q('yTick'), style.yTick);

    if (pickers.pointShape) pickers.pointShape.setValue(style.pointShape);
    setPickerValue(pickers.pointSize, style.pointSize, POINT_SIZE_OPTIONS);
    if (pickers.pointSize) pickers.pointSize.setShapeContext(style.pointShape);
    if (pickers.lineStyle) pickers.lineStyle.setValue(style.lineStyle);
    setPickerValue(pickers.lineWidth, style.lineWidth, LINE_WIDTH_OPTIONS);
    if (pickers.frameStyle) pickers.frameStyle.setValue(style.frameStyle);
    setValueIfPresent(q('frameStroke'), style.frameStroke);
    setPickerValue(pickers.frameStrokeWidth, style.frameStrokeWidth, STROKE_WIDTH_OPTIONS);
    setValueIfPresent(q('sizeAuto'), style.sizeAuto !== false);
    setValueIfPresent(q('frameWidth'), Number.isFinite(style.frameWidth) ? style.frameWidth : '');
    setValueIfPresent(q('frameHeight'), Number.isFinite(style.frameHeight) ? style.frameHeight : '');
    setValueIfPresent(q('gridVertical'), style.showVerticalGrid !== false);
    setValueIfPresent(q('gridHorizontal'), style.showHorizontalGrid !== false);
    setValueIfPresent(q('gridColor'), style.gridColor);
    setPickerValue(pickers.gridStrokeWidth, style.gridStrokeWidth, STROKE_WIDTH_OPTIONS);
    setValueIfPresent(q('title'), style.title);
    setValueIfPresent(q('mode'), style.mode);
    setValueIfPresent(q('legendPosition'), style.legendPosition);
    setValueIfPresent(q('tickDir'), style.tickDir);
    setValueIfPresent(q('tickLen'), style.tickLen);
    setValueIfPresent(q('minorTicks'), style.minorTicks);
    setValueIfPresent(q('tickFormat'), style.tickFormat);
    setValueIfPresent(q('markerFill'), style.markerFill);
    setValueIfPresent(q('opacity'), style.opacity);
    setValueIfPresent(q('errorCapWidth'), style.errorCapWidth);
    setValueIfPresent(q('errorThickness'), style.errorThickness);
    setValueIfPresent(q('refLineAxis'), style.refLineAxis);
    setValueIfPresent(q('refLineValue'), style.refLineValue);
    setValueIfPresent(q('barMode'), style.barMode);
    setValueIfPresent(q('barLabels'), style.barLabels);
    setValueIfPresent(q('barCornerRadius'), style.barCornerRadius);
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
    if (q('frameWidth')) q('frameWidth').disabled = auto;
    if (q('frameHeight')) q('frameHeight').disabled = auto;
  }

  function clampDim(value, min, max) {
    if (value == null) return null;
    return Math.max(min, Math.min(max, value));
  }

  function clearSeriesColorListeners() {
    while (seriesColorListeners.length) {
      const { el, event, handler } = seriesColorListeners.pop();
      el.removeEventListener(event, handler);
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
      empty.textContent = 'Run analysis to configure series colors & shapes.';
      host.appendChild(empty);
      return;
    }
    seriesLabels.forEach((label, index) => {
      const row = document.createElement('div');
      row.className = 'assay-chart-style-series-row';
      const labelEl = document.createElement('span');
      labelEl.textContent = label || `Series ${index + 1}`;

      const shape = document.createElement('select');
      shape.className = 'assay-chart-style-series-shape';
      shape.innerHTML = `<option value="">Default</option>${SHAPE_OPTIONS
        .map((opt) => `<option value="${opt.value}">${escape(opt.label)}</option>`)
        .join('')}`;
      shape.value = (style.seriesShapes || {})[label] || '';
      const shapeHandler = () => {
        const next = { ...style.seriesShapes };
        if (shape.value) next[label] = shape.value;
        else delete next[label];
        applyPatch({ seriesShapes: next });
      };
      shape.addEventListener('change', shapeHandler);
      seriesColorListeners.push({ el: shape, event: 'change', handler: shapeHandler });

      const input = document.createElement('input');
      input.type = 'color';
      input.value = style.seriesColors[label] || style.palette[index % style.palette.length] || '#1f77b4';
      const handler = () => applyPatch({ seriesColors: { ...style.seriesColors, [label]: input.value } });
      input.addEventListener('input', handler);
      seriesColorListeners.push({ el: input, event: 'input', handler });

      row.appendChild(labelEl);
      row.appendChild(shape);
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
      sizeAuto: q('sizeAuto') ? Boolean(q('sizeAuto').checked) : style.sizeAuto,
      frameWidth: clampDim(parseRangeNumber(q('frameWidth')), 320, 2000),
      frameHeight: clampDim(parseRangeNumber(q('frameHeight')), 180, 1200),
      showVerticalGrid: q('gridVertical') ? Boolean(q('gridVertical').checked) : style.showVerticalGrid,
      showHorizontalGrid: q('gridHorizontal') ? Boolean(q('gridHorizontal').checked) : style.showHorizontalGrid,
      gridColor: q('gridColor')?.value || style.gridColor,
      gridStrokeWidth: pickerNumberValue(pickers.gridStrokeWidth, style.gridStrokeWidth),
      title: q('title') ? q('title').value : style.title,
      mode: q('mode')?.value || 'lines+markers',
      legendPosition: q('legendPosition')?.value || 'top',
      tickDir: q('tickDir')?.value || 'outside',
      tickLen: parseRangeNumber(q('tickLen')),
      minorTicks: q('minorTicks') ? Boolean(q('minorTicks').checked) : style.minorTicks,
      tickFormat: q('tickFormat')?.value || 'auto',
      markerFill: q('markerFill')?.value || 'filled',
      opacity: parseRangeNumber(q('opacity')),
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

  function onResetClick() {
    store.resetStyle();
    suppressInputEvents = true;
    syncFormFromStyle();
    suppressInputEvents = false;
  }

  const nativeInputKeys = [
    'xScale', 'yScale',
    'xRangeAuto', 'xMin', 'xMax', 'yRangeAuto', 'yMin', 'yMax',
    'xTick', 'yTick',
    'frameStroke', 'sizeAuto', 'frameWidth', 'frameHeight',
    'gridVertical', 'gridHorizontal', 'gridColor',
    'title', 'mode', 'legendPosition',
    'tickDir', 'tickLen', 'minorTicks', 'tickFormat',
    'markerFill', 'opacity', 'errorCapWidth', 'errorThickness',
    'refLineAxis', 'refLineValue', 'barMode', 'barLabels', 'barCornerRadius'
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
