export function createProtocolService(registry) {
  function importProtocolsFromJson(rawInput, options = {}) {
    const protocol = registry.get('protocol');
    if (typeof protocol.importProtocolsFromJson !== 'function') {
      return { ok: false, error: 'Protocol import is not ready.' };
    }
    return protocol.importProtocolsFromJson(rawInput, options);
  }

  function handleProtocolsChanged() {
    registry.get('synthesisNotebook').renderProtocolOptions?.();
    registry.get('synthesisNotebook').renderEntries?.();
    registry.get('biologyNotebook').renderProtocolOptions?.();
    registry.get('biologyNotebook').renderEntries?.();
    registry.get('workflowManagement').render?.();
    registry.get('assay').renderNotebookOptions?.();
    registry.get('assay').renderList?.();
    registry.get('gel').renderNotebookOptions?.();
    registry.get('gel').renderList?.();
  }

  function handleProtocolsImported() {
    handleProtocolsChanged();
    registry.get('protocol').renderList?.();
  }

  function createDraftFromPaper({ method, paper }) {
    const protocol = registry.get('protocol');
    const ok = protocol.addDraftFromExtractedMethod?.(method, paper);
    if (ok) {
      const showView = registry.get('showView');
      const views = registry.get('VIEWS');
      if (typeof showView === 'function' && views?.PROTOCOL_MANAGEMENT) {
        showView(views.PROTOCOL_MANAGEMENT);
      }
    }
    return Boolean(ok);
  }

  return {
    importProtocolsFromJson,
    handleProtocolsChanged,
    handleProtocolsImported,
    createDraftFromPaper
  };
}
