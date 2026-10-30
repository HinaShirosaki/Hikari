// Load one renderer: the worksheet has a smaller build of the same app entry and a
// light grid (trial-grid.js) in place of Tabulator. This runs in <head>: fetch both
// alongside the styles and vendor scripts, and run them in order once those have.
(function () {
  const loader = document.currentScript;
  const { feature, capture } = window.HikariBrowserTrial;
  const sources = feature === 'calculations' && !capture
    ? [loader.dataset.grid, loader.dataset.calculationsBundle]
    : [loader.dataset.tabulator, loader.dataset.defaultBundle];
  for (const href of sources) document.head.append(Object.assign(document.createElement('link'), { rel: 'preload', as: 'script', href }));
  document.addEventListener('DOMContentLoaded', () => {
    for (const src of sources) document.body.append(Object.assign(document.createElement('script'), { src, async: false }));
  }, { once: true });
})();
