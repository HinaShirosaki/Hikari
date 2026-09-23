import { plotRevision, validatePlotRequest, normalizePlotElements } from '../../../../shared/assay-plot.mjs';
import { createDefaultChartStyle, normalizeChartStyle } from './chart-style-model.js';
import { validateAxisRange } from './chart-style-targets.js';
import { validatePlotElementAxes } from './plot-elements.js';

const copy = (value) => JSON.parse(JSON.stringify(value));
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const EXCLUDED = ['styleVersion', 'xColumn', 'yColumn', 'seriesColumn'];
export const PLOT_STYLE_FIELDS = Object.keys(createDefaultChartStyle()).filter((key) => !EXCLUDED.includes(key));
function merge(base, patch) {
  if (!object(patch)) return copy(patch);
  const next = { ...base };
  for (const [key, value] of Object.entries(patch)) next[key] = object(value) ? merge(base?.[key] || {}, value) : copy(value);
  return next;
}
function checkPreserved(patch, normalized, path = 'style') {
  if (object(patch) || Array.isArray(patch)) {
    if (!normalized || typeof normalized !== 'object') throw new Error(`Invalid ${path}.`);
    for (const [key, value] of Object.entries(patch)) {
      if (!Object.hasOwn(normalized, key)) throw new Error(`Unsupported ${path}.${key}.`);
      checkPreserved(value, normalized[key], `${path}.${key}`);
    }
  } else if (patch !== normalized) throw new Error(`Invalid or out-of-range ${path}.`);
}
export function preparePlotStylePatch(current, patch, context) {
  for (const key of Object.keys(patch)) if (!PLOT_STYLE_FIELDS.includes(key)) throw new Error(`Unsupported style field: ${key}`);
  if (context.hasFittedCurve && patch.chartType && patch.chartType !== 'auto' && patch.chartType !== current.chartType) throw new Error('The fitted analysis determines its chart type.');
  for (const label of Object.keys(patch.seriesStyles || {})) if (!context.seriesLabels.includes(label)) throw new Error(`Unknown series: ${label}`);
  for (const key of ['seriesColors', 'seriesShapes']) {
    for (const label of Object.keys(patch[key] || {})) if (!context.seriesLabels.includes(label)) throw new Error(`Unknown series: ${label}`);
  }
  if (context.hasCategoryX && ['xScale', 'xRange', 'xTick'].some((key) => Object.hasOwn(patch, key))) throw new Error('The X axis uses categories; numeric scale/range/tick controls do not apply.');
  if (patch.plotElements) normalizePlotElements(patch.plotElements);
  const next = normalizeChartStyle(merge(current, patch));
  checkPreserved(patch, next);
  for (const axis of ['x', 'y']) {
    const error = validateAxisRange(next[`${axis}Scale`], next[`${axis}Range`]);
    if (error) throw new Error(error);
    if (next[`${axis}Tick`] !== null && next[`${axis}Tick`] <= 0) throw new Error('Tick intervals must be positive.');
  }
  validatePlotElementAxes(next.plotElements, {
    x: { type: context.hasCategoryX ? 'category' : next.xScale === 'linear' ? 'linear' : 'log' },
    y: { type: next.yScale === 'linear' ? 'linear' : 'log' }
  });
  return next;
}

export function createPlotAgentController({ getAssay, isActive, analysisView, persist, onChanged }) {
  let queue = Promise.resolve();
  async function snapshot(assay) {
    const plot = analysisView.getPlotSnapshot();
    return { assay_id: assay.id, revision: await plotRevision(plot), style: plot.style, context: plot.context,
      supported_style_fields: PLOT_STYLE_FIELDS, source: 'native', persistence: 'app_state' };
  }
  async function apply(input, { deadline = Infinity } = {}) {
    try { validatePlotRequest(input); } catch (error) { return { ok: false, status: 'invalid_arguments', error: error.message }; }
    const assay = getAssay();
    const available = () => getAssay() === assay && isActive() && Date.now() < deadline;
    if (!assay || !available()) return { ok: false, status: 'plot_unavailable', error: 'Open the target assay in Analyze.' };
    if (input.assay_id && input.assay_id !== assay.id) return { ok: false, status: 'assay_mismatch', error: 'The active assay changed; read its plot before editing.' };
    const currentRender = await analysisView.plotReady();
    const before = analysisView.getPlotSnapshot();
    if (!before.available) return { ok: false, status: 'plot_unavailable', error: before.context.method === 'agent_plotly'
      ? 'This is a custom agent figure. Edit its data/layout with plotly_graph; assay_plot controls native analysis plots.' : 'Render an analysis plot first.' };
    const state = await snapshot(assay);
    if (!available()) return { ok: false, status: 'context_changed', error: 'The assay changed while reading the plot.' };
    if (input.action === 'read') return { ok: true, status: 'read', ...state, rendered: currentRender.ok, render_error: currentRender.error };
    const signature = await plotRevision(input);
    const receipt = (assay.plotToolReceipts || []).find((item) => item.id === input.request_id);
    if (receipt) return receipt.signature === signature
      ? { ok: true, status: 'already_applied', ...state }
      : { ok: false, status: 'invalid_arguments', error: 'request_id was used for different input.' };
    if (input.expected_revision !== state.revision) return { ok: false, status: 'revision_conflict', error: 'Read the current plot and retry with its revision and a new request_id.', ...state };
    let next;
    try { next = preparePlotStylePatch(before.style, input.style, before.context); }
    catch (error) { return { ok: false, status: 'invalid_arguments', error: error.message }; }
    if (!available() || JSON.stringify(analysisView.getPlotSnapshot()) !== JSON.stringify(before)) return { ok: false, status: 'context_changed', error: 'Plot changed before application. Read it again.' };
    const oldSavedStyle = assay.chartStyle;
    const oldUpdatedAt = assay.updatedAt;
    const oldReceipts = assay.plotToolReceipts;
    const oldPreview = assay.latestAnalysis;
    let candidate;
    try {
      const ready = analysisView.replacePlotStyle(next);
      candidate = JSON.stringify(analysisView.getPlotSnapshot());
      const rendered = await ready;
      if (!available() || JSON.stringify(analysisView.getPlotSnapshot()) !== candidate) return { ok: false, status: 'context_changed', error: 'Plot changed during rendering. Read the current plot before another edit.' };
      if (!rendered.ok) throw new Error(rendered.error || 'Plot rendering failed.');
      const previewImage = oldPreview && analysisView.capturePlotImage ? await analysisView.capturePlotImage() : '';
      if (!available() || JSON.stringify(analysisView.getPlotSnapshot()) !== candidate) return { ok: false, status: 'context_changed', error: 'Plot changed while capturing its preview. Read the current plot before another edit.' };
      assay.chartStyle = next;
      assay.updatedAt = new Date().toISOString();
      assay.plotToolReceipts = [...(oldReceipts || []), { id: input.request_id, signature }].slice(-32);
      if (oldPreview && previewImage) assay.latestAnalysis = { ...oldPreview, chartDataUrl: previewImage };
      await persist({ external: true });
    } catch (error) {
      assay.chartStyle = oldSavedStyle;
      assay.updatedAt = oldUpdatedAt;
      assay.plotToolReceipts = oldReceipts;
      assay.latestAnalysis = oldPreview;
      if (available() && (!candidate || JSON.stringify(analysisView.getPlotSnapshot()) === candidate)) await analysisView.replacePlotStyle(before.style);
      return { ok: false, status: 'update_failed', error: error.message };
    }
    onChanged?.();
    return { ok: true, status: 'applied', rendered: true, ...await snapshot(assay),
      persistence_note: 'Saved in application state; storage-folder auto-save completion is not acknowledged.' };
  }
  return { execute(input, options) {
    const job = queue.then(() => apply(input, options));
    queue = job.catch(() => {});
    return job;
  } };
}
