const TOOL_ACTIONS = {
  inventory_lookup: 'Searching for samples',
  chemical_lookup: 'Checking chemical inventory',
  notebook_lookup: 'Checking the lab notebook',
  notebook_list: 'Listing notebook pages',
  protocol_lookup: 'Searching saved protocols',
  protocol_generation: 'Preparing a protocol draft',
  protocol_edit: 'Preparing protocol edits',
  notebook_draft: 'Drafting a notebook page',
  notebook_generation: 'Preparing a notebook page',
  notebook_suggest: 'Suggesting experiments',
  notebook_append: 'Preparing a notebook update',
  literature_search: 'Searching the literature',
  paper_download: 'Downloading a paper',
  paper_analysis: 'Analyzing a paper',
  paper_intake_search_summaries: 'Searching saved papers',
  paper_intake_search_experiments: 'Searching published experiments',
  paper_experiments_sql: 'Querying the experiment database',
  paper_intake_list_project_summaries: 'Checking papers linked to the project',
  purchase_recommendation: 'Looking up purchasing options',
  memory: 'Working with saved context',
  workspace_files: 'Working with workspace files',
  container: 'Working with temporary values',
  assay_table: 'Working with assay data',
  assay_plot: 'Working on the assay chart',
  plotly_graph: 'Working on an interactive chart',
  image_output: 'Displaying an image',
  html_output: 'Displaying interactive content',
  sequence_list: 'Listing saved sequences',
  sequence_search: 'Searching saved sequences',
  sequence_get: 'Reading a saved sequence',
  sequence_feature_edit: 'Editing sequence features',
  sequence_protein_parts: 'Checking available protein parts',
  sequence_protein_build: 'Building a protein construct',
  sequence_protein_get: 'Reading a protein sequence',
  sequence_protein_edit: 'Editing a protein sequence',
  sequence_mutagenesis_primers: 'Designing mutagenesis primers',
  ask_user: 'Asking a follow-up question'
};

const CANVAS_ACTIONS = {
  read: 'Reading the {plugin} canvas',
  apply: 'Editing the {plugin} canvas',
  render: 'Rendering a {plugin} preview',
  inspect: 'Inspecting the {plugin} canvas',
  asset_list: 'Listing {plugin} assets',
  asset_read: 'Reading a {plugin} asset',
  asset_save: 'Saving a {plugin} asset',
  asset_update: 'Updating a {plugin} asset',
  asset_delete: 'Deleting a {plugin} asset',
  asset_render: 'Rendering a {plugin} asset preview'
};

function formatPluginCanvasActivity(args = {}) {
  const plugin = args.plugin_id;
  const action = args.request?.action;
  const subject = plugin === 'scientific-illustration'
    ? 'Figura'
    : typeof plugin === 'string' && /^[a-z0-9-]{1,100}$/u.test(plugin)
      ? plugin.replaceAll('-', ' ')
      : 'plugin';
  const operation = typeof action === 'string' && Object.hasOwn(CANVAS_ACTIONS, action)
    ? CANVAS_ACTIONS[action]
    : 'Working on the {plugin} canvas';
  return operation.replace('{plugin}', subject);
}

export function formatHikariToolActivity(tool, args) {
  if (tool === 'plugin_canvas') return formatPluginCanvasActivity(args);
  return Object.hasOwn(TOOL_ACTIONS, tool) ? TOOL_ACTIONS[tool] : '';
}

const toolList = new Intl.ListFormat('en', { type: 'conjunction' });

function formatActivityList(labels) {
  return `${toolList.format(labels.map((label, index) => index === 0 ? label : label[0].toLowerCase() + label.slice(1)))}…`;
}

// These titles were previously persisted for batches that had already been summarized.
const previousTitles = new Map(Object.entries(TOOL_ACTIONS).map(([tool, label]) => [
  tool[0].toUpperCase() + tool.slice(1).replaceAll('_', ' '), label
]));
for (const [title, action] of Object.entries({
  'canvas read': 'read', 'canvas edits': 'apply', 'canvas preview': 'render', 'canvas inspection': 'inspect',
  'asset list': 'asset_list', 'asset read': 'asset_read', 'asset save': 'asset_save', 'asset update': 'asset_update',
  'asset delete': 'asset_delete', 'asset preview': 'asset_render'
})) {
  previousTitles.set(`Figura ${title}`, formatPluginCanvasActivity({ plugin_id: 'scientific-illustration', request: { action } }));
}
previousTitles.set('Figura canvas', 'Working on the Figura canvas');
previousTitles.set('Plugin canvas', 'Working on the plugin canvas');

function formatInlineCanvasCall(args) {
  // Inspect literal arguments in the usual call shape. Computed values and
  // other argument layouts still get a canvas label.
  const plugin = /^\s*\{\s*(?:plugin_id|"plugin_id"|'plugin_id')\s*:\s*(["'])([a-z0-9-]{1,100})\1\s*(?=[,}])/u.exec(args);
  const request = plugin && /^\s*,\s*(?:request|"request"|'request')\s*:\s*\{\s*(?:action|"action"|'action')\s*:\s*(["'])([a-z0-9_]{1,48})\1\s*(?=[,}])/u.exec(args.slice(plugin[0].length));
  return formatPluginCanvasActivity({ plugin_id: plugin?.[2], request: { action: request?.[2] } });
}

export function formatHikariExecActivity(script) {
  if (typeof script !== 'string' || !script.includes('mcp__hikari__')) return '';

  // Use the code only as display metadata. Skip comments and quoted text so
  // mentions of a tool in a payload do not become activity rows.
  const references = /\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:\\[\s\S]|[^"\\])*(?:"|$)|'(?:\\[\s\S]|[^'\\])*(?:'|$)|`(?:\\[\s\S]|[^`\\])*(?:`|$)|(?<![\w$.])tools\s*\.\s*mcp__hikari__([a-z][a-z0-9_]{0,79})\s*\(/gu;
  const source = script.slice(0, 120_000);
  const labels = new Set();
  for (const match of source.matchAll(references)) {
    const tool = match[1];
    if (!tool) continue;
    const argsStart = match.index + match[0].length;
    const label = tool === 'plugin_canvas'
      ? formatInlineCanvasCall(source.slice(argsStart, argsStart + 512))
      : formatHikariToolActivity(tool) || `Using ${tool.replaceAll('_', ' ')}`;
    labels.add(label);
  }
  return labels.size ? formatActivityList([...labels]) : '';
}

export function formatSavedCodexActivity(text) {
  const exec = /^((?:Done|Failed):\s*)?(?:functions\.)?exec:\s*/u.exec(text);
  if (exec) {
    const activity = formatHikariExecActivity(text.slice(exec[0].length));
    return activity ? `${exec[1] || ''}${activity}` : text;
  }
  if (!text.endsWith('.')) return text;
  const labels = text.slice(0, -1).split(', ').map(title => previousTitles.get(title));
  return labels.every(Boolean) ? formatActivityList(labels) : text;
}
