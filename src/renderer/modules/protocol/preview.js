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
      html += `<span class="placeholder-chip placeholder-chip-static">${safeText(placeholder?.name || 'value')}</span>`;
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
          <span class="draft-review-kind">Protocol · Draft</span>
          <h4 data-selection-segment-id="protocol:name" data-selection-segment-label="Protocol Name">${safeText(name || 'Untitled protocol')}</h4>
        </header>
      `);
    } else if (includeNameSection) {
      sections.push(`
        <section class="protocol-view-section">
          <h4>Protocol Name</h4>
          ${name
            ? `<p data-selection-segment-id="protocol:name" data-selection-segment-label="Protocol Name">${safeText(name)}</p>`
            : '<p class="small-note">No protocol name provided.</p>'}
        </section>
      `);
    }

    sections.push(`
      <section class="protocol-view-section">
        <h4>Purpose</h4>
        ${purpose
          ? `<p data-selection-segment-id="protocol:purpose" data-selection-segment-label="Purpose">${safeText(purpose)}</p>`
          : '<p class="small-note">No purpose provided.</p>'}
      </section>
    `);

    sections.push(`
      <section class="protocol-view-section">
        <h4>Materials</h4>
        ${materials.length
          ? `<ul>${materials.map((item, index) => `
              <li data-selection-segment-id="protocol:material:${index + 1}" data-selection-segment-label="Material ${index + 1}">${safeText(item)}</li>
            `).join('')}</ul>`
          : '<p class="small-note">No materials provided.</p>'}
      </section>
    `);

    sections.push(`
      <section class="protocol-view-section">
        <h4>Steps</h4>
        ${steps.length
          ? `<ol class="protocol-view-steps">${steps.map((step, index) => `
              <li data-selection-segment-id="protocol:step:${index + 1}" data-selection-segment-label="Protocol Step">
                ${renderReadonlyStepSentence(step)}
              </li>
            `).join('')}</ol>`
          : '<p class="small-note">No steps provided.</p>'}
      </section>
    `);

    sections.push(`
      <section class="protocol-view-section">
        <h4>Troubleshooting</h4>
        ${troubleshooting
          ? `<p data-selection-segment-id="protocol:troubleshooting" data-selection-segment-label="Troubleshooting">${safeText(troubleshooting)}</p>`
          : '<p class="small-note">No troubleshooting notes.</p>'}
      </section>
    `);

    return sections.join('');
  }

  function renderProtocolPreviewInto(node, protocol, options = {}) {
    if (!node) {
      return;
    }
    node.innerHTML = buildProtocolPreviewMarkup(protocol, options);
  }

  function renderProtocolPolishEmptyState(node, message, options = {}) {
    if (!node) {
      return;
    }
    const stateLabel = String(options.state || '').trim();
    const stateAttr = stateLabel ? ` data-state="${safeText(stateLabel)}"` : '';
    node.innerHTML = `
      <div class="protocol-polish-preview-empty"${stateAttr}>
        <p>${safeText(message || 'Nothing to preview yet.')}</p>
      </div>
    `;
  }

  function renderProtocolPolishLoadingState(node, options = {}) {
    if (!node) {
      return;
    }
    const source = options && typeof options === 'object'
      ? options
      : { message: String(options || '') };
    const ariaLabel = String(source.ariaLabel || '').trim() || 'Loading polished protocol';
    const message = String(source.message || '').trim() || 'Polishing the current protocol draft while preserving its structure.';
    node.innerHTML = `
      <div class="protocol-polish-loading">
        <div class="protocol-polish-loading-dots" aria-label="${safeText(ariaLabel)}">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </div>
        <p>${safeText(message)}</p>
      </div>
    `;
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
