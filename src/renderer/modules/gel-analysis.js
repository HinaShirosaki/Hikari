import * as gelAnalysisCoreModule from './gel/analysis-core.js';
import * as gelImageProcessingModule from './gel/image-processing.js';
import * as gelIndexModule from './gel/index.js';
import * as gelSharedModule from './gel/shared.js';

export function initGelAnalysis(options) {
  return gelIndexModule.initGelAnalysis(options);
}

export function selectViewerBaseImageData(currentImage, preprocessed = null) {
  return gelIndexModule.selectViewerBaseImageData(currentImage, preprocessed);
}

export function analyzeGelImage(options) {
  return gelAnalysisCoreModule.analyzeGelImage(options);
}

export function clamp(value, min, max) {
  return gelSharedModule.clamp(value, min, max);
}

export function round(value, digits = 4) {
  return gelSharedModule.round(value, digits);
}

export function mean(values) {
  return gelSharedModule.mean(values);
}

export function confidenceLabel(score) {
  return gelSharedModule.confidenceLabel(score);
}

export function createEmptyManualOverrides() {
  return gelSharedModule.createEmptyManualOverrides();
}

export function normalizeLaneBandWindows(raw) {
  return gelSharedModule.normalizeLaneBandWindows(raw);
}

export function normalizeLaneVertices(raw) {
  return gelSharedModule.normalizeLaneVertices(raw);
}

export function getLaneRowBounds(lane, rowY, width = Number.POSITIVE_INFINITY) {
  return gelSharedModule.getLaneRowBounds(lane, rowY, width);
}

export function getLaneRowSegment(lane, rowY, imageHeight = null) {
  return gelSharedModule.getLaneRowSegment(lane, rowY, imageHeight);
}

export function getLaneRectifiedWidth(lane) {
  return gelSharedModule.getLaneRectifiedWidth(lane);
}

export function lanePointToRectifiedRow(lane, point, imageHeight = null) {
  return gelSharedModule.lanePointToRectifiedRow(lane, point, imageHeight);
}

export function laneContainsPoint(lane, x, y, width = Number.POSITIVE_INFINITY) {
  return gelSharedModule.laneContainsPoint(lane, x, y, width);
}

export function getTargetBandWindowForLane(laneSegmentation, laneIndex) {
  return gelSharedModule.getTargetBandWindowForLane(laneSegmentation, laneIndex);
}

export function isPerLaneBandMode(laneSegmentation) {
  return gelSharedModule.isPerLaneBandMode(laneSegmentation);
}

export function normalizeManualOverrides(raw) {
  return gelSharedModule.normalizeManualOverrides(raw);
}

export function safeFilePart(raw, fallback) {
  return gelSharedModule.safeFilePart(raw, fallback);
}

export function escapeCsv(value) {
  return gelSharedModule.escapeCsv(value);
}

export function computeHistogramPercentiles(data, lowPercentile = 2, highPercentile = 98) {
  return gelImageProcessingModule.computeHistogramPercentiles(data, lowPercentile, highPercentile);
}

export function normalizeArrayRange(data) {
  return gelImageProcessingModule.normalizeArrayRange(data);
}

export function buildGaussianKernel(sigma) {
  return gelImageProcessingModule.buildGaussianKernel(sigma);
}

export function gaussianBlur2d(data, width, height, sigma) {
  return gelImageProcessingModule.gaussianBlur2d(data, width, height, sigma);
}

export function linearRegression(xValues, yValues) {
  return gelAnalysisCoreModule.linearRegression(xValues, yValues);
}

export function buildCalibration(lanes, ladderLaneIndex, ladderStandards, imageHeight, ladderBands = []) {
  return gelAnalysisCoreModule.buildCalibration(
    lanes,
    ladderLaneIndex,
    ladderStandards,
    imageHeight,
    ladderBands
  );
}

export function applyCalibrationToBands(lanes, calibration, imageHeight) {
  return gelAnalysisCoreModule.applyCalibrationToBands(lanes, calibration, imageHeight);
}

export function applyNormalization(lanes, normalizationMode) {
  return gelAnalysisCoreModule.applyNormalization(lanes, normalizationMode);
}

export function clusterBandsAcrossLanes(lanes, hasMwCalibration) {
  return gelAnalysisCoreModule.clusterBandsAcrossLanes(lanes, hasMwCalibration);
}

export function computeLaneConfidence(lane, calibrationR2) {
  return gelAnalysisCoreModule.computeLaneConfidence(lane, calibrationR2);
}

export function interpretLane(options) {
  return gelAnalysisCoreModule.interpretLane(options);
}
