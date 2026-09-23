export const HIKARI_MCP_TOOL_CATALOG = Object.freeze([
  ['inventory_lookup', 'Inventory lookup', 'Search local personal containers and samples.'],
  ['chemical_lookup', 'Chemical lookup', 'Search local chemical stock records.'],
  ['notebook_lookup', 'Notebook lookup', 'Search local biology notebook pages.'],
  ['protocol_lookup', 'Protocol lookup', 'Search saved protocols.'],
  ['protocol_generation', 'Protocol generation', 'Prepare protocols and queue requested saves for review.', 'hikari-protocol-generation'],
  ['notebook_draft', 'Notebook draft', 'Prepare planned notebook pages for confirmation.', 'hikari-notebook-draft'],
  ['notebook_suggest', 'Notebook suggestion', 'Prepare background next-experiment suggestions.'],
  ['notebook_append', 'Notebook append', 'Propose evidence-backed additions to the active page.'],
  ['literature_search', 'Literature search', 'Find and rank research papers.'],
  ['paper_download', 'Paper download', 'Download a selected paper into Hikari storage.'],
  ['paper_analysis', 'Paper analysis', 'Read and analyze a local paper with line-backed context.'],
  ['paper_intake_search_summaries', 'Paper summary search', 'Search ingested paper summaries.', 'hikari-paper-retrieval'],
  ['paper_intake_search_experiments', 'Paper experiment search', 'Search experiments extracted from ingested papers.', 'hikari-paper-retrieval'],
  ['paper_intake_list_project_summaries', 'Project paper summaries', 'List ingested paper summaries for a project.', 'hikari-paper-retrieval'],
  ['purchase_recommendation', 'Purchase recommendation', 'Search and rank purchasable products.'],
  ['memory', 'Memory', 'Recall, store, and forget durable preferences and project facts.'],
  ['container', 'Container', 'Create and edit temporary exact-value containers.', 'hikari-container'],
  ['assay_table', 'Assay table', 'Create and transform scratch assay tables.', 'hikari-assay-plotly'],
  ['assay_plot', 'Assay plot', 'Style the live plot and edit labels, reference lines and bands.', 'hikari-assay-plotly'],
  ['plotly_graph', 'Plotly graph', 'Create and inspect scratch Plotly figures.', 'hikari-assay-plotly'],
  ['image_output', 'Analysis images', 'Display saved analysis images in Agent Chat.', ''],
  ['html_output', 'Interactive HTML', 'Display interactive HTML in Agent Chat.', 'hikari-html-output'],
  ['sequence_list', 'Sequence list', 'List entries in the Sequence Viewer library.', 'hikari-sequence-viewer'],
  ['sequence_search', 'Sequence search', 'Search sequence names, DNA, proteins, and features.', 'hikari-sequence-viewer'],
  ['sequence_get', 'Sequence get', 'Read a sequence entry and its features.', 'hikari-sequence-viewer'],
  ['sequence_feature_edit', 'Sequence feature edit', 'Create a temporary derivative with feature edits.', 'hikari-sequence-viewer'],
  ['sequence_protein_parts', 'Protein parts', 'List reusable protein parts from the sequence library.', 'hikari-sequence-viewer'],
  ['sequence_protein_build', 'Protein build', 'Assemble a temporary Protein Builder construct.', 'hikari-sequence-viewer'],
  ['sequence_protein_get', 'Protein get', 'Inspect numbered residues in a coding feature.', 'hikari-sequence-viewer'],
  ['sequence_protein_edit', 'Protein edit', 'Create a temporary derivative with protein edits.', 'hikari-sequence-viewer'],
  ['sequence_mutagenesis_primers', 'Mutagenesis primers', 'Design and compare primers for sequence edits.', 'hikari-sequence-viewer'],
  ['ask_user', 'Ask user', 'Show one blocking clarification with suggested answers.']
].map(([name, label, description, relatedSkillName = '']) => Object.freeze({
  name,
  label,
  description,
  relatedSkillName
})));

const HIKARI_MCP_TOOL_NAMES = new Set(HIKARI_MCP_TOOL_CATALOG.map((tool) => tool.name));

function normalizeDisabledNames(value = []) {
  if (!Array.isArray(value)) {
    return [];
  }
  const disabled = new Set(
    value
      .map((item) => String(item || '').trim())
      .filter((name) => HIKARI_MCP_TOOL_NAMES.has(name))
  );
  return HIKARI_MCP_TOOL_CATALOG.map((tool) => tool.name).filter((name) => disabled.has(name));
}

export function createMcpToolsController({
  state,
  persist,
  listElement,
  escapeHtml
}) {
  function getAgentSettings() {
    const current = state.settings?.agent && typeof state.settings.agent === 'object'
      ? state.settings.agent
      : {};
    state.settings.agent = {
      ...current,
      disabledMcpToolNames: normalizeDisabledNames(
        current.disabledMcpToolNames || current.disabled_mcp_tool_names
      )
    };
    delete state.settings.agent.disabled_mcp_tool_names;
    return state.settings.agent;
  }

  function setToolEnabled(toolName = '', enabled = true) {
    const cleanName = String(toolName || '').trim();
    if (!HIKARI_MCP_TOOL_NAMES.has(cleanName)) {
      return;
    }
    const settings = getAgentSettings();
    const disabled = new Set(settings.disabledMcpToolNames);
    if (enabled) {
      disabled.delete(cleanName);
    } else {
      disabled.add(cleanName);
    }
    state.settings.agent = {
      ...settings,
      disabledMcpToolNames: HIKARI_MCP_TOOL_CATALOG
        .map((tool) => tool.name)
        .filter((name) => disabled.has(name))
    };
    persist();
    render();
  }

  function render() {
    if (!listElement) {
      return;
    }
    const disabled = new Set(getAgentSettings().disabledMcpToolNames);
    listElement.innerHTML = HIKARI_MCP_TOOL_CATALOG.map((tool) => {
      const enabled = !disabled.has(tool.name);
      const relatedSkillNote = tool.relatedSkillName
        ? `<p class="small-note">Also controls official skill: ${escapeHtml(tool.relatedSkillName)}.</p>`
        : '';
      return `
        <div class="settings-skill-row settings-mcp-tool-row">
          <div class="settings-skill-main">
            <div class="settings-skill-title">
              <span>${escapeHtml(tool.label)}</span>
              <span class="settings-skill-command">${escapeHtml(tool.name)}</span>
            </div>
            <p class="small-note settings-skill-description">${escapeHtml(tool.description)}</p>
            ${relatedSkillNote}
          </div>
          <label class="settings-skill-toggle">
            <input type="checkbox" data-mcp-tool-toggle data-tool-name="${escapeHtml(tool.name)}" aria-label="${escapeHtml(`${tool.label} enabled`)}" ${enabled ? 'checked' : ''} />
            <span>${enabled ? 'On' : 'Off'}</span>
          </label>
        </div>
      `;
    }).join('');

    listElement.querySelectorAll('[data-mcp-tool-toggle]').forEach((input) => {
      input.addEventListener('change', () => {
        setToolEnabled(input.dataset.toolName, input.checked === true);
      });
    });
  }

  return {
    render,
    setToolEnabled
  };
}
