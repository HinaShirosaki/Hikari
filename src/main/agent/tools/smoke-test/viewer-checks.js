'use strict';

const { createSequenceAgentRuntime } = require('../agent-sequence-viewer.js');
const { asArray } = require('../../../lib/normalize.js');
const { cleanText } = require('./utils.js');

function createViewerSmokeChecks() {

  // The sequence tools round-trip into the renderer; here we stand in a fake
  // window that computes a canned reply, exercising the main-side invoke/reply
  // matching added for these tools.
  function buildFakeSequenceWindow(compute) {
    const webContents = {
      isDestroyed: () => false,
      send: (_channel, payload = {}) => {
        queueMicrotask(() => {
          respond?.({ requestId: payload.requestId, result: compute(payload.action, payload.args) });
        });
      }
    };
    let respond = null;
    const BrowserWindow = {
      getFocusedWindow: () => ({ webContents }),
      getAllWindows: () => [{ webContents }]
    };
    return { BrowserWindow, setResponder: (fn) => { respond = fn; } };
  }

  async function smokeSequenceViewer() {
    const fake = buildFakeSequenceWindow((action) => (
      action === 'list_records'
        ? { records: [{ id: 'genbank_1', name: 'pSmoke', length: 12, topology: 'circular', featureCount: 0, selected: true }] }
        : { error: { code: 'UNKNOWN_ACTION', message: `Unhandled ${action}.` } }
    ));
    const runtime = createSequenceAgentRuntime({ BrowserWindow: fake.BrowserWindow, ipcMain: null });
    fake.setResponder(runtime.handleResponse);
    const result = await runtime.invoke('list_records', {});
    const ok = Array.isArray(result?.records) && result.records.length > 0;
    return {
      ok,
      status: ok ? 'completed' : 'error',
      items: asArray(result?.records),
      summary: ok ? `sequence-viewer smoke listed ${result.records.length} record(s).` : 'sequence-viewer smoke failed.',
      error: ok ? '' : cleanText(result?.error?.message)
    };
  }

  async function smokeSequenceEdit() {
    const fake = buildFakeSequenceWindow((action) => (
      action === 'propose_edit'
        ? {
          pending_approval: true,
          kind: 'edit',
          approvalToken: 'smoke_token',
          target: { recordId: 'genbank_1', recordIndex: 0, baseLength: 12, baseDigest: '00000000' },
          mode: 'replace',
          edit: { mode: 'replace', start: 5, end: 5, sequence: 'A' },
          summary: 'Replace 1 bp at 5..5',
          preview: { before: 'ACGT|C|AGCT', after: 'ACGT|A|AGCT', newLength: 12 },
          affectedFeatures: []
        }
        : { error: { code: 'UNKNOWN_ACTION', message: `Unhandled ${action}.` } }
    ));
    const runtime = createSequenceAgentRuntime({ BrowserWindow: fake.BrowserWindow, ipcMain: null });
    fake.setResponder(runtime.handleResponse);
    const result = await runtime.invoke('propose_edit', {
      action: 'propose_edit',
      target: { recordId: 'genbank_1' },
      mode: 'replace',
      start: 5,
      end: 5,
      sequence: 'A'
    });
    const ok = result?.pending_approval === true && Boolean(result?.approvalToken);
    return {
      ok,
      status: ok ? 'pending_approval' : 'error',
      items: ok ? [{ approvalToken: result.approvalToken, summary: result.summary }] : [],
      summary: ok ? 'sequence-edit smoke prepared a pending proposal.' : 'sequence-edit smoke failed.',
      error: ok ? '' : cleanText(result?.error?.message)
    };
  }

  return { smokeSequenceViewer, smokeSequenceEdit };
}

module.exports = { createViewerSmokeChecks };
