import {
  GRAPH_MIN_HEIGHT,
  GRAPH_MIN_WIDTH,
  GRAPH_PADDING,
  NODE_HEIGHT,
  NODE_PORT_Y,
  NODE_WIDTH
} from './constants.js';

export function createWorkflowGraphController(config = {}) {
  const runtime = config?.runtime || {};
  const elements = config?.elements || {};
  const safeText = typeof config?.safeText === 'function' ? config.safeText : String;
  const createId = typeof config?.createId === 'function'
    ? config.createId
    : (() => Math.random().toString(36).slice(2));
  const normalizeBlocks = config?.normalizeBlocks || ((blocks) => blocks || []);
  const normalizeLinks = config?.normalizeLinks || ((links) => links || []);
  const titleForBlock = config?.titleForBlock || (() => 'Block');
  const labelForBlockType = config?.labelForBlockType || (() => 'Block');
  const labelForAssignee = config?.labelForAssignee || (() => 'Unassigned');
  const displayLabelForBlock = config?.displayLabelForBlock || ((blockId) => blockId);
  const getBlockType = config?.getBlockType || (() => '');
  const renderBlockList = typeof config?.renderBlockList === 'function' ? config.renderBlockList : () => {};
  const rootDocument = config?.document || globalThis?.document || null;

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

  function setGraphStatus(message = '') {
    if (message) {
      elements.workflowGraphStatus.textContent = message;
      return;
    }
    if (!(runtime.draft?.blocks || []).length) {
      elements.workflowGraphStatus.textContent = 'Graph is empty. Add a block to start.';
      return;
    }
    if (runtime.activeLinkFromBlockId) {
      elements.workflowGraphStatus.textContent = `Connecting from ${displayLabelForBlock(runtime.activeLinkFromBlockId)}. Click an input dot on another block.`;
      return;
    }
    if (runtime.selectedBlockIds.size) {
      elements.workflowGraphStatus.textContent = `${runtime.selectedBlockIds.size} block(s) selected. Drag any selected block to move the group.`;
      return;
    }
    elements.workflowGraphStatus.textContent = 'Tip: Drag blocks. Output dot -> input dot to connect. Right-click for actions.';
  }

  function renderGraphNodes() {
    elements.workflowGraphNodes.innerHTML = (runtime.draft?.blocks || []).map((block, index) => {
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
          >&times;</button>
          <button type="button" class="workflow-port workflow-port-in" data-workflow-port-in="${safeText(block.id)}" title="Connect into this block" aria-label="Input port for ${safeText(title)}"></button>
          <button type="button" class="workflow-port workflow-port-out" data-workflow-port-out="${safeText(block.id)}" title="Connect out from this block" aria-label="Output port for ${safeText(title)}"></button>
          <header class="workflow-node-header" data-workflow-node-drag="${safeText(block.id)}">
            <span class="workflow-node-index">${safeText(index + 1)}</span>
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
    setGraphStatus();
  }

  function clearSelection({ render = true, status = '' } = {}) {
    runtime.selectedBlockIds = new Set();
    if (render) {
      renderGraphEditor();
      if (status) {
        setGraphStatus(status);
      }
    }
  }

  function removeBlocks(blockIds) {
    const ids = [...new Set((Array.isArray(blockIds) ? blockIds : []).map((value) => String(value || '').trim()).filter(Boolean))];
    if (!ids.length) {
      return;
    }

    const idSet = new Set(ids);
    runtime.draft.blocks = runtime.draft.blocks.filter((block) => !idSet.has(block.id));
    runtime.draft.links = runtime.draft.links.filter((link) => !idSet.has(link.fromBlockId) && !idSet.has(link.toBlockId));
    runtime.selectedBlockIds = new Set([...runtime.selectedBlockIds].filter((id) => !idSet.has(id)));
    if (runtime.activeLinkFromBlockId && idSet.has(runtime.activeLinkFromBlockId)) {
      runtime.activeLinkFromBlockId = '';
    }

    renderBlockList();
    renderGraphEditor();
    setGraphStatus(`${ids.length} block(s) deleted.`);
  }

  function disconnectBlocks(blockIds) {
    const ids = [...new Set((Array.isArray(blockIds) ? blockIds : []).map((value) => String(value || '').trim()).filter(Boolean))];
    if (!ids.length) {
      return;
    }

    const idSet = new Set(ids);
    runtime.draft.links = runtime.draft.links.filter((link) => !idSet.has(link.fromBlockId) && !idSet.has(link.toBlockId));
    renderBlockList();
    renderGraphEditor();
    setGraphStatus('Connections removed for selected block(s).');
  }

  function removeLinkById(linkId) {
    const normalizedId = String(linkId || '').trim();
    if (!normalizedId) {
      return;
    }
    runtime.draft.links = runtime.draft.links.filter((link) => link.id !== normalizedId);
    renderBlockList();
    renderGraphEditor();
    setGraphStatus('Connection removed.');
  }

  function resetInteractionState() {
    runtime.activeLinkFromBlockId = '';
    runtime.graphPointer = null;
    runtime.dragState = null;
    runtime.selectionState = null;
    runtime.selectedBlockIds = new Set();
    hideContextMenu();
    updateSelectionOverlay();
  }

  function onGraphCanvasMouseDown(event) {
    if (event.button !== 0) {
      return;
    }
    if (
      event.target.closest('.workflow-node')
      || event.target.closest('[data-workflow-link-id]')
      || event.target.closest('.workflow-context-menu')
    ) {
      return;
    }

    hideContextMenu();
    const point = clientToBoard(event.clientX, event.clientY);
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    runtime.selectionState = {
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
      moved: false,
      additive,
      baseSelection: new Set(runtime.selectedBlockIds)
    };

    if (!additive) {
      runtime.selectedBlockIds = new Set();
    }

    renderGraphEditor();
    event.preventDefault();
  }

  function onGraphNodesMouseDown(event) {
    if (event.button !== 0) {
      return;
    }

    const node = event.target.closest('[data-workflow-node]');
    if (!node) {
      return;
    }
    if (event.target.closest('.workflow-port') || event.target.closest('[data-workflow-block-remove]')) {
      return;
    }

    hideContextMenu();
    const blockId = node.dataset.workflowNode;
    const block = getBlockById(blockId);
    if (!block) {
      return;
    }

    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    if (additive) {
      toggleSelected(blockId);
      renderGraphEditor();
      renderBlockList();
      setGraphStatus();
      event.preventDefault();
      return;
    }

    if (!runtime.selectedBlockIds.has(blockId)) {
      runtime.selectedBlockIds = new Set([blockId]);
      renderGraphEditor();
      renderBlockList();
    }

    const pointer = clientToBoard(event.clientX, event.clientY);
    const dragIds = runtime.selectedBlockIds.size ? [...runtime.selectedBlockIds] : [blockId];
    const basePositions = new Map();
    dragIds.forEach((id) => {
      const dragBlock = getBlockById(id);
      if (!dragBlock) {
        return;
      }
      basePositions.set(id, {
        x: Number(dragBlock.x) || 0,
        y: Number(dragBlock.y) || 0
      });
    });

    runtime.dragState = {
      startX: pointer.x,
      startY: pointer.y,
      moved: false,
      blockIds: dragIds,
      basePositions
    };

    runtime.selectionState = null;
    updateSelectionOverlay();
    rootDocument?.body?.classList.add('workflow-dragging');
    event.preventDefault();
  }

  function updateSelectionFromPointer(pointer) {
    if (!runtime.selectionState) {
      return;
    }

    runtime.selectionState.currentX = pointer.x;
    runtime.selectionState.currentY = pointer.y;

    const dx = Math.abs(runtime.selectionState.currentX - runtime.selectionState.startX);
    const dy = Math.abs(runtime.selectionState.currentY - runtime.selectionState.startY);
    if (dx > 2 || dy > 2) {
      runtime.selectionState.moved = true;
    }

    const left = Math.min(runtime.selectionState.startX, runtime.selectionState.currentX);
    const right = Math.max(runtime.selectionState.startX, runtime.selectionState.currentX);
    const top = Math.min(runtime.selectionState.startY, runtime.selectionState.currentY);
    const bottom = Math.max(runtime.selectionState.startY, runtime.selectionState.currentY);
    const rect = { left, right, top, bottom };
    const hitIds = (runtime.draft?.blocks || [])
      .filter((block) => blockIntersectsRect(block, rect))
      .map((block) => block.id);

    if (runtime.selectionState.additive) {
      runtime.selectedBlockIds = new Set([...runtime.selectionState.baseSelection, ...hitIds]);
    } else {
      runtime.selectedBlockIds = new Set(hitIds);
    }
  }

  function onWindowMouseMove(event) {
    const pointer = clientToBoard(event.clientX, event.clientY);
    runtime.graphPointer = pointer;

    if (runtime.dragState) {
      const dx = pointer.x - runtime.dragState.startX;
      const dy = pointer.y - runtime.dragState.startY;

      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        runtime.dragState.moved = true;
      }

      runtime.dragState.blockIds.forEach((id) => {
        const block = getBlockById(id);
        const base = runtime.dragState.basePositions.get(id);
        if (!block || !base) {
          return;
        }

        block.x = Math.max(20, Math.round(base.x + dx));
        block.y = Math.max(20, Math.round(base.y + dy));
      });

      renderGraphEditor();
      return;
    }

    if (runtime.selectionState) {
      updateSelectionFromPointer(pointer);
      renderGraphEditor();
      return;
    }

    if (runtime.activeLinkFromBlockId) {
      drawGraphLinks();
    }
  }

  function onWindowMouseUp() {
    if (runtime.dragState) {
      const moved = runtime.dragState.moved;
      runtime.dragState = null;
      rootDocument?.body?.classList.remove('workflow-dragging');
      renderBlockList();
      renderGraphEditor();
      if (moved) {
        runtime.interactionSuppressUntil = Date.now() + 140;
      }
      return;
    }

    if (runtime.selectionState) {
      const moved = runtime.selectionState.moved;
      runtime.selectionState = null;
      updateSelectionOverlay();
      renderGraphEditor();
      renderBlockList();
      if (moved) {
        runtime.interactionSuppressUntil = Date.now() + 140;
      }
    }
  }

  function onGraphCanvasMouseMove(event) {
    if (runtime.dragState || runtime.selectionState) {
      return;
    }

    runtime.graphPointer = clientToBoard(event.clientX, event.clientY);
    if (runtime.activeLinkFromBlockId) {
      drawGraphLinks();
    }
  }

  function onGraphCanvasMouseLeave() {
    runtime.graphPointer = null;
    if (runtime.activeLinkFromBlockId) {
      drawGraphLinks();
    }
  }

  function onGraphCanvasClick(event) {
    if (Date.now() < runtime.interactionSuppressUntil) {
      return;
    }
    if (
      event.target.closest('.workflow-node')
      || event.target.closest('[data-workflow-link-id]')
      || event.target.closest('.workflow-context-menu')
    ) {
      return;
    }

    hideContextMenu();
    if (runtime.activeLinkFromBlockId) {
      runtime.activeLinkFromBlockId = '';
      drawGraphLinks();
      setGraphStatus('Connection mode canceled.');
      return;
    }
    if (runtime.selectedBlockIds.size) {
      clearSelection({ render: true, status: 'Selection cleared.' });
    }
  }

  function onGraphNodesClick(event) {
    if (Date.now() < runtime.interactionSuppressUntil) {
      return;
    }

    const removeBtn = event.target.closest('[data-workflow-block-remove]');
    if (removeBtn) {
      removeBlocks([removeBtn.dataset.workflowBlockRemove]);
      event.stopPropagation();
      return;
    }

    const outPortBtn = event.target.closest('[data-workflow-port-out]');
    if (outPortBtn) {
      const blockId = outPortBtn.dataset.workflowPortOut;
      runtime.activeLinkFromBlockId = runtime.activeLinkFromBlockId === blockId ? '' : blockId;
      drawGraphLinks();
      setGraphStatus();
      event.stopPropagation();
      return;
    }

    const inPortBtn = event.target.closest('[data-workflow-port-in]');
    if (inPortBtn) {
      const targetBlockId = inPortBtn.dataset.workflowPortIn;
      if (!runtime.activeLinkFromBlockId) {
        setGraphStatus('Select an output dot first, then click this input dot.');
        event.stopPropagation();
        return;
      }
      if (runtime.activeLinkFromBlockId === targetBlockId) {
        setGraphStatus('Cannot connect a block to itself.');
        event.stopPropagation();
        return;
      }

      const hasDuplicate = (runtime.draft?.links || []).some(
        (link) => link.fromBlockId === runtime.activeLinkFromBlockId && link.toBlockId === targetBlockId
      );
      if (hasDuplicate) {
        setGraphStatus('This connection already exists.');
        event.stopPropagation();
        return;
      }

      runtime.draft.links.push({
        id: createId(),
        fromBlockId: runtime.activeLinkFromBlockId,
        toBlockId: targetBlockId
      });
      runtime.draft.links = normalizeLinks(runtime.draft.links, runtime.draft.blocks);
      runtime.activeLinkFromBlockId = '';
      runtime.graphPointer = null;
      renderBlockList();
      renderGraphEditor();
      setGraphStatus('Connection created.');
      event.stopPropagation();
      return;
    }

    const nodeEl = event.target.closest('[data-workflow-node]');
    if (!nodeEl) {
      return;
    }

    const blockId = nodeEl.dataset.workflowNode;
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    if (additive) {
      toggleSelected(blockId);
    } else {
      setSelectedOnly(blockId);
    }

    renderGraphEditor();
    renderBlockList();
    event.stopPropagation();
  }

  function onGraphSvgClick(event) {
    if (Date.now() < runtime.interactionSuppressUntil) {
      return;
    }

    const linkPath = event.target.closest('[data-workflow-link-id]');
    if (!linkPath) {
      return;
    }

    removeLinkById(linkPath.dataset.workflowLinkId);
    event.stopPropagation();
  }

  function onGraphContextMenu(event) {
    event.preventDefault();

    const linkPath = event.target.closest('[data-workflow-link-id]');
    const nodeEl = event.target.closest('[data-workflow-node]');

    if (linkPath) {
      showContextMenu(event, [
        { action: 'remove-link', label: 'Delete Connection' }
      ], {
        type: 'link',
        linkId: linkPath.dataset.workflowLinkId
      });
      return;
    }

    if (nodeEl) {
      const blockId = nodeEl.dataset.workflowNode;
      if (!runtime.selectedBlockIds.has(blockId)) {
        setSelectedOnly(blockId);
      }
      renderGraphEditor();
      renderBlockList();

      const selectedCount = runtime.selectedBlockIds.size || 1;
      showContextMenu(event, [
        { action: 'delete-selected', label: selectedCount > 1 ? `Delete ${selectedCount} Blocks` : 'Delete Block' },
        { action: 'disconnect-selected', label: selectedCount > 1 ? `Disconnect ${selectedCount} Blocks` : 'Disconnect Block' },
        { action: 'clear-selection', label: 'Clear Selection' }
      ], {
        type: 'block',
        blockId
      });
      return;
    }

    const items = [];
    if (runtime.activeLinkFromBlockId) {
      items.push({ action: 'cancel-link', label: 'Cancel Connection Mode' });
    }
    if (runtime.selectedBlockIds.size) {
      items.push({ action: 'clear-selection', label: `Clear Selection (${runtime.selectedBlockIds.size})` });
    }
    if (!items.length) {
      items.push({ action: 'noop', label: 'No actions available' });
    }

    showContextMenu(event, items, { type: 'canvas' });
  }

  function onContextMenuClick(event) {
    const button = event.target.closest('[data-workflow-menu-action]');
    if (!button) {
      return;
    }

    const action = button.dataset.workflowMenuAction;
    if (!action) {
      hideContextMenu();
      return;
    }

    if (action === 'remove-link') {
      removeLinkById(runtime.contextMenuState?.linkId || '');
      hideContextMenu();
      return;
    }

    if (action === 'delete-selected') {
      const ids = runtime.selectedBlockIds.size ? [...runtime.selectedBlockIds] : [runtime.contextMenuState?.blockId || ''];
      removeBlocks(ids);
      hideContextMenu();
      return;
    }

    if (action === 'disconnect-selected') {
      const ids = runtime.selectedBlockIds.size ? [...runtime.selectedBlockIds] : [runtime.contextMenuState?.blockId || ''];
      disconnectBlocks(ids);
      hideContextMenu();
      return;
    }

    if (action === 'clear-selection') {
      clearSelection({ render: true, status: 'Selection cleared.' });
      hideContextMenu();
      return;
    }

    if (action === 'cancel-link') {
      runtime.activeLinkFromBlockId = '';
      runtime.graphPointer = null;
      drawGraphLinks();
      setGraphStatus('Connection mode canceled.');
      hideContextMenu();
      return;
    }

    hideContextMenu();
  }

  function onWindowClick(event) {
    if (elements.workflowGraphContextMenu.hidden) {
      return;
    }
    if (event.target.closest('#workflow-graph-context-menu')) {
      return;
    }
    hideContextMenu();
  }

  function onWindowKeyDown(event) {
    if (event.key !== 'Escape') {
      return;
    }

    hideContextMenu();
    if (runtime.activeLinkFromBlockId) {
      runtime.activeLinkFromBlockId = '';
      runtime.graphPointer = null;
      drawGraphLinks();
      setGraphStatus('Connection mode canceled.');
      return;
    }

    if (runtime.selectedBlockIds.size) {
      clearSelection({ render: true, status: 'Selection cleared.' });
    }
  }

  function bindEvents() {
    elements.workflowGraphCanvas.addEventListener('mousedown', onGraphCanvasMouseDown);
    elements.workflowGraphNodes.addEventListener('mousedown', onGraphNodesMouseDown);
    elements.workflowGraphNodes.addEventListener('click', onGraphNodesClick);
    elements.workflowGraphSvg.addEventListener('click', onGraphSvgClick);
    elements.workflowGraphCanvas.addEventListener('mousemove', onGraphCanvasMouseMove);
    elements.workflowGraphCanvas.addEventListener('mouseleave', onGraphCanvasMouseLeave);
    elements.workflowGraphCanvas.addEventListener('click', onGraphCanvasClick);
    elements.workflowGraphCanvas.addEventListener('contextmenu', onGraphContextMenu);
    elements.workflowGraphContextMenu.addEventListener('click', onContextMenuClick);

    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);
    window.addEventListener('click', onWindowClick);
    window.addEventListener('keydown', onWindowKeyDown);
    window.addEventListener('resize', hideContextMenu);
  }

  return {
    bindEvents,
    clearSelection,
    disconnectBlocks,
    hideContextMenu,
    pruneSelectedBlockIds,
    removeBlocks,
    removeLinkById,
    renderGraphEditor,
    resetInteractionState,
    setGraphStatus,
    setSelectedOnly,
    toggleSelected,
    updateSelectionOverlay
  };
}
