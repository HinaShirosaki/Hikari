// Assay-owned formatting controls. All dimensions are displayed in pt except plot size.
const TABS = [
  { id: 'frame', label: 'Frame' }, { id: 'axis', label: 'Axis' },
  { id: 'series', label: 'Data Series' }, { id: 'text', label: 'Text' }
];
const TAB_KEYS = {
  frame: ['frameStyle', 'frameStroke', 'frameStrokeWidth', 'backgroundColor', 'showVerticalGrid',
    'showHorizontalGrid', 'gridColor', 'gridStrokeWidth', 'sizeAuto', 'frameWidth', 'frameHeight'],
  axis: ['xScale', 'yScale', 'xRange', 'yRange', 'xTick', 'yTick', 'axisStyles',
    'tickDir', 'tickLen', 'minorTicks', 'tickFormat', 'refLineAxis', 'refLineValue'],
  series: ['chartType', 'xColumn', 'yColumn', 'seriesColumn', 'barMode', 'barLabels', 'barCornerRadius',
    'mode', 'legendPosition', 'pointShape', 'pointSize', 'markerFill', 'opacity', 'lineStyle', 'lineWidth',
    'seriesColors', 'seriesShapes', 'seriesStyles', 'replicateStyle', 'palette', 'seriesColor', 'barOutlineColor',
    'barOutlineWidth', 'errorColor', 'errorCapWidth', 'errorThickness'],
  text: ['title', 'xTitle', 'yTitle', 'text', 'textStyles', 'titlePos', 'titleOffset',
    'xTitlePos', 'yTitlePos', 'xTitleOffset', 'yTitleOffset']
};
const select = (key, label, values) => `<label>${label}<select data-cc="${key}" aria-label="${label}">${values
  .map(([value, name]) => `<option value="${value}">${name}</option>`).join('')}</select></label>`;
const number = (key, label, min, max, step = 'any', placeholder = '') => `<label class="assay-chart-style-number">${label}<input data-cc="${key}"
  aria-label="${label}" type="number" ${min !== null ? `min="${min}"` : ''} ${max !== null ? `max="${max}"` : ''}
  step="${step}" placeholder="${placeholder}" /></label>`;
const check = (key, label) => `<label class="assay-chart-style-checkbox"><input type="checkbox" data-cc="${key}" />${label}</label>`;
const color = (key, label) => `<label>${label}<input type="color" data-cc="${key}" aria-label="${label}" /></label>`;
// Preset and reset actions share one icon strip; aria-label supplies the hover caption.
const ICON_PATHS = {
  presetSaveBtn: '<path d="M5 3h11l4 4v14H5Z" /><path d="M8 3v6h7V3" /><path d="M8 21v-7h8v7" />',
  presetDeleteBtn: '<path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v5" /><path d="M14 11v5" />',
  resetTabBtn: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" /><path d="M3 3v5h5" />',
  resetBtn: '<path d="M21 12a9 9 0 0 0-9-9 9 9 0 0 0-6.4 2.6L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9 9 0 0 0 6.4-2.6L21 16" /><path d="M16 16h5v5" />'
};
const iconButton = (key, label, danger = false) => `<button type="button" data-cc="${key}"
  class="row-action-icon-btn${danger ? ' row-action-icon-btn-danger' : ''}" aria-label="${label}">
  <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false">${ICON_PATHS[key]}</svg></button>`;
const picker = (key, label) => `<label>${label}<div data-cc="${key}" class="assay-chart-picker-mount"></div></label>`;
const section = (title, content, attributes = '') => `<div class="assay-chart-style-subsection" ${attributes}>
  <span class="assay-chart-style-subhead">${title}</span>${content}</div>`;
const row = (content, className = '') => `<div class="assay-chart-style-row ${className}">${content}</div>`;
const panel = (id, content) => `<div class="assay-chart-style-panel" role="tabpanel" id="assay-cc-panel-${id}"
  aria-labelledby="assay-cc-tab-${id}" data-cc-panel="${id}" ${id === 'frame' ? '' : 'hidden'}>${content}</div>`;
const stack = (content, attributes = '') => `<div class="assay-chart-style-axis-column" ${attributes}>${content}</div>`;
const axisGrid = (content) => `<div class="assay-chart-style-axis-grid">${content}</div>`;
// The X and Y columns carry identical fields so their rows line up across the grid.
const axisColumn = (axis) => stack(`<span class="assay-chart-style-subhead">${axis.toUpperCase()} axis</span>`
  + stack(select(`${axis}Scale`, 'Scale', [['linear', 'Linear'], ['log10', 'Log10'], ['log2', 'Log2'], ['ln', 'Natural log']])
    + check(`${axis}RangeAuto`, 'Auto range')
    + number(`${axis}Min`, 'Minimum', null, null) + number(`${axis}Max`, 'Maximum', null, null)
    + select(`${axis}TickPreset`, 'Tick interval', [])
    + number(`${axis}Tick`, 'Custom interval', 0, null, 'any', 'Auto')
    + `<p data-cc="${axis}TickHint" class="assay-chart-style-note" hidden></p>`, `data-cc="${axis}NumericFields"`));
const tickColumn = (axis) => stack(select(`${axis}TickDir`, 'Direction', [['outside', 'Outside'], ['inside', 'Inside'], ['none', 'None']])
  + number(`${axis}TickLen`, 'Length (pt)', 0, 15, 0.25)
  + stack(check(`${axis}MinorTicks`, 'Minor ticks')
    + select(`${axis}TickFormat`, 'Number format', [['auto', 'Auto'], ['fixed1', '0.0'], ['fixed2', '0.00'],
      ['sci', '1e3'], ['si', 'SI (k/M)'], ['power', 'Powers']]), `data-cc="${axis}NumericTickFields"`)
  + number(`${axis}TickAngle`, 'Label angle (°)', -90, 90, 1, 'Auto'));

const PANEL_HTML = `<div class="assay-chart-style">
  <div class="assay-chart-style-presets">
    ${select('presetSelect', 'Preset', [['', 'Custom']])}
    <div class="assay-chart-style-actions">
      ${iconButton('presetSaveBtn', 'Save preset as…')}
      ${iconButton('presetDeleteBtn', 'Delete preset', true)}
      ${iconButton('resetTabBtn', 'Reset this tab')}
      ${iconButton('resetBtn', 'Reset all formatting')}
    </div>
  </div>
  <div class="assay-chart-style-tabs" role="tablist" aria-label="Chart format sections">
    ${TABS.map((tab, i) => `<button type="button" role="tab" id="assay-cc-tab-${tab.id}"
      aria-controls="assay-cc-panel-${tab.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}"
      data-cc-tab="${tab.id}">${tab.label}</button>`).join('')}
  </div>
  ${panel('frame', `
    ${picker('frameStyle', 'Frame')}
    ${row(color('frameStroke', 'Color') + number('frameStrokeWidth', 'Thickness (pt)', 0, 4.5, 0.25))}
    ${color('backgroundColor', 'Background')}
    ${section('Grid', row(check('showVerticalGrid', 'Vertical') + check('showHorizontalGrid', 'Horizontal'))
      + row(color('gridColor', 'Grid color') + number('gridStrokeWidth', 'Thickness (pt)', 0, 4.5, 0.25)))}
    ${section('Plot dimensions', check('sizeAuto', 'Fit to canvas')
      + row(number('frameWidth', 'Width (px)', 320, 2000, 1) + number('frameHeight', 'Height (px)', 180, 1200, 1))
      + '<p class="assay-chart-style-note">Dimensions describe the framed plot. Titles and labels sit outside it.</p>')}
  `)}
  ${panel('axis', `
    ${axisGrid(axisColumn('x') + axisColumn('y'))}
    ${section('Ticks', axisGrid(tickColumn('x') + tickColumn('y')))}
    ${section('Reference line', select('refLineAxis', 'Reference axis', [['y', 'Horizontal (Y)'], ['x', 'Vertical (X)']])
      + number('refLineValue', 'Value', null, null, 'any', 'Off'))}
  `)}
  ${panel('series', `
    ${select('chartType', 'Chart type', [['auto', 'Auto'], ['line', 'Line'], ['bar', 'Bar']])}
    ${select('seriesTarget', 'Data series', [['', 'All series']])}
    ${row(color('color', 'Series color') + number('opacity', 'Opacity', 0.1, 1, 0.1))}
    <div class="form-actions"><button type="button" data-cc="seriesDefaults" class="ghost-btn">Use defaults</button></div>
    ${section('Symbols', row(picker('pointShape', 'Shape') + number('pointSize', 'Size (pt)', 0.75, 15, 0.25))
      + select('markerFill', 'Fill', [['filled', 'Filled'], ['open', 'Open']]), 'data-cc="symbolFields"')}
    ${section('Lines', select('mode', 'Display', [['lines+markers', 'Line + points'], ['lines', 'Line only'], ['markers', 'Points only']])
      + row(picker('lineStyle', 'Pattern') + number('lineWidth', 'Thickness (pt)', 0.375, 6, 0.125)), 'data-cc-when="line"')}
    ${section('Bars', row(color('barOutlineColor', 'Outline color') + number('barOutlineWidth', 'Thickness (pt)', 0, 6, 0.25))
      + row(select('barMode', 'Arrangement', [['group', 'Grouped'], ['stack', 'Stacked']])
        + number('barCornerRadius', 'Corner radius (pt)', 0, 22.5, 0.25))
      + check('barLabels', 'Value labels'), 'data-cc-when="bar"')}
    ${section('Error bars', color('errorColor', 'Error-bar color')
      + row(number('errorCapWidth', 'Cap width (pt)', 0, 15, 0.25)
        + number('errorThickness', 'Thickness (pt)', 0.375, 4.5, 0.125)), 'data-cc="errorFields"')}
    ${select('legendPosition', 'Legend position', [['top', 'Top'], ['bottom', 'Bottom'], ['right', 'Right'], ['none', 'Hidden']])}
    <details class="assay-chart-style-subsection" data-cc="columnFields">
      <summary class="assay-chart-style-subhead">Data mapping</summary>
      ${select('xColumn', 'X column', [])}${select('yColumn', 'Y column', [])}${select('seriesColumn', 'Series column', [])}
    </details>
    <p class="assay-chart-style-note" data-cc="columnNote"></p>
  `)}
  ${panel('text', `
    ${select('textTarget', 'Text element', [['title', 'Chart title'], ['xTitle', 'X axis title'], ['yTitle', 'Y axis title'],
      ['xTicks', 'X tick labels'], ['yTicks', 'Y tick labels'], ['legend', 'Legend'], ['barLabels', 'Bar-value labels']])}
    <div data-cc="titleFields" class="assay-chart-style-subsection">
      <label>Text<input type="text" data-cc="titleText" maxlength="200" /></label>
      ${row(number('titlePos', 'Position (0–1)', 0, 1, 0.05, 'Center') + number('titleOffset', 'Distance (pt)', 0, 150, 0.25, 'Auto'))}
    </div>
    ${section('Font', '<div data-cc="textBar"></div>')}
  `)}
  <p data-cc="validation" class="assay-chart-style-validation" role="status" aria-live="polite" hidden></p>
</div>`;
export { TABS, TAB_KEYS, PANEL_HTML };
