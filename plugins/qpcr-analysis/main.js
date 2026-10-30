const i18nUi = window.HikariUi.createPresentation("qpcr");
(function startTool(root) {
  'use strict';
  const { hikari } = root.HikariPlugin;
  const math = root.QpcrAnalysis;
  const el = id => document.getElementById(id);
  const inputIds = ['target-name', 'reference-name', 'calibrator', 'expression-data', 'curve-data'];
  let mode = 'expression';
  let revision = 0;
  let result = null;
  let resultDraft = null;
  let permissions = new Set();
  let connected = false;
  let connecting = false;
  let storageReady = false;
  let storageLimit = 0;
  let savedSnapshot = null;
  let savePromise = null;
  let loadingNotebooks = false;
  let appending = false;
  let exporting = false;
  let unsavedSending = false;
  let unsavedWanted = false;
  let unsavedSent = null;
  let closed = false;
  let bootSnapshot = null;

  const examples = {
    expression: 'Sample\tGroup\tTarget Ct\tReference Ct\nControl 1\tControl\t25.0, 25.1, 24.9\t20.0, 20.1, 19.9\nControl 2\tControl\t25.2, 25.3, 25.1\t20.1, 20.2, 20.0\nTreated 1\tTreated\t23.0, 23.1, 22.9\t20.0, 20.1, 19.9\nTreated 2\tTreated\t23.3, 23.4, 23.2\t20.1, 20.2, 20.0',
    curve: 'Quantity\tCt\n100000\t18.0, 18.1, 17.9\n10000\t21.322, 21.422, 21.222\n1000\t24.644, 24.744, 24.544\n100\t27.966, 28.066, 27.866\n10\t31.288, 31.388, 31.188'
  };

  function status(id, text, error = false) {
    i18nUi.setOwnedText(el(id), text);
    el(id).dataset.error = String(error);
  }

  function draft() {
    return { version: 1, mode, targetName: el('target-name').value, referenceName: el('reference-name').value,
      calibrator: el('calibrator').value, expressionData: el('expression-data').value, curveData: el('curve-data').value };
  }

  function validateSaved(value) {
    if (value === null) return null;
    if (!value || value.version !== 1 || !['expression', 'curve'].includes(value.mode)) throw new Error('Saved inputs have an unsupported format. Your existing saved data has been kept.');
    for (const [key, limit] of [['targetName', 200], ['referenceName', 200], ['calibrator', 200], ['expressionData', 60000], ['curveData', 60000]]) {
      if (typeof value[key] !== 'string' || value[key].length > limit) throw new Error('Saved inputs are invalid. Your existing saved data has been kept.');
    }
    return { version: 1, mode: value.mode, targetName: value.targetName, referenceName: value.referenceName,
      calibrator: value.calibrator, expressionData: value.expressionData, curveData: value.curveData };
  }

  function updateActions() {
    el('save-inputs').disabled = !storageReady || !!savePromise;
    el('refresh-notebooks').disabled = !connected || !permissions.has('notebook:read') || loadingNotebooks;
    el('notebook-entry').disabled = !connected || loadingNotebooks || !permissions.has('notebook:read') || appending;
    el('append-results').disabled = !result || !connected || !permissions.has('notebook:write') || !el('notebook-entry').value || loadingNotebooks || appending;
    el('export-results').disabled = !result || !connected || !permissions.has('downloads') || exporting;
  }

  async function pushUnsaved(force = false) {
    if (!connected || !storageReady || closed) return;
    unsavedWanted = JSON.stringify(draft()) !== savedSnapshot;
    if (force) unsavedSent = null;
    if (unsavedSending) return;
    unsavedSending = true;
    try {
      while (!closed && unsavedWanted !== unsavedSent) {
        const value = unsavedWanted;
        await hikari.call('app.setUnsaved', { unsaved: value });
        unsavedSent = value;
      }
    } catch (error) {
      status('save-status', i18nUi.text("Could not update save status: {p0}", { p0: error.message }), true);
    } finally { unsavedSending = false; }
  }

  function updateGroups() {
    const groups = new Set();
    for (const line of el('expression-data').value.split(/\r?\n/)) {
      const cells = line.split('\t');
      if (cells.length === 4 && cells[1].trim() && cells[0].trim().toLowerCase() !== 'sample') groups.add(cells[1].trim());
    }
    el('group-options').replaceChildren(...Array.from(groups).map(group => {
      const option = document.createElement('option'); option.value = group; return option;
    }));
  }

  function changed() {
    revision += 1;
    result = null;
    resultDraft = null;
    el('results').hidden = true;
    status('analysis-status', i18nUi.text("Inputs changed. Analyze to update the results."));
    if (storageReady) status('save-status', (((((JSON.stringify(draft()) === savedSnapshot ? i18nUi.text("Inputs saved.") : i18nUi.text("Inputs not saved.")))))));
    status('export-status', '');
    status('notebook-status', i18nUi.text("Choose an existing page after analyzing."));
    updateGroups();
    updateActions();
    void pushUnsaved();
  }

  function showMode(next) {
    mode = next;
    el('expression-inputs').hidden = next !== 'expression';
    el('curve-inputs').hidden = next !== 'curve';
    el('expression-mode').setAttribute('aria-pressed', String(next === 'expression'));
    el('curve-mode').setAttribute('aria-pressed', String(next === 'curve'));
    el('calibrator').required = next === 'expression';
  }

  function appearance(context) {
    if (context?.locale) root.HikariUi.setLocale(context.locale);
    if (!context?.appearance) return;
    const { mode: hostMode, fontSize } = context.appearance;
    document.documentElement.dataset.mode = hostMode === 'night' ? 'night' : 'day';
    if (Number.isFinite(fontSize)) document.body.style.fontSize = `${Math.min(32, Math.max(12, fontSize))}px`;
  }

  function renderTable(id, table) {
    const head = document.createElement('thead');
    const heading = document.createElement('tr');
    for (const column of table.columns) {
      const cell = document.createElement('th'); cell.scope = 'col'; i18nUi.setOwnedText(cell, column.title); heading.append(cell);
    }
    head.append(heading);
    const body = document.createElement('tbody');
    for (const row of table.rows) {
      const line = document.createElement('tr');
      for (const column of table.columns) { const cell = document.createElement('td'); i18nUi.setText(cell, row[column.field]); line.append(cell); }
      body.append(line);
    }
    el(id).replaceChildren(head, body);
  }

  function metric(title, value) {
    const box = document.createElement('div'); box.className = 'metric';
    const label = document.createElement('small'); i18nUi.setOwnedText(label, title);
    const number = document.createElement('strong'); i18nUi.setText(number, value);
    box.append(label, number); return box;
  }

  function plot(curve) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 640 320'); svg.setAttribute('role', 'img');
    i18nUi.setAttribute(svg, "aria-label", i18nUi.message("Standard curve: Ct versus log10 quantity. Slope {p0}, R squared {p1}.", { p0: math.format(curve.slope), p1: math.format(curve.rSquared) }));
    const add = (tag, attrs, text) => {
      const node = document.createElementNS(ns, tag);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
      if (text !== undefined) i18nUi.setOwnedText(node, text);
      svg.append(node); return node;
    };
    const xs = curve.points.map(point => point.x);
    const ys = curve.points.flatMap(point => [point.ct.mean, point.fittedCt]);
    const xmin = Math.min(...xs), xmax = Math.max(...xs);
    const ymin = Math.min(...ys) - 1, ymax = Math.max(...ys) + 1;
    const x = value => 65 + (value - xmin) / (xmax - xmin) * 540;
    const y = value => 260 - (value - ymin) / (ymax - ymin) * 230;
    add('path', { d: 'M65 30V260H605', fill: 'none', class: 'plot-axis' });
    for (let index = 0; index <= 4; index += 1) {
      const xv = xmin + (xmax - xmin) * index / 4;
      const yv = ymin + (ymax - ymin) * index / 4;
      add('text', { x: x(xv), y: 282, 'text-anchor': 'middle' }, math.format(xv));
      add('text', { x: 55, y: y(yv) + 4, 'text-anchor': 'end' }, math.format(yv));
    }
    add('text', { x: 335, y: 311, 'text-anchor': 'middle' }, 'log₁₀ starting quantity');
    add('text', { x: 20, y: 145, transform: 'rotate(-90 20 145)', 'text-anchor': 'middle' }, 'Mean Ct');
    const first = curve.points[0], last = curve.points[curve.points.length - 1];
    add('line', { x1: x(first.x), y1: y(first.fittedCt), x2: x(last.x), y2: y(last.fittedCt), class: 'plot-fit' });
    for (const point of curve.points) {
      const circle = add('circle', { cx: x(point.x), cy: y(point.ct.mean), r: 4, class: 'plot-point' });
      const title = document.createElementNS(ns, 'title'); i18nUi.setText(title, `${math.format(point.quantity)}: Ct ${math.format(point.ct.mean)}`); circle.append(title);
    }
    el('curve-plot').replaceChildren(svg);
  }

  function analyze(event) {
    event?.preventDefault();
    result = null;
    el('results').hidden = true;
    try {
      const current = draft();
      const calculation = mode === 'expression' ? math.expression(current.expressionData, current.calibrator) : math.standardCurve(current.curveData);
      renderTable('result-table', math.resultTable(calculation));
      el('group-results').hidden = mode !== 'expression';
      el('curve-plot').hidden = mode !== 'curve';
      i18nUi.setText(el('result-heading'), (mode === 'expression' ? i18nUi.message("Results by sample") : i18nUi.message("Results by standard")));
      if (mode === 'expression') {
        el('metrics').replaceChildren(metric('Biological samples', String(calculation.samples.length)), metric('Calibrator samples', String(calculation.controlN)), metric('Mean calibrator ΔCt', math.format(calculation.calibratorDeltaCt)));
        renderTable('group-table', { columns: [
          { field: 'group', title: 'Group' }, { field: 'n', title: 'n' }, { field: 'deltaCt', title: 'Mean ΔCt' },
          { field: 'deltaCtSd', title: 'ΔCt SD' }, { field: 'log2Fold', title: 'Mean log₂ fold change' }, { field: 'geometricFold', title: 'Geometric mean fold' }
        ], rows: calculation.groups.map(group => Object.fromEntries(Object.entries(group).map(([key, value]) => [key, key === 'group' ? value : math.format(value)]))) });
      } else {
        el('metrics').replaceChildren(metric('Efficiency', `${math.format(calculation.efficiency)}%`), metric('Slope', math.format(calculation.slope)), metric('R²', math.format(calculation.rSquared)), metric('Intercept', math.format(calculation.intercept)));
        plot(calculation);
      }
      result = calculation; resultDraft = current;
      el('results').hidden = false;
      status('analysis-status', (((((mode === 'expression' ? i18nUi.text("Calculated. Technical wells are averaged within each sample; biological samples remain separate.") : i18nUi.text("Calculated. Each starting quantity has equal weight in the regression.")))))));
    } catch (error) { status('analysis-status', error.message, true); }
    updateActions();
  }

  function summary(calculation, inputs) {
    if (calculation.kind === 'curve') return `qPCR standard curve\nSlope: ${math.format(calculation.slope)}; intercept: ${math.format(calculation.intercept)}; R²: ${math.format(calculation.rSquared)}; efficiency: ${math.format(calculation.efficiency)}%.\nOrdinary least squares: mean Ct = slope × log10(quantity) + intercept; each quantity weighted equally. Efficiency = (10^(-1/slope) - 1) × 100%.\nCt SD is the sample SD of technical wells; a single well has no SD.`;
    const groupSummary = calculation.groups.map(group => `${group.group}: n=${group.n}, mean ΔCt=${math.format(group.deltaCt)}, ΔCt SD=${math.format(group.deltaCtSd)}, geometric mean fold=${math.format(group.geometricFold)}`).join('\n');
    return `qPCR relative expression\nTarget: ${inputs.targetName.trim() || 'Target'}; reference: ${inputs.referenceName.trim() || 'Reference'}.\nCalibrator group: ${calculation.calibrator}; ${calculation.controlN} biological sample(s); mean calibrator ΔCt=${math.format(calculation.calibratorDeltaCt)}.\nΔCt = mean target Ct - mean reference Ct; ΔΔCt = sample ΔCt - mean calibrator ΔCt; fold change = 2^(-ΔΔCt). Assumes approximately equal target/reference efficiencies near 100%.\nTechnical wells are averaged within biological samples. Ct SD is the sample SD of technical wells; a single well has no SD. Group fold changes are geometric means; group ΔCt SD is biological sample SD. No significance test performed.\n${groupSummary}`;
  }

  function saveInputs() {
    if (savePromise) return savePromise;
    if (!storageReady) return Promise.resolve();
    const snapshot = JSON.stringify(draft());
    if (snapshot.length > storageLimit) { status('save-status', i18nUi.text("Inputs exceed the host storage limit. Reduce the pasted data."), true); return Promise.resolve(); }
    status('save-status', i18nUi.text("Saving inputs…"));
    savePromise = (async () => {
      try {
        await hikari.call('storage.set', { value: JSON.parse(snapshot) });
        savedSnapshot = snapshot;
        status('save-status', (((((JSON.stringify(draft()) === snapshot ? i18nUi.text("Inputs saved.") : i18nUi.text("Earlier inputs saved; current edits are not saved.")))))));
      } catch (error) { status('save-status', i18nUi.text("Save failed: {p0} Your inputs are kept here. Try Save inputs again.", { p0: error.message }), true); }
      finally { savePromise = null; updateActions(); await pushUnsaved(true); }
    })();
    updateActions();
    return savePromise;
  }

  async function refreshNotebooks() {
    if (loadingNotebooks || !connected || !permissions.has('notebook:read')) return;
    loadingNotebooks = true; updateActions();
    status('notebook-status', i18nUi.text("Loading notebook pages…"));
    try {
      const pages = await hikari.call('notebook.list');
      if (!Array.isArray(pages)) throw new Error('Hikari returned an invalid notebook list.');
      const selected = el('notebook-entry').value;
      const placeholder = document.createElement('option'); placeholder.value = ''; i18nUi.setText(placeholder, (pages.length ? i18nUi.message("Choose a notebook page") : i18nUi.message("No notebook pages. Create one in Biology Notebook, then refresh.")));
      const options = pages.filter(page => typeof page.id === 'string' && page.id).map(page => {
        const option = document.createElement('option'); option.value = page.id;
        i18nUi.setText(option, `${page.experimentName || 'Untitled'} (${page.id})`); return option;
      });
      el('notebook-entry').replaceChildren(placeholder, ...options);
      if (options.some(option => option.value === selected)) el('notebook-entry').value = selected;
      status('notebook-status', (((((pages.length ? i18nUi.text("Choose a page. Append results adds the current analysis and table.") : i18nUi.text("Create a notebook page in Hikari, then click Refresh.")))))));
    } catch (error) { status('notebook-status', i18nUi.text("Could not load pages: {p0} Click Refresh to try again.", { p0: error.message }), true); }
    finally { loadingNotebooks = false; updateActions(); }
  }

  async function appendResults() {
    if (appending || !result || el('append-results').disabled) return;
    const calculation = result, inputs = resultDraft, entryId = el('notebook-entry').value;
    appending = true; updateActions(); status('notebook-status', i18nUi.text("Appending results…"));
    try {
      await hikari.call('notebook.appendResult', { entryId, text: summary(calculation, inputs), table: math.resultTable(calculation) });
      status('notebook-status', i18nUi.text("Results appended to {p0}.{p1}", { p0: entryId, p1: result !== calculation ? ' Analyze current inputs before appending again.' : '' }));
    } catch (error) { status('notebook-status', i18nUi.text("Append failed: {p0} Your analysis is kept. Try again.", { p0: error.message }), true); }
    finally { appending = false; updateActions(); }
  }

  async function exportResults() {
    if (exporting || !result || el('export-results').disabled) return;
    exporting = true; updateActions(); status('export-status', i18nUi.text("Choose where to save…"));
    const calculation = result, inputs = resultDraft;
    try {
      const metadata = summary(calculation, inputs).split('\n').map(line => `# ${line.replace(/[\t\r]/g, ' ')}`).join('\n');
      const bytes = new TextEncoder().encode(`${metadata}\n\n${math.toTsv(math.resultTable(calculation))}`);
      const response = await hikari.call('downloads.save', { fileName: `qpcr-${calculation.kind === 'expression' ? 'relative-expression' : 'standard-curve'}.tsv`, dataBase64: bytes.toBase64() });
      status('export-status', (((((response?.saved ? i18nUi.text("TSV exported.") : i18nUi.text("Export canceled.")))))));
    } catch (error) { status('export-status', i18nUi.text("Export failed: {p0} Try again.", { p0: error.message }), true); }
    finally { exporting = false; updateActions(); }
  }

  async function connect() {
    if (connecting) return;
    connecting = true; el('connect').disabled = true; status('host-status', i18nUi.text("Connecting to Hikari…"));
    const initialRevision = revision;
    try {
      const info = await hikari.call('app.info');
      if (info?.host !== 'hikari' || info.pluginId !== 'qpcr-analysis') throw new Error('This page is not registered as the qPCR Analysis tool.');
      connected = true;
      permissions = new Set(Array.isArray(info.permissions) ? info.permissions : []);
      appearance(info);
      status('host-status', i18nUi.text("Connected to Hikari.")); el('connect').hidden = true;
      if (!storageReady && permissions.has('storage')) {
        try {
          const stored = await hikari.call('storage.get');
          if (!Number.isFinite(stored?.limit) || stored.limit <= 0) throw new Error('Hikari returned an invalid storage limit.');
          const restored = validateSaved(stored.value);
          storageLimit = stored.limit;
          const canRestore = revision === 0 && initialRevision === 0;
          if (restored && canRestore) {
            el('target-name').value = restored.targetName; el('reference-name').value = restored.referenceName;
            el('calibrator').value = restored.calibrator; el('expression-data').value = restored.expressionData; el('curve-data').value = restored.curveData;
            showMode(restored.mode); updateGroups();
          }
          savedSnapshot = restored ? JSON.stringify(restored) : bootSnapshot;
          storageReady = true;
          status('save-status', (((((restored && !canRestore ? i18nUi.text("Current edits kept. Save inputs to replace the saved draft.") : (restored ? i18nUi.text("Saved inputs restored.") : i18nUi.text("Save inputs to remember this draft."))))))));
          await pushUnsaved();
        } catch (error) {
          status('save-status', i18nUi.text("Could not restore inputs: {p0} Click Try again.", { p0: error.message }), true);
          el('connect').hidden = false;
        }
      } else if (!permissions.has('storage')) status('save-status', i18nUi.text("Saved inputs unavailable: storage permission is missing."));
      if (permissions.has('notebook:read')) await refreshNotebooks();
      else status('notebook-status', i18nUi.text("Notebook pages unavailable: notebook:read permission is missing."));
      if (!permissions.has('notebook:write')) status('notebook-status', i18nUi.text("Appending unavailable: notebook:write permission is missing."));
      if (!permissions.has('downloads')) status('export-status', i18nUi.text("Export unavailable: downloads permission is missing."));
    } catch (error) {
      connected = false; permissions.clear();
      status('host-status', i18nUi.text("{p0} Local calculations remain available.", { p0: error.message }), true); el('connect').hidden = false;
    } finally { connecting = false; el('connect').disabled = false; updateActions(); }
  }

  el('analysis-form').addEventListener('submit', analyze);
  for (const id of inputIds) el(id).addEventListener('input', changed);
  for (const next of ['expression', 'curve']) el(`${next}-mode`).addEventListener('click', () => { if (mode !== next) { showMode(next); changed(); } });
  el('load-example').addEventListener('click', () => {
    const field = el(mode === 'expression' ? 'expression-data' : 'curve-data');
    if (field.value.trim() && !root.confirm(i18nUi.text("Replace the current data in this analysis with example data?"))) return;
    field.value = examples[mode];
    if (mode === 'expression') { el('calibrator').value = 'Control'; el('target-name').value = 'Target'; el('reference-name').value = 'Reference'; }
    changed(); analyze();
  });
  el('save-inputs').addEventListener('click', saveInputs);
  el('refresh-notebooks').addEventListener('click', refreshNotebooks);
  el('notebook-entry').addEventListener('change', updateActions);
  el('append-results').addEventListener('click', appendResults);
  el('export-results').addEventListener('click', exportResults);
  el('connect').addEventListener('click', connect);
  const subscriptions = [hikari.on('app.context', appearance), hikari.on('app.save', payload => {
    if (payload?.pluginId && payload.pluginId !== 'qpcr-analysis') return;
    void saveInputs().finally(() => pushUnsaved(true));
  })];
  root.addEventListener('pagehide', () => { closed = true; for (const unsubscribe of subscriptions) unsubscribe(); }, { once: true });
  bootSnapshot = JSON.stringify(draft());
  void connect();
}(window));
