module.exports = function registerEdgeSequenceViewerInteractionsSuitePart01(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
function stripHtmlTags(html) {
  return String(html || '').replace(/<[^>]*>/g, '');
}
test('[EDGE] sequence-viewer ORF toggle defaults off and controls ORF bars plus selected translation row', () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-paste-btn',
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
    'sequence-viewer-orf-toggle',
    'sequence-viewer-orf-stop-tag-toggle',
    'sequence-viewer-orf-stop-taa-toggle',
    'sequence-viewer-orf-stop-tga-toggle',
    'sequence-viewer-restriction-neb-toggle',
    'sequence-viewer-restriction-thermo-toggle',
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
    'sequence-viewer-stat-restriction-sites',
    'sequence-viewer-feature-rail-host',
    'sequence-viewer-feature-detail',
    'sequence-viewer-sequence-host'
  ];
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document }
  );
  moduleWithDom.initSequenceViewer();

  trigger(document.getElementById('sequence-viewer-home-paste-btn'), 'click');
  const longOrf = `ATG${'AAA'.repeat(74)}TAA`;
  const textarea = document.getElementById('sequence-viewer-textarea');
  textarea.value = `>orf_test\n${longOrf}\n`;
  trigger(document.getElementById('sequence-viewer-load-btn'), 'click');

  const orfToggle = document.getElementById('sequence-viewer-orf-toggle');
  const orfStopTagToggle = document.getElementById('sequence-viewer-orf-stop-tag-toggle');
  const orfStopTaaToggle = document.getElementById('sequence-viewer-orf-stop-taa-toggle');
  const orfStopTgaToggle = document.getElementById('sequence-viewer-orf-stop-tga-toggle');
  const sequenceHost = document.getElementById('sequence-viewer-sequence-host');
  const statFeatures = document.getElementById('sequence-viewer-stat-features');
  assert.equal(Boolean(orfToggle.checked), false);
  assert.equal(Boolean(orfStopTagToggle.checked), true);
  assert.equal(Boolean(orfStopTaaToggle.checked), true);
  assert.equal(Boolean(orfStopTgaToggle.checked), true);
  assert.equal(statFeatures.textContent, '0');
  assert.equal(sequenceHost.innerHTML.includes('ORF +1'), false);

  orfToggle.checked = true;
  trigger(orfToggle, 'change');
  assert.equal(statFeatures.textContent, '1');
  assert.equal(sequenceHost.innerHTML.includes('ORF +1'), true);
  assert.equal(sequenceHost.innerHTML.includes('sequence-viewer-aa-row'), false);

  const firstFeature = sequenceHost.querySelector('[data-feature-index]');
  const clickTarget = {
    closest() {
      return { dataset: { featureIndex: firstFeature?.dataset?.featureIndex || '0' } };
    }
  };
  trigger(sequenceHost, 'click', { target: clickTarget });
  assert.equal(sequenceHost.innerHTML.includes('sequence-viewer-aa-row-plus'), true);
  assert.equal(sequenceHost.innerHTML.indexOf('sequence-viewer-strand-row-bottom') < sequenceHost.innerHTML.indexOf('sequence-viewer-aa-row-plus'), true);
  assert.equal(sequenceHost.innerHTML.includes('data-aa-display="TAA"'), false);

  orfStopTaaToggle.checked = false;
  trigger(orfStopTaaToggle, 'change');
  assert.equal(statFeatures.textContent, '0');
  assert.equal(sequenceHost.innerHTML.includes('ORF +1'), false);
  assert.equal(sequenceHost.innerHTML.includes('sequence-viewer-aa-row'), false);

  orfStopTaaToggle.checked = true;
  trigger(orfStopTaaToggle, 'change');
  assert.equal(statFeatures.textContent, '1');
  assert.equal(sequenceHost.innerHTML.includes('ORF +1'), true);

  orfToggle.checked = false;
  trigger(orfToggle, 'change');
  assert.equal(statFeatures.textContent, '0');
  assert.equal(sequenceHost.innerHTML.includes('ORF +1'), false);
  assert.equal(sequenceHost.innerHTML.includes('sequence-viewer-aa-row'), false);
});
test('[EDGE] sequence-viewer restriction vendor checkboxes filter visible unique cutters', () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-paste-btn',
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
    'sequence-viewer-orf-toggle',
    'sequence-viewer-restriction-neb-toggle',
    'sequence-viewer-restriction-thermo-toggle',
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
    'sequence-viewer-stat-restriction-sites',
    'sequence-viewer-feature-rail-host',
    'sequence-viewer-feature-detail',
    'sequence-viewer-sequence-host'
  ];
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document }
  );
  moduleWithDom.initSequenceViewer();

  trigger(document.getElementById('sequence-viewer-home-paste-btn'), 'click');
  const textarea = document.getElementById('sequence-viewer-textarea');
  textarea.value = '>vendor_filter\nTTATAAGAACAAAAAATCCCCATC\n';
  trigger(document.getElementById('sequence-viewer-load-btn'), 'click');

  const nebToggle = document.getElementById('sequence-viewer-restriction-neb-toggle');
  const thermoToggle = document.getElementById('sequence-viewer-restriction-thermo-toggle');
  const statRestrictionSites = document.getElementById('sequence-viewer-stat-restriction-sites');
  const sequenceHost = document.getElementById('sequence-viewer-sequence-host');

  assert.equal(Boolean(nebToggle.checked), true);
  assert.equal(Boolean(thermoToggle.checked), true);
  assert.equal(statRestrictionSites.textContent, '3');
  assert.equal(sequenceHost.innerHTML.includes('AanI'), true);
  assert.equal(sequenceHost.innerHTML.includes('AloI'), true);
  assert.equal(sequenceHost.innerHTML.includes('BccI'), true);

  thermoToggle.checked = false;
  trigger(thermoToggle, 'change');
  assert.equal(statRestrictionSites.textContent, '2');
  assert.equal(sequenceHost.innerHTML.includes('PsiI'), true);
  assert.equal(sequenceHost.innerHTML.includes('AloI'), false);
  assert.equal(sequenceHost.innerHTML.includes('BccI'), true);

  nebToggle.checked = false;
  trigger(nebToggle, 'change');
  assert.equal(statRestrictionSites.textContent, '0');
  assert.equal((sequenceHost.innerHTML.match(/sequence-viewer-restriction-annot/g) || []).length, 0);

  thermoToggle.checked = true;
  trigger(thermoToggle, 'change');
  assert.equal(statRestrictionSites.textContent, '2');
  assert.equal(sequenceHost.innerHTML.includes('AanI'), true);
  assert.equal(sequenceHost.innerHTML.includes('AloI'), true);
  assert.equal(sequenceHost.innerHTML.includes('BccI'), false);
});
test('[EDGE] sequence-viewer bottom-track click updates selected feature detail strip', () => {
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
    'sequence-viewer-sequence-host'
  ];
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document }
  );
  const viewer = moduleWithDom.initSequenceViewer();
  viewer.loadFromExternal({
    name: 'test',
    sequence: 'ACGTACGT',
    source: 'legacy_annotation',
    features: [
      {
        name: 'Feature_A',
        type: 'promoter',
        strand: 1,
        source: 'legacy_annotation',
        segments: [{ start: 1, end: 5 }]
      }
    ]
  });

  const detail = document.getElementById('sequence-viewer-feature-detail');
  assert.match(detail.innerHTML, /Select a feature/);

  trigger(document.getElementById('sequence-viewer-feature-rail-host'), 'click', {
    target: {
      closest() {
        return { dataset: { featureIndex: '0' } };
      }
    }
  });

  assert.match(detail.innerHTML, /Feature_A/);
  assert.match(detail.innerHTML, /promoter/);
});
test('[EDGE] sequence-viewer drag selection context menu can add a feature', async () => {
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
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document }
  );
  const viewer = moduleWithDom.initSequenceViewer();
  viewer.loadFromExternal({
    name: 'selection_add',
    sequence: 'ACGTACGTACGT',
    source: 'external',
    features: []
  });

  const sequenceHost = document.getElementById('sequence-viewer-sequence-host');
  const contextMenu = document.getElementById('sequence-viewer-feature-context-menu');
  const featureEditorForm = document.getElementById('sequence-viewer-feature-editor-form');
  const featureEditorName = document.getElementById('sequence-viewer-feature-editor-name');
  const featureEditorType = document.getElementById('sequence-viewer-feature-editor-type');
  const featureEditorDescription = document.getElementById('sequence-viewer-feature-editor-description');
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

  trigger(sequenceHost, 'mousedown', { button: 0, clientX: 20, target: lineTarget });
  trigger(sequenceHost, 'mousemove', { clientX: 52, target: lineTarget });
  trigger(sequenceHost, 'mouseup', { target: lineTarget });
  trigger(sequenceHost, 'contextmenu', { clientX: 52, clientY: 84, target: lineTarget });

  assert.match(contextMenu.innerHTML, /Add Feature/);

  trigger(contextMenu, 'click', {
    target: {
      closest(selector) {
        if (selector === '[data-sequence-feature-action]') {
          return { dataset: { sequenceFeatureAction: 'add' } };
        }
        return null;
      }
    }
  });

  featureEditorName.value = 'Manual_A';
  featureEditorType.value = 'promoter';
  featureEditorDescription.value = 'added from selection';
  trigger(featureEditorForm, 'submit');
  await flushAsync();

  assert.equal(Number(statFeatures.textContent || 0), initialFeatureCount + 1);
  assert.match(featureRailHost.innerHTML, /Manual_A/);
  assert.match(featureDetail.innerHTML, /Manual_A/);
  assert.match(featureDetail.innerHTML, /promoter/);
});
  }
};