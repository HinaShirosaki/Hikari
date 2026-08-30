import { clamp } from './numeric.js';
import { LANE_VERTEX_KEYS, normalizeVertexPoint } from './lane-vertices.js';

// The geometry of a quadrilateral lane: its axis, how wide it is at a given row,
// and how a point on the image maps onto the rectified lane.
export function getLaneVertexArray(lane) {
  const vertices = lane?.vertices || lane;
  return LANE_VERTEX_KEYS
    .map((key) => normalizeVertexPoint(vertices?.[key]))
    .filter(Boolean);
}

function distanceBetweenPoints(a, b) {
  if (!a || !b) {
    return 0;
  }
  const dx = Number(b.x) - Number(a.x);
  const dy = Number(b.y) - Number(a.y);
  return Math.sqrt((dx * dx) + (dy * dy));
}

function interpolatePoint(start, end, fraction) {
  const t = Math.min(1, Math.max(0, Number(fraction) || 0));
  return {
    x: start.x + ((end.x - start.x) * t),
    y: start.y + ((end.y - start.y) * t)
  };
}

function subtractPoints(a, b) {
  return {
    x: Number(a?.x) - Number(b?.x),
    y: Number(a?.y) - Number(b?.y)
  };
}

function dotPoints(a, b) {
  return (a.x * b.x) + (a.y * b.y);
}

function crossPoints(a, b) {
  return (a.x * b.y) - (a.y * b.x);
}

function normalizeVector(vector) {
  const length = Math.sqrt((vector.x * vector.x) + (vector.y * vector.y));
  if (!Number.isFinite(length) || length <= 1e-9) {
    return null;
  }
  return {
    x: vector.x / length,
    y: vector.y / length
  };
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2
  };
}

function getLaneAxisGeometry(vertices) {
  if (!Array.isArray(vertices) || vertices.length < 4) {
    return null;
  }

  const topCenter = midpoint(vertices[0], vertices[1]);
  const bottomCenter = midpoint(vertices[3], vertices[2]);
  const leftAxis = normalizeVector(subtractPoints(vertices[3], vertices[0]));
  const rightAxis = normalizeVector(subtractPoints(vertices[2], vertices[1]));
  const centerAxis = normalizeVector(subtractPoints(bottomCenter, topCenter));
  let axis = null;
  if (leftAxis && rightAxis) {
    axis = normalizeVector({
      x: leftAxis.x + rightAxis.x,
      y: leftAxis.y + rightAxis.y
    });
  }
  axis = axis || leftAxis || rightAxis || centerAxis;
  if (!axis) {
    return null;
  }

  let across = normalizeVector({ x: -axis.y, y: axis.x });
  const topEdge = subtractPoints(vertices[1], vertices[0]);
  if (across && dotPoints(across, topEdge) < 0) {
    across = { x: -across.x, y: -across.y };
  }
  if (!across) {
    return null;
  }

  return {
    axis,
    across,
    topCenter,
    bottomCenter
  };
}

function projectEdgeWidth(start, end, across) {
  return Math.abs(dotPoints(subtractPoints(end, start), across));
}

function addLineIntersection(intersections, center, direction, distance) {
  if (!Number.isFinite(distance)) {
    return;
  }
  intersections.push({
    distance,
    point: {
      x: center.x + (direction.x * distance),
      y: center.y + (direction.y * distance)
    }
  });
}

function getLinePolygonIntersections(center, direction, vertices) {
  const intersections = [];
  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];
    const edge = subtractPoints(end, start);
    const fromCenter = subtractPoints(start, center);
    const denominator = crossPoints(direction, edge);

    if (Math.abs(denominator) <= 1e-9) {
      if (Math.abs(crossPoints(fromCenter, direction)) <= 1e-6) {
        addLineIntersection(intersections, center, direction, dotPoints(subtractPoints(start, center), direction));
        addLineIntersection(intersections, center, direction, dotPoints(subtractPoints(end, center), direction));
      }
      continue;
    }

    const lineDistance = crossPoints(fromCenter, edge) / denominator;
    const edgeFraction = crossPoints(fromCenter, direction) / denominator;
    if (edgeFraction >= -1e-6 && edgeFraction <= 1 + 1e-6) {
      addLineIntersection(intersections, center, direction, lineDistance);
    }
  }

  return intersections
    .sort((a, b) => a.distance - b.distance)
    .filter((entry, index, all) => index === 0 || Math.abs(entry.distance - all[index - 1].distance) > 1e-5);
}

export function getLaneRectifiedHeight(_lane, fallbackHeight = 1) {
  return Math.max(1, Math.floor(Number(fallbackHeight) || 1));
}

export function getLaneRectifiedWidth(lane) {
  const vertices = getLaneVertexArray(lane);
  if (vertices.length >= 4) {
    const geometry = getLaneAxisGeometry(vertices);
    const topWidth = geometry
      ? projectEdgeWidth(vertices[0], vertices[1], geometry.across)
      : distanceBetweenPoints(vertices[0], vertices[1]);
    const bottomWidth = geometry
      ? projectEdgeWidth(vertices[3], vertices[2], geometry.across)
      : distanceBetweenPoints(vertices[3], vertices[2]);
    return Math.max(1, Math.round(((topWidth + bottomWidth) / 2) + 1));
  }
  const xStart = Math.max(0, Math.floor(Number(lane?.xStart) || 0));
  const xEnd = Math.max(xStart, Math.floor(Number(lane?.xEnd) || xStart));
  return Math.max(1, xEnd - xStart + 1);
}

export function getLaneRowSegment(lane, rowY, imageHeight = null) {
  const rectifiedHeight = getLaneRectifiedHeight(lane, imageHeight);
  const safeRow = clamp(Math.round(Number(rowY) || 0), 0, rectifiedHeight - 1);
  const t = rectifiedHeight <= 1 ? 0 : safeRow / (rectifiedHeight - 1);
  const vertices = getLaneVertexArray(lane);
  if (vertices.length >= 4) {
    const geometry = getLaneAxisGeometry(vertices);
    if (geometry) {
      const center = interpolatePoint(geometry.topCenter, geometry.bottomCenter, t);
      const intersections = getLinePolygonIntersections(center, geometry.across, vertices);
      if (intersections.length >= 2) {
        return {
          row: safeRow,
          t,
          left: intersections[0].point,
          right: intersections[intersections.length - 1].point
        };
      }
    }
    return {
      row: safeRow,
      t,
      left: interpolatePoint(vertices[0], vertices[3], t),
      right: interpolatePoint(vertices[1], vertices[2], t)
    };
  }
  const xStart = Math.max(0, Math.floor(Number(lane?.xStart) || 0));
  const xEnd = Math.max(xStart, Math.floor(Number(lane?.xEnd) || xStart));
  return {
    row: safeRow,
    t,
    left: { x: xStart, y: safeRow },
    right: { x: xEnd, y: safeRow }
  };
}

export function getLaneRowBounds(lane, rowY, width = Number.POSITIVE_INFINITY) {
  const vertices = getLaneVertexArray(lane);
  if (vertices.length < 4) {
    const xStart = Math.max(0, Math.floor(Number(lane?.xStart) || 0));
    const xEnd = Math.max(xStart, Math.floor(Number(lane?.xEnd) || xStart));
    return { xStart, xEnd };
  }

  const scanY = Math.round(Number(rowY));
  if (!Number.isFinite(scanY)) {
    return null;
  }

  const intersections = [];
  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];
    if (start.y === end.y) {
      continue;
    }
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    if (scanY < minY || scanY > maxY) {
      continue;
    }
    const t = (scanY - start.y) / (end.y - start.y);
    if (t < 0 || t > 1) {
      continue;
    }
    intersections.push(start.x + ((end.x - start.x) * t));
  }

  const unique = intersections
    .sort((a, b) => a - b)
    .filter((value, index, all) => index === 0 || Math.abs(value - all[index - 1]) > 0.001);
  if (unique.length < 2) {
    return null;
  }

  const maxX = Number.isFinite(width) ? Math.max(0, Math.floor(width) - 1) : Number.POSITIVE_INFINITY;
  const xStart = Math.max(0, Math.min(maxX, Math.ceil(unique[0])));
  const xEnd = Math.max(0, Math.min(maxX, Math.floor(unique[unique.length - 1])));
  return xEnd >= xStart ? { xStart, xEnd } : null;
}

export function laneContainsPoint(lane, x, y, width = Number.POSITIVE_INFINITY) {
  const vertices = getLaneVertexArray(lane);
  if (vertices.length < 4) {
    const bounds = getLaneRowBounds(lane, y, width);
    return Boolean(bounds && x >= bounds.xStart && x <= bounds.xEnd);
  }
  let inside = false;
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index, index += 1) {
    const current = vertices[index];
    const last = vertices[previous];
    const crosses = ((current.y > y) !== (last.y > y))
      && (x < (((last.x - current.x) * (y - current.y)) / ((last.y - current.y) || 1e-9)) + current.x);
    if (crosses) {
      inside = !inside;
    }
  }
  return inside;
}

export function lanePointToRectifiedRow(lane, point, imageHeight = null) {
  if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
    return null;
  }
  const rectifiedHeight = getLaneRectifiedHeight(lane, imageHeight);
  const vertices = getLaneVertexArray(lane);
  if (vertices.length < 4) {
    return clamp(Math.round(Number(point.y)), 0, rectifiedHeight - 1);
  }

  const topCenter = {
    x: (vertices[0].x + vertices[1].x) / 2,
    y: (vertices[0].y + vertices[1].y) / 2
  };
  const bottomCenter = {
    x: (vertices[3].x + vertices[2].x) / 2,
    y: (vertices[3].y + vertices[2].y) / 2
  };
  const axis = {
    x: bottomCenter.x - topCenter.x,
    y: bottomCenter.y - topCenter.y
  };
  const axisLengthSq = (axis.x * axis.x) + (axis.y * axis.y);
  if (axisLengthSq <= 1e-9) {
    return clamp(Math.round(Number(point.y)), 0, rectifiedHeight - 1);
  }
  const t = (((Number(point.x) - topCenter.x) * axis.x) + ((Number(point.y) - topCenter.y) * axis.y)) / axisLengthSq;
  return clamp(Math.round(t * (rectifiedHeight - 1)), 0, rectifiedHeight - 1);
}
