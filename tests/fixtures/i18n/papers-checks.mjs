// Real Papers rail, viewer chrome and panels with a generated PDF and disposable state.
export async function checkLocalizedPapers({ core, i18n, check }) {
  const { buildHighlightPopoverMarkup } = await import('../../../src/renderer/modules/papers/pdf-viewer/pdf-viewer-search.js');
  const { createExternalLinkOpener } = await import('../../../src/renderer/modules/papers/management/external-links.js');
  const module = core.moduleRuntime.modules.papers;
  const state = core.state;
  const byId = id => document.getElementById(id);
  const root = byId('papers-view');
  const toolbar = byId('paper-viewer-toolbar');
  const settle = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
  const toast = () => document.querySelector('[data-hikari-transient-toast]');
  const params = node => JSON.parse(node.getAttribute('data-i18n-params') || '{}');
  const assertBindings = (host) => {
    for (const node of host.querySelectorAll('[data-i18n]')) {
      if (node.children.length) continue;
      check(i18n.has(node.dataset.i18n) && node.textContent === i18n.t(node.dataset.i18n, params(node)), 'Papers binding: ' + node.dataset.i18n);
    }
    for (const attribute of ['title', 'aria-label', 'placeholder', 'data-hover-caption']) {
      const binding = 'data-i18n-' + attribute.replace(/^data-/, '');
      for (const node of host.querySelectorAll('[' + binding + ']')) {
        const key = node.getAttribute(binding);
        check(node.getAttribute(attribute) === i18n.t(key, JSON.parse(node.getAttribute(binding + '-params') || node.getAttribute('data-i18n-params') || '{}')), 'Papers attribute binding: ' + key);
      }
    }
  };

  i18n.setLocale('en');
  const pdf = new window.jspdf.jsPDF();
  pdf.text('Localized paper example', 20, 30);
  pdf.outline.add(null, 'Intro <&>', { pageNumber: 1 });
  const pdfDataUrl = 'data:application/pdf;base64,' + pdf.output('datauristring').split(',')[1];
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60000).toISOString();
  state.journalClubs = [...(state.journalClubs || []), { id: 'i18n-club', name: 'Club <&>' }];
  state.papers = [...(state.papers || []),
    { id: 'i18n-paper', title: 'Paper <&>', fileName: 'i18n.pdf', linkedType: 'journal-club', linkedId: 'i18n-club', linkedName: 'Club <&>',
      storedRelativePath: 'Papers/i18n.pdf', pdfDataUrl, ingestionStatus: 'ready', updatedAt: fiveMinutesAgo,
      pdfMetadata: { title: 'Paper <&>', author: 'Ada <&>' },
      comments: [{ id: 'i18n-comment', author: 'Alice <&>', text: 'Literal note <&>', pageNumber: 1, anchorX: 0.2, anchorY: 0.2 }], highlights: [] },
    { id: 'i18n-running', title: 'Running <&>', fileName: 'running.pdf', linkedType: 'journal-club', linkedId: 'i18n-club', linkedName: 'Club <&>',
      storedRelativePath: 'Papers/running.pdf', ingestionStatus: 'running', updatedAt: fiveMinutesAgo, comments: [], highlights: [] }];
  module.history.persist();
  core.navigationShell.showView('papers-view'); module.render(); await settle();
  const rail = byId('journal-club-list');
  const findAge = () => rail.querySelector('[data-paper-view="i18n-paper"] .papers-paper-time');
  const findRunning = () => rail.querySelector('[data-paper-view="i18n-running"] .papers-paper-processing');
  let age = findAge(); let running = findRunning();
  check(age?.textContent === '5m' && running?.textContent === 'Processing' && running.title === 'Reading the PDF and building its notes',
    'English rail ages and processing badges keep their wording');
  check(await module.openStoredPaper({ relativePath: 'Papers/i18n.pdf' }), 'The generated PDF opens');
  for (let attempt = 0; attempt < 50 && !document.querySelector('.papers-viewer-text-layer span'); attempt++) await settle(80);
  check(document.querySelector('.papers-viewer-text-layer span'), 'Generated PDF text rendered: ' + byId('paper-viewer-status').textContent + ' / pages=' + document.querySelectorAll('.papers-viewer-page').length + ' / active=' + module.getActivePaperId() + ' / view=' + document.body.dataset.activeView + ' / hidden=' + byId('paper-viewer-workspace').hidden);
  const before = JSON.stringify(state.papers);
  age = findAge(); running = findRunning();
  assertBindings(root); assertBindings(toolbar);

  const comment = byId('paper-selection-comment-text');
  byId('paper-selection-comment-popover').hidden = false;
  comment.value = 'Unsaved note <&>'; comment.focus(); comment.setSelectionRange(2, 7);
  i18n.setLocale('es'); await settle(20);
  check(document.activeElement === comment && comment.value === 'Unsaved note <&>' && comment.selectionStart === 2 && comment.selectionEnd === 7
    && JSON.stringify(state.papers) === before, 'Language switching preserves the comment draft, focus, selection and paper records: '
    + (document.activeElement === comment) + ' ' + comment.selectionStart + '-' + comment.selectionEnd + ' ' + (JSON.stringify(state.papers) === before));
  byId('paper-selection-comment-popover').hidden = true;
  check(byId('paper-viewer-prev-btn').title === 'Página anterior' && byId('paper-viewer-print-btn').getAttribute('aria-label') === 'Imprimir'
    && comment.placeholder === 'Añada una nota sobre el texto seleccionado', 'Toolbar and comment controls translate live');
  check(age.isConnected && age.textContent === '5 min' && running.textContent === 'Procesando', 'Rail ages and processing badges translate live');
  const zoom = byId('paper-viewer-zoom-label');
  check(/^\d+% ajustado$/.test(zoom.textContent), 'Fit-width zoom label translates: ' + zoom.textContent);
  const page = document.querySelector('.papers-viewer-page .papers-viewer-link-layer');
  check(page?.getAttribute('aria-label') === 'Enlaces de la página 1 del artículo', 'Page layer accessibility labels translate');
  const pin = document.querySelector('[data-comment-id="i18n-comment"]');
  check(pin?.getAttribute('aria-label') === 'Comentario de Alice <&>', 'Comment pins keep the literal author');

  // Side panels: details, outline and research brief update in place.
  byId('paper-details-toggle-btn').click(); await settle();
  const details = byId('paper-summary-list');
  check(byId('paper-details-toggle-btn').getAttribute('aria-label') === 'Cerrar detalles del artículo'
    && details.querySelector('dt').textContent === 'Título' && details.textContent.includes('Paper <&>') && details.textContent.includes('No disponible'),
  'Paper details translate field labels around literal metadata');
  byId('paper-comment-toggle-btn').click(); await settle();
  const bookmarks = byId('paper-bookmark-list');
  check(bookmarks.textContent.includes('Intro <&>') && bookmarks.querySelector('.papers-bookmark-page')?.textContent === 'p. 1',
    'Bookmark chrome translates while PDF outline titles stay literal: ' + bookmarks.textContent.trim());
  byId('paper-brief-toggle-btn').click(); await settle(120);
  const brief = byId('paper-brief-content');
  const briefText = brief.textContent;
  i18n.setLocale('en');
  check(brief.textContent !== briefText && byId('paper-brief-toggle-btn').getAttribute('aria-label') === 'Close research brief',
    'Research brief status and panel toggles switch language in place: ' + briefText);
  i18n.setLocale('es');
  assertBindings(root); assertBindings(toolbar);

  // Highlight popover markup, the external-link confirm and folder validation.
  const host = document.createElement('div');
  host.innerHTML = buildHighlightPopoverMarkup({ text: 'Quoted <&>', kind: 'underline' }, { comment: { author: 'Bea <&>', text: 'Note <&>' } });
  document.body.append(host);
  check(host.querySelector('[data-paper-highlight-delete]').getAttribute('aria-label') === 'Eliminar subrayado y comentario'
    && host.textContent.includes('Bea <&>') && !host.querySelector('img'), 'Highlight popover labels translate around literal comments');
  i18n.setLocale('en');
  check(host.querySelector('[data-paper-highlight-delete]').getAttribute('aria-label') === 'Delete underline and comment', 'Highlight popover English is unchanged');
  host.remove(); i18n.setLocale('es');
  let confirmText = '';
  const opener = createExternalLinkOpener({ windowRef: { confirm: text => { confirmText = text; return false; } } });
  const opened = await opener.openPdfExternalWebsite('https://example.org/a?b=1');
  check(opened.cancelled && confirmText.startsWith('Este enlace del PDF abre un sitio web externo') && confirmText.includes('https://example.org/a?b=1'),
    'External-link confirmation translates around the literal URL');
  const folder = rail.querySelector('[data-folder-context="journal-club:i18n-club"]');
  folder.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 200 }));
  check(byId('papers-context-rename-folder').textContent === 'Cambiar nombre', 'Folder menu translates');
  byId('papers-context-rename-folder').click(); await settle(20);
  const rename = rail.querySelector('[data-folder-tree-rename-input]');
  check(rename?.getAttribute('aria-label') === 'Cambiar el nombre de la carpeta', 'Inline folder rename has a translated label');
  rename.value = '   '; rename.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await settle(20);
  check(toast()?.textContent === 'El nombre de la carpeta no puede estar vacío.' && state.journalClubs.find(item => item.id === 'i18n-club')?.name === 'Club <&>',
    'Folder validation notices translate and keep the saved name: ' + toast()?.textContent);
  toast().hidden = true;
  check(JSON.stringify(state.papers) === before, 'Papers chrome translation never changes paper records');
  window.qaI18nPapers = { paperId: 'i18n-paper' };
}
