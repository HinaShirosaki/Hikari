// Shared process creation entry point for Workflow and Notebook projects.
export function createWorkflowProcessDialog({ state, elements, safeText, createProcess, onCreated = () => {} }) {
  const { workflowProcessDialog: dialog, workflowProcessForm: form,
    workflowProcessTemplate: templateInput, workflowProcessProject: projectInput,
    workflowProcessName: nameInput, workflowProcessStatus: status } = elements;
  let afterCreate = onCreated;
  function open({ templateId = '', projectId = '', onCreated: callback } = {}) {
    if (!dialog || dialog.open) return;
    afterCreate = callback || onCreated;
    templateInput.innerHTML = '<option value="">Choose a workflow template</option>' + (state.workflowTemplates || [])
      .map((template) => `<option value="${safeText(template.id)}">${safeText(template.name || 'Untitled template')}</option>`).join('');
    projectInput.innerHTML = '<option value="">No project</option>' + (state.projects || [])
      .map((project) => `<option value="${safeText(project.id)}">${safeText(project.name)}</option>`).join('');
    templateInput.value = templateId;
    projectInput.value = projectId;
    nameInput.value = '';
    status.textContent = state.workflowTemplates?.length ? '' : 'Create a workflow template in Workflow first.';
    dialog.showModal();
    (templateId ? nameInput : templateInput).focus();
  }
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const template = (state.workflowTemplates || []).find((item) => item.id === templateInput.value);
    if (!template || !template.blocks?.length) {
      status.textContent = 'Choose a workflow template with at least one step.';
      return;
    }
    if (projectInput.value && !(state.projects || []).some((item) => item.id === projectInput.value)) {
      status.textContent = 'Choose an existing project.';
      return;
    }
    const process = createProcess(template, { projectId: projectInput.value, workflowName: nameInput.value.trim() });
    if (process) {
      dialog.close();
      afterCreate(process);
    }
  });
  elements.workflowProcessCancel?.addEventListener('click', () => dialog.close());
  return { open };
}
