// Additional coverage for formatter/configuration-driven controls and shared
// binding metadata. A QA-only marked locale exposes accidental English bypasses.
export async function checkCompletedPresentation({ i18n, check }) {
  const { createPresentation } = await import('../../../src/renderer/lib/i18n/presentation.js');
  const { translateTree } = await import('../../../src/renderer/lib/i18n/dom.js');
  const { PANEL_HTML } = await import('../../../src/renderer/modules/assay/plotly/chart-controls-markup.js');
  const namespaces = ['home','settings','notebook','plate','dna','agent','papers','workflow','protocol','samples','chemicals','tools','shell'];
  for (const ns of namespaces) i18n.registerMessages('fr', ns, Object.fromEntries(i18n.englishEntries(ns).map(([key, message]) => [key.slice(ns.length + 1), typeof message === 'string' ? `⟦${message}⟧` : Object.fromEntries(Object.entries(message).map(([kind, text]) => [kind, `⟦${text}⟧`]))])));
  const host = document.createElement('div'); host.hidden = true; document.body.append(host);
  const ui = createPresentation('plate');
  i18n.setLocale('en'); ui.setHtml(host, PANEL_HTML);
  const select = host.querySelector('[data-cc="xScale"]');
  const values = [...select.options].map(option => option.value);
  const linear = select.options[0];
  check(linear.dataset.i18n && linear.textContent === 'Linear', 'Chart enum labels bind to option elements');
  select.value = 'log10';
  i18n.setLocale('fr'); translateTree(host);
  check(linear.textContent === '⟦Linear⟧' && select.value === 'log10' && JSON.stringify([...select.options].map(o => o.value)) === JSON.stringify(values), 'Chart translations preserve scientific enum values and the current selection');
  check([...host.querySelectorAll('[data-i18n]')].every(node => node.textContent.startsWith('⟦')), 'Every marked chart control uses the selected catalog');
  const count = document.createElement('span'); host.append(count);
  const homeUi = createPresentation('home');
  homeUi.setText(count, homeUi.message('{count} entries', { count: 3 }));
  homeUi.setAttribute(count, 'title', homeUi.message('{count} pages', { count: 4 }));
  homeUi.setAttribute(count, 'aria-label', homeUi.message('{count} uploads', { count: 5 }));
  translateTree(host);
  check(count.textContent === '⟦3 entries⟧' && count.title === '⟦4 pages⟧' && count.getAttribute('aria-label') === '⟦5 uploads⟧', 'Text and two attributes keep independent interpolation parameters');
  const composed = homeUi.compose([homeUi.message('{count} pages', { count: 2 }), ' · ', homeUi.message('{count} uploads', { count: 2 })]);
  homeUi.setAttribute(count, 'title', composed);
  i18n.setLocale('en'); translateTree(host);
  check(count.textContent === '3 entries' && count.title === '2 pages · 2 uploads', 'Composite accessibility copy follows a locale switch');
  homeUi.setText(count, 'Record name <&>');
  homeUi.setAttribute(count, 'title', 'User title <&>');
  i18n.setLocale('fr'); translateTree(host);
  check(count.textContent === 'Record name <&>' && count.title === 'User title <&>', 'Replacing a UI placeholder with data removes stale bindings');
  check(!ui.html('Frame').includes('<script'), 'Messages render as escaped plain text');
  host.remove(); i18n.setLocale('es');
}
