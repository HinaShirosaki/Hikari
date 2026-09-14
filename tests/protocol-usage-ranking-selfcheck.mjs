#!/usr/bin/env node
// Self-check: the notebook protocol dropdown lists most-used protocols first,
// most recently used breaking ties, alphabetical for never-used ones.
// Run: node tests/protocol-usage-ranking-selfcheck.mjs
import assert from 'node:assert/strict';
import { rankProtocolsByUsage } from '../src/renderer/modules/biology-notebook/entry/dropdown-renderer.js';

const protocols = [
  { id: 'pcr', name: 'PCR' },
  { id: 'minprep', name: 'Miniprep' },
  { id: 'gel', name: 'Agarose gel' },
  { id: 'blot', name: 'Western blot' }
];
const entries = [
  { protocolId: 'minprep', updatedAt: '2026-09-01T10:00:00Z' },
  { protocolId: 'gel', updatedAt: '2026-09-10T10:00:00Z' },
  { protocolId: 'gel', updatedAt: '2026-08-01T10:00:00Z' },
  { protocolId: 'minprep', updatedAt: '2026-09-11T10:00:00Z' },
  { protocolId: 'ghost', updatedAt: '2026-09-11T10:00:00Z' },
  { updatedAt: '2026-09-11T10:00:00Z' }
];

// gel and minprep tie on count (2); minprep used more recently; never-used sort by name.
assert.deepEqual(rankProtocolsByUsage(protocols, entries).map((p) => p.id), ['minprep', 'gel', 'pcr', 'blot']);
// no entries -> alphabetical; input untouched
assert.deepEqual(rankProtocolsByUsage(protocols, []).map((p) => p.id), ['gel', 'minprep', 'pcr', 'blot']);
assert.equal(protocols[0].id, 'pcr');
// executedAt wins over updatedAt for "last used"
assert.deepEqual(rankProtocolsByUsage(
  [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
  [{ protocolId: 'a', executedAt: '2026-01-01', updatedAt: '2026-09-11' }, { protocolId: 'b', executedAt: '2026-02-01', updatedAt: '2026-01-01' }]
).map((p) => p.id), ['b', 'a']);

console.log('protocol-usage-ranking selfcheck: ok');
