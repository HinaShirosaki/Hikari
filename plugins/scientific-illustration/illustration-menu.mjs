import { createPresentation } from './i18n.mjs';
import { installIllustrationContextMenu } from './context-menu.mjs';
const i18nUi = createPresentation('figura');

export function installIllustrationMenu({ document, workspace, manageIllustration, exportFigure, status }) {
  const $ = id => document.getElementById(id);
  const list = $('illustrations');
  const dialog = $('illustration-action-dialog'), form = $('illustration-action-form');
  const name = $('illustration-new-name'), cancel = $('cancel-illustration-action'), error = $('illustration-action-error');
  const tasks = [...form.querySelectorAll('[data-illustration-task]')];
  const submitButtons = [...form.querySelectorAll('button[type="submit"]')];
  let target, saving = false;

  function focusRow(id) {
    const row = [...list.children].find(button => button.dataset.illustrationId === id)
      || list.querySelector('[aria-pressed="true"]') || $('illustration-search');
    row.focus({ preventScroll: true });
  }
  function showError(message = '') {
    i18nUi.setOwnedText(error, message);
    error.hidden = !message;
  }
  function openDialog(action, id) {
    const entry = workspace.getLibrary().illustrations.find(item => item.id === id);
    if (!entry) return;
    target = { action, id };
    for (const element of tasks) element.hidden = !element.dataset.illustrationTask.split(' ').includes(action);
    for (const button of submitButtons) button.disabled = button.hidden;
    i18nUi.setText($('illustration-action-name'), entry.title || i18nUi.message('Untitled figure'));
    name.disabled = action !== 'rename';
    name.value = entry.title;
    showError();
    dialog.showModal();
    if (action === 'rename') { name.focus(); name.select(); }
    else (action === 'export' ? submitButtons.find(button => !button.hidden) : cancel).focus();
  }

  const contextMenu = installIllustrationContextMenu({ document, focusRow, status,
    getActions: id => ({
      export: { enabled: true, run: () => openDialog('export', id) },
      duplicate: { enabled: workspace.getLibrary().illustrations.length < 100, run: async () => {
        const result = await manageIllustration('duplicate', id);
        if (result?.ok) focusRow(result.illustration_id);
      } },
      rename: { enabled: true, run: () => openDialog('rename', id) },
      delete: { enabled: true, run: () => openDialog('delete', id) }
    })
  });
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    if (!dialog.open && target) { focusRow(target.id); target = null; }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!target || saving) return;
    const { action, id } = target;
    if (action === 'export') {
      if (!event.submitter?.value) return;
      dialog.close();
      await exportFigure(event.submitter.value, id);
      return;
    }
    const title = name.value.trim();
    if (action === 'rename' && !title) {
      showError('Enter an illustration name.');
      name.focus();
      return;
    }
    saving = true;
    cancel.disabled = true;
    submitButtons.forEach(button => { button.disabled = true; });
    showError();
    try {
      const result = await manageIllustration(action, id, title);
      if (result?.ok) dialog.close();
      else showError(result?.error);
    } finally {
      saving = false;
      cancel.disabled = false;
      submitButtons.forEach(button => { button.disabled = button.hidden; });
    }
  });
  return contextMenu;
}
