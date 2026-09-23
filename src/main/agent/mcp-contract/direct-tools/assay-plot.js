'use strict';

const { runAppTool, buildWriteToolAnnotations } = require('./shared.js');

const ASSAY_PLOT_MCP_TOOL = Object.freeze({
  name: 'assay_plot',
  description: 'Read and style the live native Assay plot. Control titles, axes, series appearance, legend, grid, error-bar appearance, and added labels, reference lines and shaded bands. Read first for supported style fields, series labels and revision. Updates merge a style patch; arrays (including plotElements) replace in full. Does not change plate values, data mapping or analysis. For a custom agent Plotly figure, use plotly_graph instead.',
  annotations: buildWriteToolAnnotations('Assay plot'),
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['action'],
    properties: {
      action: { type: 'string', enum: ['read', 'update'] },
      assay_id: { type: 'string', description: 'Active saved assay ID from read; required for updates.' },
      expected_revision: { type: 'string', description: 'Opaque revision from read; required for updates. Detects user formatting and data changes.' },
      request_id: { type: 'string', description: 'Unique update ID; retry uncertain updates with the same ID and identical arguments.' },
      style: {
        type: 'object', description: 'Patch of native style fields returned by read. Nested objects merge; arrays replace. Pixel units. Examples: title/xTitle/yTitle, xScale/yScale (linear/log10/log2/ln), xRange/yRange {auto,min,max}, legendPosition (top/bottom/right/none), seriesStyles keyed by returned series label, plotElements. Unknown or out-of-range fields fail.',
        properties: {
          plotElements: {
            type: 'array', maxItems: 32,
            description: 'Complete added-element list; use [] to clear. Preserve existing IDs and elements unless asked to remove them. Labels use plot coordinates 0–1 or data coordinates; lines/bands use data units (category index for category X).',
            items: {
              type: 'object', additionalProperties: false, required: ['id', 'type'],
              properties: {
                id: { type: 'string' }, type: { type: 'string', enum: ['label', 'line', 'band'] },
                color: { type: 'string', description: 'Hex color.' },
                text: { type: 'string', description: 'Label plain text.' },
                coordinates: { type: 'string', enum: ['plot', 'data'] },
                x: { type: ['number', 'string'] }, y: { type: 'number' },
                fontSize: { type: 'number', minimum: 6, maximum: 48 }, arrow: { type: 'boolean' },
                axis: { type: 'string', enum: ['x', 'y'] }, value: { type: 'number' },
                width: { type: 'number', minimum: 0.5, maximum: 8 }, dash: { type: 'string', enum: ['solid', 'dash', 'dot'] },
                start: { type: 'number' }, end: { type: 'number' }, opacity: { type: 'number', minimum: 0.01, maximum: 1 }
              }
            }
          }
        }
      }
    }
  }
});

async function callAssayPlot(input = {}, context = {}, deps = {}) {
  try {
    const { validatePlotRequest } = await import('../../../../shared/assay-plot.mjs');
    validatePlotRequest(input);
  } catch (error) {
    return { ok: false, status: 'invalid_arguments', error: error.message, mcp_tool: 'assay_plot' };
  }
  const result = await runAppTool({ runTool: deps.runTool, toolId: 'assay-plot', args: input, context });
  return { ...result, mcp_tool: 'assay_plot' };
}

module.exports = { ASSAY_PLOT_MCP_TOOL, callAssayPlot };
