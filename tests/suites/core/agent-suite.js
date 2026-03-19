module.exports = function registerAgentSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('plannotate GenBank generator builds a valid record with qualifiers', () => {
  const gbk = generatePlannotateGbk({
    sequence: 'ATGCGTACGTAGCTAGCTAGCTAGCATCGATCGATCGATCGATCGATCG',
    topology: 'circular',
    recordName: 'demo_plasmid',
    hits: [
      {
        qstart: 0,
        qend: 12,
        sframe: 1,
        Feature: 'promoterA',
        Type: 'promoter',
        db: 'snapgene',
        pident: 99.7,
        percmatch: 100,
        fragment: false
      }
    ]
  });

  assert.match(gbk, /^LOCUS\s+demo_plasmid/m);
  assert.match(gbk, /^FEATURES\s+Location\/Qualifiers$/m);
  assert.match(gbk, /^\s+promoter\s+1\.\.12$/m);
  assert.match(gbk, /\/label="promoterA"/);
  assert.match(gbk, /\/identity="99\.7"/);
  assert.match(gbk, /^ORIGIN$/m);
  assert.match(gbk, /^\/\/$/m);
});

test('plannotate GenBank generator preserves reverse-strand origin crossing order', () => {
  const gbk = generatePlannotateGbk({
    sequence: 'ATGCGTACGTAGCTAGCTAGCTAGCATCGATCGATCGATCGATCGATCG',
    topology: 'circular',
    hits: [
      {
        qstart: 40,
        qend: 5,
        sframe: -1,
        Feature: 'cdsX',
        Type: 'CDS',
        db: 'swissprot',
        pident: 87.2,
        percmatch: 45.4,
        fragment: true,
        crossesOrigin: true
      }
    ]
  });

  assert.match(gbk, /complement\(join\(1\.\.5,41\.\.49\)\)/);
  assert.match(gbk, /\/label="cdsX \(fragment\)"/);
});

test('papers-management normalizePaperSummary preserves non-JSON text', () => {
  const rawSummary = 'This paper reports a new screening assay with reproducible hit enrichment.';
  const normalized = papersManagementInternals.normalizePaperSummary(rawSummary);
  assert.equal(normalized.summary, rawSummary);
  assert.equal(normalized.structured, null);
});

test('papers-management normalizePaperSummary prefers structured plain-English summary', () => {
  const rawSummary = JSON.stringify({
    title: 'Demo paper',
    plain_english_summary: 'A simple plain-language summary.',
    main_conclusion: 'Main conclusion text.'
  });
  const normalized = papersManagementInternals.normalizePaperSummary(rawSummary);
  assert.equal(normalized.summary, 'A simple plain-language summary.');
  assert.equal(normalized.structured?.title, 'Demo paper');
});

test('papers-management upload triggers background auto-ingestion and deep-read availability fields', async () => {
  const document = createMockDocument([
    'paper-form',
    'paper-title',
    'paper-pdf',
    'paper-link-type',
    'paper-link-target',
    'paper-list',
    'journal-club-name',
    'journal-club-description',
    'journal-club-add-btn',
    'journal-club-list',
    'knowledge-project-select',
    'knowledge-question',
    'knowledge-ask-btn',
    'knowledge-answer',
    'knowledge-chat-history'
  ]);
  const paperForm = document.getElementById('paper-form');
  const paperTitleInput = document.getElementById('paper-title');
  const paperPdfInput = document.getElementById('paper-pdf');
  const paperLinkTypeSelect = document.getElementById('paper-link-type');
  const paperLinkTargetSelect = document.getElementById('paper-link-target');

  paperLinkTypeSelect.value = 'project';
  paperLinkTargetSelect.value = 'p1';
  paperTitleInput.value = 'Atlas Upload';
  paperPdfInput.files = [{ name: 'atlas-upload.pdf' }];
  wireFormReset(paperForm, [paperTitleInput, paperPdfInput, paperLinkTargetSelect, paperLinkTypeSelect]);

  class MockFileReader {
    readAsDataURL() {
      this.result = 'data:application/pdf;base64,AAAA';
      setTimeout(() => {
        if (typeof this.onload === 'function') {
          this.onload();
        }
      }, 0);
    }
  }

  const fetch = async () => ({
    ok: true,
    json: async () => ({
      papers: {
        paperSummary: 'SUMMARY_PROMPT {{title}}',
        extractMethods: 'METHODS_PROMPT',
        extractReagents: 'REAGENTS_PROMPT',
        knowledgeQa: 'QA_PROMPT',
        paperTitleSuffix: 'TITLE {{title}}'
      }
    })
  });

  const codexResponses = [];
  const window = {
    alert: () => {},
    enanaApi: {
      storeImportedFile: async () => ({
        ok: true,
        filePath: '/tmp/enana/atlas-upload.pdf',
        fileName: 'atlas-upload.pdf',
        relativePath: 'Project/Atlas/Papers/atlas-upload.pdf'
      }),
      runCodexLlmPrompt: async ({ prompt }) => {
        codexResponses.push(String(prompt || ''));
        const promptText = String(prompt || '');
        if (promptText.includes('SUMMARY_PROMPT')) {
          return {
            ok: true,
            text: JSON.stringify({
              title: 'Atlas Upload',
              plain_english_summary: 'Paper summary.',
              important_figures_or_tables: [
                { item: 'Figure 2', summary: 'Expression rescue trend.' }
              ]
            })
          };
        }
        if (promptText.includes('METHODS_PROMPT')) {
          return {
            ok: true,
            text: JSON.stringify([
              {
                title: 'Method A',
                purpose: 'Test method',
                materials: ['Buffer'],
                steps: [{ step_number: 1, action: 'Prepare cells' }],
                troubleshooting: []
              }
            ])
          };
        }
        if (promptText.includes('REAGENTS_PROMPT')) {
          return {
            ok: true,
            text: JSON.stringify({
              reagents: [
                { name: 'Reagent Z', type: 'compound', identifier: 'RZ-1', notes: 'demo' }
              ]
            })
          };
        }
        return { ok: true, text: '{}' };
      }
    }
  };

  let persistCalls = 0;
  const state = {
    projects: [{ id: 'p1', name: 'Atlas' }],
    journalClubs: [],
    papers: [],
    paperExperimentLinks: [],
    notebookEntries: [],
    protocols: [],
    knowledgeChats: {},
    settings: {
      storagePath: '/tmp/enana',
      llm: {
        provider: 'codex',
        model: 'codex-default'
      }
    }
  };

  const module = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'papers-management.js'), {
    document,
    window,
    fetch,
    FileReader: MockFileReader
  });
  const papersManager = module.initPapersManagement({
    state,
    persist: () => {
      persistCalls += 1;
    },
    createId: (() => {
      let idx = 0;
      return () => `paper-${idx += 1}`;
    })(),
    safeText: shared.safeText,
    onCreateProtocolDraft: () => {}
  });
  papersManager.render();
  paperLinkTargetSelect.value = 'p1';

  trigger(paperForm, 'submit');
  await flushAsync();
  await flushAsync();
  await flushAsync();
  await flushAsync();
  await flushAsync();
  await flushAsync();

  assert.equal(state.papers.length, 1);
  const paper = state.papers[0];
  assert.equal(paper.title, 'Atlas Upload');
  assert.equal(paper.ingestionStatus, 'ready');
  assert.equal(paper.availabilityStatus, 'deep_ready');
  assert.equal(paper.deepReadReady, true);
  assert.equal(Array.isArray(paper.keyFigures), true);
  assert.equal(paper.keyFigures.length > 0, true);
  assert.equal(Array.isArray(paper.methodsExtract), true);
  assert.equal(paper.methodsExtract.length > 0, true);
  assert.equal(Array.isArray(paper.keyReagents), true);
  assert.equal(paper.keyReagents.length > 0, true);
  assert.equal(codexResponses.some((prompt) => prompt.includes('SUMMARY_PROMPT')), true);
  assert.equal(codexResponses.some((prompt) => prompt.includes('METHODS_PROMPT')), true);
  assert.equal(codexResponses.some((prompt) => prompt.includes('REAGENTS_PROMPT')), true);
  assert.equal(persistCalls > 1, true);
});

test('papers-management open PDF button opens stored file path through bridge API', async () => {
  const document = createMockDocument([
    'paper-form',
    'paper-title',
    'paper-pdf',
    'paper-link-type',
    'paper-link-target',
    'paper-list',
    'journal-club-name',
    'journal-club-description',
    'journal-club-add-btn',
    'journal-club-list',
    'knowledge-project-select',
    'knowledge-question',
    'knowledge-ask-btn',
    'knowledge-answer',
    'knowledge-chat-history'
  ]);

  const openedPaths = [];
  const window = {
    alert: () => {},
    open: () => null,
    enanaApi: {
      openFilePath: async (targetPath) => {
        openedPaths.push(String(targetPath || ''));
        return { ok: true };
      }
    }
  };

  const state = {
    projects: [{ id: 'p1', name: 'Atlas' }],
    journalClubs: [],
    papers: [
      {
        id: 'paper-1',
        title: 'Atlas PDF',
        fileName: 'atlas.pdf',
        linkedType: 'project',
        linkedId: 'p1',
        linkedName: 'Atlas',
        summary: '',
        summaryStatus: 'idle',
        methodsExtract: [],
        methodsStatus: 'idle',
        keyReagents: [],
        reagentsStatus: 'idle',
        keyFigures: [],
        deepReadReady: false,
        availabilityStatus: 'uploaded_pdf',
        ingestionStatus: 'ready',
        ingestionUpdatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        storedFilePath: '/tmp/enana/atlas.pdf',
        storedRelativePath: 'Project/Atlas/Papers/atlas.pdf',
        pdfDataUrl: ''
      }
    ],
    paperExperimentLinks: [],
    notebookEntries: [],
    protocols: [],
    knowledgeChats: {},
    settings: {
      storagePath: '/tmp/enana',
      llm: {
        provider: 'codex',
        model: 'codex-default'
      }
    }
  };

  const module = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'papers-management.js'), {
    document,
    window,
    fetch: async () => ({
      ok: true,
      json: async () => ({ papers: {} })
    })
  });
  const papersManager = module.initPapersManagement({
    state,
    persist: () => {},
    createId: () => 'paper-new',
    safeText: shared.safeText,
    onCreateProtocolDraft: () => {}
  });
  papersManager.render();

  const paperList = document.getElementById('paper-list');
  trigger(paperList, 'click', {
    target: {
      closest(selector) {
        if (selector === '[data-paper-open]') {
          return { dataset: { paperOpen: 'paper-1' } };
        }
        return null;
      }
    }
  });
  await flushAsync();

  assert.deepEqual(openedPaths, ['/tmp/enana/atlas.pdf']);
});

test('normalizeState keeps defaults and migrates legacy LLM API key', () => {
  const normalized = shared.normalizeState({
    growthMetrics: {
      counters: {
        protocol_share_sent: '3',
        protocol_share_imported: 'bad'
      },
      events: 'not-an-array'
    },
    settings: {
      llm: {
        api: 'sk-test-123'
      }
    }
  });

  assert.equal(Array.isArray(normalized.members), true);
  assert.equal(normalized.growthMetrics.counters.protocol_share_sent, 3);
  assert.equal(normalized.growthMetrics.counters.protocol_share_imported, 0);
  assert.equal(Array.isArray(normalized.growthMetrics.events), true);
  assert.equal(normalized.growthMetrics.events.length, 0);
  assert.equal(normalized.settings.llm.provider, 'openai');
  assert.equal(normalized.settings.llm.apiKey, 'sk-test-123');
  assert.equal(
    normalized.settings.llm.apiEndpoint,
    shared.defaultState.settings.llm.apiEndpoint
  );
});

test('persistState and loadState round trip through localStorage', () => {
  memoryStorage.clear();
  const state = shared.normalizeState({
    members: [{ id: 'm1', name: 'Alice' }]
  });
  shared.persistState(state);

  const loaded = shared.loadState();
  assert.equal(loaded.members.length, 1);
  assert.equal(loaded.members[0].id, 'm1');

  memoryStorage.setItem(shared.STORAGE_KEY, '{bad-json');
  const fallback = shared.loadState();
  assert.equal(JSON.stringify(fallback), JSON.stringify(shared.defaultState));
});

test('loadState migrates legacy synthesis drafts and clears legacy key', () => {
  memoryStorage.clear();
  const base = shared.normalizeState({});
  base.synthesisChemistryDrafts = {};
  memoryStorage.setItem(shared.STORAGE_KEY, JSON.stringify(base));

  const legacyDrafts = {
    projectA: {
      __synthesis__: {
        synthesisChemistry: { enabled: true }
      }
    }
  };
  memoryStorage.setItem(LEGACY_CHEMISTRY_DRAFT_KEY, JSON.stringify(legacyDrafts));

  const loaded = shared.loadState();
  assert.deepEqual(loaded.synthesisChemistryDrafts, legacyDrafts);
  assert.equal(memoryStorage.getItem(LEGACY_CHEMISTRY_DRAFT_KEY), null);

  const persisted = JSON.parse(memoryStorage.getItem(shared.STORAGE_KEY));
  assert.deepEqual(persisted.synthesisChemistryDrafts, legacyDrafts);
});

test('loadState drops invalid legacy synthesis draft payloads', () => {
  memoryStorage.clear();
  memoryStorage.setItem(shared.STORAGE_KEY, JSON.stringify(shared.normalizeState({})));
  memoryStorage.setItem(LEGACY_CHEMISTRY_DRAFT_KEY, JSON.stringify(['invalid']));

  const loaded = shared.loadState();
  assert.deepEqual(loaded.synthesisChemistryDrafts, {});
  assert.equal(memoryStorage.getItem(LEGACY_CHEMISTRY_DRAFT_KEY), null);
});

test('trackGrowthEvent increments counters and caps event history at 500', () => {
  const state = {};
  shared.trackGrowthEvent(state, 'protocol_share_sent', { source: 'test' });
  assert.equal(state.growthMetrics.counters.protocol_share_sent, 1);
  assert.equal(state.growthMetrics.events.length, 1);

  for (let i = 0; i < 510; i += 1) {
    shared.trackGrowthEvent(state, 'custom_event', { index: i });
  }
  assert.equal(state.growthMetrics.events.length, 500);
});

test('safeText and cssEscape escape unsafe input', () => {
  assert.equal(shared.safeText(`<script>alert('x')</script>`), '&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;');
  assert.equal(shared.cssEscape(String.raw`a"b\c`), String.raw`a\"b\\c`);
});

test('main-utils handles supported data-file extensions and fallback behavior', () => {
  assert.equal(mainUtils.hasSupportedDataExtension('/tmp/file.json'), true);
  assert.equal(mainUtils.hasSupportedDataExtension('/tmp/file.ENA'), true);
  assert.equal(mainUtils.hasSupportedDataExtension('/tmp/file.txt'), false);

  assert.equal(
    mainUtils.normalizeDataFilePath('/tmp/session.ena', '/tmp/default.json'),
    '/tmp/session.ena'
  );
  assert.equal(
    mainUtils.normalizeDataFilePath('/tmp/session', '/tmp/default.json'),
    '/tmp/session.json'
  );
  assert.equal(
    mainUtils.normalizeDataFilePath('', '/tmp/default.ena'),
    '/tmp/default.ena'
  );
  assert.equal(mainUtils.normalizeDataFilePath('', ''), '');
});

test('main-utils normalizes output names, suffixes, and sequence input', () => {
  assert.equal(mainUtils.sanitizeOutputName('  My Plasmid v1  '), 'My_Plasmid_v1');
  assert.equal(mainUtils.sanitizeOutputName('***', 'fallback'), 'fallback');
  assert.equal(mainUtils.sanitizeSuffix(' _pL ann!* '), '_pLann');

  const normalized = mainUtils.normalizeSequenceInput('acgt '.repeat(30));
  const lines = normalized.trimEnd().split('\n');
  assert.equal(lines[0], '>sequence');
  assert.equal(lines[1].length, 80);
  assert.equal(lines[2].length, 40);
  assert.equal(mainUtils.normalizeSequenceInput('>existing\nACGT\n'), '>existing\nACGT');
});

function makeIntentParserPayload({
  primaryIntent = 'general_science_question',
  confidence = 0.8,
  needsClarification = false,
  clarificationReason = null,
  entities = {},
  inventorySearch = {},
  secondaryIntents = []
} = {}) {
  return {
    primary_intent: primaryIntent,
    secondary_intents: secondaryIntents,
    confidence,
    needs_clarification: needsClarification,
    clarification_reason: clarificationReason,
    entities: {
      activity_type: entities.activity_type || null,
      project_name: entities.project_name || null,
      protocol_name: entities.protocol_name || null,
      protein_name: entities.protein_name || null,
      compound_name: entities.compound_name || null,
      inventory_item: entities.inventory_item || null,
      cell_line: entities.cell_line || null,
      paper_title: entities.paper_title || null,
      workflow_step: entities.workflow_step || null,
      requested_output: entities.requested_output || null
    },
    inventory_search: {
      normalized_query: inventorySearch.normalized_query || null,
      candidate_terms: Array.isArray(inventorySearch.candidate_terms) ? inventorySearch.candidate_terms : [],
      aliases: Array.isArray(inventorySearch.aliases) ? inventorySearch.aliases : [],
      search_mode: inventorySearch.search_mode || null
    },
    reasoning_summary: 'test parser payload'
  };
}

[
  ['protocol_to_notebook'],
  ['inventory_lookup'],
  ['record_lookup'],
  ['project_science_question'],
  ['general_science_question'],
  ['paper_analysis'],
  ['literature_search'],
  ['data_analysis_or_coding'],
  ['mixed_request'],
  ['unclear']
].forEach(([intent], idx) => {
  test(`[P0] agent-intent-parser normalizes allowed intent ${idx + 1}`, () => {
    const parsed = agentIntentParser.normalizeIntentParserPayload(makeIntentParserPayload({
      primaryIntent: intent
    }));
    assert.equal(parsed.ok, true);
    assert.equal(parsed.payload.primary_intent, intent);
  });
});

[
  ['protocol_to_notebook', { activity: 'grew cells', protocol: '', compound: '' }, { needs_tools: true, needs_protocol_search: true, needs_notebook_generation: true, notebook_autosave: true, needs_python: false }],
  ['inventory_lookup', { compound: 'biotin' }, { needs_tools: true, needs_protocol_search: false, needs_python: false }],
  ['record_lookup', { workflow_step: 'transfection' }, { needs_tools: true, needs_notebook_retrieval: true }],
  ['project_science_question', { project: 'Atlas' }, { needs_tools: true, needs_notebook_retrieval: true }],
  ['paper_analysis', { paper_title: 'Binder paper' }, { needs_tools: true, needs_pdf_reading: true }],
  ['coding_data_analysis', { activity: 'fit curve' }, { needs_tools: true, needs_python: true }],
  ['general_science_question', {}, { needs_tools: false }]
].forEach(([intent, entities, expectedFlags], idx) => {
  test(`[P0] agent-routing buildExecutionPlan case ${idx + 1}`, () => {
    const plan = agentRouting.buildExecutionPlan({
      intent,
      entities,
      message: 'test message',
      writeIntent: false
    });
    Object.entries(expectedFlags).forEach(([key, expected]) => {
      assert.equal(plan[key], expected);
    });
  });
});

test('agent-intent-parser rejects malformed payload', () => {
  const parsed = agentIntentParser.normalizeIntentParserPayload('not-json');
  assert.equal(parsed.ok, false);
  assert.match(String(parsed.error || ''), /json/i);
});

test('agent-routing uses scored tool selection when toolContract is provided', () => {
  const toolContract = agentTools.loadToolContract({
    tools: [
      { name: 'search_inventory', description: 'inventory reagent stock', input_schema: {}, output_schema: {} },
      { name: 'search_notebook_entries', description: 'notebook history', input_schema: {}, output_schema: {} },
      { name: 'search_uniprot', description: 'protein uniprot', input_schema: {}, output_schema: {} }
    ]
  });
  const parserPayload = makeIntentParserPayload({
    primaryIntent: 'inventory_lookup',
    entities: {
      compound_name: 'biotin',
      inventory_item: 'biotin'
    },
    inventorySearch: {
      normalized_query: 'biotin',
      candidate_terms: ['biotin', 'd-biotin'],
      aliases: ['vitamin b7'],
      search_mode: 'exact_then_alias_then_fuzzy'
    }
  });
  const routing = agentRouting.buildRoutingDecisionFromIntentParser({
    parserPayload,
    message: 'what is the mw of biotin',
    snapshot: {},
    availableToolNames: ['search_inventory', 'search_notebook_entries', 'search_uniprot'],
    toolContract,
    writeIntent: false
  });
  assert.equal(routing.plan.selected_tool_names.includes('search_inventory'), true);
  assert.equal(Array.isArray(routing.plan.tool_selection_rationale), true);
  assert.equal(routing.plan.tool_selection_rationale.length > 0, true);
});

test('agent-routing maps canonical intents to execution intents', () => {
  const literatureRouting = agentRouting.buildRoutingDecisionFromIntentParser({
    parserPayload: makeIntentParserPayload({
      primaryIntent: 'literature_search',
      entities: { protein_name: 'PD-1' }
    }),
    message: 'Find recent PD-1 literature.',
    snapshot: {},
    availableToolNames: AGENT_IO_TOOL_NAMES,
    toolContract: AGENT_IO_CONTRACT
  });
  assert.equal(literatureRouting.intent, 'general_science_question');
  assert.equal(literatureRouting.plan.needs_web_search, true);

  const codingRouting = agentRouting.buildRoutingDecisionFromIntentParser({
    parserPayload: makeIntentParserPayload({
      primaryIntent: 'data_analysis_or_coding',
      entities: { requested_output: 'plot IC50 curve' }
    }),
    message: 'Use python to analyze this csv.',
    snapshot: {},
    availableToolNames: AGENT_IO_TOOL_NAMES,
    toolContract: AGENT_IO_CONTRACT
  });
  assert.equal(codingRouting.intent, 'coding_data_analysis');
  assert.equal(codingRouting.plan.needs_python, true);
});

test('agent-routing coding intent emits python plan metadata with ready state', () => {
  const routing = agentRouting.buildRoutingDecisionFromIntentParser({
    parserPayload: makeIntentParserPayload({
      primaryIntent: 'data_analysis_or_coding',
      entities: {
        requested_output: 'compute means'
      }
    }),
    message: 'Use Python to analyze this CSV and compute means.',
    snapshot: {
      projects: [],
      protocols: [],
      notebookEntries: [],
      workflows: [],
      papers: [],
      assays: [
        { id: 'assay-1', name: 'Atlas assay', numeric_count: 8, result_well_count: 96 }
      ],
      gelAnalyses: []
    },
    availableToolNames: AGENT_IO_TOOL_NAMES,
    toolContract: AGENT_IO_CONTRACT,
    writeIntent: false
  });
  assert.equal(routing.intent, 'coding_data_analysis');
  assert.equal(routing.plan.needs_python, true);
  assert.equal(Boolean(routing.plan.python_task_type), true);
  assert.equal(routing.plan.python_ready, true);
  assert.equal(routing.plan.python_needs_clarification, false);
});

test('agent-routing coding intent requests clarification when Python input is missing', () => {
  const routing = agentRouting.buildRoutingDecisionFromIntentParser({
    parserPayload: makeIntentParserPayload({
      primaryIntent: 'data_analysis_or_coding'
    }),
    message: 'Use Python to analyze attached CSV and compute growth curve.',
    snapshot: {
      projects: [],
      protocols: [],
      notebookEntries: [],
      workflows: [],
      papers: [],
      assays: [],
      gelAnalyses: []
    },
    availableToolNames: AGENT_IO_TOOL_NAMES,
    toolContract: AGENT_IO_CONTRACT,
    writeIntent: false
  });
  assert.equal(routing.intent, 'coding_data_analysis');
  assert.equal(routing.plan.python_needs_clarification, true);
  assert.equal(routing.plan.needs_clarification, true);
  assert.match(String(routing.plan.clarification_question || ''), /csv|tabular|data/i);
});

test('agent-routing general recency query enables web-search planning flags', () => {
  const routing = agentRouting.buildRoutingDecisionFromIntentParser({
    parserPayload: makeIntentParserPayload({
      primaryIntent: 'general_science_question'
    }),
    message: 'What are the latest reviews on PD-1 signaling with citations?',
    snapshot: {
      projects: [],
      protocols: [],
      notebookEntries: [],
      workflows: [],
      papers: [],
      assays: [],
      gelAnalyses: []
    },
    availableToolNames: AGENT_IO_TOOL_NAMES,
    toolContract: AGENT_IO_CONTRACT,
    writeIntent: false
  });
  assert.equal(routing.intent, 'general_science_question');
  assert.equal(routing.plan.needs_web_search, true);
  assert.equal(routing.plan.needs_tools, true);
  assert.equal(routing.plan.selected_tool_names.includes('search_web'), true);
});

test('agent-routing mixed_request and unclear enforce clarification', () => {
  const mixedRouting = agentRouting.buildRoutingDecisionFromIntentParser({
    parserPayload: makeIntentParserPayload({
      primaryIntent: 'mixed_request',
      needsClarification: true,
      clarificationReason: 'Multiple objectives detected.'
    }),
    message: 'Summarize paper and update notebook.',
    snapshot: {},
    availableToolNames: AGENT_IO_TOOL_NAMES,
    toolContract: AGENT_IO_CONTRACT
  });
  assert.equal(mixedRouting.plan.needs_clarification, true);
  assert.match(String(mixedRouting.plan.clarification_question || ''), /which should i handle first/i);

  const unclearRouting = agentRouting.buildRoutingDecisionFromIntentParser({
    parserPayload: makeIntentParserPayload({
      primaryIntent: 'unclear',
      needsClarification: true
    }),
    message: 'help',
    snapshot: {},
    availableToolNames: AGENT_IO_TOOL_NAMES,
    toolContract: AGENT_IO_CONTRACT
  });
  assert.equal(unclearRouting.plan.needs_clarification, true);
});

test('agent-protocol-matching builds searchable docs from mixed protocol shapes', () => {
  const docs = agentProtocolMatching.buildSearchableProtocolDocs({
    protocols: [
      {
        id: 'pr1',
        name: 'Cell Prep',
        category: 'cell',
        purpose: 'Prepare HEK293 cells for transfection.',
        tags: 'cell, transfection',
        projectName: 'Atlas',
        steps: [
          'Seed cells at 70% confluence',
          { text: 'Incubate for [time]', placeholders: [{ name: 'time' }] }
        ]
      },
      {
        id: 'pr2',
        title: 'Legacy ELISA',
        description: 'ELISA plate workflow.',
        steps: [{ instruction: 'Read plate at 450nm' }]
      }
    ],
    projects: [{ id: 'project-atlas', name: 'Atlas' }],
    notebookEntries: [{ protocolId: 'pr2', projectId: 'project-atlas', updatedAt: '2026-02-01T00:00:00.000Z' }]
  });

  assert.equal(docs.length, 2);
  const cellPrep = docs.find((doc) => doc.id === 'pr1');
  const legacyElisa = docs.find((doc) => doc.id === 'pr2');
  assert.equal(Boolean(cellPrep), true);
  assert.equal(Boolean(legacyElisa), true);
  assert.equal(cellPrep.linked_project, 'Atlas');
  assert.equal(cellPrep.placeholders.includes('time'), true);
  assert.equal(legacyElisa.linked_project, 'Atlas');
  assert.equal(legacyElisa.steps[0], 'Read plate at 450nm');
});

test('agent-protocol-matching resolveProtocolMatch handles clear and empty candidate paths', () => {
  const clear = agentProtocolMatching.resolveProtocolMatch({
    message: 'I grew HEK293 cells and ran transfection today',
    entities: { activity: 'transfection', cell_line: 'HEK293' },
    protocols: [
      {
        id: 'pr-transfection',
        name: 'HEK293 Transfection',
        category: 'cell',
        steps: ['Seed HEK293 cells', 'Mix DNA and reagent', 'Incubate for 24h']
      },
      {
        id: 'pr-elisa',
        name: 'ELISA Workflow',
        category: 'assay',
        steps: ['Prepare plate', 'Read absorbance']
      }
    ],
    projects: [],
    notebookEntries: [],
    maxCandidates: 3
  });
  assert.equal(clear.candidates.length > 0, true);
  assert.equal(clear.candidates[0].protocol_name, 'HEK293 Transfection');

  const empty = agentProtocolMatching.resolveProtocolMatch({
    message: 'I ran an unknown workflow',
    entities: { activity: 'unknown workflow' },
    protocols: [],
    projects: [],
    notebookEntries: [],
    maxCandidates: 3
  });
  assert.equal(empty.candidates.length, 0);
  assert.equal(empty.ambiguity.needs_clarification, true);
  assert.equal(empty.ambiguity.ambiguity_reason, 'no_protocol_candidates');
});

test('agent-protocol-matching produces matcher-ranked rows compatible with search_protocols output shape', () => {
  const resolved = agentProtocolMatching.resolveProtocolMatch({
    message: 'Transfection in HEK293 cells',
    entities: { activity: 'transfection', cell_line: 'HEK293' },
    protocols: [
      {
        id: 'pr-transfection',
        name: 'HEK293 Transfection',
        category: 'cell',
        steps: ['Seed HEK293', 'Mix DNA and reagent']
      },
      {
        id: 'pr-legacy',
        name: 'PCR Setup',
        category: 'molecular',
        steps: ['Prepare primers']
      }
    ],
    projects: [],
    notebookEntries: [],
    maxCandidates: 5
  });

  const mapped = resolved.candidates.map((candidate) => ({
    id: String(candidate.protocol_id || ''),
    name: String(candidate.protocol_name || ''),
    category: String(candidate.category || ''),
    steps: Array.isArray(candidate.steps) ? candidate.steps : []
  }));

  assert.equal(mapped.length > 0, true);
  assert.equal(mapped[0].name, 'HEK293 Transfection');
  assert.equal(Array.isArray(mapped[0].steps), true);
});

test('agent-protocol-matching ambiguity thresholds and follow-up generation are deterministic', () => {
  const lowScore = agentProtocolMatching.evaluateProtocolAmbiguity({
    ranked: [{ protocol_name: 'A', score: 0.59 }]
  });
  assert.equal(lowScore.needs_clarification, true);
  assert.equal(lowScore.ambiguity_reason, 'top_score_below_threshold');

  const closeScores = agentProtocolMatching.evaluateProtocolAmbiguity({
    ranked: [
      { protocol_name: 'A', score: 0.81 },
      { protocol_name: 'B', score: 0.74 }
    ]
  });
  assert.equal(closeScores.needs_clarification, true);
  assert.equal(closeScores.ambiguity_reason, 'top_two_scores_too_close');

  const clearScores = agentProtocolMatching.evaluateProtocolAmbiguity({
    ranked: [
      { protocol_name: 'A', score: 0.81 },
      { protocol_name: 'B', score: 0.71 }
    ]
  });
  assert.equal(clearScores.needs_clarification, false);

  const followUp = agentProtocolMatching.buildProtocolFollowUpQuestion({
    ranked: [
      { protocol_name: 'HEK293 Maintenance' },
      { protocol_name: 'Expi293 Expansion' },
      { protocol_name: 'Transient Transfection Setup' }
    ],
    entities: { cell_line: 'HEK293' }
  });
  assert.match(followUp, /HEK293 Maintenance/);
  assert.match(followUp, /Expi293 Expansion/);
  assert.match(followUp, /Transient Transfection Setup/);
  assert.equal(/please tell me more/i.test(followUp), false);
});

test('agent-notebook-generation extracts placeholders from structured and legacy step formats', () => {
  const extracted = agentNotebookGeneration.extractProtocolPlaceholders([
    {
      id: 'step-1',
      text: 'Seed [cell line] cells and label {{ph:sample}}.',
      placeholders: [{ id: 'sample', name: 'sample_name' }]
    },
    {
      id: 'step-2',
      text: 'Incubate at 37 C.',
      placeholders: [{ id: 'time', name: 'time' }]
    }
  ]);

  assert.equal(extracted.length, 2);
  assert.equal(extracted[0].step_id, 'step-1');
  assert.equal(extracted[0].placeholders.some((item) => item.placeholder_key === 'cell_line'), true);
  assert.equal(extracted[0].placeholders.some((item) => item.placeholder_id === 'sample'), true);
  assert.equal(extracted[1].placeholders.some((item) => item.placeholder_id === 'time' && item.marker_type === 'trailing'), true);
});

test('agent-notebook-generation applies fill priority and protocol-history project resolution deterministically', () => {
  const draft = agentNotebookGeneration.buildNotebookDraft({
    message: 'I grew HEK293 cells today and ran transfection.',
    conversation: [
      { role: 'user', text: 'Can you use 6 h for incubation time?' },
      { role: 'assistant', text: 'Acknowledged.' }
    ],
    routing: {
      intent: 'protocol_to_notebook',
      entities: { activity: 'transfection', project: '', cell_line: 'HEK293' },
      plan: {
        needs_clarification: false,
        protocol_match: {
          selected_protocol_id: 'pr1',
          selected_protocol_name: 'HEK293 Transfection'
        },
        protocol_candidates: []
      }
    },
    snapshot: {
      projects: [
        { id: 'p1', name: 'Atlas' },
        { id: 'p2', name: 'Beacon' }
      ],
      protocols: [
        {
          id: 'pr1',
          name: 'HEK293 Transfection',
          steps: [
            { id: 's1', text: 'Seed [cell line] cells.', placeholders: [{ id: 'c1', name: 'cell_line' }] },
            { id: 's2', text: 'Incubate for [time].' }
          ]
        }
      ],
      notebookEntries: [
        { id: 'n1', projectId: 'p2', projectName: 'Beacon', protocolId: 'pr1', result: 'Old run used 12 h incubation.', updatedAt: '2026-02-01T00:00:00.000Z' },
        { id: 'n2', projectId: 'p2', projectName: 'Beacon', protocolId: 'pr1', result: 'Repeat run.', updatedAt: '2026-02-10T00:00:00.000Z' },
        { id: 'n3', projectId: 'p1', projectName: 'Atlas', protocolId: 'pr1', result: 'Pilot.', updatedAt: '2026-01-10T00:00:00.000Z' }
      ]
    },
    toolResults: [
      { tool: 'search_protocols', items: [{ time: '24 h', cell_line: 'CHO' }], summary: 'mock' }
    ],
    now: new Date('2026-03-11T12:00:00.000Z')
  });

  assert.equal(Boolean(draft), true);
  assert.equal(draft.project.id, 'p2');
  assert.equal(draft.project.resolution_source, 'protocol_history');
  const cellLine = draft.placeholder_values.find((item) => item.placeholder_key === 'cell_line');
  const time = draft.placeholder_values.find((item) => item.placeholder_key === 'time');
  assert.equal(cellLine.value, 'HEK293');
  assert.equal(cellLine.source, 'user_input');
  assert.equal(time.value.toLowerCase(), '6 h');
  assert.equal(time.source, 'conversation_context');
});

test('agent-notebook-generation keeps unresolved placeholders visible in rendered steps', () => {
  const draft = agentNotebookGeneration.buildNotebookDraft({
    message: 'I ran the assay.',
    conversation: [],
    routing: {
      intent: 'protocol_to_notebook',
      entities: { activity: 'assay' },
      plan: {
        needs_clarification: false,
        protocol_match: {
          selected_protocol_id: 'pr-assay',
          selected_protocol_name: 'Assay Prep'
        },
        protocol_candidates: []
      }
    },
    snapshot: {
      projects: [{ id: 'p1', name: 'Atlas' }],
      protocols: [
        {
          id: 'pr-assay',
          name: 'Assay Prep',
          steps: [{ id: 's1', text: 'Add [reagent] to plate.' }]
        }
      ],
      notebookEntries: []
    },
    now: new Date('2026-03-11T12:00:00.000Z')
  });

  assert.equal(Boolean(draft), true);
  assert.equal(draft.unresolved_placeholders.length, 1);
  assert.match(draft.rendered_steps[0], /\[reagent\]/i);
});

test('agent-routing protocol intent includes protocol match metadata and candidates', () => {
  const snapshot = buildAgentSimulationSnapshot();
  const routing = agentRouting.buildRoutingDecisionFromIntentParser({
    parserPayload: makeIntentParserPayload({
      primaryIntent: 'protocol_to_notebook',
      entities: {
        activity_type: 'transfection',
        cell_line: 'HEK293'
      }
    }),
    message: 'I grew HEK293 cells and ran transfection today.',
    snapshot,
    availableToolNames: AGENT_IO_TOOL_NAMES,
    toolContract: AGENT_IO_CONTRACT,
    writeIntent: false
  });

  assert.equal(routing.intent, 'protocol_to_notebook');
  assert.equal(Boolean(routing.plan.protocol_match), true);
  assert.equal(Array.isArray(routing.plan.protocol_candidates), true);
  assert.equal(routing.plan.protocol_candidates.length > 0, true);
  assert.equal(routing.plan.protocol_candidates[0].protocol_name.includes('Transfection'), true);
  assert.equal(routing.plan.needs_notebook_generation, true);
  assert.equal(routing.plan.notebook_autosave, true);
});

test('agent-routing parser path keeps deterministic protocol matcher metadata', () => {
  const snapshot = buildAgentSimulationSnapshot();
  const merged = agentRouting.buildRoutingDecisionFromIntentParser({
    parserPayload: makeIntentParserPayload({
      primaryIntent: 'protocol_to_notebook',
      confidence: 0.82,
      entities: {
        activity_type: 'transfection',
        cell_line: 'HEK293'
      }
    }),
    message: 'I ran transfection in HEK293.',
    snapshot,
    writeIntent: false,
    availableToolNames: AGENT_IO_TOOL_NAMES,
    toolContract: AGENT_IO_CONTRACT
  });
  assert.equal(merged.intent, 'protocol_to_notebook');
  assert.equal(Boolean(merged.plan.protocol_match), true);
  assert.equal(Array.isArray(merged.plan.protocol_candidates), true);
  assert.equal(merged.plan.protocol_candidates.length > 0, true);
});

test('agent-project-retrieval builds project index from mixed linked records', () => {
  const snapshot = {
    projects: [
      { id: 'p1', name: 'Atlas', summary: 'Primary rescue project.' },
      { id: 'p2', name: 'Mercury', summary: 'Secondary screening.' }
    ],
    protocols: [
      { id: 'pr1', name: 'HEK293 Transfection', category: 'cell', steps: ['Seed cells', 'Transfect cells'] }
    ],
    notebookEntries: [
      { id: 'n1', projectId: 'p1', projectName: 'Atlas', protocolId: 'pr1', protocolName: 'HEK293 Transfection', result: 'Recovered signal', updatedAt: '2026-02-11T10:00:00.000Z' }
    ],
    workflows: [
      {
        id: 'w1',
        name: 'Atlas Recovery Workflow',
        description: 'Recover expression after transfection.',
        projectId: 'p1',
        notebookEntryIds: ['n1'],
        blocks: [{ id: 'b1', protocolId: 'pr1' }, { id: 'b2', type: 'text', text: 'Review assay response' }],
        links: [{ fromBlockId: 'b1', toBlockId: 'b2' }],
        updatedAt: '2026-02-12T10:00:00.000Z'
      }
    ],
    papers: [
      { id: 'paper-1', title: 'Atlas transfection rescue', summary: 'Workflow rationale.', linkedType: 'project', linkedId: 'p1', updatedAt: '2026-02-09T00:00:00.000Z' }
    ],
    assays: [{ id: 'a1', name: 'Atlas plate', projectId: 'p1', updatedAt: '2026-02-12T09:00:00.000Z' }],
    gelAnalyses: [{ id: 'g1', name: 'Atlas western', projectId: 'p1', updatedAt: '2026-02-12T08:00:00.000Z' }]
  };

  const index = agentProjectRetrieval.buildProjectRecordIndex({ snapshot });
  assert.equal(index.projects.length, 2);
  assert.equal(Boolean(index.by_project_id.p1), true);
  assert.equal(index.by_project_id.p1.notebook_entries.length, 1);
  assert.equal(index.by_project_id.p1.workflows.length, 1);
  assert.equal(index.by_project_id.p1.protocols.length, 1);
  assert.equal(index.by_project_id.p1.papers.length, 1);
  assert.equal(index.by_project_id.p1.linked_record_count >= 5, true);
});

test('agent-project-retrieval resolveProjectScope handles clear, ambiguous, low-score, and no-project cases', () => {
  const index = agentProjectRetrieval.buildProjectRecordIndex({
    snapshot: {
      projects: [
        { id: 'p1', name: 'Atlas Alpha', summary: 'first atlas' },
        { id: 'p2', name: 'Atlas Beta', summary: 'second atlas' }
      ]
    }
  });

  const clear = agentProjectRetrieval.resolveProjectScope({
    message: 'Why did project Atlas Alpha fail?',
    entities: { project: 'Atlas Alpha' },
    selectedProjectId: '',
    selectedProjectName: '',
    projects: index.projects,
    index
  });
  assert.equal(clear.needs_clarification, false);
  assert.equal(clear.project_match.selected_project_id, 'p1');

  const ambiguous = agentProjectRetrieval.resolveProjectScope({
    message: 'why did atlas fail',
    entities: { project: 'atlas' },
    selectedProjectId: '',
    selectedProjectName: '',
    projects: index.projects,
    index
  });
  assert.equal(ambiguous.needs_clarification, true);
  assert.equal(ambiguous.project_match.ambiguity_reason, 'top_two_scores_too_close');
  assert.equal(ambiguous.project_match.top_score >= 0.6, true);
  assert.equal(ambiguous.project_match.score_delta < 0.1, true);

  const lowScore = agentProjectRetrieval.resolveProjectScope({
    message: 'why did project neutron fail',
    entities: { project: 'neutron' },
    selectedProjectId: '',
    selectedProjectName: '',
    projects: index.projects,
    index
  });
  assert.equal(lowScore.needs_clarification, true);
  assert.equal(lowScore.project_match.ambiguity_reason, 'top_score_below_threshold');
  assert.equal(lowScore.project_match.top_score < 0.6, true);

  const none = agentProjectRetrieval.resolveProjectScope({
    message: 'why did project fail',
    entities: {},
    selectedProjectId: '',
    selectedProjectName: '',
    projects: [],
    index: { projects: [], by_project_id: {} }
  });
  assert.equal(none.needs_clarification, true);
  assert.equal(none.project_match.ambiguity_reason, 'no_project_candidates');
});

test('agent-project-retrieval retrieves ranked project evidence packs with workflow support', () => {
  const evidence = agentProjectRetrieval.retrieveProjectEvidence({
    message: 'What happened in the transfection workflow for Atlas?',
    entities: { project: 'Atlas', workflow_step: 'transfection', activity: 'transfection' },
    selectedProjectId: 'p1',
    selectedProjectName: 'Atlas',
    snapshot: {
      projects: [{ id: 'p1', name: 'Atlas', summary: 'PD-1 rescue' }],
      protocols: [{ id: 'pr1', name: 'HEK293 Transfection', category: 'cell', steps: ['Transfection setup', 'Incubate'] }],
      notebookEntries: [
        { id: 'n1', projectId: 'p1', projectName: 'Atlas', protocolId: 'pr1', protocolName: 'HEK293 Transfection', result: 'Transfection efficiency dropped.', updatedAt: '2026-02-12T12:00:00.000Z' }
      ],
      workflows: [
        {
          id: 'w-hit',
          name: 'Atlas Transfection Workflow',
          description: 'Primary transfection troubleshooting sequence.',
          projectId: 'p1',
          blocks: [{ id: 'b1', protocolId: 'pr1' }, { id: 'b2', type: 'text', text: 'Review transfection efficiency' }],
          links: [{ fromBlockId: 'b1', toBlockId: 'b2' }],
          updatedAt: '2026-02-13T08:00:00.000Z'
        },
        {
          id: 'w-noise',
          name: 'Atlas ELISA',
          description: 'Assay follow-up only.',
          projectId: 'p1',
          blocks: [{ id: 'b3', type: 'text', text: 'Read plate absorbance' }],
          links: [],
          updatedAt: '2026-01-01T08:00:00.000Z'
        }
      ],
      papers: [
        { id: 'paper-1', title: 'Atlas transfection troubleshooting', summary: 'Discusses rescue factors.', linkedType: 'project', linkedId: 'p1', updatedAt: '2026-02-10T00:00:00.000Z' }
      ],
      assays: [],
      gelAnalyses: []
    },
    maxPerSource: 3
  });

  assert.equal(evidence.needs_clarification, false);
  assert.equal(evidence.selected_project.id, 'p1');
  assert.equal(evidence.packs.workflows.length > 0, true);
  assert.equal(evidence.packs.workflows[0].id, 'w-hit');
  assert.equal(evidence.packs.notebook.length > 0, true);
  assert.equal(evidence.packs.protocols.length > 0, true);
  assert.equal(evidence.packs.papers.length > 0, true);
  assert.equal(evidence.citations.some((citation) => citation.source === 'workflow'), true);
});

test('agent-paper-analysis classifies task modes and deep-reading requirements', () => {
  const summarize = agentPaperAnalysis.classifyPaperTaskMode({
    message: 'Summarize this paper on PD-1 binders.',
    entities: { paper_title: '' }
  });
  assert.equal(summarize.mode, 'summarize');
  assert.equal(summarize.requires_deep_reading, false);

  const methods = agentPaperAnalysis.classifyPaperTaskMode({
    message: 'Extract methods from "Atlas Rescue Paper".',
    entities: {}
  });
  assert.equal(methods.mode, 'extract_methods');
  assert.equal(methods.requires_deep_reading, true);

  const compare = agentPaperAnalysis.classifyPaperTaskMode({
    message: 'Compare "Atlas Rescue" vs "Mercury ELISA".',
    entities: {}
  });
  assert.equal(compare.mode, 'compare_papers');
  assert.equal(compare.requires_deep_reading, true);
  assert.equal(compare.compare_queries.length >= 2, true);
});

test('agent-paper-analysis resolves clear, ambiguous, and no-match requests with fixed thresholds', () => {
  const docs = agentPaperAnalysis.buildPaperSearchableDocs({
    projects: [{ id: 'p1', name: 'Atlas' }],
    papers: [
      {
        id: 'paper-1',
        title: 'Atlas Transfection Rescue',
        summary: 'Rescue transfection efficiency using additive screen.',
        linkedType: 'project',
        linkedId: 'p1',
        pdfDataUrl: 'data:application/pdf;base64,AAAA',
        methodsExtract: [{ title: 'Rescue workflow', steps: [{ action: 'Transfect cells' }] }],
        keyReagents: [{ name: 'Additive A', type: 'compound' }],
        updatedAt: '2026-02-12T00:00:00.000Z'
      },
      {
        id: 'paper-2',
        title: 'Mercury ELISA Baseline',
        summary: 'Unrelated assay baseline study.',
        linkedType: 'project',
        linkedId: 'p1',
        methodsExtract: [{ title: 'ELISA workflow', steps: [{ action: 'Read absorbance' }] }],
        updatedAt: '2026-02-11T00:00:00.000Z'
      }
    ]
  });

  const clear = agentPaperAnalysis.resolvePaperRequest({
    message: 'Summarize paper Atlas Transfection Rescue.',
    entities: { paper_title: 'Atlas Transfection Rescue' },
    docs
  });
  assert.equal(clear.needs_clarification, false);
  assert.equal(clear.selected.paper_id, 'paper-1');

  const ambiguous = agentPaperAnalysis.evaluatePaperAmbiguity({
    ranked: [
      { paper_title: 'A', score: 0.68 },
      { paper_title: 'B', score: 0.62 }
    ]
  });
  assert.equal(ambiguous.needs_clarification, true);
  assert.equal(ambiguous.ambiguity_reason, 'top_two_scores_too_close');
  assert.equal(ambiguous.top_score >= 0.6, true);
  assert.equal(ambiguous.score_delta < 0.1, true);

  const lowScore = agentPaperAnalysis.evaluatePaperAmbiguity({
    ranked: [
      { paper_title: 'A', score: 0.59 },
      { paper_title: 'B', score: 0.21 }
    ]
  });
  assert.equal(lowScore.needs_clarification, true);
  assert.equal(lowScore.ambiguity_reason, 'top_score_below_threshold');
  assert.equal(lowScore.top_score < 0.6, true);

  const noMatch = agentPaperAnalysis.resolvePaperRequest({
    message: 'Summarize paper completely unrelated title',
    entities: { paper_title: 'neutron decay atlas 2026' },
    docs: []
  });
  assert.equal(noMatch.needs_clarification, true);
  assert.equal(noMatch.ambiguity_reason, 'no_paper_candidates');
});

test('agent-paper-analysis enforces upload-required gating for deep modes and compare mode', () => {
  const docs = agentPaperAnalysis.buildPaperSearchableDocs({
    projects: [{ id: 'p1', name: 'Atlas' }],
    papers: [
      {
        id: 'paper-a',
        title: 'Atlas Methods Paper',
        summary: 'Detailed assay setup.',
        linkedType: 'project',
        linkedId: 'p1',
        methodsExtract: [{ title: 'Assay', steps: [{ action: 'Prepare plate' }] }],
        updatedAt: '2026-02-10T00:00:00.000Z'
      },
      {
        id: 'paper-b',
        title: 'Atlas Uploaded Paper',
        summary: 'Uploaded full text with reagent extraction.',
        linkedType: 'project',
        linkedId: 'p1',
        pdfDataUrl: 'data:application/pdf;base64,AAAA',
        methodsExtract: [{ title: 'Protocol', steps: [{ action: 'Run assay' }] }],
        keyReagents: [{ name: 'Reagent X', type: 'compound' }],
        updatedAt: '2026-02-12T00:00:00.000Z'
      }
    ]
  });

  const deepMethods = agentPaperAnalysis.resolvePaperRequest({
    message: 'Extract methods from Atlas Methods Paper.',
    entities: { paper_title: 'Atlas Methods Paper' },
    docs
  });
  assert.equal(deepMethods.mode, 'extract_methods');
  assert.equal(deepMethods.requires_deep_reading, true);
  assert.equal(deepMethods.needs_clarification, true);
  assert.equal(deepMethods.ambiguity_reason, 'deep_read_requires_uploaded_pdf');

  const compare = agentPaperAnalysis.resolvePaperRequest({
    message: 'Compare "Atlas Methods Paper" vs "Atlas Uploaded Paper".',
    entities: {},
    docs
  });
  assert.equal(compare.mode, 'compare_papers');
  assert.equal(compare.needs_clarification, true);
  assert.equal(compare.ambiguity_reason, 'compare_requires_uploaded_pdfs');
  assert.match(String(compare.clarification_question || ''), /upload/i);
});

test('agent-response-layer determines deterministic response types by precedence', () => {
  const clarification = agentResponseLayer.determineResponseType({
    routing: { intent: 'project_science_question', plan: { needs_clarification: true } }
  });
  assert.equal(clarification, 'clarification_question');

  const notebook = agentResponseLayer.determineResponseType({
    routing: { intent: 'general_science_question', plan: {} },
    notebookDraft: { protocol: { id: 'p1' } }
  });
  assert.equal(notebook, 'notebook_draft');

  const project = agentResponseLayer.determineResponseType({
    routing: { intent: 'project_science_question', plan: {} }
  });
  assert.equal(project, 'project_science_answer');

  const paper = agentResponseLayer.determineResponseType({
    routing: { intent: 'paper_analysis', plan: {} }
  });
  assert.equal(paper, 'paper_summary');

  const analysis = agentResponseLayer.determineResponseType({
    routing: { intent: 'general_science_question', plan: { needs_python: true } }
  });
  assert.equal(analysis, 'analysis_result');

  const factual = agentResponseLayer.determineResponseType({
    routing: { intent: 'general_science_question', plan: {} }
  });
  assert.equal(factual, 'factual_answer');
});

test('agent-response-layer confidence labels use fixed 0.80/0.60 thresholds', () => {
  assert.equal(agentResponseLayer.labelConfidence({ score: 0.8 }), 'high');
  assert.equal(agentResponseLayer.labelConfidence({ score: 0.79 }), 'medium');
  assert.equal(agentResponseLayer.labelConfidence({ score: 0.6 }), 'medium');
  assert.equal(agentResponseLayer.labelConfidence({ score: 0.59 }), 'low');
});

test('agent-response-layer source summary maps categories with deterministic order and dedupe', () => {
  const summary = agentResponseLayer.buildSourceSummary({
    citations: [
      { source: 'protocol', pointer: 'pr1', reason: 'Matched protocol.' },
      { source: 'notebook_entry', pointer: 'n1', reason: 'Matched notebook.' },
      { source: 'workflow', pointer: 'w1', reason: 'Matched workflow.' },
      { source: 'paper', pointer: 'paper-1', reason: 'Matched paper.' },
      { source: 'web_source', pointer: 'https://example.org', reason: 'Matched web.' },
      { source: 'inference', pointer: 'derived:1', reason: 'Derived from evidence.' },
      { source: 'paper', pointer: 'paper-1', reason: 'Duplicate should dedupe.' }
    ],
    toolTrace: [
      { tool: 'search_inventory', summary: 'Inventory used.' },
      { tool: 'search_web', summary: 'Web used.' }
    ]
  });
  assert.equal(summary.total_sources > 0, true);
  assert.deepEqual(
    summary.groups.map((group) => group.source_type),
    ['tool_result', 'notebook_page', 'workflow_record', 'uploaded_paper', 'web_search', 'inference']
  );
  const paperGroup = summary.groups.find((group) => group.source_type === 'uploaded_paper');
  assert.equal(Boolean(paperGroup), true);
  assert.equal(paperGroup.count >= 1, true);
  assert.equal(paperGroup.items.filter((item) => item.pointer === 'paper-1').length, 1);
});

test('agent-response-layer unresolved field extraction and template rendering are deterministic', () => {
  const unresolvedFields = agentResponseLayer.buildUnresolvedFields({
    responseType: 'notebook_draft',
    notebookDraft: {
      unresolved_placeholders: [
        { step_id: 's1', placeholder_id: 'ph1', placeholder_key: 'cell_line', display: '[cell line]', reason: 'missing_supported_value' }
      ]
    }
  });
  assert.equal(unresolvedFields.length, 1);
  assert.equal(unresolvedFields[0].placeholder_key, 'cell_line');

  const withSources = agentResponseLayer.applyResponseTemplate({
    answer: 'Base answer.',
    responseType: 'factual_answer',
    sourceSummary: {
      total_sources: 1,
      groups: [{ source_type: 'tool_result', label: 'Tool result', count: 1, items: [{ pointer: 'pr1', source: 'protocol' }] }]
    },
    unresolvedFields: []
  });
  assert.match(withSources, /Sources used:/);

  const clarification = agentResponseLayer.applyResponseTemplate({
    answer: 'Need clarification.',
    responseType: 'clarification_question',
    sourceSummary: { total_sources: 1, groups: [{ source_type: 'tool_result', label: 'Tool result', count: 1, items: [{ pointer: 'x' }] }] },
    unresolvedFields: []
  });
  assert.equal(/Sources used:/i.test(clarification), false);

  const notebookTemplate = agentResponseLayer.applyResponseTemplate({
    answer: 'Notebook draft prepared.',
    responseType: 'notebook_draft',
    sourceSummary: { total_sources: 0, groups: [] },
    unresolvedFields
  });
  assert.match(notebookTemplate, /Unresolved placeholders:/);
  assert.match(notebookTemplate, /cell line|cell_line/i);
});

test('agent-response-layer finalize emits response metadata and templated answer', () => {
  const finalized = agentResponseLayer.finalizeAgentResponse({
    answer: 'Final answer text.',
    confidence: 0.82,
    routing: { intent: 'general_science_question', plan: {} },
    notebookDraft: null,
    toolTrace: [{ tool: 'search_inventory', summary: 'Found items.' }],
    citations: [{ source: 'chemical_inventory', pointer: 'chem-1', reason: 'Matched chemical.' }]
  });
  assert.equal(finalized.response_type, 'factual_answer');
  assert.equal(finalized.confidence_label, 'high');
  assert.equal(Array.isArray(finalized.unresolved_fields), true);
  assert.equal(Boolean(finalized.source_summary), true);
  assert.match(finalized.answer, /Sources used:/);
});

test('agent-validation-safety detects tool-claim mismatch when retrieval claims lack tool evidence', () => {
  const result = agentValidationSafety.validateToolClaimIntegrity({
    routing: { intent: 'inventory_lookup', plan: { needs_tools: true } },
    toolTrace: [],
    citations: [],
    answer: 'Inventory shows we found sulfo-SMCC in stock.'
  });
  assert.equal(result.passed, false);
  assert.equal(result.violations[0].code, 'tool_claim_without_tool_evidence');
});

test('agent-validation-safety detects missing protocol selection for protocol-to-notebook answers', () => {
  const result = agentValidationSafety.validateProtocolClaimIntegrity({
    routing: {
      intent: 'protocol_to_notebook',
      plan: {
        protocol_match: {
          selected_protocol_id: '',
          selected_protocol_name: ''
        },
        protocol_candidates: []
      }
    },
    answer: 'I prepared a notebook draft from protocol steps.'
  });
  assert.equal(result.passed, false);
  assert.equal(result.violations.some((item) => item.code === 'no_protocol_candidates'), true);
});

test('agent-validation-safety rejects unsupported notebook placeholder fills', () => {
  const result = agentValidationSafety.validateNotebookPlaceholderSupport({
    notebookDraft: {
      placeholder_values: [
        {
          placeholder_key: 'cell_line',
          value: 'HEK293',
          source: 'unknown_source'
        }
      ]
    },
    toolTrace: []
  });
  assert.equal(result.passed, false);
  assert.equal(result.violations.some((item) => item.code === 'unsupported_placeholder_fill'), true);
});

test('agent-validation-safety blocks deep paper detail claims when paper is not deep-ready', () => {
  const result = agentValidationSafety.validatePaperDetailClaims({
    routing: {
      intent: 'paper_analysis',
      plan: {
        needs_deep_paper_reading: true,
        needs_paper_comparison: false,
        paper_match: {
          deep_read_ready: false,
          availability_status: 'metadata_only'
        }
      }
    },
    answer: 'Figure 2 confirms the reagent concentration and methods table details.'
  });
  assert.equal(result.passed, false);
  assert.equal(result.violations.some((item) => item.code === 'pdf_missing'), true);
});

test('agent-validation-safety validateAndGateResponse returns provenance and clarification gate metadata', () => {
  const result = agentValidationSafety.validateAndGateResponse({
    routing: {
      intent: 'inventory_lookup',
      plan: {
        needs_tools: true,
        needs_clarification: false
      }
    },
    normalized: {
      answer: 'Inventory shows PEI in stock at shelf A.',
      confidence_label: 'medium',
      response_type: 'factual_answer',
      source_summary: { total_sources: 0, groups: [] },
      citations: []
    },
    notebookDraft: null,
    toolTrace: [],
    citations: []
  });
  assert.equal(result.validation.passed, false);
  assert.equal(result.validation.forced_clarification, true);
  assert.equal(Array.isArray(result.provenance.source_evidence), true);
  assert.equal(Number.isFinite(Number(result.provenance.unsupported_statement_count)), true);
});

test('agent-observability records lifecycle events and classifies deterministic failure reasons', () => {
  const recorder = agentObservability.createLifecycleRecorder({ requestId: 'req-1' });
  agentObservability.recordLifecycleEvent(recorder, {
    stage: 'tool_call_failed',
    status: 'failed',
    tool_name: 'run_python_sandbox',
    message: 'Python exception: NameError'
  });
  const reasons = agentObservability.classifyFailureReasons({
    lifecycleEvents: recorder.events,
    validation: {
      passed: false,
      forced_clarification: true
    }
  });
  assert.equal(Array.isArray(recorder.events), true);
  assert.equal(recorder.events.length, 1);
  assert.equal(reasons.includes('python_exception'), true);
  assert.equal(reasons.includes('validation_failed'), true);
});

test('agent-observability rotates logs and replays one request lifecycle', async () => {
  const tempDir = path.join(__dirname, 'tmp', 'agent-observability-test');
  await fsPromises.rm(tempDir, { recursive: true, force: true });
  await fsPromises.mkdir(tempDir, { recursive: true });
  const logPath = path.join(tempDir, 'agent-chat.log');

  for (let index = 0; index < 6; index += 1) {
    await agentObservability.appendLogWithRotation({
      logPath,
      maxBytes: 180,
      maxRotations: 5,
      entry: JSON.stringify({
        type: index % 2 === 0 ? 'agent-chat-request' : 'agent-lifecycle',
        requestId: 'req-rotate',
        stage: index % 2 === 0 ? undefined : 'tool_call_completed',
        timestamp: `2026-03-13T00:00:0${index}Z`,
        message: `entry-${index}`
      })
    });
  }
  await agentObservability.appendLogWithRotation({
    logPath,
    maxBytes: 180,
    maxRotations: 5,
    entry: JSON.stringify({
      type: 'agent-chat-result',
      requestId: 'req-rotate',
      ok: true,
      response_type: 'factual_answer',
      timestamp: '2026-03-13T00:00:09Z'
    })
  });

  const replay = await agentObservability.replayRequestLifecycle({
    requestId: 'req-rotate',
    logPath
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.requestId, 'req-rotate');
  assert.equal(Array.isArray(replay.events), true);
  assert.equal(fs.existsSync(`${logPath}.1`), true);
});

test('agent-routing project intent includes project matcher metadata and workflow retrieval flag', () => {
  const snapshot = buildAgentSimulationSnapshot();
  const routing = agentRouting.buildRoutingDecisionFromIntentParser({
    parserPayload: makeIntentParserPayload({
      primaryIntent: 'project_science_question',
      entities: {
        project_name: 'Atlas',
        workflow_step: 'transfection'
      }
    }),
    message: 'Why did project Atlas fail after transfection?',
    snapshot,
    availableToolNames: AGENT_IO_TOOL_NAMES,
    toolContract: AGENT_IO_CONTRACT,
    writeIntent: false,
    selectedProjectId: 'project-atlas',
    selectedProjectName: 'Atlas'
  });

  assert.equal(routing.intent, 'project_science_question');
  assert.equal(routing.plan.needs_project_retrieval, true);
  assert.equal(routing.plan.needs_workflow_retrieval, true);
  assert.equal(Boolean(routing.plan.project_match), true);
  assert.equal(Array.isArray(routing.plan.project_candidates), true);
  assert.equal(routing.plan.project_match.selected_project_id, 'project-atlas');
});

test('agent-routing project ambiguity triggers clarification before tool execution', () => {
  const snapshot = {
    projects: [
      { id: 'p1', name: 'Atlas Alpha' },
      { id: 'p2', name: 'Atlas Beta' }
    ],
    protocols: [],
    notebookEntries: [],
    workflows: [],
    papers: [
      {
        id: 'paper-1',
        title: 'Atlas Uploaded Paper',
        linkedType: 'project',
        linkedId: 'p1',
        linkedName: 'Cancer Study',
        summary: 'Paper summary text.',
        summaryStructured: {
          important_figures_or_tables: [
            { item: 'Figure 2', summary: 'Expression rescue trend.' }
          ]
        },
        methodsExtract: [
          {
            title: 'Method A',
            steps: [{ action: 'Prepare cells' }]
          }
        ],
        keyReagents: [
          { name: 'Reagent Z', type: 'compound', identifier: 'RZ-1', notes: 'demo' }
        ],
        pdfDataUrl: 'data:application/pdf;base64,AAAA',
        deepReadReady: true,
        availabilityStatus: 'deep_ready',
        ingestionStatus: 'ready',
        ingestionUpdatedAt: '2026-02-01T00:00:00.000Z',
        ingestionErrors: [],
        updatedAt: '2026-02-01T00:00:00.000Z'
      }
    ],
    assays: [],
    gelAnalyses: []
  };
  const routing = agentRouting.buildRoutingDecisionFromIntentParser({
    parserPayload: makeIntentParserPayload({
      primaryIntent: 'project_science_question',
      entities: {
        project_name: 'atlas'
      }
    }),
    message: 'Why did project atlas fail?',
    snapshot,
    availableToolNames: AGENT_IO_TOOL_NAMES,
    toolContract: AGENT_IO_CONTRACT,
    writeIntent: false
  });

  assert.equal(routing.intent, 'project_science_question');
  assert.equal(routing.plan.project_match.needs_clarification, true);
  assert.equal(routing.plan.needs_clarification, true);
  assert.equal(Array.isArray(routing.plan.project_candidates), true);
  assert.equal(routing.plan.project_candidates.length >= 2, true);
  assert.match(String(routing.plan.clarification_question || ''), /Which project should I use/i);
});

test('agent-routing parser path keeps deterministic project matcher metadata', () => {
  const snapshot = {
    projects: [
      { id: 'p1', name: 'Atlas Alpha' },
      { id: 'p2', name: 'Atlas Beta' }
    ],
    protocols: [],
    notebookEntries: [],
    workflows: [],
    papers: [],
    assays: [],
    gelAnalyses: []
  };
  const merged = agentRouting.buildRoutingDecisionFromIntentParser({
    parserPayload: makeIntentParserPayload({
      primaryIntent: 'project_science_question',
      confidence: 0.81,
      entities: {
        project_name: 'atlas',
        workflow_step: 'transfection'
      }
    }),
    message: 'Why did atlas fail after transfection?',
    snapshot,
    writeIntent: false,
    availableToolNames: AGENT_IO_TOOL_NAMES,
    toolContract: AGENT_IO_CONTRACT,
    selectedProjectId: 'p1',
    selectedProjectName: 'Atlas Alpha'
  });

  assert.equal(merged.intent, 'project_science_question');
  assert.equal(Boolean(merged.plan.project_match), true);
  assert.equal(merged.plan.project_match.selected_project_id, 'p1');
  assert.equal(Array.isArray(merged.plan.project_candidates), true);
  assert.equal(merged.plan.project_candidates.length > 0, true);
});

test('agent-routing paper intent includes paper matcher metadata and candidates', () => {
  const snapshot = {
    projects: [{ id: 'p1', name: 'Atlas' }],
    protocols: [],
    notebookEntries: [],
    workflows: [],
    assays: [],
    gelAnalyses: [],
    papers: [
      {
        id: 'paper-1',
        title: 'Atlas Uploaded Paper',
        summary: 'Uploaded paper with full extraction.',
        linkedType: 'project',
        linkedId: 'p1',
        pdfDataUrl: 'data:application/pdf;base64,AAAA',
        methodsExtract: [{ title: 'Methods', steps: [{ action: 'Run assay' }] }],
        keyReagents: [{ name: 'Reagent A', type: 'compound' }],
        updatedAt: '2026-02-12T00:00:00.000Z'
      }
    ]
  };
  const routing = agentRouting.buildRoutingDecisionFromIntentParser({
    parserPayload: makeIntentParserPayload({
      primaryIntent: 'paper_analysis',
      entities: {
        paper_title: 'Atlas Uploaded Paper'
      }
    }),
    message: 'Extract methods from Atlas Uploaded Paper.',
    snapshot,
    availableToolNames: AGENT_IO_TOOL_NAMES,
    toolContract: AGENT_IO_CONTRACT,
    writeIntent: false
  });

  assert.equal(routing.intent, 'paper_analysis');
  assert.equal(routing.plan.needs_paper_retrieval, true);
  assert.equal(routing.plan.needs_deep_paper_reading, true);
  assert.equal(Boolean(routing.plan.paper_match), true);
  assert.equal(Array.isArray(routing.plan.paper_candidates), true);
  assert.equal(routing.plan.paper_candidates.length > 0, true);
  assert.equal(routing.plan.paper_match.selected_paper_id, 'paper-1');
});

test('agent-routing paper deep-analysis upload gating triggers clarification before tools', () => {
  const snapshot = {
    projects: [{ id: 'p1', name: 'Atlas' }],
    protocols: [],
    notebookEntries: [],
    workflows: [],
    assays: [],
    gelAnalyses: [],
    papers: [
      {
        id: 'paper-meta',
        title: 'Atlas Metadata Paper',
        summary: 'Metadata-only summary, no upload.',
        linkedType: 'project',
        linkedId: 'p1',
        updatedAt: '2026-02-10T00:00:00.000Z'
      }
    ]
  };
  const routing = agentRouting.buildRoutingDecisionFromIntentParser({
    parserPayload: makeIntentParserPayload({
      primaryIntent: 'paper_analysis',
      entities: {
        paper_title: 'Atlas Metadata Paper'
      }
    }),
    message: 'Extract reagents from Atlas Metadata Paper.',
    snapshot,
    availableToolNames: AGENT_IO_TOOL_NAMES,
    toolContract: AGENT_IO_CONTRACT,
    writeIntent: false
  });

  assert.equal(routing.intent, 'paper_analysis');
  assert.equal(routing.plan.paper_match.needs_clarification, true);
  assert.equal(routing.plan.needs_clarification, true);
  assert.equal(routing.plan.paper_match.ambiguity_reason, 'deep_read_requires_uploaded_pdf');
  assert.match(String(routing.plan.clarification_question || ''), /upload/i);
});

test('agent-routing parser path keeps deterministic paper matcher metadata', () => {
  const snapshot = {
    projects: [{ id: 'p1', name: 'Atlas' }],
    protocols: [],
    notebookEntries: [],
    workflows: [],
    assays: [],
    gelAnalyses: [],
    papers: [
      {
        id: 'paper-1',
        title: 'Atlas Uploaded Paper',
        summary: 'Uploaded paper with deep extraction.',
        linkedType: 'project',
        linkedId: 'p1',
        pdfDataUrl: 'data:application/pdf;base64,AAAA',
        methodsExtract: [{ title: 'Methods', steps: [{ action: 'Run assay' }] }],
        keyReagents: [{ name: 'Reagent A', type: 'compound' }],
        updatedAt: '2026-02-12T00:00:00.000Z'
      }
    ]
  };
  const merged = agentRouting.buildRoutingDecisionFromIntentParser({
    parserPayload: makeIntentParserPayload({
      primaryIntent: 'paper_analysis',
      confidence: 0.82,
      entities: {
        paper_title: 'Atlas Uploaded Paper',
        project_name: 'Atlas'
      }
    }),
    message: 'Extract methods from Atlas Uploaded Paper.',
    snapshot,
    writeIntent: false,
    availableToolNames: AGENT_IO_TOOL_NAMES,
    toolContract: AGENT_IO_CONTRACT
  });

  assert.equal(merged.intent, 'paper_analysis');
  assert.equal(Boolean(merged.plan.paper_match), true);
  assert.equal(merged.plan.paper_match.selected_paper_id, 'paper-1');
  assert.equal(Array.isArray(merged.plan.paper_candidates), true);
  assert.equal(merged.plan.paper_candidates.length > 0, true);
});

test('agent-tools registry loader/list/find APIs return expected tool subsets', () => {
  const rawContract = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'agent-io-contract.json'), 'utf8'));
  const contract = agentTools.loadToolContract(rawContract);
  assert.equal(contract.tools.length > 0, true);
  const allTools = agentTools.listAvailableTools(contract, { includeWrite: true });
  const readOnlyTools = agentTools.listAvailableTools(contract, { includeWrite: false });
  assert.equal(allTools.some((tool) => tool.name === 'download_paper_pdf'), true);
  assert.equal(readOnlyTools.some((tool) => tool.name === 'download_paper_pdf'), false);
  const proteinTools = agentTools.findToolsByEntityType(contract, 'protein');
  assert.equal(proteinTools.some((tool) => tool.name === 'search_uniprot'), true);
  const literatureTools = agentTools.findToolsByTaskType(contract, 'literature_lookup');
  assert.equal(literatureTools.some((tool) => tool.name === 'search_pubmed'), true);
  assert.equal(literatureTools.some((tool) => tool.name === 'search_web'), true);
  const workflowTools = agentTools.findToolsByEntityType(contract, 'workflow_step');
  assert.equal(workflowTools.some((tool) => tool.name === 'search_workflows'), true);
});

test('agent-tools selectToolsForRequest ranks tools by entity/task/exactness', () => {
  const rawContract = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'agent-io-contract.json'), 'utf8'));
  const contract = agentTools.loadToolContract(rawContract);

  const inventorySelection = agentTools.selectToolsForRequest({
    intent: 'inventory_lookup',
    entities: { compound: 'biotin', protein: '' },
    message: 'what is the MW of biotin in stock',
    contract,
    allowWriteTools: false
  });
  assert.equal(inventorySelection.selectedToolNames[0], 'search_inventory');

  const proteinSelection = agentTools.selectToolsForRequest({
    intent: 'inventory_lookup',
    entities: { protein: 'PD-1' },
    message: 'what is the pI of PD-1',
    contract,
    allowWriteTools: false
  });
  assert.equal(proteinSelection.selectedToolNames.includes('search_uniprot'), true);

  const recordSelection = agentTools.selectToolsForRequest({
    intent: 'record_lookup',
    entities: { workflow_step: 'transfection', protocol: 'Cell Prep' },
    message: 'what did we do last time for transfection',
    contract,
    allowWriteTools: false
  });
  assert.equal(recordSelection.selectedToolNames.includes('search_notebook_entries'), true);

  const webSelection = agentTools.selectToolsForRequest({
    intent: 'general_science_question',
    entities: { protein: 'PD-1' },
    message: 'What are the latest PD-1 review papers with references?',
    contract,
    allowWriteTools: false
  });
  assert.equal(webSelection.selectedToolNames.includes('search_web'), true);
});

test('agent-tools selectToolsForRequest ranks workflow tool for workflow-step questions', () => {
  const rawContract = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'agent-io-contract.json'), 'utf8'));
  const contract = agentTools.loadToolContract(rawContract);
  const selection = agentTools.selectToolsForRequest({
    intent: 'project_science_question',
    entities: { workflow_step: 'transfection', project: 'Atlas' },
    message: 'Which workflow step comes after transfection in project Atlas?',
    contract,
    allowWriteTools: false
  });
  assert.equal(selection.selectedToolNames.includes('search_workflows'), true);
});

test('agent-tools executeToolCall handles known, unknown, and write-policy paths', async () => {
  const contract = agentTools.loadToolContract({
    tools: [
      { name: 'search_inventory', description: 'inventory', input_schema: {}, output_schema: {} },
      { name: 'download_paper_pdf', description: 'write', input_schema: {}, output_schema: {} }
    ]
  });
  const toEnvelope = (toolName, args, rawResult, options = {}) => ({
    ok: options.ok !== false,
    tool_name: toolName,
    input: args,
    items: rawResult?.items || [],
    citations: rawResult?.citations || [],
    summary: rawResult?.summary || '',
    ...(options.error ? { error: options.error } : {})
  });
  const dispatch = async (toolName, args) => {
    if (toolName === 'search_inventory') {
      return toEnvelope(toolName, args, {
        items: [{ id: 'c1', name: 'biotin' }],
        citations: [{ source: 'inventory', pointer: 'c1', reason: 'match' }],
        summary: 'Found 1'
      });
    }
    if (toolName === 'download_paper_pdf') {
      return toEnvelope(toolName, args, {
        items: [{ linked_name: 'x', status: 'downloaded' }],
        citations: [{ source: 'paper_store', pointer: 'x', reason: 'write completed' }],
        summary: 'Downloaded 1'
      });
    }
    throw new Error('unexpected');
  };

  const known = await agentTools.executeToolCall('search_inventory', { query: 'biotin' }, {
    contract,
    allowWriteTools: false,
    toEnvelope,
    dispatch
  });
  assert.equal(known.ok, true);
  assert.equal(known.items.length, 1);

  const unknown = await agentTools.executeToolCall('missing_tool', { query: 'x' }, {
    contract,
    allowWriteTools: false,
    toEnvelope,
    dispatch
  });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /Unknown tool/i);

  const blockedWrite = await agentTools.executeToolCall('download_paper_pdf', { linked_name: 'x' }, {
    contract,
    allowWriteTools: false,
    toEnvelope,
    dispatch
  });
  assert.equal(blockedWrite.ok, false);
  assert.match(blockedWrite.error, /Write action blocked/i);

  const allowedWrite = await agentTools.executeToolCall('download_paper_pdf', { linked_name: 'x' }, {
    contract,
    allowWriteTools: true,
    toEnvelope,
    dispatch
  });
  assert.equal(allowedWrite.ok, true);
  assert.equal(allowedWrite.items.length, 1);
});

test('agent-tools executeToolCall applies conservative local fuzzy retries then no-match fallback', async () => {
  const contract = agentTools.loadToolContract({
    tools: [
      { name: 'search_inventory', description: 'inventory', input_schema: {}, output_schema: {} }
    ]
  });
  const toEnvelope = (toolName, args, rawResult, options = {}) => ({
    ok: options.ok !== false,
    tool_name: toolName,
    input: args,
    items: rawResult?.items || [],
    citations: rawResult?.citations || [],
    summary: rawResult?.summary || '',
    ...(options.error ? { error: options.error } : {})
  });

  const calls = [];
  const dispatch = async (_toolName, args) => {
    calls.push(String(args.query || ''));
    const q = String(args.query || '').toLowerCase();
    if (q.includes('molecular weight') && q.includes('biotin')) {
      return toEnvelope('search_inventory', args, {
        items: [{ id: 'biotin' }],
        citations: [{ source: 'inventory', pointer: 'biotin', reason: 'alias retry' }],
        summary: 'Found 1'
      });
    }
    return toEnvelope('search_inventory', args, {
      items: [],
      citations: [],
      summary: 'Found 0'
    });
  };

  const aliasHit = await agentTools.executeToolCall('search_inventory', { query: 'mw biotin' }, {
    contract,
    allowWriteTools: false,
    fuzzyVocabulary: ['biotin', 'molecular weight'],
    toEnvelope,
    dispatch
  });
  assert.equal(aliasHit.items.length, 1);
  assert.equal(calls.length >= 2, true);

  const noMatch = await agentTools.executeToolCall('search_inventory', { query: 'unknownzzzz' }, {
    contract,
    allowWriteTools: false,
    fuzzyVocabulary: ['biotin'],
    toEnvelope,
    dispatch: async () => toEnvelope('search_inventory', { query: 'unknownzzzz' }, { items: [], citations: [], summary: 'Found 0' })
  });
  assert.equal(noMatch.items.length, 0);
  assert.equal(noMatch.summary, 'No matching record found.');
});

test('agent-tools executeToolCall normalization retry can recover local-search misses', async () => {
  const contract = agentTools.loadToolContract({
    tools: [
      { name: 'search_inventory', description: 'inventory', input_schema: {}, output_schema: {} }
    ]
  });
  const toEnvelope = (toolName, args, rawResult, options = {}) => ({
    ok: options.ok !== false,
    tool_name: toolName,
    input: args,
    items: rawResult?.items || [],
    citations: rawResult?.citations || [],
    summary: rawResult?.summary || '',
    ...(options.error ? { error: options.error } : {})
  });
  const calls = [];
  const hit = await agentTools.executeToolCall('search_inventory', { query: 'TNF-α reagent' }, {
    contract,
    allowWriteTools: false,
    fuzzyVocabulary: ['tnf-alpha', 'reagent'],
    toEnvelope,
    dispatch: async (_toolName, args) => {
      const q = String(args.query || '');
      calls.push(q);
      if (q.includes('tnf-alpha')) {
        return toEnvelope('search_inventory', args, {
          items: [{ id: 'tnfa' }],
          citations: [{ source: 'inventory', pointer: 'tnfa', reason: 'normalization retry' }],
          summary: 'Found 1'
        });
      }
      return toEnvelope('search_inventory', args, {
        items: [],
        citations: [],
        summary: 'Found 0'
      });
    }
  });
  assert.equal(hit.items.length, 1);
  assert.equal(calls.some((q) => q.includes('tnf-alpha')), true);
});

test('agent-tools executeToolCall light fuzzy retry can recover one-edit query typos', async () => {
  const contract = agentTools.loadToolContract({
    tools: [
      { name: 'search_inventory', description: 'inventory', input_schema: {}, output_schema: {} }
    ]
  });
  const toEnvelope = (toolName, args, rawResult, options = {}) => ({
    ok: options.ok !== false,
    tool_name: toolName,
    input: args,
    items: rawResult?.items || [],
    citations: rawResult?.citations || [],
    summary: rawResult?.summary || '',
    ...(options.error ? { error: options.error } : {})
  });
  const calls = [];
  const hit = await agentTools.executeToolCall('search_inventory', { query: 'biotn lot' }, {
    contract,
    allowWriteTools: false,
    fuzzyVocabulary: ['biotin', 'lot'],
    toEnvelope,
    dispatch: async (_toolName, args) => {
      const q = String(args.query || '').toLowerCase();
      calls.push(q);
      if (q.includes('biotin')) {
        return toEnvelope('search_inventory', args, {
          items: [{ id: 'biotin' }],
          citations: [{ source: 'inventory', pointer: 'biotin', reason: 'fuzzy retry' }],
          summary: 'Found 1'
        });
      }
      return toEnvelope('search_inventory', args, {
        items: [],
        citations: [],
        summary: 'Found 0'
      });
    }
  });
  assert.equal(hit.items.length, 1);
  assert.equal(calls.includes('biotin lot'), true);
});

test('agent-tools executeToolCall applies local fuzzy retry for search_workflows', async () => {
  const contract = agentTools.loadToolContract({
    tools: [
      { name: 'search_workflows', description: 'workflow search', input_schema: {}, output_schema: {} }
    ]
  });
  const toEnvelope = (toolName, args, rawResult, options = {}) => ({
    ok: options.ok !== false,
    tool_name: toolName,
    input: args,
    items: rawResult?.items || [],
    citations: rawResult?.citations || [],
    summary: rawResult?.summary || '',
    ...(options.error ? { error: options.error } : {})
  });
  const calls = [];
  const hit = await agentTools.executeToolCall('search_workflows', { query: 'transfectin step' }, {
    contract,
    allowWriteTools: false,
    fuzzyVocabulary: ['transfection', 'step'],
    toEnvelope,
    dispatch: async (_toolName, args) => {
      const q = String(args.query || '').toLowerCase();
      calls.push(q);
      if (q.includes('transfection')) {
        return toEnvelope('search_workflows', args, {
          items: [{ id: 'wf-1' }],
          citations: [{ source: 'workflow', pointer: 'wf-1', reason: 'fuzzy retry hit' }],
          summary: 'Found 1'
        });
      }
      return toEnvelope('search_workflows', args, {
        items: [],
        citations: [],
        summary: 'Found 0'
      });
    }
  });
  assert.equal(hit.items.length, 1);
  assert.equal(calls.includes('transfection step'), true);
});

test('agent-python-orchestration classifies tasks and requests clarification when required input is missing', () => {
  const routing = {
    intent: 'coding_data_analysis',
    plan: { needs_python: true }
  };
  const classified = agentPythonOrchestration.classifyPythonTask({
    message: 'Use Python to analyze this CSV and compute means.',
    entities: {},
    routing
  });
  assert.equal(classified.task_type, 'csv_tsv_descriptive');
  const runRequest = agentPythonOrchestration.buildPythonRunRequest({
    message: 'Analyze attached CSV for growth curves.',
    snapshot: { assays: [], gelAnalyses: [] },
    projectId: 'project-atlas',
    projectName: 'Atlas',
    taskType: classified.task_type
  });
  assert.equal(runRequest.ready, false);
  assert.equal(runRequest.needs_clarification, true);
  assert.match(String(runRequest.clarification_question || ''), /csv|tsv|tabular/i);
});

test('agent-python-codegen sanitizes valid payloads and clamps bounded fields', () => {
  const raw = {
    code: 'print(\"ok\")',
    files: new Array(12).fill(null).map((_, idx) => ({ path: `inputs/file_${idx + 1}.txt`, content: 'x' })),
    timeout_ms: 999999,
    readback_paths: new Array(12).fill(null).map((_, idx) => `outputs/r_${idx + 1}.txt`),
    artifact_paths: new Array(12).fill(null).map((_, idx) => `artifacts/a_${idx + 1}.txt`),
    persist_artifacts: true
  };
  const normalized = agentPythonCodegen.sanitizePythonRunRequest(JSON.stringify(raw), {
    taskType: 'csv_tsv_descriptive',
    defaults: {
      task_type: 'csv_tsv_descriptive'
    }
  });
  assert.equal(normalized.ok, true);
  assert.equal(typeof normalized.run_request.code, 'string');
  assert.equal(normalized.run_request.files.length, 10);
  assert.equal(normalized.run_request.timeout_ms, 15000);
  assert.equal(normalized.run_request.readback_paths.length, 8);
  assert.equal(normalized.run_request.artifact_paths.length, 8);
  assert.equal(normalized.run_request.task_type, 'csv_tsv_descriptive');
});

test('agent-python-codegen rejects malformed, missing code, and unsafe path payloads', () => {
  const malformed = agentPythonCodegen.sanitizePythonRunRequest('{invalid-json');
  assert.equal(malformed.ok, false);
  assert.equal(malformed.reason, 'malformed_json');

  const missingCode = agentPythonCodegen.sanitizePythonRunRequest({ files: [] });
  assert.equal(missingCode.ok, false);
  assert.equal(missingCode.reason, 'missing_code');

  const unsafePath = agentPythonCodegen.sanitizePythonRunRequest({
    code: 'print(\"ok\")',
    readback_paths: ['../escape.txt']
  });
  assert.equal(unsafePath.ok, false);
  assert.equal(unsafePath.reason, 'unsafe_path');
});

test('agent-python-orchestration validates sandbox output and persists artifacts inside storage root', async () => {
  const storagePath = fs.mkdtempSync(path.join(__dirname, 'tmp', 'phase89-python-'));
  const sandboxEnvelope = {
    ok: true,
    items: [
      {
        run_id: 'run-123',
        status: 'ok',
        readback_files: [
          { path: 'summary.txt', content: 'ok', truncated: false }
        ],
        warnings: []
      }
    ],
    citations: [],
    summary: 'done'
  };
  const validation = agentPythonOrchestration.validatePythonResult({ result: sandboxEnvelope });
  assert.equal(validation.ok, true);

  const persisted = await agentPythonOrchestration.persistPythonArtifacts({
    sandboxItem: validation.item,
    storagePath,
    projectName: 'Atlas'
  });
  assert.equal(persisted.applied, true);
  assert.equal(persisted.artifact_count, 1);
  assert.equal(Array.isArray(persisted.result_file_records), true);
  assert.equal(persisted.result_file_records.length, 1);
  assert.match(String(persisted.result_file_records[0].relativePath || ''), /Agent\/Python\/Atlas/);
  fs.rmSync(storagePath, { recursive: true, force: true });
});

test('agent-web-fallback trigger/query/merge paths are deterministic', () => {
  const routing = {
    intent: 'general_science_question',
    plan: { needs_web_search: true }
  };
  const trigger = agentWebFallback.shouldRunWebFallback({
    routing,
    intent: 'general_science_question',
    message: 'What are the latest PD-1 papers?',
    internalEvidence: []
  });
  assert.equal(trigger.should_run, true);
  assert.equal(trigger.reason, 'planner_requested_web_search');

  const queries = agentWebFallback.buildWebQueries({
    message: 'What are the latest PD-1 papers?',
    entities: { protein: 'PD-1' },
    intent: 'general_science_question',
    projectName: ''
  });
  assert.equal(Array.isArray(queries), true);
  assert.equal(queries.length > 0, true);

  const merged = agentWebFallback.mergeAndRankWebEvidence({
    webItems: [{ title: 'PD-1 review', url: 'https://example.org/review', snippet: 'review', source_domain: 'example.org' }],
    literatureItems: [{ title: 'PD-1 study', url: 'https://doi.org/10.1000/x', snippet: 'study', source_domain: 'doi.org', source_tool: 'search_pubmed' }],
    query: 'PD-1 review'
  });
  assert.equal(Array.isArray(merged), true);
  assert.equal(merged.length, 2);
  assert.equal(merged.some((item) => item.source_lane === 'literature'), true);
  assert.equal(merged.some((item) => item.source_lane === 'web'), true);
});

test('phase89 runtime executes planned python and post-processes artifacts', async () => {
  const storagePath = fs.mkdtempSync(path.join(__dirname, 'tmp', 'phase89-runtime-'));
  let runArgsSeen = null;
  const pythonRun = await phase89Runtime.runPlannedPythonTask({
    message: 'Use Python to parse this CSV and report mean values.',
    routing: {
      intent: 'coding_data_analysis',
      entities: {},
      plan: {
        needs_python: true,
        selected_tool_names: ['run_python_sandbox']
      }
    },
    snapshot: {
      assays: [
        { id: 'a1', name: 'Atlas assay', numeric_count: 12, result_well_count: 96, project_id: 'project-atlas' }
      ],
      gelAnalyses: [],
      settings: { storagePath }
    },
    selectedProjectId: 'project-atlas',
    selectedProjectName: 'Atlas',
    storagePath,
    generatePythonRunRequest: async () => JSON.stringify({
      code: [
        'import json',
        "with open('analysis.json', 'w', encoding='utf-8') as out:",
        "    json.dump({'rows': 1}, out, indent=2)",
        "print('rows=1')"
      ].join('\\n')
    }),
    runTool: async (_toolName, args) => {
      runArgsSeen = args;
      return {
      ok: true,
      tool_name: 'run_python_sandbox',
      input: {},
      items: [
        {
          run_id: 'run-900',
          status: 'ok',
          readback_files: [{ path: 'analysis.json', content: '{"rows":1}', truncated: false }],
          warnings: []
        }
      ],
      citations: [{ source: 'python_sandbox', pointer: 'run-900', reason: 'sandbox ok' }],
      summary: 'Python sandbox execution completed.'
      };
    }
  });
  assert.equal(pythonRun.executed, true);
  assert.equal(Boolean(pythonRun.plan_patch.python_task_type), true);
  assert.equal(pythonRun.plan_patch.python_artifact_count >= 1, true);
  assert.equal(pythonRun.plan_patch.python_codegen_status, 'ok');
  assert.equal(typeof runArgsSeen?.code, 'string');
  assert.equal(runArgsSeen.code.length > 0, true);
  assert.equal(Array.isArray(pythonRun.tool_result?.items), true);
  fs.rmSync(storagePath, { recursive: true, force: true });
});

test('phase89 runtime short-circuits on malformed python codegen output before sandbox execution', async () => {
  const storagePath = fs.mkdtempSync(path.join(__dirname, 'tmp', 'phase89-runtime-bad-'));
  let runToolCalls = 0;
  const pythonRun = await phase89Runtime.runPlannedPythonTask({
    message: 'Use Python to parse this CSV and report mean values.',
    routing: {
      intent: 'coding_data_analysis',
      entities: {},
      plan: {
        needs_python: true,
        selected_tool_names: ['run_python_sandbox']
      }
    },
    snapshot: {
      assays: [
        { id: 'a1', name: 'Atlas assay', numeric_count: 12, result_well_count: 96, project_id: 'project-atlas' }
      ],
      gelAnalyses: [],
      settings: { storagePath }
    },
    selectedProjectId: 'project-atlas',
    selectedProjectName: 'Atlas',
    storagePath,
    generatePythonRunRequest: async () => '{bad-json',
    runTool: async () => {
      runToolCalls += 1;
      return {};
    }
  });

  assert.equal(pythonRun.executed, false);
  assert.equal(pythonRun.needs_clarification, true);
  assert.equal(pythonRun.plan_patch.python_needs_clarification, true);
  assert.equal(pythonRun.plan_patch.python_codegen_status, 'error');
  assert.equal(runToolCalls, 0);
  fs.rmSync(storagePath, { recursive: true, force: true });
});

test('agent simulation contract parity guard keeps tool contract/capabilities/mock-dispatch in sync', () => {
  const missingCapabilities = AGENT_IO_TOOL_NAMES.filter(
    (name) => !Object.prototype.hasOwnProperty.call(agentTools.TOOL_CAPABILITY_MAP, name)
  );
  const missingMockDispatch = AGENT_IO_TOOL_NAMES.filter(
    (name) => !AGENT_SIMULATION_DISPATCH_TOOL_NAMES.has(name)
  );
  assert.equal(
    missingCapabilities.length,
    0,
    `Missing TOOL_CAPABILITY_MAP coverage: ${missingCapabilities.join(', ')}`
  );
  assert.equal(
    missingMockDispatch.length,
    0,
    `Missing mock dispatch coverage: ${missingMockDispatch.join(', ')}`
  );
});

test('agent simulation tool execution matrix covers all contract tools with write-policy behavior', async () => {
  const snapshot = buildAgentSimulationSnapshot();
  const matrixQuery = 'atlas biotin pd-1 transfection';
  const { dispatch, coveredToolNames } = buildMockToolDispatch(snapshot);
  const executedToolNames = [];

  for (const toolName of AGENT_IO_TOOL_NAMES) {
    const args = buildMockToolArgs(toolName, matrixQuery, snapshot);
    const result = await agentTools.executeToolCall(toolName, args, {
      contract: AGENT_IO_CONTRACT,
      allowWriteTools: false,
      dispatch,
      fuzzyVocabulary: ['atlas', 'biotin', 'pd-1', 'transfection']
    });

    executedToolNames.push(toolName);
    if (toolName === 'download_paper_pdf') {
      assert.equal(result.ok, false);
      assert.match(String(result.error || ''), /Write action blocked/i);
      continue;
    }

    assert.equal(result.ok, true, `Expected ${toolName} to execute in matrix test`);
    assert.equal(Array.isArray(result.items), true);
    assert.equal(result.items.length > 0, true, `Expected ${toolName} to return at least one item`);
    assert.equal(String(result.summary || '').length > 0, true);
  }

  const writeAllowed = await agentTools.executeToolCall(
    'download_paper_pdf',
    buildMockToolArgs('download_paper_pdf', matrixQuery, snapshot),
    {
      contract: AGENT_IO_CONTRACT,
      allowWriteTools: true,
      dispatch,
      fuzzyVocabulary: ['atlas', 'biotin']
    }
  );
  assert.equal(writeAllowed.ok, true);
  assert.equal(Array.isArray(writeAllowed.items), true);
  assert.equal(writeAllowed.items.length > 0, true);
  assert.equal(coveredToolNames.has('download_paper_pdf'), true);
  assert.deepEqual(executedToolNames.sort(), AGENT_IO_TOOL_NAMES.slice().sort());
});

test('agent simulation intent matrix executes expected tool families across request types', async () => {
  const snapshot = buildAgentSimulationSnapshot();
  const scenarios = [
    {
      intent: 'inventory_lookup',
      message: 'What is the molecular weight of biotin in stock?',
      expectedTools: ['search_inventory'],
      expectNeedsTools: true
    },
    {
      intent: 'record_lookup',
      message: 'What did we do last time for PD-1 expression?',
      expectedTools: ['search_notebook_entries', 'search_assays', 'search_gel_analyses'],
      expectNeedsTools: true
    },
    {
      intent: 'project_science_question',
      message: 'Why did project Atlas fail after transfection?',
      expectedTools: ['search_projects', 'search_notebook_entries', 'search_workflows'],
      expectNeedsTools: true
    },
    {
      intent: 'paper_analysis',
      message: 'Summarize this paper on PD-1 binder design.',
      expectedTools: ['search_papers', 'search_pubmed'],
      expectNeedsTools: true
    },
    {
      intent: 'coding_data_analysis',
      message: 'Use Python to analyze this CSV and compute mean values.',
      expectedTools: ['run_python_sandbox'],
      expectNeedsTools: true
    },
    {
      intent: 'general_science_question',
      message: 'What is ELISA and how does it work?',
      expectedTools: [],
      expectNeedsTools: false
    },
    {
      intent: 'protocol_to_notebook',
      message: 'I grew HEK293 cells and ran transfection today.',
      expectedTools: ['search_protocols'],
      expectNeedsTools: true
    }
  ];

  for (const scenario of scenarios) {
    const turn = await runSimulatedAgentTurn({
      message: scenario.message,
      snapshot,
      allowWriteTools: false,
      writeIntent: false
    });

    assert.equal(turn.routing.intent, scenario.intent);
    assert.equal(turn.routing.plan.needs_tools, scenario.expectNeedsTools);
    assert.equal(turn.routing.plan.needs_clarification, false);

    if (!scenario.expectNeedsTools) {
      assert.equal(turn.executedToolNames.length, 0);
      continue;
    }

    scenario.expectedTools.forEach((toolName) => {
      assert.equal(
        turn.executedToolNames.includes(toolName),
        true,
        `Expected ${scenario.intent} to execute ${toolName}`
      );
    });
    assert.equal(turn.toolTrace.length > 0, true);
    assert.equal(turn.citations.length > 0, true);
  }
});

test('agent simulation compare-papers mode uses uploaded-paper-only retrieval tools', async () => {
  const snapshot = buildAgentSimulationSnapshot();
  snapshot.papers = [
    {
      id: 'paper-a',
      title: 'Atlas PD-1 Methods',
      linkedType: 'project',
      linkedId: 'project-atlas',
      summary: 'Detailed method summary.',
      pdfDataUrl: 'data:application/pdf;base64,AAAA',
      methods: [{ title: 'Method A', steps: ['step 1'], citations: [] }],
      keyReagents: [{ name: 'Reagent A', type: 'compound' }]
    },
    {
      id: 'paper-b',
      title: 'Atlas PD-1 Reagents',
      linkedType: 'project',
      linkedId: 'project-atlas',
      summary: 'Reagent-heavy workflow.',
      pdfDataUrl: 'data:application/pdf;base64,BBBB',
      methods: [{ title: 'Method B', steps: ['step 1'], citations: [] }],
      keyReagents: [{ name: 'Reagent B', type: 'compound' }]
    }
  ];

  const turn = await runSimulatedAgentTurn({
    message: 'Compare "Atlas PD-1 Methods" vs "Atlas PD-1 Reagents".',
    snapshot,
    allowWriteTools: false,
    writeIntent: false
  });

  assert.equal(turn.routing.intent, 'paper_analysis');
  assert.equal(turn.routing.plan.needs_paper_comparison, true);
  assert.deepEqual(turn.routing.plan.selected_tool_names, ['search_papers']);
  assert.equal(turn.routing.plan.needs_clarification, false);
  assert.deepEqual(turn.executedToolNames, ['search_papers']);
});

test('agent simulation deep paper request with metadata-only paper clarifies before execution', async () => {
  const snapshot = buildAgentSimulationSnapshot();
  snapshot.papers = [
    {
      id: 'paper-meta',
      title: 'Atlas Metadata Only',
      linkedType: 'project',
      linkedId: 'project-atlas',
      summary: 'No uploaded PDF available.',
      methods: []
    }
  ];

  const turn = await runSimulatedAgentTurn({
    message: 'Extract methods from Atlas Metadata Only.',
    snapshot,
    allowWriteTools: false,
    writeIntent: false
  });

  assert.equal(turn.routing.intent, 'paper_analysis');
  assert.equal(turn.routing.plan.needs_clarification, true);
  assert.equal(turn.executedToolNames.length, 0);
  assert.match(String(turn.routing.plan.clarification_question || ''), /upload/i);
});

test('agent simulation protocol-generation phrasing triggers routing clarification and write-approval gate', async () => {
  const turn = await runSimulatedAgentTurn({
    message: 'Generate a lab notebook page for today.',
    snapshot: buildAgentSimulationSnapshot(),
    allowWriteTools: false,
    writeIntent: true
  });

  assert.equal(turn.routing.intent, 'protocol_to_notebook');
  assert.equal(turn.routing.plan.needs_tools, true);
  assert.equal(turn.routing.plan.needs_clarification, true);
  assert.equal(String(turn.routing.plan.clarification_question || '').length > 0, true);
  assert.equal(turn.requiresApproval, true);
  assert.equal(turn.executedToolNames.length, 0);
});

test('agent simulation protocol ambiguity short-circuits tool execution with matcher-driven clarification', async () => {
  const snapshot = buildAgentSimulationSnapshot();
  snapshot.protocols = [
    {
      id: 'protocol-transfection-a',
      name: 'HEK293 Transfection Setup',
      category: 'cell',
      steps: ['Seed HEK293 cells', 'Add DNA complex']
    },
    {
      id: 'protocol-transfection-b',
      name: 'HEK293 Transfection Maintenance',
      category: 'cell',
      steps: ['Seed HEK293 cells', 'Add transfection reagent']
    },
    {
      id: 'protocol-assay',
      name: 'ELISA Workflow',
      category: 'assay',
      steps: ['Prepare plate', 'Read absorbance']
    }
  ];

  const turn = await runSimulatedAgentTurn({
    message: 'I did HEK293 transfection today.',
    snapshot,
    allowWriteTools: false,
    writeIntent: false
  });

  assert.equal(turn.routing.intent, 'protocol_to_notebook');
  assert.equal(turn.routing.plan.protocol_match.needs_clarification, true);
  assert.equal(turn.routing.plan.needs_clarification, true);
  assert.equal(Array.isArray(turn.routing.plan.protocol_candidates), true);
  assert.equal(turn.routing.plan.protocol_candidates.length >= 2, true);
  assert.match(String(turn.routing.plan.clarification_question || ''), /Which protocol matches your run/i);
  assert.equal(turn.executedToolNames.length, 0);
});

test('agent simulation project ambiguity short-circuits tool execution with matcher-driven clarification', async () => {
  const snapshot = buildAgentSimulationSnapshot();
  snapshot.projects = [
    { id: 'project-atlas-a', name: 'Atlas Alpha', summary: 'alpha branch' },
    { id: 'project-atlas-b', name: 'Atlas Beta', summary: 'beta branch' }
  ];

  const turn = await runSimulatedAgentTurn({
    message: 'Why did project atlas fail?',
    snapshot,
    allowWriteTools: false,
    writeIntent: false
  });

  assert.equal(turn.routing.intent, 'project_science_question');
  assert.equal(turn.routing.plan.project_match.needs_clarification, true);
  assert.equal(turn.routing.plan.needs_clarification, true);
  assert.equal(Array.isArray(turn.routing.plan.project_candidates), true);
  assert.equal(turn.routing.plan.project_candidates.length >= 2, true);
  assert.match(String(turn.routing.plan.clarification_question || ''), /Which project should I use/i);
  assert.equal(turn.executedToolNames.length, 0);
});

test('protocol generation materialization persists normalized draft from extracted method payload', () => {
  const document = createMockDocument([
    'protocol-list-panel',
    'protocol-editor-panel',
    'protocol-view-panel',
    'create-protocol-btn',
    'protocol-editor-back-btn',
    'protocol-cancel-btn',
    'protocol-view-back-btn',
    'protocol-editor-heading',
    'protocol-view-title',
    'protocol-view-content',
    'protocol-form',
    'protocol-name',
    'protocol-purpose',
    'protocol-materials',
    'protocol-steps',
    'protocol-troubleshooting',
    'add-placeholder-btn',
    'placeholder-name',
    'protocol-share-status',
    'protocol-share-link-panel',
    'protocol-share-link-output',
    'protocol-list',
    'protocol-sort-field-btn',
    'protocol-sort-order-btn'
  ]);
  const protocolForm = document.getElementById('protocol-form');
  const protocolName = document.getElementById('protocol-name');
  const protocolPurpose = document.getElementById('protocol-purpose');
  const protocolMaterials = document.getElementById('protocol-materials');
  const protocolSteps = document.getElementById('protocol-steps');
  const protocolTroubleshooting = document.getElementById('protocol-troubleshooting');
  wireFormReset(protocolForm, [
    protocolName,
    protocolPurpose,
    protocolMaterials,
    protocolSteps,
    protocolTroubleshooting
  ]);

  let persistCalls = 0;
  const state = {
    protocols: [],
    notebookEntries: [],
    workflows: [],
    workflowTemplates: [],
    assays: [],
    gelAnalyses: [],
    messages: [],
    members: [],
    settings: {
      personalInfo: {
        enanaEmail: ''
      }
    }
  };

  const protocolModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'protocol-management.js'), {
    document,
    TextEncoder,
    btoa: btoaPolyfill
  });
  const protocol = protocolModule.initProtocolManagement({
    state,
    persist: () => {
      persistCalls += 1;
    },
    createId: (() => {
      let idx = 0;
      return () => `generated-protocol-${idx += 1}`;
    })(),
    safeText: shared.safeText,
    onProtocolsChanged: () => {},
    trackGrowthEvent: () => {}
  });

  const created = protocol.addDraftFromExtractedMethod(
    {
      title: 'Transfection Rescue',
      purpose: 'Recover expression by adjusting transfection conditions.',
      materials: ['HEK293 cells', 'Transfection reagent'],
      steps: [
        { step_number: 2, action: 'Incubate for [time] at 37 C.' },
        { step_number: 1, action: 'Add [] uL DNA mix.' }
      ],
      troubleshooting: [
        {
          problem: 'Low expression',
          possible_cause: 'Inefficient transfection',
          solution: 'Increase DNA purity and optimize reagent ratio'
        }
      ]
    },
    { title: 'Atlas Study' }
  );

  assert.equal(created, true);
  assert.match(protocolName.value, /Atlas Study - Transfection Rescue/);
  assert.match(protocolPurpose.value, /Recover expression/);
  assert.match(protocolSteps.value, /Add \[value\] uL DNA mix/);
  assert.match(protocolSteps.value, /Incubate for \[time\]/);
  assert.match(protocolTroubleshooting.value, /Problem: Low expression/);

  trigger(protocolForm, 'submit');

  assert.equal(state.protocols.length, 1);
  const persisted = state.protocols[0];
  assert.match(String(persisted.id || ''), /^generated-protocol-/);
  assert.equal(persisted.name, 'Atlas Study - Transfection Rescue');
  assert.equal(Array.isArray(persisted.materials), true);
  assert.equal(persisted.materials.length, 2);
  assert.equal(persisted.materials.includes('HEK293 cells'), true);
  assert.equal(persisted.materials.includes('Transfection reagent'), true);
  assert.equal(Array.isArray(persisted.steps), true);
  assert.equal(persisted.steps.length, 2);
  assert.equal(persisted.steps.some((step) => String(step?.text || '').includes('{{ph:')), true);
  const placeholderNames = persisted.steps.flatMap((step) => (
    Array.isArray(step?.placeholders) ? step.placeholders.map((item) => item?.name) : []
  ));
  assert.equal(placeholderNames.includes('value'), true);
  assert.equal(placeholderNames.includes('time'), true);
  assert.ok(Number.isFinite(Date.parse(persisted.createdAt)));
  assert.ok(Number.isFinite(Date.parse(persisted.updatedAt)));
  assert.equal(persistCalls > 0, true);
});

  }
};
