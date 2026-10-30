// Real DNA library, New Sequence dialog and detail toolbar with disposable state.
export async function checkLocalizedDna({ core, i18n, check }) {
  const byId = id => document.getElementById(id);
  const settle = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
  const toast = () => document.querySelector('[data-hikari-transient-toast]');
  const params = node => JSON.parse(node.getAttribute('data-i18n-params') || '{}');
  const assertBindings = host => {
    for (const node of host.querySelectorAll('[data-i18n]')) {
      if (node.children.length) continue;
      check(i18n.has(node.dataset.i18n) && node.textContent === i18n.t(node.dataset.i18n, params(node)), 'DNA binding: ' + node.dataset.i18n);
    }
    for (const attribute of ['title', 'aria-label', 'placeholder', 'data-hover-caption']) {
      const binding = 'data-i18n-' + attribute.replace(/^data-/, '');
      for (const node of host.querySelectorAll('[' + binding + ']')) {
        const key = node.getAttribute(binding);
        check(node.getAttribute(attribute) === i18n.t(key, JSON.parse(node.getAttribute(binding + '-params') || node.getAttribute('data-i18n-params') || '{}')), 'DNA attribute binding: ' + key);
      }
    }
  };

  i18n.setLocale('en');
  core.navigationShell.showView('sequence-viewer-view'); await settle(120);
  const library = byId('sequence-viewer-library-list');
  check(library.textContent.trim() === 'No saved sequence entries.', 'English empty library keeps its wording: ' + library.textContent.trim());
  i18n.setLocale('es');
  check(library.textContent.trim() === 'No hay secuencias guardadas.' && byId('sequence-viewer-library-filter-temporary').textContent === 'Sin guardar',
    'Library rail translates live');

  // New Sequence dialog: validation binds, the typed draft survives language switches.
  byId('sequence-viewer-home-paste-btn').click(); await settle(20);
  const overlay = byId('sequence-viewer-new-overlay'); const textarea = byId('sequence-viewer-new-textarea');
  check(!overlay.hidden && byId('sequence-viewer-new-title').textContent === 'Nueva secuencia de ADN'
    && textarea.placeholder === 'Pegue ADN sin formato, FASTA, FASTQ o texto GenBank.', 'New Sequence dialog translates');
  byId('sequence-viewer-new-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle(20);
  const status = byId('sequence-viewer-new-status');
  check(status.textContent === 'Pegue una secuencia de ADN antes de cargarla.', 'New Sequence validation translates');
  i18n.setLocale('en');
  check(status.textContent === 'Paste a DNA sequence before loading.', 'New Sequence validation switches back to English');
  textarea.value = 'ATGGCTAGCAAGGGCGAGGAG'; textarea.focus(); textarea.setSelectionRange(3, 9);
  i18n.setLocale('es');
  check(document.activeElement === textarea && textarea.value === 'ATGGCTAGCAAGGGCGAGGAG' && textarea.selectionStart === 3 && textarea.selectionEnd === 9,
    'Language switching preserves the pasted sequence, focus and selection');
  byId('sequence-viewer-new-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle(200);
  check(toast()?.textContent === 'Cargado: 1 registro(s).', 'Record load status translates: ' + toast()?.textContent);
  i18n.setLocale('en');
  check(toast()?.textContent === 'Loaded: 1 record(s).', 'An open load notice switches back to English');
  toast().hidden = true; i18n.setLocale('es');

  // Detail workspace chrome: toolbar captions, menus and tooltips.
  const detail = byId('sequence-viewer-detail-view');
  check(byId('sequence-viewer-annotate-btn').getAttribute('aria-label') === 'Anotar secuencia'
    && byId('sequence-viewer-orf-menu').querySelector('.sequence-viewer-inline-toggle-group-label').textContent === 'Paradas de ORF'
    && byId('sequence-viewer-orf-stop-tag-toggle').closest('label').title === 'Usar TAG como terminador de ORF.'
    && byId('sequence-viewer-orf-stop-tag-toggle').closest('label').querySelector('span').textContent === 'TAG',
  'Detail toolbar and menus translate while codon names stay literal');
  assertBindings(byId('sequence-viewer-view')); assertBindings(detail);
  window.qaI18nDna = { ready: true };
}
