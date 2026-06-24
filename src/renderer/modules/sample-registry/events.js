import {
  onCompoundClearClick,
  onCompoundPasteClick,
  onCompoundStructurePaste
} from './compound-actions.js';
import { onSampleTypeChange } from './compound-dialog.js';
import { renderLinkedContainerOptions, renderLinkedPositionOptions } from './inventory-links.js';
import { renderLocationFields } from './location-fields.js';
import {
  deleteSample,
  editSample,
  onSubmit,
  resetForm
} from './sample-form.js';
import { onListClick, renderList } from './sample-list.js';
import { mergeSamplesFromCsv, parseSamplesCsv, toSamplesCsv } from './csv-io.js';

function setSampleCsvStatus(ctx, message) {
  if (ctx.dom.sampleCsvStatus) {
    ctx.dom.sampleCsvStatus.textContent = String(message || '');
  }
}

export function bindSampleRegistryEvents(ctx) {
  const dom = ctx.dom;
  dom.sampleStorageTypeInput?.addEventListener('change', () => renderLocationFields(ctx));
  dom.sampleLinkContainerInput?.addEventListener('change', () => renderLinkedPositionOptions(ctx));
  dom.sampleTypeInput?.addEventListener('change', () => onSampleTypeChange(ctx));
  dom.sampleCompoundPasteBtn?.addEventListener('click', () => onCompoundPasteClick(ctx));
  dom.sampleCompoundClearBtn?.addEventListener('click', () => onCompoundClearClick(ctx));
  dom.sampleCompoundFields?.addEventListener('paste', (event) => onCompoundStructurePaste(ctx, event));
  dom.sampleForm?.addEventListener('submit', (event) => onSubmit(ctx, event));
  dom.sampleCancelBtn?.addEventListener('click', () => resetForm(ctx));
  dom.sampleSearchInput?.addEventListener('input', () => renderList(ctx));
  dom.sampleExportCsvBtn?.addEventListener('click', () => {
    const samples = ctx.state.samples || [];
    const blob = new Blob([`\uFEFF${toSamplesCsv(samples, ctx.state.inventory)}`], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `samples-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    setSampleCsvStatus(ctx, samples.length ? `Exported ${samples.length} samples.` : 'Exported empty CSV (no samples yet).');
  });
  dom.sampleImportCsvBtn?.addEventListener('click', () => dom.sampleImportCsvFile?.click());
  dom.sampleImportCsvFile?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const rows = parseSamplesCsv(await file.text());
      if (!rows.length) {
        setSampleCsvStatus(ctx, 'Import failed: no rows with a "name" column were found.');
        return;
      }
      const { created, updated } = mergeSamplesFromCsv(ctx.state, rows);
      ctx.persist();
      renderLinkedContainerOptions(ctx);
      renderList(ctx);
      setSampleCsvStatus(ctx, `Imported ${created + updated} samples (${created} new, ${updated} updated).`);
    } catch (error) {
      setSampleCsvStatus(ctx, `Import failed: ${error?.message || 'could not read the CSV file.'}`);
    } finally {
      event.target.value = '';
    }
  });
  dom.sampleRegistryList?.addEventListener('click', (event) => onListClick(ctx, event));
  dom.sampleDetailEditBtn?.addEventListener('click', () => {
    if (!ctx.selectedSampleId) {
      return;
    }
    editSample(ctx, ctx.selectedSampleId);
  });
  dom.sampleDetailDeleteBtn?.addEventListener('click', () => {
    if (!ctx.selectedSampleId) {
      return;
    }
    deleteSample(ctx, ctx.selectedSampleId);
  });
}
