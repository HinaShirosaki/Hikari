import { normalizeSampleType } from '../../lib/inventory-settings.js';
import { WELL_DISPLAY_FIELDS, isWellDisplayField, saveWellDisplayPreferences } from './well-display.js';

function getFieldControls(editor) {
  const wellFields = WELL_DISPLAY_FIELDS.map(field => [
    field, editor.querySelector(`[data-well-sample-${field}], [data-well-sample-new-${field}]`)
  ]);
  const type = normalizeSampleType(wellFields.find(([field]) => field === 'type')[1]?.value);
  const typeFields = Array.from(editor.querySelectorAll('[data-sample-detail]'), control => [
    `${type}.${control.dataset.sampleDetail}`, control
  ]);
  return [...wellFields, ...typeFields];
}

export function bindWellFieldPicker(inventorySections, uiState, onFieldChanged) {
  const trigger = inventorySections.querySelector('[data-well-field-trigger]');
  if (!trigger) return;
  const editor = inventorySections.querySelector('[data-well-display-editor]');
  const actions = inventorySections.querySelector('[data-well-field-actions]');

  function setPicking(picking) {
    uiState.pickingWellField = picking;
    trigger.setAttribute('aria-pressed', String(picking));
    if (!editor) return;
    actions.hidden = !picking;
    for (const [field, control] of getFieldControls(editor)) {
      const caption = control?.closest('label')?.querySelector(':scope > [data-i18n]');
      if (!caption || !isWellDisplayField(field)) continue;
      control.inert = picking;
      if (picking) {
        caption.dataset.wellFieldChoice = field;
        caption.setAttribute('role', 'checkbox');
        caption.tabIndex = 0;
        caption.setAttribute('aria-checked', String(uiState.wellDisplay.fields.includes(field)));
      } else {
        delete caption.dataset.wellFieldChoice;
        caption.removeAttribute('role');
        caption.removeAttribute('tabindex');
        caption.removeAttribute('aria-checked');
      }
    }
  }

  function updateFields(fields) {
    uiState.wellDisplay.fields = fields;
    saveWellDisplayPreferences(uiState.wellDisplay);
    setPicking(true);
    onFieldChanged();
  }

  function toggleField(caption) {
    const { wellFieldChoice: field } = caption.dataset;
    const { fields } = uiState.wellDisplay;
    updateFields(fields.includes(field) ? fields.filter(item => item !== field) : [...fields, field]);
    caption.focus({ preventScroll: true });
  }

  function finishPicking() {
    setPicking(false);
    trigger.focus({ preventScroll: true });
  }

  setPicking(Boolean(uiState.pickingWellField));
  trigger.addEventListener('click', () => {
    setPicking(!uiState.pickingWellField);
    if (!uiState.pickingWellField) return;
    if (!editor) {
      const firstWell = inventorySections.querySelector('.well:has(.well-sample-label)')
        || inventorySections.querySelector('.well');
      firstWell?.click();
    }
    inventorySections.querySelector('[data-well-field-choice]')?.focus({ preventScroll: true });
  });

  function onEscape(event) {
    if (!uiState.pickingWellField || event.key !== 'Escape') return;
    event.preventDefault();
    finishPicking();
  }
  trigger.addEventListener('keydown', onEscape);
  editor?.addEventListener('keydown', onEscape);

  inventorySections.querySelector('[data-well-field-done]')?.addEventListener('click', finishPicking);
  inventorySections.querySelector('[data-well-clear-field]')?.addEventListener('click', () => updateFields([]));

  editor?.addEventListener('click', event => {
    if (!uiState.pickingWellField) return;
    const caption = event.target.closest('label')?.querySelector('[data-well-field-choice]');
    if (!caption) return;
    event.preventDefault();
    toggleField(caption);
  });

  editor?.addEventListener('keydown', event => {
    const field = event.target.dataset.wellFieldChoice;
    if (!field || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    toggleField(event.target);
  });
}
