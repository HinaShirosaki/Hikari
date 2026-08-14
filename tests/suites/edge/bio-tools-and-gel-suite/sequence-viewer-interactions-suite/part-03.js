module.exports = function registerEdgeSequenceViewerInteractionsSuitePart03(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
function stripHtmlTags(html) {
  return String(html || '').replace(/<[^>]*>/g, '');
}
test('[EDGE] sequence-viewer keyboard inserts at cursor and confirms selected-base deletion', async () => {
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
    name: 'keyboard_insert_delete',
    sequence: 'ACGTACGTACGT',
    source: 'external',
    features: []
  });

  const sequenceHost = document.getElementById('sequence-viewer-sequence-host');
  const editOverlay = document.getElementById('sequence-viewer-sequence-edit-overlay');
  const editForm = document.getElementById('sequence-viewer-sequence-edit-form');
  const editTitle = document.getElementById('sequence-viewer-sequence-edit-title');
  const editTextarea = document.getElementById('sequence-viewer-sequence-edit-textarea');
  const deleteMessage = document.getElementById('sequence-viewer-sequence-edit-delete-message');
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

  trigger(sequenceHost, 'mousedown', { button: 0, clientX: 52, target: lineTarget });
  trigger(sequenceHost, 'mouseup', { target: lineTarget });
  dispatchGlobalKeydown({ key: 'c' });

  assert.equal(Boolean(editOverlay.hidden), false);
  assert.equal(editTitle.textContent, 'Insert Bases');
  assert.equal(editTextarea.value, 'C');

  editTextarea.value = 'TT';
  trigger(editForm, 'submit');
  await flushAsync();

  assert.equal(statLength.textContent, '14');
  assert.equal(stripHtmlTags(sequenceHost.innerHTML).includes('ACGTTTACGTACGT'), true);

  trigger(sequenceHost, 'mousedown', { button: 0, clientX: 28, target: lineTarget });
  trigger(sequenceHost, 'mousemove', { clientX: 60, target: lineTarget });
  trigger(sequenceHost, 'mouseup', { target: lineTarget });
  dispatchGlobalKeydown({ key: 'Delete' });

  assert.equal(Boolean(editOverlay.hidden), false);
  assert.equal(editTitle.textContent, 'Delete Bases');
  assert.equal(Boolean(deleteMessage.hidden), false);

  trigger(editForm, 'submit');
  await flushAsync();

  assert.equal(Boolean(editOverlay.hidden), true);
  assert.equal(statLength.textContent, '10');
  assert.equal(stripHtmlTags(sequenceHost.innerHTML).includes('ATACGTACGT'), true);
});
test('[EDGE] sequence-viewer right-click changes a translated amino acid through its codon', async () => {
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
    'sequence-viewer-stat-restriction-sites',
    'sequence-viewer-feature-rail-host',
    'sequence-viewer-feature-detail',
    'sequence-viewer-sequence-host',
    'sequence-viewer-feature-context-menu',
    'sequence-viewer-orf-toggle'
  ];
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
    { document }
  );
  const viewer = moduleWithDom.initSequenceViewer();
  const sequence = `ATG${'AAA'.repeat(80)}TAA`;
  viewer.loadFromExternal({
    name: 'amino_acid_edit',
    sequence,
    source: 'external',
    features: []
  });

  const orfToggle = document.getElementById('sequence-viewer-orf-toggle');
  const featureRail = document.getElementById('sequence-viewer-feature-rail-host');
  const sequenceHost = document.getElementById('sequence-viewer-sequence-host');
  const contextMenu = document.getElementById('sequence-viewer-feature-context-menu');

  orfToggle.checked = true;
  trigger(orfToggle, 'change');
  const orfFeatureTarget = {
    closest(selector) {
      return selector === '[data-feature-index]'
        ? { dataset: { featureIndex: '0' } }
        : null;
    }
  };
  trigger(featureRail, 'click', { target: orfFeatureTarget });

  assert.match(sequenceHost.innerHTML, /data-aa="K"/);
  assert.match(sequenceHost.innerHTML, /data-aa-codon="AAA"/);
  assert.match(sequenceHost.innerHTML, /data-aa-codon-positions="3,4,5"/);

  let contextMenuPrevented = false;
  const aminoAcidTarget = {
    dataset: {
      aa: 'K',
      aaCodon: 'AAA',
      aaCodonPositions: '3,4,5',
      aaStrand: '1'
    },
    closest(selector) {
      return selector === '[data-aa-codon-positions]' ? this : null;
    }
  };
  trigger(sequenceHost, 'contextmenu', {
    target: aminoAcidTarget,
    clientX: 120,
    clientY: 80,
    preventDefault() {
      contextMenuPrevented = true;
    }
  });

  assert.equal(contextMenuPrevented, true);
  assert.equal(Boolean(contextMenu.hidden), false);
  assert.match(contextMenu.innerHTML, /Change to \(uses the codon with the fewest DNA substitutions\)/);
  assert.match(contextMenu.innerHTML, /data-sequence-aa-replacement="E"/);
  assert.match(contextMenu.innerHTML, /Glutamic acid \(E\) - GAA/);

  const glutamateTarget = {
    dataset: { sequenceAaReplacement: 'E' },
    closest(selector) {
      return selector === '[data-sequence-aa-replacement]' ? this : null;
    }
  };
  trigger(contextMenu, 'click', { target: glutamateTarget });
  await flushAsync();
  await flushAsync();

  assert.equal(Boolean(contextMenu.hidden), true);
  assert.match(sequenceHost.innerHTML, /data-aa="E"/);
  assert.match(sequenceHost.innerHTML, /data-aa-codon="GAA"/);
  assert.match(document.querySelector('[data-hikari-transient-toast]').textContent, /Changed amino acid K \(AAA\) to E \(GAA\) at bases 4-6/);
});
test('[EDGE] sequence-viewer opens cloning design after base edits and renders primers', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-cloning-design-workspace',
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
    'sequence-viewer-sequence-edit-cancel',
    'sequence-viewer-cloning-design-btn',
    'sequence-viewer-cloning-design-back-btn',
    'sequence-viewer-cloning-design-status',
    'sequence-viewer-cloning-design-run-btn',
    'sequence-viewer-cloning-design-strategy-list',
    'sequence-viewer-cloning-design-edit-summary',
    'sequence-viewer-cloning-design-range-panel',
    'sequence-viewer-cloning-design-insert-start',
    'sequence-viewer-cloning-design-insert-end',
    'sequence-viewer-cloning-design-result'
  ];
  let copiedText = '';
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
      },
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
  viewer.loadFromExternal({
    name: 'cloning_design_edit',
    sequence: 'GCGCGCGCGCGCGATATATATATATATATATATAGCGCGCGCGCGCGAT',
    source: 'external',
    features: []
  });

  const cloningDesignBtn = document.getElementById('sequence-viewer-cloning-design-btn');
  const cloningWorkspace = document.getElementById('sequence-viewer-cloning-design-workspace');
  const detailWorkspace = document.getElementById('sequence-viewer-detail-workspace');
  const sequenceHost = document.getElementById('sequence-viewer-sequence-host');
  const editForm = document.getElementById('sequence-viewer-sequence-edit-form');
  const editTextarea = document.getElementById('sequence-viewer-sequence-edit-textarea');
  const resultHost = document.getElementById('sequence-viewer-cloning-design-result');

  assert.equal(Boolean(cloningDesignBtn.hidden), true);

  const lineElement = {
    dataset: { lineStart: '0', lineEnd: '49' },
    querySelector() {
      return {
        getBoundingClientRect() {
          return { left: 20, width: 392 };
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

  trigger(sequenceHost, 'mousedown', { button: 0, clientX: 212, target: lineTarget });
  trigger(sequenceHost, 'mouseup', { target: lineTarget });
  dispatchGlobalKeydown({ key: 'c' });

  editTextarea.value = 'GCGCGCGCGCGCGATGCGCGCGCGCGCGATGCGCGCGCGCGCGATGCGCGCGCGCGCGATGCGCGCGCGCGCGAT';
  trigger(editForm, 'submit');
  await flushAsync();

  assert.equal(Boolean(cloningDesignBtn.hidden), false);

  trigger(cloningDesignBtn, 'click');
  assert.equal(Boolean(cloningWorkspace.hidden), false);
  assert.equal(Boolean(detailWorkspace.hidden), true);
  assert.equal(resultHost.innerHTML.includes('sequence-viewer-cloning-design-primer-table'), true);
  assert.equal(resultHost.innerHTML.includes('tile_outer_left'), true);
  const cloningCopyButtons = resultHost.querySelectorAll('[data-sequence-primer-copy]');
  assert.equal(cloningCopyButtons.length >= 4, true);
  trigger(resultHost, 'click', {
    target: {
      closest(selector) {
        if (selector === '[data-sequence-primer-copy]') {
          return cloningCopyButtons[1];
        }
        return null;
      }
    }
  });
  await flushAsync();
  assert.equal(copiedText, cloningCopyButtons[1].dataset.sequencePrimerCopy);
});
  }
};
