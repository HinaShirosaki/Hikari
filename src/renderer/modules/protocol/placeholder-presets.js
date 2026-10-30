import { createPresentation } from "../../lib/i18n/presentation.js";
import "./localization.js";
const i18nUi = createPresentation("protocol");
import { protocolMessage, protocolAttributes } from './localization.js';
import { getEditableSampleTypeEntries } from '../../lib/inventory-settings.js';
import { escapeHtml } from '../../lib/html.js';

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
  return escapeHtml(text);
}

export function getProtocolPlaceholderPresetEntries(settings = {}) {
  const sampleTypeEntries = getEditableSampleTypeEntries(settings)
    .map(({ label }) => String(label || '').trim())
    .filter(Boolean)
    .map((name) => ({ name, kind: 'sample' }));
  const parameterEntries = PARAMETER_PRESET_NAMES.map((name) => ({ name, kind: 'parameter' }));
  return sampleTypeEntries.concat(parameterEntries);
}

export function renderProtocolPlaceholderPresetButtons(container, settings = {}, safeText) {
  if (!container) {
    return [];
  }

  const entries = getProtocolPlaceholderPresetEntries(settings);
  const renderButton = ({ name, kind }) => {
    const safeName = escapePresetText(name, safeText);
    return `<button type="button" class="ghost-btn protocol-placeholder-preset" data-protocol-placeholder-preset="${safeName}" data-protocol-placeholder-kind="${kind}">${kind === 'parameter' ? protocolMessage(`presets.${name}`) : safeName}</button>`;
  };
  i18nUi.setHtml(container, [['sample', 'presets.samples'], ['parameter', 'presets.parameters']].map(([kind, key]) =>
    `<div class="protocol-placeholder-group" role="group" ${protocolAttributes({ 'aria-label': key })}><span class="protocol-steps-toolbar-label">${protocolMessage(key)}</span><div class="protocol-placeholder-buttons">${entries.filter((entry) => entry.kind === kind).map(renderButton).join('')}</div></div>`
  ).join(''));
  return entries;
}
