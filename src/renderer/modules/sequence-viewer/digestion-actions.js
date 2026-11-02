import { createPresentation } from '../../lib/i18n/presentation.js';
import './localization.js';
import { escapeHtml } from '../../lib/html.js';
import { digestSiteKey, isDigestSite } from './restriction-digestion.js';
const i18nUi = createPresentation('dna');

export function renderDigestionActions(feature, { menu = false } = {}) {
  if (!isDigestSite(feature)) return '';
  const key = escapeHtml(digestSiteKey(feature));
  const className = menu ? 'sequence-viewer-context-item' : 'ghost-btn';
  const buttons = `<button type="button" class="${className}" data-sequence-digest-action="single" data-sequence-digest-site="${key}">${i18nUi.html('Single digestion…')}</button>
    <button type="button" class="${className}" data-sequence-digest-action="double" data-sequence-digest-site="${key}">${i18nUi.html('Double digestion…')}</button>`;
  return menu ? buttons : `<div class="sequence-viewer-digest-actions">${buttons}</div>`;
}
