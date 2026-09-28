import { RESTRICTION_LIGATION_STRATEGY, STRATEGIES } from './strategies.js';
import { formatPrimerRole } from '../shared.js';

function formatNumber(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '-';
  }
  return number.toFixed(digits);
}

function formatBp(value) {
  return `${Math.max(0, Number(value) || 0).toLocaleString()} bp`;
}

function formatStrategyLabel(strategyId) {
  return [...STRATEGIES, RESTRICTION_LIGATION_STRATEGY].find((strategy) => strategy.id === strategyId)?.shortLabel || 'Cloning design';
}

function formatEditType(type) {
  const normalized = String(type || '').trim().toLowerCase();
  if (normalized === 'point-mutation') {
    return 'point mutation';
  }
  if (normalized === 'insertion') {
    return 'insertion';
  }
  if (normalized === 'deletion') {
    return 'deletion';
  }
  if (normalized === 'replacement') {
    return 'replacement';
  }
  return normalized || 'sequence edit';
}

export {
  formatBp,
  formatEditType,
  formatNumber,
  formatPrimerRole,
  formatStrategyLabel
};
