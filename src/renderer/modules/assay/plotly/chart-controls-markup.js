
// Assay-owned controls for the Plotly figure configuration, grouped into five tabs.
// `data-cc-when="bar|line"` marks a control that only affects one chart type;
// `data-cc-needs` marks one that needs something in the rendered figure.

const TABS = [
  { id: 'data', label: 'Data' },
  { id: 'axes', label: 'Axes' },
  { id: 'series', label: 'Series' },
  { id: 'style', label: 'Style' },
  { id: 'text', label: 'Text' }
];

// Which style fields each tab owns, so "Reset tab" can restore just that section.
const TAB_KEYS = {
  data: ['chartType', 'xColumn', 'yColumn', 'seriesColumn', 'barMode', 'barLabels', 'barCornerRadius'],
  axes: [
    'xScale', 'yScale', 'xRange', 'yRange', 'xTick', 'yTick',
    'tickDir', 'tickLen', 'minorTicks', 'tickFormat', 'refLineAxis', 'refLineValue'
  ],
  series: [
    'mode', 'legendPosition', 'pointShape', 'pointSize', 'markerFill', 'opacity',
    'lineStyle', 'lineWidth', 'seriesColors', 'seriesShapes', 'palette'
  ],
  style: [
    'frameStyle', 'frameStroke', 'frameStrokeWidth', 'backgroundColor',
    'showVerticalGrid', 'showHorizontalGrid', 'gridColor', 'gridStrokeWidth',
    'errorCapWidth', 'errorThickness', 'sizeAuto', 'frameWidth', 'frameHeight'
  ],
  text: [
    'title', 'xTitle', 'yTitle', 'text',
    'xTitlePos', 'yTitlePos', 'xTitleOffset', 'yTitleOffset'
  ]
};

const PANEL_HTML = `
  <div class="assay-chart-style">
    <div class="assay-chart-style-presets">
      <label>
        Preset
        <select data-cc="presetSelect">
          <option value="">Custom</option>
        </select>
      </label>
      <div class="form-actions assay-chart-style-preset-actions">
        <button type="button" data-cc="presetSaveBtn" class="ghost-btn">Save as&hellip;</button>
        <button type="button" data-cc="presetDeleteBtn" class="ghost-btn">Delete</button>
      </div>
    </div>
    <div class="assay-chart-style-tabs" role="tablist" aria-label="Chart format sections">
      ${TABS.map((tab, index) => `
        <button type="button" role="tab" id="assay-cc-tab-${tab.id}"
          aria-controls="assay-cc-panel-${tab.id}"
          aria-selected="${index === 0 ? 'true' : 'false'}"
          data-cc-tab="${tab.id}">${tab.label}</button>
      `).join('')}
    </div>

    <div class="assay-chart-style-panel" role="tabpanel" id="assay-cc-panel-data"
      aria-labelledby="assay-cc-tab-data" data-cc-panel="data">
      <div data-cc="columnFields">
        <label>X column<select data-cc="xColumn"></select></label>
        <label>Y column<select data-cc="yColumn"></select></label>
        <label>Series column<select data-cc="seriesColumn"></select></label>
      </div>
      <p class="assay-chart-style-note" data-cc="columnNote"></p>
      <div class="assay-chart-style-subsection" data-cc-when="bar">
        <span class="assay-chart-style-subhead">Bars</span>
        <label>Mode<select data-cc="barMode"><option value="group">Grouped</option><option value="stack">Stacked</option></select></label>
        <label class="assay-chart-style-checkbox"><input type="checkbox" data-cc="barLabels" />Value labels</label>
        <label>Corner radius<input type="number" min="0" max="30" step="1" data-cc="barCornerRadius" /></label>
      </div>
    </div>

    <div class="assay-chart-style-panel" role="tabpanel" id="assay-cc-panel-axes"
      aria-labelledby="assay-cc-tab-axes" data-cc-panel="axes" hidden>
      <div class="assay-chart-style-axis-grid">
        <span></span><span class="assay-chart-style-axis-head">X</span><span class="assay-chart-style-axis-head">Y</span>
        <span class="assay-chart-style-axis-label">Scale</span>
        <select data-cc="xScale" aria-label="X scale" data-cc-when="line">
          <option value="linear">Linear</option><option value="log10">Log10</option>
          <option value="log2">Log2</option><option value="ln">Ln</option>
        </select>
        <select data-cc="yScale" aria-label="Y scale">
          <option value="linear">Linear</option><option value="log10">Log10</option>
          <option value="log2">Log2</option><option value="ln">Ln</option>
        </select>
        <span class="assay-chart-style-axis-label">Auto range</span>
        <input type="checkbox" data-cc="xRangeAuto" aria-label="X auto range" data-cc-when="line" />
        <input type="checkbox" data-cc="yRangeAuto" aria-label="Y auto range" />
        <span class="assay-chart-style-axis-label">Min</span>
        <input type="number" step="any" data-cc="xMin" aria-label="X min" data-cc-when="line" />
        <input type="number" step="any" data-cc="yMin" aria-label="Y min" />
        <span class="assay-chart-style-axis-label">Max</span>
        <input type="number" step="any" data-cc="xMax" aria-label="X max" data-cc-when="line" />
        <input type="number" step="any" data-cc="yMax" aria-label="Y max" />
        <span class="assay-chart-style-axis-label">Tick step</span>
        <input type="number" step="any" min="0" data-cc="xTick" aria-label="X tick interval" data-cc-when="line" />
        <input type="number" step="any" min="0" data-cc="yTick" aria-label="Y tick interval" />
      </div>
      <div class="assay-chart-style-subsection">
        <span class="assay-chart-style-subhead">Ticks</span>
        <label>Marks<select data-cc="tickDir">
          <option value="outside">Outside</option><option value="inside">Inside</option><option value="none">None</option>
        </select></label>
        <label>Length<input type="number" min="0" max="20" step="1" data-cc="tickLen" /></label>
        <label class="assay-chart-style-checkbox"><input type="checkbox" data-cc="minorTicks" />Minor ticks</label>
        <label>Number format<select data-cc="tickFormat">
          <option value="auto">Auto</option><option value="fixed1">0.0</option><option value="fixed2">0.00</option>
          <option value="sci">1e3</option><option value="si">SI (k/M)</option><option value="power">10&#8319;</option>
        </select></label>
      </div>
      <div class="assay-chart-style-subsection">
        <span class="assay-chart-style-subhead">Reference line</span>
        <div class="assay-chart-style-row">
          <label>Axis<select data-cc="refLineAxis">
            <option value="y">Horizontal (Y)</option><option value="x">Vertical (X)</option>
          </select></label>
          <label>Value<input type="number" step="any" data-cc="refLineValue" placeholder="(off)" /></label>
        </div>
      </div>
    </div>

    <div class="assay-chart-style-panel" role="tabpanel" id="assay-cc-panel-series"
      aria-labelledby="assay-cc-tab-series" data-cc-panel="series" hidden>
      <label data-cc-when="line">Display<select data-cc="mode">
        <option value="lines+markers">Line + points</option>
        <option value="lines">Line only</option>
        <option value="markers">Points only</option>
      </select></label>
      <label>Legend<select data-cc="legendPosition">
        <option value="top">Top</option><option value="bottom">Bottom</option>
        <option value="right">Right</option><option value="none">Hidden</option>
      </select></label>
      <div class="assay-chart-style-subsection" data-cc-when="line">
        <span class="assay-chart-style-subhead">Defaults for all series</span>
        <div class="assay-chart-style-row">
          <label>Shape<div data-cc="pointShape" class="assay-chart-picker-mount"></div></label>
          <label>Size<div data-cc="pointSize" class="assay-chart-picker-mount"></div></label>
        </div>
        <div class="assay-chart-style-row">
          <label>Fill<select data-cc="markerFill"><option value="filled">Filled</option><option value="open">Open</option></select></label>
          <label>Opacity<input type="number" min="0.1" max="1" step="0.1" data-cc="opacity" /></label>
        </div>
        <div class="assay-chart-style-row">
          <label>Line<div data-cc="lineStyle" class="assay-chart-picker-mount"></div></label>
          <label>Width (pt)<div data-cc="lineWidth" class="assay-chart-picker-mount"></div></label>
        </div>
      </div>
      <label data-cc-when="bar">Opacity<input type="number" min="0.1" max="1" step="0.1" data-cc="opacityBar" /></label>
      <div class="assay-chart-style-subsection">
        <span class="assay-chart-style-subhead">Overrides</span>
        <div data-cc="seriesColors" class="assay-chart-style-series"></div>
      </div>
    </div>

    <div class="assay-chart-style-panel" role="tabpanel" id="assay-cc-panel-style"
      aria-labelledby="assay-cc-tab-style" data-cc-panel="style" hidden>
      <div class="assay-chart-style-subsection">
        <span class="assay-chart-style-subhead">Frame</span>
        <label>Style<div data-cc="frameStyle" class="assay-chart-picker-mount"></div></label>
        <div class="assay-chart-style-row">
          <label>Stroke<input type="color" data-cc="frameStroke" /></label>
          <label>Width (pt)<div data-cc="frameStrokeWidth" class="assay-chart-picker-mount"></div></label>
        </div>
        <label>Background<input type="color" data-cc="backgroundColor" /></label>
      </div>
      <div class="assay-chart-style-subsection">
        <span class="assay-chart-style-subhead">Grid</span>
        <label class="assay-chart-style-checkbox"><input type="checkbox" data-cc="gridVertical" />Vertical lines</label>
        <label class="assay-chart-style-checkbox"><input type="checkbox" data-cc="gridHorizontal" />Horizontal lines</label>
        <div class="assay-chart-style-row">
          <label>Colour<input type="color" data-cc="gridColor" /></label>
          <label>Width (px)<div data-cc="gridStrokeWidth" class="assay-chart-picker-mount"></div></label>
        </div>
      </div>
      <div class="assay-chart-style-subsection" data-cc-needs="errorBars">
        <span class="assay-chart-style-subhead">Error bars</span>
        <div class="assay-chart-style-row">
          <label>Cap width<input type="number" min="0" max="20" step="1" data-cc="errorCapWidth" /></label>
          <label>Thickness<input type="number" min="0.5" max="6" step="0.5" data-cc="errorThickness" /></label>
        </div>
      </div>
      <div class="assay-chart-style-subsection">
        <span class="assay-chart-style-subhead">Plot size</span>
        <label class="assay-chart-style-checkbox"><input type="checkbox" data-cc="sizeAuto" />Fit to canvas</label>
        <div class="assay-chart-style-row">
          <label>Width (px)<input type="number" min="320" max="2000" step="1" data-cc="frameWidth" /></label>
          <label>Height (px)<input type="number" min="180" max="1200" step="1" data-cc="frameHeight" /></label>
        </div>
      </div>
    </div>

    <div class="assay-chart-style-panel" role="tabpanel" id="assay-cc-panel-text"
      aria-labelledby="assay-cc-tab-text" data-cc-panel="text" hidden>
      <label>Chart title<input type="text" data-cc="title" placeholder="(none)" /></label>
      <div class="assay-chart-style-subsection">
        <span class="assay-chart-style-subhead">X axis title</span>
        <label>Name<input type="text" data-cc="xTitle" placeholder="(from analysis)" /></label>
        <div class="assay-chart-style-row">
          <label>Along axis (0&ndash;1)<input type="number" min="0" max="1" step="0.05" data-cc="xTitlePos" placeholder="(centred)" /></label>
          <label>Distance (px)<input type="number" min="0" max="200" step="1" data-cc="xTitleOffset" placeholder="(auto)" /></label>
        </div>
      </div>
      <div class="assay-chart-style-subsection">
        <span class="assay-chart-style-subhead">Y axis title</span>
        <label>Name<input type="text" data-cc="yTitle" placeholder="(from analysis)" /></label>
        <div class="assay-chart-style-row">
          <label>Along axis (0&ndash;1)<input type="number" min="0" max="1" step="0.05" data-cc="yTitlePos" placeholder="(centred)" /></label>
          <label>Distance (px)<input type="number" min="0" max="200" step="1" data-cc="yTitleOffset" placeholder="(auto)" /></label>
        </div>
      </div>
      <div class="assay-chart-style-subsection">
        <span class="assay-chart-style-subhead">Type</span>
        <div data-cc="textBar"></div>
      </div>
    </div>

    <div class="form-actions assay-chart-style-actions">
      <button type="button" data-cc="resetTabBtn" class="ghost-btn">Reset this tab</button>
      <button type="button" data-cc="resetBtn" class="ghost-btn">Reset all</button>
    </div>
  </div>
`;

export { TABS, TAB_KEYS, PANEL_HTML };
