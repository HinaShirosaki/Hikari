import { printPdfBytes } from '../../print/index.js';
import { splitConcentrationValue } from '../concentration-utils.js';
import { plateText, plateUi } from '../localization.js';
import { buildAllWells, layoutToMap } from '../plate-model.js';
import { sanitizeFilePart } from '../shared.js';
import { buildLayoutCsv } from './csv.js';
import { createPlateLayoutPdf, renderPlateLayout } from './export-figure.js';
import { AXIS_FIELDS, getVisibleConditionFields } from '../axis-fields.js';

function getExportWells(definition, layout, unit) {
  const map = layoutToMap(layout);
  return buildAllWells(definition).map((well) => {
    const mapping = map[well.well] || {};
    const { sampleId = '', concentration = '' } = mapping;
    const parts = splitConcentrationValue(concentration);
    return {
      ...well,
      ...mapping,
      sampleId,
      concentration: unit && parts?.unit === '' ? `${concentration} ${unit}` : concentration
    };
  });
}

function downloadLayout(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function exportPlateLayout(format, {
  assayName, definition, layout, axisFields, concentrationUnit, setCsvStatus
}) {
  try {
    const wells = getExportWells(definition, layout, concentrationUnit);
    const conditionFields = getVisibleConditionFields(axisFields, layout);
    const fileName = `${sanitizeFilePart(assayName, 'assay')}-${definition.value}well-layout.${format}`;
    let blob;
    if (format === 'csv') {
      blob = new Blob([buildLayoutCsv(wells, axisFields, conditionFields)], { type: 'text/csv;charset=utf-8;' });
    } else {
      const title = String(assayName || '').trim() || plateText('export.title');
      const subtitle = plateText('export.axes', {
        count: definition.value,
        row: plateText(AXIS_FIELDS[axisFields.row].label),
        column: plateText(AXIS_FIELDS[axisFields.column].label)
      });
      const plate = { title, subtitle, definition, wells, conditionFields };
      if (format === 'png') {
        const canvas = renderPlateLayout(plate, { scale: wells.length > 384 ? 1 : 2 });
        blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        canvas.width = 0;
      } else {
        const pdf = createPlateLayoutPdf(plate);
        if (format === 'print') {
          if (!printPdfBytes(pdf.output('arraybuffer'), { title })) {
            throw new Error('Could not start printing the plate layout');
          }
          return;
        }
        blob = pdf.output('blob');
      }
    }
    if (!blob) {
      throw new Error('Could not encode plate layout');
    }
    downloadLayout(blob, fileName);
    setCsvStatus(plateUi('status.layoutDownloadStarted', {
      count: definition.value,
      format: format.toUpperCase()
    }));
  } catch (error) {
    console.error('Plate layout export failed:', error);
    setCsvStatus(plateUi('status.layoutExportFailed'), true);
  }
}
