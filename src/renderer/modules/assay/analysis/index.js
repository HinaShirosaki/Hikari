import {
  normalizeAnalysisSpec,
  resolveGrouping,
  resolveXAxis,
  specFromLegacyMethod
} from './grouping.js';
import { analyzeSummary } from './grouped-summary.js';
import { analyzeCurveFit } from './curve-fit.js';
import { analyzeNormalize } from './dose-response.js';

export {
  ANALYSIS_LABELS,
  ANALYSIS_VALUES,
  GROUP_BY_VALUES,
  X_AXIS_VALUES,
  describeAnalysisSpec,
  normalizeAnalysisSpec,
  specFromLegacyMethod
} from './grouping.js';

// `method` is the legacy flat identifier kept for saved analyses; it maps onto a spec.
export function analyzeAssayData({ spec, method, observations, options = {} }) {
  if (!Array.isArray(observations) || !observations.length) {
    return {
      summary: 'No result values to analyze.',
      headers: [],
      rows: []
    };
  }

  const normalized = spec ? normalizeAnalysisSpec(spec) : specFromLegacyMethod(method);
  if (normalized.analysis === 'summary') {
    const grouping = resolveGrouping(observations, normalized, options, null);
    return analyzeSummary(observations, grouping, normalized);
  }

  const xAxis = resolveXAxis(observations, normalized);
  if (!xAxis) {
    return {
      summary: `This analysis needs numeric ${normalized.xAxis === 'auto' ? 'concentration or sample ID' : normalized.xAxis} values on the X axis.`,
      headers: ['X axis'],
      rows: []
    };
  }

  const grouping = resolveGrouping(observations, normalized, options, xAxis);
  if (normalized.analysis === 'normalize') {
    return analyzeNormalize(observations, grouping, xAxis, normalized);
  }
  return analyzeCurveFit(observations, grouping, xAxis, normalized);
}
