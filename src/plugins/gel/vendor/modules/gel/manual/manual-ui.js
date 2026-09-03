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
  const dividersSelected = selectedViewerTool === 'dividers';
  elements.gelToolDividersBtn?.classList.toggle('is-active', dividersSelected);
  elements.gelToolDividersBtn?.setAttribute?.('aria-pressed', String(dividersSelected));
  elements.gelToolLadderLaneBtn?.classList.toggle('is-active', selectedViewerTool === 'ladder');
  elements.gelToolLadderMwBtn?.classList.toggle('is-active', selectedViewerTool === 'ladder-mw');
  elements.gelToolLaneVerticesBtn?.classList.toggle('is-active', selectedViewerTool === 'lane-vertices');
  elements.gelToolBandTopBtn?.classList.toggle('is-active', selectedViewerTool === 'band-top');
  elements.gelToolBandBottomBtn?.classList.toggle('is-active', selectedViewerTool === 'band-bottom');
  elements.gelLaneBandModeBtn?.classList.toggle('is-active', Boolean(laneBandMode));
  elements.gelLaneBandModeBtn?.setAttribute?.('aria-pressed', String(Boolean(laneBandMode)));
}
