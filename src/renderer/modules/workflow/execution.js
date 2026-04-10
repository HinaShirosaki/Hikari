import { buildDirectionMaps } from './presentation.js';

function sortBlocksByPosition(left, right) {
  const leftY = Number(left?.y) || 0;
  const rightY = Number(right?.y) || 0;
  if (leftY !== rightY) {
    return leftY - rightY;
  }
  const leftX = Number(left?.x) || 0;
  const rightX = Number(right?.x) || 0;
  if (leftX !== rightX) {
    return leftX - rightX;
  }
  return String(left?.id || '').localeCompare(String(right?.id || ''));
}

function sortNextCandidates(currentBlock, blockById) {
  return (leftId, rightId) => {
    const left = blockById.get(leftId);
    const right = blockById.get(rightId);
    const currentY = Number(currentBlock?.y) || 0;
    const leftDeltaY = Math.abs((Number(left?.y) || 0) - currentY);
    const rightDeltaY = Math.abs((Number(right?.y) || 0) - currentY);
    if (leftDeltaY !== rightDeltaY) {
      return leftDeltaY - rightDeltaY;
    }
    return sortBlocksByPosition(left, right);
  };
}

function findNearestMainAncestor(blockId, upstream, mainPathIds, mainSet) {
  const queue = [...(upstream.get(blockId) || [])];
  const seen = new Set(queue);
  while (queue.length) {
    const currentId = queue.shift();
    if (mainSet.has(currentId)) {
      return currentId;
    }
    (upstream.get(currentId) || []).forEach((nextId) => {
      if (!seen.has(nextId)) {
        seen.add(nextId);
        queue.push(nextId);
      }
    });
  }
  return mainPathIds[0] || '';
}

function collectBranchGroup(rootId, context) {
  const {
    blockById,
    downstream,
    upstream,
    nonMainSet,
    mainPathIds,
    mainSet,
    branchVisited
  } = context;

  const reachableIds = [];
  const reachableSet = new Set();
  const queue = [rootId];

  while (queue.length) {
    const currentId = queue.shift();
    if (!currentId || reachableSet.has(currentId) || !nonMainSet.has(currentId)) {
      continue;
    }
    reachableSet.add(currentId);
    reachableIds.push(currentId);
    (downstream.get(currentId) || []).forEach((nextId) => {
      if (nonMainSet.has(nextId) && !reachableSet.has(nextId)) {
        queue.push(nextId);
      }
    });
  }

  const orderedIds = [];
  const orderedSet = new Set();
  let current = blockById.get(rootId) || null;

  while (current) {
    orderedIds.push(current.id);
    orderedSet.add(current.id);
    branchVisited.add(current.id);

    const candidates = (downstream.get(current.id) || [])
      .filter((nextId) => reachableSet.has(nextId) && !orderedSet.has(nextId))
      .sort(sortNextCandidates(current, blockById));
    current = candidates.length ? blockById.get(candidates[0]) || null : null;
  }

  reachableIds
    .filter((blockId) => !orderedSet.has(blockId))
    .sort((leftId, rightId) => sortBlocksByPosition(blockById.get(leftId), blockById.get(rightId)))
    .forEach((blockId) => {
      orderedIds.push(blockId);
      branchVisited.add(blockId);
    });

  const anchorBlockId = findNearestMainAncestor(rootId, upstream, mainPathIds, mainSet);
  const anchorIndex = Math.max(0, mainPathIds.indexOf(anchorBlockId));

  return {
    rootId,
    anchorBlockId,
    anchorIndex,
    blockIds: orderedIds,
    blocks: orderedIds.map((blockId) => blockById.get(blockId)).filter(Boolean)
  };
}

export function buildWorkflowExecutionLayout(workflow = {}) {
  const blocks = Array.isArray(workflow?.blocks) ? workflow.blocks.slice() : [];
  const links = Array.isArray(workflow?.links) ? workflow.links.slice() : [];
  const blockById = new Map(blocks.map((block) => [block.id, block]));
  const { upstream, downstream } = buildDirectionMaps(blocks, links);
  const sortedBlocks = blocks.slice().sort(sortBlocksByPosition);

  const roots = sortedBlocks.filter((block) => !(upstream.get(block.id) || []).length);
  let current = roots[0] || sortedBlocks[0] || null;
  const mainPathIds = [];
  const mainVisited = new Set();

  while (current && !mainVisited.has(current.id)) {
    mainPathIds.push(current.id);
    mainVisited.add(current.id);
    const candidates = (downstream.get(current.id) || [])
      .filter((nextId) => !mainVisited.has(nextId))
      .sort(sortNextCandidates(current, blockById));
    current = candidates.length ? blockById.get(candidates[0]) || null : null;
  }

  const mainSet = new Set(mainPathIds);
  const nonMainSet = new Set(
    sortedBlocks
      .map((block) => block.id)
      .filter((blockId) => !mainSet.has(blockId))
  );
  const branchRoots = sortedBlocks.filter((block) => (
    nonMainSet.has(block.id)
    && !(upstream.get(block.id) || []).some((upstreamId) => nonMainSet.has(upstreamId))
  ));
  const branchVisited = new Set();
  const branches = branchRoots
    .map((block) => collectBranchGroup(block.id, {
      blockById,
      downstream,
      upstream,
      nonMainSet,
      mainPathIds,
      mainSet,
      branchVisited
    }))
    .filter(Boolean);

  sortedBlocks
    .filter((block) => nonMainSet.has(block.id) && !branchVisited.has(block.id))
    .forEach((block) => {
      const group = collectBranchGroup(block.id, {
        blockById,
        downstream,
        upstream,
        nonMainSet,
        mainPathIds,
        mainSet,
        branchVisited
      });
      if (group) {
        branches.push(group);
      }
    });

  branches.sort((left, right) => {
    if (left.anchorIndex !== right.anchorIndex) {
      return left.anchorIndex - right.anchorIndex;
    }
    return sortBlocksByPosition(blockById.get(left.rootId), blockById.get(right.rootId));
  });

  return {
    blockById,
    upstream,
    downstream,
    mainPathIds,
    mainPath: mainPathIds.map((blockId) => blockById.get(blockId)).filter(Boolean),
    mainSet,
    branches
  };
}

export function getWorkflowStepState(entry, blockId) {
  const stepState = entry?.stepStates && typeof entry.stepStates === 'object'
    ? entry.stepStates[blockId]
    : null;
  const rawStatus = String(stepState?.status || '').trim().toLowerCase();
  return {
    status: rawStatus === 'failed'
      ? 'failed'
      : (rawStatus === 'pending'
        ? 'pending'
        : (rawStatus === 'completed' ? 'completed' : 'not_done')),
    values: stepState?.values && typeof stepState.values === 'object' && !Array.isArray(stepState.values)
      ? stepState.values
      : {},
    result: String(stepState?.result || '').trim(),
    resultFiles: Array.isArray(stepState?.resultFiles) ? stepState.resultFiles : [],
    resultFileRecords: Array.isArray(stepState?.resultFileRecords) ? stepState.resultFileRecords : [],
    notebookEntryId: String(stepState?.notebookEntryId || '').trim(),
    assayIds: Array.isArray(stepState?.assayIds) ? stepState.assayIds : [],
    gelAnalysisIds: Array.isArray(stepState?.gelAnalysisIds) ? stepState.gelAnalysisIds : [],
    completedAt: String(stepState?.completedAt || '').trim(),
    updatedAt: String(stepState?.updatedAt || '').trim()
  };
}

export function isBranchActiveForEntry(entry, branchGroup) {
  const explicitIds = new Set(Array.isArray(entry?.activeBranchRootIds) ? entry.activeBranchRootIds : []);
  if (explicitIds.has(branchGroup.rootId)) {
    return true;
  }
  return branchGroup.blockIds.some((blockId) => getWorkflowStepState(entry, blockId).status === 'completed');
}

export function getActiveBranchGroups(layout, entry) {
  return (layout?.branches || []).filter((branch) => isBranchActiveForEntry(entry, branch));
}

export function buildOrderedActiveBlockIds(layout, entry) {
  const orderedIds = [];
  const branchesByAnchorIndex = new Map();

  getActiveBranchGroups(layout, entry).forEach((branch) => {
    const key = Number(branch.anchorIndex) || 0;
    if (!branchesByAnchorIndex.has(key)) {
      branchesByAnchorIndex.set(key, []);
    }
    branchesByAnchorIndex.get(key).push(branch);
  });

  (layout?.mainPathIds || []).forEach((blockId, index) => {
    orderedIds.push(blockId);
    const anchoredBranches = branchesByAnchorIndex.get(index) || [];
    anchoredBranches.forEach((branch) => {
      orderedIds.push(...branch.blockIds);
    });
  });

  return orderedIds;
}

export function computeEntryProgress(entry, layout) {
  const orderedIds = buildOrderedActiveBlockIds(layout, entry);
  const activeBlockIds = new Set(orderedIds);
  const completedBlockIds = new Set(
    orderedIds.filter((blockId) => getWorkflowStepState(entry, blockId).status === 'completed')
  );
  const actionable = orderedIds.filter((blockId) => {
    if (completedBlockIds.has(blockId)) {
      return false;
    }
    const upstreamIds = (layout?.upstream?.get(blockId) || []).filter((upstreamId) => activeBlockIds.has(upstreamId));
    return upstreamIds.every((upstreamId) => completedBlockIds.has(upstreamId));
  });
  const nextBlockId = actionable[0] || orderedIds.find((blockId) => !completedBlockIds.has(blockId)) || '';
  const totalSteps = orderedIds.length;
  const completedSteps = completedBlockIds.size;
  const percentComplete = totalSteps ? Math.round((completedSteps / totalSteps) * 100) : 0;

  return {
    totalSteps,
    completedSteps,
    percentComplete,
    complete: totalSteps > 0 && completedSteps >= totalSteps,
    nextBlockId,
    orderedIds,
    activeBlockIds,
    completedBlockIds
  };
}

export function computeWorkflowExecutionSummary(workflow, layout) {
  const entries = Array.isArray(workflow?.entries) ? workflow.entries : [];
  if (!entries.length) {
    return {
      entryCount: 0,
      completedEntryCount: 0,
      percentComplete: 0,
      nextBlockId: '',
      activeEntryId: ''
    };
  }

  const entryProgress = entries.map((entry) => ({
    entry,
    progress: computeEntryProgress(entry, layout)
  }));
  const completedEntryCount = entryProgress.filter((item) => item.progress.complete).length;
  const percentComplete = Math.round(
    entryProgress.reduce((sum, item) => sum + item.progress.percentComplete, 0) / Math.max(1, entryProgress.length)
  );
  const nextEntry = entryProgress.find((item) => item.progress.nextBlockId) || entryProgress[0];

  return {
    entryCount: entries.length,
    completedEntryCount,
    percentComplete,
    nextBlockId: nextEntry?.progress?.nextBlockId || '',
    activeEntryId: nextEntry?.entry?.id || ''
  };
}
