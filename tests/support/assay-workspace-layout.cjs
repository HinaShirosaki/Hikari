const assert = require('node:assert/strict');

module.exports = async function checkWorkspaceLayout({ js, settle, shot, win }) {
  const canvasGeometry = () => js(`(() => {
    const host=qa.host, style=getComputedStyle(host), workspace=document.getElementById('assay-analyze-workspace');
    return { width:host.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),
      height:host.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom),
      figureWidth:host.layout.width,figureHeight:host.layout.height,
      bottom:document.getElementById('assay-workspace-chart').getBoundingClientRect().bottom,
      availableBottom:workspace.getBoundingClientRect().bottom-parseFloat(getComputedStyle(workspace).paddingBottom),
      workspaceBottom:workspace.getBoundingClientRect().bottom,layoutBottom:workspace.parentElement.getBoundingClientRect().bottom,
      scroll:workspace.scrollHeight-workspace.clientHeight };
  })()`);
  const compactCanvas = await canvasGeometry();
  assert.ok(Math.abs(compactCanvas.bottom-compactCanvas.availableBottom) <= 1, 'the canvas extends to the workspace bottom');
  assert.ok(compactCanvas.figureWidth > 0 && compactCanvas.figureHeight > 0, 'the plot has a fixed frame');
  assert.ok(compactCanvas.scroll <= 1, 'the chart canvas fits without scrolling the workspace');
  assert.ok(compactCanvas.workspaceBottom <= compactCanvas.layoutBottom+1, 'the chart workspace stays inside its layout');
  win.setContentSize(1800,1000);await settle();
  const largerCanvas = await canvasGeometry();
  assert.deepEqual([largerCanvas.figureWidth,largerCanvas.figureHeight], [compactCanvas.figureWidth,compactCanvas.figureHeight], 'the native plot keeps its frame when the workspace grows');
  assert.ok(Math.abs(largerCanvas.bottom-largerCanvas.availableBottom) <= 1 && largerCanvas.scroll <= 1, 'the enlarged canvas stays within the workspace');
  await shot('18-expanded-canvas');
  await js("qa.tab('frame');qa.set('sizeAuto',false);qa.set('frameWidth',360);qa.set('frameHeight',240)");await settle();
  win.setContentSize(1280,800);await settle();
  assert.deepEqual(await js('({width:qa.host.layout.width-qa.host.layout.margin.l-qa.host.layout.margin.r,height:qa.host.layout.height-qa.host.layout.margin.t-qa.host.layout.margin.b})'),
    {width:360,height:240}, 'manual plot dimensions survive workspace resizing');
  await js("qa.set('frameWidth','');qa.set('frameHeight','');qa.set('sizeAuto',true)");await settle();
  await js("document.getElementById('assay-workspace-view-chart').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))");
  await settle();
  assert.equal(await js('document.activeElement.id'), 'assay-workspace-view-data', 'vertical view tabs support arrow keys');
  await js("document.getElementById('assay-data-tab-summary').click();document.getElementById('assay-workspace-view-chart').click();document.getElementById('assay-workspace-view-data').click()");
  await settle();
  assert.equal(await js("document.getElementById('assay-summary-panel').hidden"), false, 'the data tab survives view switches');
  await shot('15-data-only');

  const width = () => js("document.getElementById('universal-agent-chat-rail').getBoundingClientRect().width");
  const formatWidth = await width();
  await js("document.getElementById('agent-chat-rail-toggle-btn').click()");await settle();
  assert.equal(await js("document.getElementById('assay-context-rail').hidden"), true, 'opening chat closes the controls');
  assert.equal(await js("document.body.classList.contains('has-agent-chat-rail-expanded')"), true);
  assert.equal(await width(), formatWidth, 'chat and controls occupy the same width');
  await shot('16-shared-chat');
  await js("document.getElementById('assay-analysis-toggle-btn').click()");await settle();
  assert.equal(await js("document.body.classList.contains('has-agent-chat-rail-expanded')"), false, 'opening controls closes chat');
  assert.equal(await js("document.getElementById('assay-analysis-panel').hidden"), false);
  await js("document.getElementById('assay-context-close-btn').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");await settle();
  assert.equal(await js('document.activeElement.id'), 'assay-analysis-toggle-btn', 'Escape returns focus to the panel toggle');
  assert.equal(await width(), 44, 'closing controls gives their space back to the workspace');
  await js("document.getElementById('assay-workspace-view-chart').click();document.getElementById('assay-workspace-format-btn').click()");await settle();
  assert.equal(await js("document.getElementById('assay-chart-format-panel').hidden"), false, 'the chart shortcut opens the format rail');

  await js("document.body.dataset.agentAvailability='offline';document.dispatchEvent(new CustomEvent('hikari:agent-chat-rail-availability-changed'))");await settle();
  assert.equal(await js("document.getElementById('universal-agent-chat-rail').hidden"), false, 'Plate controls remain available offline');
  assert.equal(await js("document.getElementById('assay-workspace-tools').hidden"), false);
  await js("document.getElementById('assay-mode-create-btn').click()");await settle();
  assert.equal(await js("document.getElementById('assay-workspace-tools').hidden && document.getElementById('assay-context-rail').hidden"), true, 'Setup hides Analyze tools');
  assert.equal(await js("document.getElementById('universal-agent-chat-rail').hidden"), true, 'Setup keeps its original rail layout');
  await js("document.body.dataset.agentAvailability='connected';document.getElementById('assay-mode-results-btn').click()");await settle();
  assert.equal(await js("document.getElementById('assay-workspace-tools').hidden"), false, 'returning to Analyze restores the tools');
  assert.equal(await js('Boolean(qa.host?.data?.length)'), true, 'returning to Analyze immediately restores the chart');
  await js("document.body.dataset.activeView='papers-view'");await settle();
  assert.equal(await js("document.getElementById('assay-context-rail').hidden && document.getElementById('assay-workspace-tools').hidden"), true, 'other apps do not inherit Plate controls');
  await js("document.body.dataset.activeView='assay-view'");await settle();
  assert.equal(await js("document.getElementById('assay-context-rail').hidden"), false);
  assert.equal(await js("document.querySelectorAll('#assay-workspace-tools').length"), 1, 'navigation reuses the mounted controls');

  await js(`(async () => {
    const { i18n } = await import(${JSON.stringify(require('node:url').pathToFileURL(require('node:path').resolve(__dirname, '../../src/renderer/lib/i18n/index.js')).href)});
    window.qaLayoutI18n = i18n;
    i18n.setLocale('zh-Hans');
  })()`);
  assert.equal(await js("document.getElementById('assay-workspace-view-data').getAttribute('aria-label')"), '数据', 'moved controls switch language live');
  await js("qaLayoutI18n.setLocale('en')");

  win.setContentSize(900, 700);await settle();
  assert.equal(await js("document.documentElement.scrollWidth <= innerWidth"), true, 'the narrow workspace stays within the window');
  assert.equal(await js("getComputedStyle(document.querySelector('.assay-results-controls-panel')).display"), 'none', 'narrow layouts release navigation space');
  assert.ok(await js('qa.host.getBoundingClientRect().height') > 200, 'the chart remains visible after narrowing the workspace');
  await shot('17-narrow-workspace');
  win.setContentSize(1280, 800);await settle();

  await js("document.getElementById('assay-workspace-view-data').click();qa.module.renderAgentPlotlyGraph({figure:{data:[{x:[1,2,3],y:[3,2,1],type:'scatter'}],layout:{title:{text:'Agent chart'}}}})");await settle();
  await js("document.getElementById('assay-workspace-view-chart').click()");await settle();
  assert.equal(await js("document.querySelector('[data-assay-agent-plotly-chart]').data[0].y.join(',')"), '3,2,1', 'agent charts survive hidden-to-visible view changes');
  assert.ok(await js("document.querySelector('[data-assay-agent-plotly-chart]')._fullLayout.width") > 0, 'the agent chart has a visible layout');
  const agentGeometry = () => js("(() => {const h=document.querySelector('[data-assay-agent-plotly-chart]');return {width:h._fullLayout.width,height:h._fullLayout.height,autosize:h.layout.autosize,responsive:h._context.responsive}})()");
  const fixedAgent = {width:700,height:500,autosize:false,responsive:false};
  assert.deepEqual(await agentGeometry(), fixedAgent, 'a legacy unsized figure gets fixed dimensions even when first mounted hidden');
  await js("document.getElementById('assay-context-close-btn').click();document.getElementById('agent-chat-rail-toggle-btn').click()");await settle();
  assert.deepEqual(await agentGeometry(), fixedAgent, 'opening chat preserves agent dimensions');
  await js("document.getElementById('agent-chat-rail-toggle-btn').click()");await settle();
  win.setContentSize(1800,1000);await settle();
  assert.deepEqual(await agentGeometry(), fixedAgent, 'folding chat and enlarging the window preserve agent dimensions');
  win.setContentSize(900,700);await settle();
  assert.deepEqual(await agentGeometry(), fixedAgent, 'a narrow viewport preserves figure dimensions');
  await js("document.getElementById('agent-chat-rail-toggle-btn').click()");await settle();
  assert.deepEqual(await agentGeometry(), fixedAgent, 'opening chat in a narrow viewport preserves figure dimensions');
  assert.ok(await js("document.documentElement.scrollWidth <= innerWidth"), 'oversized figures scroll inside the canvas');
  assert.ok(await js("document.querySelector('[data-assay-agent-plotly-chart]').scrollWidth > document.querySelector('[data-assay-agent-plotly-chart]').clientWidth"), 'the narrow canvas provides horizontal scrolling');
  const exportedSize = () => js("Plotly.toImage(document.querySelector('[data-assay-agent-plotly-chart]'),{format:'svg'}).then(url=>{const svg=new DOMParser().parseFromString(decodeURIComponent(url.slice(url.indexOf(',')+1)),'image/svg+xml').documentElement;return [svg.getAttribute('width'),svg.getAttribute('height')]})");
  assert.deepEqual(await exportedSize(), ['700','500'], 'SVG export uses the same dimensions in a narrow canvas');
  await js("document.getElementById('agent-chat-rail-toggle-btn').click()");await settle();
  win.setContentSize(1280,800);await settle();
  await js("const kind=document.getElementById('assay-analysis-kind');kind.value='linear';kind.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('assay-workspace-view-chart').click()");await settle();
};
