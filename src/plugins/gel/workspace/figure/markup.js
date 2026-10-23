export const blotNavigationMarkup = `
  <header class="gel-figure-header left-rail-template__pinned">
    <h3 id="gel-figure-heading">Gels</h3>
    <button type="button" id="gel-figure-add-btn" class="ghost-btn gel-nav-icon-btn" popovertarget="gel-figure-add-menu" aria-haspopup="menu" aria-label="Add gel" title="Add gel">
      <svg class="gel-nav-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M13 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M6 10h3m3 0h2m-8 5h3m3 0h3m2-11h6m-3-3v6" /></svg>
    </button>
    <button type="button" id="gel-figure-stack-btn" class="ghost-btn gel-nav-icon-btn" data-figure-action="stack" aria-label="Add stack" title="Add stack">
      <svg class="gel-nav-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m10 3-8 4 8 4 8-4-8-4Zm-8 9 8 4 5-2.5M2 17l8 4 4-2m5-8v8m-4-4h8" /></svg>
    </button>
    <div id="gel-figure-add-menu" class="gel-menu" popover role="menu" aria-label="Add layers">
      <button type="button" role="menuitem" data-figure-action="import">Image files…</button>
      <button type="button" role="menuitem" data-figure-action="add">Current gel</button>
      <button type="button" role="menuitem" data-figure-action="open">Project…</button>
      <button type="button" role="menuitem" data-figure-action="recover">Recover saved gels</button>
      <button type="button" id="gel-figure-notice-retry" role="menuitem" hidden>Try again</button>
    </div>
  </header>
  <input id="gel-figure-files" type="file" accept="image/*,.tif,.tiff" multiple hidden />
  <input id="gel-figure-project-file" type="file" accept=".json" hidden />
  <div id="gel-figure-rows" class="gel-figure-rows left-rail-template__scroll folder-tree-template" aria-label="Gel layers"></div>`;

export const blotToolsMarkup = `
    <div class="gel-figure-controls">
      <header class="gel-figure-tools-head"><h3>Layout tools</h3><button type="button" class="ghost-btn" data-figure-action="back">Done</button></header>
      <input type="hidden" id="gel-figure-name" value="Gel layers" />
      <section id="gel-figure-stack-trim" class="gel-figure-placement gel-figure-stack-trim" aria-labelledby="gel-figure-trim-heading" hidden>
        <h4 id="gel-figure-trim-heading">Trim stack</h4>
        <div class="gel-figure-row-actions">
          <button type="button" class="ghost-btn" data-figure-action="trim" aria-pressed="false">Set trim edges</button>
          <button type="button" class="ghost-btn" data-figure-action="reset-trim">Reset trim</button>
        </div>
        <div id="gel-figure-trim-actions" class="gel-figure-row-actions" hidden>
          <button type="button" class="primary-btn" data-figure-action="apply-trim">Apply trim</button>
          <button type="button" class="ghost-btn" data-figure-action="cancel-trim">Cancel</button>
        </div>
      </section>
      <section id="gel-figure-placement" class="gel-figure-placement" aria-labelledby="gel-figure-placement-title" hidden>
        <h4 id="gel-figure-placement-title"></h4>
        <div class="gel-figure-row-actions">
          <button type="button" class="ghost-btn" data-figure-action="edit">Process gel</button>
        </div>
        <details class="gel-figure-exact">
          <summary>Exact values</summary>
          <div class="gel-figure-fields">
            <label>First lane (%)<input data-figure-field="first" type="number" min="-100" max="198" step="0.1" /></label>
            <label>Last lane (%)<input data-figure-field="last" type="number" min="-98" max="200" step="0.1" /></label>
            <label>Crop top (%)<input data-figure-field="top" type="number" min="0" max="99.9" step="0.1" /></label>
            <label>Crop bottom (%)<input data-figure-field="bottom" type="number" min="0.1" max="100" step="0.1" /></label>
          </div>
          <button type="button" class="ghost-btn" data-figure-action="detect">Reset alignment</button>
        </details>
      </section>
    </div>
`;

export const blotFigureMarkup = `
<section id="gel-blot-figure" class="gel-blot-figure" aria-labelledby="gel-figure-preview-title" hidden>
    <div class="gel-figure-preview-area">
      <div class="gel-figure-preview-heading"><h4 id="gel-figure-preview-title">Gel layers</h4><span id="gel-figure-preview-detail" class="small-note"></span></div>
      <div id="gel-figure-preview" class="gel-figure-preview"></div>
    </div>
  <p id="gel-figure-status" class="sr-only" role="status" aria-live="polite"></p>
</section>`;
