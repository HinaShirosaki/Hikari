// Run from the repository root: node docs/tutorial/04-papers/tools/capture.cjs
// Captures real Papers controls in a disposable Electron profile, then renders
// editable SVG callouts around the screenshots. No production files are edited.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../../../..');
if (!process.versions.electron) {
  const result = require('node:child_process').spawnSync(require(path.join(root, 'node_modules/electron')), [__filename], {
    stdio: 'inherit', env: { ...process.env, TZ: 'America/Chicago' }, timeout: 120000
  });
  if (result.error || result.signal) console.error(result.error || `Electron exited with signal ${result.signal}`);
  process.exit(result.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-papers-tutorial-'));
app.setPath('userData', path.join(scratch, 'profile'));
app.setPath('sessionData', path.join(scratch, 'session'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');
const folder = path.resolve(__dirname, '..');
const rawFolder = path.join(folder, 'images/raw');
const annotatedFolder = path.join(folder, 'images');
fs.mkdirSync(rawFolder, { recursive: true });
const url = file => pathToFileURL(path.join(root, file)).href;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const manifest = { sourceVersion: JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version,
  exampleDate: '2026-10-24', timezone: 'America/Chicago', viewport: [1600, 1000],
  mode: 'Real Papers renderer and pdf.js; fictional data and example PDF; in-memory desktop adapters; no live AI, file writes, or printing.', screenshots: [], checks: [] };
const examplePdfName = 'buffer-choice-example.pdf';
// The example paper is generated once from tools/example-paper.html; delete the
// PDF to rebuild it. Chromium writes no author or journal, so a small
// incremental update adds the Info entries that pdf.js reads as metadata.
async function ensureExamplePdf() {
  const target = path.join(folder, 'examples', examplePdfName);
  if (fs.existsSync(target)) return fs.readFileSync(target);
  const page = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await page.loadFile(path.join(__dirname, 'example-paper.html'));
  const printed = await page.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, generateTaggedPDF: true, generateDocumentOutline: true });
  page.destroy();
  const pdf = withPdfInfo(printed, { Title: 'Buffer choice and the clarity of a model protein: a teaching example',
    Author: 'Demo Author, Example Author', Journal: 'Journal of Tutorial Examples', Year: '2026', URL: 'https://example.org/tutorial-paper',
    Subject: 'Fictional teaching document for the Hikari tutorials' });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, pdf);
  return pdf;
}
function withPdfInfo(pdf, fields) {
  const trailer = pdf.toString('latin1', pdf.lastIndexOf('trailer'));
  const size = Number(/\/Size (\d+)/.exec(trailer)[1]);
  const rootRef = /\/Root (\d+ \d+ R)/.exec(trailer)[1];
  const previousXref = Number(/startxref\s+(\d+)/.exec(trailer)[1]);
  const pdfString = value => `(${String(value).replace(/[\\()]/g, '\\$&')})`;
  const object = `\n${size} 0 obj\n<<${Object.entries(fields).map(([name, value]) => `/${name} ${pdfString(value)}`).join(' ')}>>\nendobj\n`;
  const xrefOffset = pdf.length + Buffer.byteLength(object, 'latin1');
  const update = `${object}xref\n${size} 1\n${String(pdf.length + 1).padStart(10, '0')} 00000 n \ntrailer\n<</Size ${size + 1} /Root ${rootRef} /Info ${size} 0 R /Prev ${previousXref}>>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.concat([pdf, Buffer.from(update, 'latin1')]);
}
let win, annotationWin;
async function main() {
  await app.whenReady();
  const stripScripts = html => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  const shell = stripScripts(fs.readFileSync(path.join(root, 'ui/html/shell/start.html'), 'utf8'))
    .replace(/<div id="app-loading-cover"[\s\S]*?(?=  <main id="storage-setup-page")/, '')
    .replace(/<main id="storage-setup-page"[\s\S]*?<\/main>/, '')
    .replace(/href="([^"#]+)"/g, (_match, file) => `href="${url(file)}"`)
    .replace('<body>', '<body class="theme-day ui-neutral-compact has-shared-left-rail-view" data-active-view="papers-view" data-agent-availability="connected">');
  const view = fs.readFileSync(path.join(root, 'ui/html/views/papers-view.html'), 'utf8').replace('class="view"', 'class="view is-active"');
  // The PDF tool strip lives in the shell's closing markup, beside the agent rail.
  const end = stripScripts(fs.readFileSync(path.join(root, 'ui/html/shell/end.html'), 'utf8')).replace('</body>', '');
  // pdf.js and its worker load from the page's own URL, so the disposable page
  // sees the repository's vendor and src folders through links.
  fs.symlinkSync(path.join(root, 'vendor'), path.join(scratch, 'vendor'));
  fs.symlinkSync(path.join(root, 'src'), path.join(scratch, 'src'));
  const fixture = path.join(scratch, 'papers.html');
  fs.writeFileSync(fixture, `${shell}${view}${end}<script type="module" src="${pathToFileURL(path.join(__dirname, 'papers-fixture.mjs')).href}"></script></body>`);
  win = new BrowserWindow({ width: 1600, height: 1000, useContentSize: true, show: false,
    webPreferences: { sandbox: true, contextIsolation: true } });
  annotationWin = new BrowserWindow({ width: 1600, height: 1000, useContentSize: true, show: false,
    webPreferences: { sandbox: true, contextIsolation: true } });
  // Created while the capture windows are open: closing the last window would quit Electron.
  const examplePdf = await ensureExamplePdf();
  // The fixture must not fetch any remote resource.
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: true }));
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error(`renderer: ${message}`); });
  const evaluate = code => win.webContents.executeJavaScript(`(async () => { ${code} })()`, true);
  const waitFor = async code => {
    for (let i = 0; i < 160; i++) {
      if (await evaluate(`return Boolean(${code});`)) return;
      await pause(30);
    }
    throw new Error(`Timed out: ${code}`);
  };
  const check = async (code, label) => {
    if (!await evaluate(`return Boolean(${code});`)) throw new Error(label);
    manifest.checks.push(label);
  };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click();`);
  const input = (selector, value) => evaluate(`const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));`);
  const key = (selector, keyName) => evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(keyName)}, bubbles: true, cancelable: true }));`);
  // A selector, or a list of them, covers every element it matches.
  const box = async selector => {
    const boxes = (await Promise.all((Array.isArray(selector) ? selector : [selector]).map(item => evaluate(`const els = [...document.querySelectorAll(${JSON.stringify(item)})];
      if (!els.length) throw new Error('Missing ' + ${JSON.stringify(item)});
      const rects = els.map(el => el.getBoundingClientRect()).filter(r => r.width || r.height);
      if (!rects.length) throw new Error('Not visible ' + ${JSON.stringify(item)});
      return rects.map(r => ({ x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) }));`)))).flat();
    const x = Math.min(...boxes.map(r => r.x)), y = Math.min(...boxes.map(r => r.y));
    return { x, y, width: Math.max(...boxes.map(r => r.x + r.width)) - x, height: Math.max(...boxes.map(r => r.y + r.height)) - y };
  };
  const cropOf = async selector => {
    if (!selector) return { x: 0, y: 0, width: 1600, height: 1000 };
    const r = await box(selector);
    const x = Math.max(0, r.x - 18), y = Math.max(0, r.y - 18);
    return { x, y, width: Math.min(1600, r.x + r.width + 18) - x, height: Math.min(1000, r.y + r.height + 18) - y };
  };
  const scrollTo = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center', behavior:'instant'});`);
  const shot = async (name, title, subtitle, cropSelector, targets, { side } = {}) => {
    // Notices are transient; a reported error means the preview drifted from the real flow.
    const errors = await evaluate('return tutorial.calls.filter(c => c.kind === "error").map(c => c.message);');
    if (errors.length) throw new Error(`Renderer reported an error before ${name}: ${errors.join('; ')}`);
    await evaluate('document.querySelectorAll("[data-hikari-transient-toast]").forEach(t => { t.hidden = true; }); await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));');
    await pause(120);
    const crop = await cropOf(cropSelector);
    const capture = (await win.webContents.capturePage()).resize({ width: 1600, height: 1000 }).crop(crop);
    fs.writeFileSync(path.join(rawFolder, `${name}.png`), capture.toPNG());
    const targetsWithRects = [];
    for (const [selector, label, badge] of targets) {
      const rect = await box(selector);
      if (rect.x < crop.x || rect.y < crop.y || rect.x + rect.width > crop.x + crop.width || rect.y + rect.height > crop.y + crop.height) throw new Error(`Annotation outside screenshot: ${name}: ${selector}`);
      targetsWithRects.push({ selector, label, rect, ...(badge ? { badge } : {}) });
    }
    const sideRail = side ?? (crop.width < 1000 && crop.height > 300);
    const width = Math.max(crop.width + (sideRail ? 400 : 48), 1000);
    const height = sideRail ? Math.max(crop.height + 140, targets.length * 84 + 160) : crop.height + 210;
    const imageX = sideRail ? 24 : Math.round((width - crop.width) / 2), imageY = 94;
    const laneWidth = (width - 64) / targets.length;
    const color = '#286983';
    // Label boxes follow the targets' order on the page (top to bottom, or left to
    // right), so arrows do not cross; the numbers still follow the steps.
    const along = r => sideRail ? r.y + r.height / 2 : r.x + r.width / 2;
    const slots = targetsWithRects.map((_t, i) => i).sort((a, b) => along(targetsWithRects[a].rect) - along(targetsWithRects[b].rect));
    const callouts = targetsWithRects.map(({ label, rect, badge }, i) => {
      const slot = slots.indexOf(i);
      const x = imageX + rect.x - crop.x - 4, y = imageY + rect.y - crop.y - 4;
      const w = rect.width + 8, h = rect.height + 8;
      // Badges sit on the top-left corner unless that would cover the target's text.
      const badgeX = badge === 'right' ? x + w - 1 : x + 1;
      const labelX = sideRail ? imageX + crop.width + 32 : 32 + laneWidth * slot + 7;
      const labelY = sideRail ? imageY + (slot + .5) * (height - 140) / targets.length - 20 : imageY + crop.height + 35;
      const labelWidth = sideRail ? width - labelX - 24 : laneWidth - 14;
      const cx = labelX + labelWidth / 2, cy = labelY;
      // Arrows end at the nearest point of the highlight, so they cross as little of the UI as possible.
      const ax = sideRail ? labelX - 7 : cx, ay = sideRail ? labelY + 20 : cy - 9;
      const ex = Math.min(Math.max(ax, x), x + w), ey = Math.min(Math.max(ay, y), y + h);
      const reach = Math.hypot(ax - ex, ay - ey) || 1;
      const arrow = `M${ax},${ay} L${ex + (ax - ex) / reach * 5},${ey + (ay - ey) / reach * 5}`;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${color}" fill-opacity=".045" stroke="${color}" stroke-width="3"/>
        <path d="${arrow}" stroke="${color}" stroke-width="2.5" fill="none" marker-end="url(#arrow)"/>
        <circle cx="${badgeX}" cy="${y + 1}" r="14" fill="${color}" stroke="white" stroke-width="2"/><text x="${badgeX}" y="${y + 6}" text-anchor="middle" fill="white" font-size="15" font-weight="700">${i + 1}</text>
        <rect x="${labelX}" y="${cy}" width="${labelWidth}" height="40" rx="8" fill="#fffaf3" stroke="#dfdad9"/>
        <text x="${cx}" y="${cy + 25}" text-anchor="middle" fill="#191724" font-size="16" font-weight="600">${i + 1}. ${esc(label)}</text>`;
    }).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, sans-serif"><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="${color}"/></marker></defs><rect width="100%" height="100%" fill="#f8f5ee"/><text x="24" y="33" fill="#191724" font-size="25" font-weight="700">${esc(title)}</text><text x="24" y="61" fill="#6e6a86" font-size="16">${esc(subtitle)}</text><image x="${imageX}" y="${imageY}" width="${crop.width}" height="${crop.height}" href="data:image/png;base64,${capture.toPNG().toString('base64')}"/>${callouts}<text x="24" y="${height - 12}" fill="#797593" font-size="12">HIKARI TUTORIAL · Fictional example data · Real Papers renderer · 24 October 2026</text></svg>`;
    fs.writeFileSync(path.join(annotatedFolder, `${name}.svg`), svg);
    const annotationFile = path.join(scratch, 'annotation.html');
    fs.writeFileSync(annotationFile, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}svg{display:block}</style>${svg}`);
    annotationWin.setContentSize(width, height);
    await annotationWin.loadFile(annotationFile);
    await annotationWin.webContents.executeJavaScript('Promise.all([...document.images].map(img => img.decode()))');
    await pause(150);
    fs.writeFileSync(path.join(annotatedFolder, `${name}.png`), (await annotationWin.webContents.capturePage()).resize({ width, height }).toPNG());
    manifest.screenshots.push({ name, title, crop, targets: targetsWithRects });
    console.log(`Captured ${name}`);
  };
  const paperRow = id => `[data-paper-view="${id}"]`;
  const folderRow = key => `[data-folder-select="${key}"]`;
  // pdf.js renders text as positioned spans; select a phrase the way a pointer drag would.
  const selectText = async (phrase, { kind = 'selection' } = {}) => {
    await evaluate(`
      const phrase = ${JSON.stringify(phrase)};
      const span = [...document.querySelectorAll('#paper-viewer-page-layer .textLayer span')].find(s => s.textContent.includes(phrase));
      if (!span) throw new Error('Phrase not in the text layer: ' + phrase);
      span.scrollIntoView({ block: 'center', behavior: 'instant' });
      const node = span.firstChild, start = node.textContent.indexOf(phrase);
      span.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, isPrimary: true }));
      const range = document.createRange();
      range.setStart(node, start); range.setEnd(node, start + phrase.length);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, isPrimary: true }));`);
    await waitFor('!document.getElementById("paper-selection-menu").hidden');
  };
  const markRect = async (name, expression) => {
    await evaluate(`(${expression}).setAttribute('data-tutorial-target', ${JSON.stringify(name)});`);
    return `[data-tutorial-target="${name}"]`;
  };
  await win.loadFile(fixture);
  await waitFor('window.tutorialReady && document.querySelectorAll("[data-folder-select]").length === 3');
  await evaluate(`window.tutorialPdfBase64 = ${JSON.stringify(examplePdf.toString('base64'))};`);

  // 2. Add a PDF
  await click(folderRow('project:demo-stability'));
  await check(`document.querySelector('${folderRow('project:demo-stability')}').closest('.papers-folder-group, [data-folder-context]') && !document.getElementById('paper-upload-trigger').disabled`, 'Selecting a folder makes it the upload destination');
  await evaluate(`const bytes = Uint8Array.from(atob(window.tutorialPdfBase64), c => c.charCodeAt(0)); const t = new DataTransfer();
    t.items.add(new File([bytes], ${JSON.stringify(examplePdfName)}, { type: 'application/pdf' }));
    const el = document.getElementById('paper-pdf'); el.files = t.files; el.dispatchEvent(new Event('change', { bubbles: true }));`);
  await waitFor('tutorial.state.papers.length === 4 && document.querySelector(".papers-paper-processing")');
  const paperId = await evaluate('return tutorial.state.papers.at(-1).id;');
  await check(`tutorial.state.papers.at(-1).linkedId === 'demo-stability' && tutorial.calls.some(c => c.kind === 'store')`, 'Upload PDF copies the file into the selected folder');
  await shot('02-add-pdf', 'Add a PDF to a folder', 'Select a folder, then upload. The new paper shows Processing while Hikari reads it.', ['#paper-upload-trigger', '#journal-club-list'],
    [['#paper-upload-trigger', 'Upload PDF'], [folderRow('project:demo-stability'), 'Destination folder'], ['#journal-club-list .papers-paper-processing', 'Processing', 'right']], { side: true });
  await evaluate('tutorial.finishIntake();');
  await waitFor(`tutorial.state.papers.at(-1).ingestionStatus === 'uploaded' && !document.querySelector('.papers-paper-processing')`);
  manifest.checks.push('Processing clears when intake finishes');

  // 1. Workspace overview (the uploaded paper, opened)
  await click(paperRow(paperId));
  await waitFor('document.querySelectorAll("#paper-viewer-page-layer .textLayer span").length > 20 && !document.getElementById("paper-viewer-toolbar").hidden');
  await check(`document.querySelector('${paperRow(paperId)}').textContent.includes('Buffer choice and the clarity')`, 'Opening a PDF shows it and takes the title from the PDF');
  await shot('01-papers-workspace', 'Open Papers', 'Folders and papers are on the left; the PDF is in the middle; tools are on the right.', null,
    [['#papers-library-rail', 'Folders and papers'], ['#paper-viewer-shell', 'Read the PDF'], ['.universal-agent-chat-rail__tools', 'PDF controls and panels']]);

  // 3. Folders
  await evaluate(`const row = document.querySelector('${folderRow('journal-club:demo-club')}'); const r = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.right - 8, clientY: r.y + r.height / 2 }));`);
  await waitFor('!document.getElementById("papers-library-context-menu").hidden');
  await check('!document.getElementById("papers-context-rename-folder").hidden && !document.getElementById("papers-context-delete-folder").hidden', 'A folder you created offers Rename and Delete');
  await shot('03-folder-menu', 'Organize folders', 'Right-click the library to add a folder, or to rename or delete one you created.', ['#journal-club-list', '#papers-library-context-menu'],
    [[folderRow('journal-club:demo-club'), 'Right-click a folder'], ['#papers-library-context-menu', 'New, Rename, or Delete Folder']], { side: true });
  await click('#papers-context-new-folder');
  await waitFor('tutorial.state.journalClubs.some(c => c.name === "New Folder")');
  const newFolderKey = await evaluate('return "journal-club:" + tutorial.state.journalClubs.find(c => c.name === "New Folder").id;');
  await evaluate(`document.querySelector('${folderRow(newFolderKey)}').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));`);
  await waitFor('document.querySelector(".folder-tree-template__rename-input")');
  await input('.folder-tree-template__rename-input', 'Reading list · tutorial');
  await key('.folder-tree-template__rename-input', 'Enter');
  await waitFor('tutorial.state.journalClubs.some(c => c.name === "Reading list · tutorial")');
  manifest.checks.push('New Folder adds a folder; double-clicking renames it');
  await evaluate(`const transfer = new DataTransfer(); const row = document.querySelector('${paperRow('demo-paper-storage')}');
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
    const target = document.querySelector('${folderRow(newFolderKey)}');
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));`);
  await waitFor(`tutorial.state.papers.find(p => p.id === 'demo-paper-storage').linkedId === ${JSON.stringify(newFolderKey.split(':')[1])}`);
  manifest.checks.push('Dragging a paper onto a folder moves it there');

  // 4. Reading controls
  await click('#paper-viewer-next-btn');
  await waitFor('document.getElementById("paper-viewer-page-input").value === "2"');
  manifest.checks.push('Next page moves to page 2');
  await click('#paper-viewer-zoom-in-btn');
  await waitFor('!document.getElementById("paper-viewer-zoom-label").textContent.includes("fit")');
  manifest.checks.push('Zoom in leaves fit-width mode');
  await shot('04-pdf-controls', 'Move through the PDF', 'Use the page and zoom controls on the right of the PDF.', ['#paper-viewer-toolbar', '#paper-comment-toggle-btn', '#paper-brief-toggle-btn'],
    [['.papers-viewer-page-cluster', 'Page: previous, number, next'], ['.papers-viewer-zoom-cluster', 'Zoom and fit width'], ['#paper-viewer-print-btn', 'Print'], [['#paper-comment-toggle-btn', '#paper-details-toggle-btn', '#paper-brief-toggle-btn'], 'Outline, details, brief']], { side: true });
  await click('#paper-viewer-fit-width-btn');
  await waitFor('document.getElementById("paper-viewer-zoom-label").textContent.includes("fit")');
  manifest.checks.push('Fit width returns to fit-width zoom');

  // 5. Selection menu
  await selectText('produced a slight haze');
  await shot('05-selection-menu', 'Act on selected text', 'Select text in the PDF to open this menu.', ['#paper-selection-menu', await markRect('selected-1', 'document.querySelector("#paper-viewer-page-layer .textLayer span[data-tutorial-anchor]") || [...document.querySelectorAll("#paper-viewer-page-layer .textLayer span")].find(s => s.textContent.includes("produced a slight haze"))')],
    [['#paper-selection-comment-btn', 'Add comment'], ['#paper-selection-highlight-btn', 'Highlight'], ['#paper-selection-underline-btn', 'Underline'],
      ['#paper-selection-search-btn', 'Search'], ['#paper-selection-ask-btn', 'Ask Hikari'], ['#paper-selection-copy-btn', 'Copy']]);

  // 6. Highlight and underline
  await click('#paper-selection-highlight-btn');
  await waitFor(`tutorial.state.papers.find(p => p.id === ${JSON.stringify(paperId)}).highlights.length === 1 && document.querySelector('.papers-viewer-highlight-path')`);
  manifest.checks.push('Highlight saves a highlight with the paper');
  await selectText('increased the haze');
  await click('#paper-selection-underline-btn');
  await waitFor(`tutorial.state.papers.find(p => p.id === ${JSON.stringify(paperId)}).highlights.some(h => h.kind === 'underline')`);
  manifest.checks.push('Underline saves an underline with the paper');
  await evaluate(`const mark = document.querySelector('.papers-viewer-highlight-path'); const r = mark.getBoundingClientRect();
    document.getElementById('paper-viewer-page-layer').dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));`);
  await waitFor('!document.getElementById("paper-highlight-comment-popover").hidden');
  await shot('06-highlights', 'Highlight and underline', 'Hover over a highlight to copy it or ask Hikari about it.', ['.papers-viewer-highlight-path', '.papers-viewer-highlight.is-underline', '#paper-highlight-comment-popover'],
    [['.papers-viewer-highlight-path', 'Highlight', 'right'], ['.papers-viewer-highlight.is-underline', 'Underline'], ['#paper-highlight-comment-popover', 'Ask Hikari or copy']]);

  // 7. Comment
  await evaluate('document.getElementById("paper-highlight-comment-popover").hidden = true;');
  await selectText('Two people scored every tube independently');
  await click('#paper-selection-comment-btn');
  await waitFor('!document.getElementById("paper-selection-comment-popover").hidden');
  await input('#paper-selection-comment-text', 'Record observer initials in our notebook pages too.');
  await shot('07-comment', 'Comment on selected text', 'Type a note for the selected text, then save it.', ['#paper-selection-comment-popover', await markRect('commented', '[...document.querySelectorAll("#paper-viewer-page-layer .textLayer span")].find(s => s.textContent.includes("Two people scored"))')],
    [['#paper-selection-comment-text', 'Type your comment'], ['#paper-selection-comment-save-btn', 'Save'], ['#paper-selection-comment-cancel-btn', 'Cancel', 'right']]);
  await click('#paper-selection-comment-save-btn');
  await waitFor(`tutorial.state.papers.find(p => p.id === ${JSON.stringify(paperId)}).comments.length === 1 && document.querySelector('.papers-viewer-highlight-path.is-commented')`);
  manifest.checks.push('Save stores the comment and highlights its text');

  // 8. Search selected text
  await selectText('Buffer B produced');
  await click('#paper-selection-search-btn');
  await waitFor('!document.getElementById("paper-selection-search-popover").hidden');
  await click('#paper-selection-search-pdf-btn');
  await waitFor('!document.getElementById("paper-selection-search-nav").hidden');
  await check('/^1 \\/ \\d+$/.test(document.getElementById("paper-selection-search-count").textContent.trim()) && document.querySelector(".papers-viewer-search-highlight")', 'This PDF finds and highlights every match');
  await shot('08-search', 'Search for the selected text', 'Search this PDF, or the paper database, for the words you selected.', ['#paper-selection-search-popover'],
    [['#paper-selection-search-pdf-btn', 'This PDF'], ['#paper-selection-search-library-btn', 'Paper database'], ['#paper-selection-search-nav', 'Previous and next match', 'right']], { side: false });
  await click('#paper-selection-search-library-btn');
  await waitFor('document.getElementById("paper-selection-search-results").textContent.includes("matching paper")');
  manifest.checks.push('Paper database search reports matching papers');
  await evaluate('document.getElementById("paper-selection-search-popover").hidden = true; getSelection().removeAllRanges();');
  await selectText('Buffer A kept');
  await click('#paper-selection-ask-btn');
  await waitFor('tutorial.calls.some(c => c.kind === "ask" && c.text.includes("Buffer A kept"))');
  manifest.checks.push('Ask Hikari passes the selected text to the assistant');

  // 9-11. Side panels
  await click('#paper-comment-toggle-btn');
  await waitFor('!document.getElementById("paper-comment-sidebar").hidden && document.querySelectorAll(".papers-bookmark-item").length >= 5');
  await shot('09-outline', 'Jump to a section', 'Open Outline & bookmarks, then click a heading.', ['#paper-bookmark-section', '#paper-comment-toggle-btn', '#paper-viewer-toolbar'],
    [['#paper-comment-toggle-btn', 'Outline & bookmarks'], ['#paper-bookmark-list', 'Click a heading']], { side: true });
  await evaluate('[...document.querySelectorAll(".papers-bookmark-item")].find(b => b.textContent.includes("Results")).click();');
  await waitFor('document.getElementById("paper-viewer-page-input").value === "2"');
  manifest.checks.push('Clicking an outline heading opens its page');
  await click('#paper-details-toggle-btn');
  await waitFor('!document.getElementById("paper-details-sidebar").hidden && document.getElementById("paper-summary-list").textContent.includes("Demo Author")');
  await shot('10-details', 'Check the paper details', 'Paper details lists the title, authors, year, journal, DOI, and URL.', ['#paper-details-sidebar .papers-brief-header', '#paper-summary-list', '#paper-details-toggle-btn', '#paper-viewer-toolbar'],
    [['#paper-details-toggle-btn', 'Paper details'], ['#paper-summary-list', 'Details from the PDF']], { side: true });
  await click('#paper-brief-toggle-btn');
  await waitFor('document.querySelector("#paper-brief-content .papers-brief-takeaway")');
  await shot('11-research-brief', 'Read the research brief', 'Illustrative brief: the saved analysis Hikari wrote when the PDF was added.', ['#paper-research-brief .papers-brief-header', '.papers-brief-experiment', '#paper-brief-toggle-btn', '#paper-viewer-toolbar'],
    [['#paper-brief-toggle-btn', 'Research brief'], ['.papers-brief-takeaway', 'One-sentence summary'], ['.papers-brief-experiment', 'Experiments']], { side: true });

  fs.writeFileSync(path.join(folder, 'capture-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Finished: ${manifest.screenshots.length} screenshots; ${manifest.checks.length} checks.`);
}
main().then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
