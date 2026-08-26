module.exports = function registerEdgeSequenceViewerInteractionsSuiteFeatureEditingAndPrimerDesign(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
function stripHtmlTags(html) {
  return String(html || '').replace(/<[^>]*>/g, '');
}
test('[EDGE] sequence-viewer drag selection context menu can edit and delete an overlapping feature', async () => {
  const ids = [
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
    'sequence-viewer-status',
    'sequence-viewer-messages',
    'sequence-viewer-record-select',
    'sequence-viewer-stat-format',
    'sequence-viewer-stat-length',
    'sequence-viewer-stat-topology',
    'sequence-viewer-stat-gc',
    'sequence-viewer-stat-ambiguous',
    'sequence-viewer-stat-quality',
    'sequence-viewer-stat-features',
    'sequence-viewer-feature-rail-host',
    'sequence-viewer-feature-detail',
    'sequence-viewer-sequence-host',
    'sequence-viewer-feature-context-menu',
    'sequence-viewer-feature-editor-overlay',
    'sequence-viewer-feature-editor-form',
    'sequence-viewer-feature-editor-title',
    'sequence-viewer-feature-editor-note',
    'sequence-viewer-feature-editor-name',
    'sequence-viewer-feature-editor-type',
    'sequence-viewer-feature-editor-strand',
    'sequence-viewer-feature-editor-start',
    'sequence-viewer-feature-editor-end',
    'sequence-viewer-feature-editor-description',
    'sequence-viewer-feature-editor-close',
    'sequence-viewer-feature-editor-cancel'
  ];
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
    { document }
  );
  const viewer = moduleWithDom.initSequenceViewer();
  viewer.loadFromExternal({
    name: 'selection_edit_delete',
    sequence: 'ACGTACGTACGT',
    source: 'external',
    features: [
      {
        id: 'feature_manual_1',
        name: 'Feature_A',
        type: 'promoter',
        strand: 1,
        source: 'manual',
        segments: [{ start: 1, end: 5 }]
      }
    ]
  });

  const sequenceHost = document.getElementById('sequence-viewer-sequence-host');
  const contextMenu = document.getElementById('sequence-viewer-feature-context-menu');
  const featureEditorForm = document.getElementById('sequence-viewer-feature-editor-form');
  const featureEditorName = document.getElementById('sequence-viewer-feature-editor-name');
  const featureRailHost = document.getElementById('sequence-viewer-feature-rail-host');
  const featureDetail = document.getElementById('sequence-viewer-feature-detail');
  const statFeatures = document.getElementById('sequence-viewer-stat-features');
  const initialFeatureCount = Number(statFeatures.textContent || 0);

  const lineElement = {
    dataset: { lineStart: '0', lineEnd: '12' },
    querySelector() {
      return {
        getBoundingClientRect() {
          return { left: 20, width: 96 };
        }
      };
    }
  };
  const lineTarget = {
    closest(selector) {
      if (selector === '.sequence-viewer-dual-line') {
        return lineElement;
      }
      return null;
    }
  };

  trigger(sequenceHost, 'mousedown', { button: 0, clientX: 28, target: lineTarget });
  trigger(sequenceHost, 'mousemove', { clientX: 60, target: lineTarget });
  trigger(sequenceHost, 'mouseup', { target: lineTarget });
  trigger(sequenceHost, 'contextmenu', { clientX: 60, clientY: 84, target: lineTarget });

  assert.match(contextMenu.innerHTML, /Edit Feature_A/);

  trigger(contextMenu, 'click', {
    target: {
      closest(selector) {
        if (selector === '[data-sequence-feature-action]') {
          return { dataset: { sequenceFeatureAction: 'edit' } };
        }
        return null;
      }
    }
  });

  featureEditorName.value = 'Feature_B';
  trigger(featureEditorForm, 'submit');
  await flushAsync();

  assert.equal(Number(statFeatures.textContent || 0), initialFeatureCount);
  assert.match(featureRailHost.innerHTML, /Feature_B/);
  assert.match(featureDetail.innerHTML, /Feature_B/);

  trigger(sequenceHost, 'mousedown', { button: 0, clientX: 28, target: lineTarget });
  trigger(sequenceHost, 'mousemove', { clientX: 60, target: lineTarget });
  trigger(sequenceHost, 'mouseup', { target: lineTarget });
  trigger(sequenceHost, 'contextmenu', { clientX: 60, clientY: 84, target: lineTarget });

  trigger(contextMenu, 'click', {
    target: {
      closest(selector) {
        if (selector === '[data-sequence-feature-action]') {
          return { dataset: { sequenceFeatureAction: 'delete' } };
        }
        return null;
      }
    }
  });
  await flushAsync();

  assert.equal(Number(statFeatures.textContent || 0), initialFeatureCount - 1);
  assert.equal(featureRailHost.innerHTML.includes('Feature_B'), false);
  assert.equal(featureDetail.innerHTML.includes('Feature_B'), false);
});
test('[EDGE] sequence-viewer context menu designs primers for selected sequence or selected feature', async () => {
  const ids = [
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
    'sequence-viewer-status',
    'sequence-viewer-messages',
    'sequence-viewer-record-select',
    'sequence-viewer-stat-format',
    'sequence-viewer-stat-length',
    'sequence-viewer-stat-topology',
    'sequence-viewer-stat-gc',
    'sequence-viewer-stat-ambiguous',
    'sequence-viewer-stat-quality',
    'sequence-viewer-stat-features',
    'sequence-viewer-feature-rail-host',
    'sequence-viewer-feature-detail',
    'sequence-viewer-sequence-host',
    'sequence-viewer-feature-context-menu',
    'sequence-viewer-feature-editor-overlay',
    'sequence-viewer-primer-design-overlay',
    'sequence-viewer-primer-design-title',
    'sequence-viewer-primer-design-note',
    'sequence-viewer-primer-design-result',
    'sequence-viewer-primer-design-close',
    'sequence-viewer-primer-design-dismiss'
  ];
  let copiedText = '';
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
    {
      document,
      navigator: {
        clipboard: {
          writeText: async (value) => {
            copiedText = String(value || '');
          }
        }
      }
    }
  );
  const viewer = moduleWithDom.initSequenceViewer();
  const sequence = 'GCGCGCGCGCGCGATATATATATATATATATATAGCGCGCGCGCGCGAT';
  viewer.loadFromExternal({
    name: 'primer_context',
    sequence,
    source: 'external',
    features: [
      {
        id: 'feature_primer_1',
        name: 'Feature_A',
        type: 'promoter',
        strand: 1,
        source: 'manual',
        segments: [{ start: 0, end: sequence.length }]
      }
    ]
  });

  const sequenceHost = document.getElementById('sequence-viewer-sequence-host');
  const contextMenu = document.getElementById('sequence-viewer-feature-context-menu');
  const overlay = document.getElementById('sequence-viewer-primer-design-overlay');
  const note = document.getElementById('sequence-viewer-primer-design-note');
  const result = document.getElementById('sequence-viewer-primer-design-result');
  const closeBtn = document.getElementById('sequence-viewer-primer-design-close');

  const lineElement = {
    dataset: { lineStart: '0', lineEnd: String(sequence.length) },
    querySelector() {
      return {
        getBoundingClientRect() {
          return { left: 20, width: 440 };
        }
      };
    }
  };
  const lineTarget = {
    closest(selector) {
      if (selector === '.sequence-viewer-dual-line') {
        return lineElement;
      }
      return null;
    }
  };
  const actionTarget = {
    closest(selector) {
      if (selector === '[data-sequence-feature-action]') {
        return { dataset: { sequenceFeatureAction: 'design-primer' } };
      }
      return null;
    }
  };

  trigger(sequenceHost, 'mousedown', { button: 0, clientX: 20, target: lineTarget });
  trigger(sequenceHost, 'mousemove', { clientX: 452, target: lineTarget });
  trigger(sequenceHost, 'mouseup', { target: lineTarget });
  trigger(sequenceHost, 'contextmenu', { clientX: 452, clientY: 84, target: lineTarget });

  assert.match(contextMenu.innerHTML, /Design Primer/);
  trigger(contextMenu, 'click', { target: actionTarget });
  assert.equal(Boolean(overlay.hidden), false);
  assert.match(note.textContent, /PCR primer pair/);
  assert.match(result.innerHTML, /Pcr Forward/);
  assert.match(result.innerHTML, /Pcr Reverse/);
  const overlayCopyButtons = result.querySelectorAll('[data-sequence-primer-copy]');
  assert.equal(overlayCopyButtons.length >= 4, true);
  trigger(result, 'click', {
    target: {
      closest(selector) {
        if (selector === '[data-sequence-primer-copy]') {
          return overlayCopyButtons[0];
        }
        return null;
      }
    }
  });
  await flushAsync();
  assert.equal(copiedText, overlayCopyButtons[0].dataset.sequencePrimerCopy);

  trigger(closeBtn, 'click');
  assert.equal(Boolean(overlay.hidden), true);

  const featureTarget = {
    closest(selector) {
      if (selector === '[data-feature-index]') {
        return { dataset: { featureIndex: '0' } };
      }
      return null;
    }
  };
  trigger(sequenceHost, 'click', { target: featureTarget });
  trigger(sequenceHost, 'contextmenu', { clientX: 48, clientY: 84, target: featureTarget });
  trigger(contextMenu, 'click', { target: actionTarget });

  assert.equal(Boolean(overlay.hidden), false);
  assert.match(note.textContent, /Feature_A/);
  assert.match(result.innerHTML, /Feature_A F/);
  assert.match(result.innerHTML, /Feature_A R/);
});
test('[EDGE] sequence-viewer keyboard edits selected bases through the sequence edit dialog', async () => {
  const ids = [
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
    'sequence-viewer-status',
    'sequence-viewer-messages',
    'sequence-viewer-record-select',
    'sequence-viewer-stat-format',
    'sequence-viewer-stat-length',
    'sequence-viewer-stat-topology',
    'sequence-viewer-stat-gc',
    'sequence-viewer-stat-ambiguous',
    'sequence-viewer-stat-quality',
    'sequence-viewer-stat-features',
    'sequence-viewer-feature-rail-host',
    'sequence-viewer-feature-detail',
    'sequence-viewer-sequence-host',
    'sequence-viewer-feature-context-menu',
    'sequence-viewer-feature-editor-overlay',
    'sequence-viewer-sequence-edit-overlay',
    'sequence-viewer-sequence-edit-form',
    'sequence-viewer-sequence-edit-title',
    'sequence-viewer-sequence-edit-note',
    'sequence-viewer-sequence-edit-input-wrap',
    'sequence-viewer-sequence-edit-textarea',
    'sequence-viewer-sequence-edit-delete-message',
    'sequence-viewer-sequence-edit-confirm',
    'sequence-viewer-sequence-edit-close',
    'sequence-viewer-sequence-edit-cancel'
  ];
  const listeners = {};
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
    {
      document,
      addEventListener(type, listener) {
        listeners[type] = [...(listeners[type] || []), listener];
      },
      setTimeout(callback) {
        callback();
      }
    }
  );
  const viewer = moduleWithDom.initSequenceViewer();
  viewer.loadFromExternal({
    name: 'keyboard_replace',
    sequence: 'ACGTACGTACGT',
    source: 'external',
    features: []
  });

  const sequenceHost = document.getElementById('sequence-viewer-sequence-host');
  const editOverlay = document.getElementById('sequence-viewer-sequence-edit-overlay');
  const editForm = document.getElementById('sequence-viewer-sequence-edit-form');
  const editTitle = document.getElementById('sequence-viewer-sequence-edit-title');
  const editNote = document.getElementById('sequence-viewer-sequence-edit-note');
  const editTextarea = document.getElementById('sequence-viewer-sequence-edit-textarea');
  const statLength = document.getElementById('sequence-viewer-stat-length');

  const lineElement = {
    dataset: { lineStart: '0', lineEnd: '12' },
    querySelector() {
      return {
        getBoundingClientRect() {
          return { left: 20, width: 96 };
        }
      };
    }
  };
  const lineTarget = {
    closest(selector) {
      if (selector === '.sequence-viewer-dual-line') {
        return lineElement;
      }
      return null;
    }
  };
  const dispatchGlobalKeydown = (event) => {
    (listeners.keydown || []).forEach((listener) => {
      listener({
        preventDefault() {},
        stopPropagation() {},
        target: {},
        ...event
      });
    });
  };

  trigger(sequenceHost, 'mousedown', { button: 0, clientX: 28, target: lineTarget });
  trigger(sequenceHost, 'mousemove', { clientX: 60, target: lineTarget });
  trigger(sequenceHost, 'mouseup', { target: lineTarget });
  dispatchGlobalKeydown({ key: 't' });

  assert.equal(Boolean(editOverlay.hidden), false);
  assert.equal(editTitle.textContent, 'Replace Bases');
  assert.equal(editNote.innerHTML, '');
  assert.equal(editTextarea.value, 'T');

  editTextarea.value = 'GG';
  trigger(editForm, 'submit');
  await flushAsync();

  assert.equal(Boolean(editOverlay.hidden), true);
  assert.equal(statLength.textContent, '10');
  assert.equal(stripHtmlTags(sequenceHost.innerHTML).includes('AGGCGTACGT'), true);
});
  }
};
