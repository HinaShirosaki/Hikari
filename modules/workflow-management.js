export function initWorkflowManagement({
  state,
  persist,
  createId,
  safeText,
  onWorkflowsChanged = () => {}
}) {
  const NODE_WIDTH = 244;
  const NODE_HEIGHT = 104;
  const NODE_PORT_Y = 52;
  const GRAPH_MIN_WIDTH = 760;
  const GRAPH_MIN_HEIGHT = 360;
  const GRAPH_PADDING = 120;

  const workflowForm = document.getElementById('workflow-form');
  const workflowIdInput = document.getElementById('workflow-id');
  const workflowNameInput = document.getElementById('workflow-name');
  const workflowDescriptionInput = document.getElementById('workflow-description');
  const workflowProjectInput = document.getElementById('workflow-project');
  const workflowNotebookPagesInput = document.getElementById('workflow-notebook-pages');
  const workflowCancelBtn = document.getElementById('workflow-cancel-btn');
  const workflowBlockProtocolInput = document.getElementById('workflow-block-protocol');
  const workflowBlockAddBtn = document.getElementById('workflow-block-add-btn');
  const workflowBlockList = document.getElementById('workflow-block-list');
  const workflowGraphCanvas = document.getElementById('workflow-graph-canvas');
  const workflowGraphBoard = document.getElementById('workflow-graph-board');
  const workflowGraphSvg = document.getElementById('workflow-graph-svg');
  const workflowGraphSelection = document.getElementById('workflow-graph-selection');
  const workflowGraphNodes = document.getElementById('workflow-graph-nodes');
  const workflowGraphStatus = document.getElementById('workflow-graph-status');
  const workflowGraphContextMenu = document.getElementById('workflow-graph-context-menu');
  const workflowTemplateNameInput = document.getElementById('workflow-template-name');
  const workflowSaveTemplateBtn = document.getElementById('workflow-save-template-btn');
  const workflowTemplateSourceInput = document.getElementById('workflow-template-source');
  const workflowTemplateCreateNameInput = document.getElementById('workflow-template-create-name');
  const workflowTemplateCreateBtn = document.getElementById('workflow-template-create-btn');
  const workflowTemplateList = document.getElementById('workflow-template-list');
  const workflowList = document.getElementById('workflow-list');
  const workflowSubmitBtn = workflowForm?.querySelector('button[type="submit"]');

  if (
    !workflowForm
    || !workflowList
    || !workflowTemplateList
    || !workflowGraphCanvas
    || !workflowGraphBoard
    || !workflowGraphSvg
    || !workflowGraphSelection
    || !workflowGraphNodes
    || !workflowGraphStatus
    || !workflowGraphContextMenu
  ) {
    return {
      render: () => {},
      renderProjectOptions: () => {},
      renderNotebookOptions: () => {},
      renderProtocolOptions: () => {}
    };
  }

  let draft = createEmptyDraft();
  let activeLinkFromBlockId = '';
  let graphPointer = null;
  let dragState = null;
  let selectionState = null;
  let selectedBlockIds = new Set();
  let contextMenuState = null;
  let interactionSuppressUntil = 0;
  let graphWidth = GRAPH_MIN_WIDTH;
  let graphHeight = GRAPH_MIN_HEIGHT;

  workflowForm.addEventListener('submit', onWorkflowSubmit);
  workflowCancelBtn?.addEventListener('click', resetDraftToEmpty);
  workflowProjectInput?.addEventListener('change', onProjectChange);
  workflowBlockAddBtn?.addEventListener('click', onAddBlock);
  workflowBlockList?.addEventListener('click', onBlockListClick);
  workflowBlockList?.addEventListener('change', onBlockListChange);
  workflowGraphCanvas.addEventListener('mousedown', onGraphCanvasMouseDown);
  workflowGraphNodes.addEventListener('mousedown', onGraphNodesMouseDown);
  workflowGraphNodes.addEventListener('click', onGraphNodesClick);
  workflowGraphSvg.addEventListener('click', onGraphSvgClick);
  workflowGraphCanvas.addEventListener('mousemove', onGraphCanvasMouseMove);
  workflowGraphCanvas.addEventListener('mouseleave', onGraphCanvasMouseLeave);
  workflowGraphCanvas.addEventListener('click', onGraphCanvasClick);
  workflowGraphCanvas.addEventListener('contextmenu', onGraphContextMenu);
  workflowGraphContextMenu.addEventListener('click', onContextMenuClick);
  workflowList?.addEventListener('click', onWorkflowListClick);
  workflowSaveTemplateBtn?.addEventListener('click', onSaveTemplate);
  workflowTemplateCreateBtn?.addEventListener('click', onCreateFromTemplate);
  workflowTemplateList?.addEventListener('click', onTemplateListClick);

  window.addEventListener('mousemove', onWindowMouseMove);
  window.addEventListener('mouseup', onWindowMouseUp);
  window.addEventListener('click', onWindowClick);
  window.addEventListener('keydown', onWindowKeyDown);
  window.addEventListener('resize', hideContextMenu);

  function createEmptyDraft() {
    return {
      id: '',
      name: '',
      description: '',
      projectId: '',
      notebookEntryIds: [],
      blocks: [],
      links: [],
      createdAt: '',
      updatedAt: ''
    };
  }

  function normalizeIsoTimestamp(rawValue, fallback = '') {
    const candidate = String(rawValue || '').trim();
    if (!candidate) {
      return fallback;
    }
    const parsed = Date.parse(candidate);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return new Date(parsed).toISOString();
  }

  function parseTimestamp(rawValue) {
    const parsed = Date.parse(String(rawValue || '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatTimestamp(rawValue) {
    const parsed = parseTimestamp(rawValue);
    if (!parsed) {
      return '-';
    }
    return new Date(parsed).toLocaleString();
  }

  function uniqueStrings(values) {
    const seen = new Set();
    const out = [];
    (Array.isArray(values) ? values : []).forEach((value) => {
      const normalized = String(value || '').trim();
      if (!normalized || seen.has(normalized)) {
        return;
      }
      seen.add(normalized);
      out.push(normalized);
    });
    return out;
  }

  function resolveDefaultAssigneeId() {
    const personal = state.settings?.personalInfo || {};
    const personalEmail = String(personal.enanaEmail || '').trim().toLowerCase();
    if (personalEmail) {
      const byEmail = (state.members || []).find((member) => String(member.enanaEmail || '').trim().toLowerCase() === personalEmail);
      if (byEmail) {
        return String(byEmail.id || '').trim();
      }
    }

    const personalName = String(personal.name || '').trim().toLowerCase();
    if (personalName) {
      const byName = (state.members || []).find((member) => String(member.name || '').trim().toLowerCase() === personalName);
      if (byName) {
        return String(byName.id || '').trim();
      }
    }

    if ((state.members || []).length === 1) {
      return String(state.members[0].id || '').trim();
    }

    return '';
  }

  function suggestedBlockPosition(index) {
    const normalized = Number.isFinite(index) ? Math.max(0, index) : 0;
    const columns = 3;
    const col = normalized % columns;
    const row = Math.floor(normalized / columns);
    return {
      x: 44 + (col * 280),
      y: 36 + (row * 150)
    };
  }

  function normalizeBlocks(rawBlocks) {
    const seen = new Set();
    const blocks = [];
    const defaultAssigneeId = resolveDefaultAssigneeId();

    (Array.isArray(rawBlocks) ? rawBlocks : []).forEach((rawBlock) => {
      const protocolId = String(rawBlock?.protocolId || '').trim();
      if (!protocolId) {
        return;
      }

      let id = String(rawBlock?.id || '').trim();
      if (!id || seen.has(id)) {
        id = createId();
      }
      seen.add(id);

      const fallbackPosition = suggestedBlockPosition(blocks.length);
      const parsedX = Number(rawBlock?.x);
      const parsedY = Number(rawBlock?.y);

      blocks.push({
        id,
        protocolId,
        assigneeId: String(rawBlock?.assigneeId || defaultAssigneeId).trim(),
        x: Number.isFinite(parsedX) ? Math.max(20, Math.round(parsedX)) : fallbackPosition.x,
        y: Number.isFinite(parsedY) ? Math.max(20, Math.round(parsedY)) : fallbackPosition.y
      });
    });

    return blocks;
  }

  function normalizeLinks(rawLinks, blocks) {
    const validBlockIds = new Set((Array.isArray(blocks) ? blocks : []).map((block) => block.id));
    const seenPairs = new Set();
    const seenLinkIds = new Set();
    const links = [];

    (Array.isArray(rawLinks) ? rawLinks : []).forEach((rawLink) => {
      const fromBlockId = String(rawLink?.fromBlockId || '').trim();
      const toBlockId = String(rawLink?.toBlockId || '').trim();
      if (!fromBlockId || !toBlockId || fromBlockId === toBlockId) {
        return;
      }
      if (!validBlockIds.has(fromBlockId) || !validBlockIds.has(toBlockId)) {
        return;
      }

      const pairKey = `${fromBlockId}->${toBlockId}`;
      if (seenPairs.has(pairKey)) {
        return;
      }
      seenPairs.add(pairKey);

      let id = String(rawLink?.id || '').trim();
      if (!id || seenLinkIds.has(id)) {
        id = createId();
      }
      seenLinkIds.add(id);

      links.push({ id, fromBlockId, toBlockId });
    });

    return links;
  }

  function normalizeWorkflow(rawWorkflow) {
    const blocks = normalizeBlocks(rawWorkflow?.blocks);
    const links = normalizeLinks(rawWorkflow?.links, blocks);
    const createdAt = normalizeIsoTimestamp(rawWorkflow?.createdAt);
    const updatedAt = normalizeIsoTimestamp(rawWorkflow?.updatedAt, createdAt);
    return {
      id: String(rawWorkflow?.id || createId()),
      name: String(rawWorkflow?.name || '').trim(),
      description: String(rawWorkflow?.description || '').trim(),
      projectId: String(rawWorkflow?.projectId || '').trim(),
      notebookEntryIds: uniqueStrings(rawWorkflow?.notebookEntryIds),
      blocks,
      links,
      createdAt,
      updatedAt
    };
  }

  function normalizeTemplate(rawTemplate) {
    const blocks = normalizeBlocks(rawTemplate?.blocks);
    const links = normalizeLinks(rawTemplate?.links, blocks);
    const createdAt = normalizeIsoTimestamp(rawTemplate?.createdAt);
    const updatedAt = normalizeIsoTimestamp(rawTemplate?.updatedAt, createdAt);
    return {
      id: String(rawTemplate?.id || createId()),
      name: String(rawTemplate?.name || '').trim(),
      description: String(rawTemplate?.description || '').trim(),
      blocks,
      links,
      createdAt,
      updatedAt
    };
  }

  function ensureStateShape() {
    if (!Array.isArray(state.workflows)) {
      state.workflows = [];
    }
    if (!Array.isArray(state.workflowTemplates)) {
      state.workflowTemplates = [];
    }

    state.workflows = state.workflows.map((workflow) => normalizeWorkflow(workflow));
    state.workflowTemplates = state.workflowTemplates.map((template) => normalizeTemplate(template));
  }

  function cloneWorkflowIntoDraft(workflow) {
    const normalized = normalizeWorkflow(workflow);
    draft = {
      ...normalized,
      notebookEntryIds: [...normalized.notebookEntryIds],
      blocks: normalized.blocks.map((block) => ({ ...block })),
      links: normalized.links.map((link) => ({ ...link }))
    };

    activeLinkFromBlockId = '';
    graphPointer = null;
    dragState = null;
    selectionState = null;
    selectedBlockIds = new Set();
    hideContextMenu();
  }

  function resetDraftToEmpty() {
    draft = createEmptyDraft();
    activeLinkFromBlockId = '';
    graphPointer = null;
    dragState = null;
    selectionState = null;
    selectedBlockIds = new Set();
    hideContextMenu();
    updateSelectionOverlay();
    applyDraftToForm();
    renderWorkflowList();
  }

  function notifyWorkflowsChanged() {
    onWorkflowsChanged();
  }

  function getSelectedValues(select) {
    if (!select) {
      return [];
    }
    return Array.from(select.selectedOptions || []).map((option) => option.value);
  }

  function setSelectedValues(select, values) {
    if (!select) {
      return;
    }
    const selected = new Set(uniqueStrings(values));
    Array.from(select.options).forEach((option) => {
      option.selected = selected.has(option.value);
    });
  }

  function protocolNameById(protocolId) {
    const protocol = (state.protocols || []).find((item) => item.id === protocolId);
    return protocol?.name || `Missing protocol (${protocolId})`;
  }

  function memberNameById(memberId) {
    const member = (state.members || []).find((item) => item.id === memberId);
    return member?.name || '';
  }

  function assigneeLabelById(memberId) {
    const normalizedId = String(memberId || '').trim();
    if (!normalizedId) {
      return 'Unassigned';
    }
    return memberNameById(normalizedId) || `Missing member (${normalizedId})`;
  }

  function projectNameById(projectId) {
    const project = (state.projects || []).find((item) => item.id === projectId);
    return project?.name || `Missing project (${projectId})`;
  }

  function notebookEntryLabel(entry) {
    const notebookTypeLabel = entry.notebookType === 'biology' ? 'Biology' : 'Synthesis';
    const protocolLabel = String(entry.protocolName || entry.protocolId || 'Notebook Page').trim();
    return `${notebookTypeLabel} · ${protocolLabel} · ${formatTimestamp(entry.updatedAt)}`;
  }

  function buildAssigneeOptions(selectedAssigneeId = '') {
    const options = ['<option value="">Unassigned</option>'];
    (state.members || []).forEach((member) => {
      const selectedAttr = member.id === selectedAssigneeId ? ' selected' : '';
      options.push(`<option value="${safeText(member.id)}"${selectedAttr}>${safeText(member.name)}</option>`);
    });
    if (selectedAssigneeId && !(state.members || []).some((member) => member.id === selectedAssigneeId)) {
      options.push(`<option value="${safeText(selectedAssigneeId)}" selected>${safeText(`Missing member (${selectedAssigneeId})`)}</option>`);
    }
    return options.join('');
  }

  function renderProjectOptions() {
    const options = ['<option value="">Unlinked project</option>'];
    (state.projects || []).forEach((project) => {
      options.push(`<option value="${safeText(project.id)}">${safeText(project.name)}</option>`);
    });
    if (draft.projectId && !(state.projects || []).some((project) => project.id === draft.projectId)) {
      options.push(`<option value="${safeText(draft.projectId)}">${safeText(`Missing project (${draft.projectId})`)}</option>`);
    }
    workflowProjectInput.innerHTML = options.join('');
    workflowProjectInput.value = draft.projectId || '';
  }

  function renderNotebookOptions() {
    const projectId = workflowProjectInput.value;
    const selectedNotebookIds = uniqueStrings(draft.notebookEntryIds);
    const selectedSet = new Set(selectedNotebookIds);

    const entries = (state.notebookEntries || [])
      .filter((entry) => !projectId || entry.projectId === projectId)
      .sort((a, b) => parseTimestamp(b.updatedAt) - parseTimestamp(a.updatedAt));

    const options = [];
    entries.forEach((entry) => {
      options.push(`<option value="${safeText(entry.id)}">${safeText(notebookEntryLabel(entry))}</option>`);
    });

    selectedNotebookIds.forEach((entryId) => {
      if (entries.some((entry) => entry.id === entryId)) {
        return;
      }
      options.push(`<option value="${safeText(entryId)}">${safeText(`Missing notebook page (${entryId})`)}</option>`);
    });

    if (!options.length) {
      options.push('<option value="" disabled>No notebook pages available</option>');
    }

    workflowNotebookPagesInput.innerHTML = options.join('');
    Array.from(workflowNotebookPagesInput.options).forEach((option) => {
      option.selected = selectedSet.has(option.value);
    });
  }

  function renderProtocolOptions() {
    const selectedProtocolId = workflowBlockProtocolInput.value;
    const options = ['<option value="">Select protocol</option>'];
    (state.protocols || []).forEach((protocol) => {
      options.push(`<option value="${safeText(protocol.id)}">${safeText(protocol.name)}</option>`);
    });
    workflowBlockProtocolInput.innerHTML = options.join('');
    if (selectedProtocolId && (state.protocols || []).some((protocol) => protocol.id === selectedProtocolId)) {
      workflowBlockProtocolInput.value = selectedProtocolId;
    }
  }

  function buildDirectionMaps() {
    const upstream = new Map();
    const downstream = new Map();

    draft.blocks.forEach((block) => {
      upstream.set(block.id, []);
      downstream.set(block.id, []);
    });

    draft.links.forEach((link) => {
      const fromList = downstream.get(link.fromBlockId);
      const toList = upstream.get(link.toBlockId);
      if (fromList) {
        fromList.push(link.toBlockId);
      }
      if (toList) {
        toList.push(link.fromBlockId);
      }
    });

    return { upstream, downstream };
  }

  function blockDisplayLabel(blockId) {
    const block = draft.blocks.find((item) => item.id === blockId);
    if (!block) {
      return `Missing block (${blockId})`;
    }
    const index = draft.blocks.findIndex((item) => item.id === block.id);
    return `Block ${index + 1}: ${protocolNameById(block.protocolId)}`;
  }

  function getBlockById(blockId) {
    return draft.blocks.find((block) => block.id === blockId) || null;
  }

  function clientToBoard(clientX, clientY) {
    const rect = workflowGraphBoard.getBoundingClientRect();
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
    const maxX = draft.blocks.reduce((max, block) => Math.max(max, Number(block.x) || 0), 0);
    const maxY = draft.blocks.reduce((max, block) => Math.max(max, Number(block.y) || 0), 0);
    const canvasViewportWidth = Math.max(0, Math.floor(workflowGraphCanvas.clientWidth || 0));

    graphWidth = Math.max(GRAPH_MIN_WIDTH, canvasViewportWidth, maxX + NODE_WIDTH + GRAPH_PADDING);
    graphHeight = Math.max(GRAPH_MIN_HEIGHT, maxY + NODE_HEIGHT + GRAPH_PADDING);

    workflowGraphBoard.style.width = `${graphWidth}px`;
    workflowGraphBoard.style.height = `${graphHeight}px`;
    workflowGraphSvg.setAttribute('width', String(graphWidth));
    workflowGraphSvg.setAttribute('height', String(graphHeight));
    workflowGraphSvg.setAttribute('viewBox', `0 0 ${graphWidth} ${graphHeight}`);
    workflowGraphSvg.setAttribute('preserveAspectRatio', 'none');
  }

  function pruneSelectedBlockIds() {
    const validIds = new Set(draft.blocks.map((block) => block.id));
    selectedBlockIds = new Set([...selectedBlockIds].filter((id) => validIds.has(id)));
  }

  function setSelectedOnly(blockId) {
    if (!blockId) {
      selectedBlockIds = new Set();
      return;
    }
    selectedBlockIds = new Set([blockId]);
  }

  function toggleSelected(blockId) {
    if (!blockId) {
      return;
    }

    if (selectedBlockIds.has(blockId)) {
      selectedBlockIds.delete(blockId);
      return;
    }
    selectedBlockIds.add(blockId);
  }

  function clearSelection({ render = true, status = '' } = {}) {
    selectedBlockIds = new Set();
    if (render) {
      renderGraphEditor();
      if (status) {
        setGraphStatus(status);
      }
    }
  }

  function drawGraphLinks() {
    const paths = [];

    draft.links.forEach((link) => {
      const from = getPortPoint(link.fromBlockId, 'out');
      const to = getPortPoint(link.toBlockId, 'in');
      if (!from || !to) {
        return;
      }
      const path = buildCurvePath(from, to);
      paths.push(`<path class="workflow-graph-link" d="${path}" data-workflow-link-id="${safeText(link.id)}" />`);
    });

    if (activeLinkFromBlockId && graphPointer) {
      const from = getPortPoint(activeLinkFromBlockId, 'out');
      if (from) {
        const preview = buildCurvePath(from, graphPointer);
        paths.push(`<path class="workflow-graph-link workflow-graph-link-preview" d="${preview}" />`);
      }
    }

    workflowGraphSvg.innerHTML = paths.join('');
  }

  function setGraphStatus(message = '') {
    if (message) {
      workflowGraphStatus.textContent = message;
      return;
    }

    if (!draft.blocks.length) {
      workflowGraphStatus.textContent = 'Graph is empty. Add a block to start.';
      return;
    }

    if (activeLinkFromBlockId) {
      workflowGraphStatus.textContent = `Connecting from ${blockDisplayLabel(activeLinkFromBlockId)}. Click an input dot on another block.`;
      return;
    }

    if (selectedBlockIds.size) {
      workflowGraphStatus.textContent = `${selectedBlockIds.size} block(s) selected. Drag any selected block to move the group.`;
      return;
    }

    workflowGraphStatus.textContent = 'Tip: Drag blocks. Output dot -> input dot to connect. Right-click for actions.';
  }

  function renderGraphNodes() {
    workflowGraphNodes.innerHTML = draft.blocks.map((block, index) => {
      const connectingClass = activeLinkFromBlockId === block.id ? ' workflow-node-connecting' : '';
      const selectedClass = selectedBlockIds.has(block.id) ? ' workflow-node-selected' : '';
      const protocolName = protocolNameById(block.protocolId);
      const assigneeName = assigneeLabelById(block.assigneeId);
      return `
        <article class="workflow-node${connectingClass}${selectedClass}" data-workflow-node="${safeText(block.id)}" style="left:${safeText(block.x)}px; top:${safeText(block.y)}px;">
          <button type="button" class="workflow-port workflow-port-in" data-workflow-port-in="${safeText(block.id)}" title="Connect into this block" aria-label="Input port for ${safeText(protocolName)}"></button>
          <button type="button" class="workflow-port workflow-port-out" data-workflow-port-out="${safeText(block.id)}" title="Connect out from this block" aria-label="Output port for ${safeText(protocolName)}"></button>
          <header class="workflow-node-header" data-workflow-node-drag="${safeText(block.id)}">
            <span class="workflow-node-index">${safeText(index + 1)}</span>
            <strong>${safeText(protocolName)}</strong>
          </header>
          <div class="workflow-node-body">
            <p>${safeText(`Assignee: ${assigneeName}`)}</p>
            <button type="button" class="ghost-btn workflow-node-remove" data-workflow-block-remove="${safeText(block.id)}">Remove</button>
          </div>
        </article>
      `;
    }).join('');
  }

  function updateSelectionOverlay() {
    if (!selectionState) {
      workflowGraphSelection.hidden = true;
      workflowGraphSelection.style.width = '0px';
      workflowGraphSelection.style.height = '0px';
      return;
    }

    const left = Math.min(selectionState.startX, selectionState.currentX);
    const top = Math.min(selectionState.startY, selectionState.currentY);
    const width = Math.abs(selectionState.currentX - selectionState.startX);
    const height = Math.abs(selectionState.currentY - selectionState.startY);

    workflowGraphSelection.hidden = false;
    workflowGraphSelection.style.left = `${left}px`;
    workflowGraphSelection.style.top = `${top}px`;
    workflowGraphSelection.style.width = `${Math.max(1, width)}px`;
    workflowGraphSelection.style.height = `${Math.max(1, height)}px`;
  }

  function renderGraphEditor() {
    draft.blocks = normalizeBlocks(draft.blocks);
    draft.links = normalizeLinks(draft.links, draft.blocks);

    pruneSelectedBlockIds();
    if (activeLinkFromBlockId && !draft.blocks.some((block) => block.id === activeLinkFromBlockId)) {
      activeLinkFromBlockId = '';
    }

    updateGraphBoardSize();
    renderGraphNodes();
    drawGraphLinks();
    updateSelectionOverlay();
    setGraphStatus();
  }

  function renderBlockList() {
    draft.blocks = normalizeBlocks(draft.blocks);
    draft.links = normalizeLinks(draft.links, draft.blocks);
    const { upstream, downstream } = buildDirectionMaps();

    if (!draft.blocks.length) {
      workflowBlockList.innerHTML = '<p class="small-note">No blocks yet. Add a protocol block to start.</p>';
      return;
    }

    workflowBlockList.innerHTML = draft.blocks.map((block, index) => {
      const upstreamText = (upstream.get(block.id) || []).map((blockId) => blockDisplayLabel(blockId)).join(' | ') || '-';
      const downstreamText = (downstream.get(block.id) || []).map((blockId) => blockDisplayLabel(blockId)).join(' | ') || '-';
      return `
        <article class="list-row workflow-block-row">
          <div class="workflow-block-meta">
            <strong>${safeText(`Block ${index + 1}: ${protocolNameById(block.protocolId)}`)}</strong>
            <p class="small-note">Upstream: ${safeText(upstreamText)}</p>
            <p class="small-note">Downstream: ${safeText(downstreamText)}</p>
          </div>
          <div class="workflow-assignee-field">
            <span>Assignee</span>
            <select data-workflow-block-assignee="${safeText(block.id)}">${buildAssigneeOptions(block.assigneeId)}</select>
          </div>
          <div class="list-actions">
            <button type="button" class="danger-btn" data-workflow-block-remove="${safeText(block.id)}">Remove</button>
          </div>
        </article>
      `;
    }).join('');
  }

  function hideContextMenu() {
    contextMenuState = null;
    workflowGraphContextMenu.hidden = true;
    workflowGraphContextMenu.innerHTML = '';
  }

  function showContextMenu(event, items, payload) {
    if (!Array.isArray(items) || !items.length) {
      hideContextMenu();
      return;
    }

    contextMenuState = payload || null;
    workflowGraphContextMenu.innerHTML = items.map((item) => (
      `<button type="button" class="workflow-context-item" data-workflow-menu-action="${safeText(item.action)}">${safeText(item.label)}</button>`
    )).join('');

    workflowGraphContextMenu.hidden = false;
    workflowGraphContextMenu.style.left = `${event.clientX}px`;
    workflowGraphContextMenu.style.top = `${event.clientY}px`;

    const rect = workflowGraphContextMenu.getBoundingClientRect();
    const left = Math.max(8, Math.min(event.clientX, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(event.clientY, window.innerHeight - rect.height - 8));
    workflowGraphContextMenu.style.left = `${left}px`;
    workflowGraphContextMenu.style.top = `${top}px`;
  }

  function removeBlocks(blockIds) {
    const ids = uniqueStrings(blockIds);
    if (!ids.length) {
      return;
    }

    const idSet = new Set(ids);
    draft.blocks = draft.blocks.filter((block) => !idSet.has(block.id));
    draft.links = draft.links.filter((link) => !idSet.has(link.fromBlockId) && !idSet.has(link.toBlockId));
    selectedBlockIds = new Set([...selectedBlockIds].filter((id) => !idSet.has(id)));

    if (activeLinkFromBlockId && idSet.has(activeLinkFromBlockId)) {
      activeLinkFromBlockId = '';
    }

    renderBlockEditor();
    setGraphStatus(`${ids.length} block(s) deleted.`);
  }

  function disconnectBlocks(blockIds) {
    const ids = uniqueStrings(blockIds);
    if (!ids.length) {
      return;
    }

    const idSet = new Set(ids);
    draft.links = draft.links.filter((link) => !idSet.has(link.fromBlockId) && !idSet.has(link.toBlockId));
    renderBlockEditor();
    setGraphStatus('Connections removed for selected block(s).');
  }

  function removeLinkById(linkId) {
    const normalizedId = String(linkId || '').trim();
    if (!normalizedId) {
      return;
    }

    draft.links = draft.links.filter((link) => link.id !== normalizedId);
    renderBlockEditor();
    setGraphStatus('Connection removed.');
  }

  function renderTemplateSourceOptions() {
    const selected = workflowTemplateSourceInput.value;
    const options = ['<option value="">Select template</option>'];
    const templates = [...(state.workflowTemplates || [])]
      .sort((a, b) => parseTimestamp(b.updatedAt) - parseTimestamp(a.updatedAt));

    templates.forEach((template) => {
      options.push(`<option value="${safeText(template.id)}">${safeText(template.name || 'Untitled template')}</option>`);
    });

    workflowTemplateSourceInput.innerHTML = options.join('');
    if (selected && templates.some((template) => template.id === selected)) {
      workflowTemplateSourceInput.value = selected;
    }
  }

  function renderTemplateList() {
    const templates = [...(state.workflowTemplates || [])]
      .sort((a, b) => parseTimestamp(b.updatedAt) - parseTimestamp(a.updatedAt));

    if (!templates.length) {
      workflowTemplateList.innerHTML = '<p class="small-note">No workflow templates saved yet.</p>';
      return;
    }

    workflowTemplateList.innerHTML = templates.map((template) => `
      <article class="card workflow-card">
        <h3>${safeText(template.name || 'Untitled template')}</h3>
        <p>${safeText(template.description || 'No description')}</p>
        <p><strong>Blocks:</strong> ${safeText(template.blocks.length)} | <strong>Connections:</strong> ${safeText(template.links.length)}</p>
        <p><strong>Updated:</strong> ${safeText(formatTimestamp(template.updatedAt || template.createdAt))}</p>
        <div class="card-actions">
          <button type="button" class="ghost-btn" data-workflow-template-use="${safeText(template.id)}">Use</button>
          <button type="button" class="danger-btn" data-workflow-template-delete="${safeText(template.id)}">Delete</button>
        </div>
      </article>
    `).join('');
  }

  function renderWorkflowList() {
    const workflows = [...(state.workflows || [])]
      .sort((a, b) => parseTimestamp(b.updatedAt) - parseTimestamp(a.updatedAt));

    if (!workflows.length) {
      workflowList.innerHTML = '<p class="small-note">No workflows saved yet.</p>';
      return;
    }

    workflowList.innerHTML = workflows.map((workflow) => {
      const assigneeLabels = uniqueStrings(workflow.blocks.map((block) => block.assigneeId).filter(Boolean))
        .map((memberId) => assigneeLabelById(memberId))
        .join(', ') || 'Unassigned';
      const notebookLabels = workflow.notebookEntryIds
        .slice(0, 3)
        .map((entryId) => {
          const entry = (state.notebookEntries || []).find((item) => item.id === entryId);
          return entry ? notebookEntryLabel(entry) : `Missing notebook page (${entryId})`;
        });
      const moreNotebookCount = Math.max(0, workflow.notebookEntryIds.length - notebookLabels.length);
      const notebookSummary = notebookLabels.length
        ? `${notebookLabels.join(' | ')}${moreNotebookCount ? ` | +${moreNotebookCount} more` : ''}`
        : '-';

      return `
        <article class="card workflow-card${workflow.id === draft.id ? ' workflow-card-editing' : ''}">
          <h3>${safeText(workflow.name || 'Untitled workflow')}</h3>
          <p>${safeText(workflow.description || 'No description')}</p>
          <p><strong>Project:</strong> ${safeText(workflow.projectId ? projectNameById(workflow.projectId) : 'Unlinked')}</p>
          <p><strong>Notebook Pages:</strong> ${safeText(notebookSummary)}</p>
          <p><strong>Blocks:</strong> ${safeText(workflow.blocks.length)} | <strong>Connections:</strong> ${safeText(workflow.links.length)}</p>
          <p><strong>Assigned To:</strong> ${safeText(assigneeLabels)}</p>
          <p><strong>Updated:</strong> ${safeText(formatTimestamp(workflow.updatedAt || workflow.createdAt))}</p>
          <div class="card-actions">
            <button type="button" class="ghost-btn" data-workflow-edit="${safeText(workflow.id)}">Edit</button>
            <button type="button" class="danger-btn" data-workflow-delete="${safeText(workflow.id)}">Delete</button>
          </div>
        </article>
      `;
    }).join('');
  }

  function renderBlockEditor() {
    renderProtocolOptions();
    renderBlockList();
    renderGraphEditor();
  }

  function updateSubmitButtonLabel() {
    if (!workflowSubmitBtn) {
      return;
    }
    workflowSubmitBtn.textContent = draft.id ? 'Update Workflow' : 'Save Workflow';
  }

  function applyDraftToForm() {
    workflowIdInput.value = draft.id || '';
    workflowNameInput.value = draft.name || '';
    workflowDescriptionInput.value = draft.description || '';
    renderProjectOptions();
    renderNotebookOptions();
    setSelectedValues(workflowNotebookPagesInput, draft.notebookEntryIds);
    renderBlockEditor();
    updateSubmitButtonLabel();
  }

  function onProjectChange() {
    draft.projectId = workflowProjectInput.value;
    draft.notebookEntryIds = [];
    renderNotebookOptions();
  }

  function onWorkflowSubmit(event) {
    event.preventDefault();
    ensureStateShape();

    const name = workflowNameInput.value.trim();
    if (!name || !draft.blocks.length) {
      return;
    }

    const now = new Date().toISOString();
    const notebookEntryIds = uniqueStrings(getSelectedValues(workflowNotebookPagesInput));
    const existing = (state.workflows || []).find((workflow) => workflow.id === workflowIdInput.value);

    const workflowRecord = normalizeWorkflow({
      ...draft,
      id: workflowIdInput.value || draft.id || createId(),
      name,
      description: workflowDescriptionInput.value.trim(),
      projectId: workflowProjectInput.value,
      notebookEntryIds,
      createdAt: existing?.createdAt || draft.createdAt || now,
      updatedAt: now
    });

    const index = state.workflows.findIndex((workflow) => workflow.id === workflowRecord.id);
    if (index >= 0) {
      state.workflows[index] = workflowRecord;
    } else {
      state.workflows.push(workflowRecord);
    }

    persist();
    notifyWorkflowsChanged();
    resetDraftToEmpty();
    renderTemplateSourceOptions();
    renderTemplateList();
    renderWorkflowList();
  }

  function onAddBlock() {
    const protocolId = String(workflowBlockProtocolInput.value || '').trim();
    if (!protocolId) {
      return;
    }

    hideContextMenu();

    const position = suggestedBlockPosition(draft.blocks.length);
    draft.blocks.push({
      id: createId(),
      protocolId,
      assigneeId: resolveDefaultAssigneeId(),
      x: position.x,
      y: position.y
    });

    renderBlockEditor();
  }

  function onBlockListClick(event) {
    const removeBtn = event.target.closest('[data-workflow-block-remove]');
    if (!removeBtn) {
      return;
    }

    removeBlocks([removeBtn.dataset.workflowBlockRemove]);
  }

  function onBlockListChange(event) {
    const assigneeSelect = event.target.closest('[data-workflow-block-assignee]');
    if (!assigneeSelect) {
      return;
    }

    const blockId = assigneeSelect.dataset.workflowBlockAssignee;
    const block = draft.blocks.find((item) => item.id === blockId);
    if (!block) {
      return;
    }

    block.assigneeId = String(assigneeSelect.value || '').trim();
    renderBlockList();
    renderGraphEditor();
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
    selectionState = {
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
      moved: false,
      additive,
      baseSelection: new Set(selectedBlockIds)
    };

    if (!additive) {
      selectedBlockIds = new Set();
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

    if (!selectedBlockIds.has(blockId)) {
      selectedBlockIds = new Set([blockId]);
      renderGraphEditor();
      renderBlockList();
    }

    const pointer = clientToBoard(event.clientX, event.clientY);
    const dragIds = selectedBlockIds.size ? [...selectedBlockIds] : [blockId];
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

    dragState = {
      startX: pointer.x,
      startY: pointer.y,
      moved: false,
      blockIds: dragIds,
      basePositions
    };

    selectionState = null;
    updateSelectionOverlay();
    document.body.classList.add('workflow-dragging');
    event.preventDefault();
  }

  function updateSelectionFromPointer(pointer) {
    if (!selectionState) {
      return;
    }

    selectionState.currentX = pointer.x;
    selectionState.currentY = pointer.y;

    const dx = Math.abs(selectionState.currentX - selectionState.startX);
    const dy = Math.abs(selectionState.currentY - selectionState.startY);
    if (dx > 2 || dy > 2) {
      selectionState.moved = true;
    }

    const left = Math.min(selectionState.startX, selectionState.currentX);
    const right = Math.max(selectionState.startX, selectionState.currentX);
    const top = Math.min(selectionState.startY, selectionState.currentY);
    const bottom = Math.max(selectionState.startY, selectionState.currentY);

    const rect = { left, right, top, bottom };
    const hitIds = draft.blocks
      .filter((block) => blockIntersectsRect(block, rect))
      .map((block) => block.id);

    if (selectionState.additive) {
      selectedBlockIds = new Set([...selectionState.baseSelection, ...hitIds]);
    } else {
      selectedBlockIds = new Set(hitIds);
    }
  }

  function onWindowMouseMove(event) {
    const pointer = clientToBoard(event.clientX, event.clientY);
    graphPointer = pointer;

    if (dragState) {
      const dx = pointer.x - dragState.startX;
      const dy = pointer.y - dragState.startY;

      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        dragState.moved = true;
      }

      dragState.blockIds.forEach((id) => {
        const block = getBlockById(id);
        const base = dragState.basePositions.get(id);
        if (!block || !base) {
          return;
        }

        block.x = Math.max(20, Math.round(base.x + dx));
        block.y = Math.max(20, Math.round(base.y + dy));
      });

      renderGraphEditor();
      return;
    }

    if (selectionState) {
      updateSelectionFromPointer(pointer);
      renderGraphEditor();
      return;
    }

    if (activeLinkFromBlockId) {
      drawGraphLinks();
    }
  }

  function onWindowMouseUp() {
    if (dragState) {
      const moved = dragState.moved;
      dragState = null;
      document.body.classList.remove('workflow-dragging');
      renderBlockList();
      renderGraphEditor();
      if (moved) {
        interactionSuppressUntil = Date.now() + 140;
      }
      return;
    }

    if (selectionState) {
      const moved = selectionState.moved;
      selectionState = null;
      updateSelectionOverlay();
      renderGraphEditor();
      renderBlockList();
      if (moved) {
        interactionSuppressUntil = Date.now() + 140;
      }
    }
  }

  function onGraphCanvasMouseMove(event) {
    if (dragState || selectionState) {
      return;
    }

    graphPointer = clientToBoard(event.clientX, event.clientY);
    if (activeLinkFromBlockId) {
      drawGraphLinks();
    }
  }

  function onGraphCanvasMouseLeave() {
    graphPointer = null;
    if (activeLinkFromBlockId) {
      drawGraphLinks();
    }
  }

  function onGraphCanvasClick(event) {
    if (Date.now() < interactionSuppressUntil) {
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

    if (activeLinkFromBlockId) {
      activeLinkFromBlockId = '';
      drawGraphLinks();
      setGraphStatus('Connection mode canceled.');
      return;
    }

    if (selectedBlockIds.size) {
      clearSelection({ render: true, status: 'Selection cleared.' });
    }
  }

  function onGraphNodesClick(event) {
    if (Date.now() < interactionSuppressUntil) {
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
      activeLinkFromBlockId = activeLinkFromBlockId === blockId ? '' : blockId;
      drawGraphLinks();
      setGraphStatus();
      event.stopPropagation();
      return;
    }

    const inPortBtn = event.target.closest('[data-workflow-port-in]');
    if (inPortBtn) {
      const targetBlockId = inPortBtn.dataset.workflowPortIn;
      if (!activeLinkFromBlockId) {
        setGraphStatus('Select an output dot first, then click this input dot.');
        event.stopPropagation();
        return;
      }

      if (activeLinkFromBlockId === targetBlockId) {
        setGraphStatus('Cannot connect a block to itself.');
        event.stopPropagation();
        return;
      }

      const hasDuplicate = draft.links.some((link) => link.fromBlockId === activeLinkFromBlockId && link.toBlockId === targetBlockId);
      if (hasDuplicate) {
        setGraphStatus('This connection already exists.');
        event.stopPropagation();
        return;
      }

      draft.links.push({
        id: createId(),
        fromBlockId: activeLinkFromBlockId,
        toBlockId: targetBlockId
      });
      draft.links = normalizeLinks(draft.links, draft.blocks);
      activeLinkFromBlockId = '';
      graphPointer = null;
      renderBlockEditor();
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
    if (Date.now() < interactionSuppressUntil) {
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
      if (!selectedBlockIds.has(blockId)) {
        setSelectedOnly(blockId);
      }

      renderGraphEditor();
      renderBlockList();

      const selectedCount = selectedBlockIds.size || 1;
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
    if (activeLinkFromBlockId) {
      items.push({ action: 'cancel-link', label: 'Cancel Connection Mode' });
    }
    if (selectedBlockIds.size) {
      items.push({ action: 'clear-selection', label: `Clear Selection (${selectedBlockIds.size})` });
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
      removeLinkById(contextMenuState?.linkId || '');
      hideContextMenu();
      return;
    }

    if (action === 'delete-selected') {
      const ids = selectedBlockIds.size ? [...selectedBlockIds] : [contextMenuState?.blockId || ''];
      removeBlocks(ids);
      hideContextMenu();
      return;
    }

    if (action === 'disconnect-selected') {
      const ids = selectedBlockIds.size ? [...selectedBlockIds] : [contextMenuState?.blockId || ''];
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
      activeLinkFromBlockId = '';
      graphPointer = null;
      drawGraphLinks();
      setGraphStatus('Connection mode canceled.');
      hideContextMenu();
      return;
    }

    hideContextMenu();
  }

  function onWindowClick(event) {
    if (workflowGraphContextMenu.hidden) {
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

    if (activeLinkFromBlockId) {
      activeLinkFromBlockId = '';
      graphPointer = null;
      drawGraphLinks();
      setGraphStatus('Connection mode canceled.');
      return;
    }

    if (selectedBlockIds.size) {
      clearSelection({ render: true, status: 'Selection cleared.' });
    }
  }

  function onWorkflowListClick(event) {
    const editBtn = event.target.closest('[data-workflow-edit]');
    if (editBtn) {
      const workflow = (state.workflows || []).find((item) => item.id === editBtn.dataset.workflowEdit);
      if (!workflow) {
        return;
      }

      cloneWorkflowIntoDraft(workflow);
      applyDraftToForm();
      renderWorkflowList();
      return;
    }

    const deleteBtn = event.target.closest('[data-workflow-delete]');
    if (!deleteBtn) {
      return;
    }

    const workflowId = deleteBtn.dataset.workflowDelete;
    state.workflows = (state.workflows || []).filter((workflow) => workflow.id !== workflowId);
    if (draft.id === workflowId) {
      resetDraftToEmpty();
    }

    persist();
    notifyWorkflowsChanged();
    renderWorkflowList();
  }

  function onSaveTemplate() {
    const templateName = String(workflowTemplateNameInput.value || '').trim();
    if (!templateName || !draft.blocks.length) {
      return;
    }

    const now = new Date().toISOString();
    const template = normalizeTemplate({
      id: createId(),
      name: templateName,
      description: workflowDescriptionInput.value.trim() || draft.description,
      blocks: draft.blocks.map((block) => ({ ...block })),
      links: draft.links.map((link) => ({ ...link })),
      createdAt: now,
      updatedAt: now
    });

    state.workflowTemplates.push(template);
    workflowTemplateNameInput.value = '';
    persist();
    renderTemplateSourceOptions();
    renderTemplateList();
  }

  function instantiateTemplate(template, name) {
    const blockIdMap = new Map();

    const blocks = template.blocks.map((block, index) => {
      const nextId = createId();
      blockIdMap.set(block.id, nextId);

      const parsedX = Number(block.x);
      const parsedY = Number(block.y);
      const fallbackPos = suggestedBlockPosition(index);

      return {
        id: nextId,
        protocolId: block.protocolId,
        assigneeId: block.assigneeId || resolveDefaultAssigneeId(),
        x: Number.isFinite(parsedX) ? Math.max(20, Math.round(parsedX)) : fallbackPos.x,
        y: Number.isFinite(parsedY) ? Math.max(20, Math.round(parsedY)) : fallbackPos.y
      };
    });

    const links = template.links
      .map((link) => ({
        id: createId(),
        fromBlockId: blockIdMap.get(link.fromBlockId),
        toBlockId: blockIdMap.get(link.toBlockId)
      }))
      .filter((link) => link.fromBlockId && link.toBlockId);

    return normalizeWorkflow({
      id: createId(),
      name,
      description: template.description,
      projectId: '',
      notebookEntryIds: [],
      blocks,
      links,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  function onCreateFromTemplate() {
    const templateId = String(workflowTemplateSourceInput.value || '').trim();
    const workflowName = String(workflowTemplateCreateNameInput.value || '').trim();
    if (!templateId || !workflowName) {
      return;
    }

    const template = (state.workflowTemplates || []).find((item) => item.id === templateId);
    if (!template) {
      return;
    }

    const workflow = instantiateTemplate(template, workflowName);
    state.workflows.push(workflow);

    persist();
    notifyWorkflowsChanged();
    workflowTemplateCreateNameInput.value = '';

    cloneWorkflowIntoDraft(workflow);
    applyDraftToForm();
    renderWorkflowList();
  }

  function onTemplateListClick(event) {
    const useBtn = event.target.closest('[data-workflow-template-use]');
    if (useBtn) {
      const templateId = useBtn.dataset.workflowTemplateUse;
      const template = (state.workflowTemplates || []).find((item) => item.id === templateId);
      workflowTemplateSourceInput.value = templateId;
      if (template && !String(workflowTemplateCreateNameInput.value || '').trim()) {
        workflowTemplateCreateNameInput.value = `${template.name} Copy`;
      }
      return;
    }

    const deleteBtn = event.target.closest('[data-workflow-template-delete]');
    if (!deleteBtn) {
      return;
    }

    const templateId = deleteBtn.dataset.workflowTemplateDelete;
    state.workflowTemplates = (state.workflowTemplates || []).filter((template) => template.id !== templateId);
    if (workflowTemplateSourceInput.value === templateId) {
      workflowTemplateSourceInput.value = '';
    }

    persist();
    renderTemplateSourceOptions();
    renderTemplateList();
  }

  function render() {
    ensureStateShape();

    draft.blocks = normalizeBlocks(draft.blocks);
    draft.links = normalizeLinks(draft.links, draft.blocks);
    draft.notebookEntryIds = uniqueStrings(draft.notebookEntryIds);

    pruneSelectedBlockIds();

    applyDraftToForm();
    renderTemplateSourceOptions();
    renderTemplateList();
    renderWorkflowList();
  }

  return {
    render,
    renderProjectOptions,
    renderNotebookOptions,
    renderProtocolOptions
  };
}
