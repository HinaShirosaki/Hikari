import { resolveBufferCompound } from '../../../lib/bench-calculations.js';
import { BUFFER_COMPOUNDS } from '../../../lib/chemistry/buffer-compounds.js';

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
  function extractCompoundMw(record) {
    const source = record && typeof record === 'object' ? record : {};
    const keys = ['mw', 'molecularWeight', 'molecular_weight', 'formulaWeight', 'formula_weight', 'formulaMass', 'molarMass', 'fw'];
    for (const key of keys) {
      const parsed = Number(source[key]);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return '';
  }

  function extractCompoundPka(record) {
    const source = record && typeof record === 'object' ? record : {};
    const keys = ['pKa', 'pka', 'pkaValue', 'pka_value'];
    for (const key of keys) {
      const parsed = Number(source[key]);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return '';
  }

  function inferCompoundForm(record) {
    const source = record && typeof record === 'object' ? record : {};
    const formText = [
      source.form,
      source.physicalForm,
      source.state,
      source.type,
      source.unitSize,
      source.amountInStock
    ].map((item) => String(item || '').toLowerCase()).join(' ');
    return /\b(liquid|solution|ml|ul|l)\b/.test(formText) ? 'liquid' : 'solid';
  }

  function normalizeCandidateName(value) {
    return String(value || '').trim().toLowerCase();
  }

  function buildBufferCandidates() {
    const candidates = new Map();
    function mergeCandidate(candidate) {
      const name = String(candidate?.name || '').trim();
      if (!name) {
        return;
      }
      const key = normalizeCandidateName(name);
      const existing = candidates.get(key);
      if (!existing) {
        candidates.set(key, {
          ...candidate,
          name
        });
        return;
      }
      if (candidate.source === 'Stored') {
        candidates.set(key, {
          ...existing,
          ...candidate,
          mw: candidate.mw || existing.mw,
          form: candidate.form || existing.form,
          category: candidate.category || existing.category,
          pKa: candidate.pKa || existing.pKa
        });
        return;
      }
      candidates.set(key, {
        ...existing,
        mw: existing.mw || candidate.mw,
        form: existing.form || candidate.form,
        category: existing.category || candidate.category,
        pKa: existing.pKa || candidate.pKa
      });
    }

    (Array.isArray(getStoredCompounds?.()) ? getStoredCompounds() : []).forEach((record) => {
      mergeCandidate({
        source: 'Stored',
        name: record?.name,
        mw: extractCompoundMw(record),
        pKa: extractCompoundPka(record),
        form: inferCompoundForm(record),
        category: record?.casNumber ? `CAS ${record.casNumber}` : 'Stored compound'
      });
    });
    BUFFER_COMPOUNDS.forEach((compound) => {
      mergeCandidate({
        source: 'Tools',
        name: compound.name,
        mw: compound.mw,
        pKa: compound.pKa,
        form: compound.form === 'liquid' ? 'liquid' : 'solid',
        category: compound.category || 'Buffer compound'
      });
    });
    return [...candidates.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  function findBufferCandidate(name) {
    const key = normalizeCandidateName(name);
    if (!key) {
      return null;
    }
    return buildBufferCandidates().find((candidate) => normalizeCandidateName(candidate.name) === key)
      || resolveBufferCompound(name)
      || null;
  }

  function bufferCandidateForm(name) {
    const candidate = findBufferCandidate(name);
    return candidate?.form === 'liquid' ? 'liquid' : 'solid';
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
    normalizeCandidateName,
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
