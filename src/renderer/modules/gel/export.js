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

export function downloadTextFile({ content, fileName, mimeType }) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
