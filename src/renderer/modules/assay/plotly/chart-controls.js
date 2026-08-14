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

// Assay-owned controls for the Plotly figure configuration, grouped into five tabs.
// `data-cc-when="bar|line"` marks a control that only affects one chart type;
// `data-cc-needs` marks one that needs something in the rendered figure.

const TABS = [
  { id: 'data', label: 'Data' },
  { id: 'axes', label: 'Axes' },
  { id: 'series', label: 'Series' },
  { id: 'style', label: 'Style' },
  { id: 'text', label: 'Text' }
];

// Which style fields each tab owns, so "Reset tab" can restore just that section.
const TAB_KEYS = {
  data: ['chartType', 'xColumn', 'yColumn', 'seriesColumn', 'barMode', 'barLabels', 'barCornerRadius'],
  axes: [
    'xScale', 'yScale', 'xRange', 'yRange', 'xTick', 'yTick',
    'tickDir', 'tickLen', 'minorTicks', 'tickFormat', 'refLineAxis', 'refLineValue'
  ],
  series: [
    'mode', 'legendPosition', 'pointShape', 'pointSize', 'markerFill', 'opacity',
    'lineStyle', 'lineWidth', 'seriesColors', 'seriesShapes', 'palette'
  ],
  style: [
    'frameStyle', 'frameStroke', 'frameStrokeWidth', 'backgroundColor',
    'showVerticalGrid', 'showHorizontalGrid', 'gridColor', 'gridStrokeWidth',
    'errorCapWidth', 'errorThickness', 'sizeAuto', 'frameWidth', 'frameHeight'
  ],
  text: ['title', 'xTitle', 'yTitle', 'text']
};

const PANEL_HTML = `
  <div class="assay-chart-style">
    <div class="assay-chart-style-presets">
      <label>
        Preset
        <select data-cc="presetSelect">
          <option value="">Custom</option>
        </select>
      </label>
      <div class="form-actions assay-chart-style-preset-actions">
        <button type="button" data-cc="presetSaveBtn" class="ghost-btn">Save as&hellip;</button>
        <button type="button" data-cc="presetDeleteBtn" class="ghost-btn">Delete</button>
      </div>
    </div>
    <div class="assay-chart-style-tabs" role="tablist" aria-label="Chart format sections">
      ${TABS.map((tab, index) => `
        <button type="button" role="tab" id="assay-cc-tab-${tab.id}"
          aria-controls="assay-cc-panel-${tab.id}"
          aria-selected="${index === 0 ? 'true' : 'false'}"
          data-cc-tab="${tab.id}">${tab.label}</button>
      `).join('')}
    </div>

    <div class="assay-chart-style-panel" role="tabpanel" id="assay-cc-panel-data"
      aria-labelledby="assay-cc-tab-data" data-cc-panel="data">
      <label>X column<select data-cc="xColumn"></select></label>
      <label>Y column<select data-cc="yColumn"></select></label>
      <label>Series column<select data-cc="seriesColumn"></select></label>
      <p class="assay-chart-style-note" data-cc="columnNote"></p>
      <div class="assay-chart-style-subsection" data-cc-when="bar">
        <span class="assay-chart-style-subhead">Bars</span>
        <label>Mode<select data-cc="barMode"><option value="group">Grouped</option><option value="stack">Stacked</option></select></label>
        <label class="assay-chart-style-checkbox"><input type="checkbox" data-cc="barLabels" />Value labels</label>
        <label>Corner radius<input type="number" min="0" max="30" step="1" data-cc="barCornerRadius" /></label>
      </div>
    </div>

    <div class="assay-chart-style-panel" role="tabpanel" id="assay-cc-panel-axes"
      aria-labelledby="assay-cc-tab-axes" data-cc-panel="axes" hidden>
      <div class="assay-chart-style-axis-grid">
        <span></span><span class="assay-chart-style-axis-head">X</span><span class="assay-chart-style-axis-head">Y</span>
        <span class="assay-chart-style-axis-label">Scale</span>
        <select data-cc="xScale" aria-label="X scale" data-cc-when="line">
          <option value="linear">Linear</option><option value="log10">Log10</option>
          <option value="log2">Log2</option><option value="ln">Ln</option>
        </select>
        <select data-cc="yScale" aria-label="Y scale">
          <option value="linear">Linear</option><option value="log10">Log10</option>
          <option value="log2">Log2</option><option value="ln">Ln</option>
        </select>
        <span class="assay-chart-style-axis-label">Auto range</span>
        <input type="checkbox" data-cc="xRangeAuto" aria-label="X auto range" data-cc-when="line" />
        <input type="checkbox" data-cc="yRangeAuto" aria-label="Y auto range" />
        <span class="assay-chart-style-axis-label">Min</span>
        <input type="number" step="any" data-cc="xMin" aria-label="X min" data-cc-when="line" />
        <input type="number" step="any" data-cc="yMin" aria-label="Y min" />
        <span class="assay-chart-style-axis-label">Max</span>
        <input type="number" step="any" data-cc="xMax" aria-label="X max" data-cc-when="line" />
        <input type="number" step="any" data-cc="yMax" aria-label="Y max" />
        <span class="assay-chart-style-axis-label">Tick step</span>
        <input type="number" step="any" min="0" data-cc="xTick" aria-label="X tick interval" data-cc-when="line" />
        <input type="number" step="any" min="0" data-cc="yTick" aria-label="Y tick interval" />
      </div>
      <div class="assay-chart-style-subsection">
        <span class="assay-chart-style-subhead">Ticks</span>
        <label>Marks<select data-cc="tickDir">
          <option value="outside">Outside</option><option value="inside">Inside</option><option value="none">None</option>
        </select></label>
        <label>Length<input type="number" min="0" max="20" step="1" data-cc="tickLen" /></label>
        <label class="assay-chart-style-checkbox"><input type="checkbox" data-cc="minorTicks" />Minor ticks</label>
        <label>Number format<select data-cc="tickFormat">
          <option value="auto">Auto</option><option value="fixed1">0.0</option><option value="fixed2">0.00</option>
          <option value="sci">1e3</option><option value="si">SI (k/M)</option><option value="power">10&#8319;</option>
        </select></label>
      </div>
      <div class="assay-chart-style-subsection">
        <span class="assay-chart-style-subhead">Reference line</span>
        <div class="assay-chart-style-row">
          <label>Axis<select data-cc="refLineAxis">
            <option value="y">Horizontal (Y)</option><option value="x">Vertical (X)</option>
          </select></label>
          <label>Value<input type="number" step="any" data-cc="refLineValue" placeholder="(off)" /></label>
        </div>
      </div>
    </div>

    <div class="assay-chart-style-panel" role="tabpanel" id="assay-cc-panel-series"
      aria-labelledby="assay-cc-tab-series" data-cc-panel="series" hidden>
      <label data-cc-when="line">Display<select data-cc="mode">
        <option value="lines+markers">Line + points</option>
        <option value="lines">Line only</option>
        <option value="markers">Points only</option>
      </select></label>
      <label>Legend<select data-cc="legendPosition">
        <option value="top">Top</option><option value="bottom">Bottom</option>
        <option value="right">Right</option><option value="none">Hidden</option>
      </select></label>
      <div class="assay-chart-style-subsection" data-cc-when="line">
        <span class="assay-chart-style-subhead">Defaults for all series</span>
        <div class="assay-chart-style-row">
          <label>Shape<div data-cc="pointShape" class="assay-chart-picker-mount"></div></label>
          <label>Size<div data-cc="pointSize" class="assay-chart-picker-mount"></div></label>
        </div>
        <div class="assay-chart-style-row">
          <label>Fill<select data-cc="markerFill"><option value="filled">Filled</option><option value="open">Open</option></select></label>
          <label>Opacity<input type="number" min="0.1" max="1" step="0.1" data-cc="opacity" /></label>
        </div>
        <div class="assay-chart-style-row">
          <label>Line<div data-cc="lineStyle" class="assay-chart-picker-mount"></div></label>
          <label>Width (pt)<div data-cc="lineWidth" class="assay-chart-picker-mount"></div></label>
        </div>
      </div>
      <label data-cc-when="bar">Opacity<input type="number" min="0.1" max="1" step="0.1" data-cc="opacityBar" /></label>
      <div class="assay-chart-style-subsection">
        <span class="assay-chart-style-subhead">Overrides</span>
        <div data-cc="seriesColors" class="assay-chart-style-series"></div>
      </div>
    </div>

    <div class="assay-chart-style-panel" role="tabpanel" id="assay-cc-panel-style"
      aria-labelledby="assay-cc-tab-style" data-cc-panel="style" hidden>
      <div class="assay-chart-style-subsection">
        <span class="assay-chart-style-subhead">Frame</span>
        <label>Style<div data-cc="frameStyle" class="assay-chart-picker-mount"></div></label>
        <div class="assay-chart-style-row">
          <label>Stroke<input type="color" data-cc="frameStroke" /></label>
          <label>Width (pt)<div data-cc="frameStrokeWidth" class="assay-chart-picker-mount"></div></label>
        </div>
        <label>Background<input type="color" data-cc="backgroundColor" /></label>
      </div>
      <div class="assay-chart-style-subsection">
        <span class="assay-chart-style-subhead">Grid</span>
        <label class="assay-chart-style-checkbox"><input type="checkbox" data-cc="gridVertical" />Vertical lines</label>
        <label class="assay-chart-style-checkbox"><input type="checkbox" data-cc="gridHorizontal" />Horizontal lines</label>
        <div class="assay-chart-style-row">
          <label>Colour<input type="color" data-cc="gridColor" /></label>
          <label>Width (px)<div data-cc="gridStrokeWidth" class="assay-chart-picker-mount"></div></label>
        </div>
      </div>
      <div class="assay-chart-style-subsection" data-cc-needs="errorBars">
        <span class="assay-chart-style-subhead">Error bars</span>
        <div class="assay-chart-style-row">
          <label>Cap width<input type="number" min="0" max="20" step="1" data-cc="errorCapWidth" /></label>
          <label>Thickness<input type="number" min="0.5" max="6" step="0.5" data-cc="errorThickness" /></label>
        </div>
      </div>
      <div class="assay-chart-style-subsection">
        <span class="assay-chart-style-subhead">Figure size</span>
        <label class="assay-chart-style-checkbox"><input type="checkbox" data-cc="sizeAuto" />Fit to panel</label>
        <div class="assay-chart-style-row">
          <label>Width (px)<input type="number" min="320" max="2000" step="1" data-cc="frameWidth" /></label>
          <label>Height (px)<input type="number" min="180" max="1200" step="1" data-cc="frameHeight" /></label>
        </div>
      </div>
    </div>

    <div class="assay-chart-style-panel" role="tabpanel" id="assay-cc-panel-text"
      aria-labelledby="assay-cc-tab-text" data-cc-panel="text" hidden>
      <label>Chart title<input type="text" data-cc="title" placeholder="(none)" /></label>
      <label>X axis title<input type="text" data-cc="xTitle" placeholder="(from analysis)" /></label>
      <label>Y axis title<input type="text" data-cc="yTitle" placeholder="(from analysis)" /></label>
      <div class="assay-chart-style-subsection">
        <span class="assay-chart-style-subhead">Type</span>
        <div data-cc="textBar"></div>
      </div>
    </div>

    <div class="form-actions assay-chart-style-actions">
      <button type="button" data-cc="resetTabBtn" class="ghost-btn">Reset this tab</button>
      <button type="button" data-cc="resetBtn" class="ghost-btn">Reset all</button>
    </div>
  </div>
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

  function renderColumnOptions(context) {
    const headers = context.headers;
    const note = q('columnNote');
    ['xColumn', 'yColumn', 'seriesColumn'].forEach((key) => {
      const select = q(key);
      if (!select) return;
      const current = store.getStyle()[key] || 'auto';
      select.innerHTML = `<option value="auto">Auto</option>${headers
        .map((header) => `<option value="${escape(header)}">${escape(header)}</option>`)
        .join('')}`;
      select.value = headers.includes(current) ? current : 'auto';
      select.disabled = !headers.length;
    });
    if (note) {
      note.textContent = headers.length
        ? 'Auto picks the column the analysis intends. Override to plot a different metric.'
        : 'Run an analysis to choose which columns are plotted.';
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
    setValueIfPresent(q('backgroundColor'), style.backgroundColor);
    setValueIfPresent(q('sizeAuto'), style.sizeAuto !== false);
    setValueIfPresent(q('frameWidth'), Number.isFinite(style.frameWidth) ? style.frameWidth : '');
    setValueIfPresent(q('frameHeight'), Number.isFinite(style.frameHeight) ? style.frameHeight : '');
    setValueIfPresent(q('gridVertical'), style.showVerticalGrid !== false);
    setValueIfPresent(q('gridHorizontal'), style.showHorizontalGrid !== false);
    setValueIfPresent(q('gridColor'), style.gridColor);
    setPickerValue(pickers.gridStrokeWidth, style.gridStrokeWidth, STROKE_WIDTH_OPTIONS);
    setValueIfPresent(q('title'), style.title);
    setValueIfPresent(q('xTitle'), style.xTitle);
    setValueIfPresent(q('yTitle'), style.yTitle);
    setValueIfPresent(q('mode'), style.mode);
    setValueIfPresent(q('legendPosition'), style.legendPosition);
    setValueIfPresent(q('tickDir'), style.tickDir);
    setValueIfPresent(q('tickLen'), style.tickLen);
    setValueIfPresent(q('minorTicks'), style.minorTicks);
    setValueIfPresent(q('tickFormat'), style.tickFormat);
    setValueIfPresent(q('markerFill'), style.markerFill);
    setValueIfPresent(q('opacity'), style.opacity);
    setValueIfPresent(q('opacityBar'), style.opacity);
    setValueIfPresent(q('errorCapWidth'), style.errorCapWidth);
    setValueIfPresent(q('errorThickness'), style.errorThickness);
    setValueIfPresent(q('refLineAxis'), style.refLineAxis);
    setValueIfPresent(q('refLineValue'), style.refLineValue);
    setValueIfPresent(q('barMode'), style.barMode);
    setValueIfPresent(q('barLabels'), style.barLabels);
    setValueIfPresent(q('barCornerRadius'), style.barCornerRadius);
    if (textControls) textControls.setValue(style.text || {});

    renderColumnOptions(ctx);
    applyContextVisibility(ctx);
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
      empty.textContent = 'Run analysis to configure series colours & shapes.';
      host.appendChild(empty);
      return;
    }
    const isBar = (store.getContext().chartType || 'line') === 'bar';
    seriesLabels.forEach((label, index) => {
      const row = document.createElement('div');
      row.className = 'assay-chart-style-series-row';
      const labelEl = document.createElement('span');
      labelEl.textContent = label || `Series ${index + 1}`;
      row.appendChild(labelEl);

      if (!isBar) {
        const shape = document.createElement('select');
        shape.className = 'assay-chart-style-series-shape';
        shape.setAttribute('aria-label', `Point shape for ${label || `series ${index + 1}`}`);
        shape.innerHTML = `<option value="">Default</option>${SHAPE_OPTIONS
          .map((opt) => `<option value="${opt.value}">${escape(opt.label)}</option>`)
          .join('')}`;
        shape.value = (style.seriesShapes || {})[label] || '';
        const shapeHandler = () => {
          // Read the live style, not the snapshot these rows were built from: a style
          // change does not re-render them, so a captured copy would drop sibling edits.
          const next = { ...store.getStyle().seriesShapes };
          if (shape.value) next[label] = shape.value;
          else delete next[label];
          applyPatch({ seriesShapes: next });
        };
        shape.addEventListener('change', shapeHandler);
        seriesColorListeners.push({ el: shape, event: 'change', handler: shapeHandler });
        row.appendChild(shape);
      }

      const input = document.createElement('input');
      input.type = 'color';
      input.setAttribute('aria-label', `Colour for ${label || `series ${index + 1}`}`);
      input.value = style.seriesColors[label] || style.palette[index % style.palette.length] || '#1f77b4';
      const handler = () => applyPatch({
        seriesColors: { ...store.getStyle().seriesColors, [label]: input.value }
      });
      input.addEventListener('input', handler);
      seriesColorListeners.push({ el: input, event: 'input', handler });
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

  function selectValue(key, fallback) {
    const select = q(key);
    if (!select || select.disabled) return fallback;
    return select.value || fallback;
  }

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
    'title', 'xTitle', 'yTitle', 'mode', 'legendPosition',
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
