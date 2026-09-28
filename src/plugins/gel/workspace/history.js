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

export function createHistoryController({ runtime, deps = {}, maxDepth = DEFAULT_MAX_DEPTH }) {
  const undoStack = [];
  const redoStack = [];
  let baseline = serialize(runtime.manualOverrides);
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
    const next = serialize(runtime.manualOverrides);
    if (!next || next === baseline) {
      return false;
    }
    if (baseline) {
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

  function apply(serialized) {
    let restored = null;
    try {
      restored = JSON.parse(serialized);
    } catch {
      return false;
    }
    applying = true;
    try {
      runtime.manualOverrides = restored;
      baseline = serialized;
      deps.renderAll?.();
    } finally {
      applying = false;
    }
    announce();
    return true;
  }

  function undo() {
    const target = undoStack.pop();
    if (!target) {
      announce();
      return false;
    }
    if (baseline && baseline !== target) {
      redoStack.push(baseline);
    }
    return apply(target);
  }

  function redo() {
    const target = redoStack.pop();
    if (!target) {
      announce();
      return false;
    }
    if (baseline && baseline !== target) {
      undoStack.push(baseline);
    }
    return apply(target);
  }

  function reset() {
    undoStack.length = 0;
    redoStack.length = 0;
    baseline = serialize(runtime.manualOverrides);
    imageRevision = runtime.imageRevision;
    announce();
  }

  return { commit, getHistoryState, redo, reset, undo };
}
