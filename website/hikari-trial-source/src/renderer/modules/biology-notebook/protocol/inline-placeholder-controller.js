import {
  buildNotebookSampleLinkMetadata,
  formatSampleLinkValue,
  getSampleTypeLabel
} from '../samples/sample-helpers.js';
import { createPlaceholderSuggestions } from '../samples/placeholder-suggestions.js';

export function createInlinePlaceholderController({
  stepsHost,
  getSampleLink,
  deleteSampleLink,
  setSampleLink,
  getSamples = () => [],
  getInventory = () => ({}),
  getSettings,
  onOpenSampleLinkMenu,
  onPersistSampleLinks,
  onValueCommitted
} = {}) {
  const suggestions = createPlaceholderSuggestions({
    stepsHost, getSamples, getInventory,
    getSettings: () => getSettings?.() || {},
    onSelect: (editor, sample) => commitEditor(editor, sample)
  });
  let committing = false;
  function renderedWidth(element) {
    const rect = typeof element?.getBoundingClientRect === 'function'
      ? element.getBoundingClientRect()
      : null;
    const width = Number(rect?.width) || Number(element?.offsetWidth) || 0;
    return Math.max(0, width);
  }

  function setEditorInitialWidth(editor, token) {
    const width = renderedWidth(token);
    if (!editor?.style || !width) {
      return;
    }
    editor.dataset.inlineEditorBaseWidth = String(width);
    editor.style.width = `${width}px`;
  }

  function resizeEditorForValue(editor) {
    const baseWidth = Number(editor?.dataset?.inlineEditorBaseWidth) || 0;
    if (!editor?.style || !baseWidth) {
      return;
    }
    editor.style.width = '1px';
    const contentWidth = Math.ceil(Number(editor.scrollWidth) || 0);
    editor.style.width = `${Math.max(baseWidth, contentWidth)}px`;
  }

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
    const suggestion = cleanValue ? '' : (wrap.dataset.suggestedValue || '');
    token.textContent = cleanValue || suggestion || `[${name}]`;
    token.classList.toggle('is-empty', !cleanValue);
    token.classList.toggle('is-suggested', Boolean(suggestion));
    token.classList.toggle('is-linked-sample', Boolean(sampleLink?.sampleId));
    token.title = sampleLink?.sampleId
      ? `Linked sample: ${formatSampleLinkValue(sampleLink)}. Click and type to replace.`
      : (wrap.dataset.samplePlaceholderType
        ? `Click and type to find a ${getSampleTypeLabel(wrap.dataset.samplePlaceholderType, typeof getSettings === 'function' ? getSettings() : {})} sample.`
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

  function closeEditor(editor) {
    suggestions.close();
    const wrap = editor.closest('[data-inline-placeholder]');
    const hiddenValue = wrap?.querySelector('[data-nb-key]');
    const token = wrap?.querySelector('[data-inline-token]');
    if (!wrap || !hiddenValue || !token) {
      return;
    }
    refreshTokenFromValue(wrap);
  }

  function commitEditor(editor, selectedSample = null) {
    if (committing) return;
    committing = true;
    try {
      const wrap = editor.closest('[data-inline-placeholder]');
      const hiddenValue = wrap?.querySelector('[data-nb-key]');
      if (!hiddenValue) {
        closeEditor(editor);
        return;
      }

      const key = String(hiddenValue.dataset.nbKey || '').trim();
      const existingLink = key ? getSampleLink(key) : null;
      let selectedLink = null;
      if (selectedSample && key && setSampleLink) {
        selectedLink = buildNotebookSampleLinkMetadata({
          key,
          name: wrap.dataset.placeholderName,
          placeholderType: selectedSample.type,
          sample: selectedSample,
          existingLink,
          inventory: getInventory()
        });
        setSampleLink(key, selectedLink);
        editor.value = formatSampleLinkValue(selectedLink);
      }
      const cleanValue = editor.value.trim();
      let removedSampleLink = false;
      if (!selectedLink && existingLink && cleanValue !== formatSampleLinkValue(existingLink)) {
        deleteSampleLink(key);
        removedSampleLink = true;
      }
      hiddenValue.value = cleanValue;
      if (wrap.dataset.carriedOver && cleanValue !== wrap.dataset.suggestedValue) {
        delete wrap.dataset.carriedOver;
      }
      closeEditor(editor);
      if (removedSampleLink || selectedLink) {
        onPersistSampleLinks?.();
      }
      onValueCommitted?.({ key, value: cleanValue });
    } finally {
      committing = false;
    }
  }

  function onContextMenu(event) {
    const token = event.target.closest('[data-inline-token]');
    if (!token) {
      return;
    }
    const wrap = token.closest('[data-inline-placeholder]');
    if (!wrap) {
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
    setEditorInitialWidth(editor, token);
    token.hidden = true;
    editor.hidden = false;
    editor.focus();
    editor.select();
    suggestions.update(editor);
  }

  function onInput(event) {
    const editor = event.target.closest('[data-inline-input]');
    if (editor) {
      resizeEditorForValue(editor);
      suggestions.update(editor);
    }
  }

  function onBlur(event) {
    const editor = event.target.closest('[data-inline-input]');
    if (!editor || editor.hidden) {
      return;
    }
    commitEditor(editor);
  }

  function onKeydown(event) {
    if (event.isComposing || suggestions.onKeydown(event)) return;
    const editor = event.target.closest('[data-inline-input]');
    if (!editor) {
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      commitEditor(editor);
      return;
    }

    if (event.key === 'Tab' && !event.shiftKey && !editor.value.trim()) {
      const wrap = editor.closest('[data-inline-placeholder]');
      const suggestion = wrap?.dataset.suggestedValue || '';
      if (suggestion) {
        // Accepting ghost text is the one way a value enters without being
        // typed; the mark survives to the saved page as provenance.
        event.preventDefault();
        editor.value = suggestion;
        wrap.dataset.carriedOver = '1';
        commitEditor(editor);
        return;
      }
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
    stepsHost.addEventListener('input', onInput);
    stepsHost.addEventListener('blur', onBlur, true);
    stepsHost.addEventListener('keydown', onKeydown);
  }

  return {
    bindEvents
  };
}
