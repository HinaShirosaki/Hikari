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
  assert.equal(JSON.stringify(Object.keys(value).sort()), JSON.stringify(['addedBands', 'ladderBands', 'ladderBandsDone', 'ladderLane', 'laneSegmentation', 'laneTable']));
  assert.equal(Array.isArray(value.laneSegmentation.dividers), true);
  assert.equal(value.laneSegmentation.dividers.length, 0);
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
        bandBottom: '20'
      },
      addedBands: [{ laneIndex: '2', pixelY: '33.2' }, { laneIndex: -1, pixelY: 5 }],
      ladderLane: '3',
      ladderBands: [{ pixelY: 80.2, mw: 50 }, { pixelY: 10.2, mw: 150 }, { pixelY: 2, mw: 0 }],
      ladderBandsDone: 1,
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
      assert.equal(value.addedBands.length, 2);
      assert.equal(value.ladderLane, 3);
      assert.equal(JSON.stringify(value.ladderBands.map((item) => item.mw)), JSON.stringify([150, 50]));
      assert.equal(value.ladderBandsDone, true);
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
