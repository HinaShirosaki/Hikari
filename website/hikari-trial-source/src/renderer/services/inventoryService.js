export function createInventoryService(registry) {
  function handleSamplesChanged() {
    registry.get('sampleRegistry').render?.();
  }

  function handleSampleInventorySettingsChanged() {
    registry.get('personalInventory').renderSections?.();
    registry.get('sampleRegistry').render?.();
    registry.get('protocol').renderPlaceholderPresets?.();
  }

  function openSampleSearch(_query) {
    const showView = registry.get('showView');
    const views = registry.get('VIEWS');
    if (typeof showView === 'function' && views?.SAMPLE_REGISTRY) {
      showView(views.SAMPLE_REGISTRY);
    }
  }

  return {
    handleSamplesChanged,
    handleSampleInventorySettingsChanged,
    openSampleSearch
  };
}
