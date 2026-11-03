import { createPresentation } from '../../lib/i18n/presentation.js';
import './localization.js';
import { escapeHtml } from '../../lib/html.js';
import { buildRestrictionDigestProducts, digestSiteEnzymes, digestSiteKey, isDigestSite } from './restriction-digestion.js';

const i18nUi = createPresentation('dna');
const snapshot = record => JSON.stringify(record);

export function createDnaDigestionController({ rootDocument, getSelectedRecord, getEntryId, getSites, getFeatureFromEvent,
  hideMenus = () => {}, saveFragments, setStatus = () => {} } = {}) {
  let context = null;
  let picker = null;
  let dialog = null;
  let saving = false;
  const field = key => dialog.querySelector(`[data-digest-${key}]`);

  function cancel() {
    if (saving) return;
    picker?.remove();
    picker = null;
    dialog?.close();
    context = null;
  }

  function templateIsCurrent() {
    return context && getSelectedRecord() === context.template && snapshot(context.template) === context.snapshot
      && getEntryId() === context.entryId;
  }

  function updateControls() {
    field('fields').disabled = saving;
    field('sites').querySelectorAll('select').forEach(select => { select.disabled = saving || context.locked; });
    field('products').querySelectorAll('[data-digest-save]').forEach(button => {
      const index = Number(button.dataset.digestSave);
      const saved = context.saved.has(index);
      button.disabled = saving || saved;
      button.dataset.digestState = saved ? 'saved' : 'unsaved';
      button.classList.toggle('primary-btn', !saved);
      button.classList.toggle('ghost-btn', saved);
      if (saved) {
        i18nUi.setText(button, '');
        i18nUi.setHtml(button, `<span aria-hidden="true">✓</span><span class="sr-only">${i18nUi.html('Saved')}</span>`);
      } else {
        i18nUi.setText(button, i18nUi.message(saving && context.savingIndex === index ? 'Saving…' : 'Save'));
      }
      field('products').querySelector(`[data-digest-name="${index}"]`).disabled = saving || saved;
    });
  }

  function preview() {
    if (!context || saving || context.locked) return;
    try {
      const selections = context.sites.map((site, index) => ({ site, enzymeName: field(`enzyme-${index}`).value }));
      const products = buildRestrictionDigestProducts(context.template, selections);
      context.products = products;
      context.ids = products.map(() => globalThis.crypto.randomUUID());
      context.saved = new Set();
      i18nUi.setHtml(field('products'), products.map((product, index) => `<div class="sequence-viewer-digest-product">
        <label>${i18nUi.html('Fragment {number} · {length} bp', { number: index + 1, length: product.sequence.length.toLocaleString() })}
          <input data-digest-name="${index}" maxlength="140" value="${escapeHtml(product.name)}"></label>
        <button type="button" class="primary-btn" data-digest-save="${index}" aria-live="polite">${i18nUi.html('Save')}</button>
      </div>`).join(''));
      i18nUi.setText(field('error'), '');
      updateControls();
    } catch (error) {
      context.products = [];
      i18nUi.setHtml(field('products'), '');
      i18nUi.setOwnedText(field('error'), error.message);
    }
  }

  async function saveProduct(index) {
    if (!context || saving || !context.products[index] || context.saved.has(index)) return;
    try {
      if (!templateIsCurrent()) throw new Error(i18nUi.text('The template changed. Close this dialog and try again.'));
      const name = field('products').querySelector(`[data-digest-name="${index}"]`).value.trim();
      if (!name) throw new Error(i18nUi.text('Enter a fragment name.'));
      saving = true;
      context.savingIndex = index;
      // Preserve this digest and its IDs through retries and individual saves.
      context.locked = true;
      i18nUi.setText(field('error'), '');
      updateControls();
      await saveFragments(context.template, [{ ...context.products[index], name }], {
        entryIds: [context.ids[index]], openAfterSave: false
      });
      context.saved.add(index);
    } catch (error) {
      i18nUi.setOwnedText(field('error'), error.message);
    } finally {
      // Saving an unsaved template can assign it an entry ID, even if the
      // subsequent fragment write fails. Retain that parent for the next save.
      if (context && getSelectedRecord() === context.template) context.entryId = getEntryId();
      saving = false;
      if (context) updateControls();
    }
  }

  function ensureDialog() {
    if (dialog || !rootDocument?.body) return dialog;
    dialog = rootDocument.createElement('dialog');
    dialog.className = 'app-dialog-overlay app-dialog-overlay--center sequence-viewer-digest-overlay';
    dialog.setAttribute('aria-labelledby', 'sequence-viewer-digest-title');
    i18nUi.setHtml(dialog, `<form class="app-dialog-surface sequence-viewer-digest-dialog">
      <div class="app-dialog-head result-card-head">
        <h4 id="sequence-viewer-digest-title" data-digest-title></h4>
        <button type="button" class="app-dialog-close-btn" data-digest-close ${i18nUi.attribute('aria-label', 'Close')}>×</button>
      </div>
      <p class="small-note" data-digest-template></p>
      <fieldset data-digest-fields>
        <div class="sequence-viewer-digest-sites" data-digest-sites></div>
        <div class="sequence-viewer-digest-products" data-digest-products></div>
      </fieldset>
      <p class="sequence-viewer-fragment-error" role="alert" data-digest-error></p>
      <div class="form-actions">
        <button type="button" class="ghost-btn" data-digest-cancel>${i18nUi.html('Close')}</button>
      </div>
    </form>`);
    rootDocument.body.appendChild(dialog);
    dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); else context = null; });
    dialog.addEventListener('click', event => {
      const save = event.target.closest('[data-digest-save]');
      if (save) { void saveProduct(Number(save.dataset.digestSave)); return; }
      if (event.target === dialog || event.target.closest('[data-digest-close], [data-digest-cancel]')) cancel();
    });
    dialog.addEventListener('change', event => {
      if (event.target.matches('[data-digest-enzyme]')) preview();
    });
    dialog.querySelector('form').addEventListener('submit', event => event.preventDefault());
    return dialog;
  }

  function showConfirmation() {
    if (!ensureDialog() || !templateIsCurrent()) { cancel(); return; }
    picker?.remove();
    picker = null;
    hideMenus();
    field('fields').disabled = false;
    i18nUi.setText(field('title'), i18nUi.message(context.sites.length === 1 ? 'Single digestion' : 'Double digestion'));
    i18nUi.setText(field('template'), i18nUi.message('Template: {name}', { name: context.template.name }));
    i18nUi.setHtml(field('sites'), context.sites.map((site, index) => `<label>
      ${i18nUi.html('Site {number} · bases {range}', { number: index + 1,
        range: site.segments.map(part => `${part.start + 1}–${part.end}`).join(', ') })}
      <select data-digest-enzyme data-digest-enzyme-${index}>${digestSiteEnzymes(site).map(enzyme =>
        `<option value="${escapeHtml(enzyme.name)}"${enzyme.name === site.name ? ' selected' : ''}>${escapeHtml(enzyme.name)}</option>`).join('')}</select>
    </label>`).join(''));
    preview();
    if (!dialog.open) dialog.showModal();
    field('enzyme-0').focus();
  }

  function start(site, mode = 'single') {
    if (!isDigestSite(site) || saving) return;
    cancel();
    const template = getSelectedRecord();
    if (!template?.sequence?.length) return;
    context = { template, snapshot: snapshot(template), entryId: getEntryId(), sites: [site], products: [], saved: new Set(), locked: false };
    hideMenus();
    if (mode !== 'double') { showConfirmation(); return; }
    picker = rootDocument.createElement('div');
    picker.className = 'sequence-viewer-digest-picker';
    picker.setAttribute('role', 'status');
    i18nUi.setHtml(picker, `<span data-digest-prompt>${i18nUi.html('Double digestion: {name} selected. Click a second restriction site, then confirm.', { name: site.name })}</span>
      <button type="button" class="ghost-btn" data-digest-pick-cancel>${i18nUi.html('Cancel')}</button>`);
    picker.querySelector('button').addEventListener('click', cancel);
    rootDocument.body.appendChild(picker);
  }

  function pickSecondSite(event) {
    if (!picker || !context || (event.type === 'mousedown' && event.button !== 0)) return;
    if (!templateIsCurrent()) { cancel(); return; }
    const site = getFeatureFromEvent(event);
    if (!isDigestSite(site)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (digestSiteKey(site) === digestSiteKey(context.sites[0])) {
      i18nUi.setText(picker.querySelector('[data-digest-prompt]'), i18nUi.message('Choose a different second restriction site.'));
      return;
    }
    context.sites.push(site);
    showConfirmation();
  }

  rootDocument?.addEventListener('mousedown', pickSecondSite, true);
  rootDocument?.addEventListener('click', pickSecondSite, true);
  rootDocument?.addEventListener('keydown', event => { if (event.key === 'Escape' && picker) cancel(); });
  rootDocument?.addEventListener('click', event => {
    const button = event.target?.closest?.('[data-sequence-digest-action]');
    if (!button) return;
    const site = getSites().find(item => digestSiteKey(item) === button.dataset.sequenceDigestSite);
    if (site) start(site, button.dataset.sequenceDigestAction);
    else setStatus(i18nUi.text('The restriction site changed. Please try again.'), true);
  });
  return { start, cancel };
}
