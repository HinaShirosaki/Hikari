module.exports = function registerProteinBuilderUniProtSuite(context = {}) {
  const { assert, path, loadEsmStyleModule, test } = context.scope;
  const base = path.join(context.__dirname, 'src/renderer/modules/sequence-viewer/protein-builder');
  const { getUniProtRegions, selectUniProtSequence } = loadEsmStyleModule(path.join(base, 'uniprot-model.js'));
  const { installProteinBuilderAddProteinDialog } = loadEsmStyleModule(path.join(base, 'add-protein-dialog.js'));
  const protein = {
    accession: 'Q9TEST', entryId: 'TEST_HUMAN', proteinName: 'Example protein', geneNames: ['TST'],
    organism: { scientificName: 'Homo sapiens' }, reviewed: true,
    sequence: { value: 'MACDEFGHIKLNPQRSTVWY', length: 20 },
    features: [
      { type: 'Domain', description: 'Example domain', start: { value: 2, modifier: 'EXACT' }, end: { value: 6, modifier: 'EXACT' } },
      { type: 'Region', description: 'Uncertain', start: { value: 3, modifier: 'OUTSIDE' }, end: { value: 8 } },
      { type: 'Domain', description: 'Outside sequence', start: { value: 18 }, end: { value: 25 } },
      { type: 'Binding site', start: { value: 5 }, end: { value: 5 } }
    ]
  };
  function setup(bridge = {}) {
    const fields = [
      'AddProteinSource', 'AddProteinSourceManual', 'AddProteinSourceUniProt',
      'AddProteinType', 'AddProteinName', 'AddProteinSequence', 'AddProteinConfirmBtn',
      'AddProteinValidation', 'AddProteinOverlay', 'AddProteinTitle', 'UniProtPanel', 'UniProtQuery',
      'UniProtSearchBtn', 'UniProtMoreBtn', 'UniProtStatus', 'UniProtResults', 'UniProtResultsToggleBtn', 'UniProtDetail',
      'UniProtSummary', 'UniProtRegion'
    ];
    const elements = Object.fromEntries(fields.map((name) => [`proteinBuilder${name}`, { value: '', textContent: '', hidden: false }]));
    const ctx = {
      elements, state: { rows: [], nextRowId: 1 }, getBridge: () => bridge,
      appendRow: (row) => ctx.state.rows.push(row), invalidateDnaConstruct() {}, render() {}, setBuilderStatus() {}
    };
    installProteinBuilderAddProteinDialog(ctx);
    ctx.openAddProteinDialog();
    const useUniProt = () => {
      elements.proteinBuilderAddProteinSourceUniProt.checked = true;
      elements.proteinBuilderAddProteinSourceManual.checked = false;
      ctx.setAddProteinSource();
      elements.proteinBuilderUniProtQuery.value = 'gene:TST AND organism_id:9606';
    };
    return { ctx, e: elements, useUniProt };
  }
  const searchResponse = (items = [protein], extra = {}) => ({ ok: true, result: { items, total: items.length, ...extra } });

  test('[EDGE] protein builder UniProt extracts inclusive domains and rejects uncertain or invalid boundaries', () => {
    const regions = getUniProtRegions(protein);
    assert.equal(regions.length, 3);
    assert.equal(regions[0].selectable, true);
    assert.equal(regions[1].selectable, false);
    assert.equal(regions[2].selectable, false);
    const selection = selectUniProtSequence(protein, 2, 6, regions[0]);
    assert.equal(selection.sequence, 'ACDEF');
    assert.equal(selection.uniprot.featureDescription, 'Example domain');
    assert.equal(selectUniProtSequence(protein, 1, 20).sequence, protein.sequence.value);
    for (const [start, end] of [[0, 5], [5, 4], [1, 21], [1.5, 3], ['', '']]) {
      assert.match(selectUniProtSequence(protein, start, end).error, /residue range/);
    }
    const nonstandard = { ...protein, sequence: { value: 'MAXU' } };
    assert.match(selectUniProtSequence(nonstandard, 1, 4).error, /X, U/);
    assert.equal(selectUniProtSequence(nonstandard, 1, 2).sequence, 'MA');
  });

  test('[EDGE] protein builder UniProt adds selected domains with source identity and clears provenance after manual edits', async () => {
    const { ctx, e, useUniProt } = setup({ searchUniProt: async () => searchResponse() });
    useUniProt();
    assert.equal(ctx.addProteinFromDialog(), false);
    await ctx.searchUniProt();
    assert.equal(e.proteinBuilderUniProtStatus.textContent, '');
    assert.equal(e.proteinBuilderUniProtStatus.hidden, true);
    await ctx.selectUniProtResult(0);
    e.proteinBuilderUniProtRegion.value = 'region-0';
    assert.equal(ctx.addProteinFromDialog(), true);
    const row = ctx.state.rows[0];
    assert.equal(row.sequence, 'ACDEF');
    assert.equal(row.uniprot.accession, 'Q9TEST');
    assert.equal(row.uniprot.start, 2);
    assert.equal(row.uniprot.end, 6);
    assert.match(row.note, /residues 2–6/);
    ctx.openAddProteinDialog(row.id);
    assert.equal(ctx.addProteinFromDialog(), true);
    assert.equal(row.uniprot.accession, 'Q9TEST');
    ctx.openAddProteinDialog(row.id);
    e.proteinBuilderAddProteinSequence.value = 'MAKT';
    ctx.addProteinFromDialog();
    assert.equal(row.uniprot, undefined);
    assert.match(row.note, /User-defined/);
  });

  test('[EDGE] protein builder UniProt preserves manual DNA drafts and ignores late results after closing or switching source', async () => {
    let finish;
    const { ctx, e, useUniProt } = setup({ searchUniProt: () => new Promise((resolve) => { finish = resolve; }) });
    e.proteinBuilderAddProteinType.value = 'dna';
    e.proteinBuilderAddProteinName.value = 'Manual DNA';
    e.proteinBuilderAddProteinSequence.value = 'ATGGCT';
    useUniProt();
    const pending = ctx.searchUniProt();
    e.proteinBuilderAddProteinSourceManual.checked = true;
    e.proteinBuilderAddProteinSourceUniProt.checked = false;
    ctx.setAddProteinSource();
    finish(searchResponse());
    await pending;
    assert.equal(e.proteinBuilderUniProtResults.innerHTML, '');
    assert.equal(e.proteinBuilderAddProteinSequence.value, 'ATGGCT');
    assert.equal(e.proteinBuilderAddProteinType.value, 'dna');
    useUniProt();
    const closed = ctx.searchUniProt();
    ctx.closeAddProteinDialog();
    finish(searchResponse());
    await closed;
    assert.equal(e.proteinBuilderUniProtResults.innerHTML, '');
    assert.equal(e.proteinBuilderAddProteinOverlay.hidden, true);
  });

  test('[EDGE] protein builder UniProt handles failed searches, pagination, and proteins without annotations', async () => {
    const calls = [];
    const { ctx, e, useUniProt } = setup({ searchUniProt: async (payload) => {
      calls.push(payload);
      if (calls.length === 1) return { ok: false, error: 'UniProt is offline. Try again.' };
      if (calls.length === 2) return searchResponse([protein], { total: 2, nextCursor: 'NEXT' });
      return searchResponse([protein, { ...protein, accession: 'P00002', features: [] }], { total: 2 });
    } });
    useUniProt();
    await ctx.searchUniProt();
    assert.match(e.proteinBuilderUniProtStatus.textContent, /offline/);
    assert.equal(e.proteinBuilderUniProtSearchBtn.disabled, false);
    await ctx.searchUniProt();
    assert.equal(e.proteinBuilderUniProtMoreBtn.hidden, false);
    await ctx.selectUniProtResult(0);
    assert.equal(e.proteinBuilderUniProtMoreBtn.hidden, true);
    assert.equal(e.proteinBuilderUniProtResultsToggleBtn.hidden, false);
    ctx.toggleUniProtResults();
    assert.equal(e.proteinBuilderUniProtMoreBtn.hidden, false);
    await ctx.searchUniProt(true);
    assert.equal(calls[2].cursor, 'NEXT');
    assert.equal((e.proteinBuilderUniProtResults.innerHTML.match(/data-uniprot-result=/g) || []).length, 2);
    await ctx.selectUniProtResult(1);
    assert.equal((e.proteinBuilderUniProtResults.innerHTML.match(/data-uniprot-result=/g) || []).length, 1);
    assert.match(e.proteinBuilderUniProtResults.innerHTML, /data-uniprot-result="1"/);
    assert.equal(e.proteinBuilderUniProtResultsToggleBtn.textContent, 'Show all results');
    ctx.toggleUniProtResults();
    assert.equal((e.proteinBuilderUniProtResults.innerHTML.match(/data-uniprot-result=/g) || []).length, 2);
    assert.equal(ctx.getUniProtInput().uniprot.accession, 'P00002');
    ctx.toggleUniProtResults();
    assert.equal((e.proteinBuilderUniProtResults.innerHTML.match(/data-uniprot-result=/g) || []).length, 1);
    assert.equal(e.proteinBuilderUniProtRegion.innerHTML.includes('region-'), false);
    assert.equal(e.proteinBuilderUniProtRegion.innerHTML.includes('Custom residue range'), false);
    assert.equal(ctx.getUniProtInput().sequence, protein.sequence.value);
    assert.equal(e.proteinBuilderUniProtMoreBtn.hidden, true);
    await ctx.searchUniProt();
    assert.equal((e.proteinBuilderUniProtResults.innerHTML.match(/data-uniprot-result=/g) || []).length, 2);
    assert.equal(e.proteinBuilderUniProtResultsToggleBtn.hidden, true);
  });

  test('[EDGE] protein builder UniProt ignores stale entry retrieval when a second protein is selected', async () => {
    let finish;
    const { ctx, e, useUniProt } = setup({
      searchUniProt: async () => searchResponse([{ ...protein, sequence: {} }, { ...protein, accession: 'P00002' }]),
      getUniProtEntry: () => new Promise((resolve) => { finish = resolve; })
    });
    useUniProt();
    await ctx.searchUniProt();
    const first = ctx.selectUniProtResult(0);
    await ctx.selectUniProtResult(1);
    finish({ ok: true, result: { entry: protein } });
    await first;
    assert.equal(ctx.getUniProtInput().uniprot.accession, 'P00002');
    assert.equal(e.proteinBuilderUniProtSearchBtn.disabled, false);
  });
};
