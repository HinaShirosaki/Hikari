import { createPresentation } from '../../lib/i18n/presentation.js';
import './localization.js';
import { escapeHtml } from '../../lib/html.js';
import { parseInputRecords } from './parsing.js';
import { buildDnaAssemblyRecord, orientDnaAssemblyFragment, DNA_ASSEMBLY_ERRORS } from './dna-assembly.js';

const i18nUi = createPresentation('dna');
const listSelector = '#sequence-viewer-library-list, #sequence-viewer-detail-library-list';

export function createDnaAssemblyController({ rootDocument, getBridge, getStoragePath, getActiveInput = () => null,
  getEntryName = () => 'DNA', beforeOpen = () => {}, saveAssembly } = {}) {
  let banner = null;
  let context = null;
  let saving = false;
  const marked = new Map();
  const field = key => banner.querySelector(`[data-assembly-${key}]`);

  function restoreHighlights() {
    for (const [button, original] of marked) {
      for (const [attribute, previous] of Object.entries(original.attributes)) {
        if (previous === null) button.removeAttribute(attribute); else button.setAttribute(attribute, previous);
      }
      original.row?.removeAttribute('data-assembly-selected');
    }
    marked.clear();
  }

  function close() {
    if (saving) return;
    context = null;
    restoreHighlights();
    if (banner) banner.hidden = true;
  }

  function refreshHighlights() {
    restoreHighlights();
    if (!context) return;
    if (getStoragePath() !== context.storagePath) { close(); return; }
    const selected = new Set(context.inputs.map(input => input.entryId).filter(Boolean));
    rootDocument.querySelectorAll('[data-sequence-entry-id]').forEach(button => {
      if (!button.closest(listSelector) || !selected.has(button.dataset.sequenceEntryId)) return;
      const row = button.closest('.sequence-viewer-dna-row');
      marked.set(button, { row, attributes: {
        'aria-pressed': button.getAttribute('aria-pressed'), 'aria-describedby': button.getAttribute('aria-describedby')
      } });
      button.setAttribute('aria-pressed', 'true');
      button.setAttribute('aria-describedby', 'sequence-viewer-assembly-prompt');
      row?.setAttribute('data-assembly-selected', 'true');
    });
  }

  function current(operation) {
    return context === operation && getStoragePath() === operation.storagePath;
  }

  function showError(error) {
    if (error.assemblyCode) i18nUi.setText(field('error'), i18nUi.message(DNA_ASSEMBLY_ERRORS[error.assemblyCode], error.assemblyParams));
    else i18nUi.setOwnedText(field('error'), error.message);
  }

  function product() {
    return buildDnaAssemblyRecord(context.inputs.filter(input => !input.loading), {
      name: field('name').value,
      minimumOverlap: Number(field('overlap').value)
    });
  }

  function preview() {
    if (!context) return;
    const loading = context.inputs.some(input => input.loading);
    field('overlap-field').hidden = false;
    field('overlap').disabled = false;
    field('fields').disabled = saving;
    field('close').disabled = saving;
    field('save').disabled = true;
    i18nUi.setText(field('save'), i18nUi.message(saving ? 'Saving…' : 'Assemble'));
    i18nUi.setText(field('error'), '');
    i18nUi.setHtml(field('junctions'), '');
    try {
      const result = product();
      const overlap = result.assemblyMethod !== 'sticky';
      field('overlap-field').hidden = !overlap;
      field('overlap').disabled = !overlap;
      i18nUi.setText(field('summary'), i18nUi.compose([
        i18nUi.message('{length} bp · {count} fragments', { length: result.sequence.length.toLocaleString(), count: context.inputs.length }),
        ' · ', i18nUi.message(result.topology === 'circular' ? 'Circular DNA' : 'Linear DNA')
      ]));
      i18nUi.setHtml(field('junctions'), result.junctions.map(junction => `<li>${i18nUi.html(
        overlap ? '{left} → {right}: {length} bp overlap' : '{left} → {right}: compatible ends',
        { left: junction.left, right: junction.right, length: junction.overlap })}</li>`).join(''));
      field('save').disabled = saving || loading;
    } catch (error) {
      i18nUi.setText(field('summary'), error.assemblyCode === 'fragments' ? i18nUi.message('Choose at least two DNA fragments.') : '');
      if (error.assemblyCode !== 'fragments') showError(error);
    }
    if (loading) i18nUi.setText(field('summary'), i18nUi.message('Loading…'));
  }

  function renderInputs() {
    i18nUi.setHtml(field('inputs'), context.inputs.map(input => `<div class="sequence-viewer-assembly-input" data-assembly-row="${input.key}" data-assembly-loading="${input.loading ? 'true' : 'false'}">
      <div class="sequence-viewer-assembly-source"><strong>${escapeHtml(input.record.name)}</strong>
        <span class="small-note">${input.loading ? i18nUi.html('Loading…') : i18nUi.html('{length} bp', { length: input.record.sequence.length.toLocaleString() })}</span></div>
      <div class="sequence-viewer-assembly-row-actions">
        <button type="button" class="ghost-btn" data-assembly-remove ${i18nUi.attribute('aria-label', 'Remove fragment')}>×</button>
      </div>
    </div>`).join(''));
    refreshHighlights();
    preview();
  }

  async function toggleEntry(entryId, record = null) {
    if (!context || saving) return;
    const operation = context;
    if (!current(operation)) { close(); return; }
    const existing = operation.inputs.findIndex(input => input.entryId === entryId && entryId);
    if (existing >= 0) { operation.inputs.splice(existing, 1); renderInputs(); return; }
    const input = { entryId, key: globalThis.crypto.randomUUID(), loading: true,
      record: { name: record?.name || getEntryName(entryId), sequence: '' } };
    operation.inputs.push(input);
    renderInputs();
    try {
      const active = getActiveInput();
      if (!record && entryId && active?.entryId === entryId) record = active.record;
      if (!record) {
        const bridge = getBridge();
        if (typeof bridge?.sequenceLibraryGet !== 'function') throw new Error(i18nUi.text('The DNA fragment could not be loaded.'));
        const result = await bridge.sequenceLibraryGet({ storagePath: operation.storagePath, id: entryId, includeGbk: true });
        if (!result?.ok || !result.entry) throw new Error(result?.error || i18nUi.text('The DNA fragment could not be loaded.'));
        const parsed = parseInputRecords(result.gbkText || '');
        if (parsed.records?.length !== 1 || !parsed.records[0].sequence) throw new Error(i18nUi.text('The DNA fragment could not be loaded.'));
        record = { ...parsed.records[0], name: result.entry.name };
      }
      orientDnaAssemblyFragment({ record });
      if (!current(operation) || !operation.inputs.includes(input)) return;
      input.record = structuredClone(record);
      input.loading = false;
      renderInputs();
    } catch (error) {
      if (context === operation && operation.inputs.includes(input)) {
        operation.inputs.splice(operation.inputs.indexOf(input), 1);
        renderInputs();
        showError(error);
      }
    }
  }

  function ensureBanner() {
    if (banner || !rootDocument?.body) return banner;
    banner = rootDocument.createElement('form');
    banner.className = 'sequence-viewer-assembly-banner';
    banner.hidden = true;
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-labelledby', 'sequence-viewer-assembly-title');
    i18nUi.setHtml(banner, `<div class="sequence-viewer-assembly-head"><h4 id="sequence-viewer-assembly-title">${i18nUi.html('Assemble DNA')}</h4>
      <button type="button" class="ghost-btn" data-assembly-close data-assembly-cancel ${i18nUi.attribute('aria-label', 'Cancel')}>×</button></div>
      <p class="small-note" id="sequence-viewer-assembly-prompt">${i18nUi.html('Click DNA items to add or remove fragments, then click Assemble.')}</p>
      <div class="sequence-viewer-assembly-controls">
        <button type="button" class="ghost-btn" data-assembly-options aria-expanded="false">${i18nUi.html('Options')}</button>
        <button type="submit" class="primary-btn" data-assembly-save>${i18nUi.html('Assemble')}</button>
      </div>
      <div class="sequence-viewer-assembly-body" data-assembly-details hidden><fieldset data-assembly-fields>
        <div class="sequence-viewer-assembly-settings">
          <label data-assembly-overlap-field hidden>${i18nUi.html('Minimum overlap (bp)')}<input type="number" min="12" max="1000" step="1" value="15" data-assembly-overlap></label>
        </div>
        <div class="sequence-viewer-assembly-inputs" data-assembly-inputs></div>
        <label>${i18nUi.html('Assembled DNA name')}<input data-assembly-name maxlength="140" autocomplete="off"></label>
        <ul class="small-note sequence-viewer-assembly-junctions" data-assembly-junctions></ul>
      </fieldset></div>
      <p class="small-note" data-assembly-summary aria-live="polite"></p>
      <p class="sequence-viewer-fragment-error" data-assembly-error role="alert"></p>`);
    rootDocument.body.appendChild(banner);
    banner.addEventListener('click', event => {
      if (event.target.closest('[data-assembly-close]')) { close(); return; }
      if (event.target.closest('[data-assembly-options]')) {
        field('details').hidden = !field('details').hidden;
        field('options').setAttribute('aria-expanded', String(!field('details').hidden));
        return;
      }
      const row = event.target.closest('[data-assembly-row]');
      if (!row || !context || saving) return;
      if (event.target.closest('[data-assembly-remove]')) {
        context.inputs = context.inputs.filter(input => input.key !== row.dataset.assemblyRow);
        renderInputs();
      }
    });
    banner.addEventListener('input', preview);
    banner.addEventListener('change', preview);
    banner.addEventListener('submit', event => {
      event.preventDefault();
      void (async () => {
        if (!context || saving || context.inputs.some(input => input.loading)) return;
        const operation = context;
        try {
          if (!current(operation)) throw new Error(i18nUi.text('The storage folder changed. Start assembly again.'));
          const assembled = product();
          saving = true;
          preview();
          await saveAssembly(assembled, { id: operation.outputId, storagePath: operation.storagePath });
          saving = false;
          close();
        } catch (error) {
          saving = false;
          if (context === operation) { preview(); showError(error); }
        }
      })();
    });
    return banner;
  }

  async function open({ entryId = '', record = null } = {}) {
    if (!ensureBanner() || saving) return false;
    close();
    beforeOpen();
    context = { storagePath: getStoragePath(), inputs: [], outputId: globalThis.crypto.randomUUID() };
    field('overlap').value = '15';
    field('name').value = `${record?.name || getEntryName(entryId)}_assembly`;
    field('details').hidden = true;
    field('options').setAttribute('aria-expanded', 'false');
    banner.hidden = false;
    renderInputs();
    if (entryId || record?.sequence) await toggleEntry(entryId, record);
    return true;
  }

  function pickFromRail(event) {
    const entry = event.target.closest?.('[data-sequence-entry-id]');
    if (!context || !entry?.closest(listSelector)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === 'click' && event.detail < 2) void toggleEntry(entry.dataset.sequenceEntryId);
  }
  rootDocument?.addEventListener('click', pickFromRail, true);
  rootDocument?.addEventListener('dblclick', pickFromRail, true);
  rootDocument?.addEventListener('keydown', event => {
    if (context && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  }, true);
  return { open, close, refreshHighlights };
}
