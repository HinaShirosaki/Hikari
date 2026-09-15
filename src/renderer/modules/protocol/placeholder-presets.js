import { getEditableSampleTypeEntries } from '../../lib/inventory-settings.js';

const PARAMETER_PRESET_NAMES = [
  'volume',
  'buffer',
  'concentration',
  'temperature',
  'time'
];

function escapePresetText(value, safeText) {
  const text = String(value || '').trim();
  if (typeof safeText === 'function') {
    return safeText(text);
  }
  return text.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

export function getProtocolPlaceholderPresetEntries(settings = {}) {
  const sampleTypeEntries = getEditableSampleTypeEntries(settings)
    .map(({ label }) => String(label || '').trim())
    .filter(Boolean)
    .map((name) => ({ name, kind: 'sample' }));
  const parameterEntries = PARAMETER_PRESET_NAMES.map((name) => ({ name, kind: 'parameter' }));
  return sampleTypeEntries.concat(parameterEntries);
}

export function renderProtocolPlaceholderPresetButtons(container, settings = {}, safeText, activePreset = '') {
  if (!container) {
    return [];
  }

  const activeName = String(activePreset || '').trim();
  const entries = getProtocolPlaceholderPresetEntries(settings);
  container.innerHTML = entries.map(({ name, kind }) => {
    const safeName = escapePresetText(name, safeText);
    const isActive = name === activeName;
    return `<button type="button" class="ghost-btn protocol-placeholder-preset" data-protocol-placeholder-preset="${safeName}" data-protocol-placeholder-kind="${kind}" aria-pressed="${isActive}">${safeName}</button>`;
  }).join('');
  return entries;
}
