import { isChemicalStructureSampleType } from './compound-model.js';
import { escapeHtml } from '../../lib/html.js';
import { cloneMetadataObject, formatSampleRecordLabel } from '../../lib/sample-records.js';
import {
  getEditableSampleTypeEntries,
  getSampleTypeLabel,
  normalizeSampleType
} from '../../lib/inventory-settings.js';

export function ensureSampleState(ctx) {
  if (!Array.isArray(ctx.state.samples)) {
    ctx.state.samples = [];
  }
}

export function makeDefaultCode() {
  return `S-${Date.now().toString().slice(-6)}`;
}

export function normalizeCode(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '');
}

export { cloneMetadataObject, formatSampleRecordLabel };

export function formatSampleTypeLabel(sampleType, settings = {}) {
  if (isChemicalStructureSampleType(sampleType)) {
    return getSampleTypeLabel(settings, 'chemical');
  }
  return getSampleTypeLabel(settings, sampleType);
}

export function renderSampleTypeOptions(ctx) {
  const select = ctx.dom.sampleTypeInput;
  if (!select) {
    return;
  }
  const selected = normalizeSampleType(select.value || 'plasmid');
  const entries = getEditableSampleTypeEntries(ctx.state.settings);
  select.innerHTML = entries.map((entry) => `
    <option value="${escapeHtml(entry.type)}"${selected === entry.type ? ' selected' : ''}>${escapeHtml(entry.label)}</option>
  `).join('');
  if (!entries.some((entry) => entry.type === selected)) {
    select.value = 'plasmid';
  }
}

export { escapeHtml };

export function setMultiSelectValues(selectEl, values) {
  if (!selectEl) {
    return;
  }
  const selectedValues = Array.isArray(values)
    ? values.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  selectedValues.forEach((value) => {
    if (!Array.from(selectEl.options).some((option) => option.value === value)) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = `${value} (missing)`;
      selectEl.append(option);
    }
  });
  Array.from(selectEl.options).forEach((option) => {
    option.selected = selectedValues.includes(option.value);
  });
}
