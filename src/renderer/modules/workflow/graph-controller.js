import { createGraphRendering } from './graph/rendering.js';
import { createGraphPointerDrag } from './graph/pointer-drag.js';
import { showTransientNotice } from '../../lib/notify.js';

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
  const getBlockType = config?.getBlockType || (() => '');
  const renderBlockList = typeof config?.renderBlockList === 'function' ? config.renderBlockList : () => {};
  const rootDocument = config?.document || globalThis?.document || null;

  const rendering = createGraphRendering({
    runtime,
    elements,
    safeText,
    normalizeBlocks,
    normalizeLinks,
    titleForBlock,
    getBlockType
  });
  const {
    pruneSelectedBlockIds,
    setSelectedOnly,
    toggleSelected,
    updateSelectionOverlay,
    drawGraphLinks,
    hideContextMenu,
    showContextMenu,
    renderGraphEditor
  } = rendering;

  const {
    resetInteractionState,
    onGraphCanvasMouseDown,
    onGraphNodesMouseDown,
    onWindowMouseMove,
    onWindowMouseUp,
    onGraphCanvasMouseMove
  } = createGraphPointerDrag({
    runtime,
    rootDocument,
    renderBlockList,
    rendering
  });


  function clearSelection({ render = true } = {}) {
    runtime.selectedBlockIds = new Set();
    if (render) {
      renderGraphEditor();
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
  }

  function removeLinkById(linkId) {
    const normalizedId = String(linkId || '').trim();
    if (!normalizedId) {
      return;
    }
    runtime.draft.links = runtime.draft.links.filter((link) => link.id !== normalizedId);
    renderBlockList();
    renderGraphEditor();
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
      return;
    }
    if (runtime.selectedBlockIds.size) {
      clearSelection({ render: true });
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
      event.stopPropagation();
      return;
    }

    const inPortBtn = event.target.closest('[data-workflow-port-in]');
    if (inPortBtn) {
      const targetBlockId = inPortBtn.dataset.workflowPortIn;
      if (!runtime.activeLinkFromBlockId) {
        showTransientNotice('Select an output dot first, then click this input dot.', { type: 'error' });
        event.stopPropagation();
        return;
      }
      if (runtime.activeLinkFromBlockId === targetBlockId) {
        showTransientNotice('Cannot connect a block to itself.', { type: 'error' });
        event.stopPropagation();
        return;
      }

      const hasDuplicate = (runtime.draft?.links || []).some(
        (link) => link.fromBlockId === runtime.activeLinkFromBlockId && link.toBlockId === targetBlockId
      );
      if (hasDuplicate) {
        showTransientNotice('This connection already exists.', { type: 'error' });
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
      clearSelection({ render: true });
      hideContextMenu();
      return;
    }

    if (action === 'cancel-link') {
      runtime.activeLinkFromBlockId = '';
      runtime.graphPointer = null;
      drawGraphLinks();
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
      return;
    }

    if (runtime.selectedBlockIds.size) {
      clearSelection({ render: true });
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
    setSelectedOnly,
    toggleSelected,
    updateSelectionOverlay
  };
}
