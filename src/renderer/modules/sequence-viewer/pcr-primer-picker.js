import { createPresentation } from '../../lib/i18n/presentation.js';
import './localization.js';
import { isPrimerBindingFeature } from './feature-types.js';
import { resolvePcrPrimerPair } from './dna-fragments.js';
import { createPickerStatusPositioner } from './picker-status.js';

const i18nUi = createPresentation('dna');
const primerKey = primer => JSON.stringify([primer?.id, primer?.name, primer?.strand, primer?.primerSequence, primer?.segments]);
const recordKey = record => JSON.stringify([record?.sequence, record?.topology, record?.features]);

export function evaluatePcrPrimerCandidates(record, first) {
  return (record?.features || []).filter(primer => isPrimerBindingFeature(primer.type)).map(primer => {
    if (primerKey(primer) === primerKey(first)) return { primer, state: 'selected' };
    try {
      const pair = first.strand === -1 ? resolvePcrPrimerPair(record, primer, first) : resolvePcrPrimerPair(record, first, primer);
      return { primer, state: 'feasible', productLength: pair.productLength };
    } catch (error) {
      return { primer, state: 'unavailable', reason: error.message };
    }
  });
}

export function createPcrPrimerPicker({ rootDocument, elements, getSelectedRecord, getEntryId,
  getFeatureFromEvent, getStatusAnchor = () => elements.pickerStatusAnchor,
  onBeginPicking = () => {}, onPairSelected = () => {} } = {}) {
  let context = null;
  let banner = null;
  const statusPositioner = createPickerStatusPositioner({ rootDocument, getAnchor: getStatusAnchor });
  const marked = new Map();
  const surfaces = () => [elements.sequenceHost, elements.featureRailHost].filter(Boolean);

  function clearHighlights() {
    for (const [node, original] of marked) {
      node.removeAttribute('data-pcr-primer-state');
      for (const attribute of ['aria-disabled', 'aria-describedby']) {
        if (original[attribute] === null) node.removeAttribute(attribute);
        else node.setAttribute(attribute, original[attribute]);
      }
    }
    marked.clear();
  }

  function cancel() {
    context = null;
    statusPositioner.clear();
    banner = null;
    clearHighlights();
  }

  function isCurrent() {
    return context && getSelectedRecord() === context.record && getEntryId() === context.entryId
      && recordKey(context.record) === context.recordKey;
  }

  function refreshHighlights() {
    if (!context) return;
    if (!isCurrent()) { cancel(); return; }
    for (const surface of surfaces()) {
      for (const node of surface.querySelectorAll('[data-feature-index]')) {
        const primer = getFeatureFromEvent({ target: node });
        if (!isPrimerBindingFeature(primer?.type)) continue;
        const candidate = context.candidates.get(primerKey(primer));
        if (!candidate) continue;
        if (!marked.has(node)) marked.set(node, {
          'aria-disabled': node.getAttribute('aria-disabled'), 'aria-describedby': node.getAttribute('aria-describedby')
        });
        node.setAttribute('data-pcr-primer-state', candidate.state);
        if (candidate.state === 'unavailable') node.setAttribute('aria-disabled', 'true');
        node.setAttribute('aria-describedby', 'sequence-viewer-pcr-pick-prompt');
      }
    }
  }

  function start(primer) {
    cancel();
    const record = getSelectedRecord();
    if (!isPrimerBindingFeature(primer?.type) || !record?.features?.includes(primer) || !rootDocument?.body) return false;
    const candidates = evaluatePcrPrimerCandidates(record, primer);
    context = { record, recordKey: recordKey(record), entryId: getEntryId(), primer,
      candidates: new Map(candidates.map(candidate => [primerKey(candidate.primer), candidate])) };
    banner = rootDocument.createElement('div');
    banner.className = 'sequence-viewer-pcr-picker sequence-viewer-picker-status';
    banner.setAttribute('role', 'status');
    const hasPartner = candidates.some(candidate => candidate.state === 'feasible');
    i18nUi.setHtml(banner, `<div id="sequence-viewer-pcr-pick-prompt">
      <p>${i18nUi.html('PCR: {name}. Click a highlighted partner primer in the sequence.', { name: primer.name || i18nUi.text('Primer') })}</p>
      <p class="small-note"${hasPartner ? ' hidden' : ''}>${hasPartner ? ''
        : i18nUi.html('No compatible partner primers are annotated on this template. Add a partner primer, then start PCR again.')}</p>
    </div><button type="button" class="ghost-btn" data-pcr-pick-cancel>${i18nUi.html('Cancel')}</button>`);
    banner.querySelector('button').addEventListener('click', cancel);
    onBeginPicking(primer);
    statusPositioner.show(banner);
    refreshHighlights();
    return true;
  }

  function pick(event) {
    if (!context || (event.type === 'mousedown' && event.button !== 0)) return;
    if (!isCurrent()) { cancel(); return; }
    const trigger = event.target?.closest?.('[data-feature-index]');
    if (!trigger || !surfaces().some(surface => surface.contains(trigger))) return;
    const primer = getFeatureFromEvent(event);
    if (!isPrimerBindingFeature(primer?.type)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const candidate = context.candidates.get(primerKey(primer));
    if (candidate?.state !== 'feasible') {
      const note = banner.querySelector('.small-note');
      note.hidden = false;
      i18nUi.setText(note, i18nUi.message(candidate?.state === 'selected'
        ? 'Choose a highlighted partner primer.' : 'This primer cannot form a PCR product with {name}. Choose a highlighted primer.', { name: context.primer.name }));
      return;
    }
    const first = context.primer;
    cancel();
    onPairSelected(first, primer);
  }

  rootDocument?.addEventListener('mousedown', pick, true);
  rootDocument?.addEventListener('click', pick, true);
  rootDocument?.addEventListener('keydown', event => {
    if (context && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel(); }
  }, true);
  rootDocument?.addEventListener('click', event => {
    if (context && event.target?.closest?.('[data-sequence-digest-action]')) cancel();
  });
  return { start, cancel, refreshHighlights, refreshStatusPosition: statusPositioner.refresh };
}
