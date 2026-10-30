import { showTransientNotice } from '../../../lib/notify.js';

export function createNotebookProjectController({
  state,
  persist,
  createId,
  onProjectsChanged,
  onProjectCreated,
  railEl,
  contextMenuEl,
  addProjectBtn,
  headerAddProjectBtn,
  experimentAddProjectBtn,
  experimentDialogOverlay,
  dialogOverlay,
  dialogForm,
  projectNameInput,
  projectDescriptionInput,
  projectDetails,
  dialogStatus,
  dialogCreateBtn,
  dialogCloseBtn,
  dialogCancelBtn,
  windowRef = typeof window !== 'undefined' ? window : null,
  documentRef = typeof document !== 'undefined' ? document : null
} = {}) {
  let returnFocusEl = null;
  let returnToExperiment = false;
  let creating = false;

  function cleanText(value) {
    return String(value || '').trim();
  }

  function hideContextMenu() {
    if (contextMenuEl) {
      contextMenuEl.hidden = true;
    }
  }

  function positionContextMenu(clientX, clientY) {
    if (!contextMenuEl) {
      return;
    }
    contextMenuEl.style.left = `${Math.max(0, Number(clientX) || 0)}px`;
    contextMenuEl.style.top = `${Math.max(0, Number(clientY) || 0)}px`;
    contextMenuEl.hidden = false;
  }

  function setDialogError(message = '') {
    if (dialogStatus) {
      dialogStatus.textContent = message;
      dialogStatus.hidden = !message;
    }
    projectNameInput?.setAttribute?.('aria-invalid', String(Boolean(message)));
  }

  function openProjectDialog(event) {
    if (creating || (dialogOverlay && !dialogOverlay.hidden)) return;
    returnFocusEl = event?.currentTarget || documentRef?.activeElement || headerAddProjectBtn;
    if (returnFocusEl === addProjectBtn) returnFocusEl = headerAddProjectBtn || railEl;
    returnToExperiment = Boolean(experimentDialogOverlay && !experimentDialogOverlay.hidden);
    if (returnToExperiment) experimentDialogOverlay.hidden = true;
    hideContextMenu();
    dialogForm?.reset?.();
    if (projectDetails) projectDetails.open = false;
    setDialogError();
    if (dialogOverlay) {
      dialogOverlay.hidden = false;
    }
    const focusName = () => { if (!dialogOverlay?.hidden) projectNameInput?.focus?.(); };
    if (typeof windowRef?.requestAnimationFrame === 'function') {
      windowRef.requestAnimationFrame(focusName);
    } else {
      focusName();
    }
  }

  function closeProjectDialog() {
    if (creating || !dialogOverlay || dialogOverlay.hidden) return;
    if (dialogOverlay) {
      dialogOverlay.hidden = true;
    }
    dialogForm?.reset?.();
    setDialogError();
    if (returnToExperiment && experimentDialogOverlay) experimentDialogOverlay.hidden = false;
    returnToExperiment = false;
    returnFocusEl?.focus?.();
    returnFocusEl = null;
  }

  // Mirrors sanitizeFolderName in src/main/storage/storage-utils.js, which the
  // renderer cannot import. project-research-memory-selfcheck asserts the two
  // agree: when they drift, this asks main to create one folder while storage
  // writes MEMORY.md to another.
  function sanitizeFolderName(value) {
    const cleaned = String(value || '')
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 180);
    return !cleaned || /^\.+$/.test(cleaned) ? '' : cleaned;
  }

  // Two names that sanitize alike share one project folder, and the loser's
  // notebooks and papers drop out of project memory entirely. Comparing raw
  // names lets "Atlas" and "Atlas " both through.
  function projectFolderKey(value) {
    return sanitizeFolderName(value).toLowerCase();
  }

  async function ensureProjectDirectory(projectName) {
    const rootPath = cleanText(state?.settings?.storagePath);
    if (!rootPath || typeof windowRef?.hikariApi?.ensureStorageDirectory !== 'function') {
      return;
    }

    const safeProjectName = sanitizeFolderName(projectName) || 'Untitled_Project';
    const projectFolder = `${rootPath}/Project/${safeProjectName}`;
    try {
      const result = await windowRef.hikariApi.ensureStorageDirectory(projectFolder);
      if (result?.ok !== true) {
        console.warn('Failed to create project directory:', result?.error || projectFolder);
        showTransientNotice(`Could not create the project folder: ${result?.error || projectFolder}`, { type: 'error' });
      }
    } catch (error) {
      console.warn('Failed to create project directory:', error);
      showTransientNotice(String(error?.message || error || 'Could not create the project folder.'), { type: 'error' });
    }
  }

  async function createProject() {
    if (creating) return null;
    const name = cleanText(projectNameInput?.value);
    if (!name) {
      setDialogError('Enter a project name.');
      projectNameInput?.focus?.();
      return null;
    }
    const folderKey = projectFolderKey(name);
    const clash = state.projects?.find((project) => (
      cleanText(project.name).toLowerCase() === name.toLowerCase()
      || (folderKey && projectFolderKey(project.name) === folderKey)
    ));
    if (clash) {
      setDialogError(
        cleanText(clash.name).toLowerCase() === name.toLowerCase()
          ? 'A project with this name already exists. Choose a different name.'
          : `This name shares a storage folder with "${cleanText(clash.name)}". Choose a more distinct name.`
      );
      projectNameInput?.focus?.();
      return null;
    }
    setDialogError();

    const now = new Date().toISOString();
    const project = {
      id: createId(),
      name,
      description: cleanText(projectDescriptionInput?.value),
      createdAt: now,
      updatedAt: now
    };

    if (!Array.isArray(state.projects)) {
      state.projects = [];
    }
    const fromExperiment = returnToExperiment;
    creating = true;
    if (dialogCreateBtn) {
      dialogCreateBtn.disabled = true;
      dialogCreateBtn.textContent = 'Creating…';
    }
    try {
      state.projects.push(project);
      persist();
      await ensureProjectDirectory(project.name);
      // Experiment setup owns its selections and the page behind the dialog.
      onProjectsChanged?.({ refreshNotebook: !fromExperiment });
      creating = false;
      closeProjectDialog();
      onProjectCreated?.(project, { fromExperiment });
      return project;
    } finally {
      creating = false;
      if (dialogCreateBtn) {
        dialogCreateBtn.disabled = false;
        dialogCreateBtn.textContent = 'Create project';
      }
    }
  }

  function onRailContextMenu(event) {
    event?.preventDefault?.();
    positionContextMenu(event?.clientX, event?.clientY);
  }

  function onDialogSubmit(event) {
    event?.preventDefault?.();
    void createProject().catch((error) => {
      showTransientNotice(String(error?.message || 'Could not create the project.'), { type: 'error' });
    });
  }

  function onDocumentClick(event) {
    if (!contextMenuEl?.hidden && !contextMenuEl?.contains?.(event?.target)) {
      hideContextMenu();
    }
  }

  function onDocumentKeydown(event) {
    if (event?.key !== 'Escape') {
      return;
    }
    hideContextMenu();
    closeProjectDialog();
  }

  function onDialogOverlayClick(event) {
    if (event?.target === dialogOverlay) {
      closeProjectDialog();
    }
  }

  function onDialogKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeProjectDialog();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...(dialogOverlay?.querySelectorAll?.('button, input, textarea, summary') || [])]
      .filter((element) => !element.disabled && element.getClientRects().length);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && documentRef?.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && documentRef?.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  railEl?.addEventListener?.('contextmenu', onRailContextMenu);
  contextMenuEl?.addEventListener?.('click', (event) => event?.stopPropagation?.());
  addProjectBtn?.addEventListener?.('click', openProjectDialog);
  headerAddProjectBtn?.addEventListener?.('click', openProjectDialog);
  experimentAddProjectBtn?.addEventListener?.('click', openProjectDialog);
  projectNameInput?.addEventListener?.('input', () => setDialogError());
  dialogForm?.addEventListener?.('submit', onDialogSubmit);
  dialogCloseBtn?.addEventListener?.('click', closeProjectDialog);
  dialogCancelBtn?.addEventListener?.('click', closeProjectDialog);
  dialogOverlay?.addEventListener?.('click', onDialogOverlayClick);
  dialogOverlay?.addEventListener?.('keydown', onDialogKeydown);
  documentRef?.addEventListener?.('click', onDocumentClick);
  documentRef?.addEventListener?.('keydown', onDocumentKeydown);
  windowRef?.addEventListener?.('resize', hideContextMenu);
  windowRef?.addEventListener?.('scroll', hideContextMenu, true);

  return {
    closeProjectDialog,
    createProject,
    hideContextMenu,
    openProjectDialog
  };
}
