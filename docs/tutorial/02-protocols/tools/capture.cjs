// Run from the repository root: node docs/tutorial/02-protocols/tools/capture.cjs
// Captures real Protocols controls in a disposable Electron profile, then renders
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
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-protocol-tutorial-'));
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
  mode: 'Real Protocols renderer; fictional data; in-memory desktop and AI adapters; no live AI or downloads.', screenshots: [], checks: [] };
let win, annotationWin;
async function main() {
  await app.whenReady();
  let shell = fs.readFileSync(path.join(root, 'ui/html/shell/start.html'), 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/<div id="app-loading-cover"[\s\S]*?(?=  <main id="storage-setup-page")/, '')
    .replace(/<main id="storage-setup-page"[\s\S]*?<\/main>/, '')
    .replace(/href="([^"#]+)"/g, (_match, file) => `href="${url(file)}"`)
    .replace('<body>', '<body class="theme-day ui-neutral-compact has-shared-left-rail-view" data-active-view="protocol-management-view" data-agent-availability="connected">');
  const home = fs.readFileSync(path.join(root, 'ui/html/views/protocol-management-view.html'), 'utf8').replace('class="view"', 'class="view is-active"');
  const fixture = path.join(scratch, 'protocol.html');
  fs.writeFileSync(fixture, `${shell}${home}</section></div></main><script type="module" src="${pathToFileURL(path.join(__dirname, 'protocol-fixture.mjs')).href}"></script></body></html>`);
  win = new BrowserWindow({ width: 1600, height: 1000, useContentSize: true, show: false,
    webPreferences: { sandbox: true, contextIsolation: true } });
  annotationWin = new BrowserWindow({ width: 1600, height: 1000, useContentSize: true, show: false,
    webPreferences: { sandbox: true, contextIsolation: true } });
  // The fixture must not fetch any remote resource, even when it displays a citation.
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: true }));
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
  const input = (selector, value) => evaluate(`const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true }));`);
  const submit = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).requestSubmit();`);
  const box = selector => evaluate(`const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) };`);
  const cropOf = async selector => {
    if (!selector) return { x: 0, y: 0, width: 1600, height: 1000 };
    const boxes = await Promise.all((Array.isArray(selector) ? selector : [selector]).map(box));
    const left = Math.min(...boxes.map(r => r.x)), top = Math.min(...boxes.map(r => r.y));
    const r = { x: left, y: top, width: Math.max(...boxes.map(r => r.x + r.width)) - left,
      height: Math.max(...boxes.map(r => r.y + r.height)) - top };
    const x = Math.max(0, r.x - 18), y = Math.max(0, r.y - 18);
    return { x, y, width: Math.min(1600, r.x + r.width + 18) - x, height: Math.min(1000, r.y + r.height + 18) - y };
  };
  const scrollTo = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center', behavior:'instant'});`);
  const shot = async (name, title, subtitle, cropSelector, targets) => {
    await evaluate('await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));');
    await pause(120);
    const crop = await cropOf(cropSelector);
    const capture = (await win.webContents.capturePage()).resize({ width: 1600, height: 1000 }).crop(crop);
    fs.writeFileSync(path.join(rawFolder, `${name}.png`), capture.toPNG());
    const targetsWithRects = [];
    for (const [selector, label] of targets) {
      const rect = await box(selector);
      if (rect.x < crop.x || rect.y < crop.y || rect.x + rect.width > crop.x + crop.width || rect.y + rect.height > crop.y + crop.height) throw new Error(`Annotation outside screenshot: ${name}: ${selector}`);
      targetsWithRects.push({ selector, label, rect });
    }
    const sideRail = crop.width < 1000 && crop.height > 300;
    const width = Math.max(crop.width + (sideRail ? 400 : 48), 1000);
    const height = sideRail ? Math.max(crop.height + 140, targets.length * 84 + 160) : crop.height + 210;
    const imageX = sideRail ? 24 : Math.round((width - crop.width) / 2), imageY = 94;
    const laneWidth = (width - 64) / targets.length;
    const color = '#286983';
    const callouts = targetsWithRects.map(({ label, rect }, i) => {
      const x = imageX + rect.x - crop.x - 4, y = imageY + rect.y - crop.y - 4;
      const w = rect.width + 8, h = rect.height + 8;
      const labelX = sideRail ? imageX + crop.width + 32 : 32 + laneWidth * i + 7;
      const labelY = sideRail ? imageY + (i + .5) * (height - 140) / targets.length - 20 : imageY + crop.height + 35;
      const labelWidth = sideRail ? width - labelX - 24 : laneWidth - 14;
      const cx = labelX + labelWidth / 2, cy = labelY;
      const arrow = sideRail ? `M${labelX - 7},${labelY + 20} L${x + w + 5},${y + h / 2}` : `M${cx},${cy - 9} L${x + w / 2},${y + h + 5}`;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${color}" fill-opacity=".045" stroke="${color}" stroke-width="3"/>
        <path d="${arrow}" stroke="${color}" stroke-width="2.5" fill="none" marker-end="url(#arrow)"/>
        <circle cx="${x + 1}" cy="${y + 1}" r="14" fill="${color}" stroke="white" stroke-width="2"/><text x="${x + 1}" y="${y + 6}" text-anchor="middle" fill="white" font-size="15" font-weight="700">${i + 1}</text>
        <rect x="${labelX}" y="${cy}" width="${labelWidth}" height="40" rx="8" fill="#fffaf3" stroke="#dfdad9"/>
        <text x="${cx}" y="${cy + 25}" text-anchor="middle" fill="#191724" font-size="16" font-weight="600">${i + 1}. ${esc(label)}</text>`;
    }).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, sans-serif"><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="${color}"/></marker></defs><rect width="100%" height="100%" fill="#f8f5ee"/><text x="24" y="33" fill="#191724" font-size="25" font-weight="700">${esc(title)}</text><text x="24" y="61" fill="#6e6a86" font-size="16">${esc(subtitle)}</text><image x="${imageX}" y="${imageY}" width="${crop.width}" height="${crop.height}" href="data:image/png;base64,${capture.toPNG().toString('base64')}"/>${callouts}<text x="24" y="${height - 12}" fill="#797593" font-size="12">HIKARI TUTORIAL · Fictional example data · Real Protocols renderer · 24 October 2026</text></svg>`;
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
  await win.loadFile(fixture);
  await waitFor('window.tutorialReady && document.querySelectorAll("[data-protocol-select]").length === 3');
  await click('[data-protocol-select="demo-labeling"]');
  await check('document.getElementById("protocol-view-title").textContent === "Sample labeling checklist"', 'Selecting a library row opens the correct protocol');
  await shot('01-protocol-workspace', 'Open the Protocols workspace', 'Choose a saved protocol on the left to read it on the right.', null,
    [['#protocol-list-panel', 'Protocol library'], ['#protocol-view-content', 'Read the selected protocol'], ['#protocol-view-panel .protocol-panel-head', 'Edit, export, or print']]);
  await input('#protocol-search', 'label');
  await check('document.querySelectorAll("[data-protocol-select]").length === 1', 'Search filters the protocol library');
  await shot('02-find-protocol', 'Find a protocol', 'Search by name or purpose, then select a result.', ['.protocol-list-pinned', '#protocol-list'],
    [['#protocol-search', 'Type a search term'], ['[data-protocol-select="demo-labeling"]', 'Select the matching protocol']]);
  await evaluate('document.getElementById("protocol-search").dispatchEvent(new KeyboardEvent("keydown", {key:"Escape",bubbles:true}));');
  await check('document.querySelectorAll("[data-protocol-select]").length === 3', 'Escape clears the search');
  await click('#create-protocol-btn');
  await input('#protocol-name', 'Prepare sample labels');
  await input('#protocol-purpose', 'Label tubes and check them against a sample list.');
  await input('#protocol-materials', 'Sample tubes\nLabels\nSample list');
  await scrollTo('#protocol-name');
  await shot('03-create-protocol', 'Create a protocol', 'Enter a name, purpose, and one material per line.',
    ['#protocol-form > label:nth-of-type(1)', '#protocol-form > label:nth-of-type(2)', '#protocol-form > label:nth-of-type(3)'],
    [['#protocol-name', 'Name the protocol'], ['#protocol-purpose', 'Describe its purpose'], ['#protocol-materials', 'List the materials']]);
  await input('#protocol-steps', 'Check the sample list.\nLabel each tube with .\nRecord the labeling start .');
  await scrollTo('.protocol-steps-field');
  await evaluate('const el = document.getElementById("protocol-steps"); const i = el.value.indexOf("start ") + 6; el.setSelectionRange(i,i);');
  await click('[data-protocol-placeholder-preset="time"]');
  await input('#placeholder-name', 'sample ID');
  await evaluate('const el = document.getElementById("protocol-steps"); const i = el.value.indexOf("with ") + 5; el.setSelectionRange(i,i);');
  await shot('04-interactive-fields', 'Add reusable fields to a step', 'Place the cursor in Steps, then insert a preset or a custom field.', '.protocol-steps-field',
    [['#protocol-steps', 'Write one step per line'], ['#protocol-placeholder-presets', 'Choose a preset'], ['.protocol-placeholder-custom', 'Name a field and Insert']]);
  await click('#add-placeholder-btn');
  await check('document.getElementById("protocol-steps").value.includes("[sample ID]") && document.getElementById("protocol-steps").value.includes("[time]")', 'Preset and custom buttons insert reusable field markers');
  await input('#protocol-troubleshooting', 'If a label is unclear, replace it and check the sample ID again.');
  await scrollTo('.protocol-save-actions');
  await shot('05-save-protocol', 'Save your protocol', 'Finish the troubleshooting notes, then save the protocol to the library.',
    ['#protocol-form > label:last-of-type', '.protocol-save-actions'],
    [['#protocol-troubleshooting', 'Add troubleshooting notes'], ['#protocol-form button[type="submit"]', 'Save Protocol']]);
  await evaluate('document.getElementById("protocol-form").requestSubmit();');
  await check('tutorial.state.protocols.length === 4 && !document.getElementById("protocol-view-panel").hidden', 'Save Protocol adds the record and opens its viewer');
  await check('[...document.querySelectorAll("#protocol-view-content .placeholder-chip")].map(x=>x.textContent).includes("sample ID")', 'Saved reusable fields appear as chips in the viewer');
  await scrollTo('#protocol-view-title');
  await shot('06-edit-protocol', 'Edit a saved protocol', 'Open the saved record, then use the pencil button.',
    ['#protocol-view-panel .protocol-panel-head', '#protocol-view-content .protocol-view-section:first-child'],
    [['#protocol-view-title', 'Confirm the selected protocol'], ['#protocol-view-edit-btn', 'Open the editor']]);
  await click('#protocol-view-edit-btn');
  await input('#protocol-purpose', 'Label tubes and verify them against the current sample list.');
  await scrollTo('.protocol-save-actions');
  await evaluate('document.getElementById("protocol-form").requestSubmit();');
  await check('tutorial.state.protocols.length === 4 && tutorial.state.protocols.find(p=>p.name === "Prepare sample labels").purpose.includes("current sample list")', 'Editing updates the existing record without adding a duplicate');
  await click('#create-protocol-btn');
  await scrollTo('#protocol-generate-btn');
  await click('#protocol-generate-btn');
  await input('#protocol-generate-prompt-input', 'Draft a sample labeling checklist with materials, numbered steps, and a final label check. Leave sample ID as a reusable field.');
  await evaluate('const transfer = new DataTransfer(); transfer.items.add(new File(["Teaching example: check each tube label against the sample list."], "labeling-notes.txt", {type:"text/plain"})); const el = document.getElementById("protocol-generate-attachment-input"); el.files = transfer.files; el.dispatchEvent(new Event("change", {bubbles:true}));');
  await waitFor('!document.getElementById("protocol-generate-attachment-list").hidden');
  await shot('07-generate-request', 'Describe the protocol you want', 'Add instructions or supporting files, then start generation.', '.protocol-generate-input-dialog',
    [['#protocol-generate-prompt-input', 'Describe the protocol'], ['#protocol-generate-attach-btn', 'Attach supporting files'], ['#protocol-generate-send-btn', 'Generate Protocol']]);
  await click('#protocol-generate-send-btn');
  await waitFor('!document.getElementById("protocol-generate-apply-btn").disabled');
  await shot('08-generated-review', 'Review the generated protocol', 'Illustrative AI response: check the draft before loading it into the editor.', '.protocol-generate-result-dialog',
    [['#protocol-generate-result-preview', 'Review every section'], ['#protocol-generate-back-btn', 'Keep your current draft'], ['#protocol-generate-apply-btn', 'Use Generated Protocol']]);
  await check('tutorial.state.protocols.length === 4 && tutorial.calls.some(c=>c.kind === "generate" && c.attachments === 1)', 'Generation uses the attached example file and does not save a protocol');
  await click('#protocol-generate-apply-btn');
  await check('document.getElementById("protocol-name").value === "Sample labeling checklist · generated" && tutorial.state.protocols.length === 4', 'Use Generated Protocol fills the editor without saving');
  await scrollTo('.protocol-save-actions');
  await evaluate('document.getElementById("protocol-form").requestSubmit();');
  await check('tutorial.state.protocols.length === 5', 'Save Protocol stores the accepted generated draft');
  await click('#protocol-view-edit-btn');
  await scrollTo('#protocol-polish-btn');
  await click('#protocol-polish-btn');
  await waitFor('!document.getElementById("protocol-polish-apply-btn").disabled');
  await shot('09-polish-review', 'Compare the original and polished wording', 'Illustrative AI response: apply the revision or keep your current draft.', '.protocol-polish-dialog-shell',
    [['#protocol-polish-original-preview', 'Read Your Input'], ['#protocol-polish-result-preview', 'Compare Polished Protocol'], ['#protocol-polish-apply-btn', 'Use Polished Version']]);
  const beforePolish = await evaluate('return tutorial.state.protocols.find(p=>p.name.includes("generated")).purpose;');
  await click('#protocol-polish-apply-btn');
  await check(`tutorial.state.protocols.find(p=>p.name.includes("generated")).purpose === ${JSON.stringify(beforePolish)}`, 'Use Polished Version leaves the saved record unchanged until Save');
  await scrollTo('.protocol-save-actions');
  await evaluate('document.getElementById("protocol-form").requestSubmit();');
  await check('tutorial.state.protocols.find(p=>p.name.includes("generated")).purpose.includes("each label")', 'Save Protocol stores the accepted polished wording');
  await click('#create-protocol-btn');
  await scrollTo('#open-protocol-json-import-btn');
  await click('#open-protocol-json-import-btn');
  const importedJson = fs.readFileSync(path.join(folder, 'examples/label-checklist.json'), 'utf8');
  await input('#protocol-json-import-input', importedJson);
  await shot('10-import-json', 'Import a protocol from JSON', 'Choose a JSON file or paste its contents, then import it to the library.', '.protocol-json-import-dialog',
    [['#protocol-json-import-file', 'Choose a JSON file'], ['#protocol-json-import-input', 'Or paste JSON'], ['#import-protocol-json-btn', 'Import Protocol JSON']]);
  await click('#import-protocol-json-btn');
  await waitFor('tutorial.state.protocols.some(p=>p.name === "Imported label check")');
  await check('document.getElementById("protocol-json-import-overlay").hidden && tutorial.state.protocols.length === 6', 'Import adds the protocol directly to the library and closes the dialog');
  const importedId = await evaluate('return tutorial.state.protocols.find(p=>p.name === "Imported label check").id;');
  await click(`[data-protocol-select="${importedId}"]`);
  await scrollTo('#protocol-view-title');
  await shot('11-export-print', 'Export or print the open protocol', 'Use the download-document icon for PDF, or the printer icon to print.',
    ['#protocol-view-panel .protocol-panel-head', '#protocol-view-content .protocol-view-section:first-child'],
    [['#protocol-export-pdf-btn', 'Export PDF'], ['#protocol-print-btn', 'Print']]);
  await click(`[data-protocol-menu-trigger="${importedId}"]`);
  await shot('12-delete-protocol', 'Open the protocol actions menu', 'Delete removes the protocol immediately, including linked notebook entries and workflow blocks.',
    [`[data-protocol-select="${importedId}"]`, '.protocol-action-menu'],
    [[`[data-protocol-menu-trigger="${importedId}"]`, 'Open the actions menu'], ['.protocol-action-menu [data-protocol-action="delete"]', 'Delete this protocol']]);
  await click('.protocol-action-menu [data-protocol-action="delete"]');
  await check('!tutorial.state.protocols.some(p=>p.name === "Imported label check")', 'Delete immediately removes the selected example protocol');
  await input('#protocol-search', 'generated');
  await click('[data-protocol-select]');
  await scrollTo('#protocol-view-content .protocol-view-section:nth-child(3)');
  await shot('13-reusable-field-preview', 'Check the saved reusable field', 'The field appears as a chip when you read the saved protocol.', '#protocol-view-content .protocol-view-section:nth-child(3)',
    [['#protocol-view-content .placeholder-chip', 'Reusable sample ID field']]);
  fs.writeFileSync(path.join(folder, 'capture-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Finished: ${manifest.screenshots.length} screenshots; ${manifest.checks.length} checks.`);
}
main().then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
