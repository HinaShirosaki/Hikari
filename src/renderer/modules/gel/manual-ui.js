export function getViewerToolLabel(tool = '') {
  if (tool === 'left') {
    return 'Set left border';
  }
  if (tool === 'right') {
    return 'Set right border';
  }
  if (tool === 'dividers') {
    return 'Set dividers';
  }
  if (tool === 'ladder') {
    return 'Set ladder lane';
  }
  return '';
}

export function renderViewerToolbar(elements, selectedViewerTool, laneBandMode = false) {
  elements.gelToolLeftBorderBtn?.classList.toggle('is-active', selectedViewerTool === 'left');
  elements.gelToolRightBorderBtn?.classList.toggle('is-active', selectedViewerTool === 'right');
  elements.gelToolDividersBtn?.classList.toggle('is-active', selectedViewerTool === 'dividers');
  elements.gelToolLadderLaneBtn?.classList.toggle('is-active', selectedViewerTool === 'ladder');
  elements.gelLaneBandModeBtn?.classList.toggle('is-active', Boolean(laneBandMode));
  elements.gelLaneBandModeBtn?.setAttribute?.('aria-pressed', String(Boolean(laneBandMode)));
}

export function updateStepClass(element, state) {
  if (!element) {
    return;
  }
  element.classList.toggle('is-active', state === 'active');
  element.classList.toggle('is-done', state === 'done');
}
