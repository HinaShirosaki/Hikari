import {
  clamp,
  getLaneVertexArray,
  getLaneVerticesForLane,
  isPerLaneBandMode,
  laneContainsPoint,
  normalizeLaneBandWindows,
  normalizeLaneVertices,
  normalizeManualOverrides
} from '../shared.js';
import { GLUED_LANE_VERTEX, LANE_VERTEX_KEYS } from './lane-constants.js';

// Editing the shape of a lane: dragging one of its four corners (and the glued
// corner of its neighbour), and the per-lane band window drawn inside it.

function createManualLaneShapes({
  runtime,
  deps,
  clearCanvasInteractionState,
  getLaneBandProgress,
  getSegmentationLanes,
  renderOverrideStatus,
  updateLaneSegmentation
} = {}) {
  function findLaneVertexTarget(point) {
    const lanes = getSegmentationLanes();
    if (!lanes.length || !runtime.currentImage) {
      return null;
    }
    const handleRadius = Math.max(8, Math.round(Math.min(runtime.currentImage.width, runtime.currentImage.height) / 50));
    const containingLane = lanes.find((lane) =>
      laneContainsPoint(lane, point.x, point.y, runtime.currentImage.width)
    );
    let best = null;
    lanes.forEach((lane) => {
      const laneIndex = lane.index + 1;
      const points = getLaneVertexArray(lane);
      points.forEach((vertex, vertexIndex) => {
        const dx = vertex.x - point.x;
        const dy = vertex.y - point.y;
        const distance = Math.sqrt((dx * dx) + (dy * dy));
        if (!best || distance < best.distance) {
          best = {
            laneIndex,
            lane,
            vertexKey: LANE_VERTEX_KEYS[vertexIndex],
            distance
          };
        }
      });
    });

    if (best && best.distance <= handleRadius) {
      return best;
    }
    if (containingLane) {
      const laneIndex = containingLane.index + 1;
      const points = getLaneVertexArray(containingLane);
      return points.reduce((closest, vertex, vertexIndex) => {
        const dx = vertex.x - point.x;
        const dy = vertex.y - point.y;
        const distance = Math.sqrt((dx * dx) + (dy * dy));
        if (!closest || distance < closest.distance) {
          return {
            laneIndex,
            lane: containingLane,
            vertexKey: LANE_VERTEX_KEYS[vertexIndex],
            distance
          };
        }
        return closest;
      }, null);
    }
    return null;
  }

  function updateLaneVertex(laneIndex, vertexKey, point) {
    if (!runtime.currentImage || !LANE_VERTEX_KEYS.includes(vertexKey)) {
      return false;
    }
    const lanes = getSegmentationLanes();
    const laneByIndex = new Map(lanes.map((item) => [item.index + 1, item]));
    if (!laneByIndex.has(laneIndex)) {
      return false;
    }
    const normalized = normalizeManualOverrides(runtime.manualOverrides);
    const maxVertexY = Math.max(0, runtime.currentImage.height - 1);
    const getLockedVertexY = (targetVertexKey) => targetVertexKey.startsWith('bottom') ? maxVertexY : 0;
    const pointOnImage = {
      x: clamp(Math.round(point.x), 0, runtime.currentImage.width - 1),
      y: getLockedVertexY(vertexKey)
    };
    const lockVertexRows = (vertices) => ({
      topLeft: { ...vertices.topLeft, y: getLockedVertexY('topLeft') },
      topRight: { ...vertices.topRight, y: getLockedVertexY('topRight') },
      bottomRight: { ...vertices.bottomRight, y: getLockedVertexY('bottomRight') },
      bottomLeft: { ...vertices.bottomLeft, y: getLockedVertexY('bottomLeft') }
    });
    const verticesByLane = new Map(
      normalizeLaneVertices(normalized.laneSegmentation?.laneVertices)
        .map((item) => [item.laneIndex, item])
    );
    const writeVertex = (targetLaneIndex, targetVertexKey, targetPoint) => {
      const targetLane = laneByIndex.get(targetLaneIndex);
      if (!targetLane) {
        return false;
      }
      const currentVertices = verticesByLane.get(targetLaneIndex) || getLaneVerticesForLane(
        normalized.laneSegmentation,
        targetLaneIndex,
        targetLane,
        runtime.currentImage.width,
        runtime.currentImage.height
      );
      const rowLockedVertices = lockVertexRows(currentVertices);
      verticesByLane.set(targetLaneIndex, {
        laneIndex: targetLaneIndex,
        ...rowLockedVertices,
        [targetVertexKey]: {
          x: targetPoint.x,
          y: getLockedVertexY(targetVertexKey)
        }
      });
      return true;
    };
    writeVertex(laneIndex, vertexKey, pointOnImage);
    const glued = GLUED_LANE_VERTEX[vertexKey];
    if (glued) {
      writeVertex(laneIndex + glued.laneOffset, glued.vertexKey, pointOnImage);
    }
    const laneVertices = [...verticesByLane.values()]
      .sort((a, b) => a.laneIndex - b.laneIndex);
    updateLaneSegmentation({
      laneVertices,
      quantifyConfirmed: false
    });
    runtime.manualOverrides = {
      ...normalizeManualOverrides(runtime.manualOverrides),
      addedBands: []
    };
    runtime.currentReport = null;
    return true;
  }

  function updateLaneVertexFromPoint(point, target = null) {
    const nextTarget = target || findLaneVertexTarget(point);
    if (!nextTarget) {
      deps.setStatus('Set lane dividers first, then click near a lane corner to adjust tilt.');
      return null;
    }
    const changed = updateLaneVertex(nextTarget.laneIndex, nextTarget.vertexKey, point);
    return changed ? nextTarget : null;
  }

  function upsertLaneBandWindow(laneIndex, patch) {
    const normalized = normalizeManualOverrides(runtime.manualOverrides);
    const windows = normalizeLaneBandWindows(normalized.laneSegmentation?.laneBandWindows);
    const existing = windows.find((window) => window.laneIndex === laneIndex) || {
      laneIndex,
      bandTop: null,
      bandBottom: null
    };
    const nextWindow = {
      ...existing,
      ...patch,
      laneIndex
    };
    updateLaneSegmentation({
      laneBandWindows: [
        ...windows.filter((window) => window.laneIndex !== laneIndex),
        nextWindow
      ],
      quantifyConfirmed: false
    });
  }

  function setLaneBandMode(enabled) {
    const normalized = normalizeManualOverrides(runtime.manualOverrides);
    clearCanvasInteractionState();
    const lanesReady = Boolean(enabled) && getSegmentationLanes(normalized).length > 0;
    if (lanesReady) {
      runtime.manualDividerConfirmed = true;
    }
    updateLaneSegmentation({
      perLaneBandEnabled: Boolean(enabled),
      dividerDone: lanesReady ? true : normalized.laneSegmentation?.dividerDone,
      quantifyConfirmed: false
    });
    runtime.manualOverrides = {
      ...normalizeManualOverrides(runtime.manualOverrides),
      addedBands: []
    };
    runtime.currentReport = null;
    renderOverrideStatus();
    deps.renderCanvas();
    deps.renderReport();
    const nextMode = isPerLaneBandMode(runtime.manualOverrides.laneSegmentation);
    if (nextMode) {
      const progress = getLaneBandProgress();
      deps.setStatus(progress.totalLanes
        ? `Lane-by-lane target band enabled. Click the top line in lane ${progress.missingCompleteLaneIndex || 1}.`
        : 'Lane-by-lane target band enabled. Finish lane dividers before setting target bands.');
      return;
    }
    deps.setStatus('Lane-by-lane target band disabled. Top and bottom lines will apply to every lane.');
    if (
      runtime.currentImage
      && Number.isFinite(normalized.laneSegmentation?.bandTop)
      && Number.isFinite(normalized.laneSegmentation?.bandBottom)
    ) {
      deps.onRunAnalysis();
    }
  }

  function onLaneBandModeToggle() {
    setLaneBandMode(!isPerLaneBandMode(runtime.manualOverrides?.laneSegmentation));
  }

  return {
    onLaneBandModeToggle,
    updateLaneVertexFromPoint,
    upsertLaneBandWindow
  };
}

export { createManualLaneShapes };
