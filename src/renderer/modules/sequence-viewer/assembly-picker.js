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
      name: field('name').value, method: field('method').value,
      topology: field('topology').value, minimumOverlap: Number(field('overlap').value)
    });
  }

  function preview() {
    if (!context) return;
    const loading = context.inputs.some(input => input.loading);
    const pcr = field('method').value === 'overlap-pcr';
    field('overlap-field').hidden = !pcr;
    if (pcr) field('topology').value = 'linear';
    field('topology').disabled = pcr;
    field('fields').disabled = saving;
    field('method').disabled = saving;
    field('close').disabled = saving;
    field('save').disabled = true;
    i18nUi.setText(field('save'), i18nUi.message(saving ? 'Saving…' : 'Assemble'));
    i18nUi.setText(field('error'), '');
    i18nUi.setHtml(field('junctions'), '');
    try {
      const result = product();
      i18nUi.setText(field('summary'), i18nUi.message('{length} bp · {count} fragments', {
        length: result.sequence.length.toLocaleString(), count: context.inputs.length
      }));
      i18nUi.setHtml(field('junctions'), result.junctions.map(junction => `<li>${i18nUi.html(
        pcr ? '{left} → {right}: {length} bp overlap' : '{left} → {right}: compatible ends',
        { left: junction.left, right: junction.right, length: junction.overlap })}</li>`).join(''));
      field('save').disabled = saving || loading;
    } catch (error) {
      i18nUi.setText(field('summary'), error.assemblyCode === 'fragments' ? i18nUi.message('Choose at least two DNA fragments.') : '');
      if (error.assemblyCode !== 'fragments') showError(error);
    }
    if (loading) i18nUi.setText(field('summary'), i18nUi.message('Loading…'));
  }

  function renderInputs() {
    i18nUi.setText(field('selected-names'), context.inputs.map(input => input.record.name).join(' → '));
    i18nUi.setHtml(field('inputs'), context.inputs.map((input, index) => `<div class="sequence-viewer-assembly-input" data-assembly-row="${input.key}" data-assembly-loading="${input.loading ? 'true' : 'false'}">
      <div class="sequence-viewer-assembly-source"><strong>${escapeHtml(input.record.name)}</strong>
        <span class="small-note">${input.loading ? i18nUi.html('Loading…') : i18nUi.html('{length} bp', { length: input.record.sequence.length.toLocaleString() })}</span></div>
      <select data-assembly-orientation="${input.key}"${input.loading ? ' disabled' : ''} ${i18nUi.attribute('aria-label', 'Fragment orientation')}>
        ${i18nUi.option('forward', i18nUi.message('Forward')).replace('<option', `<option${input.orientation === 'forward' ? ' selected' : ''}`)}
        ${i18nUi.option('reverse', i18nUi.message('Reverse complement')).replace('<option', `<option${input.orientation === 'reverse' ? ' selected' : ''}`)}
      </select>
      <div class="sequence-viewer-assembly-row-actions">
        <button type="button" class="ghost-btn" data-assembly-move="up" ${index === 0 ? 'disabled' : ''} ${i18nUi.attribute('aria-label', 'Move fragment up')}>↑</button>
        <button type="button" class="ghost-btn" data-assembly-move="down" ${index === context.inputs.length - 1 ? 'disabled' : ''} ${i18nUi.attribute('aria-label', 'Move fragment down')}>↓</button>
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
    const input = { entryId, key: globalThis.crypto.randomUUID(), orientation: 'forward', loading: true,
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
      <p class="small-note sequence-viewer-assembly-selected" data-assembly-selected-names aria-live="polite"></p>
      <div class="sequence-viewer-assembly-controls">
        <select data-assembly-method ${i18nUi.attribute('aria-label', 'Method')}>${i18nUi.option('sticky', i18nUi.message('Sticky-end ligation'))}${i18nUi.option('blunt', i18nUi.message('Blunt-end T4 ligation'))}${i18nUi.option('overlap-pcr', i18nUi.message('Overlap PCR'))}</select>
        <button type="button" class="ghost-btn" data-assembly-options aria-expanded="false">${i18nUi.html('Options')}</button>
        <button type="submit" class="primary-btn" data-assembly-save>${i18nUi.html('Assemble')}</button>
      </div>
      <div class="sequence-viewer-assembly-body" data-assembly-details hidden><fieldset data-assembly-fields>
        <div class="sequence-viewer-assembly-settings">
          <label>${i18nUi.html('Product topology')}<select data-assembly-topology>${i18nUi.option('linear', i18nUi.message('Linear'))}${i18nUi.option('circular', i18nUi.message('Circular'))}</select></label>
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
      const index = context.inputs.findIndex(input => input.key === row.dataset.assemblyRow);
      if (event.target.closest('[data-assembly-remove]')) { context.inputs.splice(index, 1); renderInputs(); return; }
      const move = event.target.closest('[data-assembly-move]');
      if (!move) return;
      const next = index + (move.dataset.assemblyMove === 'up' ? -1 : 1);
      if (next < 0 || next >= context.inputs.length) return;
      [context.inputs[index], context.inputs[next]] = [context.inputs[next], context.inputs[index]];
      renderInputs();
      banner.querySelector(`[data-assembly-row="${row.dataset.assemblyRow}"] [data-assembly-move="${move.dataset.assemblyMove}"]`)?.focus();
    });
    banner.addEventListener('input', preview);
    banner.addEventListener('change', event => {
      if (event.target.matches('[data-assembly-orientation]')) {
        const input = context?.inputs.find(input => input.key === event.target.dataset.assemblyOrientation);
        if (input) input.orientation = event.target.value;
      }
      preview();
    });
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
    field('method').value = 'sticky';
    field('topology').value = 'linear';
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
