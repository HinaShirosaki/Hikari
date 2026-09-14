#!/usr/bin/env node
// Self-check for placeholder prefill: identity slots (samples) are never
// suggested; parameters are suggested only when every recent run agreed.
// Run: node tests/placeholder-prefill-selfcheck.mjs
import assert from 'node:assert/strict';
import { buildPlaceholderPrefill } from '../src/renderer/modules/biology-notebook/protocol/placeholder-prefill.js';

const protocol = {
  id: 'ninta',
  steps: [
    { id: 's1', text: 'Load {{ph:p1}} onto the column', placeholders: [{ id: 'p1', name: 'protein' }] },
    { id: 's2', text: 'Wash with {{ph:p2}} of buffer at {{ph:p3}}', placeholders: [{ id: 'p2', name: 'volume' }, { id: 'p3', name: 'temperature' }] },
    { id: 's3', text: 'Elute with {{ph:p4}} imidazole', placeholders: [{ id: 'p4', name: 'imidazole conc' }] },
    { id: 's4', text: 'Note {{ph:p5}}', placeholders: [{ id: 'p5', name: 'operator' }] }
  ]
};
const resolveType = (name) => (name === 'protein' ? 'protein' : '');
const run = (id, when, values, sampleLinks = []) => ({ id, protocolId: 'ninta', updatedAt: when, values, sampleLinks });

const entries = [
  run('e1', '2026-09-01', { 's1:p1': 'EGFR-ECD lot 3', 's2:p2': '10 mL', 's2:p3': '4 °C', 's3:p4': '250 mM', 's4:p5': 'YS' }),
  run('e2', '2026-09-05', { 's1:p1': 'PD-1 lot 1', 's2:p2': '10 mL', 's2:p3': '4 °C', 's3:p4': '300 mM', 's4:p5': 'YS' },
    [{ placeholderKey: 's4:p5', placeholderName: 'operator', sampleId: 'x' }]),
  run('e3', '2026-09-10', { 's1:p1': 'HER2 lot 2', 's2:p2': '10 mL', 's2:p3': '', 's3:p4': '250 mM', 's4:p5': 'YS' }),
  { id: 'other', protocolId: 'pcr', updatedAt: '2026-09-11', values: { 's2:p2': '50 µL' } }
];

const prefill = buildPlaceholderPrefill({ protocol, entries, resolveType });

// protein: name resolves to a sample type -> identity, never suggested even though it had values
assert.deepEqual(prefill['s1:p1'], { kind: 'identity', suggestion: '' });
// operator: a previous run linked a sample to it -> identity
assert.deepEqual(prefill['s4:p5'], { kind: 'identity', suggestion: '' });
// volume: same in every run -> suggested
assert.deepEqual(prefill['s2:p2'], { kind: 'parameter', suggestion: '10 mL' });
// temperature: agreed wherever it was filled (blanks are not disagreement) -> suggested
assert.deepEqual(prefill['s2:p3'], { kind: 'parameter', suggestion: '4 °C' });
// imidazole: varied -> no suggestion
assert.deepEqual(prefill['s3:p4'], { kind: 'parameter', suggestion: '' });

// history is per protocol: pcr sees only its own single run, never ninta's 10 mL
assert.equal(buildPlaceholderPrefill({ protocol: { id: 'pcr', steps: protocol.steps }, entries, resolveType })['s2:p2'].suggestion, '50 µL');
// no history at all -> nothing suggested
assert.deepEqual(buildPlaceholderPrefill({ protocol, entries: [], resolveType })['s2:p2'], { kind: 'parameter', suggestion: '' });

// only the most recent `history` runs count
const drift = [
  run('old1', '2026-01-01', { 's2:p2': '5 mL' }),
  run('old2', '2026-01-02', { 's2:p2': '5 mL' }),
  run('new1', '2026-09-01', { 's2:p2': '10 mL' }),
  run('new2', '2026-09-02', { 's2:p2': '10 mL' })
];
assert.equal(buildPlaceholderPrefill({ protocol, entries: drift, resolveType, history: 2 })['s2:p2'].suggestion, '10 mL');
assert.equal(buildPlaceholderPrefill({ protocol, entries: drift, resolveType, history: 4 })['s2:p2'].suggestion, '');

// an edited protocol with new ids still matches history by unambiguous placeholder name
const edited = { id: 'ninta', steps: [{ id: 's9', text: 'Wash with {{ph:z}}', placeholders: [{ id: 'z', name: 'volume' }] }] };
const withSnapshots = entries.slice(0, 3).map((entry) => ({ ...entry, protocolSnapshot: protocol }));
assert.equal(buildPlaceholderPrefill({ protocol: edited, entries: withSnapshots, resolveType })['s9:z'].suggestion, '10 mL');

console.log('placeholder-prefill selfcheck: ok');
