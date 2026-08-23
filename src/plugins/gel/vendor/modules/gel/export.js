import { escapeCsv } from './shared.js';

export function createBandsCsv(report) {
  const lines = [
    [
      'lane',
      'band',
      'measurement_mode',
      'top_px',
      'bottom_px',
      'area_px',
      'estimated_mw_kda',
      'band_signal_sum',
      'background_mean',
      'background_std',
      'corrected_intensity',
      'raw_intensity',
      'normalized_intensity',
      'snr',
      'sharpness',
      'saturation_fraction',
      'manual_band',
      'manual_mw',
      'band_group',
      'lane_target_band_intensity',
      'lane_total_band_intensity',
      'lane_confidence',
      'lane_confidence_label'
    ].join(',')
  ];

  (report.lanes || []).forEach((lane) => {
    if (!lane.bands?.length) {
      lines.push([
        lane.laneIndex,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        lane.targetBandIntensity ?? '',
        lane.totalBandIntensity ?? '',
        lane.confidence?.score ?? '',
        lane.confidence?.label ?? ''
      ].map(escapeCsv).join(','));
      return;
    }

    lane.bands.forEach((band) => {
      lines.push([
        lane.laneIndex,
        band.bandIndex,
        band.measurementMode || '',
        band.top,
        band.bottom,
        band.areaPx ?? '',
        band.estimatedMw ?? '',
        band.bandSignalSum ?? '',
        band.backgroundMean ?? '',
        band.backgroundStd ?? '',
        band.correctedIntensity ?? '',
        band.rawIntensity ?? '',
        band.normalizedIntensity ?? '',
        band.snr ?? '',
        band.sharpness ?? '',
        band.saturationFraction ?? '',
        band.manual ? 'yes' : 'no',
        band.manualMw ? 'yes' : 'no',
        band.groupLabel || '',
        lane.targetBandIntensity ?? '',
        lane.totalBandIntensity ?? '',
        lane.confidence?.score ?? '',
        lane.confidence?.label ?? ''
      ].map(escapeCsv).join(','));
    });
  });

  return `${lines.join('\n')}\n`;
}

export async function downloadTextFile({ content, fileName, mimeType }) {
  if (typeof window !== 'undefined' && typeof window.hikariApi?.exportTextFile === 'function') {
    return window.hikariApi.exportTextFile({ content, fileName, mimeType });
  }
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return { saved: true, fileName };
}

export async function downloadDataUrlFile({ dataUrl, fileName }) {
  const match = String(dataUrl || '').match(/^data:[^;,]+;base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) {
    throw new Error('The generated image data is invalid.');
  }
  if (typeof window !== 'undefined' && typeof window.hikariApi?.exportBinaryFile === 'function') {
    return window.hikariApi.exportBinaryFile({ dataBase64: match[1], fileName });
  }
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  return { saved: true, fileName };
}

function bytesToBase64(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const chunks = [];
  for (let offset = 0; offset < source.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...source.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(''));
}

export async function downloadBinaryFile({ bytes, fileName, mimeType = 'application/octet-stream' }) {
  if (!bytes?.length) {
    throw new Error('The generated file is empty.');
  }
  if (typeof window !== 'undefined' && typeof window.hikariApi?.exportBinaryFile === 'function') {
    return window.hikariApi.exportBinaryFile({ dataBase64: bytesToBase64(bytes), fileName });
  }
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return { saved: true, fileName };
}
