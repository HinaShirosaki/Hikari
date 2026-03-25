import {
  analyzeDimensionSummary,
  analyzeGroupedSummary,
  analyzeNestedSummary
} from './grouped-summary.js';
import { analyzeLinearRegression } from './regression.js';
import {
  analyzeEc50Like,
  analyzeSurvival
} from './dose-response.js';
import {
  analyzeStandardCurve,
  isStandardCurveMethod
} from './standard-curve.js';

export function analyzeAssayData({ method, observations, options = {} }) {
  if (!Array.isArray(observations) || !observations.length) {
    return {
      summary: 'No result values to analyze.',
      headers: [],
      rows: []
    };
  }

  if (method === 'nested_summary') {
    return analyzeNestedSummary(observations);
  }
  if (method === 'row_summary') {
    return analyzeDimensionSummary(observations, 'row', options.rowSummary || {});
  }
  if (method === 'column_summary') {
    return analyzeDimensionSummary(observations, 'column', options.columnSummary || {});
  }
  if (method === 'linear_regression') {
    return analyzeLinearRegression(observations);
  }
  if (method === 'ec50') {
    return analyzeEc50Like(observations, 'ec50');
  }
  if (method === 'ic50') {
    return analyzeEc50Like(observations, 'ic50');
  }
  if (method === 'survival') {
    return analyzeSurvival(observations);
  }
  if (isStandardCurveMethod(method)) {
    return analyzeStandardCurve(observations, method);
  }
  return analyzeGroupedSummary(observations);
}
