import { createPresentation } from "../../lib/i18n/presentation.js";
import "./localization.js";
const i18nUi = createPresentation("workflow");
import { workflowText, setWorkflowText } from './localization.js';
import { translateTree } from '../../lib/i18n/dom.js';

// Shared process creation entry point for Workflow and Notebook projects.
export function createWorkflowProcessDialog({ state, elements, safeText, createProcess, onCreated = () => {} }) {
  const { workflowProcessDialog: dialog, workflowProcessForm: form,
    workflowProcessTemplateField: templateField, workflowProcessTemplate: templateInput, workflowProcessProject: projectInput,
    workflowProcessName: nameInput, workflowProcessStatus: status } = elements;
  let afterCreate = onCreated;
  let contextTemplateId = '';
  function open({ templateId = '', projectId = '', onCreated: callback } = {}) {
    if (!dialog || dialog.open) return;
    afterCreate = callback || onCreated;
    contextTemplateId = templateId;
    if (templateField) templateField.hidden = Boolean(contextTemplateId);
    templateInput.disabled = Boolean(contextTemplateId);
    templateInput.required = !contextTemplateId;
    i18nUi.setHtml(templateInput, '<option value="" data-i18n="workflow.option.chooseTemplate">Choose a workflow template</option>' + (state.workflowTemplates || [])
      .map((template) => `<option value="${safeText(template.id)}">${safeText(template.name || workflowText('fallback.template'))}</option>`).join(''));
    i18nUi.setHtml(projectInput, '<option value="" data-i18n="workflow.option.noProject">No project</option>' + (state.projects || [])
      .map((project) => `<option value="${safeText(project.id)}">${safeText(project.name)}</option>`).join(''));
    templateInput.value = templateId;
    projectInput.value = projectId;
    nameInput.value = '';
    if (state.workflowTemplates?.length) {
      status.removeAttribute?.('data-i18n');
      i18nUi.setOwnedText(status, '');
    } else setWorkflowText(status, 'process.noTemplates');
    translateTree(dialog);
    dialog.showModal();
    (templateId ? nameInput : templateInput).focus();
  }
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const template = (state.workflowTemplates || []).find((item) => item.id === (contextTemplateId || templateInput.value));
    if (!template || !template.blocks?.length) {
      setWorkflowText(status, 'process.stepRequired');
      return;
    }
    if (projectInput.value && !(state.projects || []).some((item) => item.id === projectInput.value)) {
      setWorkflowText(status, 'process.projectRequired');
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
