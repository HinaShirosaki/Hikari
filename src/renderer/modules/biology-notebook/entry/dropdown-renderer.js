// Most-used protocols first, most recently used breaking ties, then by name —
// so the protocol a student runs every week is at the top of the list.
export function rankProtocolsByUsage(protocols = [], entries = []) {
  const usage = new Map();
  for (const entry of entries) {
    const id = String(entry?.protocolId || '').trim();
    if (!id) {
      continue;
    }
    const current = usage.get(id) || { count: 0, lastUsed: '' };
    const used = String(entry.executedAt || entry.updatedAt || entry.createdAt || '');
    usage.set(id, { count: current.count + 1, lastUsed: used > current.lastUsed ? used : current.lastUsed });
  }
  return [...protocols].sort((a, b) => {
    const ua = usage.get(a.id) || { count: 0, lastUsed: '' };
    const ub = usage.get(b.id) || { count: 0, lastUsed: '' };
    return (ub.count - ua.count)
      || ub.lastUsed.localeCompare(ua.lastUsed)
      || String(a.name || '').localeCompare(String(b.name || ''));
  });
}

export function createDropdownRenderer({
  projectSelect,
  protocolSelect,
  protocolSearchInput,
  safeText,
  getProjects,
  getProtocols,
  getNotebookEntries = () => [],
  onAfterRender,
  onProtocolChange
} = {}) {
  function renderProjectOptions() {
    if (!projectSelect) {
      return;
    }
    const projects = getProjects() || [];
    const selected = projectSelect.value;
    const options = ['<option value="">Select project</option>'];

    projects.forEach((project) => {
      const isSelected = project.id === selected ? ' selected' : '';
      options.push(`<option value="${project.id}"${isSelected}>${safeText(project.name)}</option>`);
    });

    projectSelect.innerHTML = options.join('');

    if (selected && projects.some((project) => project.id === selected)) {
      projectSelect.value = selected;
    } else if (projects.length) {
      projectSelect.value = projects[0].id;
    }

    onAfterRender?.();
  }

  function renderProtocolOptions(preferredProtocolId = '', options = {}) {
    if (!protocolSelect) {
      return;
    }
    const projects = getProjects() || [];
    const protocols = getProtocols() || [];
    const projectId = projectSelect?.value || '';
    const selected = preferredProtocolId || protocolSelect.value;
    const hasProject = Boolean(projects.find((item) => item.id === projectId));
    const searchTerm = String(protocolSearchInput?.value || '').trim().toLowerCase();
    const optionMarkup = ['<option value="">Select protocol</option>'];
    const selectedProtocol = protocols.find((item) => item.id === selected) || null;
    const filteredProtocols = hasProject
      ? rankProtocolsByUsage(protocols, getNotebookEntries() || [])
        .filter((protocol) => String(protocol.name || '').toLowerCase().includes(searchTerm))
      : [];

    if (
      hasProject
      && selectedProtocol
      && !filteredProtocols.some((protocol) => protocol.id === selectedProtocol.id)
    ) {
      filteredProtocols.unshift(selectedProtocol);
    }

    filteredProtocols.forEach((protocol) => {
      const isSelected = protocol.id === selected ? ' selected' : '';
      optionMarkup.push(`<option value="${protocol.id}"${isSelected}>${safeText(protocol.name)}</option>`);
    });

    protocolSelect.innerHTML = optionMarkup.join('');
    protocolSelect.disabled = !hasProject;

    if (hasProject && selected && filteredProtocols.some((protocol) => protocol.id === selected)) {
      protocolSelect.value = selected;
    }

    onAfterRender?.();
    if (options.triggerChange !== false) {
      onProtocolChange?.();
    }
  }

  return {
    renderProjectOptions,
    renderProtocolOptions
  };
}
