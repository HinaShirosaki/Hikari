import { pixelsToPoints } from './chart-style-model.js';
import { resolveAxisStyle, resolveSeriesStyle } from './chart-style-targets.js';

export const POINT_FIELDS = new Set(['frameStrokeWidth', 'gridStrokeWidth', 'pointSize', 'lineWidth',
  'xTickLen', 'yTickLen', 'barOutlineWidth', 'barCornerRadius', 'errorCapWidth', 'errorThickness']);
// Per-axis field suffixes; the data-cc key is the axis plus the suffix (xScale, yTickDir…).
export const AXIS_FIELDS = ['Scale', 'RangeAuto', 'Min', 'Max', 'TickPreset', 'Tick',
  'TickDir', 'TickLen', 'MinorTicks', 'TickFormat', 'TickAngle'];
export const AXIS_STYLE_SUFFIXES = ['TickDir', 'TickLen', 'MinorTicks', 'TickFormat', 'TickAngle'];
export const axisStyleKey = (suffix) => suffix[0].toLowerCase() + suffix.slice(1);
export const GLOBAL_FIELDS = ['frameStroke', 'frameStrokeWidth', 'backgroundColor', 'showVerticalGrid',
  'showHorizontalGrid', 'gridColor', 'gridStrokeWidth', 'sizeAuto', 'frameWidth', 'frameHeight',
  'refLineAxis', 'refLineValue', 'chartType', 'barMode', 'barLabels', 'barCornerRadius', 'legendPosition',
  'xColumn', 'yColumn', 'seriesColumn'];
export const SERIES_FIELDS = ['color', 'pointShape', 'pointSize', 'markerFill', 'opacity', 'mode',
  'lineStyle', 'lineWidth', 'barOutlineColor', 'barOutlineWidth', 'errorColor', 'errorCapWidth', 'errorThickness'];

const TICK_PRESETS = {
  linear: [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100].map((value) => [String(value), String(value)]),
  // Labels stay short so they read inside the half-width axis column; the hint below spells out the base.
  log10: [['1', '10×'], ['2', '100×'], ['3', '1000×']],
  log2: [['1', '2×'], ['2', '4×'], ['3', '8×'], ['4', '16×']],
  ln: [['1', 'e×'], ['2', 'e²×'], ['3', 'e³×']]
};

// Form synchronization never commits values. Target changes cannot mutate chart state.
export function createChartControlsForm({ q, store, selection, pickers, textControls }) {
  function set(key, value) {
    const field = q(key);
    if (!field) return;
    if (field.type === 'checkbox') field.checked = Boolean(value);
    else {
      const next = value === null || value === undefined ? '' : String(value);
      if (field.value !== next) field.value = next;
    }
  }
  function options(key, entries) {
    const field = q(key);
    const signature = JSON.stringify(entries);
    if (field.dataset.options === signature) return;
    field.replaceChildren(...entries.map(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      return option;
    }));
    field.dataset.options = signature;
  }
  function refreshAxis(axis, style, context) {
    const axisStyle = resolveAxisStyle(style, axis);
    const scale = style[`${axis}Scale`];
    set(`${axis}Scale`, scale);
    const range = style[`${axis}Range`];
    set(`${axis}RangeAuto`, range.auto);
    set(`${axis}Min`, range.min);
    set(`${axis}Max`, range.max);
    q(`${axis}Min`).disabled = range.auto;
    q(`${axis}Max`).disabled = range.auto;
    const tick = style[`${axis}Tick`];
    const tickPresets = TICK_PRESETS[scale];
    const customTick = selection.customTick[axis] || (tick !== null && !tickPresets.some(([value]) => Number(value) === tick));
    options(`${axis}TickPreset`, [['auto', 'Auto'], ...tickPresets, ['custom', 'Custom…']]);
    set(`${axis}TickPreset`, customTick ? 'custom' : tick === null ? 'auto' : tick);
    set(`${axis}Tick`, tick);
    q(`${axis}Tick`).closest('label').hidden = !customTick;
    q(`${axis}Tick`).title = scale !== 'linear'
      ? 'Interval in powers of the selected base; 1 labels each power.' : 'Interval in data units.';
    q(`${axis}TickHint`).textContent = scale === 'linear' ? ''
      : `Steps in powers of ${scale === 'log10' ? '10' : scale === 'log2' ? '2' : 'e'}; 1 labels each power.`;
    q(`${axis}TickHint`).hidden = !customTick || scale === 'linear';
    AXIS_STYLE_SUFFIXES.forEach((suffix) => {
      const field = axisStyleKey(suffix);
      set(`${axis}${suffix}`, field === 'tickLen' ? pixelsToPoints(axisStyle[field]) : axisStyle[field]);
    });
    const category = axis === 'x' && context.hasCategoryX;
    q(`${axis}NumericFields`).hidden = category;
    q(`${axis}NumericTickFields`).hidden = category;
  }
  function refresh() {
    const style = store.getStyle();
    const context = store.getContext();
    const seriesIndex = context.seriesLabels.indexOf(selection.series);
    if (seriesIndex < 0) selection.series = null;
    const series = resolveSeriesStyle(selection.series === null
      ? { ...style, seriesStyles: {}, seriesColors: {}, seriesShapes: {} } : style,
    selection.series ?? '', Math.max(0, seriesIndex));
    GLOBAL_FIELDS.forEach((key) => set(key, POINT_FIELDS.has(key) ? pixelsToPoints(style[key]) : style[key]));
    pickers.frameStyle.setValue(style.frameStyle);
    ['frameWidth', 'frameHeight'].forEach((key) => { q(key).disabled = style.sizeAuto; });
    ['gridColor', 'gridStrokeWidth'].forEach((key) => {
      q(key).disabled = !style.showVerticalGrid && !style.showHorizontalGrid;
    });
    ['x', 'y'].forEach((axis) => refreshAxis(axis, style, context));
    options('seriesTarget', [['', 'All series'], ...context.seriesLabels.map((label, i) => [String(i), label || `Series ${i + 1}`])]);
    set('seriesTarget', selection.series === null ? '' : String(seriesIndex));
    q('seriesDefaults').hidden = selection.series === null;
    SERIES_FIELDS.forEach((key) => {
      const value = key === 'barOutlineColor' ? series[key] || style.frameStroke
        : key === 'errorColor' ? series[key] || (context.chartType === 'bar' ? style.frameStroke : series.color)
          : series[key];
      if (pickers[key]) pickers[key].setValue(value);
      else set(key, POINT_FIELDS.has(key) ? pixelsToPoints(value) : value);
    });
    // A fitted curve is a sampled line plus its markers; bars would be meaningless.
    q('chartType').disabled = context.chartType === 'line' && context.hasFittedCurve;
    q('symbolFields').hidden = context.chartType === 'bar' && !context.hasReplicates;
    q('errorFields').hidden = !context.hasErrorBars;
    q('columnFields').hidden = context.hasFittedCurve;
    q('columnNote').textContent = context.hasFittedCurve ? 'The fitted analysis determines its plotted columns.' : '';
    q('columnNote').hidden = !context.hasFittedCurve;
    ['xColumn', 'yColumn', 'seriesColumn'].forEach((key) => {
      const headers = key === 'yColumn' ? context.numericHeaders : context.headers;
      options(key, [['auto', 'Auto'], ...headers.map((name) => [name, name])]);
      set(key, headers.includes(style[key]) ? style[key] : 'auto');
      q(key).disabled = !headers.length;
    });
    if (selection.text === 'barLabels' && context.chartType !== 'bar') selection.text = 'title';
    set('textTarget', selection.text);
    const barTextOption = q('textTarget').querySelector('option[value="barLabels"]');
    barTextOption.disabled = context.chartType !== 'bar';
    const target = selection.text;
    q('titleFields').hidden = !['title', 'xTitle', 'yTitle'].includes(target);
    set('titleText', style[target]);
    q('titleText').placeholder = target === 'title' ? '(none)' : '(from analysis)';
    const prefix = target === 'title' ? 'title' : target;
    set('titlePos', style[`${prefix}Pos`]);
    const offset = style[`${prefix}Offset`];
    set('titleOffset', Number.isFinite(offset) ? pixelsToPoints(offset) : null);
    const text = style.textStyles[target];
    textControls.setValue({ ...text, fontSize: pixelsToPoints(text.fontSize) });
    q('frameStyle').closest('.assay-chart-style').querySelectorAll('[data-cc-when]').forEach((element) => {
      element.hidden = element.dataset.ccWhen !== (context.chartType || 'line');
    });
  }
  return { refresh, set, options };
}
