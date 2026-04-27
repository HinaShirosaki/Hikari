import {
  buildNotebookSampleLinkMetadata,
  buildNotebookSampleNote,
  formatSampleLinkValue,
  formatSampleRecordLabel,
  getSampleTypeLabel
} from './sample-helpers.js';

export function createInlinePlaceholderController({
  stepsHost,
  getSampleLink,
  setSampleLink,
  deleteSampleLink,
  getInventory,
  onOpenSampleLinkMenu,
  onCloseSampleLinkMenu,
  onAppendResultLine,
  onPersistSampleLinks
} = {}) {
  function refreshTokenFromValue(wrap) {
    const hiddenValue = wrap?.querySelector('[data-nb-key]');
    const token = wrap?.querySelector('[data-inline-token]');
    const editor = wrap?.querySelector('[data-inline-input]');
    if (!wrap || !hiddenValue || !token) {
      return;
    }
    const key = String(hiddenValue.dataset.nbKey || token.dataset.nbKeyRef || '').trim();
    const name = wrap.dataset.placeholderName || 'value';
    const cleanValue = hiddenValue.value || '';
    const sampleLink = key ? getSampleLink(key) : null;
    token.textContent = cleanValue || `[${name}]`;
    token.classList.toggle('is-empty', !cleanValue);
    token.classList.toggle('is-linked-sample', Boolean(sampleLink?.sampleId));
    token.title = sampleLink?.sampleId
      ? `Linked sample: ${formatSampleLinkValue(sampleLink)}. Right-click to replace.`
      : (wrap.dataset.samplePlaceholderType
        ? `Right-click to link a ${getSampleTypeLabel(wrap.dataset.samplePlaceholderType)} sample.`
        : '');
    if (sampleLink?.sampleId) {
      wrap.dataset.linkedSampleId = sampleLink.sampleId;
    } else {
      delete wrap.dataset.linkedSampleId;
    }
    if (editor) {
      editor.hidden = true;
    }
    token.hidden = false;
  }

  function linkSample({ menuState, sample } = {}) {
    if (!menuState?.wrap) {
      return;
    }
    const { wrap, key, placeholderName, placeholderType } = menuState;
    const hiddenValue = wrap.querySelector('[data-nb-key]');
    const editor = wrap.querySelector('[data-inline-input]');
    if (!hiddenValue) {
      return;
    }
    const link = buildNotebookSampleLinkMetadata({
      key,
      name: placeholderName,
      placeholderType,
      sample,
      existingLink: getSampleLink(key),
      inventory: typeof getInventory === 'function' ? getInventory() : {}
    });
    setSampleLink(key, link);
    hiddenValue.value = formatSampleRecordLabel(sample);
    if (editor) {
      editor.value = hiddenValue.value;
    }
    refreshTokenFromValue(wrap);
    onAppendResultLine?.(buildNotebookSampleNote(link, 'Linked'));
    onPersistSampleLinks?.();
    onCloseSampleLinkMenu?.();
  }

  function closeEditor(editor) {
    const wrap = editor.closest('[data-inline-placeholder]');
    const hiddenValue = wrap?.querySelector('[data-nb-key]');
    const token = wrap?.querySelector('[data-inline-token]');
    if (!wrap || !hiddenValue || !token) {
      return;
    }
    refreshTokenFromValue(wrap);
  }

  function commitEditor(editor) {
    const wrap = editor.closest('[data-inline-placeholder]');
    const hiddenValue = wrap?.querySelector('[data-nb-key]');
    if (!hiddenValue) {
      closeEditor(editor);
      return;
    }

    const cleanValue = editor.value.trim();
    const key = String(hiddenValue.dataset.nbKey || '').trim();
    const existingLink = key ? getSampleLink(key) : null;
    let removedSampleLink = false;
    if (existingLink && cleanValue !== formatSampleLinkValue(existingLink)) {
      deleteSampleLink(key);
      removedSampleLink = true;
    }
    hiddenValue.value = cleanValue;
    closeEditor(editor);
    if (removedSampleLink) {
      onPersistSampleLinks?.();
    }
  }

  function onContextMenu(event) {
    const token = event.target.closest('[data-inline-token]');
    if (!token) {
      return;
    }
    const wrap = token.closest('[data-inline-placeholder]');
    if (!wrap?.dataset?.samplePlaceholderType) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onOpenSampleLinkMenu?.({
      wrap,
      token,
      x: event.clientX,
      y: event.clientY
    });
  }

  function onClick(event) {
    const token = event.target.closest('[data-inline-token]');
    if (!token) {
      return;
    }

    const wrap = token.closest('[data-inline-placeholder]');
    if (!wrap) {
      return;
    }

    const editor = wrap.querySelector('[data-inline-input]');
    const hiddenValue = wrap.querySelector('[data-nb-key]');
    if (!editor || !hiddenValue) {
      return;
    }

    editor.value = hiddenValue.value || '';
    token.hidden = true;
    editor.hidden = false;
    editor.focus();
    editor.select();
  }

  function onBlur(event) {
    const editor = event.target.closest('[data-inline-input]');
    if (!editor) {
      return;
    }
    commitEditor(editor);
  }

  function onKeydown(event) {
    const editor = event.target.closest('[data-inline-input]');
    if (!editor) {
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      commitEditor(editor);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      const wrap = editor.closest('[data-inline-placeholder]');
      const hiddenValue = wrap?.querySelector('[data-nb-key]');
      if (hiddenValue) {
        editor.value = hiddenValue.value || '';
      }
      closeEditor(editor);
    }
  }

  function bindEvents() {
    if (!stepsHost) {
      return;
    }
    stepsHost.addEventListener('click', onClick);
    stepsHost.addEventListener('contextmenu', onContextMenu);
    stepsHost.addEventListener('blur', onBlur, true);
    stepsHost.addEventListener('keydown', onKeydown);
  }

  return {
    bindEvents,
    linkSample
  };
}
