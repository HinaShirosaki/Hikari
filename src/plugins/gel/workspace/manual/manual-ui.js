export function getViewerToolLabel(tool = '') {
  if (tool === 'dividers') {
    return 'Set lane dividers';
  }
  if (tool === 'ladder') {
    return 'Set ladder lane';
  }
  if (tool === 'ladder-mw') {
    return 'Set ladder MW';
  }
  if (tool === 'lane-vertices') {
    return 'Adjust lane vertices';
  }
  if (tool === 'band-top') {
    return 'Set band top line';
  }
  if (tool === 'band-bottom') {
    return 'Set band bottom line';
  }
  return '';
}

export function renderViewerToolbar(elements, selectedViewerTool, laneBandMode = false) {
  const tools = [
    [elements.gelToolDividersBtn, 'dividers'],
    [elements.gelToolLadderLaneBtn, 'ladder'],
    [elements.gelToolLadderMwBtn, 'ladder-mw'],
    [elements.gelToolLaneVerticesBtn, 'lane-vertices'],
    [elements.gelToolBandTopBtn, 'band-top'],
    [elements.gelToolBandBottomBtn, 'band-bottom']
  ];
  for (const [button, tool] of tools) {
    button?.classList.toggle('is-active', selectedViewerTool === tool);
    button?.setAttribute?.('aria-pressed', String(selectedViewerTool === tool));
  }
  if (elements.gelFinishDividersBtn) {
    elements.gelFinishDividersBtn.hidden = selectedViewerTool !== 'dividers';
  }
  elements.gelCanvas?.classList.toggle('is-setting-dividers', selectedViewerTool === 'dividers');
  elements.gelCanvas?.classList.toggle('is-setting-ladder-mw', selectedViewerTool === 'ladder-mw');
  elements.gelLaneBandModeBtn?.classList.toggle('is-active', Boolean(laneBandMode));
  elements.gelLaneBandModeBtn?.setAttribute?.('aria-pressed', String(Boolean(laneBandMode)));
}
