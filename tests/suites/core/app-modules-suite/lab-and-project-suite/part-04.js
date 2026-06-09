module.exports = function registerAppLabAndProjectSuitePart04(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
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

  assert.match(allText, /Project: Atlas/);
  assert.match(allText, /Experiment: Expression Panel A/);
  assert.match(allText, /Linked Results/);
  assert.match(allText, /Serial Dilution/);
  assert.match(allText, /Initial Dilution/);
  assert.match(allText, /Following Dilution/);
  assert.match(allText, /Tool Calculation/);
  assert.match(allText, /Molarity - Mass: Mass needed: 584\.4 mg\./);
  assert.match(allText, /Formula: mass = 10 mM x 1 L x 58\.44 g\/mol/);
  assert.match(allText, /Result Table/);
  assert.doesNotMatch(allText, /Mapped Wells/);
  assert.doesNotMatch(allText, /Mapped Well Definitions/);
  assert.doesNotMatch(allText, /Notebook Type:/);
  assert.doesNotMatch(allText, /Storage Folder:/);
  assert.equal(pdf.imageCalls.length, 2);
  assert.match(pdf.savedFileName, /Expression-Panel-A/i);
});
test('notebook pdf export paginates wrapped notes and draws result tables as cells', async () => {
  class MockJsPdf {
    static instances = [];

    constructor() {
      this.page = 1;
      this.addPageCalls = 0;
      this.textCalls = [];
      this.rectCalls = [];
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
  assert.ok(pdf.rectCalls.length >= 6, 'Expected result table cells to be drawn as bordered rectangles.');
  assert.doesNotMatch(allText, /Sample \| Reading/);
  assert.match(allText, /Clone 12/);
  assert.match(allText, /Table 2/);
  assert.match(allText, /Accepted/);
});
test('assay pdf export omits mapped well text section', () => {
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

  assert.match(allText, /Well Definition Plot/);
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
  }
};
