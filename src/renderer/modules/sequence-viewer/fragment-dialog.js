import { createPresentation } from '../../lib/i18n/presentation.js';
import './localization.js';
import { isPrimerBindingFeature } from './feature-types.js';
import { buildDnaFragmentRecord, buildPcrFragmentRecord, getFeatureDnaFragmentRange } from './dna-fragments.js';

const i18nUi = createPresentation('dna');

export function createDnaFragmentDialog({ rootDocument, getSelectedRecord, getEntryId, saveFragment, onRequestPcrPartner = () => {} } = {}) {
  let dialog = null;
  let context = null;
  let saving = false;
  const field = key => dialog.querySelector(`[data-fragment-${key}]`);

  function close() {
    if (saving) return;
    dialog?.close();
    context = null;
  }

  function makeProduct() {
    const name = field('name').value.trim();
    if (!name) throw new Error(i18nUi.text('Enter a fragment name.'));
    if (!context.primer) return buildDnaFragmentRecord(context.template, context.range, name);
    return context.primer.strand === -1
      ? buildPcrFragmentRecord(context.template, context.partner, context.primer, name)
      : buildPcrFragmentRecord(context.template, context.primer, context.partner, name);
  }

  function preview() {
    if (!context || saving) return;
    try {
      const product = makeProduct();
      i18nUi.setText(field('preview'), i18nUi.message('{length} bp · linear DNA · {features} annotations', {
        length: product.sequence.length.toLocaleString(), features: product.features.length
      }));
      i18nUi.setText(field('error'), '');
      field('save').disabled = false;
    } catch (error) {
      i18nUi.setText(field('preview'), '');
      i18nUi.setOwnedText(field('error'), error.message);
      field('save').disabled = true;
    }
  }

  function ensureDialog() {
    if (dialog || !rootDocument?.body) return dialog;
    dialog = rootDocument.createElement('dialog');
    dialog.className = 'app-dialog-overlay app-dialog-overlay--center sequence-viewer-fragment-overlay';
    dialog.setAttribute('aria-labelledby', 'sequence-viewer-fragment-title');
    i18nUi.setHtml(dialog, `<form class="app-dialog-surface sequence-viewer-fragment-dialog">
      <div class="app-dialog-head result-card-head">
        <h4 id="sequence-viewer-fragment-title" data-fragment-title></h4>
        <button type="button" class="app-dialog-close-btn" data-fragment-close ${i18nUi.attribute('aria-label', 'Close')}>×</button>
      </div>
      <p class="small-note" data-fragment-parent></p>
      <fieldset data-fragment-fields>
        <label>${i18nUi.html('Fragment name')}<input data-fragment-name required maxlength="140" autocomplete="off"></label>
        <div data-fragment-pcr>
          <p data-fragment-primer></p>
          <p data-fragment-partner></p>
          <button type="button" class="ghost-btn" data-fragment-pick-partner>${i18nUi.html('Choose a different partner in the sequence')}</button>
        </div>
      </fieldset>
      <p class="small-note" data-fragment-preview aria-live="polite"></p>
      <p class="sequence-viewer-fragment-error" data-fragment-error role="alert"></p>
      <div class="form-actions">
        <button type="button" class="ghost-btn" data-fragment-cancel>${i18nUi.html('Cancel')}</button>
        <button type="submit" class="primary-btn" data-fragment-save>${i18nUi.html('Save fragment')}</button>
      </div>
    </form>`);
    rootDocument.body.appendChild(dialog);
    dialog.addEventListener('input', preview);
    dialog.addEventListener('change', preview);
    dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); else context = null; });
    dialog.addEventListener('click', event => {
      if (event.target.closest('[data-fragment-pick-partner]') && !saving && context?.primer) {
        const primer = context.primer;
        close();
        onRequestPcrPartner(primer);
        return;
      }
      if (event.target === dialog || event.target.closest('[data-fragment-close], [data-fragment-cancel]')) close();
    });
    dialog.querySelector('form').addEventListener('submit', event => {
      event.preventDefault();
      void (async () => {
        if (saving || !context) return;
        try {
          const product = makeProduct();
          if (getSelectedRecord() !== context.template || getEntryId() !== context.entryId) {
            throw new Error(i18nUi.text('The template changed. Close this dialog and try again.'));
          }
          saving = true;
          field('fields').disabled = true;
          field('save').disabled = true;
          i18nUi.setText(field('save'), i18nUi.message('Saving…'));
          await saveFragment(context.template, product);
          saving = false;
          close();
        } catch (error) {
          i18nUi.setOwnedText(field('error'), error.message);
          // The template may have been saved successfully before a child write
          // failed. Retrying still uses that same template entry.
          if (context && getSelectedRecord() === context.template) context.entryId = getEntryId();
        } finally {
          saving = false;
          field('fields').disabled = false;
          field('save').disabled = false;
          i18nUi.setText(field('save'), i18nUi.message('Save fragment'));
        }
      })();
    });
    return dialog;
  }

  function open({ range, primer, partner, feature } = {}) {
    const template = getSelectedRecord();
    if (primer && !partner) return onRequestPcrPartner(primer);
    if (!template?.sequence?.length || !ensureDialog() || saving) return false;
    if (feature) range = getFeatureDnaFragmentRange(feature, template);
    if (!primer && !range) return false;
    context = { template, entryId: getEntryId(), range: range && { ...range }, primer, partner };
    field('pcr').hidden = !primer;
    i18nUi.setText(field('title'), i18nUi.message(primer ? 'Create PCR fragment' : 'Save DNA fragment'));
    i18nUi.setText(field('parent'), i18nUi.message('Saved as GenBank DNA under {name}.', { name: template.name }));
    if (primer) {
      i18nUi.setText(field('primer'), i18nUi.message('Starting primer: {name}', { name: primer.name || i18nUi.text('Primer') }));
      i18nUi.setText(field('partner'), i18nUi.message('Partner primer: {name}', { name: partner.name || i18nUi.text('Primer') }));
    }
    field('name').value = primer ? `${template.name}_PCR`
      : feature?.name ? `${template.name}_${feature.name}` : buildDnaFragmentRecord(template, range).name;
    preview();
    rootDocument.querySelectorAll('[data-sequence-hover-tooltip]').forEach(node => { node.hidden = true; });
    if (!dialog.open) dialog.showModal();
    field('name').focus();
    field('name').select();
    return true;
  }

  rootDocument?.addEventListener('click', event => {
    const trigger = event.target?.closest?.('[data-sequence-primer-pcr]');
    if (!trigger) return;
    const site = JSON.parse(trigger.dataset.sequencePrimerPcr);
    const primer = getSelectedRecord()?.features?.find(feature => isPrimerBindingFeature(feature.type)
      && (!site.id || feature.id === site.id) && feature.primerSequence === site.primerSequence
      && feature.name === site.name && feature.strand === site.strand
      && JSON.stringify(feature.segments) === JSON.stringify(site.segments));
    if (primer) open({ primer });
  });
  return { open, close };
}
