export function createInventoryService(registry) {
  function handleSamplesChanged() {
    registry.get('sampleRegistry').render?.();
  }

  function handleSampleInventorySettingsChanged() {
    registry.get('personalInventory').renderSections?.();
    registry.get('sampleRegistry').render?.();
  }

  function openSampleSearch(query) {
    const showView = registry.get('showView');
    const setSearchInputValue = registry.get('setSearchInputValue');
    const views = registry.get('VIEWS');
    if (typeof showView === 'function' && views?.SAMPLE_REGISTRY) {
      showView(views.SAMPLE_REGISTRY);
    }
    if (typeof setSearchInputValue === 'function') {
      setSearchInputValue('sample-search', query);
    }
  }

  return {
    handleSamplesChanged,
    handleSampleInventorySettingsChanged,
    openSampleSearch
  };
}
