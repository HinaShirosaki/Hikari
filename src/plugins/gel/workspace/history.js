// Undo/redo for the Gel workspace's manual editing state.
//
// The host's global history service snapshots the renderer's own state object,
// which never contains a plugin frame's in-progress work — and keyboard events
// inside a focused frame never reach the host at all. So the frame owns its
// history and reports its depth up through `app.setHistory`.
//
// ponytail: the snapshot is manualOverrides only — dividers, ladder lane, ladder
// MW bands, band windows, lane vertices, peak integrations, the lane table. Crop
// and rotation are excluded because they rewrite the image itself; snapshotting
// those means keeping whole ImageData copies per step. Add an image-level stack
// if crop ever needs to be undoable.
const DEFAULT_MAX_DEPTH = 60;

function serialize(overrides) {
  try {
    return JSON.stringify(overrides ?? null);
  } catch {
    return null;
  }
}

// The analysis report is derived, so an entry keeps only whether its step was
// showing one. Undo re-runs it for steps that had one; re-running it everywhere
// turned divider-only steps into a full report with lane 1 drawn as the ladder.
function snapshot(runtime) {
  return {
    overrides: serialize(runtime.manualOverrides),
    analyzed: Boolean(runtime.currentReport)
  };
}

export function createHistoryController({ runtime, deps = {}, maxDepth = DEFAULT_MAX_DEPTH }) {
  const undoStack = [];
  const redoStack = [];
  let baseline = snapshot(runtime);
  let imageRevision = runtime.imageRevision;
  let applying = false;

  function getHistoryState() {
    return {
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0
    };
  }

  function announce() {
    deps.onHistoryChanged?.(getHistoryState());
  }

  // Called after every render pass. A no-op unless the overrides actually moved,
  // so callers never have to decide whether an interaction was a real edit.
  function commit() {
    if (applying) {
      return false;
    }
    // A load, a crop, or a rotation replaces the pixels the stored overrides were
    // measured against, so the stack is dropped rather than left pointing at rows
    // and columns that no longer exist.
    if (runtime.imageRevision !== imageRevision) {
      reset();
      return false;
    }
    const next = snapshot(runtime);
    if (!next.overrides) {
      return false;
    }
    if (next.overrides === baseline.overrides) {
      // Most edits render first and analyze after, so the report this step
      // ends up showing only arrives on a later, otherwise unchanged commit.
      baseline.analyzed = next.analyzed;
      return false;
    }
    if (baseline.overrides) {
      undoStack.push(baseline);
      while (undoStack.length > maxDepth) {
        undoStack.shift();
      }
    }
    redoStack.length = 0;
    baseline = next;
    announce();
    return true;
  }

  function apply(entry) {
    let restored = null;
    try {
      restored = JSON.parse(entry.overrides);
    } catch {
      return false;
    }
    applying = true;
    try {
      runtime.manualOverrides = restored;
      baseline = { ...entry };
      deps.renderAll?.({ analyzed: entry.analyzed });
    } finally {
      applying = false;
    }
    announce();
    return true;
  }

  // Edits that never re-render (lane-table text, peak marks, Done Quantify) are
  // still pending here. Commit them first, or undo skips past them and redo
  // can't bring them back.
  function undo() {
    commit();
    const target = undoStack.pop();
    if (!target) {
      announce();
      return false;
    }
    if (baseline.overrides && baseline.overrides !== target.overrides) {
      redoStack.push(baseline);
    }
    return apply(target);
  }

  function redo() {
    commit();
    const target = redoStack.pop();
    if (!target) {
      announce();
      return false;
    }
    if (baseline.overrides && baseline.overrides !== target.overrides) {
      undoStack.push(baseline);
    }
    return apply(target);
  }

  function reset() {
    undoStack.length = 0;
    redoStack.length = 0;
    baseline = snapshot(runtime);
    imageRevision = runtime.imageRevision;
    announce();
  }

  return { commit, getHistoryState, redo, reset, undo };
}
