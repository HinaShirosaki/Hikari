// The floating tool box can be dragged anywhere over the notebook layout and
// stays anchored there across folds and resizes; this owns that geometry.
function createToolboxDrag({
  layout,
  sidebar,
  collapseBtn,
  foldToggle,
  toolboxAnchor,
  toolboxDragState,
  TOOLBOX_DRAG_THRESHOLD_PX,
  TOOLBOX_FOLDED_SIZE_PX,
  setSuppressFoldToggleClick
} = {}) {
  function toolboxRect(element) {
    return typeof element?.getBoundingClientRect === 'function'
      ? element.getBoundingClientRect()
      : null;
  }

  function clampToolboxPosition(left, top, layoutRect, sidebarRect) {
    const layoutWidth = Number(layoutRect?.width) || Math.max(0, Number(layoutRect?.right) - Number(layoutRect?.left));
    const layoutHeight = Number(layoutRect?.height) || Math.max(0, Number(layoutRect?.bottom) - Number(layoutRect?.top));
    const sidebarWidth = Number(sidebarRect?.width) || Math.max(0, Number(sidebarRect?.right) - Number(sidebarRect?.left));
    const sidebarHeight = Number(sidebarRect?.height) || Math.max(0, Number(sidebarRect?.bottom) - Number(sidebarRect?.top));
    return {
      left: Math.min(Math.max(0, left), Math.max(0, layoutWidth - sidebarWidth)),
      top: Math.min(Math.max(0, top), Math.max(0, layoutHeight - sidebarHeight))
    };
  }

  function applyToolboxPosition(left, top, layoutRect, sidebarRect, { markMoved = true } = {}) {
    if (!sidebar?.style) {
      return;
    }
    const position = clampToolboxPosition(left, top, layoutRect, sidebarRect);
    sidebar.style.left = `${Math.round(position.left)}px`;
    sidebar.style.top = `${Math.round(position.top)}px`;
    sidebar.style.right = 'auto';
    sidebar.style.bottom = 'auto';
    if (markMoved && sidebar.dataset) {
      sidebar.dataset.notebookToolboxMoved = 'true';
    }
    return position;
  }

  function foldedToolboxRect() {
    return {
      width: TOOLBOX_FOLDED_SIZE_PX,
      height: TOOLBOX_FOLDED_SIZE_PX,
      left: 0,
      top: 0,
      right: TOOLBOX_FOLDED_SIZE_PX,
      bottom: TOOLBOX_FOLDED_SIZE_PX
    };
  }

  function storeToolboxAnchor(position, layoutRect) {
    const layoutWidth = Number(layoutRect?.width) || Math.max(0, Number(layoutRect?.right) - Number(layoutRect?.left));
    const layoutHeight = Number(layoutRect?.height) || Math.max(0, Number(layoutRect?.bottom) - Number(layoutRect?.top));
    const clamped = clampToolboxPosition(position.left, position.top, layoutRect, foldedToolboxRect());
    const horizontalEdge = clamped.left + (TOOLBOX_FOLDED_SIZE_PX / 2) > layoutWidth / 2 ? 'right' : 'left';
    const verticalEdge = clamped.top + (TOOLBOX_FOLDED_SIZE_PX / 2) > layoutHeight / 2 ? 'bottom' : 'top';
    return {
      horizontalEdge,
      horizontalOffset: horizontalEdge === 'right'
        ? Math.max(0, layoutWidth - clamped.left - TOOLBOX_FOLDED_SIZE_PX)
        : clamped.left,
      verticalEdge,
      verticalOffset: verticalEdge === 'bottom'
        ? Math.max(0, layoutHeight - clamped.top - TOOLBOX_FOLDED_SIZE_PX)
        : clamped.top
    };
  }

  function resolveToolboxAnchor(anchor, layoutRect) {
    const layoutWidth = Number(layoutRect?.width) || Math.max(0, Number(layoutRect?.right) - Number(layoutRect?.left));
    const layoutHeight = Number(layoutRect?.height) || Math.max(0, Number(layoutRect?.bottom) - Number(layoutRect?.top));
    const left = anchor?.horizontalEdge === 'right'
      ? layoutWidth - TOOLBOX_FOLDED_SIZE_PX - Number(anchor?.horizontalOffset || 0)
      : Number(anchor?.horizontalOffset || 0);
    const top = anchor?.verticalEdge === 'bottom'
      ? layoutHeight - TOOLBOX_FOLDED_SIZE_PX - Number(anchor?.verticalOffset || 0)
      : Number(anchor?.verticalOffset || 0);
    return clampToolboxPosition(left, top, layoutRect, foldedToolboxRect());
  }

  function currentToolboxAnchor(layoutRect, sidebarRect) {
    const currentLeft = Number.parseFloat(sidebar?.style?.left);
    const currentTop = Number.parseFloat(sidebar?.style?.top);
    const left = Number.isFinite(currentLeft)
      ? currentLeft
      : Number(sidebarRect?.left) - Number(layoutRect?.left);
    const top = Number.isFinite(currentTop)
      ? currentTop
      : Number(sidebarRect?.top) - Number(layoutRect?.top);
    return storeToolboxAnchor({ left, top }, layoutRect);
  }

  function positionExpandedToolbox(anchor, layoutRect, sidebarRect) {
    const layoutWidth = Number(layoutRect?.width) || Math.max(0, Number(layoutRect?.right) - Number(layoutRect?.left));
    const layoutHeight = Number(layoutRect?.height) || Math.max(0, Number(layoutRect?.bottom) - Number(layoutRect?.top));
    const sidebarWidth = Number(sidebarRect?.width) || 132;
    const sidebarHeight = Number(sidebarRect?.height) || 132;
    const spaceRight = layoutWidth - anchor.left;
    const spaceLeft = anchor.left + TOOLBOX_FOLDED_SIZE_PX;
    const spaceDown = layoutHeight - anchor.top;
    const spaceUp = anchor.top + TOOLBOX_FOLDED_SIZE_PX;
    const expandX = spaceRight >= sidebarWidth || spaceRight >= spaceLeft ? 'right' : 'left';
    const expandY = spaceDown >= sidebarHeight || spaceDown >= spaceUp ? 'down' : 'up';
    const left = expandX === 'right'
      ? anchor.left
      : anchor.left + TOOLBOX_FOLDED_SIZE_PX - sidebarWidth;
    const top = expandY === 'down'
      ? anchor.top
      : anchor.top + TOOLBOX_FOLDED_SIZE_PX - sidebarHeight;
    if (sidebar?.dataset) {
      sidebar.dataset.toolboxExpandX = expandX;
      sidebar.dataset.toolboxExpandY = expandY;
    }
    applyToolboxPosition(left, top, layoutRect, sidebarRect, { markMoved: false });
  }

  function positionFoldedToolbox(anchor, layoutRect) {
    const position = resolveToolboxAnchor(anchor, layoutRect);
    applyToolboxPosition(
      position.left,
      position.top,
      layoutRect,
      foldedToolboxRect(),
      { markMoved: false }
    );
  }

  function constrainToolboxPosition() {
    if (!toolboxAnchor && sidebar?.dataset?.notebookToolboxMoved !== 'true') {
      return;
    }
    const layoutRect = toolboxRect(layout);
    const sidebarRect = toolboxRect(sidebar);
    if (!layoutRect || !sidebarRect) {
      return;
    }
    if (!toolboxAnchor) {
      toolboxAnchor = storeToolboxAnchor({
        left: Number.parseFloat(sidebar?.style?.left),
        top: Number.parseFloat(sidebar?.style?.top)
      }, layoutRect);
    }
    const anchorPosition = resolveToolboxAnchor(toolboxAnchor, layoutRect);
    if (layout?.classList?.contains?.('is-tool-sidebar-open')) {
      positionExpandedToolbox(anchorPosition, layoutRect, sidebarRect);
    } else {
      positionFoldedToolbox(toolboxAnchor, layoutRect);
    }
  }

  function beginToolboxDrag(event) {
    if (Number(event?.button) !== 0 || !Number.isFinite(Number(event?.clientX)) || !Number.isFinite(Number(event?.clientY))) {
      return;
    }
    const layoutRect = toolboxRect(layout);
    const sidebarRect = toolboxRect(sidebar);
    if (!layoutRect || !sidebarRect) {
      return;
    }
    setSuppressFoldToggleClick(false);
    toolboxDragState = {
      pointerId: event?.pointerId,
      startX: Number(event.clientX),
      startY: Number(event.clientY),
      startLeft: Number(sidebarRect.left) - Number(layoutRect.left),
      startTop: Number(sidebarRect.top) - Number(layoutRect.top),
      layoutRect,
      sidebarRect,
      moved: false
    };
    foldToggle?.setPointerCapture?.(event?.pointerId);
  }

  function moveToolbox(event) {
    if (!toolboxDragState || (toolboxDragState.pointerId != null && event?.pointerId !== toolboxDragState.pointerId)) {
      return;
    }
    const deltaX = Number(event?.clientX) - toolboxDragState.startX;
    const deltaY = Number(event?.clientY) - toolboxDragState.startY;
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
      return;
    }
    if (!toolboxDragState.moved && Math.hypot(deltaX, deltaY) < TOOLBOX_DRAG_THRESHOLD_PX) {
      return;
    }
    toolboxDragState.moved = true;
    setSuppressFoldToggleClick(true);
    sidebar?.classList?.add('is-dragging');
    event?.preventDefault?.();
    const position = applyToolboxPosition(
      toolboxDragState.startLeft + deltaX,
      toolboxDragState.startTop + deltaY,
      toolboxDragState.layoutRect,
      toolboxDragState.sidebarRect
    );
    toolboxAnchor = storeToolboxAnchor(position, toolboxDragState.layoutRect);
  }

  function endToolboxDrag(event) {
    if (!toolboxDragState || (toolboxDragState.pointerId != null && event?.pointerId !== toolboxDragState.pointerId)) {
      return;
    }
    foldToggle?.releasePointerCapture?.(toolboxDragState.pointerId);
    sidebar?.classList?.remove('is-dragging');
    toolboxDragState = null;
  }

  function setSidebarOpen(isOpen) {
    const layoutRect = toolboxRect(layout);
    const sidebarRect = toolboxRect(sidebar);
    if (isOpen && layoutRect && sidebarRect) {
      toolboxAnchor = currentToolboxAnchor(layoutRect, sidebarRect);
    }
    layout?.classList?.toggle('is-tool-sidebar-open', Boolean(isOpen));
    layout?.classList?.toggle('is-tool-sidebar-collapsed', !isOpen);
    collapseBtn?.setAttribute?.('aria-expanded', isOpen ? 'true' : 'false');
    foldToggle?.setAttribute?.('aria-expanded', isOpen ? 'true' : 'false');
    sidebar?.setAttribute?.('aria-expanded', isOpen ? 'true' : 'false');
    if (layoutRect && toolboxAnchor) {
      const nextSidebarRect = toolboxRect(sidebar) || sidebarRect;
      const anchorPosition = resolveToolboxAnchor(toolboxAnchor, layoutRect);
      if (isOpen) {
        positionExpandedToolbox(anchorPosition, layoutRect, nextSidebarRect);
      } else {
        positionFoldedToolbox(toolboxAnchor, layoutRect);
      }
    }
  }

  return {
    toolboxRect,
    clampToolboxPosition,
    applyToolboxPosition,
    foldedToolboxRect,
    storeToolboxAnchor,
    resolveToolboxAnchor,
    currentToolboxAnchor,
    positionExpandedToolbox,
    positionFoldedToolbox,
    constrainToolboxPosition,
    beginToolboxDrag,
    moveToolbox,
    endToolboxDrag,
    setSidebarOpen
  };
}

export { createToolboxDrag };
