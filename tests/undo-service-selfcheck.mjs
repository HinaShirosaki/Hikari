#!/usr/bin/env node
// Self-check for the renderer undo/redo service: coalesce windowing (per-field,
// non-sliding), the external-write guard, and the irreversible-side-effect
// barrier.
// Run: node tests/undo-service-selfcheck.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const { createUndoService } = await import(
  pathToFileURL(path.join(root, 'src/renderer/services/undoService.js')).href
);

// The service reaches for these globals through instanceof checks; a bare
// object activeElement must read as "not an editable target".
globalThis.Element = class Element {};

function makeField(id) {
  // Distinct instances of a coalescing target, distinguishable by identity.
  class HTMLTextAreaElement extends globalThis.Element {}
  globalThis.HTMLTextAreaElement = HTMLTextAreaElement;
  const field = new HTMLTextAreaElement();
  field.id = id;
  return field;
}

function makeHarness() {
  const state = { value: 0 };
  const documentObject = {
    activeElement: null,
    getElementById: () => null,
    addEventListener: () => {}
  };
  const service = createUndoService({
    state,
    persistState: () => {},
    renderAll: () => {},
    documentObject,
    coalesceMs: 700
  });
  return { state, documentObject, service };
}

// --- coalesce window must not slide ------------------------------------------
// Sustained editing in one field with sub-window gaps has to keep checkpointing:
// if the window restarts on every dropped push, a whole typing burst collapses
// into a single undo entry.
{
  const { state, documentObject, service } = makeHarness();
  const field = makeField('a');
  documentObject.activeElement = field;

  const realNow = Date.now;
  let clock = 1_000_000;
  Date.now = () => clock;
  try {
    for (let i = 0; i < 10; i += 1) {
      state.value += 1;
      service.persist();
      clock += 300; // steady typing, always inside the 700ms window
    }
  } finally {
    Date.now = realNow;
  }

  // 10 edits over 2700ms at a 700ms window: checkpoints at 0/900/1800/2700.
  assert.ok(service.undo(), 'expected an undoable checkpoint');
  assert.notEqual(state.value, 0, 'undo collapsed the entire burst to the start');
  assert.ok(service.undo(), 'expected more than one checkpoint in a 2.7s burst');
}

// --- coalescing is per field, not per field type -----------------------------
{
  const { state, documentObject, service } = makeHarness();
  documentObject.activeElement = makeField('a');
  state.value = 1;
  service.persist();

  documentObject.activeElement = makeField('b'); // different field, same instant
  state.value = 2;
  service.persist();

  service.undo();
  assert.equal(state.value, 1, 'edits to two different fields merged into one undo step');
}

// --- external writes leave both stacks untouched -----------------------------
{
  const { state, documentObject, service } = makeHarness();
  documentObject.activeElement = null;

  state.value = 1;
  service.persist();
  service.undo();
  assert.equal(state.value, 0, 'undo did not restore the pre-edit value');

  // A main-process write lands while the user has a pending redo.
  state.external = 'agent-record';
  service.persist({ external: true });

  assert.ok(service.redo(), 'external write destroyed the redo stack');
  assert.equal(state.value, 1, 'redo did not reapply the user edit');
  assert.equal(state.external, undefined, 'redo snapshot unexpectedly carried external data');
}

// --- barrier drops history rather than desynchronizing from disk -------------
{
  const { state, documentObject, service } = makeHarness();
  documentObject.activeElement = null;

  state.value = 1;
  service.persist();
  state.storedPath = '/new/location.pdf';
  service.persist({ barrier: true });

  assert.equal(service.undo(), false, 'undo crossed an irreversible file move');
  assert.equal(state.storedPath, '/new/location.pdf', 'barrier state was rolled back');
}

console.log('undo-service-selfcheck: ok');
