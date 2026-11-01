const assert = require('node:assert/strict');

module.exports = async function checkWorkspaceLayout({ js, settle, shot, win }) {
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
  await js("const kind=document.getElementById('assay-analysis-kind');kind.value='linear';kind.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('assay-workspace-view-chart').click()");await settle();
};
