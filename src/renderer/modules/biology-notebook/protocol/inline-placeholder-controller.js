import {
  formatSampleLinkValue,
  getSampleTypeLabel
} from '../samples/sample-helpers.js';

export function createInlinePlaceholderController({
  stepsHost,
  getSampleLink,
  deleteSampleLink,
  getSettings,
  onOpenSampleLinkMenu,
  onPersistSampleLinks,
  onValueCommitted
} = {}) {
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
    token.textContent = cleanValue || `[${name}]`;
    token.classList.toggle('is-empty', !cleanValue);
    token.classList.toggle('is-linked-sample', Boolean(sampleLink?.sampleId));
    token.title = sampleLink?.sampleId
      ? `Linked sample: ${formatSampleLinkValue(sampleLink)}. Right-click to replace.`
      : (wrap.dataset.samplePlaceholderType
        ? `Right-click to link a ${getSampleTypeLabel(wrap.dataset.samplePlaceholderType, typeof getSettings === 'function' ? getSettings() : {})} sample.`
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
    onValueCommitted?.({ key, value: cleanValue });
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
  }

  function onInput(event) {
    const editor = event.target.closest('[data-inline-input]');
    if (editor) {
      resizeEditorForValue(editor);
    }
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
    stepsHost.addEventListener('input', onInput);
    stepsHost.addEventListener('blur', onBlur, true);
    stepsHost.addEventListener('keydown', onKeydown);
  }

  return {
    bindEvents
  };
}
