import { createPresentation } from "../../i18n.mjs";
const i18nUi = createPresentation("gel");
export const blotNavigationMarkup = `
  <header class="gel-figure-header left-rail-template__pinned">
    <h3 id="gel-figure-heading">${i18nUi.html("Gels")}</h3>
    <button type="button" id="gel-figure-add-btn" class="ghost-btn gel-nav-icon-btn" popovertarget="gel-figure-add-menu" aria-haspopup="menu" data-i18n-aria-label="gel.full.b2d3f60" aria-label="Add gel" data-i18n-title="gel.full.b2d3f60" title="Add gel">
      <svg class="gel-nav-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M13 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M6 10h3m3 0h2m-8 5h3m3 0h3m2-11h6m-3-3v6" /></svg>
    </button>
    <button type="button" id="gel-figure-stack-btn" class="ghost-btn gel-nav-icon-btn" data-figure-action="stack" data-i18n-aria-label="gel.full.8c581624" aria-label="Add stack" data-i18n-title="gel.full.8c581624" title="Add stack">
      <svg class="gel-nav-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m10 3-8 4 8 4 8-4-8-4Zm-8 9 8 4 5-2.5M2 17l8 4 4-2m5-8v8m-4-4h8" /></svg>
    </button>
    <div id="gel-figure-add-menu" class="gel-menu" popover role="menu" data-i18n-aria-label="gel.full.c69b51de" aria-label="Add layers">
      <button type="button" role="menuitem" data-figure-action="import">${i18nUi.html("Image files…")}</button>
      <button type="button" role="menuitem" data-figure-action="add">${i18nUi.html("Current gel")}</button>
      <button type="button" role="menuitem" data-figure-action="open">${i18nUi.html("Project…")}</button>
      <button type="button" role="menuitem" data-figure-action="recover">${i18nUi.html("Recover saved gels")}</button>
      <button type="button" id="gel-figure-notice-retry" role="menuitem" hidden>${i18nUi.html("Try again")}</button>
    </div>
  </header>
  <input id="gel-figure-files" type="file" accept="image/*,.tif,.tiff" multiple hidden />
  <input id="gel-figure-project-file" type="file" accept=".json" hidden />
  <div id="gel-figure-rows" class="gel-figure-rows left-rail-template__scroll folder-tree-template" data-i18n-aria-label="gel.full.6a803657" aria-label="Gel layers"></div>`;

export const blotToolsMarkup = `
    <div class="gel-figure-controls">
      <input type="hidden" id="gel-figure-name" value="Gel layers" />
      <section id="gel-figure-stack-trim" class="gel-figure-placement gel-figure-stack-trim" aria-labelledby="gel-figure-trim-heading" hidden>
        <h4 id="gel-figure-trim-heading">${i18nUi.html("Trim stack")}</h4>
        <div id="gel-figure-trim-start" class="gel-figure-row-actions">
          <button type="button" class="ghost-btn" data-figure-action="trim">${i18nUi.html("Set trim edges")}</button>
          <button type="button" class="ghost-btn" data-figure-action="reset-trim" hidden>${i18nUi.html("Reset trim")}</button>
        </div>
        <div id="gel-figure-trim-actions" class="gel-figure-row-actions" hidden>
          <button type="button" class="primary-btn" data-figure-action="apply-trim">${i18nUi.html("Apply trim")}</button>
          <button type="button" class="ghost-btn" data-figure-action="cancel-trim">${i18nUi.html("Cancel")}</button>
        </div>
      </section>
    </div>
`;

export const blotFigureMarkup = `
<section id="gel-blot-figure" class="gel-blot-figure" aria-labelledby="gel-figure-preview-title" hidden>
    <div class="gel-figure-preview-area">
      <div class="gel-figure-preview-heading"><h4 id="gel-figure-preview-title">${i18nUi.html("Gel layers")}</h4></div>
      <div id="gel-figure-table-bar" class="gel-table-bar" hidden>
        <h4>${i18nUi.html("Lane table")}</h4>
        <button type="button" class="ghost-btn" data-figure-action="add-table">${i18nUi.html("Add table")}</button>
        <button type="button" class="ghost-btn" data-figure-action="add-table-row" hidden>${i18nUi.html("Add row")}</button>
        <button type="button" class="ghost-btn" data-figure-action="remove-table-row" hidden>${i18nUi.html("Remove row")}</button>
      </div>
      <div id="gel-figure-preview" class="gel-figure-preview"></div>
    </div>
  <p id="gel-figure-status" class="sr-only" role="status" aria-live="polite"></p>
</section>`;
