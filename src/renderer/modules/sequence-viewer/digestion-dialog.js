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

  function endHtml(end) {
    if (end.kind === 'original') return i18nUi.html('Original template end');
    if (end.kind === 'blunt') return i18nUi.html('{enzyme}: blunt end', { enzyme: end.enzyme });
    return i18nUi.html('{enzyme}: {prime} overhang {sequence} (5′ → 3′)', {
      enzyme: end.enzyme, prime: end.kind === '5-prime' ? '5′' : '3′', sequence: end.sequence
    });
  }

  function updateSelection() {
    if (saving) return;
    const selected = [...field('products').querySelectorAll('[data-digest-keep]:checked')];
    field('save').disabled = !selected.length;
  }

  function preview() {
    if (!context || saving || context.pending) return;
    try {
      const selections = context.sites.map((site, index) => ({ site, enzymeName: field(`enzyme-${index}`).value }));
      const products = buildRestrictionDigestProducts(context.template, selections);
      context.products = products;
      context.ids = products.map(() => globalThis.crypto.randomUUID());
      i18nUi.setHtml(field('products'), products.map((product, index) => `<div class="sequence-viewer-digest-product">
        <label class="sequence-viewer-digest-keep"><input type="checkbox" data-digest-keep="${index}" checked>
          ${i18nUi.html('Fragment {number} · {length} bp', { number: index + 1, length: product.sequence.length.toLocaleString() })}</label>
        <label>${i18nUi.html('Fragment name')}<input data-digest-name="${index}" maxlength="140" value="${escapeHtml(product.name)}"></label>
        <p class="small-note">${i18nUi.html('Left end:')} ${endHtml(product.digestEnds.left)}</p>
        <p class="small-note">${i18nUi.html('Right end:')} ${endHtml(product.digestEnds.right)}</p>
      </div>`).join(''));
      i18nUi.setText(field('error'), '');
      updateSelection();
    } catch (error) {
      context.products = [];
      i18nUi.setHtml(field('products'), '');
      i18nUi.setOwnedText(field('error'), error.message);
      field('save').disabled = true;
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
        <p class="small-note">${i18nUi.html('Choose which fragments to save. Each becomes a GenBank child of the template; lengths refer to the plus strand.')}</p>
        <div class="sequence-viewer-digest-products" data-digest-products></div>
      </fieldset>
      <p class="sequence-viewer-fragment-error" role="alert" data-digest-error></p>
      <div class="form-actions">
        <button type="button" class="ghost-btn" data-digest-cancel>${i18nUi.html('Cancel')}</button>
        <button type="submit" class="primary-btn" data-digest-save>${i18nUi.html('Confirm digestion and save')}</button>
      </div>
    </form>`);
    rootDocument.body.appendChild(dialog);
    dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); else context = null; });
    dialog.addEventListener('click', event => {
      if (event.target === dialog || event.target.closest('[data-digest-close], [data-digest-cancel]')) cancel();
    });
    dialog.addEventListener('change', event => {
      if (event.target.matches('[data-digest-enzyme]')) preview();
      else updateSelection();
    });
    dialog.querySelector('form').addEventListener('submit', event => {
      event.preventDefault();
      void (async () => {
        if (!context || saving) return;
        try {
          if (!templateIsCurrent()) throw new Error(i18nUi.text('The template changed. Close this dialog and try again.'));
          if (!context.pending) {
            const indices = [...field('products').querySelectorAll('[data-digest-keep]:checked')].map(input => Number(input.dataset.digestKeep));
            if (!indices.length) throw new Error(i18nUi.text('Choose at least one fragment to save.'));
            const products = indices.map(index => {
              const name = field('products').querySelector(`[data-digest-name="${index}"]`).value.trim();
              if (!name) throw new Error(i18nUi.text('Enter a fragment name.'));
              return { ...context.products[index], name };
            });
            // Stable IDs make retrying a partly completed save idempotent.
            context.pending = { products, entryIds: indices.map(index => context.ids[index]) };
          }
          saving = true;
          field('fields').disabled = true;
          field('save').disabled = true;
          i18nUi.setText(field('save'), i18nUi.message('Saving…'));
          await saveFragments(context.template, context.pending.products, { entryIds: context.pending.entryIds });
          saving = false;
          cancel();
        } catch (error) {
          i18nUi.setOwnedText(field('error'), error.message);
          if (context && getSelectedRecord() === context.template) context.entryId = getEntryId();
        } finally {
          saving = false;
          field('fields').disabled = Boolean(context?.pending);
          field('save').disabled = false;
          i18nUi.setText(field('save'), i18nUi.message('Confirm digestion and save'));
        }
      })();
    });
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
      ${i18nUi.html('Site {number}: {name} · bases {range}', { number: index + 1, name: site.name,
        range: site.segments.map(part => `${part.start + 1}–${part.end}`).join(', ') })}
      <select data-digest-enzyme data-digest-enzyme-${index}>${digestSiteEnzymes(site).map(enzyme =>
        `<option value="${escapeHtml(enzyme.name)}"${enzyme.name === site.name ? ' selected' : ''}>${escapeHtml(enzyme.name)} · ${escapeHtml(enzyme.cut || '?')}</option>`).join('')}</select>
    </label>`).join(''));
    preview();
    if (!dialog.open) dialog.showModal();
    field('save').focus();
  }

  function start(site, mode = 'single') {
    if (!isDigestSite(site) || saving) return;
    cancel();
    const template = getSelectedRecord();
    if (!template?.sequence?.length) return;
    context = { template, snapshot: snapshot(template), entryId: getEntryId(), sites: [site], products: [], pending: null };
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
