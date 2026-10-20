export const blotFigureMarkup = `
<section id="gel-blot-figure" class="gel-blot-figure" aria-labelledby="gel-figure-heading" hidden>
  <header class="gel-figure-header">
    <h3 id="gel-figure-heading">Gel Layers</h3>
    <button type="button" id="gel-figure-add-btn" class="ghost-btn" popovertarget="gel-figure-add-menu" aria-haspopup="menu">Add</button>
    <div id="gel-figure-add-menu" class="gel-menu" popover role="menu" aria-label="Add layers">
      <button type="button" role="menuitem" data-figure-action="import">Image files…</button>
      <button type="button" role="menuitem" data-figure-action="add">Current gel</button>
      <button type="button" role="menuitem" data-figure-action="open">Project…</button>
    </div>
    <button type="button" class="ghost-btn" data-figure-action="save">Save project</button>
    <button type="button" class="ghost-btn" data-figure-action="back">Done</button>
  </header>
  <input id="gel-figure-files" type="file" accept="image/*,.tif,.tiff" multiple hidden />
  <input id="gel-figure-project-file" type="file" accept=".json" hidden />
  <div class="gel-figure-body">
    <div class="gel-figure-controls">
      <label>Project name<input id="gel-figure-name" value="Gel layers" maxlength="120" /></label>
      <div class="gel-figure-layers-head">
        <h4>Layers</h4>
        <label class="gel-figure-select-all"><input id="gel-figure-select-all" type="checkbox" />All</label>
        <button type="button" class="primary-btn" data-figure-action="stack" title="Combine the selected gel layers">Stack</button>
      </div>
      <div id="gel-figure-rows" class="gel-figure-rows" aria-label="Gel layers"></div>
      <section id="gel-figure-stack-trim" class="gel-figure-placement gel-figure-stack-trim" aria-labelledby="gel-figure-trim-heading" hidden>
        <h4 id="gel-figure-trim-heading">Trim stack</h4>
        <div class="gel-figure-row-actions">
          <button type="button" class="ghost-btn" data-figure-action="trim" aria-pressed="false">Trim excess</button>
          <button type="button" class="ghost-btn" data-figure-action="reset-trim">Reset trim</button>
        </div>
        <div class="gel-figure-fields">
          <label>Left edge (%)<input id="gel-figure-trim-left" data-figure-trim="left" type="number" min="0" max="99.99" step="0.1" value="0" /></label>
          <label>Right edge (%)<input id="gel-figure-trim-right" data-figure-trim="right" type="number" min="0.01" max="100" step="0.1" value="100" /></label>
        </div>
      </section>
      <section id="gel-figure-placement" class="gel-figure-placement" hidden>
        <label>Layer name<input id="gel-figure-antibody" maxlength="120" placeholder="e.g. p-ERK1/2" /></label>
        <div class="gel-figure-row-actions">
          <button type="button" class="ghost-btn" data-figure-action="edit">Process gel</button>
          <button type="button" class="ghost-btn" data-figure-action="up" aria-label="Move blot up">↑</button>
          <button type="button" class="ghost-btn" data-figure-action="down" aria-label="Move blot down">↓</button>
          <button type="button" class="ghost-btn" data-figure-action="remove">Remove</button>
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
    <div class="gel-figure-preview-area">
      <div class="gel-figure-preview-heading"><h4 id="gel-figure-preview-title">Gel layers</h4><span id="gel-figure-preview-detail" class="small-note"></span></div>
      <div id="gel-figure-preview-options" class="gel-figure-guide-controls">
        <label>Lane table<select id="gel-figure-table-source" aria-label="Lane table source"><option value="auto">First available</option><option value="none">None</option></select></label>
        <label><input id="gel-figure-guides" type="checkbox" checked />Lane guides</label>
        <label>Lane count<input id="gel-figure-lane-count" type="number" min="2" max="40" value="6" /></label>
      </div>
      <div id="gel-figure-preview" class="gel-figure-preview"></div>
    </div>
  </div>
  <p id="gel-figure-status" class="small-note" role="status" aria-live="polite"></p>
</section>`;
