// A tool plugin: Hikari shows this page as a panel in Tools. The math lives in
// seeding.js; this file wires it to the page and to four host calls: plate
// settings in `storage`, cell-line names from `samples.list`, and the plan
// saved to a notebook page with `notebook.list` + `notebook.appendResult`.
(function startCellSeeding(root) {
  'use strict';

  const hikari = root.HikariPlugin?.hikari;
  const seeding = root.CellSeeding;
  const $ = (id) => document.getElementById(id);
  const fields = {
    live: $('live'), dead: $('dead'), dilution: $('dilution'), plate: $('plate'), wells: $('wells'),
    cellsPerWell: $('cells-per-well'), mediumPerWell: $('medium-per-well'), overage: $('overage'), cellLine: $('cell-line')
  };
  const entrySelect = $('entry');
  const saveButton = $('save');
  const retryButton = $('retry');
  const status = $('status');
  const settingFields = [...document.querySelectorAll('[data-setting]')];
  let current = null;
  let notebookReady = false;
  let saving = false;
  let settingsTouched = false;

  const number = (input) => (input.value.trim() === '' ? NaN : Number(input.value));

  function compute() {
    const count = seeding.countCells({ live: fields.live.value, dead: fields.dead.value, dilution: number(fields.dilution) });
    if (!count.ok) return { count };
    const inputs = {
      wells: number(fields.wells),
      cellsPerWell: number(fields.cellsPerWell),
      mediumPerWellMl: number(fields.mediumPerWell),
      overagePercent: number(fields.overage),
      dilution: number(fields.dilution)
    };
    return { count, inputs, plan: seeding.planSeeding({ viableCellsPerMl: count.viableCellsPerMl, ...inputs }) };
  }

  function render() {
    current = compute();
    const { count, plan } = current;
    const typed = fields.live.value.trim() || fields.dead.value.trim();
    const countResult = $('count-result');
    countResult.classList.toggle('error', !count.ok);
    countResult.textContent = !count.ok
      ? (typed ? count.error : '')
      : [
        `${seeding.formatCells(count.viableCellsPerMl)} viable cells/mL`,
        count.viability === null ? '' : `${seeding.formatPercent(count.viability)} viable`,
        `${count.squares} square${count.squares === 1 ? '' : 's'}`
      ].filter(Boolean).join(' · ');

    $('plan-result').hidden = !plan?.ok;
    $('plan-error').textContent = plan && !plan.ok ? plan.error : '';
    if (plan?.ok) {
      $('suspension').textContent = seeding.formatVolume(plan.suspensionMl);
      $('medium').textContent = seeding.formatVolume(plan.mediumMl);
      $('total').textContent = seeding.formatVolume(plan.totalMl);
      $('cells-needed').textContent = seeding.formatCells(plan.totalCells);
    }
    syncSaveButton();
  }

  function syncSaveButton() {
    saveButton.disabled = saving || !notebookReady || !entrySelect.value || !current?.plan?.ok;
  }

  function applyAppearance({ appearance } = {}) {
    const mode = appearance?.mode === 'night' ? 'night' : 'day';
    document.documentElement.dataset.mode = mode;
    document.documentElement.style.colorScheme = mode === 'night' ? 'dark' : 'light';
  }

  // Plate format, density, and volumes repeat from run to run, so they are
  // remembered in the plugin's own storage. Counts are per run and are not.
  async function restoreSettings() {
    const { value } = await hikari.call('storage.get');
    if (settingsTouched || !value?.settings) return;
    settingFields.forEach((field) => {
      const saved = value.settings[field.id];
      if (typeof saved !== 'string') return;
      if (field.tagName === 'SELECT' && ![...field.options].some((option) => option.value === saved)) return;
      field.value = saved;
    });
    render();
  }

  function saveSettings() {
    const settings = Object.fromEntries(settingFields.map((field) => [field.id, field.value]));
    hikari.call('storage.set', { value: { settings } }).catch(() => {
      status.textContent = 'These settings could not be remembered for next time.';
    });
  }

  async function loadCellLines() {
    const samples = await hikari.call('samples.list');
    const names = [...new Set(samples.map((sample) => sample.name).filter(Boolean))].sort();
    $('cell-lines').replaceChildren(...names.map((name) => new Option(name)));
  }

  async function loadNotebookPages() {
    notebookReady = false;
    retryButton.hidden = true;
    entrySelect.disabled = true;
    entrySelect.setAttribute('aria-busy', 'true');
    syncSaveButton();
    try {
      const entries = (await hikari.call('notebook.list'))
        .sort((left, right) => String(right.savedAt).localeCompare(String(left.savedAt)));
      entrySelect.replaceChildren(entries.length
        ? new Option('Choose a page…', '')
        : new Option('No notebook pages yet', ''));
      entries.forEach((entry) => {
        const date = entry.savedAt ? new Date(entry.savedAt).toLocaleDateString() : '';
        entrySelect.append(new Option([entry.experimentName || 'Untitled page', date].filter(Boolean).join(' · '), entry.id));
      });
      entrySelect.disabled = !entries.length;
      notebookReady = entries.length > 0;
      if (!entries.length) status.textContent = 'Create a notebook page first, then come back to save the plan.';
    } catch (error) {
      entrySelect.replaceChildren(new Option('Unavailable', ''));
      status.textContent = `Notebook pages could not be loaded: ${error.message}`;
      retryButton.hidden = false;
    } finally {
      entrySelect.removeAttribute('aria-busy');
      syncSaveButton();
    }
  }

  async function saveToNotebook() {
    if (saving || !current?.plan?.ok || !entrySelect.value) return;
    const pageName = entrySelect.selectedOptions[0]?.textContent.split(' · ')[0] || 'the page';
    const record = seeding.buildRecord({ cellLine: fields.cellLine.value, ...current });
    saving = true;
    saveButton.setAttribute('aria-busy', 'true');
    syncSaveButton();
    status.textContent = 'Saving…';
    try {
      await hikari.call('notebook.appendResult', { entryId: entrySelect.value, ...record });
      status.textContent = `Saved to “${pageName}”.`;
    } catch (error) {
      status.textContent = `Not saved: ${error.message}`;
    } finally {
      saving = false;
      saveButton.removeAttribute('aria-busy');
      syncSaveButton();
    }
  }

  // Picking a plate fills in its well count and a typical medium volume; both
  // stay editable for a partial plate or a different volume.
  fields.plate.addEventListener('change', () => {
    fields.wells.value = fields.plate.value;
    fields.mediumPerWell.value = fields.plate.selectedOptions[0].dataset.medium;
    render();
  });
  Object.values(fields).forEach((field) => field.addEventListener('input', render));
  settingFields.forEach((field) => {
    field.addEventListener('input', () => { settingsTouched = true; });
    field.addEventListener('change', saveSettings);
  });
  entrySelect.addEventListener('change', () => {
    status.textContent = '';
    syncSaveButton();
  });
  saveButton.addEventListener('click', saveToNotebook);
  retryButton.addEventListener('click', loadNotebookPages);

  render();
  if (!hikari || !seeding) {
    status.textContent = 'Plugin support files did not load. Reload Hikari.';
    return;
  }
  hikari.on('app.context', applyAppearance);
  hikari.call('app.info').then(applyAppearance).catch(() => {});
  restoreSettings().catch(() => {});
  loadCellLines().catch(() => {}); // Suggestions only; the field still takes any name.
  loadNotebookPages();
}(window));
