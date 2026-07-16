export function createDropdownRenderer({
  projectSelect,
  protocolSelect,
  protocolSearchInput,
  safeText,
  getProjects,
  getProtocols,
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
      ? protocols.filter((protocol) => String(protocol.name || '').toLowerCase().includes(searchTerm))
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
