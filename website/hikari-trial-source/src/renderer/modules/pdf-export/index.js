import { resolveNotebookResultTablesValues } from '../../lib/notebook-table-formulas.js';
import { normalizeNotebookToolCalculations } from '../../lib/notebook-tool-calculations.js';
import {
  normalizeNotebookPdfSettings,
  resolveNotebookPdfMargins
} from '../../lib/notebook-pdf-settings.js';
import { showTransientNotice } from '../../lib/notify.js';
import {
  safeValue,
  flowText,
  formatTimestamp,
  ensureSpace,
  font,
  splitWrappedLines
} from './doc-context.js';
import { BODY_FONT_SIZE, LINE_HEIGHT } from './constants.js';
import {
  createContext,
  writePageHeader,
  finishAndSave
} from './page-chrome.js';
import {
  writeHeading,
  writeParagraph,
  writeNumberedItem,
  writeKeyValue,
  writeBulletLines,
  writeEditorialMaterials,
  writeMinorHeading
} from './text-blocks.js';
import {
  writeSimpleTable,
  writeNotebookResultTable,
  writeNotebookToolCalculationTable
} from './tables.js';
import {
  notebookEntryMeta,
  notebookStateLabel,
  formatGelAnalysisTypeLabel,
  formatAssayAnalysisMethodLabel,
  hasSerialDilutionContent,
  renderStepText
} from './labels.js';
import {
  writeImageFigure,
  resolveAssayDefinition,
  estimateAssayPlotHeight,
  renderAssayPlot
} from './figures.js';
import { loadHikariPdfIconDataUrl } from './branding.js';

// PDF export for protocols, notebook pages, project page bundles and assay
// definitions, drawn with jsPDF.
// Writers share one ctx (see page-chrome createContext) holding the doc and a
// running y cursor in points; each writer calls ensureSpace() before drawing so
// content breaks onto a new page instead of running off the bottom. Footers
// ("Page n of N") are drawn last in finishAndSave, once the page count is known.
export function exportProtocolPdf(protocol, { print = false } = {}) {
  if (!protocol) {
    return false;
  }

  const name = safeValue(protocol.name, 'Untitled Protocol');
  const steps = Array.isArray(protocol.steps) ? protocol.steps : [];
  const ctx = createContext({
    title: name,
    eyebrow: 'Protocol',
    footerLabel: `Protocol · ${name}`,
    meta: [
      { label: 'Steps', value: String(steps.length) },
      { label: 'Materials', value: String(Array.isArray(protocol.materials) ? protocol.materials.length : 0) },
      { label: 'Created', value: formatTimestamp(protocol.createdAt) },
      { label: 'Updated', value: formatTimestamp(protocol.updatedAt) }
    ],
    orientation: 'p',
    format: 'letter',
    margin: 72,
    visualStyle: 'editorial'
  });
  if (!ctx) {
    return false;
  }

  writeHeading(ctx, 'Purpose');
  writeParagraph(ctx, safeValue(flowText(protocol.purpose)));

  writeHeading(ctx, 'Materials');
  writeEditorialMaterials(ctx, protocol.materials);

  writeHeading(ctx, 'Steps');
  if (!steps.length) {
    writeParagraph(ctx, '-');
  } else {
    steps.forEach((step, index) => {
      writeNumberedItem(ctx, index + 1, renderStepText(step, null));
    });
  }

  writeHeading(ctx, 'Troubleshooting');
  writeParagraph(ctx, safeValue(flowText(protocol.troubleshooting)));

  finishAndSave(ctx, `protocol-${protocol.name || protocol.id || 'export'}`, { print });
  return true;
}

async function writeNotebookNotesAndResults(ctx, entry, resultFileImages) {
  const resultTables = resolveNotebookResultTablesValues(entry.resultTables, entry.resultTable);
  font(ctx, 'normal');
  ctx.doc.setFontSize(BODY_FONT_SIZE);
  const resultLineCount = splitWrappedLines(ctx.doc, safeValue(entry.result), ctx.maxWidth).length;
  ensureSpace(ctx, 48 + Math.min(resultLineCount, 3) * LINE_HEIGHT);
  writeHeading(ctx, 'Notes and results');
  writeParagraph(ctx, safeValue(entry.result));
  const toolCalculations = normalizeNotebookToolCalculations(entry.toolCalculations);
  if (toolCalculations.length) {
    writeMinorHeading(ctx, toolCalculations.length === 1 ? 'Tool Calculation' : 'Tool Calculations');
    toolCalculations.forEach((calculation) => {
      if (calculation.table) {
        ensureSpace(ctx, 85);
        writeMinorHeading(ctx, calculation.title);
        writeNotebookToolCalculationTable(ctx, calculation.table);
      } else {
        writeParagraph(ctx, `${calculation.title}: ${safeValue(calculation.result || calculation.summary)}`);
      }
      if (calculation.formula && !calculation.table) {
        writeParagraph(ctx, `Formula: ${calculation.formula}`);
      }
    });
  }
  if (resultTables.length) {
    ensureSpace(ctx, 85);
    writeMinorHeading(ctx, resultTables.length === 1 ? 'Result Table' : 'Result Tables');
    resultTables.forEach((table, index) => {
      if (resultTables.length > 1) {
        ensureSpace(ctx, 85);
        writeMinorHeading(ctx, `Table ${index + 1}`);
      }
      writeNotebookResultTable(ctx, table);
    });
  }
  const resultFileNames = Array.isArray(entry.resultFiles) ? entry.resultFiles : [];
  const attachedImages = Array.isArray(resultFileImages) ? resultFileImages : [];
  if (resultFileNames.length || attachedImages.length) {
    writeMinorHeading(ctx, 'Result Files');
  }
  if (resultFileNames.length) {
    writeBulletLines(ctx, resultFileNames);
  }
  for (const image of attachedImages) {
    if (!String(image?.dataUrl || '').trim()) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await writeImageFigure(ctx, image.dataUrl, {
      caption: safeValue(image.name, 'Attached image'),
      maxHeight: 320
    });
  }
}

async function writeNotebookEntryBody(ctx, {
  entry,
  protocol,
  linkedGel = null,
  linkedGelPreviewImage = '',
  linkedAssay = null,
  linkedAssayPlotImage = '',
  resultFileImages = []
}) {
  writeHeading(ctx, 'Protocol steps');
  const steps = Array.isArray(protocol?.steps) ? protocol.steps : [];
  if (!steps.length) {
    writeParagraph(ctx, 'No protocol steps available for this entry.');
  } else {
    steps.forEach((step, index) => {
      writeNumberedItem(ctx, index + 1, renderStepText(step, entry.values || {}));
    });
  }

  await writeNotebookNotesAndResults(ctx, entry, resultFileImages);

  if (linkedGel || linkedAssay) {
    ensureSpace(ctx, linkedAssay && !linkedGel
      ? 100 + estimateAssayPlotHeight(ctx, resolveAssayDefinition(linkedAssay))
      : 85);
    writeHeading(ctx, 'Linked Results');

    if (linkedGel) {
      writeMinorHeading(ctx, 'Gel');
      writeParagraph(
        ctx,
        `${safeValue(linkedGel.name, 'Linked Gel')} | ${formatGelAnalysisTypeLabel(linkedGel.analysisType)} | Updated ${formatTimestamp(linkedGel.updatedAt)}`
      );
      const gelCaption = `${formatGelAnalysisTypeLabel(linkedGel.analysisType)} preview`;
      if (linkedGelPreviewImage) {
        await writeImageFigure(ctx, linkedGelPreviewImage, {
          caption: gelCaption,
          maxHeight: 260
        });
      } else {
        writeParagraph(ctx, gelCaption);
      }
    }

    if (linkedAssay) {
      writeMinorHeading(ctx, 'Assay');
      writeParagraph(
        ctx,
        `${safeValue(linkedAssay.name, 'Linked Assay')} | ${safeValue(linkedAssay.assayNumber || linkedAssay.id)} | ${safeValue(linkedAssay.plateLabel || `${linkedAssay.wellCount || '-'} well plate`)} | Updated ${formatTimestamp(linkedAssay.updatedAt)}`
      );
      const latestAnalysis = linkedAssay.latestAnalysis && typeof linkedAssay.latestAnalysis === 'object'
        ? linkedAssay.latestAnalysis
        : null;
      if (latestAnalysis) {
        writeParagraph(
          ctx,
          `Analysis: ${formatAssayAnalysisMethodLabel(latestAnalysis.method)}${String(latestAnalysis.summary || '').trim() ? ` | ${latestAnalysis.summary}` : ''}`
        );
      }

      const assayDefinition = resolveAssayDefinition(linkedAssay);
      ensureSpace(ctx, 28 + estimateAssayPlotHeight(ctx, assayDefinition));
      writeMinorHeading(ctx, 'Plate Layout');
      renderAssayPlot(ctx, linkedAssay, assayDefinition);

      const serialDilutionSummary = linkedAssay.serialDilutionSummary && typeof linkedAssay.serialDilutionSummary === 'object'
        ? linkedAssay.serialDilutionSummary
        : null;
      if (hasSerialDilutionContent(serialDilutionSummary)) {
        writeMinorHeading(ctx, 'Serial Dilution');
        if (Number.isFinite(serialDilutionSummary?.volumePerWellUl) && serialDilutionSummary.volumePerWellUl > 0) {
          writeParagraph(ctx, `Volume per well: ${serialDilutionSummary.volumePerWellUl} uL`);
        }
        (Array.isArray(serialDilutionSummary.feedbackMessages) ? serialDilutionSummary.feedbackMessages : []).forEach((item) => {
          writeParagraph(ctx, safeValue(item?.text));
        });
        if (Array.isArray(serialDilutionSummary.initialDilutionRows) && serialDilutionSummary.initialDilutionRows.length) {
          writeMinorHeading(ctx, 'Initial Dilution');
          writeSimpleTable(
            ctx,
            ['Sample', 'Stock Vol.', 'Buffer Vol.'],
            serialDilutionSummary.initialDilutionRows.map((row) => [
              row?.sample || '',
              row?.stockVolume || '',
              row?.bufferVolume || ''
            ])
          );
        }
        if (Array.isArray(serialDilutionSummary.followingDilutionRows) && serialDilutionSummary.followingDilutionRows.length) {
          writeMinorHeading(ctx, 'Following Dilution');
          writeSimpleTable(
            ctx,
            ['Step', 'Target Conc.', 'From Previous Well', 'Buffer Vol.', 'Transfer / Discard', 'Final Vol.'],
            serialDilutionSummary.followingDilutionRows.map((row) => [
              row?.step || '',
              row?.targetConcentration || '',
              row?.fromPreviousWell || '',
              row?.bufferVolume || '',
              row?.transferOrDiscard || '',
              row?.finalVolume || ''
            ])
          );
        } else if (serialDilutionSummary?.hasValidPlans) {
          writeParagraph(ctx, 'No downstream dilution steps are needed for this assay.');
        }
      }

      const assayPlotImage = String(linkedAssayPlotImage || latestAnalysis?.chartDataUrl || '').trim();
      if (assayPlotImage) {
        writeMinorHeading(ctx, 'Analysis Plot');
        await writeImageFigure(ctx, assayPlotImage, {
          caption: `${formatAssayAnalysisMethodLabel(latestAnalysis?.method)}${String(latestAnalysis?.summary || '').trim() ? ` | ${latestAnalysis.summary}` : ''}`,
          maxHeight: 220
        });
      }
    }
  }

}

export const exportNotebookEntryPdf = async (params = {}) => {
  try {
    const { entry } = params;
    if (!entry) {
      return false;
    }

    const title = safeValue(entry.experimentName || entry.protocolName, 'Untitled page');
    const pdfSettings = normalizeNotebookPdfSettings(params.pdfSettings);
    const baseMargin = 72;
    const cornerIconDataUrl = await loadHikariPdfIconDataUrl({ monochrome: true });
    const ctx = createContext({
      title,
      eyebrow: 'Notebook page',
      badge: notebookStateLabel(entry),
      footerLabel: `${safeValue(entry.projectName)} · ${title}`,
      meta: notebookEntryMeta(entry),
      orientation: 'p',
      format: pdfSettings.pageSize,
      margin: baseMargin,
      margins: resolveNotebookPdfMargins(pdfSettings, baseMargin),
      cornerIconDataUrl,
      visualStyle: 'editorial'
    });
    if (!ctx) {
      return false;
    }

    await writeNotebookEntryBody(ctx, params);

    finishAndSave(
      ctx,
      `notebook-${entry.projectName || 'project'}-${entry.experimentName || entry.protocolName || entry.id || 'entry'}`,
      { print: Boolean(params.print) }
    );
    return true;
  } catch (error) {
    console.error('Failed to export notebook PDF:', error);
    showTransientNotice(String(error?.message || error || 'Failed to export notebook PDF.'), { type: 'error' });
    return false;
  }
};

export const exportProjectNotebookEntriesPdf = async ({
  project,
  entries = [],
  protocolsByEntryId = new Map(),
  linkedGelByEntryId = new Map(),
  linkedGelPreviewImagesByEntryId = new Map(),
  linkedAssayByEntryId = new Map(),
  linkedAssayPlotImagesByEntryId = new Map(),
  resultFileImagesByEntryId = new Map(),
  pdfSettings: rawPdfSettings = {}
} = {}) => {
  try {
    if (!project) {
      return false;
    }
    const pages = Array.isArray(entries) ? entries.filter(Boolean) : [];
    if (!pages.length) {
      showTransientNotice('No notebook pages to export for this project.', { type: 'error' });
      return false;
    }

    const projectName = safeValue(project.name, 'Untitled Project');
    const pdfSettings = normalizeNotebookPdfSettings(rawPdfSettings);
    const cornerIconDataUrl = await loadHikariPdfIconDataUrl({ monochrome: true });
    const ctx = createContext({
      title: projectName,
      eyebrow: 'Project notebook',
      footerLabel: `Project notebook · ${projectName}`,
      meta: [
        { label: 'Pages', value: String(pages.length) },
        { label: 'Exported', value: formatTimestamp(new Date().toISOString()) }
      ],
      orientation: 'p',
      format: pdfSettings.pageSize,
      margin: 72,
      margins: resolveNotebookPdfMargins(pdfSettings, 72),
      cornerIconDataUrl,
      visualStyle: 'editorial'
    });
    if (!ctx) {
      return false;
    }

    if (String(project.description || '').trim()) {
      writeHeading(ctx, 'Description');
      writeParagraph(ctx, project.description);
    }

    writeHeading(ctx, 'Contents');
    writeSimpleTable(
      ctx,
      ['#', 'Page', 'Protocol', 'State'],
      pages.map((entry, index) => [
        String(index + 1),
        safeValue(entry.experimentName || entry.protocolName, 'Untitled page'),
        safeValue(entry.protocolName),
        notebookStateLabel(entry)
      ])
    );

    for (let index = 0; index < pages.length; index += 1) {
      const entry = pages[index];
      writePageHeader(ctx, {
        title: safeValue(entry.experimentName || entry.protocolName, 'Untitled page'),
        eyebrow: `Page ${index + 1} of ${pages.length}`,
        badge: notebookStateLabel(entry),
        meta: notebookEntryMeta(entry)
      });

      // eslint-disable-next-line no-await-in-loop
      await writeNotebookEntryBody(ctx, {
        entry,
        protocol: protocolsByEntryId.get(entry.id) || entry.protocolSnapshot || null,
        linkedGel: linkedGelByEntryId.get(entry.id) || null,
        linkedGelPreviewImage: linkedGelPreviewImagesByEntryId.get(entry.id) || '',
        linkedAssay: linkedAssayByEntryId.get(entry.id) || null,
        linkedAssayPlotImage: linkedAssayPlotImagesByEntryId.get(entry.id) || '',
        resultFileImages: resultFileImagesByEntryId.get(entry.id) || []
      });
    }

    finishAndSave(ctx, `project-notebook-${project.name || project.id || 'export'}`);
    return true;
  } catch (error) {
    console.error('Failed to export project notebook PDF:', error);
    showTransientNotice(String(error?.message || error || 'Failed to export project notebook PDF.'), { type: 'error' });
    return false;
  }
};

export function exportAssayDefinitionPdf(assay) {
  if (!assay) {
    return false;
  }

  const def = resolveAssayDefinition(assay);
  const isLarge = def.columns > 12;
  const title = safeValue(assay.name, assay.assayNumber || 'Unnamed');
  const ctx = createContext({
    title,
    eyebrow: 'Assay definition',
    badge: assay.assayNumber || '',
    footerLabel: `Assay · ${title}`,
    meta: [
      { label: 'Project', value: assay.projectName },
      { label: 'Plate', value: `${safeValue(def.label)} (${def.rows} x ${def.columns})` },
      { label: 'Notebook page', value: assay.notebookEntryProtocolName },
      { label: 'Updated', value: formatTimestamp(assay.updatedAt) }
    ],
    orientation: isLarge ? 'l' : 'p'
  });
  if (!ctx) {
    return false;
  }

  writeHeading(ctx, 'Axes');
  writeKeyValue(ctx, 'Sample axis', assay.sampleAxis === 'column' ? 'Column' : 'Row');
  writeKeyValue(ctx, 'Concentration axis', assay.concentrationAxis === 'column' ? 'Column' : 'Row');

  writeHeading(ctx, 'Well definition plot');
  renderAssayPlot(ctx, assay, def);

  finishAndSave(ctx, `assay-${assay.assayNumber || assay.id || assay.name || 'definition'}`);
  return true;
}
