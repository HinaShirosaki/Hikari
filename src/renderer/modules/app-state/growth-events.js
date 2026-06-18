import { createId } from '../utils.js';
import { defaultState } from './defaults.js';

const COUNTER_EVENTS = new Set([
  'protocol_share_sent',
  'protocol_share_imported',
  'protocol_share_link_copied',
  'protocol_share_link_imported'
]);

export function trackGrowthEvent(state, name, props = {}) {
  if (!state || typeof state !== 'object') {
    return;
  }
  if (!state.growthMetrics || typeof state.growthMetrics !== 'object') {
    state.growthMetrics = structuredClone(defaultState.growthMetrics);
  }
  if (!state.growthMetrics.counters || typeof state.growthMetrics.counters !== 'object') {
    state.growthMetrics.counters = { ...defaultState.growthMetrics.counters };
  }
  if (!Array.isArray(state.growthMetrics.events)) {
    state.growthMetrics.events = [];
  }
  if (COUNTER_EVENTS.has(name)) {
    state.growthMetrics.counters[name] = (Number(state.growthMetrics.counters[name]) || 0) + 1;
  }
  state.growthMetrics.events.push({
    id: createId(),
    name: String(name || 'unknown'),
    props: props && typeof props === 'object' ? { ...props } : {},
    createdAt: new Date().toISOString()
  });
  if (state.growthMetrics.events.length > 500) {
    state.growthMetrics.events = state.growthMetrics.events.slice(-500);
  }
}
