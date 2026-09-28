// Drafts belong to their form, so navigation and background catalog refreshes
// cannot silently discard work in another settings section.
export function createSettingsFormPresentation({ document, onRestoreModel }) {
  const forms = new Map();
  const fields = (form) => [...form.querySelectorAll('input[id], select[id]')];
  const read = (form) => Object.fromEntries(fields(form).map((input) => [
    input.id, input.type === 'checkbox' ? input.checked : input.value
  ]));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function preview() {
    const mode = document.getElementById('setting-mode')?.value || 'day';
    const sample = document.getElementById('setting-appearance-preview');
    if (sample) {
      sample.dataset.mode = mode;
      sample.style.fontSize = `${Number(document.getElementById('setting-font-size')?.value) || 16}px`;
    }
    document.querySelectorAll('[data-settings-mode]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.settingsMode === mode));
    });
  }

  function update(form, message) {
    const entry = forms.get(form);
    const dirty = entry.baseline !== null && !same(read(form), entry.baseline);
    form.querySelector('[type="submit"]').disabled = entry.saving || !dirty;
    form.querySelector('[data-settings-discard]').disabled = entry.saving || !dirty;
    form.querySelector('[data-settings-save-status]').textContent = message
      || (entry.saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved');
    preview();
  }

  function restore(form, values) {
    fields(form).forEach((input) => {
      if (input.id in values) {
        if (input.type === 'checkbox') input.checked = values[input.id];
        else input.value = values[input.id];
      }
    });
    if (form.id === 'llm-form') {
      onRestoreModel(values['setting-reasoning-effort']);
    }
  }

  function bind(form, save) {
    if (!form?.querySelector?.('[data-settings-save-status]')) {
      form?.addEventListener('submit', save);
      return;
    }
    const entry = { baseline: null, saving: false };
    forms.set(form, entry);
    form.addEventListener('input', () => update(form));
    form.addEventListener('change', () => update(form));
    form.querySelector('[data-settings-discard]').addEventListener('click', () => {
      if (entry.baseline) restore(form, entry.baseline);
      update(form);
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (entry.saving) return;
      entry.saving = true;
      form.inert = true;
      update(form);
      try {
        await save(event);
        entry.baseline = read(form);
        entry.saving = false;
        update(form, 'Changes saved');
      } catch {
        entry.saving = false;
        update(form, 'Could not save changes. Please try again.');
      } finally {
        form.inert = false;
      }
    });
  }

  document.querySelectorAll('[data-settings-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.getElementById('setting-mode');
      input.value = button.dataset.settingsMode;
      update(input.closest('form'));
    });
  });

  function captureDrafts() {
    return new Map([...forms].filter(([form, entry]) => (
      entry.baseline !== null && !entry.saving && !same(read(form), entry.baseline)
    )).map(([form]) => [form, read(form)]));
  }

  function rendered(drafts) {
    forms.forEach((entry, form) => {
      entry.baseline = read(form);
      if (drafts.has(form)) restore(form, drafts.get(form));
      update(form);
    });
    preview();
  }

  return { bind, captureDrafts, rendered };
}
