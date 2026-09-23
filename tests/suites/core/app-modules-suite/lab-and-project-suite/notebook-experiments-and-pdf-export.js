module.exports = function registerAppLabAndProjectSuiteNotebookExperimentsAndPdfExport(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  const { assert, path, loadEsmStyleModule, createMockDocument, trigger, test, shared } = scope;
test('biology-notebook New Experiment keeps the workspace project and starts only after protocol selection', () => {
  const document = createMockDocument([
    'biology-notebook-project-select',
    'biology-notebook-protocol-search',
    'biology-notebook-protocol-select',
    'biology-notebook-new-experiment-btn',
    'biology-notebook-experiment-dialog-overlay',
    'biology-notebook-experiment-form',
    'biology-notebook-experiment-dialog-close-btn',
    'biology-notebook-experiment-cancel-btn',
    'biology-notebook-experiment-start-btn',
    'biology-notebook-experiment-dialog-status',
    'biology-notebook-protocol-search-results',
    'biology-notebook-page-starter',
    'biology-notebook-page-starter-project',
    'biology-notebook-empty-state',
    'biology-notebook-protocol-area',
    'biology-notebook-protocol-title',
    'biology-notebook-protocol-meta',
    'biology-notebook-steps',
    'biology-notebook-result',
    'biology-notebook-result-file',
    'save-biology-notebook-btn',
    'cancel-biology-notebook-edit-btn',
    'biology-notebook-entry-list'
  ]);
  const overlay = document.getElementById('biology-notebook-experiment-dialog-overlay');
  const protocolArea = document.getElementById('biology-notebook-protocol-area');
  overlay.hidden = true;
  protocolArea.hidden = true;

  const state = {
    projects: [
      { id: 'p1', name: 'Atlas' },
      { id: 'p2', name: 'Vector Engineering' }
    ],
    protocols: [
      { id: 'pr1', name: 'PCR Setup', steps: [] },
      { id: 'pr2', name: 'Transformation', steps: [] }
    ],
    notebookEntries: [],
    assays: [],
    gelAnalyses: [],
    settings: { storagePath: '' }
  };
  const notebookModule = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'biology-notebook',
    'index.js'
  ), {
    document,
    window: { hikariApi: {} }
  });
  const notebook = notebookModule.initLabNotebook({
    state,
    persist: () => {},
    createId: () => 'new-entry',
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });
  const projectSelect = document.getElementById('biology-notebook-project-select');
  const protocolSearch = document.getElementById('biology-notebook-protocol-search');
  const protocolSelect = document.getElementById('biology-notebook-protocol-select');
  const protocolResults = document.getElementById('biology-notebook-protocol-search-results');
  const startBtn = document.getElementById('biology-notebook-experiment-start-btn');

  notebook.renderProjectOptions();
  projectSelect.value = 'p2';
  trigger(document.getElementById('biology-notebook-new-experiment-btn'), 'click');

  assert.equal(overlay.hidden, false);
  assert.equal(projectSelect.value, 'p2');
  assert.equal(startBtn.disabled, true);
  assert.equal(document.getElementById('biology-notebook-experiment-dialog-status').textContent, '');

  protocolSearch.value = 'transform';
  trigger(protocolSearch, 'input');
  assert.match(protocolSelect.innerHTML, /Transformation/);
  assert.doesNotMatch(protocolSelect.innerHTML, /PCR Setup/);
  assert.match(protocolResults.innerHTML, /Transformation/);
  assert.doesNotMatch(protocolResults.innerHTML, /PCR Setup/);

  trigger(protocolResults, 'click', {
    target: { dataset: { notebookExperimentProtocolId: 'pr2' } }
  });
  assert.equal(protocolSelect.value, 'pr2');
  assert.equal(startBtn.disabled, false);
  assert.equal(document.getElementById('biology-notebook-experiment-dialog-status').textContent, '');

  trigger(document.getElementById('biology-notebook-experiment-form'), 'submit');
  assert.equal(overlay.hidden, true);
  assert.equal(protocolArea.hidden, false);
  assert.equal(document.getElementById('biology-notebook-protocol-title').textContent, 'Transformation');
  assert.match(document.getElementById('biology-notebook-protocol-meta').textContent, /Vector Engineering protocol draft/);
});

test('notebook pdf export includes linked page content and omits notebook type plus storage folder metadata', async () => {
  class MockJsPdf {
    static instances = [];

    constructor() {
      this.textCalls = [];
      this.imageCalls = [];
      this.savedFileName = '';
      this.internal = {
        pageSize: {
          getWidth: () => 612,
          getHeight: () => 792
        }
      };
      MockJsPdf.instances.push(this);
    }

    setFont() {}

    setFontSize() {}

    splitTextToSize(text) {
      return String(text || '').split('\n');
    }

    text(value) {
      this.textCalls.push(Array.isArray(value) ? value.join(' ') : String(value || ''));
    }

    addPage() {}

    addImage(dataUrl, format, x, y, width, height) {
      this.imageCalls.push({ dataUrl, format, x, y, width, height });
    }

    rect() {}

    setFillColor() {}

    setDrawColor() {}


    setTextColor() {}


    setLineWidth() {}


    line() {}


    roundedRect() {}

    save(fileName) {
      this.savedFileName = String(fileName || '');
    }
  }

  class MockImage {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this.width = 240;
      this.height = 120;
      this.naturalWidth = 240;
      this.naturalHeight = 120;
    }

    set src(_value) {
      if (typeof this.onload === 'function') {
        this.onload();
      }
    }
  }

  const mockDocument = {
    createElement(tagName) {
      if (tagName !== 'canvas') {
        return {};
      }
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            fillStyle: '#ffffff',
            fillRect() {},
            drawImage() {}
          };
        },
        toDataURL() {
          return 'data:image/png;base64,MOCKPNG';
        }
      };
    }
  };

  const pdfExportModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'pdf-export', 'index.js'), {
    window: {
      jspdf: {
        jsPDF: MockJsPdf
      },
      alert() {}
    },
    document: mockDocument,
    Image: MockImage
  });

  const exportResult = await pdfExportModule.exportNotebookEntryPdf({
    entry: {
      id: 'notebook-1',
      notebookType: 'biology',
      projectName: 'Atlas',
      protocolName: 'Expression Readout',
      experimentName: 'Expression Panel A',
      notebookState: 'executed',
      updatedAt: '2026-04-22T14:30:00.000Z',
      executedAt: '2026-04-22T13:45:00.000Z',
      storageFolder: '/tmp/not-used',
      result: 'Final expression notes.',
      resultTable: {
        columns: [
          { field: 'sample', title: 'Sample' },
          { field: 'od600', title: 'OD600' }
        ],
        rows: [
          { id: 'row-1', sample: 'Clone 12', od600: '0.82' }
        ]
      },
      toolCalculations: [{
        id: 'calc-1',
        type: 'molarity',
        title: 'Molarity - Mass',
        result: 'Mass needed: 584.4 mg.',
        formula: 'mass = 10 mM x 1 L x 58.44 g/mol',
        summary: 'Mass needed: 584.4 mg.'
      }, {
        id: 'calc-2',
        type: 'buffer',
        title: 'Buffer Preparer',
        result: 'NaCl: 8766 mg (8.766 g).\nSolvent to add: 1000 mL (1.000e+6 uL).',
        formula: 'NaCl mass = 150 mM x 1 L x 58.44 g/mol',
        summary: 'NaCl: 8766 mg (8.766 g).',
        table: {
          metaRows: [['Volume', '1000 mL', 'pH', '7.4', '']],
          headers: ['Chemical', 'MW', 'Stock Conc.', 'Final Conc.', 'Mass/Volume'],
          rows: [['NaCl', '58.44', '', '150 mM', '8766 mg (8.766 g)']],
          footerRows: [['Solvent to add 1000 mL (1.000e+6 uL)', '', '', '', '']]
        }
      }],
      resultFiles: ['gel.png', 'assay.csv'],
      values: {
        'step-1:buffer': 'PBS'
      }
    },
    protocol: {
      id: 'protocol-1',
      steps: [
        {
          id: 'step-1',
          text: 'Wash with {{ph:buffer}}.',
          placeholders: [
            { id: 'buffer', name: 'Buffer' }
          ]
        }
      ]
    },
    linkedGel: {
      name: 'Expression Gel',
      analysisType: 'sds-page',
      updatedAt: '2026-04-22T14:10:00.000Z'
    },
    linkedGelPreviewImage: 'data:image/png;base64,GELPREVIEW',
    linkedAssay: {
      id: 'assay-1',
      name: 'Expression Assay',
      assayNumber: 'A-001',
      plateLabel: '96 well plate',
      plateType: '96',
      updatedAt: '2026-04-22T14:12:00.000Z',
      wellLayout: [
        { well: 'A1', sampleId: 'Clone 12', concentration: '1 uM' }
      ],
      sampleAxis: 'row',
      concentrationAxis: 'column',
      sampleAxisValues: ['Clone 12'],
      concentrationAxisValues: ['1 uM'],
      serialDilutionSummary: {
        volumePerWellUl: 100,
        feedbackMessages: [
          { text: 'Dilution plan validated.', type: 'note' }
        ],
        initialDilutionRows: [
          { sample: 'Clone 12', stockVolume: '10 uL', bufferVolume: '90 uL' }
        ],
        followingDilutionRows: [
          {
            step: '1',
            targetConcentration: '0.1 uM',
            fromPreviousWell: '10 uL',
            bufferVolume: '90 uL',
            transferOrDiscard: 'Transfer 10 uL',
            finalVolume: '100 uL'
          }
        ],
        hasValidPlans: true
      },
      latestAnalysis: {
        method: 'standard_curve_line',
        summary: 'Good fit',
        chartDataUrl: 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%22240%22%20height%3D%22120%22%3E%3C/svg%3E'
      }
    }
  });

  assert.equal(exportResult, true);
  const pdf = MockJsPdf.instances[0];
  const allText = pdf.textCalls.join('\n');

  assert.match(allText, /PROJECT/);
  assert.match(allText, /Atlas/);
  assert.match(allText, /Expression Panel A/);
  assert.match(allText, /LINKED RESULTS/);
  assert.match(allText, /Serial Dilution/);
  assert.match(allText, /Initial Dilution/);
  assert.match(allText, /Following Dilution/);
  assert.match(allText, /Tool Calculation/);
  assert.match(allText, /Molarity - Mass: Mass needed: 584\.4 mg\./);
  assert.match(allText, /Formula: mass = 10 mM x 1 L x 58\.44 g\/mol/);
  assert.match(allText, /Buffer Preparer/);
  assert.match(allText, /Chemical/);
  assert.match(allText, /NaCl/);
  assert.match(allText, /8766 mg/);
  assert.doesNotMatch(allText, /Buffer Preparer: NaCl:/);
  assert.match(allText, /Result Table/);
  assert.doesNotMatch(allText, /Mapped Wells/);
  assert.doesNotMatch(allText, /Mapped Well Definitions/);
  assert.doesNotMatch(allText, /Notebook Type:/);
  assert.doesNotMatch(allText, /Storage Folder:/);
  assert.equal(pdf.imageCalls.length, 2);
  assert.match(pdf.savedFileName, /Expression-Panel-A/i);
});
test('notebook pdf export paginates wrapped notes and draws ruled result tables', async () => {
  class MockJsPdf {
    static instances = [];

    constructor() {
      this.page = 1;
      this.addPageCalls = 0;
      this.textCalls = [];
      this.rectCalls = [];
      this.lineCalls = [];
      this.savedFileName = '';
      this.internal = {
        pageSize: {
          getWidth: () => 612,
          getHeight: () => 260
        }
      };
      MockJsPdf.instances.push(this);
    }

    setFont() {}

    setFontSize() {}

    setDrawColor() {}


    setTextColor() {}


    setLineWidth() {}


    line(...args) { this.lineCalls.push(args); }


    roundedRect() {}

    setFillColor() {}

    splitTextToSize(text) {
      return String(text || '')
        .split('\n')
        .flatMap((line) => line.match(/.{1,32}/g) || ['']);
    }

    text(value, _x, y) {
      const lines = Array.isArray(value) ? value : [value];
      lines.forEach((line) => {
        this.textCalls.push({
          page: this.page,
          y: Number(y),
          value: String(line || '')
        });
      });
    }

    addPage() {
      this.page += 1;
      this.addPageCalls += 1;
    }

    rect(x, y, width, height, style) {
      this.rectCalls.push({ x, y, width, height, style });
    }

    save(fileName) {
      this.savedFileName = String(fileName || '');
    }
  }

  const pdfExportModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'pdf-export', 'index.js'), {
    window: {
      jspdf: {
        jsPDF: MockJsPdf
      },
      alert() {}
    }
  });

  const exportResult = await pdfExportModule.exportNotebookEntryPdf({
    entry: {
      id: 'notebook-long',
      projectName: 'Atlas',
      protocolName: 'Expression Readout',
      experimentName: 'Long Notes',
      notebookState: 'planned',
      updatedAt: '2026-04-22T14:30:00.000Z',
      result: Array.from({ length: 18 }, (_unused, index) => (
        `Observation ${index + 1}: this note is intentionally long enough to wrap inside the PDF export.`
      )).join('\n'),
      resultTable: {
        columns: [
          { field: 'sample', title: 'Sample' },
          { field: 'reading', title: 'Reading' }
        ],
        rows: [
          { id: 'row-1', sample: 'Clone 12', reading: '0.82' },
          { id: 'row-2', sample: 'Clone 18', reading: '0.76' }
        ]
      },
      resultTables: [
        {
          columns: [
            { field: 'sample', title: 'Sample' },
            { field: 'reading', title: 'Reading' }
          ],
          rows: [
            { id: 'row-1', sample: 'Clone 12', reading: '0.82' },
            { id: 'row-2', sample: 'Clone 18', reading: '0.76' }
          ]
        },
        {
          columns: [
            { field: 'replicate', title: 'Replicate' },
            { field: 'note', title: 'Note' }
          ],
          rows: [
            { id: 'row-1', replicate: 'R1', note: 'Accepted' }
          ]
        }
      ],
      values: {}
    },
    protocol: {
      id: 'protocol-1',
      steps: [
        {
          id: 'step-1',
          text: 'Collect expression readout.',
          placeholders: []
        }
      ]
    }
  });

  assert.equal(exportResult, true);
  const pdf = MockJsPdf.instances[0];
  const allText = pdf.textCalls.map((call) => call.value).join('\n');

  assert.ok(pdf.addPageCalls > 0);
  assert.ok(pdf.textCalls.every((call) => call.y <= 188), 'Expected text baselines to stay inside the visible page body.');
  assert.ok(pdf.lineCalls.length >= 6, 'Expected table headers and rows to have readable horizontal rules.');
  assert.doesNotMatch(allText, /Sample \| Reading/);
  // The export carries the grid's spreadsheet furniture so A1 references still read.
  assert.match(allText, /A · Sample/);
  assert.match(allText, /B · Reading/);
  assert.match(allText, /Clone 12/);
  assert.match(allText, /Table 2/);
  assert.match(allText, /Accepted/);
});
test('assay pdf export writes saved values inside mapped plate cells', () => {
  class MockJsPdf {
    static instances = [];

    constructor() {
      this.textCalls = [];
      this.savedFileName = '';
      this.internal = {
        pageSize: {
          getWidth: () => 612,
          getHeight: () => 792
        }
      };
      MockJsPdf.instances.push(this);
    }

    setFont() {}

    setFontSize() {}

    splitTextToSize(text) {
      return String(text || '').split('\n');
    }

    text(value) {
      this.textCalls.push(Array.isArray(value) ? value.join(' ') : String(value || ''));
    }

    addPage() {}

    rect() {}

    setFillColor() {}

    setDrawColor() {}


    setTextColor() {}


    setLineWidth() {}


    line() {}


    roundedRect() {}

    save(fileName) {
      this.savedFileName = String(fileName || '');
    }
  }

  const pdfExportModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'pdf-export', 'index.js'), {
    window: {
      jspdf: {
        jsPDF: MockJsPdf
      },
      alert() {}
    }
  });

  const exportResult = pdfExportModule.exportAssayDefinitionPdf({
    id: 'assay-1',
    assayNumber: 'A-001',
    name: 'Expression Assay',
    projectName: 'Atlas',
    plateLabel: '96 well plate',
    plateType: '96',
    sampleAxis: 'row',
    concentrationAxis: 'column',
    updatedAt: '2026-04-22T14:12:00.000Z',
    wellLayout: [
      { well: 'A1', sampleId: 'Clone 12', concentration: '1 uM' }
    ]
  });

  assert.equal(exportResult, true);
  const pdf = MockJsPdf.instances[0];
  const allText = pdf.textCalls.join('\n');

  assert.match(allText, /WELL DEFINITION PLOT/);
  assert.match(allText, /Clone 12/);
  assert.match(allText, /1 uM/);
  assert.doesNotMatch(allText, /Mapped Wells/);
  assert.doesNotMatch(allText, /Mapped Well Definitions/);
  assert.match(pdf.savedFileName, /A-001/i);
});
test('workflow presentation labels include notebook execution state', () => {
  const workflowPresentation = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'workflow', 'presentation.js'));
  const label = workflowPresentation.notebookEntryLabel({
    notebookType: 'biology',
    notebookState: 'planned',
    protocolName: 'Viability Assay',
    updatedAt: '2026-03-01T00:00:00.000Z'
  }, () => 'Mar 1');
  assert.equal(label, 'Biology | Planned | Viability Assay | Mar 1');
});
};
