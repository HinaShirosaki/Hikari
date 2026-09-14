module.exports = function registerEdgeSequenceViewerWorkspaceSuiteProteinBuilderBlocks(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('[EDGE] sequence-viewer library search filters the library list by name', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-status',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-library-list',
    'sequence-viewer-library-search-input',
    'sequence-viewer-preview-host',
    'sequence-viewer-home-paste-btn',
    'sequence-viewer-home-open-btn',
    'sequence-viewer-home-open-input',
    'sequence-viewer-status',
    'sequence-viewer-messages',
    'sequence-viewer-record-select'
  ];
  const entries = [
    { id: 'entry_1', name: 'Alpha Vector', status: 'saved' },
    { id: 'entry_2', name: 'Beta Plasmid', status: 'saved' }
  ];
  const document = createMockDocument(ids);
  const window = {
    hikariApi: {
      sequenceLibraryList: async () => ({ ok: true, entries }),
      sequenceLibraryGet: async () => ({
        ok: true,
        entry: entries[0]
      })
    }
  };
  const localStorage = {
    getItem(key) {
      if (key === 'hikari_state_v1') {
        return JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } });
      }
      return null;
    }
  };
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
    { document, window, localStorage }
  );
  moduleWithDom.initSequenceViewer();
  await flushAsync();
  await flushAsync();

  const libraryList = document.getElementById('sequence-viewer-library-list');
  assert.equal(libraryList.innerHTML.includes('Alpha Vector'), true);
  assert.equal(libraryList.innerHTML.includes('Beta Plasmid'), true);

  const searchInput = document.getElementById('sequence-viewer-library-search-input');
  searchInput.value = 'beta';
  trigger(searchInput, 'input');
  await flushAsync();

  assert.equal(libraryList.innerHTML.includes('Beta Plasmid'), true);
  assert.equal(libraryList.innerHTML.includes('Alpha Vector'), false);

  searchInput.value = 'nothing-here';
  trigger(searchInput, 'input');
  await flushAsync();

  assert.equal(libraryList.innerHTML.includes('No sequences match'), true);
});
test('[EDGE] sequence-viewer protein builder searches stored features and adds translated blocks to the chain', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-protein-builder-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-vector-builder-btn',
    'sequence-viewer-vector-builder-btn',
    'sequence-viewer-vector-builder-protein-builder-btn',
    'sequence-viewer-protein-builder-back-btn',
    'sequence-viewer-protein-builder-form',
    'sequence-viewer-protein-builder-name',
    'sequence-viewer-protein-builder-common-blocks',
    'sequence-viewer-protein-builder-feature-picker',
    'sequence-viewer-protein-builder-feature-summary',
    'sequence-viewer-protein-builder-feature-hosts-fold',
    'sequence-viewer-protein-builder-feature-preview-fold',
    'sequence-viewer-protein-builder-feature-search-input',
    'sequence-viewer-protein-builder-feature-search-status',
    'sequence-viewer-protein-builder-feature-search-results',
    'sequence-viewer-protein-builder-feature-source',
    'sequence-viewer-protein-builder-feature-hosts',
    'sequence-viewer-protein-builder-feature-preview',
    'sequence-viewer-protein-builder-feature-codon-optimize',
    'sequence-viewer-protein-builder-feature-add-btn',
    'sequence-viewer-protein-builder-meta',
    'sequence-viewer-protein-builder-workflow',
    'sequence-viewer-protein-builder-sequence-editor',
    'sequence-viewer-protein-builder-protein-sequence-highlight',
    'sequence-viewer-protein-builder-sequence',
    'sequence-viewer-home-status',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-save-btn'
  ];
  const searchCalls = [];
  const getCalls = [];
  const document = createMockDocument(ids);
  const window = {
    hikariApi: {
      sequenceLibrarySearchFeatures: async (payload) => {
        searchCalls.push(payload);
        return {
          ok: true,
          results: [
            {
              id: 'feature_protein_tag',
              name: 'stored_affinity_tag',
              type: 'cds',
              sequence: 'ATGGCCGAA',
              sequenceLength: 9,
              hostCount: 2,
              hosts: [
                {
                  hostVectorId: 'entry_tag_a',
                  hostVectorName: 'pTagSource-A',
                  topology: 'circular',
                  sequenceLength: 40,
                  locations: [{ startPos: 4, endPos: 13, strand: 1 }]
                },
                {
                  hostVectorId: 'entry_tag_b',
                  hostVectorName: 'pTagSource-B',
                  topology: 'circular',
                  sequenceLength: 60,
                  locations: [{ startPos: 9, endPos: 18, strand: 1 }]
                }
              ]
            }
          ]
        };
      },
      sequenceLibraryGet: async (payload) => {
        getCalls.push(payload);
        return {
          ok: true,
          entry: { id: payload?.id, name: payload?.id },
          gbkText: `>${payload?.id}\n${'ATGGCCGAA'}${'GGCC'.repeat(8)}\n`
        };
      }
    }
  };
  const localStorage = {
    getItem(key) {
      if (key === 'hikari_state_v1') {
        return JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } });
      }
      return null;
    }
  };
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
    { document, window, localStorage }
  );
  moduleWithDom.initSequenceViewer();
  await flushAsync();

  // Protein Builder is reached through Vector Builder now.
  trigger(document.getElementById('sequence-viewer-vector-builder-btn'), 'click', { preventDefault() {} });
  trigger(document.getElementById('sequence-viewer-vector-builder-protein-builder-btn'), 'click', { preventDefault() {} });
  assert.equal(Boolean(document.getElementById('sequence-viewer-protein-builder-workspace').hidden), false);

  const commonBlocksMarkup = document.getElementById('sequence-viewer-protein-builder-common-blocks').innerHTML;
  assert.equal((commonBlocksMarkup.match(/<details class="sequence-viewer-protein-builder-common-fold">/g) || []).length, 4);
  assert.equal(commonBlocksMarkup.includes('<details class="sequence-viewer-protein-builder-common-fold" open'), false);
  assert.equal(commonBlocksMarkup.includes('Protease sites'), true);
  assert.equal(commonBlocksMarkup.includes('Self-cleaving 2A peptides'), true);

  const searchInput = document.getElementById('sequence-viewer-protein-builder-feature-search-input');
  searchInput.value = 'stored_affinity_tag';
  trigger(searchInput, 'keydown', { key: 'Enter', preventDefault() {} });
  await flushAsync();
  await flushAsync();

  assert.equal(searchCalls.length, 1);
  assert.equal(searchCalls[0].query, 'stored_affinity_tag');
  assert.equal(document.getElementById('sequence-viewer-protein-builder-feature-search-results').innerHTML.includes('stored_affinity_tag'), true);

  // Picking the result lists the vectors that carry it and previews the first.
  const selectFeatureTarget = {
    closest(selector) {
      if (selector === '[data-protein-builder-feature-select-id]') {
        return { dataset: { proteinBuilderFeatureSelectId: 'feature_protein_tag' } };
      }
      return null;
    }
  };
  let keyboardDefaultPrevented = false;
  trigger(document.getElementById('sequence-viewer-protein-builder-feature-search-results'), 'keydown', {
    key: ' ',
    target: selectFeatureTarget,
    preventDefault() {
      keyboardDefaultPrevented = true;
    }
  });
  assert.equal(keyboardDefaultPrevented, true);
  const picker = document.getElementById('sequence-viewer-protein-builder-feature-picker');
  const hostsFold = document.getElementById('sequence-viewer-protein-builder-feature-hosts-fold');
  const previewFold = document.getElementById('sequence-viewer-protein-builder-feature-preview-fold');
  assert.equal(picker.open, false);
  assert.equal(hostsFold.open, true);
  assert.equal(previewFold.open, true);
  assert.equal(document.getElementById('sequence-viewer-protein-builder-feature-summary').textContent, 'stored_affinity_tag');
  assert.equal(document.getElementById('sequence-viewer-protein-builder-feature-source').hidden, false);
  // Search results carry feature metadata, not the source plasmid sequence.
  // The block cannot be added until that plasmid has finished loading.
  assert.equal(document.getElementById('sequence-viewer-protein-builder-feature-add-btn').disabled, true);
  trigger(document.getElementById('sequence-viewer-protein-builder-feature-add-btn'), 'click', { preventDefault() {} });
  assert.equal(document.getElementById('sequence-viewer-protein-builder-workflow').innerHTML.includes('stored_affinity_tag'), false);
  await flushAsync();
  await flushAsync();

  const sourcePanel = document.getElementById('sequence-viewer-protein-builder-feature-source');
  const hostsHtml = document.getElementById('sequence-viewer-protein-builder-feature-hosts').innerHTML;
  assert.equal(Boolean(sourcePanel.hidden), false);
  assert.equal(hostsHtml.includes('pTagSource-A'), true);
  assert.equal(hostsHtml.includes('pTagSource-B'), true);
  assert.equal(getCalls.map((call) => call.id).join(','), 'entry_tag_a');
  assert.equal(document.getElementById('sequence-viewer-protein-builder-feature-preview').innerHTML.includes('<svg'), true);
  assert.equal(document.getElementById('sequence-viewer-protein-builder-feature-add-btn').disabled, false);
  assert.equal(document.getElementById('sequence-viewer-protein-builder-feature-codon-optimize').checked, false);

  // Reopening and choosing the same protein repeats the disclosure flow.
  picker.open = true;
  hostsFold.open = false;
  previewFold.open = false;
  trigger(document.getElementById('sequence-viewer-protein-builder-feature-search-results'), 'click', { target: selectFeatureTarget });
  assert.equal(picker.open, false);
  assert.equal(hostsFold.open, true);
  assert.equal(previewFold.open, true);
  assert.equal(getCalls.length, 1);

  // Choosing the other vector also reveals a previously collapsed preview.
  previewFold.open = false;
  trigger(document.getElementById('sequence-viewer-protein-builder-feature-hosts'), 'click', {
    target: {
      closest(selector) {
        if (selector === '[data-protein-builder-feature-host-id]') {
          return { dataset: { proteinBuilderFeatureHostId: 'entry_tag_b' } };
        }
        return null;
      }
    }
  });
  await flushAsync();
  await flushAsync();
  assert.equal(getCalls.map((call) => call.id).join(','), 'entry_tag_a,entry_tag_b');
  assert.equal(previewFold.open, true);

  // Nothing joins the chain until Add Block.
  assert.equal(document.getElementById('sequence-viewer-protein-builder-workflow').innerHTML.includes('stored_affinity_tag'), false);
  document.getElementById('sequence-viewer-protein-builder-feature-codon-optimize').checked = true;
  trigger(document.getElementById('sequence-viewer-protein-builder-feature-add-btn'), 'click', { preventDefault() {} });
  await flushAsync();

  const workflowHtml = document.getElementById('sequence-viewer-protein-builder-workflow').innerHTML;
  const assembledSequence = document.getElementById('sequence-viewer-protein-builder-sequence');
  assert.equal(workflowHtml.includes('stored_affinity_tag'), true);
  // The block records the vector it came from, not just how many carry it.
  assert.equal(workflowHtml.includes('From pTagSource-B'), true);
  assert.equal(workflowHtml.includes('Codon optimization enabled'), true);
  assert.equal(workflowHtml.includes('sequence-viewer-protein-builder-palette-1'), true);
  assert.equal(assembledSequence.value.includes('MAE'), true);

  // Clearing the search returns to protein selection without a stale source.
  picker.open = true;
  searchInput.value = '';
  trigger(searchInput, 'keydown', { key: 'Enter', preventDefault() {} });
  await flushAsync();
  assert.equal(picker.open, true);
  assert.equal(sourcePanel.hidden, true);
  assert.equal(document.getElementById('sequence-viewer-protein-builder-feature-summary').textContent, 'Select protein');
  assert.equal(document.getElementById('sequence-viewer-protein-builder-feature-add-btn').disabled, true);
});
test('[EDGE] sequence-viewer protein builder can build DNA from the active vector source', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-protein-builder-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-protein-builder-confirmation',
    'sequence-viewer-protein-builder-confirmation-summary',
    'sequence-viewer-protein-builder-confirmation-back-btn',
    'sequence-viewer-protein-builder-confirmation-confirm-btn',
    'sequence-viewer-vector-builder-btn',
    'sequence-viewer-vector-builder-protein-builder-btn',
    'sequence-viewer-protein-builder-back-btn',
    'sequence-viewer-protein-builder-form',
    'sequence-viewer-protein-builder-name',
    'sequence-viewer-protein-builder-build-dna-btn',
    'sequence-viewer-protein-builder-sequence',
    'sequence-viewer-protein-builder-sequence-edited',
    'sequence-viewer-protein-builder-sequence-reset-btn',
    'sequence-viewer-protein-builder-common-blocks',
    'sequence-viewer-protein-builder-feature-search-input',
    'sequence-viewer-protein-builder-feature-search-status',
    'sequence-viewer-protein-builder-feature-search-results',
    'sequence-viewer-protein-builder-meta',
    'sequence-viewer-protein-builder-workflow',
    'sequence-viewer-protein-builder-sequence-editor',
    'sequence-viewer-protein-builder-protein-sequence-highlight',
    'sequence-viewer-protein-builder-sequence',
    'sequence-viewer-protein-builder-dna-meta',
    'sequence-viewer-protein-builder-dna-sequence',
    'sequence-viewer-save-btn',
    'sequence-viewer-save-name',
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
    'sequence-viewer-recognize-backbone-btn',
    'sequence-viewer-alignment-open-btn',
    'sequence-viewer-alignment-toggle',
    'sequence-viewer-alignment-session-select',
    'sequence-viewer-alignment-active-note',
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
  const copiedSequences = [];
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
    {
      document,
      navigator: {
        clipboard: {
          async writeText(value) {
            copiedSequences.push(value);
          }
        }
      }
    }
  );
  const viewer = moduleWithDom.initSequenceViewer();
  viewer.loadFromExternal({
    name: 'vector_with_poi',
    sequence: 'GGGATGTTATTATTACCC',
    topology: 'linear',
    source: 'external',
    features: [
      {
        id: 'poi_feature',
        name: 'PoiCds',
        type: 'cds',
        strand: 1,
        translation: 'MLLL',
        segments: [{ start: 3, end: 15 }]
      }
    ]
  });

  // Protein Builder is reached through Vector Builder now.
  trigger(document.getElementById('sequence-viewer-vector-builder-btn'), 'click', { preventDefault() {} });
  trigger(document.getElementById('sequence-viewer-vector-builder-protein-builder-btn'), 'click', { preventDefault() {} });

  await flushAsync();

  trigger(document.getElementById('sequence-viewer-protein-builder-build-dna-btn'), 'click');
  await flushAsync();

  const dnaMeta = document.getElementById('sequence-viewer-protein-builder-dna-meta');
  const dnaSequence = document.getElementById('sequence-viewer-protein-builder-dna-sequence');
  assert.match(dnaMeta.textContent, /nt/);
  assert.equal(dnaSequence.innerHTML.includes('ATGTTATTATTA'), true);

  // The assembled sequence is editable: a stop typed onto the end is carried
  // into the DNA build as a stop codon, and the vector's own codons upstream of
  // it are left exactly as they were.
  const assembled = document.getElementById('sequence-viewer-protein-builder-sequence');
  const editedFlag = document.getElementById('sequence-viewer-protein-builder-sequence-edited');
  const resetBtn = document.getElementById('sequence-viewer-protein-builder-sequence-reset-btn');
  const chainProtein = assembled.value;
  const sequenceEditor = document.getElementById('sequence-viewer-protein-builder-sequence-editor');
  const highlightedProtein = document.getElementById('sequence-viewer-protein-builder-protein-sequence-highlight');
  assert.match(chainProtein, /MLLL$/);
  assert.equal(highlightedProtein.innerHTML.includes('sequence-viewer-protein-builder-protein-segment'), true);
  assert.equal(highlightedProtein.innerHTML.includes('sequence-viewer-protein-builder-block-poi'), true);
  assert.deepEqual(
    highlightedProtein.innerHTML.match(/sequence-viewer-protein-builder-palette-\d+/g) || [],
    dnaSequence.innerHTML.match(/sequence-viewer-protein-builder-palette-\d+/g) || []
  );
  assert.equal(Boolean(editedFlag.hidden), true);

  trigger(highlightedProtein, 'click');
  assert.equal(sequenceEditor.classList.contains('is-editing'), true);
  trigger(assembled, 'blur');
  assert.equal(sequenceEditor.classList.contains('is-editing'), false);

  assembled.value = `${chainProtein}*`;
  trigger(assembled, 'change');
  await flushAsync();
  assert.equal(Boolean(editedFlag.hidden), false);
  assert.equal(Boolean(resetBtn.hidden), false);

  trigger(document.getElementById('sequence-viewer-protein-builder-build-dna-btn'), 'click');
  await flushAsync();
  const editedDna = document.getElementById('sequence-viewer-protein-builder-dna-sequence').innerHTML;
  // The vector's own codons survive; only the stop is new.
  assert.equal(editedDna.includes('ATGTTATTATTA'), true);
  assert.match(editedDna, /ATGTTATTATTA(TAA|TAG|TGA)/);

  // Only the 20 residues and a stop get through the field.
  assembled.value = `${chainProtein}Z*`;
  trigger(assembled, 'change');
  await flushAsync();
  assert.equal(assembled.value, `${chainProtein}*`);

  // Reset puts the chain's own sequence back.
  trigger(resetBtn, 'click', { preventDefault() {} });
  await flushAsync();
  assert.equal(assembled.value, chainProtein);
  assert.equal(Boolean(editedFlag.hidden), true);

  trigger(document.getElementById('sequence-viewer-protein-builder-build-dna-btn'), 'click');
  const copiedDna = document.getElementById('sequence-viewer-protein-builder-dna-sequence').innerHTML
    .replace(/<[^>]+>/g, '');
  trigger(document.getElementById('sequence-viewer-protein-builder-copy-protein-btn'), 'click');
  trigger(document.getElementById('sequence-viewer-protein-builder-copy-dna-btn'), 'click');
  await flushAsync();
  assert.deepEqual(copiedSequences, [chainProtein, copiedDna]);
});

test('[EDGE] protein builder DNA build uses the selected shared codon usage profile', () => {
  const { buildDnaConstruct } = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'protein-builder', 'dna-construct.js')
  );
  const payload = {
    constructName: 'Arginine repeat',
    activeDnaSource: {},
    rows: [{ id: 'custom_1', kind: 'custom', type: 'custom', label: 'Arg3', sequence: 'RRR' }]
  };
  const ecoli = buildDnaConstruct({ ...payload, codonUsageProfile: 'ecoli' });
  const yeast = buildDnaConstruct({ ...payload, codonUsageProfile: 'yeast' });

  assert.equal(ecoli.ok, true);
  assert.equal(yeast.ok, true);
  assert.equal(ecoli.sequence, 'CGTCGTCGT');
  assert.equal(yeast.sequence, 'AGAAGAAGA');
  assert.equal(yeast.parts[0].type, 'custom');
  assert.equal(yeast.parts[0].proteinLength, 3);
  assert.equal(yeast.parts[0].paletteSlot, 1);

  const storedFeature = {
    constructName: 'Stored arginine feature',
    activeDnaSource: {},
    codonUsageProfile: 'ecoli',
    rows: [{
      id: 'feature_1',
      kind: 'feature',
      type: 'feature',
      label: 'Stored Arg3',
      sequence: 'RRR',
      sourceDnaSequence: 'AGAAGAAGA'
    }]
  };
  const preserved = buildDnaConstruct(storedFeature);
  const optimized = buildDnaConstruct({
    ...storedFeature,
    rows: storedFeature.rows.map((row) => ({ ...row, codonOptimize: true }))
  });

  assert.equal(preserved.sequence, 'AGAAGAAGA');
  assert.equal(preserved.parts[0].codonOptimized, false);
  assert.equal(optimized.sequence, 'CGTCGTCGT');
  assert.equal(optimized.parts[0].codonOptimized, true);
  assert.equal(optimized.parts[0].templateSequence, '');
});

test('[EDGE] protein builder rotates through all twelve light palette slots', () => {
  const { getProteinBuilderPaletteSlot, getProteinBuilderPaletteClass } = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'protein-builder', 'block-palette.js')
  );

  assert.deepEqual(
    [1, 2, 11, 12, 13, 24, 25].map((position) => getProteinBuilderPaletteSlot(position)),
    [1, 2, 11, 12, 1, 12, 1]
  );
  assert.equal(getProteinBuilderPaletteClass(13), 'sequence-viewer-protein-builder-palette-1');
});
test('[EDGE] sequence-viewer protein builder uses flat sections instead of nested panel boxes', () => {
  const css = fs.readFileSync(
    path.join(__dirname, 'ui', 'css', 'views', 'sequence-viewer-view', 'shell-and-builders.css'),
    'utf8'
  );

  assert.match(css, /\.sequence-viewer-protein-builder-workspace\s*\{[^}]*gap:\s*0;/s);
  assert.match(css, /\.sequence-viewer-protein-builder-toolbar\s*\{[^}]*border:\s*0;[^}]*border-bottom:\s*1px solid var\(--theme-border-soft\);[^}]*background:\s*transparent;/s);
  assert.match(css, /\.sequence-viewer-protein-builder-panel\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*padding:\s*0;/s);
  assert.match(css, /\.sequence-viewer-protein-builder-common-fold\s*\{[^}]*border:\s*0;[^}]*border-bottom:\s*1px solid var\(--theme-border-soft\);[^}]*background:\s*transparent;/s);
  assert.match(css, /\.sequence-viewer-protein-builder-sequence-panel \.sequence-block\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;/s);
  assert.match(css, /\.sequence-viewer-protein-builder-protein-segment,\s*\.sequence-viewer-protein-builder-dna-segment\s*\{[^}]*background:\s*var\(--builder-block-fill, var\(--sequence-viewer-builder-custom\)\);[^}]*color:\s*var\(--sequence-viewer-builder-ink\);/s);
  assert.equal((css.match(/\.sequence-viewer-protein-builder-palette-\d+\s*\{/g) || []).length, 12);

  const html = fs.readFileSync(
    path.join(__dirname, 'ui', 'html', 'views', 'sequence-viewer-view.html'),
    'utf8'
  );
  assert.match(html, /id="sequence-viewer-protein-builder-add-protein-btn"[^>]*>\+Protein<\/button>/);
  assert.match(html, /id="sequence-viewer-protein-builder-add-protein-form"[^>]*role="dialog"[^>]*aria-modal="true"/);
  const dnaBuildTitleStart = html.indexOf('class="sequence-viewer-protein-builder-dna-title"');
  const codonUsageStart = html.indexOf('id="sequence-viewer-protein-builder-codon-usage"');
  const codonOptimizeStart = html.indexOf('id="sequence-viewer-protein-builder-feature-codon-optimize"');
  assert.ok(dnaBuildTitleStart >= 0);
  assert.ok(codonUsageStart > dnaBuildTitleStart);
  assert.ok(codonOptimizeStart > codonUsageStart);
  assert.match(html.slice(codonOptimizeStart), /^id="sequence-viewer-protein-builder-feature-codon-optimize"[^>]*type="checkbox"/);
  assert.match(html, /id="sequence-viewer-protein-builder-copy-protein-btn"[^>]*class="ghost-btn sequence-viewer-protein-builder-copy-btn"[^>]*aria-label="Copy protein sequence"[^>]*>[\s\S]*?<svg[^>]*>[\s\S]*?<span class="sr-only">Copy protein sequence<\/span>[\s\S]*?<\/button>/);
  assert.match(html, /id="sequence-viewer-protein-builder-copy-dna-btn"[^>]*class="ghost-btn sequence-viewer-protein-builder-copy-btn"[^>]*aria-label="Copy DNA sequence"[^>]*>[\s\S]*?<svg[^>]*>[\s\S]*?<span class="sr-only">Copy DNA sequence<\/span>[\s\S]*?<\/button>/);
  assert.match(html, /id="sequence-viewer-protein-builder-protein-sequence-highlight"[^>]*role="button"[^>]*tabindex="0"/);
});
  }
};
