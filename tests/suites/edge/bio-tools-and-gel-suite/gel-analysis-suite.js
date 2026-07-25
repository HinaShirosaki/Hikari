module.exports = function registerEdgeGelAnalysisSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('[EDGE] gel-analysis internal functions are exposed for unit tests', () => {
  [
    'selectViewerBaseImageData',
    'clamp',
    'round',
    'mean',
    'confidenceLabel',
    'normalizeManualOverrides',
    'normalizeLaneBandWindows',
    'normalizeLaneVertices',
    'normalizePeakIntegrations',
    'getLaneRowBounds',
    'getLaneRowSegment',
    'getLaneRectifiedWidth',
    'lanePointToRectifiedRow',
    'laneContainsPoint',
    'getTargetBandWindowForLane',
    'isPerLaneBandMode',
    'analyzeGelImage',
    'safeFilePart',
    'escapeCsv',
    'computeHistogramPercentiles',
    'normalizeArrayRange',
    'buildGaussianKernel',
    'gaussianBlur2d',
    'linearRegression',
    'buildCalibration',
    'applyNormalization',
    'clusterBandsAcrossLanes',
    'computeLaneConfidence',
    'interpretLane'
  ].forEach((name) => {
    assert.equal(typeof gelAnalysisInternals[name], 'function');
  });
});

test('[EDGE] gel-analysis viewer keeps imported color image data when preprocessing exists', () => {
  const originalImageData = { tag: 'original' };
  const previewImageData = { tag: 'preview' };
  const selected = gelAnalysisInternals.selectViewerBaseImageData(
    { imageData: originalImageData },
    { previewImageData }
  );
  assert.equal(selected, originalImageData);
});

test('[EDGE] gel-analysis viewer image selection handles empty input', () => {
  assert.equal(gelAnalysisInternals.selectViewerBaseImageData(null, { previewImageData: { tag: 'preview' } }), null);
});

test('[EDGE] gel-analysis edit restores saved source images and legacy inline previews', async () => {
  const readPaths = [];
  const decodedSources = [];
  const recordsModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'gel', 'records-manager.js'),
    {
      window: {
        hikariApi: {
          async readFileBase64(filePath) {
            readPaths.push(filePath);
            return {
              ok: true,
              dataBase64: 'c2F2ZWQtZ2Vs'
            };
          }
        }
      }
    }
  );
  const sourceRecord = {
    id: 'gel-source',
    name: 'Stored source gel',
    analysisType: 'sds-page',
    imageName: 'source.png',
    sourceImagePath: '/workspace/Gels/gel-source/source.png',
    parameters: {},
    manualOverrides: {},
    report: { lanes: [], warnings: [] }
  };
  const previewRecord = {
    id: 'gel-preview',
    name: 'Legacy preview gel',
    analysisType: 'western',
    imageName: 'legacy.png',
    previewImageDataUrl: 'data:image/png;base64,bGVnYWN5LXByZXZpZXc=',
    parameters: {},
    manualOverrides: {},
    report: { lanes: [], warnings: [] }
  };
  const reportOnlyRecord = {
    id: 'gel-report-only',
    name: 'Report-only gel',
    analysisType: 'agarose',
    parameters: {},
    manualOverrides: {},
    report: { lanes: [], warnings: [] }
  };
  const runtime = {
    state: {
      settings: { storagePath: '/workspace' },
      gelAnalyses: [sourceRecord, previewRecord, reportOnlyRecord],
      notebookEntries: []
    },
    currentImage: null,
    currentReport: null,
    imageRevision: 0,
    manualOverrides: {},
    persist() {},
    safeText: (value) => String(value)
  };
  const elements = {
    gelIdInput: new MockElement('gel-id'),
    gelNameInput: new MockElement('gel-name'),
    gelTypeInput: new MockElement('gel-type'),
    gelLadderLaneInput: new MockElement('gel-ladder-lane'),
    gelNormalizationInput: new MockElement('gel-normalization'),
    gelDenoiseStrengthInput: new MockElement('gel-denoise'),
    gelContrastStrengthInput: new MockElement('gel-contrast')
  };
  const statuses = [];
  let renderedCanvases = 0;
  const controller = recordsModule.createRecordsManager({
    runtime,
    elements,
    deps: {
      copyNormalizedImage(image) {
        return { ...image, copied: true };
      },
      async decodeImageSource(dataUrl, name) {
        decodedSources.push({ dataUrl, name });
        return {
          name,
          width: 8,
          height: 6,
          imageData: { width: 8, height: 6 },
          gray: new Float32Array(48)
        };
      },
      leaveCropMode() {},
      renderCanvas() {
        renderedCanvases += 1;
      },
      renderEnhancementValues() {},
      renderManualProgress() {},
      renderOverrideStatus() {},
      renderReport() {},
      setCurrentImage(image) {
        runtime.currentImage = image;
        runtime.imageRevision += 1;
      },
      setStatus(message) {
        statuses.push(message);
      }
    }
  });

  const editEvent = (recordId) => ({
    target: {
      closest(selector) {
        return selector === '[data-gel-edit]'
          ? { dataset: { gelEdit: recordId } }
          : null;
      }
    }
  });

  await controller.onListClick(editEvent(sourceRecord.id));
  assert.deepEqual(readPaths, [sourceRecord.sourceImagePath]);
  assert.equal(decodedSources[0].dataUrl, 'data:image/png;base64,c2F2ZWQtZ2Vs');
  assert.equal(runtime.currentImage.name, sourceRecord.imageName);
  assert.equal(runtime.originalImage.copied, true);
  assert.equal(runtime.currentReport, sourceRecord.report);
  assert.equal(elements.gelNameInput.value, sourceRecord.name);
  assert.equal(statuses.at(-1), `Loaded saved gel: ${sourceRecord.name}.`);

  await controller.onListClick(editEvent(previewRecord.id));
  assert.equal(decodedSources[1].dataUrl, previewRecord.previewImageDataUrl);
  assert.equal(runtime.currentImage.name, previewRecord.imageName);
  assert.equal(runtime.currentReport, previewRecord.report);
  assert.equal(elements.gelTypeInput.value, 'western');
  assert.match(statuses.at(-1), /Loaded saved gel preview/);
  assert.ok(renderedCanvases >= 4);

  await controller.onListClick(editEvent(reportOnlyRecord.id));
  assert.equal(runtime.currentImage, null);
  assert.equal(runtime.currentReport, reportOnlyRecord.report);
  assert.equal(elements.gelTypeInput.value, 'agarose');
  assert.match(statuses.at(-1), /older record has no stored image/);
});

test('[EDGE] gel-analysis report opens in an overlapping window only when report data exists', () => {
  const renderingModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'gel', 'rendering', 'index.js'));
  const runtime = {
    currentReport: null,
    reportDialogOpen: false
  };
  const elements = {
    gelOpenReportBtn: new MockElement('gel-open-report-btn'),
    gelReportOverlay: new MockElement('gel-report-overlay'),
    gelReportCloseBtn: new MockElement('gel-report-close-btn'),
    gelReportSummary: new MockElement('gel-report-summary')
  };
  let closeFocused = 0;
  let openerFocused = 0;
  elements.gelReportCloseBtn.focus = () => {
    closeFocused += 1;
  };
  elements.gelOpenReportBtn.focus = () => {
    openerFocused += 1;
  };
  const controller = renderingModule.createRenderingController({
    runtime,
    elements,
    safeText: (value) => String(value),
    deps: {}
  });

  controller.renderReport();
  assert.equal(elements.gelOpenReportBtn.disabled, true);
  assert.equal(elements.gelReportOverlay.hidden, true);

  runtime.currentReport = {
    analysisType: 'sds-page',
    lanes: [],
    bandGroups: [],
    warnings: [],
    preprocessing: {},
    confidence: {}
  };
  controller.renderReport();
  assert.equal(elements.gelOpenReportBtn.disabled, false);
  assert.equal(elements.gelReportOverlay.hidden, true);

  controller.onReportOpen();
  assert.equal(elements.gelReportOverlay.hidden, false);
  assert.equal(elements.gelOpenReportBtn.getAttribute('aria-expanded'), 'true');
  assert.equal(closeFocused, 1);
  assert.match(elements.gelReportSummary.innerHTML, /SDS-PAGE/);

  let escapePrevented = false;
  controller.onReportKeyDown({
    key: 'Escape',
    preventDefault() {
      escapePrevented = true;
    }
  });
  assert.equal(escapePrevented, true);
  assert.equal(elements.gelReportOverlay.hidden, true);
  assert.equal(elements.gelOpenReportBtn.getAttribute('aria-expanded'), 'false');
  assert.equal(openerFocused, 1);
});

test('[EDGE] gel-analysis crop rotation follows free drag away from crop borders', () => {
  const cropModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'gel', 'images', 'crop-controller.js'));
  const rotationCalls = [];
  const statuses = [];
  const runtime = {
    cropRotationDegrees: 0,
    cropperActive: true,
    cropperInstance: {
      destroy() {},
      rotateTo(degrees) {
        rotationCalls.push(degrees);
      }
    },
    currentImage: { width: 120, height: 80 },
    originalImage: { width: 120, height: 80 }
  };
  const elements = {
    gelCropModeBtn: new MockElement('gel-crop-mode-btn'),
    gelApplyCropBtn: new MockElement('gel-apply-crop-btn'),
    gelResetCropBtn: new MockElement('gel-reset-crop-btn')
  };
  const controller = cropModule.createCropController({
    runtime,
    elements,
    deps: {
      renderCanvas() {},
      renderOverrideStatus() {},
      renderReport() {},
      setStatus: (message) => statuses.push(message)
    }
  });

  controller.setCropUiState();
  assert.equal(elements.gelCropModeBtn.getAttribute('aria-label'), 'Cancel crop');
  assert.equal(elements.gelCropModeBtn.getAttribute('aria-pressed'), 'true');
  assert.equal(elements.gelApplyCropBtn.disabled, false);
  assert.equal(elements.gelApplyCropBtn.hidden, false);

  const cropperContainer = new MockElement('cropper-container');
  const captureTarget = {
    capturedPointerId: null,
    releasedPointerId: null,
    setPointerCapture(pointerId) {
      this.capturedPointerId = pointerId;
    },
    releasePointerCapture(pointerId) {
      this.releasedPointerId = pointerId;
    }
  };
  const surfaceTarget = {
    closest(selector) {
      return selector === '.cropper-container' ? cropperContainer : null;
    }
  };
  const borderTarget = {
    closest(selector) {
      return selector.includes('.cropper-line') ? this : cropperContainer;
    }
  };

  controller.onRotationDragStart({
    button: 0,
    clientX: 100,
    currentTarget: captureTarget,
    isPrimary: true,
    pointerId: 6,
    target: borderTarget
  });
  assert.equal(runtime.cropRotationDrag ?? null, null);

  controller.onRotationDragStart({
    button: 0,
    clientX: 100,
    currentTarget: captureTarget,
    isPrimary: true,
    pointerId: 7,
    preventDefault() {},
    stopImmediatePropagation() {},
    stopPropagation() {},
    target: surfaceTarget
  });
  assert.equal(captureTarget.capturedPointerId, 7);
  assert.equal(cropperContainer.classList.contains('is-gel-rotating'), true);

  controller.onRotationDragMove({
    clientX: 150,
    pointerId: 7,
    preventDefault() {},
    stopPropagation() {}
  });
  assert.deepEqual(rotationCalls, [12.5]);
  assert.equal(runtime.cropRotationDegrees, 12.5);

  controller.onRotationDragEnd({
    pointerId: 7,
    preventDefault() {},
    stopPropagation() {}
  });
  assert.equal(cropperContainer.classList.contains('is-gel-rotating'), false);
  assert.equal(captureTarget.releasedPointerId, 7);
  assert.equal(runtime.cropRotationDrag, null);
  assert.match(statuses[statuses.length - 1], /12\.5 deg/);

  controller.onCropModeAction();
  assert.equal(runtime.cropperActive, false);
  assert.equal(elements.gelCropModeBtn.getAttribute('aria-label'), 'Start crop');
  assert.equal(elements.gelCropModeBtn.getAttribute('aria-pressed'), 'false');
  assert.equal(elements.gelApplyCropBtn.disabled, true);
  assert.equal(elements.gelApplyCropBtn.hidden, true);
  assert.match(statuses[statuses.length - 1], /crop cancelled/i);
});

test('[EDGE] gel-analysis lane table render includes gel-edge offsets for divider alignment', () => {
  const runtime = {
    currentImage: { width: 600 },
    cropperActive: false,
    manualOverrides: {
      laneSegmentation: {
        gelLeft: 100,
        gelRight: 500,
        dividers: [250, 375],
        dividerDone: true,
        bandTop: null,
        bandBottom: null
      },
      addedBands: [],
      ladderLane: null,
      ladderBands: [],
      ladderBandsDone: false,
      laneTable: {
        rows: [
          { label: 'Samples', values: ['A', 'B', 'C'] }
        ]
      }
    }
  };
  const elements = {
    gelAddTableBtn: new MockElement('gel-add-table-btn'),
    gelLaneTableShell: new MockElement('gel-lane-table-shell'),
    gelViewerStage: new MockElement('gel-viewer-stage'),
    gelImageRow: new MockElement('gel-image-row'),
    gelLaneTableSpacer: new MockElement('gel-lane-table-spacer')
  };
  const controller = gelLaneTableInternals.createLaneTableController({
    runtime,
    elements,
    safeText: (value) => String(value),
    deps: {}
  });

  controller.render();

  assert.equal(elements.gelLaneTableShell.hidden, false);
  assert.equal(elements.gelViewerStage.classList.contains('has-lane-table'), true);
  assert.match(elements.gelLaneTableShell.innerHTML, /gel-lane-table-grid-offsets/);
  assert.match(elements.gelLaneTableShell.innerHTML, /padding-left:16\.6667%;/);
  assert.match(elements.gelLaneTableShell.innerHTML, /padding-right:16\.6667%;/);
  assert.match(elements.gelLaneTableShell.innerHTML, /width:37\.5%;/);
  assert.match(elements.gelLaneTableShell.innerHTML, /width:31\.25%;/);
});

test('[EDGE] gel-analysis outermost lane dividers define gel edges without separate border tools', () => {
  const manualModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'gel', 'manual', 'manual-workflow.js'));
  const gelCanvas = new MockElement('gel-canvas');
  gelCanvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 100,
    height: 100
  });
  const runtime = {
    currentImage: {
      width: 100,
      height: 100,
      gray: new Float32Array(10000).fill(0.1)
    },
    cropperActive: false,
    currentReport: null,
    manualDividerConfirmed: false,
    manualOverrides: gelAnalysisInternals.normalizeManualOverrides({}),
    selectedViewerTool: 'dividers'
  };
  const elements = {
    gelCanvas,
    gelToolDividersBtn: new MockElement('gel-tool-dividers-btn'),
    gelManualNextBtn: new MockElement('gel-manual-next-btn'),
    gelOverrideStatus: new MockElement('gel-override-status')
  };
  const statuses = [];
  const controller = manualModule.createManualWorkflowController({
    runtime,
    elements,
    deps: {
      onRunAnalysis() {},
      renderCanvas() {},
      renderLaneTable() {},
      renderReport() {},
      setStatus: (message) => statuses.push(message)
    }
  });

  assert.equal(controller.getManualStep(), 'dividers');
  controller.onCanvasClick({ clientX: 60, clientY: 50 });
  assert.equal(runtime.manualOverrides.laneSegmentation.gelLeft, 60);
  assert.equal(runtime.manualOverrides.laneSegmentation.gelRight, null);

  controller.onCanvasClick({ clientX: 20, clientY: 50 });
  assert.equal(runtime.manualOverrides.laneSegmentation.gelLeft, 20);
  assert.equal(runtime.manualOverrides.laneSegmentation.gelRight, 60);
  // Array.from: the overrides come from a vm-loaded module, so a bare deepEqual
  // would compare prototypes across realms and fail on identical contents.
  assert.deepEqual(Array.from(runtime.manualOverrides.laneSegmentation.dividers), []);

  controller.onCanvasClick({ clientX: 80, clientY: 50 });
  assert.equal(runtime.manualOverrides.laneSegmentation.gelLeft, 20);
  assert.equal(runtime.manualOverrides.laneSegmentation.gelRight, 80);
  assert.deepEqual(Array.from(runtime.manualOverrides.laneSegmentation.dividers), [60]);

  controller.onManualNextStep();
  assert.equal(runtime.manualOverrides.laneSegmentation.dividerDone, true);
  assert.equal(runtime.selectedViewerTool, '');
  assert.equal(controller.getManualStep(), 'ladder');
  assert.match(statuses[statuses.length - 1], /dividers confirmed/i);
});

test('[EDGE] gel-analysis lane-by-lane band mode clears tools and records top and bottom per clicked lane', () => {
  const manualModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'gel', 'manual', 'manual-workflow.js'));
  const gelCanvas = new MockElement('gel-canvas');
  gelCanvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 100,
    height: 100
  });
  const runtime = {
    currentImage: {
      width: 100,
      height: 100,
      gray: new Float32Array(10000).fill(0.1)
    },
    cropperActive: false,
    currentReport: null,
    manualDividerConfirmed: false,
    manualOverrides: gelAnalysisInternals.normalizeManualOverrides({
      laneSegmentation: {
        gelLeft: 0,
        gelRight: 99,
        dividers: [50],
        dividerDone: false
      },
      ladderLane: 1,
      ladderBandsDone: true
    }),
    selectedViewerTool: 'dividers'
  };
  const elements = {
    gelCanvas,
    gelLaneBandModeBtn: new MockElement('gel-lane-band-mode-btn'),
    gelOverrideStatus: new MockElement('gel-override-status'),
    gelManualProgress: new MockElement('gel-manual-progress'),
    gelStepLeft: new MockElement('gel-step-left'),
    gelStepRight: new MockElement('gel-step-right'),
    gelStepDividers: new MockElement('gel-step-dividers'),
    gelStepLadder: new MockElement('gel-step-ladder'),
    gelStepLadderMw: new MockElement('gel-step-ladder-mw'),
    gelStepBandTop: new MockElement('gel-step-band-top'),
    gelStepBandBottom: new MockElement('gel-step-band-bottom'),
    gelStepQuantify: new MockElement('gel-step-quantify'),
    gelStepBands: new MockElement('gel-step-bands'),
    gelManualPrevBtn: new MockElement('gel-manual-prev-btn'),
    gelManualNextBtn: new MockElement('gel-manual-next-btn')
  };
  const statuses = [];
  let analysisRuns = 0;
  const controller = manualModule.createManualWorkflowController({
    runtime,
    elements,
    deps: {
      onRunAnalysis: () => {
        analysisRuns += 1;
      },
      renderCanvas() {},
      renderLaneTable() {},
      renderReport() {},
      setStatus: (message) => statuses.push(message)
    }
  });

  controller.onLaneBandModeToggle();
  assert.equal(runtime.manualOverrides.laneSegmentation.perLaneBandEnabled, true);
  assert.equal(runtime.manualOverrides.laneSegmentation.dividerDone, true);
  assert.equal(runtime.manualDividerConfirmed, true);
  assert.equal(runtime.selectedViewerTool, '');
  assert.equal(controller.getManualStep(), 'band-top');

  controller.onCanvasClick({ clientX: 25, clientY: 12 });
  assert.equal(controller.getManualStep(), 'band-bottom');
  assert.equal(JSON.stringify(runtime.manualOverrides.laneSegmentation.dividers), JSON.stringify([50]));
  assert.equal(JSON.stringify(runtime.manualOverrides.laneSegmentation.laneBandWindows), JSON.stringify([
    { laneIndex: 1, bandTop: 12, bandBottom: null }
  ]));

  controller.onCanvasClick({ clientX: 75, clientY: 22 });
  assert.match(statuses[statuses.length - 1], /lane 1/i);
  assert.equal(runtime.manualOverrides.laneSegmentation.laneBandWindows[0].bandBottom, null);

  controller.onCanvasClick({ clientX: 25, clientY: 22 });
  assert.equal(controller.getManualStep(), 'band-top');
  assert.equal(runtime.manualOverrides.laneSegmentation.laneBandWindows[0].bandBottom, 22);

  controller.onCanvasClick({ clientX: 75, clientY: 40 });
  controller.onCanvasClick({ clientX: 75, clientY: 55 });
  assert.equal(controller.getManualStep(), 'quantify');
  assert.equal(JSON.stringify(runtime.manualOverrides.laneSegmentation.laneBandWindows), JSON.stringify([
    { laneIndex: 1, bandTop: 12, bandBottom: 22 },
    { laneIndex: 2, bandTop: 40, bandBottom: 55 }
  ]));
  assert.equal(analysisRuns, 2);
});

test('[EDGE] gel-analysis stale per-lane mode bypasses unfinished divider manual step', () => {
  const manualModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'gel', 'manual', 'manual-workflow.js'));
  const gelCanvas = new MockElement('gel-canvas');
  gelCanvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 100,
    height: 100
  });
  const runtime = {
    currentImage: {
      width: 100,
      height: 100,
      gray: new Float32Array(10000).fill(0.1)
    },
    cropperActive: false,
    currentReport: null,
    manualDividerConfirmed: false,
    manualOverrides: gelAnalysisInternals.normalizeManualOverrides({
      laneSegmentation: {
        gelLeft: 0,
        gelRight: 99,
        dividers: [50],
        dividerDone: false,
        perLaneBandEnabled: true
      },
      ladderLane: 1,
      ladderBandsDone: true
    }),
    selectedViewerTool: ''
  };
  const elements = {
    gelCanvas,
    gelLaneBandModeBtn: new MockElement('gel-lane-band-mode-btn'),
    gelOverrideStatus: new MockElement('gel-override-status'),
    gelManualProgress: new MockElement('gel-manual-progress'),
    gelStepLeft: new MockElement('gel-step-left'),
    gelStepRight: new MockElement('gel-step-right'),
    gelStepDividers: new MockElement('gel-step-dividers'),
    gelStepLadder: new MockElement('gel-step-ladder'),
    gelStepLadderMw: new MockElement('gel-step-ladder-mw'),
    gelStepBandTop: new MockElement('gel-step-band-top'),
    gelStepBandBottom: new MockElement('gel-step-band-bottom'),
    gelStepQuantify: new MockElement('gel-step-quantify'),
    gelStepBands: new MockElement('gel-step-bands'),
    gelManualPrevBtn: new MockElement('gel-manual-prev-btn'),
    gelManualNextBtn: new MockElement('gel-manual-next-btn')
  };
  const controller = manualModule.createManualWorkflowController({
    runtime,
    elements,
    deps: {
      onRunAnalysis() {},
      renderCanvas() {},
      renderLaneTable() {},
      renderReport() {},
      setStatus() {}
    }
  });

  assert.equal(controller.getManualStep(), 'band-top');
  controller.onCanvasClick({ clientX: 25, clientY: 12 });

  assert.equal(JSON.stringify(runtime.manualOverrides.laneSegmentation.dividers), JSON.stringify([50]));
  assert.equal(JSON.stringify(runtime.manualOverrides.laneSegmentation.laneBandWindows), JSON.stringify([
    { laneIndex: 1, bandTop: 12, bandBottom: null }
  ]));
  assert.equal(controller.getManualStep(), 'band-bottom');
});

test('[EDGE] gel-analysis rendering keeps adjusted lane outlines visible in lane-by-lane band mode', () => {
  const renderingModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'gel', 'rendering', 'index.js'));
  const operations = [];
  let strokeStyle = '';
  const context = {
    set strokeStyle(value) {
      strokeStyle = value;
      operations.push({ type: 'strokeStyle', value });
    },
    get strokeStyle() {
      return strokeStyle;
    },
    set lineWidth(value) {
      operations.push({ type: 'lineWidth', value });
    },
    get lineWidth() {
      return 1;
    },
    set fillStyle(value) {
      operations.push({ type: 'fillStyle', value });
    },
    get fillStyle() {
      return '';
    },
    set font(value) {
      operations.push({ type: 'font', value });
    },
    get font() {
      return '';
    },
    save() {},
    restore() {},
    clearRect() {},
    putImageData() {},
    beginPath() {
      operations.push({ type: 'beginPath' });
    },
    moveTo(x, y) {
      operations.push({ type: 'moveTo', x, y });
    },
    lineTo(x, y) {
      operations.push({ type: 'lineTo', x, y });
    },
    closePath() {
      operations.push({ type: 'closePath' });
    },
    stroke() {
      operations.push({ type: 'stroke', strokeStyle });
    },
    strokeRect(x, y, width, height) {
      operations.push({ type: 'strokeRect', x, y, width, height, strokeStyle });
    },
    setLineDash(value) {
      operations.push({ type: 'setLineDash', value: value.slice() });
    },
    arc(x, y, radius) {
      operations.push({ type: 'arc', x, y, radius });
    },
    fill() {},
    fillText() {}
  };
  const gelCanvas = new MockElement('gel-canvas');
  gelCanvas.getContext = () => context;
  const runtime = {
    currentImage: {
      width: 100,
      height: 100,
      imageData: { tag: 'image-data' },
      gray: new Float32Array(10000).fill(0.1)
    },
    cropperActive: false,
    currentReport: null,
    manualOverrides: gelAnalysisInternals.normalizeManualOverrides({
      laneSegmentation: {
        gelLeft: 0,
        gelRight: 99,
        dividers: [50],
        dividerDone: true,
        perLaneBandEnabled: true,
        laneVertices: [{
          laneIndex: 1,
          topLeft: { x: 5, y: 0 },
          topRight: { x: 48, y: 0 },
          bottomRight: { x: 42, y: 99 },
          bottomLeft: { x: 0, y: 99 }
        }]
      }
    }),
    selectedViewerTool: ''
  };
  const controller = renderingModule.createRenderingController({
    runtime,
    elements: { gelCanvas },
    safeText: (value) => String(value),
    deps: {}
  });

  controller.renderCanvas();

  assert.equal(operations.some((item) => item.type === 'stroke' && item.strokeStyle === 'rgba(14, 165, 233, 0.95)'), true);
  assert.equal(operations.some((item) => item.type === 'moveTo' && item.x === 5.5 && item.y === 0.5), true);
  assert.equal(operations.some((item) => item.type === 'lineTo' && item.x === 42.5 && item.y === 99.5), true);
  assert.equal(operations.some((item) => item.type === 'arc'), false);
});

test('[EDGE] gel-analysis peak editor records curve baselines and vertical dividers lane by lane', () => {
  const renderingModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'gel', 'rendering', 'index.js'));
  const gray = new Float32Array(8 * 5);
  [0.05, 0.2, 0.6, 0.3, 0.1].forEach((value, row) => {
    for (let x = 0; x < 8; x += 1) {
      gray[(row * 8) + x] = value;
    }
  });
  const chart = new MockElement('gel-peak-editor-chart');
  chart.setAttribute = (name, value) => {
    chart[name] = value;
  };
  chart.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 920,
    height: 440
  });
  const runtime = {
    currentImage: {
      width: 8,
      height: 5,
      gray,
      imageData: { tag: 'image-data' }
    },
    currentReport: null,
    manualOverrides: gelAnalysisInternals.normalizeManualOverrides({
      laneSegmentation: {
        gelLeft: 0,
        gelRight: 7,
        dividers: [4],
        dividerDone: true
      }
    }),
    selectedLaneProfileLane: 1,
    selectedViewerTool: ''
  };
  const elements = {
    gelPeakEditorOverlay: new MockElement('gel-peak-editor-overlay'),
    gelPeakEditorLaneSelect: new MockElement('gel-peak-editor-lane-select'),
    gelPeakEditorBaselineModeBtn: new MockElement('gel-peak-editor-baseline-mode-btn'),
    gelPeakEditorDividerModeBtn: new MockElement('gel-peak-editor-divider-mode-btn'),
    gelPeakEditorChart: chart,
    gelPeakEditorSummary: new MockElement('gel-peak-editor-summary'),
    gelPeakEditorTable: new MockElement('gel-peak-editor-table')
  };
  const controller = renderingModule.createRenderingController({
    runtime,
    elements,
    safeText: (value) => String(value),
    deps: {}
  });

  controller.onPeakEditorOpen();
  assert.equal(elements.gelPeakEditorOverlay.hidden, false);
  assert.equal(elements.gelPeakEditorChart.innerHTML.includes('peak-editor-hover-dot'), false);

  controller.onPeakEditorChartMouseMove({ row: 2 });
  assert.equal(elements.gelPeakEditorChart.innerHTML.includes('peak-editor-hover-dot'), true);
  assert.equal(elements.gelPeakEditorChart.innerHTML.includes('peak-editor-hover-label'), true);
  controller.onPeakEditorChartMouseLeave();
  assert.equal(elements.gelPeakEditorChart.innerHTML.includes('peak-editor-hover-dot'), false);

  controller.onPeakEditorChartClick({ row: 0 });
  assert.equal(runtime.manualOverrides.peakIntegrations.length, 1);
  assert.equal(runtime.manualOverrides.peakIntegrations[0].right, null);

  controller.onPeakEditorChartClick({ row: 4 });
  assert.equal(runtime.manualOverrides.peakIntegrations[0].left.row, 0);
  assert.equal(runtime.manualOverrides.peakIntegrations[0].right.row, 4);

  controller.onPeakEditorModeSelected('divider');
  controller.onPeakEditorChartClick({ row: 2 });

  assert.equal(JSON.stringify(runtime.manualOverrides.peakIntegrations[0].dividers), JSON.stringify([2]));
  assert.equal(elements.gelPeakEditorTable.innerHTML.includes('<table class="gel-peak-table">'), true);
  assert.equal(elements.gelPeakEditorSummary.textContent.includes('1 baseline'), true);
});

test('[EDGE] gel-analysis peak editor maps cursor positions through rendered SVG width', () => {
  const renderingModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'gel', 'rendering', 'index.js'));
  const width = 8;
  const height = 101;
  const gray = new Float32Array(width * height);
  for (let row = 0; row < height; row += 1) {
    const value = 0.1 + (row / (height - 1));
    for (let x = 0; x < width; x += 1) {
      gray[(row * width) + x] = value;
    }
  }

  const chartRect = {
    left: 10,
    top: 20,
    width: 1000,
    height: 300
  };
  const chart = new MockElement('gel-peak-editor-chart');
  chart.setAttribute = (name, value) => {
    chart[name] = value;
  };
  chart.getAttribute = (name) => chart[name] || '';
  chart.getBoundingClientRect = () => chartRect;
  chart.createSVGPoint = () => {
    throw new Error('peak editor should use DOMRect mapping before SVG CTM fallback');
  };

  const runtime = {
    currentImage: {
      width,
      height,
      gray,
      imageData: { tag: 'image-data' }
    },
    currentReport: null,
    manualOverrides: gelAnalysisInternals.normalizeManualOverrides({
      laneSegmentation: {
        gelLeft: 0,
        gelRight: 7,
        dividers: [4],
        dividerDone: true
      }
    }),
    selectedLaneProfileLane: 1,
    selectedViewerTool: ''
  };
  const elements = {
    gelPeakEditorOverlay: new MockElement('gel-peak-editor-overlay'),
    gelPeakEditorLaneSelect: new MockElement('gel-peak-editor-lane-select'),
    gelPeakEditorBaselineModeBtn: new MockElement('gel-peak-editor-baseline-mode-btn'),
    gelPeakEditorDividerModeBtn: new MockElement('gel-peak-editor-divider-mode-btn'),
    gelPeakEditorChart: chart,
    gelPeakEditorSummary: new MockElement('gel-peak-editor-summary'),
    gelPeakEditorTable: new MockElement('gel-peak-editor-table')
  };
  const controller = renderingModule.createRenderingController({
    runtime,
    elements,
    safeText: (value) => String(value),
    deps: {}
  });

  const rowToClientX = (row) => {
    const svgWidth = 920;
    const plotLeft = 58;
    const plotRight = 884;
    const svgX = plotLeft + ((row / (height - 1)) * (plotRight - plotLeft));
    return chartRect.left + ((svgX / svgWidth) * chartRect.width);
  };
  const eventForRow = (row) => ({
    clientX: rowToClientX(row),
    clientY: chartRect.top + (chartRect.height / 2)
  });

  controller.onPeakEditorOpen();
  assert.equal(elements.gelPeakEditorChart.preserveAspectRatio, 'none');
  controller.onPeakEditorChartMouseMove(eventForRow(80));
  assert.equal(elements.gelPeakEditorChart.innerHTML.includes('>80</text>'), true);

  controller.onPeakEditorChartClick(eventForRow(10));
  controller.onPeakEditorChartClick(eventForRow(90));
  controller.onPeakEditorModeSelected('divider');
  controller.onPeakEditorChartClick(eventForRow(80));

  assert.equal(runtime.manualOverrides.peakIntegrations[0].left.row, 10);
  assert.equal(runtime.manualOverrides.peakIntegrations[0].right.row, 90);
  assert.equal(JSON.stringify(runtime.manualOverrides.peakIntegrations[0].dividers), JSON.stringify([80]));
});

test('[EDGE] gel-analysis peak editor profile preserves narrow neighboring peaks', () => {
  const renderingModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'gel', 'rendering', 'index.js'),
    {},
    ['computeLaneIntensityProfile']
  );
  const width = 5;
  const height = 80;
  const signal = new Float32Array(width * height);
  [40, 44].forEach((row) => {
    for (let x = 0; x < width; x += 1) {
      signal[(row * width) + x] = 1;
    }
  });

  const profile = renderingModule.computeLaneIntensityProfile({
    signal,
    width,
    height,
    lane: { xStart: 0, xEnd: width - 1 }
  });

  assert.equal(profile.values[40], 1);
  assert.equal(profile.values[44], 1);
  assert.equal(profile.values[42], 0);
});

test('[EDGE] gel-analysis right-click assigns ladder MW outside ladder step', () => {
  const promptCalls = [];
  const manualModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'gel', 'manual', 'manual-workflow.js'),
    {
      window: {
        prompt(message, defaultValue) {
          promptCalls.push({ message, defaultValue });
          return '75';
        }
      }
    }
  );
  const gelCanvas = new MockElement('gel-canvas');
  gelCanvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 100,
    height: 100
  });
  const runtime = {
    currentImage: {
      width: 100,
      height: 100,
      gray: new Float32Array(10000).fill(0.1)
    },
    cropperActive: false,
    currentReport: null,
    manualDividerConfirmed: true,
    manualOverrides: gelAnalysisInternals.normalizeManualOverrides({
      laneSegmentation: {
        gelLeft: 0,
        gelRight: 99,
        dividers: [50],
        dividerDone: true,
        bandTop: 10,
        bandBottom: 20
      },
      ladderLane: 1,
      ladderBands: [{ pixelY: 12, mw: 50 }],
      ladderBandsDone: true
    }),
    selectedViewerTool: ''
  };
  const elements = {
    gelCanvas,
    gelLaneBandModeBtn: new MockElement('gel-lane-band-mode-btn'),
    gelOverrideStatus: new MockElement('gel-override-status'),
    gelManualNextBtn: new MockElement('gel-manual-next-btn'),
    gelLadderBandMwInput: new MockElement('gel-ladder-band-mw')
  };
  elements.gelLadderBandMwInput.value = '50';
  let analysisRuns = 0;
  let canvasRenders = 0;
  const statuses = [];
  const controller = manualModule.createManualWorkflowController({
    runtime,
    elements,
    deps: {
      onRunAnalysis: () => {
        analysisRuns += 1;
      },
      renderCanvas: () => {
        canvasRenders += 1;
      },
      renderLaneTable() {},
      renderReport() {},
      setStatus: (message) => statuses.push(message)
    }
  });

  assert.equal(controller.getManualStep(), 'quantify');
  let prevented = false;
  controller.onCanvasContextMenu({
    clientX: 25,
    clientY: 30,
    preventDefault() {
      prevented = true;
    }
  });

  assert.equal(prevented, true);
  assert.equal(promptCalls.length, 1);
  assert.match(promptCalls[0].message, /row=30/);
  assert.equal(JSON.stringify(runtime.manualOverrides.ladderBands), JSON.stringify([
    { pixelY: 12, mw: 50 },
    { pixelY: 30, mw: 75 }
  ]));
  assert.equal(elements.gelLadderBandMwInput.value, '75');
  assert.equal(analysisRuns, 1);
  assert.equal(canvasRenders, 1);
  assert.match(statuses[statuses.length - 1], /MW=75/);
});

test('[EDGE] gel-analysis normalizes and scans tilted lane vertices', () => {
  const normalized = gelAnalysisInternals.normalizeLaneVertices([
    {
      lane: '2',
      vertices: [
        { x: '2.4', y: 0 },
        { x: 6, y: 0 },
        { x: 8, y: 9 },
        { x: 4, y: 9 }
      ]
    },
    { laneIndex: 0, topLeft: { x: 1, y: 1 } }
  ]);
  assert.equal(JSON.stringify(normalized), JSON.stringify([
    {
      laneIndex: 2,
      topLeft: { x: 2, y: 0 },
      topRight: { x: 6, y: 0 },
      bottomRight: { x: 8, y: 9 },
      bottomLeft: { x: 4, y: 9 }
    }
  ]));

  const lane = {
    xStart: 2,
    xEnd: 10,
    vertices: normalized[0]
  };
  assert.equal(JSON.stringify(gelAnalysisInternals.getLaneRowBounds(lane, 0, 20)), JSON.stringify({ xStart: 2, xEnd: 6 }));
  assert.equal(JSON.stringify(gelAnalysisInternals.getLaneRowBounds(lane, 4, 20)), JSON.stringify({ xStart: 3, xEnd: 6 }));
  assert.equal(JSON.stringify(gelAnalysisInternals.getLaneRowBounds(lane, 9, 20)), JSON.stringify({ xStart: 4, xEnd: 8 }));
  const rowSegment = gelAnalysisInternals.getLaneRowSegment(lane, 4, 10);
  const rowVector = {
    x: rowSegment.right.x - rowSegment.left.x,
    y: rowSegment.right.y - rowSegment.left.y
  };
  const laneAxis = {
    x: (normalized[0].bottomLeft.x - normalized[0].topLeft.x) + (normalized[0].bottomRight.x - normalized[0].topRight.x),
    y: (normalized[0].bottomLeft.y - normalized[0].topLeft.y) + (normalized[0].bottomRight.y - normalized[0].topRight.y)
  };
  assertClose((rowVector.x * laneAxis.x) + (rowVector.y * laneAxis.y), 0, 1e-6);
  assert.equal(Math.abs(rowSegment.left.y - rowSegment.right.y) > 0.1, true);
  assert.equal(gelAnalysisInternals.getLaneRectifiedWidth(lane), 5);
  assert.equal(gelAnalysisInternals.lanePointToRectifiedRow(lane, { x: 5, y: 4 }, 10), 4);
  assert.equal(gelAnalysisInternals.laneContainsPoint(lane, 5, 4, 20), true);
  assert.equal(gelAnalysisInternals.laneContainsPoint(lane, 9, 4, 20), false);
});

test('[EDGE] gel-analysis tilted lane vertices define target-band area in report', () => {
  const width = 20;
  const height = 20;
  const gray = new Float32Array(width * height).fill(0.05);
  const vertices = {
    laneIndex: 1,
    topLeft: { x: 3, y: 0 },
    topRight: { x: 7, y: 0 },
    bottomRight: { x: 11, y: 19 },
    bottomLeft: { x: 7, y: 19 }
  };
  const laneShape = {
    xStart: 3,
    xEnd: 11,
    vertices
  };
  const laneWidth = gelAnalysisInternals.getLaneRectifiedWidth(laneShape);
  for (let y = 8; y <= 12; y += 1) {
    const segment = gelAnalysisInternals.getLaneRowSegment(laneShape, y, height);
    for (let sampleIndex = 0; sampleIndex < laneWidth; sampleIndex += 1) {
      const fraction = laneWidth <= 1 ? 0.5 : sampleIndex / (laneWidth - 1);
      const x = Math.round(segment.left.x + ((segment.right.x - segment.left.x) * fraction));
      const sampleY = Math.round(segment.left.y + ((segment.right.y - segment.left.y) * fraction));
      gray[(sampleY * width) + x] = 0.95;
    }
  }

  const result = gelAnalysisInternals.analyzeGelImage({
    gray,
    imageName: 'tilted-lane.png',
    width,
    height,
    preprocessed: {
      cleanNormalized: gray,
      preprocessing: {
        grayscale: true,
        backend: 'test'
      }
    },
    params: {
      analysisType: 'western',
      ladderLane: 1,
      ladderStandards: [250, 150, 100],
      normalization: 'none',
      enhancement: {},
      manualOverrides: {
        laneSegmentation: {
          gelLeft: 0,
          gelRight: 19,
          dividers: [],
          dividerDone: true,
          bandTop: 8,
          bandBottom: 12,
          laneVertices: [vertices]
        },
        ladderLane: 1,
        ladderBandsDone: true
      }
    }
  });

  assert.equal(result.report.preprocessing.manualOverridesSummary.laneSegmentationLaneVertices, 1);
  assert.equal(result.report.lanes.length, 1);
  assert.equal(result.report.lanes[0].xStart, 3);
  assert.equal(result.report.lanes[0].xEnd, 11);
  assert.equal(JSON.stringify(result.report.lanes[0].vertices.topLeft), JSON.stringify({ x: 3, y: 0 }));
  assert.equal(result.report.lanes[0].targetBand.areaPx, laneWidth * 5);
});

test('[EDGE] gel-analysis lane vertex tool drag updates one lane quadrilateral', () => {
  const manualModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'gel', 'manual', 'manual-workflow.js'));
  const gelCanvas = new MockElement('gel-canvas');
  gelCanvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 100,
    height: 100
  });
  const runtime = {
    currentImage: {
      width: 100,
      height: 100,
      gray: new Float32Array(10000).fill(0.1)
    },
    cropperActive: false,
    currentReport: { lanes: [] },
    manualDividerConfirmed: true,
    manualOverrides: gelAnalysisInternals.normalizeManualOverrides({
      laneSegmentation: {
        gelLeft: 0,
        gelRight: 99,
        dividers: [50],
        dividerDone: true,
        bandTop: 10,
        bandBottom: 20
      },
      ladderLane: 1,
      ladderBandsDone: true
    }),
    selectedViewerTool: ''
  };
  const elements = {
    gelCanvas,
    gelToolLaneVerticesBtn: new MockElement('gel-tool-lane-vertices-btn'),
    gelLaneBandModeBtn: new MockElement('gel-lane-band-mode-btn'),
    gelOverrideStatus: new MockElement('gel-override-status'),
    gelManualProgress: new MockElement('gel-manual-progress'),
    gelStepLeft: new MockElement('gel-step-left'),
    gelStepRight: new MockElement('gel-step-right'),
    gelStepDividers: new MockElement('gel-step-dividers'),
    gelStepLadder: new MockElement('gel-step-ladder'),
    gelStepLadderMw: new MockElement('gel-step-ladder-mw'),
    gelStepBandTop: new MockElement('gel-step-band-top'),
    gelStepBandBottom: new MockElement('gel-step-band-bottom'),
    gelStepQuantify: new MockElement('gel-step-quantify'),
    gelStepBands: new MockElement('gel-step-bands'),
    gelManualPrevBtn: new MockElement('gel-manual-prev-btn'),
    gelManualNextBtn: new MockElement('gel-manual-next-btn')
  };
  let analysisRuns = 0;
  const controller = manualModule.createManualWorkflowController({
    runtime,
    elements,
    deps: {
      onRunAnalysis: () => {
        analysisRuns += 1;
      },
      renderCanvas() {},
      renderLaneTable() {},
      renderReport() {},
      setStatus() {}
    }
  });

  controller.onViewerToolSelected('lane-vertices');
  controller.onCanvasMouseDown({ clientX: 0, clientY: 0, preventDefault() {} });
  controller.onCanvasMouseMove({ clientX: 8, clientY: 4, preventDefault() {} });
  controller.onCanvasMouseUp({ clientX: 8, clientY: 4, preventDefault() {} });

  const laneVertices = runtime.manualOverrides.laneSegmentation.laneVertices;
  assert.equal(laneVertices.length, 1);
  assert.equal(laneVertices[0].laneIndex, 1);
  assert.equal(JSON.stringify(laneVertices[0].topLeft), JSON.stringify({ x: 8, y: 0 }));
  assert.equal(JSON.stringify(laneVertices[0].topRight), JSON.stringify({ x: 49, y: 0 }));
  assert.equal(runtime.currentReport, null);
  assert.equal(analysisRuns, 1);
});

test('[EDGE] gel-analysis lane vertex tool glues shared neighbor vertices', () => {
  const manualModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'gel', 'manual', 'manual-workflow.js'));
  const gelCanvas = new MockElement('gel-canvas');
  gelCanvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 100,
    height: 100
  });
  const runtime = {
    currentImage: {
      width: 100,
      height: 100,
      gray: new Float32Array(10000).fill(0.1)
    },
    cropperActive: false,
    currentReport: { lanes: [] },
    manualDividerConfirmed: true,
    manualOverrides: gelAnalysisInternals.normalizeManualOverrides({
      laneSegmentation: {
        gelLeft: 0,
        gelRight: 99,
        dividers: [50],
        dividerDone: true,
        bandTop: 10,
        bandBottom: 20
      },
      ladderLane: 1,
      ladderBandsDone: true
    }),
    selectedViewerTool: ''
  };
  const elements = {
    gelCanvas,
    gelToolLaneVerticesBtn: new MockElement('gel-tool-lane-vertices-btn'),
    gelLaneBandModeBtn: new MockElement('gel-lane-band-mode-btn'),
    gelOverrideStatus: new MockElement('gel-override-status'),
    gelManualProgress: new MockElement('gel-manual-progress'),
    gelStepLeft: new MockElement('gel-step-left'),
    gelStepRight: new MockElement('gel-step-right'),
    gelStepDividers: new MockElement('gel-step-dividers'),
    gelStepLadder: new MockElement('gel-step-ladder'),
    gelStepLadderMw: new MockElement('gel-step-ladder-mw'),
    gelStepBandTop: new MockElement('gel-step-band-top'),
    gelStepBandBottom: new MockElement('gel-step-band-bottom'),
    gelStepQuantify: new MockElement('gel-step-quantify'),
    gelStepBands: new MockElement('gel-step-bands'),
    gelManualPrevBtn: new MockElement('gel-manual-prev-btn'),
    gelManualNextBtn: new MockElement('gel-manual-next-btn')
  };
  const controller = manualModule.createManualWorkflowController({
    runtime,
    elements,
    deps: {
      onRunAnalysis() {},
      renderCanvas() {},
      renderLaneTable() {},
      renderReport() {},
      setStatus() {}
    }
  });

  controller.onViewerToolSelected('lane-vertices');
  controller.onCanvasMouseDown({ clientX: 50, clientY: 99, preventDefault() {} });
  controller.onCanvasMouseMove({ clientX: 45, clientY: 90, preventDefault() {} });
  controller.onCanvasMouseUp({ clientX: 45, clientY: 90, preventDefault() {} });

  const laneVertices = runtime.manualOverrides.laneSegmentation.laneVertices;
  const laneOne = laneVertices.find((item) => item.laneIndex === 1);
  const laneTwo = laneVertices.find((item) => item.laneIndex === 2);
  assert.equal(laneVertices.length, 2);
  assert.equal(JSON.stringify(laneOne.topRight), JSON.stringify({ x: 49, y: 0 }));
  assert.equal(JSON.stringify(laneTwo.topLeft), JSON.stringify({ x: 50, y: 0 }));
  assert.equal(JSON.stringify(laneOne.bottomRight), JSON.stringify({ x: 45, y: 99 }));
  assert.equal(JSON.stringify(laneTwo.bottomLeft), JSON.stringify({ x: 45, y: 99 }));
});

[
  [0, 0, 10, 0],
  [5, 0, 10, 5],
  [-1, 0, 10, 0],
  [11, 0, 10, 10],
  [3.3, 0, 4, 3.3],
  [NaN, 0, 4, NaN]
].forEach(([value, min, max, expected], idx) => {
  test(`[EDGE] gel-analysis clamp case ${idx + 1}`, () => {
    const result = gelAnalysisInternals.clamp(value, min, max);
    if (Number.isNaN(expected)) {
      assert.equal(Number.isNaN(result), true);
      return;
    }
    assert.equal(result, expected);
  });
});

[
  [1.23456, 2, 1.23],
  [1.23556, 2, 1.24],
  [-1.23556, 2, -1.24],
  [0, 4, 0],
  [Infinity, 2, null],
  [NaN, 2, null]
].forEach(([value, digits, expected], idx) => {
  test(`[EDGE] gel-analysis round case ${idx + 1}`, () => {
    assert.equal(gelAnalysisInternals.round(value, digits), expected);
  });
});

[
  [[], 0],
  [[1], 1],
  [[1, 2, 3], 2],
  [[-1, 1], 0]
].forEach(([values, expected], idx) => {
  test(`[EDGE] gel-analysis mean case ${idx + 1}`, () => {
    assertClose(gelAnalysisInternals.mean(values), expected, 1e-9);
  });
});

[
  [0.9, 'high'],
  [0.75, 'high'],
  [0.74, 'medium'],
  [0.5, 'medium'],
  [0.49, 'low'],
  [0, 'low']
].forEach(([score, expected], idx) => {
  test(`[EDGE] gel-analysis confidenceLabel case ${idx + 1}`, () => {
    assert.equal(gelAnalysisInternals.confidenceLabel(score), expected);
  });
});

test('[EDGE] gel-analysis createEmptyManualOverrides baseline shape', () => {
  const value = gelAnalysisInternals.createEmptyManualOverrides();
  assert.equal(JSON.stringify(Object.keys(value).sort()), JSON.stringify(['addedBands', 'ladderBands', 'ladderBandsDone', 'ladderLane', 'laneSegmentation', 'laneTable', 'peakIntegrations']));
  assert.equal(Array.isArray(value.laneSegmentation.dividers), true);
  assert.equal(value.laneSegmentation.dividers.length, 0);
  assert.equal(Array.isArray(value.peakIntegrations), true);
  assert.equal(value.peakIntegrations.length, 0);
  assert.equal(Array.isArray(value.laneTable.rows), true);
  assert.equal(value.laneTable.rows.length, 0);
});

[
  {
    raw: {
      laneSegmentation: {
        gelLeft: '10.9',
        gelRight: '100.3',
        dividers: [30, '30', 50, -3, 120, 50],
        dividerDone: 'yes',
        bandTop: '5',
        bandBottom: '20',
        perLaneBandEnabled: true,
        laneBandWindows: [
          { laneIndex: '2', bandTop: '15.9', bandBottom: '30.2' },
          { lane: '1', top: '8', bottom: '' },
          { laneIndex: '2', bandTop: '16', bandBottom: '31' }
        ]
      },
      addedBands: [{ laneIndex: '2', pixelY: '33.2' }, { laneIndex: -1, pixelY: 5 }],
      ladderLane: '3',
      ladderBands: [{ pixelY: 80.2, mw: 50 }, { pixelY: 10.2, mw: 150 }, { pixelY: 2, mw: 0 }],
      ladderBandsDone: 1,
      peakIntegrations: [
        {
          lane: '2',
          baselineLeft: { row: '40.9', value: '0.2' },
          baselineRight: { pixelY: '90.1', intensity: '0.3' },
          dividers: ['50', 50, '70.8', -1]
        },
        { laneIndex: 0, left: { row: 2, value: 1 } },
        { laneIndex: 1, left: { row: '', value: 1 } }
      ],
      laneTable: {
        rows: [
          { label: 'Samples', values: ['M', 'A', 42] },
          { label: 'Notes', values: [' strong ', null] }
        ]
      }
    },
    expectation: (value) => {
      assert.equal(value.laneSegmentation.gelLeft, 10);
      assert.equal(value.laneSegmentation.gelRight, 100);
      assert.equal(JSON.stringify(value.laneSegmentation.dividers), JSON.stringify([30, 50, 120]));
      assert.equal(value.laneSegmentation.perLaneBandEnabled, true);
      assert.equal(JSON.stringify(value.laneSegmentation.laneBandWindows), JSON.stringify([
        { laneIndex: 1, bandTop: 8, bandBottom: null },
        { laneIndex: 2, bandTop: 16, bandBottom: 31 }
      ]));
      assert.equal(value.addedBands.length, 2);
      assert.equal(value.ladderLane, 3);
      assert.equal(JSON.stringify(value.ladderBands.map((item) => item.mw)), JSON.stringify([150, 50]));
      assert.equal(value.ladderBandsDone, true);
      assert.equal(JSON.stringify(value.peakIntegrations), JSON.stringify([
        {
          laneIndex: 2,
          left: { row: 40, value: 0.2 },
          right: { row: 90, value: 0.3 },
          dividers: [50, 70]
        }
      ]));
      assert.equal(value.laneTable.rows.length, 2);
      assert.equal(value.laneTable.rows[0].label, 'Samples');
      assert.equal(JSON.stringify(value.laneTable.rows[0].values), JSON.stringify(['M', 'A', '42']));
    }
  },
  {
    raw: null,
    expectation: (value) => {
      assert.deepEqual(value, gelAnalysisInternals.createEmptyManualOverrides());
    }
  }
].forEach((scenario, idx) => {
  test(`[EDGE] gel-analysis normalizeManualOverrides case ${idx + 1}`, () => {
    const value = gelAnalysisInternals.normalizeManualOverrides(scenario.raw);
    scenario.expectation(value);
  });
});

test('[EDGE] gel-analysis peak integration area uses baseline and vertical dividers', () => {
  const renderingModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'gel', 'rendering', 'index.js'));
  const rows = renderingModule.calculatePeakIntegrationRows({
    values: [1, 2, 5, 4, 3],
    minValue: 1,
    maxValue: 5
  }, [
    {
      laneIndex: 2,
      left: { row: 0, value: 1 },
      right: { row: 4, value: 3 },
      dividers: [2]
    }
  ]);

  assert.equal(JSON.stringify(rows.map((row) => ({
    laneIndex: row.laneIndex,
    baselineIndex: row.baselineIndex,
    peakIndex: row.peakIndex,
    startRow: row.startRow,
    endRow: row.endRow,
    apexRow: row.apexRow,
    area: row.area
  }))), JSON.stringify([
    { laneIndex: 2, baselineIndex: 1, peakIndex: 1, startRow: 0, endRow: 2, apexRow: 2, area: 3.5 },
    { laneIndex: 2, baselineIndex: 1, peakIndex: 2, startRow: 3, endRow: 4, apexRow: 3, area: 1.5 }
  ]));
});

test('[EDGE] gel-analysis resolves target band windows by global or per-lane mode', () => {
  const global = gelAnalysisInternals.getTargetBandWindowForLane({
    bandTop: 6,
    bandBottom: 14,
    perLaneBandEnabled: false,
    laneBandWindows: [
      { laneIndex: 2, bandTop: 20, bandBottom: 28 }
    ]
  }, 2);
  assert.equal(JSON.stringify(global), JSON.stringify({
    laneIndex: 2,
    bandTop: 6,
    bandBottom: 14,
    perLane: false
  }));

  const perLane = gelAnalysisInternals.getTargetBandWindowForLane({
    bandTop: 6,
    bandBottom: 14,
    perLaneBandEnabled: true,
    laneBandWindows: [
      { laneIndex: 1, bandTop: 4, bandBottom: 8 },
      { laneIndex: 2, bandTop: 20, bandBottom: 28 }
    ]
  }, 2);
  assert.equal(JSON.stringify(perLane), JSON.stringify({
    laneIndex: 2,
    bandTop: 20,
    bandBottom: 28,
    perLane: true
  }));

  const missing = gelAnalysisInternals.getTargetBandWindowForLane({
    perLaneBandEnabled: true,
    laneBandWindows: [
      { laneIndex: 1, bandTop: 4, bandBottom: 8 }
    ]
  }, 2);
  assert.equal(missing, null);
});

test('[EDGE] gel-analysis manual per-lane target windows feed lane-specific report cells', () => {
  const width = 40;
  const height = 30;
  const gray = new Float32Array(width * height).fill(0.05);
  for (let y = 4; y <= 8; y += 1) {
    for (let x = 0; x < 20; x += 1) {
      gray[(y * width) + x] = 0.9;
    }
  }
  for (let y = 18; y <= 23; y += 1) {
    for (let x = 20; x < 40; x += 1) {
      gray[(y * width) + x] = 0.85;
    }
  }

  const result = gelAnalysisInternals.analyzeGelImage({
    gray,
    imageName: 'per-lane.png',
    width,
    height,
    preprocessed: {
      cleanNormalized: gray,
      preprocessing: {
        grayscale: true,
        backend: 'test'
      }
    },
    params: {
      analysisType: 'western',
      ladderLane: 1,
      ladderStandards: [250, 150, 100],
      normalization: 'none',
      enhancement: {},
      manualOverrides: {
        laneSegmentation: {
          gelLeft: 0,
          gelRight: 39,
          dividers: [20],
          dividerDone: true,
          perLaneBandEnabled: true,
          laneBandWindows: [
            { laneIndex: 1, bandTop: 4, bandBottom: 8 },
            { laneIndex: 2, bandTop: 18, bandBottom: 23 }
          ]
        },
        ladderLane: 1,
        ladderBandsDone: true
      }
    }
  });

  assert.equal(result.report.preprocessing.manualOverridesSummary.laneSegmentationBandMode, 'per-lane');
  assert.equal(result.report.preprocessing.manualOverridesSummary.laneSegmentationLaneBandWindows, 2);
  assert.equal(result.report.lanes.length, 2);
  assert.equal(result.report.lanes[0].targetBand.top, 4);
  assert.equal(result.report.lanes[0].targetBand.bottom, 8);
  assert.equal(result.report.lanes[1].targetBand.top, 18);
  assert.equal(result.report.lanes[1].targetBand.bottom, 23);
});

[
  [' file name ', 'fallback', 'file-name'],
  ['***', 'fallback', 'fallback'],
  ['a/b/c', 'fallback', 'a-b-c'],
  ['A__B', 'fallback', 'A__B'],
  ['', 'fallback', 'fallback']
].forEach(([raw, fallback, expected], idx) => {
  test(`[EDGE] gel-analysis safeFilePart case ${idx + 1}`, () => {
    assert.equal(gelAnalysisInternals.safeFilePart(raw, fallback), expected);
  });
});

[
  ['a,b', '"a,b"'],
  ['a"b', '"a""b"'],
  ['line\nbreak', '"line\nbreak"'],
  ['plain', 'plain'],
  [null, '']
].forEach(([value, expected], idx) => {
  test(`[EDGE] gel-analysis escapeCsv case ${idx + 1}`, () => {
    assert.equal(gelAnalysisInternals.escapeCsv(value), expected);
  });
});

[
  new Float32Array(100).fill(0),
  new Float32Array(100).fill(1),
  Float32Array.from({ length: 100 }, (_, i) => i / 99),
  Float32Array.from({ length: 100 }, (_, i) => (i % 2 ? 1 : 0))
].forEach((data, idx) => {
  test(`[EDGE] gel-analysis histogram percentile shape case ${idx + 1}`, () => {
    const { low, high } = gelAnalysisInternals.computeHistogramPercentiles(data, 2, 98);
    assert.equal(low >= 0 && low <= 1, true);
    assert.equal(high >= 0 && high <= 1, true);
    assert.equal(high >= low, true);
  });
});

[
  new Float32Array(32).fill(0.5),
  Float32Array.from({ length: 32 }, (_, i) => i / 31),
  Float32Array.from({ length: 32 }, (_, i) => ((i % 5) / 4))
].forEach((data, idx) => {
  test(`[EDGE] gel-analysis normalizeArrayRange bounds case ${idx + 1}`, () => {
    const out = gelAnalysisInternals.normalizeArrayRange(data);
    assert.equal(out.length, data.length);
    out.forEach((value) => {
      assert.equal(value >= 0 && value <= 1, true);
    });
  });
});

[
  0.01,
  0.1,
  0.5,
  1,
  2
].forEach((sigma, idx) => {
  test(`[EDGE] gel-analysis buildGaussianKernel case ${idx + 1}`, () => {
    const { kernel, radius } = gelAnalysisInternals.buildGaussianKernel(sigma);
    assert.equal(kernel.length, (radius * 2) + 1);
    const sum = [...kernel].reduce((acc, value) => acc + value, 0);
    assertClose(sum, 1, 1e-5);
  });
});

[
  { width: 4, height: 4, sigma: 1.2, value: 0.7 },
  { width: 5, height: 3, sigma: 0.8, value: 0.2 }
].forEach((scenario, idx) => {
  test(`[EDGE] gel-analysis gaussianBlur2d preserves constant field case ${idx + 1}`, () => {
    const data = new Float32Array(scenario.width * scenario.height).fill(scenario.value);
    const out = gelAnalysisInternals.gaussianBlur2d(data, scenario.width, scenario.height, scenario.sigma);
    out.forEach((value) => {
      assertClose(value, scenario.value, 1e-5);
    });
  });
});

[
  [[1, 2, 3], [2, 4, 6], 2, 0],
  [[1, 2, 3], [3, 2, 1], -1, 4],
  [[1], [2], null, null],
  [[1, 1, 1], [2, 3, 4], null, null]
].forEach(([xValues, yValues, slope, intercept], idx) => {
  test(`[EDGE] gel-analysis linearRegression case ${idx + 1}`, () => {
    const value = gelAnalysisInternals.linearRegression(xValues, yValues);
    if (slope === null) {
      assert.equal(value, null);
      return;
    }
    assertClose(value.slope, slope, 1e-9);
    assertClose(value.intercept, intercept, 1e-9);
    assert.equal(value.r2 >= 0 && value.r2 <= 1, true);
  });
});

test('[EDGE] gel-analysis buildCalibration supports manual ladder bands', () => {
  const result = gelAnalysisInternals.buildCalibration(
    [],
    1,
    [250, 150, 100],
    200,
    [
      { pixelY: 10, mw: 250 },
      { pixelY: 50, mw: 150 },
      { pixelY: 90, mw: 100 }
    ]
  );
  assert.equal(result.ok, true);
  assert.equal(result.manual, true);
  assert.equal(result.matchedPoints.length, 3);
});

test('[EDGE] gel-analysis buildCalibration auto-ladder fallback and failure modes', () => {
  const lanes = [
    {
      index: 0,
      bands: [
        { pixelY: 10 },
        { pixelY: 40 },
        { pixelY: 80 }
      ]
    }
  ];
  const ok = gelAnalysisInternals.buildCalibration(lanes, 1, [250, 150, 100], 200, []);
  assert.equal(ok.ok, true);
  assert.equal(ok.manual, false);

  const fail = gelAnalysisInternals.buildCalibration([], 1, [250, 150, 100], 200, []);
  assert.equal(fail.ok, false);
});

test('[EDGE] gel-analysis applyCalibrationToBands sets estimatedMw', () => {
  const lanes = [{ bands: [{ pixelY: 10 }, { pixelY: 50 }] }];
  gelAnalysisInternals.applyCalibrationToBands(lanes, { ok: true, slope: -1, intercept: 2 }, 100);
  assert.equal(Number.isFinite(lanes[0].bands[0].estimatedMw), true);
  assert.equal(Number.isFinite(lanes[0].bands[1].estimatedMw), true);
});

[
  'max',
  'total-lane'
].forEach((mode, idx) => {
  test(`[EDGE] gel-analysis applyNormalization mode case ${idx + 1}`, () => {
    const lanes = [{
      bands: [
        { rawIntensity: 2 },
        { rawIntensity: 6 }
      ]
    }];
    gelAnalysisInternals.applyNormalization(lanes, mode);
    lanes[0].bands.forEach((band) => {
      assert.equal(band.normalizedIntensity === null || (band.normalizedIntensity >= 0 && band.normalizedIntensity <= 1), true);
    });
  });
});

[
  {
    hasMwCalibration: true,
    lanes: [
      { index: 0, imageHeight: 100, bands: [{ bandIndex: 0, estimatedMw: 100, pixelY: 20 }] },
      { index: 1, imageHeight: 100, bands: [{ bandIndex: 0, estimatedMw: 103, pixelY: 30 }] }
    ],
    minGroups: 1
  },
  {
    hasMwCalibration: false,
    lanes: [
      { index: 0, imageHeight: 100, bands: [{ bandIndex: 0, estimatedMw: null, pixelY: 20 }] },
      { index: 1, imageHeight: 100, bands: [{ bandIndex: 0, estimatedMw: null, pixelY: 22 }] },
      { index: 2, imageHeight: 100, bands: [{ bandIndex: 0, estimatedMw: null, pixelY: 80 }] }
    ],
    minGroups: 2
  }
].forEach((scenario, idx) => {
  test(`[EDGE] gel-analysis clusterBandsAcrossLanes case ${idx + 1}`, () => {
    const groups = gelAnalysisInternals.clusterBandsAcrossLanes(scenario.lanes, scenario.hasMwCalibration);
    assert.equal(groups.length >= scenario.minGroups, true);
    scenario.lanes.forEach((lane) => {
      lane.bands.forEach((band) => {
        assert.equal(typeof band.groupId, 'string');
        assert.equal(typeof band.groupLabel, 'string');
      });
    });
  });
});

test('[EDGE] gel-analysis computeLaneConfidence handles empty and populated lanes', () => {
  const empty = gelAnalysisInternals.computeLaneConfidence({ bands: [] }, 0.5);
  assertClose(empty.score, 0.25, 1e-9);
  assert.equal(empty.label, 'low');

  const populated = gelAnalysisInternals.computeLaneConfidence({
    bands: [
      { sharpness: 0.2, snr: 10, saturationFraction: 0.01 },
      { sharpness: 0.15, snr: 8, saturationFraction: 0.02 }
    ]
  }, 0.95);
  assert.equal(populated.score > 0.5, true);
  assert.equal(['medium', 'high'].includes(populated.label), true);
});

[
  {
    analysisType: 'sds-page',
    lane: { bands: [{ rawIntensity: 10 }, { rawIntensity: 9 }], rowActivityFraction: 0.5 },
    expectWarning: true
  },
  {
    analysisType: 'western',
    lane: { bands: [{ rawIntensity: 10, normalizedIntensity: 0.1 }], rowActivityFraction: 0.5 },
    expectWarning: true
  },
  {
    analysisType: 'agarose',
    lane: { bands: [{ rawIntensity: 10 }], rowActivityFraction: 0.1 },
    expectWarning: false
  }
].forEach((scenario, idx) => {
  test(`[EDGE] gel-analysis interpretLane case ${idx + 1}`, () => {
    const result = gelAnalysisInternals.interpretLane(scenario);
    assert.equal(Array.isArray(result.notes), true);
    assert.equal(Array.isArray(result.warnings), true);
    assert.equal(result.warnings.length > 0, scenario.expectWarning);
  });
});
  }
};
