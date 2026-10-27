import { LADDER_PRESETS } from '../constants.js';
import { getLaneRowSegment } from '../shared.js';

// Export only measured/marked ladder positions, never positions inferred from
// a selected preset or an extrapolated calibration curve.
export function buildLadderLabels({ manualOverrides, ladderPreset, sourceTop = 0,
  sourceHeight, sourceImageHeight = sourceTop + sourceHeight, imageHeight = sourceHeight, fontSize = 18,
  measureText = text => text.length * fontSize * .58 } = {}) {
  const group = LADDER_PRESETS.find(preset => preset.id === ladderPreset)?.group || '';
  const unit = group.includes('(bp)') ? 'bp' : group.includes('(nt)') ? 'nt' : 'kDa';
  const vertices = manualOverrides?.laneSegmentation?.laneVertices
    ?.find(lane => lane.laneIndex === manualOverrides.ladderLane);
  const markers = (manualOverrides?.ladderBands || [])
    .filter(band => Number.isFinite(band.pixelY) && Number.isFinite(band.mw) && band.mw > 0)
    .map(band => {
      const segment = vertices ? getLaneRowSegment(vertices, band.pixelY, sourceImageHeight) : null;
      return { ...band, pixelY: segment ? (segment.left.y + segment.right.y) / 2 : band.pixelY };
    })
    .filter(band => Number.isFinite(band.pixelY)
      && band.pixelY >= sourceTop && band.pixelY < sourceTop + sourceHeight)
    .slice().sort((a, b) => a.pixelY - b.pixelY);
  if (!markers.length) return { width: 0, height: imageHeight, imageTop: 0, labels: [], fontSize };
  const lineHeight = fontSize * 1.35;
  const height = Math.max(imageHeight, markers.length * lineHeight);
  const imageTop = (height - imageHeight) / 2;
  const labels = markers.map(band => ({ text: `${Number(band.mw.toPrecision(6))} ${unit}`,
    markerY: imageTop + (band.pixelY + .5 - sourceTop) / sourceHeight * imageHeight }));
  // Move crowded text, keeping each leader attached to its exact image row.
  labels.forEach((label, index) => {
    label.y = Math.max(lineHeight / 2, label.markerY, index ? labels[index - 1].y + lineHeight : 0);
  });
  for (let index = labels.length - 1; index >= 0; index--) {
    labels[index].y = Math.min(labels[index].y, height - lineHeight / 2,
      index < labels.length - 1 ? labels[index + 1].y - lineHeight : Infinity);
  }
  const width = Math.ceil(Math.max(...labels.map(label => measureText(label.text))) + 24);
  return { width, height, imageTop, fontSize, labels };
}

export function drawLadderLabels(context, annotation, left, top) {
  if (!annotation?.labels.length) return;
  context.save();
  context.fillStyle = '#fff';
  context.fillRect(left, top, annotation.width, annotation.height);
  context.font = `${annotation.fontSize}px Arial, Helvetica, sans-serif`;
  context.fillStyle = '#000'; context.strokeStyle = '#000'; context.lineWidth = 1;
  context.textAlign = 'right'; context.textBaseline = 'middle';
  for (const label of annotation.labels) {
    context.fillText(label.text, left + annotation.width - 18, top + label.y);
    context.beginPath();
    context.moveTo(left + annotation.width - 14, top + label.y);
    context.lineTo(left + annotation.width - 8, top + label.markerY);
    context.lineTo(left + annotation.width, top + label.markerY);
    context.stroke();
  }
  context.restore();
}

export function addLadderLabelsToSlide(slide, annotation, left, top, scale) {
  if (!annotation?.labels.length) return;
  for (const label of annotation.labels) {
    slide.addText(label.text, { x: left, y: top + (label.y - annotation.fontSize * .7) * scale,
      w: (annotation.width - 18) * scale, h: annotation.fontSize * 1.4 * scale,
      fontFace: 'Arial', fontSize: annotation.fontSize * scale * 72, color: '000000',
      align: 'right', valign: 'mid', margin: 0, breakLine: false, objectName: `Ladder label ${label.text}` });
    slide.addShape('line', { x: left + (annotation.width - 14) * scale,
      y: top + Math.min(label.y, label.markerY) * scale,
      w: 6 * scale, h: Math.abs(label.markerY - label.y) * scale, flipV: label.markerY < label.y,
      line: { color: '000000', width: .75 }, objectName: `Ladder leader ${label.text}` });
    slide.addShape('line', { x: left + (annotation.width - 8) * scale, y: top + label.markerY * scale,
      w: 8 * scale, h: 0, line: { color: '000000', width: .75 }, objectName: `Ladder tick ${label.text}` });
  }
}
