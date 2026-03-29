// Converts Enana experiment records into a compact JSON payload tailored for LLM context.
// The mapper intentionally caps large arrays to keep prompts small and predictable.

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function trimText(value, maxLength = 5000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function toFiniteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const text = String(value ?? '').trim();
  if (!text) {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapNotebookRun(entry) {
  const notebookState = String(entry?.notebookState || '').trim().toLowerCase() === 'planned'
    ? 'planned'
    : 'executed';
  return {
    id: String(entry?.id || ''),
    project_id: String(entry?.projectId || ''),
    protocol_id: String(entry?.protocolId || ''),
    protocol_name: trimText(entry?.protocolName, 180),
    workflow_id: trimText(entry?.agentDraftMeta?.workflowId, 120),
    notebook_state: notebookState,
    executed_at: trimText(entry?.executedAt, 80),
    agent_draft_status: trimText(entry?.agentDraftStatus, 80),
    proposal_id: trimText(entry?.agentDraftMeta?.proposalId, 160),
    result: trimText(entry?.result || entry?.body, 900),
    updated_at: String(entry?.updatedAt || entry?.createdAt || '')
  };
}

function summarizeAssayLayout(wellLayout) {
  const items = asArray(wellLayout);
  const sampleIds = new Set();
  const concentrations = new Set();

  items.forEach((item) => {
    const sampleId = trimText(item?.sampleId, 120);
    const concentration = trimText(item?.concentration, 80);
    if (sampleId) {
      sampleIds.add(sampleId);
    }
    if (concentration) {
      concentrations.add(concentration);
    }
  });

  return {
    mapped_well_count: items.length,
    unique_sample_count: sampleIds.size,
    unique_concentration_count: concentrations.size,
    preview: items.slice(0, 12).map((item) => ({
      well: trimText(item?.well, 12),
      sample_id: trimText(item?.sampleId, 120),
      concentration: trimText(item?.concentration, 80)
    }))
  };
}

function summarizeAssayResults(resultValues) {
  const entries = Object.entries(resultValues && typeof resultValues === 'object' ? resultValues : {});
  const numericValues = entries
    .map(([, value]) => toFiniteNumber(value))
    .filter((value) => Number.isFinite(value));
  const numericMin = numericValues.length ? Math.min(...numericValues) : null;
  const numericMax = numericValues.length ? Math.max(...numericValues) : null;
  const numericMean = numericValues.length
    ? numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length
    : null;

  return {
    result_well_count: entries.length,
    numeric_count: numericValues.length,
    min: numericMin,
    max: numericMax,
    mean: numericMean,
    preview: entries.slice(0, 12).map(([well, value]) => ({
      well: trimText(well, 12),
      value: trimText(value, 120)
    }))
  };
}

function summarizeGelManualOverrides(analysis) {
  const reportSummary = analysis?.report?.preprocessing?.manualOverridesSummary;
  if (reportSummary && typeof reportSummary === 'object') {
    return {
      lane_segmentation_left: Number.isFinite(reportSummary.laneSegmentationLeft)
        ? reportSummary.laneSegmentationLeft
        : null,
      lane_segmentation_right: Number.isFinite(reportSummary.laneSegmentationRight)
        ? reportSummary.laneSegmentationRight
        : null,
      lane_segmentation_dividers: Number.isFinite(reportSummary.laneSegmentationDividers)
        ? reportSummary.laneSegmentationDividers
        : 0,
      lane_segmentation_band_top: Number.isFinite(reportSummary.laneSegmentationBandTop)
        ? reportSummary.laneSegmentationBandTop
        : null,
      lane_segmentation_band_bottom: Number.isFinite(reportSummary.laneSegmentationBandBottom)
        ? reportSummary.laneSegmentationBandBottom
        : null,
      added_bands: Number.isFinite(reportSummary.addedBands) ? reportSummary.addedBands : 0,
      ladder_lane_override: Number.isFinite(reportSummary.ladderLaneOverride)
        ? reportSummary.ladderLaneOverride
        : null,
      ladder_bands: Number.isFinite(reportSummary.ladderBands) ? reportSummary.ladderBands : 0,
      ladder_bands_done: Boolean(reportSummary.ladderBandsDone)
    };
  }

  const manualOverrides = analysis?.manualOverrides && typeof analysis.manualOverrides === 'object'
    ? analysis.manualOverrides
    : {};
  const laneSegmentation = manualOverrides.laneSegmentation && typeof manualOverrides.laneSegmentation === 'object'
    ? manualOverrides.laneSegmentation
    : {};

  return {
    lane_segmentation_left: Number.isFinite(laneSegmentation.gelLeft) ? laneSegmentation.gelLeft : null,
    lane_segmentation_right: Number.isFinite(laneSegmentation.gelRight) ? laneSegmentation.gelRight : null,
    lane_segmentation_dividers: asArray(laneSegmentation.dividers).length,
    lane_segmentation_band_top: Number.isFinite(laneSegmentation.bandTop) ? laneSegmentation.bandTop : null,
    lane_segmentation_band_bottom: Number.isFinite(laneSegmentation.bandBottom) ? laneSegmentation.bandBottom : null,
    added_bands: asArray(manualOverrides.addedBands).length,
    ladder_lane_override: Number.isFinite(manualOverrides.ladderLane) ? manualOverrides.ladderLane : null,
    ladder_bands: asArray(manualOverrides.ladderBands).length,
    ladder_bands_done: Boolean(manualOverrides.ladderBandsDone)
  };
}

function mapAssayRun(assay) {
  return {
    id: String(assay?.id || ''),
    assay_number: trimText(assay?.assayNumber, 60),
    name: trimText(assay?.name, 180),
    project_id: String(assay?.projectId || ''),
    project_name: trimText(assay?.projectName, 160),
    notebook_entry_id: String(assay?.notebookEntryId || ''),
    notebook_entry_protocol_name: trimText(assay?.notebookEntryProtocolName, 180),
    plate: {
      type: trimText(assay?.plateType, 20),
      label: trimText(assay?.plateLabel, 40),
      rows: toFiniteNumber(assay?.plateRows),
      columns: toFiniteNumber(assay?.plateColumns),
      well_count: toFiniteNumber(assay?.wellCount)
    },
    axis: {
      sample_axis: trimText(assay?.sampleAxis, 20),
      concentration_axis: trimText(assay?.concentrationAxis, 20),
      sample_values: asArray(assay?.sampleAxisValues).slice(0, 12).map((value) => trimText(value, 80)).filter(Boolean),
      concentration_values: asArray(assay?.concentrationAxisValues).slice(0, 12).map((value) => trimText(value, 80)).filter(Boolean)
    },
    layout_summary: summarizeAssayLayout(assay?.wellLayout),
    result_summary: summarizeAssayResults(assay?.resultValues),
    notes: trimText(assay?.notes, 600),
    updated_at: String(assay?.updatedAt || '')
  };
}

function mapGelRun(analysis) {
  const report = analysis?.report && typeof analysis.report === 'object' ? analysis.report : {};
  const lanes = asArray(report.lanes);
  const bandCount = lanes.reduce((sum, lane) => sum + asArray(lane?.bands).length, 0);
  const warnings = asArray(report.warnings).slice(0, 10).map((warning) => trimText(warning, 220)).filter(Boolean);
  const calibration = report.calibration && typeof report.calibration === 'object' ? report.calibration : {};

  return {
    id: String(analysis?.id || ''),
    name: trimText(analysis?.name, 180),
    project_id: String(analysis?.projectId || ''),
    project_name: trimText(analysis?.projectName, 160),
    notebook_entry_id: String(analysis?.notebookEntryId || ''),
    notebook_entry_protocol_name: trimText(analysis?.notebookEntryProtocolName, 180),
    analysis_type: trimText(analysis?.analysisType, 40),
    image_name: trimText(analysis?.imageName || report?.image?.name, 220),
    updated_at: String(analysis?.updatedAt || ''),
    confidence: {
      score: toFiniteNumber(report?.confidence?.score),
      label: trimText(report?.confidence?.label, 80)
    },
    calibration: {
      ok: calibration?.ok === true,
      r2: toFiniteNumber(calibration?.r2),
      ladder_lane: toFiniteNumber(calibration?.ladderLane),
      reason: trimText(calibration?.reason, 220)
    },
    lane_count: lanes.length,
    band_count: bandCount,
    band_group_count: asArray(report.bandGroups).length,
    warnings,
    manual_override_summary: summarizeGelManualOverrides(analysis)
  };
}

export function mapExperimentDataToLlmJson(state, projectId = '') {
  const targetProjectId = String(projectId || '');
  const matchesProject = (item) => !targetProjectId || String(item?.projectId || '') === targetProjectId;

  const notebookRuns = asArray(state?.notebookEntries)
    .filter((entry) => matchesProject(entry))
    .slice(-120)
    .map(mapNotebookRun);

  const assayRuns = asArray(state?.assays)
    .filter((assay) => matchesProject(assay))
    .sort((a, b) => Date.parse(b?.updatedAt || '') - Date.parse(a?.updatedAt || ''))
    .slice(0, 80)
    .map(mapAssayRun);

  const gelRuns = asArray(state?.gelAnalyses)
    .filter((analysis) => matchesProject(analysis))
    .sort((a, b) => Date.parse(b?.updatedAt || '') - Date.parse(a?.updatedAt || ''))
    .slice(0, 80)
    .map(mapGelRun);

  return {
    schema_name: 'enana_experiment_json',
    schema_version: '1.0',
    generated_utc: new Date().toISOString(),
    notebook_runs: notebookRuns,
    assay_runs: assayRuns,
    gel_runs: gelRuns
  };
}
