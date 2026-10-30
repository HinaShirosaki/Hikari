import {
  bufferCandidateForm as resolveBufferCandidateForm,
  buildBufferCandidates as buildSharedBufferCandidates,
  extractCompoundMw,
  extractCompoundPka,
  findBufferCandidate as findSharedBufferCandidate,
  inferCompoundForm,
  normalizeBufferCandidateName
} from '../../../lib/bench-calculations.js';

// Autocomplete for the buffer preparer's compound field: candidate list from the
// chemistry table plus the chemical inventory, and the floating menu that shows
// it next to whichever row is being edited.
function createBufferSuggestions({
  doc,
  win,
  safeText,
  getElement,
  getStoredCompounds = () => [],
  BUFFER_SUGGESTION_MAX_HEIGHT,
  BUFFER_SUGGESTION_VIEWPORT_GAP,
  getBufferRowTotal = () => 0,
  renderCurrentTool
} = {}) {
  function buildBufferCandidates() {
    return buildSharedBufferCandidates({ storedCompounds: getStoredCompounds?.() });
  }

  function findBufferCandidate(name) {
    return findSharedBufferCandidate(name, { storedCompounds: getStoredCompounds?.() });
  }

  function bufferCandidateForm(name) {
    return resolveBufferCandidateForm(name, { storedCompounds: getStoredCompounds?.() });
  }

  function bufferRowCount() {
    return getBufferRowTotal();
  }

  function closeBufferSuggestions(index = null) {
    for (let rowIndex = 1; rowIndex <= bufferRowCount(); rowIndex += 1) {
      if (index && rowIndex !== index) {
        continue;
      }
      const menu = getElement(doc, `biology-notebook-tool-buffer-suggestions-${rowIndex}`);
      if (menu) {
        menu.hidden = true;
        menu.innerHTML = '';
      }
      getElement(doc, `biology-notebook-tool-buffer-name-${rowIndex}`)?.setAttribute?.('aria-expanded', 'false');
    }
  }

  function closeOtherBufferSuggestions(activeIndex) {
    for (let rowIndex = 1; rowIndex <= bufferRowCount(); rowIndex += 1) {
      if (rowIndex !== activeIndex) {
        closeBufferSuggestions(rowIndex);
      }
    }
  }

  function positionBufferSuggestions(index) {
    const input = getElement(doc, `biology-notebook-tool-buffer-name-${index}`);
    const menu = getElement(doc, `biology-notebook-tool-buffer-suggestions-${index}`);
    const inputRect = input?.getBoundingClientRect?.();
    const viewportWidth = Number(doc?.documentElement?.clientWidth)
      || Number(win?.innerWidth)
      || 0;
    const viewportHeight = Number(doc?.documentElement?.clientHeight)
      || Number(win?.innerHeight)
      || 0;
    if (!inputRect || !viewportWidth || !viewportHeight || !menu?.style) {
      return false;
    }

    const overlayRoot = doc?.body;
    if (overlayRoot && typeof overlayRoot.appendChild === 'function' && menu.parentElement !== overlayRoot) {
      overlayRoot.appendChild(menu);
    }
    menu.classList?.add?.('biology-notebook-buffer-suggestions--floating');

    const width = Math.min(
      Math.max(Number(inputRect.width) || 0, 1) + 2,
      Math.max(viewportWidth - (BUFFER_SUGGESTION_VIEWPORT_GAP * 2), 1)
    );
    const left = Math.min(
      Math.max((Number(inputRect.left) || 0) - 1, BUFFER_SUGGESTION_VIEWPORT_GAP),
      Math.max(BUFFER_SUGGESTION_VIEWPORT_GAP, viewportWidth - width - BUFFER_SUGGESTION_VIEWPORT_GAP)
    );
    const spaceBelow = Math.max(0, viewportHeight - Number(inputRect.bottom) - BUFFER_SUGGESTION_VIEWPORT_GAP);
    const spaceAbove = Math.max(0, Number(inputRect.top) - BUFFER_SUGGESTION_VIEWPORT_GAP);

    menu.style.left = `${Math.round(left)}px`;
    menu.style.right = 'auto';
    menu.style.width = `${Math.round(width)}px`;
    menu.hidden = false;

    const menuHeight = Math.min(
      BUFFER_SUGGESTION_MAX_HEIGHT,
      Number(menu.scrollHeight) || BUFFER_SUGGESTION_MAX_HEIGHT
    );
    if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
      menu.style.top = 'auto';
      menu.style.bottom = `${Math.round(viewportHeight - Number(inputRect.top) + 1)}px`;
      menu.style.maxHeight = `${Math.round(Math.min(BUFFER_SUGGESTION_MAX_HEIGHT, spaceAbove))}px`;
    } else {
      menu.style.top = `${Math.round(Number(inputRect.bottom) - 1)}px`;
      menu.style.bottom = 'auto';
      menu.style.maxHeight = `${Math.round(Math.min(BUFFER_SUGGESTION_MAX_HEIGHT, spaceBelow))}px`;
    }
    return true;
  }

  function repositionOpenBufferSuggestions() {
    for (let index = 1; index <= bufferRowCount(); index += 1) {
      const menu = getElement(doc, `biology-notebook-tool-buffer-suggestions-${index}`);
      if (menu && !menu.hidden) {
        positionBufferSuggestions(index);
      }
    }
  }

  function renderBufferSuggestions(index) {
    const input = getElement(doc, `biology-notebook-tool-buffer-name-${index}`);
    const menu = getElement(doc, `biology-notebook-tool-buffer-suggestions-${index}`);
    if (!input || !menu) {
      return;
    }
    closeOtherBufferSuggestions(index);
    const query = String(input.value || '').trim().toLowerCase();
    const matches = buildBufferCandidates()
      .filter((candidate) => {
        if (!query) {
          return true;
        }
        return candidate.name.toLowerCase().includes(query)
          || String(candidate.category || '').toLowerCase().includes(query);
      })
      .slice(0, 8);
    if (!matches.length) {
      closeBufferSuggestions(index);
      return;
    }
    const escapeText = typeof safeText === 'function' ? safeText : (value) => String(value || '');
    menu.innerHTML = matches.map((candidate) => {
      const meta = [
        candidate.mw ? `${candidate.mw} g/mol` : '',
        candidate.pKa ? `pKa ${candidate.pKa}` : '',
        candidate.category,
        candidate.source
      ].filter(Boolean).join(' · ');
      return `
        <button type="button" class="biology-notebook-buffer-suggestion" data-buffer-candidate="${escapeText(candidate.name)}" role="option">
          <strong>${escapeText(candidate.name)}</strong>
          <span>${escapeText(meta)}</span>
        </button>
      `;
    }).join('');
    menu.hidden = false;
    input.setAttribute?.('aria-expanded', 'true');
    positionBufferSuggestions(index);
  }

  function selectBufferCandidate(index, candidateName) {
    const candidate = findBufferCandidate(candidateName);
    const nameInput = getElement(doc, `biology-notebook-tool-buffer-name-${index}`);
    const mwInput = getElement(doc, `biology-notebook-tool-buffer-mw-${index}`);
    if (!candidate || !nameInput) {
      return;
    }
    nameInput.value = candidate.name;
    if (mwInput && candidate.mw) {
      mwInput.value = candidate.mw;
    }
    closeBufferSuggestions(index);
    renderCurrentTool();
  }


  return {
    extractCompoundMw,
    extractCompoundPka,
    inferCompoundForm,
    normalizeCandidateName: normalizeBufferCandidateName,
    buildBufferCandidates,
    findBufferCandidate,
    bufferCandidateForm,
    bufferRowCount,
    closeBufferSuggestions,
    closeOtherBufferSuggestions,
    positionBufferSuggestions,
    repositionOpenBufferSuggestions,
    renderBufferSuggestions,
    selectBufferCandidate
  };
}

export { createBufferSuggestions };
