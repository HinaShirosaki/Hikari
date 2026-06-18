import { isChemicalStructureSampleType } from './compound-model.js';
import {
  getEditableSampleTypeEntries,
  getSampleTypeLabel,
  normalizeSampleType
} from '../sample-inventory-settings.js';

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

export function cloneMetadataObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return Object.entries(value).reduce((accumulator, [key, raw]) => {
    const cleanKey = String(key || '').trim();
    if (!cleanKey) {
      return accumulator;
    }
    accumulator[cleanKey] = raw === null || raw === undefined ? '' : raw;
    return accumulator;
  }, {});
}

export function formatSampleRecordLabel(sample) {
  const code = String(sample?.code || '').trim();
  const name = String(sample?.name || '').trim();
  if (code && name) {
    return `${code} - ${name}`;
  }
  return code || name || String(sample?.id || 'Sample').trim();
}

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

export function escapeHtml(text) {
  return String(text || '').replace(/[&<>"']/g, (char) => {
    const entityMap = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return entityMap[char] || char;
  });
}

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

export function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
