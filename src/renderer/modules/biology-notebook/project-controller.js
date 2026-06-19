export function createNotebookProjectController({
  state,
  persist,
  createId,
  onProjectsChanged,
  onProjectCreated,
  railEl,
  contextMenuEl,
  addProjectBtn,
  dialogOverlay,
  dialogForm,
  projectNameInput,
  projectDescriptionInput,
  dialogCloseBtn,
  dialogCancelBtn,
  windowRef = typeof window !== 'undefined' ? window : null,
  documentRef = typeof document !== 'undefined' ? document : null
} = {}) {
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

  function openProjectDialog() {
    hideContextMenu();
    dialogForm?.reset?.();
    if (dialogOverlay) {
      dialogOverlay.hidden = false;
    }
    const focusName = () => projectNameInput?.focus?.();
    if (typeof windowRef?.requestAnimationFrame === 'function') {
      windowRef.requestAnimationFrame(focusName);
    } else {
      focusName();
    }
  }

  function closeProjectDialog() {
    if (dialogOverlay) {
      dialogOverlay.hidden = true;
    }
    dialogForm?.reset?.();
  }

  function sanitizeFolderName(value) {
    return String(value || '')
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/^_+|_+$/g, '');
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
      }
    } catch (error) {
      console.warn('Failed to create project directory:', error);
    }
  }

  async function createProject() {
    const name = cleanText(projectNameInput?.value);
    if (!name) {
      projectNameInput?.focus?.();
      return null;
    }

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
    state.projects.push(project);
    persist();
    await ensureProjectDirectory(project.name);
    onProjectsChanged?.();
    closeProjectDialog();
    onProjectCreated?.(project);
    return project;
  }

  function onRailContextMenu(event) {
    event?.preventDefault?.();
    positionContextMenu(event?.clientX, event?.clientY);
  }

  function onDialogSubmit(event) {
    event?.preventDefault?.();
    void createProject();
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

  railEl?.addEventListener?.('contextmenu', onRailContextMenu);
  contextMenuEl?.addEventListener?.('click', (event) => event?.stopPropagation?.());
  addProjectBtn?.addEventListener?.('click', openProjectDialog);
  dialogForm?.addEventListener?.('submit', onDialogSubmit);
  dialogCloseBtn?.addEventListener?.('click', closeProjectDialog);
  dialogCancelBtn?.addEventListener?.('click', closeProjectDialog);
  dialogOverlay?.addEventListener?.('click', onDialogOverlayClick);
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
