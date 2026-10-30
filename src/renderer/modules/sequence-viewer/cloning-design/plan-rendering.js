import { createPresentation } from "../../../lib/i18n/presentation.js";
import "../localization.js";
const i18nUi = createPresentation("dna");
import { escapeHtml } from '../../../lib/html.js';
import { cleanText, normalizeSequenceText } from '../shared.js';
import { renderPrimerCopyButton } from '../primer-copy.js';
import { asArray } from '../../../lib/normalize.js';
import { formatBp, formatEditType, formatNumber, formatPrimerRole, formatStrategyLabel } from './formatting.js';
import { STRATEGY_Q5_KLD, STRATEGY_WHOLE_PLASMID } from './strategies.js';

function renderPlanSummary(displayPlan = {}, source = {}, range = {}) {
  const edit = source?.editRequest || {};
  const summary = displayPlan?.summary || {};
  const rangeText = displayPlan.strategy === STRATEGY_WHOLE_PLASMID || displayPlan.strategy === STRATEGY_Q5_KLD
    ? 'whole plasmid'
    : `${(Math.max(0, Number(range?.start) || 0) + 1).toLocaleString()}..${Math.max(0, Number(range?.end) || 0).toLocaleString()}`;
  const planRows = asArray(displayPlan?.plans).map((entry) => {
    const plan = entry?.plan || {};
    const strategy = cleanText(plan?.recommendedAssemblyStrategy, 120)
      .replace(/[-_]+/g, ' ')
      || 'not feasible';
    const threshold = cleanText(plan?.primerOligoPlan?.selectedThresholdLevel, 80) || 'none';
    return `
      <div class="sequence-viewer-cloning-design-summary-row">
        <strong>${i18nUi.render((entry?.label || i18nUi.message("Plan")))}</strong>
        <span>${escapeHtml(strategy)} ${i18nUi.html("| threshold")} ${escapeHtml(threshold)}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="sequence-viewer-cloning-design-plan-summary">
      <div class="sequence-viewer-cloning-design-summary-grid">
        <div><strong>${i18nUi.html("Route")}</strong><span>${escapeHtml(formatStrategyLabel(displayPlan.strategy))}</span></div>
        <div><strong>${i18nUi.html("Edit")}</strong><span>${escapeHtml(formatEditType(edit.type))}</span></div>
        <div><strong>${i18nUi.html("Template")}</strong><span>${escapeHtml(formatBp(summary.templateLength))}</span></div>
        <div><strong>${i18nUi.html("Final")}</strong><span>${escapeHtml(formatBp(summary.resultLength))}</span></div>
        <div><strong>${i18nUi.html("Amplicon")}</strong><span>${escapeHtml(rangeText)}</span></div>
        <div><strong>${i18nUi.html("Status")}</strong><span class="sequence-viewer-cloning-design-feasibility${displayPlan.feasible ? '' : ' is-review'}">${i18nUi.render((displayPlan.feasible ? i18nUi.message("Feasible") : i18nUi.message("Needs review")))}</span></div>
      </div>
      ${planRows ? `<div class="sequence-viewer-cloning-design-summary-rows">${planRows}</div>` : ''}
    </div>
  `;
}

function renderPrimerTable(primers = []) {
  if (!primers.length) {
    return `<p class="small-note">${i18nUi.html("No primer set was generated for this route.")}</p>`;
  }

  return `
    <div class="sequence-viewer-cloning-design-primer-table-wrap">
      <table class="sequence-viewer-cloning-design-primer-table">
        <thead>
          <tr>
            <th scope="col">${i18nUi.html("Primer / role")}</th>
            <th scope="col">${i18nUi.html("Sequence")} <span class="sequence-viewer-cloning-design-direction">5′ → 3′</span></th>
            <th scope="col">${i18nUi.html("Length")}</th>
            <th scope="col">Tm</th>
            <th scope="col">GC</th>
          </tr>
        </thead>
          ${primers.map((primer, index) => {
            const sequence = normalizeSequenceText(primer?.sequence || '');
            const primerName = cleanText(primer?.name, 160) || `Primer ${index + 1}`;
            return `
              ${index === 0 || primer?.groupLabel !== primers[index - 1]?.groupLabel ? `
                <tbody>
                <tr class="sequence-viewer-cloning-design-primer-group">
                  <th colspan="5" scope="rowgroup">${i18nUi.render((cleanText(primer?.groupLabel, 120) || i18nUi.message("Primers")))}</th>
                </tr>` : ''}
              <tr>
                <td>
                  <div class="sequence-viewer-primer-copy-cell">
                    <span class="sequence-viewer-primer-copy-value">${escapeHtml(primerName)}</span>
                    ${renderPrimerCopyButton(primerName, 'name', 'primer name')}
                  </div>
                  <span class="sequence-viewer-cloning-design-primer-role">${escapeHtml(formatPrimerRole(primer?.role))}</span>
                </td>
                <td class="sequence-viewer-cloning-design-primer-seq">
                  <div class="sequence-viewer-primer-copy-cell sequence-viewer-primer-copy-cell-sequence">
                    <span class="sequence-viewer-primer-copy-value">${escapeHtml(sequence || '-')}</span>
                    ${renderPrimerCopyButton(sequence, 'sequence', 'primer sequence')}
                  </div>
                </td>
                <td>${Math.max(0, Number(primer?.length) || sequence.length).toLocaleString()} nt</td>
                <td>${escapeHtml(formatNumber(primer?.tm, 1))} °C</td>
                <td>${escapeHtml(formatNumber(primer?.gcContent, 1))}%</td>
              </tr>
              ${index === primers.length - 1 || primer?.groupLabel !== primers[index + 1]?.groupLabel ? `</tbody>` : ''}
            `;
          }).join('')}
      </table>
    </div>
  `;
}

function renderProcedure(displayPlan = {}) {
  const steps = [];
  asArray(displayPlan?.plans).forEach((entry) => {
    asArray(entry?.plan?.stepByStepProcedure).forEach((step) => {
      steps.push({
        group: cleanText(entry?.label, 120),
        title: cleanText(step?.title, 160),
        details: cleanText(step?.details, 800)
      });
    });
  });

  if (!steps.length) {
    return `<p class="small-note">${i18nUi.html("No procedure steps were generated.")}</p>`;
  }

  return `
    <ol class="sequence-viewer-cloning-design-procedure">
      ${steps.map((step) => `
        <li>
          <strong>${i18nUi.render((step.title || step.group || i18nUi.message("Step")))}</strong>
          <span>${escapeHtml(step.group ? `${step.group}: ${step.details}` : step.details)}</span>
        </li>
      `).join('')}
    </ol>
  `;
}

function renderRestrictionEnzymes(displayPlan = {}) {
  const enzymes = asArray(displayPlan?.plans)
    .map((entry) => asArray(entry?.plan?.restrictionEnzymeSelection))
    .find((selection) => selection.length) || [];
  if (!enzymes.length) {
    return '';
  }

  const rows = enzymes.map((enzyme) => {
    const name = cleanText(enzyme?.name, 80) || cleanText(enzyme?.site, 80) || 'enzyme';
    const recognition = cleanText(enzyme?.site, 80) || '-';
    const cut = cleanText(enzyme?.cut || asArray(enzyme?.cutPatterns)[0], 80);
    return `
      <li>
        <strong>${escapeHtml(name)}</strong>
        <span>${i18nUi.html("recognition")} ${escapeHtml(recognition)}${i18nUi.render((cut ? i18nUi.message(" | cut {p0}", { p0: escapeHtml(cut) }) : ''))}</span>
      </li>
    `;
  }).join('');

  return `
    <ul class="sequence-viewer-cloning-design-enzyme-list">${rows}</ul>
    <p class="small-note">${i18nUi.html("Digest the backbone and the insert amplicon with this enzyme pair, then ligate.")}</p>
  `;
}

function renderWarnings(warnings = []) {
  if (!warnings.length) {
    return `<p class="small-note">${i18nUi.html("No route warnings.")}</p>`;
  }
  return warnings
    .map((warning) => `<p class="small-note sequence-viewer-cloning-design-warning">${escapeHtml(warning)}</p>`)
    .join('');
}

function isVisibleElement(element) {
  return Boolean(element && element.hidden !== true);
}

export {
  isVisibleElement,
  renderPlanSummary,
  renderPrimerTable,
  renderProcedure,
  renderRestrictionEnzymes,
  renderWarnings
};
