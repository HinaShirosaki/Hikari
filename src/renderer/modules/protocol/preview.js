import { createPresentation } from "../../lib/i18n/presentation.js";
import "./localization.js";
const i18nUi = createPresentation("protocol");
import { messageAttributes } from '../../lib/i18n/markup.js';
import { protocolUi, protocolMessage, protocolDisplayText, protocolDisplayMarkup } from './localization.js';
import { PLACEHOLDER_TOKEN_REGEX } from './constants.js';

export function createProtocolPreviewHelpers({
  safeText,
  getStepText,
  normalizeMaterials,
  formatBulletLines,
  formatStepLines,
  placeholderTokenRegex = PLACEHOLDER_TOKEN_REGEX
}) {
  function renderReadonlyStepSentence(step) {
    const source = getStepText(step);
    const placeholders = Array.isArray(step?.placeholders) ? step.placeholders : [];
    const matches = [...source.matchAll(placeholderTokenRegex)];

    if (!matches.length) {
      if (!placeholders.length) {
        return safeText(source);
      }
      const trailing = placeholders
        .map((placeholder) => String(placeholder?.name || '').trim())
        .filter(Boolean)
        .map((name) => `<span class="placeholder-chip placeholder-chip-static">${safeText(name)}</span>`)
        .join(' ');
      return `${safeText(source)} ${trailing}`.trim();
    }

    let cursor = 0;
    let html = '';

    matches.forEach((match) => {
      const index = Number(match.index || 0);
      const placeholderId = String(match[1] || '');
      const placeholder = placeholders.find((item) => String(item.id) === placeholderId);
      html += safeText(source.slice(cursor, index));
      html += `<span class="placeholder-chip placeholder-chip-static">${i18nUi.render((placeholder?.name || i18nUi.message("value")))}</span>`;
      cursor = index + match[0].length;
    });

    html += safeText(source.slice(cursor));
    return html;
  }

  function populateEditorFormFromDraft(ui, draft) {
    if (ui.protocolNameInput) {
      ui.protocolNameInput.value = String(draft?.name || '').trim();
    }
    if (ui.protocolPurposeInput) {
      ui.protocolPurposeInput.value = String(draft?.purpose || '').trim();
    }
    if (ui.protocolMaterialsInput) {
      ui.protocolMaterialsInput.value = formatBulletLines(draft?.materials);
    }
    if (ui.protocolStepsInput) {
      ui.protocolStepsInput.value = formatStepLines(draft?.steps);
    }
    if (ui.protocolTroubleshootingInput) {
      ui.protocolTroubleshootingInput.value = String(draft?.troubleshooting || '').trim();
    }
  }

  function buildProtocolPreviewMarkup(protocol, options = {}) {
    const includeNameSection = options.includeNameSection === true;
    const name = String(protocol?.name || '').trim();
    const purpose = String(protocol?.purpose || '').trim();
    const materials = normalizeMaterials(protocol?.materials);
    const troubleshooting = String(protocol?.troubleshooting || '').trim();
    const steps = Array.isArray(protocol?.steps) ? protocol.steps : [];

    const sections = [];

    if (options.reviewDocument === true) {
      sections.push(`
        <header class="draft-review-heading">
          <span class="draft-review-kind">${protocolMessage('preview.kind')}</span>
          <h4 data-selection-segment-id="protocol:name" data-selection-segment-label="Protocol Name">${name ? safeText(name) : protocolMessage('preview.untitled')}</h4>
        </header>
      `);
    } else if (includeNameSection) {
      sections.push(`
        <section class="protocol-view-section">
          <h4>${protocolMessage('field.name')}</h4>
          ${name
            ? `<p data-selection-segment-id="protocol:name" data-selection-segment-label="Protocol Name">${safeText(name)}</p>`
            : `<p class="small-note">${protocolMessage('preview.noName')}</p>`}
        </section>
      `);
    }

    sections.push(`
      <section class="protocol-view-section">
        <h4>${protocolMessage('field.purpose')}</h4>
        ${purpose
          ? `<p data-selection-segment-id="protocol:purpose" data-selection-segment-label="Purpose">${safeText(purpose)}</p>`
          : `<p class="small-note">${protocolMessage('preview.noPurpose')}</p>`}
      </section>
    `);

    sections.push(`
      <section class="protocol-view-section">
        <h4>${protocolMessage('field.materials')}</h4>
        ${materials.length
          ? `<ul>${materials.map((item, index) => `
              <li data-selection-segment-id="protocol:material:${index + 1}" data-selection-segment-label="Material ${index + 1}">${safeText(item)}</li>
            `).join('')}</ul>`
          : `<p class="small-note">${protocolMessage('preview.noMaterials')}</p>`}
      </section>
    `);

    sections.push(`
      <section class="protocol-view-section">
        <h4>${protocolMessage('field.steps')}</h4>
        ${steps.length
          ? `<ol class="protocol-view-steps">${steps.map((step, index) => `
              <li data-selection-segment-id="protocol:step:${index + 1}" data-selection-segment-label="Protocol Step">
                ${renderReadonlyStepSentence(step)}
              </li>
            `).join('')}</ol>`
          : `<p class="small-note">${protocolMessage('preview.noSteps')}</p>`}
      </section>
    `);

    sections.push(`
      <section class="protocol-view-section">
        <h4>${protocolMessage('field.troubleshooting')}</h4>
        ${troubleshooting
          ? `<p data-selection-segment-id="protocol:troubleshooting" data-selection-segment-label="Troubleshooting">${safeText(troubleshooting)}</p>`
          : `<p class="small-note">${protocolMessage('preview.noTroubleshooting')}</p>`}
      </section>
    `);

    return sections.join('');
  }

  function renderProtocolPreviewInto(node, protocol, options = {}) {
    if (!node) {
      return;
    }
    i18nUi.setHtml(node, buildProtocolPreviewMarkup(protocol, options));
  }

  function renderProtocolPolishEmptyState(node, message, options = {}) {
    if (!node) {
      return;
    }
    const stateLabel = String(options.state || '').trim();
    const stateAttr = stateLabel ? ` data-state="${safeText(stateLabel)}"` : '';
    i18nUi.setHtml(node, `
      <div class="protocol-polish-preview-empty"${stateAttr}>
        <p>${protocolDisplayMarkup(message || protocolUi('preview.empty'))}</p>
      </div>
    `);
  }

  function renderProtocolPolishLoadingState(node, options = {}) {
    if (!node) {
      return;
    }
    const source = options && typeof options === 'object'
      ? options
      : { message: String(options || '') };
    const ariaLabel = protocolDisplayText(source.ariaLabel).trim() ? source.ariaLabel : protocolUi('preview.loadingPolish');
    const message = protocolDisplayText(source.message).trim() ? source.message : protocolUi('preview.polishing');
    i18nUi.setHtml(node, `
      <div class="protocol-polish-loading">
        <div class="protocol-polish-loading-dots" ${ariaLabel.i18nKey ? messageAttributes({ 'aria-label': ariaLabel.i18nKey }, ariaLabel.i18nParams) : `aria-label="${safeText(protocolDisplayText(ariaLabel))}"`}>
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </div>
        <p>${protocolDisplayMarkup(message)}</p>
      </div>
    `);
  }

  return {
    renderReadonlyStepSentence,
    populateEditorFormFromDraft,
    buildProtocolPreviewMarkup,
    renderProtocolPreviewInto,
    renderProtocolPolishEmptyState,
    renderProtocolPolishLoadingState
  };
}
