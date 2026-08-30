// Mouse work on the board: dragging blocks, drawing a link from a port, and the
// marquee selection, including the window-level move/up handlers.
function createGraphPointerDrag({
  runtime,
  rootDocument,
  renderBlockList,
  rendering
} = {}) {
  const {
    getBlockById,
    clientToBoard,
    blockIntersectsRect,
    toggleSelected,
    updateSelectionOverlay,
    drawGraphLinks,
    setGraphStatus,
    hideContextMenu,
    renderGraphEditor
  } = rendering;

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

  return {
    resetInteractionState,
    onGraphCanvasMouseDown,
    onGraphNodesMouseDown,
    updateSelectionFromPointer,
    onWindowMouseMove,
    onWindowMouseUp,
    onGraphCanvasMouseMove
  };
}

export { createGraphPointerDrag };
