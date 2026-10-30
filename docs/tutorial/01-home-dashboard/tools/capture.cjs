// Run from the repository root: node docs/tutorial/01-home-dashboard/tools/capture.cjs
// Captures real Home controls in a disposable Electron profile, then renders
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
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-home-tutorial-'));
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
  mode: 'Real Home renderer; fictional data; in-memory desktop and AI adapters; no live AI or downloads.', screenshots: [], checks: [] };
let win, annotationWin;
async function main() {
  await app.whenReady();
  let shell = fs.readFileSync(path.join(root, 'ui/html/shell/start.html'), 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/<div id="app-loading-cover"[\s\S]*?(?=  <main id="storage-setup-page")/, '')
    .replace(/<main id="storage-setup-page"[\s\S]*?<\/main>/, '')
    .replace(/href="([^"#]+)"/g, (_match, file) => `href="${url(file)}"`)
    .replace('<body>', '<body class="theme-day" data-active-view="home-view" data-agent-availability="connected">');
  const home = fs.readFileSync(path.join(root, 'ui/html/views/home-view.html'), 'utf8');
  const fixture = path.join(scratch, 'home.html');
  fs.writeFileSync(fixture, `${shell}${home}</section></div></main><script type="module" src="${pathToFileURL(path.join(__dirname, 'dashboard-fixture.mjs')).href}"></script></body></html>`);
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
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, sans-serif"><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="${color}"/></marker></defs><rect width="100%" height="100%" fill="#f8f5ee"/><text x="24" y="33" fill="#191724" font-size="25" font-weight="700">${esc(title)}</text><text x="24" y="61" fill="#6e6a86" font-size="16">${esc(subtitle)}</text><image x="${imageX}" y="${imageY}" width="${crop.width}" height="${crop.height}" href="data:image/png;base64,${capture.toPNG().toString('base64')}"/>${callouts}<text x="24" y="${height - 12}" fill="#797593" font-size="12">HIKARI TUTORIAL · Fictional example data · Real Home renderer · 24 October 2026</text></svg>`;
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
  await waitFor('window.tutorialReady && document.querySelector("[data-paper-finding-result]")');
  await check('document.querySelectorAll(".home-tile").length === 7', 'All seven Home widgets rendered');
  await shot('01-home-map', 'Meet your Home dashboard', 'Three columns keep bench tasks, notes, and reading together.', null,
    [['.home-column-now', 'Timers & reminders'], ['.home-column-capture', 'Capture & notebook notes'], ['.home-column-read', 'Papers & lab activity']]);
  await input('#dashboard-quick-log-input', 'Compared buffer A and buffer B in the pilot. Sample B looked clearer after mixing. Measurements are still pending.');
  await pause(450);
  await shot('02-experiment-log', 'Capture an observation', 'Save a local log, or prepare a notebook page for review.', '.home-tile-quicklog',
    [['#dashboard-quick-log-input', 'Write the observation'], ['#dashboard-quick-log-save-btn', 'Save a dated log'], ['#dashboard-quick-log-agent-btn', 'Prepare notebook page']]);
  await click('#dashboard-quick-log-save-btn');
  await check('document.getElementById("dashboard-quick-log-recent").textContent.includes("Sample B") && !tutorial.state.settings.dashboard.quickLogDraft', 'Save clears the draft and displays Saved today');
  await shot('03-log-saved', 'Confirm where your log went', 'Saved today displays the two latest logs from today.', '.home-tile-quicklog',
    [['#dashboard-quick-log-status', 'Look for Logged.'], ['#dashboard-quick-log-recent', 'Read your saved observation']]);
  await input('#dashboard-quick-log-input', 'Compared buffer A and buffer B in the pilot. Sample B looked clearer after mixing. Measurements are still pending.');
  await click('#dashboard-quick-log-agent-btn');
  await waitFor('document.querySelector("#home-agent-review-track [data-agent-review-approve]")');
  await check('!tutorial.state.notebookEntries[0].result.includes("Sample B")', 'Notebook proposal awaits approval before changing the page');
  await shot('04-notebook-review', 'Review the notebook proposal', 'Illustrative AI response: check the destination and text before saving.',
    ['#home-agent-review-track .draft-review-heading', '#home-agent-review-track .agent-review-section'],
    [['#home-agent-review-track .draft-review-heading', 'Check the destination'], ['#home-agent-review-track .agent-review-section', 'Read the proposed text']]);
  await evaluate('document.querySelector("#home-agent-review-track [data-agent-review-approve]").scrollIntoView({ block: "center" });');
  await check('(() => { const b = document.querySelector("#home-agent-review-track [data-agent-review-approve]"); const r = b.getBoundingClientRect(); return b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })()', 'The notebook approval control is visible and reachable after scrolling');
  await shot('04b-notebook-approval', 'Approve the content you reviewed', 'Scroll inside the review panel to reach its action buttons.', '#home-agent-review-track .draft-review-actions',
    [['#home-agent-review-track [data-agent-review-reject]', 'Reject the proposal'], ['#home-agent-review-track [data-agent-review-approve]', 'Append to this page']]);
  await click('#home-agent-review-track [data-agent-review-approve]');
  await waitFor('tutorial.state.notebookEntries[0].result.includes("Sample B")');
  manifest.checks.push('Approving the illustrative proposal appends to the intended notebook page');
  await click('#home-agent-close-btn');
  await click('[data-dashboard-notebook-entry="demo-page"]');
  await input('[data-dashboard-notebook-note-input]', 'Example follow-up: measurements are pending; compare both samples after the next readout.');
  await shot('05-notebook-note', 'Add a note to an existing page', 'Clicking a page on Home opens this inline editor.', '.home-tile-notebook-pages',
    [['[data-dashboard-notebook-note-input]', 'Write a follow-up'], ['[data-dashboard-notebook-note-clarify]', 'Optional AI clarification'], ['.home-notebook-note-actions .primary-btn', 'Save note to this page']]);
  await submit('[data-dashboard-notebook-note-form]');
  await check('tutorial.state.notebookEntries[0].result.includes("Example follow-up")', 'Save note appends the text to the selected page');
  await click('#dashboard-timer-open-btn');
  await input('#dashboard-timer-name-input', 'Mixing check');
  await input('#dashboard-timer-minutes-input', '15 min');
  await shot('06-timer-preset', 'Create a reusable timer preset', 'Saving the preset adds a shortcut; press Play to start a countdown.', '.home-timer-dialog',
    [['#dashboard-timer-name-input', 'Name the timer'], ['#dashboard-timer-minutes-input', 'Minutes or hours'], ['#dashboard-timer-add-btn', 'Save preset']]);
  const timersBefore = await evaluate('return tutorial.state.settings.dashboard.activeTimers.length;');
  await submit('#dashboard-timer-dialog-form');
  await check(`tutorial.state.settings.dashboard.activeTimers.length === ${timersBefore} && tutorial.state.settings.dashboard.timerTemplates.some(t => t.name === 'Mixing check')`, 'Saving a timer preset does not start a countdown');
  await click('#dashboard-timer-dialog-close-btn');
  await click('.home-timer-presets [data-dashboard-start-timer-template="2"]');
  await check(`tutorial.state.settings.dashboard.activeTimers.length === ${timersBefore + 1}`, 'A preset Play button starts a countdown');
  await shot('07-timer-running', 'Use the running timer', 'The timer shows remaining time, progress, and its pause control.', '.home-tile-timer',
    [['.home-timer-row:first-child .home-timer-count', 'Time remaining'], ['.home-timer-row:first-child [data-dashboard-toggle-active-timer]', 'Pause or resume'], ['#dashboard-timer-preset-list', 'Start another preset']]);
  await click('[data-dashboard-toggle-active-timer="0"]');
  await check('tutorial.state.settings.dashboard.activeTimers[0].isPaused', 'Pause preserves the timer remaining time');
  await click('[data-dashboard-toggle-active-timer="0"]');
  await click('#dashboard-passage-add-btn');
  await input('#dashboard-passage-strain-input', 'Cell line C · example');
  await input('#dashboard-passage-interval-input', '3');
  await input('#dashboard-passage-number-input', '5');
  await shot('08-passage-setup', 'Add a cell passage reminder', 'Choose an interval for your example; adding it uses today as the last passage date.', '.home-passage-dialog',
    [['#dashboard-passage-strain-input', 'Identify the cell strain'], ['.home-dialog-field-pair', 'Interval & current passage'], ['#dashboard-passage-submit-btn', 'Add reminder']]);
  await submit('#dashboard-passage-dialog-form');
  await check('tutorial.state.settings.dashboard.passageReminders.at(-1).cellPassage.lastPassageDate === "2026-10-24"', 'A new passage reminder starts from today');
  await shot('09-passage-actions', 'Act on due passage reminders', 'Tomorrow defers the reminder; the check mark records a passage.', '.home-tile-passage',
    [['#dashboard-passage-list .home-row:first-child .home-status-pill', 'Read the due status'], ['#dashboard-passage-list .home-row:first-child [data-dashboard-passage-action="extend"]', 'Remind me tomorrow'], ['#dashboard-passage-list .home-row:first-child [data-dashboard-passage-action="done"]', 'Mark passaged']]);
  await click('#dashboard-passage-list [data-dashboard-passage-id="demo-cell-1"][data-dashboard-passage-action="extend"]');
  await check('tutorial.state.settings.dashboard.passageReminders[0].cellPassage.deferredUntilDate === "2026-10-25" && tutorial.state.settings.dashboard.passageReminders[0].cellPassage.passageNumber === 8', 'Tomorrow defers without incrementing the passage number');
  await click('#dashboard-passage-list [data-dashboard-passage-id="demo-cell-2"][data-dashboard-passage-action="done"]');
  await check('tutorial.state.settings.dashboard.passageReminders[1].cellPassage.passageNumber === 6', 'Mark passaged increments the passage number');
  await click('#dashboard-incubation-add-btn');
  await input('#dashboard-incubation-location-input', 'Bench incubator · example');
  await shot('10-incubation-locations', 'Manage your incubation locations', 'Add named locations here, then set tomorrow reminders from the dashboard.', '.home-incubation-dialog',
    [['#dashboard-incubation-location-list', 'Existing locations'], ['#dashboard-incubation-location-input', 'Name a new location'], ['#dashboard-incubation-location-submit-btn', 'Add location']]);
  await submit('#dashboard-incubation-location-form');
  await click('#dashboard-incubation-dialog-close-btn');
  await click('#dashboard-incubation-list [data-dashboard-incubation-remind="2"]');
  await check('tutorial.state.settings.dashboard.incubationLocations[2].reminderDate === "2026-10-25"', 'The incubation bell sets a reminder for tomorrow');
  await shot('11-incubation-reminder', 'Set an incubation reminder for tomorrow', 'The row changes to Tomorrow after you click its bell.', '.home-tile-incubation',
    [['#dashboard-incubation-list [data-dashboard-incubation-remind="2"]', 'Bell: remind tomorrow'], ['#dashboard-incubation-list .home-incubation-row:nth-child(2) .home-status-pill', 'Confirm Tomorrow']]);
  await click('.home-paper-finding-details summary');
  await shot('12-paper-finder', 'Read and retrieve paper recommendations', 'The citation is fictional. Paper finding and downloads require your connected desktop setup.', '.home-tile-paper-finding',
    [['#dashboard-paper-finding-open-btn', 'Manage in Notebook'], ['#dashboard-paper-finding-run-btn', 'Run active schedules'], ['.home-paper-finding-details', 'Read Summary'], ['[data-paper-finding-download]', 'Download the PDF']]);
  await click('#dashboard-paper-finding-open-btn');
  await check('tutorialLastNavigation === "biology-notebook-view"', 'Manage paper finding routes to Notebook');
  await click('[data-contribution-day="2026-10-24"]');
  await shot('13-lab-activity', 'Inspect a day of lab activity', 'Select a square to read the activity breakdown below the heatmap.', '.home-tile-contribution',
    [['[data-contribution-day="2026-10-24"]', 'Select a day'], ['#dashboard-contribution-selected', 'Read its breakdown']]);
  await evaluate('document.body.dataset.agentAvailability = "offline";');
  await check('getComputedStyle(document.getElementById("dashboard-quick-log-agent-btn")).display === "none" && getComputedStyle(document.querySelector(".home-tile-paper-finding")).display === "none"', 'Disconnected mode hides AI notebook preparation and Suggested papers');
  await shot('14-without-ai', 'Use Home without an AI connection', 'Local logging, timers, notebook notes, and reminders remain available.', '.home-column-capture',
    [['#dashboard-quick-log-save-btn', 'Local Save stays available'], ['#dashboard-notebook-page-list', 'Add notes to existing pages']]);
  fs.writeFileSync(path.join(folder, 'capture-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Finished: ${manifest.screenshots.length} screenshots; ${manifest.checks.length} checks.`);
}
main().then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
