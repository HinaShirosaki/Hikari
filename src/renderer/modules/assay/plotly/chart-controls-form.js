import { escapeHtml as escape } from '../../../lib/html.js';
import {
  LINE_WIDTH_OPTIONS,
  POINT_SIZE_OPTIONS,
  SHAPE_OPTIONS,
  STROKE_WIDTH_OPTIONS
} from './chart-style-pickers.js';

// Pushes the stored chart style into the form controls and keeps the
// per-series colour rows in sync with whatever the figure currently plots.
function createChartControlsForm({
  q,
  store,
  pickers,
  textControls,
  seriesColorListeners,
  setValueIfPresent,
  setPickerValue,
  applyContextVisibility,
  renderColumnOptions,
  applyPatch
} = {}) {
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
    setValueIfPresent(q('xTitlePos'), style.xTitlePos);
    setValueIfPresent(q('yTitlePos'), style.yTitlePos);
    setValueIfPresent(q('xTitleOffset'), style.xTitleOffset);
    setValueIfPresent(q('yTitleOffset'), style.yTitleOffset);
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

  return {
    syncFormFromStyle,
    applyRangeDisabledState,
    applySizeDisabledState,
    clampDim,
    clearSeriesColorListeners,
    renderSeriesColors,
    parseRangeNumber,
    pickerNumberValue,
    selectValue
  };
}

export { createChartControlsForm };
