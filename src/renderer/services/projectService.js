export function createProjectService(registry, deps = {}) {
  const state = deps.state || null;

  function ensureProjectRecord(record = {}) {
    if (!state || typeof state !== 'object') {
      return null;
    }
    if (!Array.isArray(state.projects)) {
      state.projects = [];
    }
    const source = String(record.source || '').trim();
    const name = String(record.name || '').trim();
    const existing = state.projects.find((project) => (
      (source && String(project?.source || '').trim() === source)
      || (name && String(project?.name || '').trim().toLowerCase() === name.toLowerCase())
    ));
    if (existing) {
      return existing;
    }
    state.projects.push(record);
    return record;
  }

  function handleProjectsChanged({ refreshNotebook = true } = {}) {
    if (refreshNotebook) {
      registry.get('biologyNotebook').renderProjectOptions?.();
      registry.get('biologyNotebook').renderProtocolOptions?.();
      registry.get('biologyNotebook').renderEntries?.();
    }
    registry.get('workflowManagement').render?.();
    registry.get('assay').renderProjectOptions?.();
    registry.get('assay').renderNotebookOptions?.();
    registry.get('assay').renderList?.();
    registry.get('papers').render?.();
    registry.get('agentChat').render?.();
  }

  return {
    ensureProjectRecord,
    handleProjectsChanged
  };
}
