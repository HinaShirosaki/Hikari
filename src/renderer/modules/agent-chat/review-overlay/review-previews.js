import { asArray, trimText } from '../shared.js';

function renderList(items, safeText, emptyText = '') {
  const values = asArray(items).map((item) => trimText(item, 260)).filter(Boolean);
  if (!values.length) {
    return emptyText ? `<p class="agent-review-muted">${safeText(emptyText)}</p>` : '';
  }
  return `<ul>${values.map((item) => `<li>${safeText(item)}</li>`).join('')}</ul>`;
}

function renderProtocolPreview(item, safeText) {
  const protocol = item.protocol;
  return `
    <article class="agent-review-card" data-agent-review-card="${safeText(item.id)}">
      <div class="agent-review-card-header">
        <span class="agent-review-type">Protocol</span>
        <h4>${safeText(protocol.name)}</h4>
      </div>
      <div class="agent-review-content">
        ${protocol.purpose ? `
          <section class="agent-review-section">
            <h5>Purpose</h5>
            <p>${safeText(protocol.purpose)}</p>
          </section>
        ` : ''}
        <section class="agent-review-section">
          <h5>Materials</h5>
          ${renderList(protocol.materials, safeText, 'No materials listed.')}
        </section>
        <section class="agent-review-section">
          <h5>Steps</h5>
          <ol>${protocol.steps.map((step) => `<li>${safeText(step.text)}</li>`).join('')}</ol>
        </section>
        ${protocol.troubleshooting ? `
          <section class="agent-review-section">
            <h5>Troubleshooting</h5>
            <p>${safeText(protocol.troubleshooting)}</p>
          </section>
        ` : ''}
      </div>
      <div class="agent-review-actions">
        <button type="button" class="primary-btn" data-agent-review-approve="${safeText(item.id)}">Approve</button>
        <button type="button" class="ghost-btn" data-agent-review-reject="${safeText(item.id)}">Reject</button>
      </div>
    </article>
  `;
}

function renderNotebookPreview(item, safeText) {
  const draft = item.draft;
  const proposal = draft.proposal || {};
  const title = trimText(proposal.title || draft.entry_template?.result || 'Notebook draft', 220);
  const metaParts = [
    trimText(draft.project?.name || draft.entry_template?.projectName, 180),
    trimText(draft.protocol?.name || draft.entry_template?.protocolName, 220)
  ].filter(Boolean);
  return `
    <article class="agent-review-card" data-agent-review-card="${safeText(item.id)}">
      <div class="agent-review-card-header">
        <span class="agent-review-type">Notebook Page</span>
        <h4>${safeText(title)}</h4>
        ${metaParts.length ? `<p>${safeText(metaParts.join(' / '))}</p>` : ''}
      </div>
      <div class="agent-review-content">
        ${proposal.purpose ? `
          <section class="agent-review-section">
            <h5>Purpose</h5>
            <p>${safeText(proposal.purpose)}</p>
          </section>
        ` : ''}
        ${proposal.rationale ? `
          <section class="agent-review-section">
            <h5>Rationale</h5>
            <p>${safeText(proposal.rationale)}</p>
          </section>
        ` : ''}
        <section class="agent-review-section">
          <h5>Materials</h5>
          ${renderList(proposal.planned_materials, safeText, 'No materials listed.')}
        </section>
        <section class="agent-review-section">
          <h5>Planned Steps</h5>
          ${draft.rendered_steps.length
            ? `<ol>${draft.rendered_steps.map((step) => `<li>${safeText(step)}</li>`).join('')}</ol>`
            : '<p class="agent-review-muted">No rendered steps were supplied.</p>'}
        </section>
        ${draft.unresolved_placeholders.length ? `
          <section class="agent-review-section">
            <h5>Needs Attention</h5>
            <ul>${draft.unresolved_placeholders.map((placeholder) => `<li>${safeText(placeholder.display || placeholder.placeholder_key || placeholder.reason)}</li>`).join('')}</ul>
          </section>
        ` : ''}
        ${proposal.checkpoints.length ? `
          <section class="agent-review-section">
            <h5>Checkpoints</h5>
            ${renderList(proposal.checkpoints, safeText)}
          </section>
        ` : ''}
      </div>
      <div class="agent-review-actions">
        <button type="button" class="primary-btn" data-agent-review-approve="${safeText(item.id)}">Approve</button>
        <button type="button" class="ghost-btn" data-agent-review-reject="${safeText(item.id)}">Reject</button>
      </div>
    </article>
  `;
}

function renderNotebookAppendPreview(item, safeText) {
  const append = item.append || {};
  const proposal = append.proposal || {};
  const sourceLabels = asArray(proposal.sources).map((source) => {
    const label = trimText(source?.label || source?.record_id || source?.url, 320);
    const detail = trimText(source?.detail, 500);
    return [label, detail].filter(Boolean).join(' — ');
  }).filter(Boolean);
  const target = [
    trimText(proposal.page_title, 320),
    trimText(proposal.project_name, 220),
    trimText(proposal.protocol_name, 220)
  ].filter(Boolean);
  return `
    <article class="agent-review-card" data-agent-review-card="${safeText(item.id)}">
      <div class="agent-review-card-header">
        <span class="agent-review-type">Notebook Append</span>
        <h4>${safeText(trimText(proposal.section_title, 220) || 'Suggested enrichment')}</h4>
        ${target.length ? `<p>${safeText(target.join(' / '))}</p>` : ''}
      </div>
      <div class="agent-review-content">
        ${proposal.rationale ? `
          <section class="agent-review-section">
            <h5>Why this is useful</h5>
            <p>${safeText(proposal.rationale)}</p>
          </section>
        ` : ''}
        <section class="agent-review-section">
          <h5>Content to append</h5>
          <p class="agent-review-append-text">${safeText(proposal.content_markdown)}</p>
        </section>
        ${sourceLabels.length ? `
          <section class="agent-review-section">
            <h5>Sources used</h5>
            ${renderList(sourceLabels, safeText)}
          </section>
        ` : ''}
      </div>
      <div class="agent-review-actions">
        <button type="button" class="primary-btn" data-agent-review-approve="${safeText(item.id)}">Append to Page</button>
        <button type="button" class="ghost-btn" data-agent-review-reject="${safeText(item.id)}">Reject</button>
      </div>
    </article>
  `;
}

export {
  renderNotebookAppendPreview,
  renderNotebookPreview,
  renderProtocolPreview
};
