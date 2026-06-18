export function renderStorageImportStatus(element, state, inFlight = false) {
  if (!element) {
    return;
  }
  if (inFlight) {
    element.textContent = 'Storage import: refreshing workspace and scanning records...';
    return;
  }
  const info = state.settings?.storageImport && typeof state.settings.storageImport === 'object'
    ? state.settings.storageImport
    : {};
  const summary = info.summary && typeof info.summary === 'object' ? info.summary : {};
  const warningCount = Array.isArray(info.warnings) ? info.warnings.length : 0;
  if (String(info.error || '').trim()) {
    element.textContent = `Storage import: ${String(info.error).trim()}`;
    return;
  }
  if (String(info.lastImportedAt || '').trim()) {
    const parts = [
      `${Number(summary.protocols) || 0} protocols`,
      `${Number(summary.notebookEntries) || 0} notebook entries`,
      `${Number(summary.workflowTemplates) || 0} workflow templates`,
      `${Number(summary.workflows) || 0} workflows`,
      `${Number(summary.papers) || 0} papers`,
      `${Number(summary.chemicals) || 0} chemicals`,
      `${Number(summary.personalInventoryContainers) || 0} inventory containers`,
      `${Number(summary.sequenceEntries) || 0} sequences`
    ];
    const warningText = warningCount ? ` (${warningCount} warnings)` : '';
    const manifestPath = String(info.manifestPath || '').trim();
    const suffix = manifestPath ? ` · manifest: ${manifestPath}` : '';
    element.textContent = `Storage import: ${parts.join(', ')}${warningText}${suffix}`;
    return;
  }
  element.textContent = 'Storage import: not started.';
}
