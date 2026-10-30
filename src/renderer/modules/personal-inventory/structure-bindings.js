import { createPresentation } from "../../lib/i18n/presentation.js";
import "./localization.js";
const i18nUi = createPresentation("samples");
import { sampleUi, sampleNotice } from './localization.js';
import { renderTypeFieldsMarkup } from './type-fields.js';

export function bindStructureButtons(ctx) {
  const { inventorySections } = ctx.elements;
  const syncStructureButtons = (...args) => ctx.syncStructureButtons(...args);
  const pasteInventoryStructure = (...args) => ctx.pasteInventoryStructure(...args);
  const setStructureStatus = (...args) => ctx.setStructureStatus(...args);

  [
    '[data-well-sample-type]',
    '[data-well-sample-new-type]',
    '[data-single-sample-type]',
    '[data-single-sample-new-type]'
  ].forEach((selector) => {
    inventorySections.querySelectorAll(selector).forEach((select) => {
      select.addEventListener('change', syncStructureButtons);
      select.addEventListener('change', () => {
        const fields = select.closest?.('.well-inline-editor')?.querySelector('[data-sample-type-fields]');
        if (fields) {
          i18nUi.setHtml(fields, renderTypeFieldsMarkup(select.value));
        }
      });
    });
  });

  inventorySections.querySelectorAll('[data-inventory-sample-structure-paste]').forEach((button) => {
    button.addEventListener('click', () => {
      pasteInventoryStructure(button).catch(() => {
        setStructureStatus(sampleUi('structure.readError'), true);
        sampleNotice(sampleUi('structure.readError'), { type: 'error' });
      });
    });
  });

  syncStructureButtons();
}
