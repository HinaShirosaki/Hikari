import { escapeHtml } from '../../lib/html.js';
import { showTransientNotice } from '../../lib/notify.js';
import { asArray } from '../../lib/normalize.js';
import {
  DEFAULT_PRIMER_ORDER_PURIFICATION,
  DEFAULT_PRIMER_ORDER_SCALE,
  IDT_BULK_INPUT_URL,
  PRIMER_ORDER_PURIFICATIONS,
  PRIMER_ORDER_SCALES,
  buildIdtBulkInput,
  buildPrimerOrderCsv,
  buildPrimerOrderWarnings
} from './primer-order.js';

// Ordering is a clipboard job, not a file job: IDT's Bulk Input takes a paste,
// and the other vendors want their four fields pasted into their own template.
export function createPrimerOrderController(config = {}) {
  const elements = config?.elements || {};
  const getBridge = config?.getBridge || (() => null);
  const setStatus = config?.setStatus || (() => {});

  let primers = [];
  let scale = DEFAULT_PRIMER_ORDER_SCALE;
  let purification = DEFAULT_PRIMER_ORDER_PURIFICATION;

  function fillSelect(select, options, selected) {
    if (!select) {
      return;
    }
    select.innerHTML = options
      .map((option) => `<option value="${escapeHtml(option.value)}"${option.value === selected ? ' selected' : ''}>${escapeHtml(option.label)}</option>`)
      .join('');
    select.value = selected;
  }

  function render() {
    const options = { scale, purification };
    if (elements.primerOrderPreview) {
      elements.primerOrderPreview.value = buildIdtBulkInput(primers, options);
    }
    if (elements.primerOrderWarnings) {
      const warnings = buildPrimerOrderWarnings(primers, options);
      elements.primerOrderWarnings.innerHTML = warnings.length
        ? warnings.map((warning) => `<p class="small-note sequence-viewer-primer-order-warning">${escapeHtml(warning)}</p>`).join('')
        : `<p class="small-note">${primers.length.toLocaleString()} primer${primers.length === 1 ? '' : 's'} ready to order.</p>`;
    }
  }

  function hide() {
    if (elements.primerOrderOverlay) {
      elements.primerOrderOverlay.hidden = true;
    }
  }

  function open(nextPrimers) {
    primers = asArray(nextPrimers).filter((primer) => String(primer?.primerSequence || primer?.sequence || '').trim());
    if (!primers.length) {
      setStatus('Design primers before building an order form.', true);
      return false;
    }
    fillSelect(elements.primerOrderScaleSelect, PRIMER_ORDER_SCALES, scale);
    fillSelect(elements.primerOrderPurificationSelect, PRIMER_ORDER_PURIFICATIONS, purification);
    render();
    if (elements.primerOrderOverlay) {
      elements.primerOrderOverlay.hidden = false;
    }
    elements.primerOrderCopyIdtBtn?.focus?.();
    return true;
  }

  async function copy(text, label) {
    const value = String(text || '');
    if (!value) {
      return;
    }
    const bridge = getBridge();
    if (typeof bridge?.writeTextToClipboard === 'function') {
      const result = await bridge.writeTextToClipboard(value);
      if (result?.ok) {
        showTransientNotice(`Copied ${label}.`);
        return;
      }
    }
    const clipboard = globalThis.navigator?.clipboard;
    if (typeof clipboard?.writeText === 'function') {
      try {
        await clipboard.writeText(value);
        showTransientNotice(`Copied ${label}.`);
        return;
      } catch {
        // fall through to the failure notice
      }
    }
    showTransientNotice('Clipboard access is unavailable; copy from the preview box.', { type: 'error' });
  }

  function bindEvents() {
    elements.primerOrderCloseBtn?.addEventListener('click', hide);
    elements.primerOrderOverlay?.addEventListener('click', (event) => {
      if (event?.target === elements.primerOrderOverlay) {
        hide();
      }
    });
    elements.primerOrderScaleSelect?.addEventListener('change', () => {
      scale = String(elements.primerOrderScaleSelect.value || DEFAULT_PRIMER_ORDER_SCALE);
      render();
    });
    elements.primerOrderPurificationSelect?.addEventListener('change', () => {
      purification = String(elements.primerOrderPurificationSelect.value || DEFAULT_PRIMER_ORDER_PURIFICATION);
      render();
    });
    elements.primerOrderCopyIdtBtn?.addEventListener('click', () => {
      void copy(buildIdtBulkInput(primers, { scale, purification }), 'IDT bulk input block');
    });
    elements.primerOrderCopyCsvBtn?.addEventListener('click', () => {
      void copy(buildPrimerOrderCsv(primers, { scale, purification }), 'order CSV');
    });
    elements.primerOrderOpenIdtBtn?.addEventListener('click', () => {
      const bridge = getBridge();
      if (typeof bridge?.openExternalUrl !== 'function') {
        setStatus(`Open ${IDT_BULK_INPUT_URL} to paste the block.`, true);
        return;
      }
      void bridge.openExternalUrl(IDT_BULK_INPUT_URL);
    });
  }

  return { bindEvents, hide, open };
}
