// Real PDF selection, saved-note hover, deletion, top-bar Undo/Redo and reload.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

if (!process.versions.electron) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-papers-annotations-'));
  try {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename, temp], {
      encoding: 'utf8', timeout: 60000
    });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    if (result.status !== 0) throw result.error || new Error(`Papers Electron check failed: ${result.status}`);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = require('electron');
  const temp = process.argv[2];
  app.setPath('userData', path.join(temp, 'profile'));
  app.whenReady().then(async () => {
    const url = file => pathToFileURL(path.join(root, file)).href;
    // The viewer resolves its PDF.js assets relative to the app's page URL.
    const fixture = path.join(root, `.papers-annotations-fixture-${process.pid}.html`);
    fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8">
      <link rel="stylesheet" href="${url('styles.css')}">
      <script src="${url('vendor/jspdf.umd.min.js')}"></script>
      <style>body{padding:12px}#papers-view{display:block;height:calc(100vh - 60px)}#papers-layout{height:100%}</style>
      </head><body><button id="global-undo-btn">Undo</button><button id="global-redo-btn">Redo</button>
      ${fs.readFileSync(path.join(root, 'ui/html/views/papers-view.html'), 'utf8')}</body></html>`);
    const win = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: { backgroundThrottling: false } });
    win.webContents.on('console-message', event => { if (event.level === 3) console.error(event.message); });
    const modules = {
      papers: url('src/renderer/modules/papers/index.js'),
      state: url('src/renderer/modules/app-state/index.js'),
      undo: url('src/renderer/services/undoService.js')
    };
    async function setup(urls, reload = false) {
      const { initPapersManagement } = await import(urls.papers);
      const { defaultState } = await import(urls.state);
      const { createUndoService } = await import(urls.undo);
      window.check = (ok, message) => { if (!ok) throw new Error(message); };
      window.pause = () => new Promise(resolve => setTimeout(resolve, 80));
      window.state = reload ? JSON.parse(localStorage.getItem('papers-annotation-check')) : structuredClone(defaultState);
      if (!reload) {
        const pdf = new window.jspdf.jsPDF();
        pdf.text('Annotation example', 20, 30);
        pdf.text('Comment example', 20, 50);
        pdf.text('Underline example', 20, 70);
        state.projects = [{ id: 'project', name: 'Annotation check' }];
        state.settings.personalInfo.name = 'Alice Scientist';
        state.papers = [{ id: 'paper', title: 'Annotation example', fileName: 'example.pdf',
          linkedType: 'project', linkedId: 'project', linkedName: 'Annotation check',
          storedRelativePath: 'Papers/example.pdf', pdfDataUrl: 'data:application/pdf;base64,' + pdf.output('datauristring').split(',')[1],
          comments: [], highlights: [], ingestionStatus: 'ready' }];
      }
      document.getElementById('papers-view').classList.add('is-active');
      window.historyService = createUndoService({ state, documentObject: document, getActiveOwner: () => 'papers',
        persistState: () => localStorage.setItem('papers-annotation-check', JSON.stringify(state)),
        onRestore: () => papers.render() });
      const safeText = value => String(value || '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[char]));
      let serial = 0;
      window.asked = null;
      window.papers = initPapersManagement({ state, persist: historyService.forModule('papers').persist,
        safeText, createId: () => `annotation-${++serial}`, document, window,
        onAskSelectedText: selection => { window.asked = selection; return true; } });
      papers.render();
      check(await papers.openStoredPaper({ relativePath: 'Papers/example.pdf' }), 'PDF opens');
      for (let attempt = 0; attempt < 40 && !document.querySelector('.papers-viewer-text-layer span'); attempt++) await pause();
      check(document.querySelector('.papers-viewer-text-layer span'), `PDF text rendered: ${document.getElementById('paper-viewer-status').textContent}`);
      window.hover = async highlight => {
        const page = document.querySelector('.papers-viewer-page');
        const rect = page.getBoundingClientRect();
        const box = highlight.boxes[0];
        const clientX = rect.left + (box.x + box.width / 2) * rect.width;
        const clientY = rect.top + (box.y + box.height / 2) * rect.height;
        document.getElementById('paper-viewer-page-layer').dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX, clientY }));
        await pause();
        const popover = document.getElementById('paper-highlight-comment-popover');
        check(!popover.hidden, 'Hover popover opens over the saved annotation');
        return popover;
      };
      window.selectLine = async text => {
        const span = [...document.querySelectorAll('.papers-viewer-text-layer span')].find(node => node.textContent === text);
        check(span, `Rendered PDF text: ${text}`);
        const range = document.createRange(); range.selectNodeContents(span);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        await pause();
        check(!document.getElementById('paper-selection-menu').hidden, 'Text selection opens its menu');
      };
      return { highlights: state.papers[0].highlights.length, comments: state.papers[0].comments.length };
    }
    try {
      await win.loadFile(fixture);
      await win.webContents.executeJavaScript(`(${setup.toString()})(${JSON.stringify(modules)})`);
      await win.webContents.executeJavaScript(`(async () => {
        await selectLine('Annotation example');
        document.getElementById('paper-selection-highlight-btn').click(); await pause();
        check(state.papers[0].highlights.length === 1, 'Highlight created from real PDF selection');
        let popover = await hover(state.papers[0].highlights[0]);
        check(!popover.querySelector('.papers-highlight-comment-content'), 'Plain highlight has a compact toolbar');
        popover.querySelector('[data-paper-highlight-delete]').click();
        check(state.papers[0].highlights.length === 0, 'Delete removes plain highlight');
        document.getElementById('global-undo-btn').click(); await pause();
        check(state.papers[0].highlights.length === 1, 'Top-bar Undo restores highlight');
        check(document.querySelector('[data-highlight-id]'), 'Restored highlight is painted');
        document.getElementById('global-redo-btn').click(); await pause();
        check(state.papers[0].highlights.length === 0, 'Top-bar Redo deletes highlight');

        await selectLine('Underline example');
        document.getElementById('paper-selection-underline-btn').click(); await pause();
        popover = await hover(state.papers[0].highlights[0]);
        check(popover.querySelector('[data-paper-highlight-delete]').getAttribute('aria-label') === 'Delete underline', 'Underline deletion is labeled');
        popover.querySelector('[data-paper-highlight-delete]').click();
        check(state.papers[0].highlights.length === 0, 'Underline deleted directly');

        await selectLine('Comment example');
        document.getElementById('paper-selection-comment-btn').click();
        document.getElementById('paper-selection-comment-text').value = 'Review this result.\\nCompare <control> & replicate.';
        document.getElementById('paper-selection-comment-save-btn').click(); await pause();
        check(state.papers[0].comments.length === 1, 'Comment saved');
        popover = await hover(state.papers[0].highlights[0]);
        check(popover.textContent.includes('Alice Scientist'), 'Saved author is visible');
        check(popover.textContent.includes('Compare <control> & replicate.'), 'Saved comment text is safely rendered');
        check(!popover.querySelector('control'), 'Comment cannot inject markup');
        check(getComputedStyle(popover.querySelector('.papers-highlight-comment-content p + p')).whiteSpace === 'pre-wrap', 'Comment preserves line breaks');
      })()`);
      const artifact = path.join(root, 'artifacts/papers-annotations/comment-popover.png');
      fs.mkdirSync(path.dirname(artifact), { recursive: true });
      fs.writeFileSync(artifact, (await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript(`(async () => {
        let popover = document.getElementById('paper-highlight-comment-popover');
        check(popover.querySelector('[data-paper-highlight-delete]').title === 'Delete highlight and comment', 'Linked deletion is explicit');
        popover.querySelector('[data-paper-highlight-delete]').click();
        check(state.papers[0].comments.length === 0 && state.papers[0].highlights.length === 0, 'Linked pair deleted together');
        check(popover.hidden, 'Delete closes popover');
        document.getElementById('global-undo-btn').click(); await pause();
        check(state.papers[0].comments.length === 1 && state.papers[0].highlights.length === 1, 'One Undo restores the pair');
        popover = await hover(state.papers[0].highlights[0]);
        check(popover.textContent.includes('Review this result.'), 'Restored comment is refreshed in the viewer');
        popover.querySelector('[data-paper-highlight-ask]').click();
        check(asked.text === 'Comment example', 'Ask still receives the highlighted text');
        document.getElementById('global-redo-btn').click(); await pause();
        check(state.papers[0].comments.length === 0 && state.papers[0].highlights.length === 0, 'Redo deletes the linked pair');
        document.getElementById('global-undo-btn').click(); await pause();
      })()`);
      await win.reload();
      await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
      const restored = await win.webContents.executeJavaScript(`(${setup.toString()})(${JSON.stringify(modules)}, true)`);
      assert.deepEqual(restored, { highlights: 1, comments: 1 });
      await win.webContents.executeJavaScript(`(async () => {
        const popover = await hover(state.papers[0].highlights[0]);
        check(popover.textContent.includes('Review this result.'), 'Comment survives reload');
        popover.querySelector('[data-paper-highlight-delete]').click();
      })()`);
      await win.reload();
      await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
      const deleted = await win.webContents.executeJavaScript(`(${setup.toString()})(${JSON.stringify(modules)}, true)`);
      assert.deepEqual(deleted, { highlights: 0, comments: 0 });
      await win.webContents.executeJavaScript(`(async () => {
        state.papers[0].comments.push({ id: 'legacy', pageNumber: 1, anchorX: 0.4, anchorY: 0.2, author: 'Earlier reader', text: 'Saved pin comment' });
        papers.render();
        const pin = document.querySelector('.papers-viewer-pin');
        check(pin, 'Older anchored comment has a pin');
        const pinRect = pin.getBoundingClientRect();
        pin.click();
        const popover = document.getElementById('paper-highlight-comment-popover');
        check(!popover.hidden && popover.textContent.includes('Saved pin comment'), 'Clicking an older pin shows its saved note');
        check(popover.getBoundingClientRect().left >= pinRect.right, 'Pin popover stays beside its anchor after selection refresh');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        check(popover.hidden, 'Escape dismisses comment popover');
      })()`);
      console.log('PASS Papers Electron: PDF selection, comment display, direct deletion, top-bar Undo/Redo, reload and legacy pins');
      console.log(`Screenshot: ${artifact}`);
    } finally { win.destroy(); fs.rmSync(fixture, { force: true }); }
    app.quit();
  }).catch(error => { console.error(error); app.exit(1); });
}
