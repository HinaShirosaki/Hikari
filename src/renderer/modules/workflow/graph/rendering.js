import {
  GRAPH_MIN_HEIGHT,
  GRAPH_MIN_WIDTH,
  GRAPH_PADDING,
  NODE_HEIGHT,
  NODE_PORT_Y,
  NODE_WIDTH
} from '../constants.js';

// Board geometry and drawing: block/port coordinates, the link curves, node
// markup, the marquee overlay, and the context-menu surface.
function createGraphRendering({
  runtime,
  elements,
  safeText,
  normalizeBlocks,
  normalizeLinks,
  titleForBlock,
  getBlockType
} = {}) {
  function getBlockById(blockId) {
    return (runtime.draft?.blocks || []).find((block) => block.id === blockId) || null;
  }

  function clientToBoard(clientX, clientY) {
    const rect = elements.workflowGraphBoard.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  function blockIntersectsRect(block, rect) {
    const x1 = Number(block.x) || 0;
    const y1 = Number(block.y) || 0;
    const x2 = x1 + NODE_WIDTH;
    const y2 = y1 + NODE_HEIGHT;
    return !(x2 < rect.left || x1 > rect.right || y2 < rect.top || y1 > rect.bottom);
  }

  function getPortPoint(blockId, side) {
    const block = getBlockById(blockId);
    if (!block) {
      return null;
    }
    const x = Number(block.x) || 0;
    const y = Number(block.y) || 0;
    return {
      x: side === 'out' ? x + NODE_WIDTH : x,
      y: y + NODE_PORT_Y
    };
  }

  function buildCurvePath(from, to) {
    const deltaX = Math.abs(to.x - from.x);
    const curve = Math.max(50, Math.round(deltaX * 0.45));
    const c1x = from.x + curve;
    const c2x = to.x - curve;
    return `M ${from.x} ${from.y} C ${c1x} ${from.y}, ${c2x} ${to.y}, ${to.x} ${to.y}`;
  }

  function updateGraphBoardSize() {
    const blocks = runtime.draft?.blocks || [];
    const maxX = blocks.reduce((max, block) => Math.max(max, Number(block.x) || 0), 0);
    const maxY = blocks.reduce((max, block) => Math.max(max, Number(block.y) || 0), 0);
    const canvasViewportWidth = Math.max(0, Math.floor(elements.workflowGraphCanvas.clientWidth || 0));

    runtime.graphWidth = Math.max(GRAPH_MIN_WIDTH, canvasViewportWidth, maxX + NODE_WIDTH + GRAPH_PADDING);
    runtime.graphHeight = Math.max(GRAPH_MIN_HEIGHT, maxY + NODE_HEIGHT + GRAPH_PADDING);

    elements.workflowGraphBoard.style.width = `${runtime.graphWidth}px`;
    elements.workflowGraphBoard.style.height = `${runtime.graphHeight}px`;
    elements.workflowGraphSvg.setAttribute('width', String(runtime.graphWidth));
    elements.workflowGraphSvg.setAttribute('height', String(runtime.graphHeight));
    elements.workflowGraphSvg.setAttribute('viewBox', `0 0 ${runtime.graphWidth} ${runtime.graphHeight}`);
    elements.workflowGraphSvg.setAttribute('preserveAspectRatio', 'none');
  }

  function pruneSelectedBlockIds() {
    const validIds = new Set((runtime.draft?.blocks || []).map((block) => block.id));
    runtime.selectedBlockIds = new Set([...runtime.selectedBlockIds].filter((id) => validIds.has(id)));
  }

  function setSelectedOnly(blockId) {
    if (!blockId) {
      runtime.selectedBlockIds = new Set();
      return;
    }
    runtime.selectedBlockIds = new Set([blockId]);
  }

  function toggleSelected(blockId) {
    if (!blockId) {
      return;
    }
    if (runtime.selectedBlockIds.has(blockId)) {
      runtime.selectedBlockIds.delete(blockId);
      return;
    }
    runtime.selectedBlockIds.add(blockId);
  }

  function updateSelectionOverlay() {
    if (!runtime.selectionState) {
      elements.workflowGraphSelection.hidden = true;
      elements.workflowGraphSelection.style.width = '0px';
      elements.workflowGraphSelection.style.height = '0px';
      return;
    }

    const left = Math.min(runtime.selectionState.startX, runtime.selectionState.currentX);
    const top = Math.min(runtime.selectionState.startY, runtime.selectionState.currentY);
    const width = Math.abs(runtime.selectionState.currentX - runtime.selectionState.startX);
    const height = Math.abs(runtime.selectionState.currentY - runtime.selectionState.startY);

    elements.workflowGraphSelection.hidden = false;
    elements.workflowGraphSelection.style.left = `${left}px`;
    elements.workflowGraphSelection.style.top = `${top}px`;
    elements.workflowGraphSelection.style.width = `${Math.max(1, width)}px`;
    elements.workflowGraphSelection.style.height = `${Math.max(1, height)}px`;
  }

  function drawGraphLinks() {
    const paths = [];

    (runtime.draft?.links || []).forEach((link) => {
      const from = getPortPoint(link.fromBlockId, 'out');
      const to = getPortPoint(link.toBlockId, 'in');
      if (!from || !to) {
        return;
      }
      const path = buildCurvePath(from, to);
      paths.push(`<path class="workflow-graph-link" d="${path}" data-workflow-link-id="${safeText(link.id)}" />`);
    });

    if (runtime.activeLinkFromBlockId && runtime.graphPointer) {
      const from = getPortPoint(runtime.activeLinkFromBlockId, 'out');
      if (from) {
        const preview = buildCurvePath(from, runtime.graphPointer);
        paths.push(`<path class="workflow-graph-link workflow-graph-link-preview" d="${preview}" />`);
      }
    }

    elements.workflowGraphSvg.innerHTML = paths.join('');
  }

  function renderGraphNodes() {
    elements.workflowGraphNodes.innerHTML = (runtime.draft?.blocks || []).map((block) => {
      const isTextBlock = getBlockType(block) === 'text';
      const connectingClass = runtime.activeLinkFromBlockId === block.id ? ' workflow-node-connecting' : '';
      const selectedClass = runtime.selectedBlockIds.has(block.id) ? ' workflow-node-selected' : '';
      const typeClass = isTextBlock ? ' workflow-node-text' : '';
      const title = isTextBlock ? 'Text Block' : titleForBlock(block);
      return `
        <article class="workflow-node${typeClass}${connectingClass}${selectedClass}" data-workflow-node="${safeText(block.id)}" style="left:${safeText(block.x)}px; top:${safeText(block.y)}px;">
          <button
            type="button"
            class="workflow-node-remove"
            data-workflow-block-remove="${safeText(block.id)}"
            aria-label="Delete ${safeText(title)}"
            title="Delete block"
          ><svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
          <button type="button" class="workflow-port workflow-port-in" data-workflow-port-in="${safeText(block.id)}" title="Connect into this block" aria-label="Input port for ${safeText(title)}"></button>
          <button type="button" class="workflow-port workflow-port-out" data-workflow-port-out="${safeText(block.id)}" title="Connect out from this block" aria-label="Output port for ${safeText(title)}"></button>
          <header class="workflow-node-header" data-workflow-node-drag="${safeText(block.id)}">
            <strong>${safeText(title)}</strong>
          </header>
        </article>
      `;
    }).join('');
  }

  function hideContextMenu() {
    runtime.contextMenuState = null;
    elements.workflowGraphContextMenu.hidden = true;
    elements.workflowGraphContextMenu.innerHTML = '';
  }

  function showContextMenu(event, items, payload) {
    if (!Array.isArray(items) || !items.length) {
      hideContextMenu();
      return;
    }

    runtime.contextMenuState = payload || null;
    elements.workflowGraphContextMenu.innerHTML = items.map((item) => (
      `<button type="button" class="workflow-context-item" data-workflow-menu-action="${safeText(item.action)}">${safeText(item.label)}</button>`
    )).join('');

    elements.workflowGraphContextMenu.hidden = false;
    elements.workflowGraphContextMenu.style.left = `${event.clientX}px`;
    elements.workflowGraphContextMenu.style.top = `${event.clientY}px`;

    const rect = elements.workflowGraphContextMenu.getBoundingClientRect();
    const left = Math.max(8, Math.min(event.clientX, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(event.clientY, window.innerHeight - rect.height - 8));
    elements.workflowGraphContextMenu.style.left = `${left}px`;
    elements.workflowGraphContextMenu.style.top = `${top}px`;
  }

  function renderGraphEditor() {
    runtime.draft.blocks = normalizeBlocks(runtime.draft.blocks);
    runtime.draft.links = normalizeLinks(runtime.draft.links, runtime.draft.blocks);

    pruneSelectedBlockIds();
    if (runtime.activeLinkFromBlockId && !runtime.draft.blocks.some((block) => block.id === runtime.activeLinkFromBlockId)) {
      runtime.activeLinkFromBlockId = '';
    }

    updateGraphBoardSize();
    renderGraphNodes();
    drawGraphLinks();
    updateSelectionOverlay();
  }

  return {
    getBlockById,
    clientToBoard,
    blockIntersectsRect,
    getPortPoint,
    buildCurvePath,
    updateGraphBoardSize,
    pruneSelectedBlockIds,
    setSelectedOnly,
    toggleSelected,
    updateSelectionOverlay,
    drawGraphLinks,
    renderGraphNodes,
    hideContextMenu,
    showContextMenu,
    renderGraphEditor
  };
}

export { createGraphRendering };
