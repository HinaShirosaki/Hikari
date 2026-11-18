function asArray(value) {
  return Array.from(value || []).filter(Boolean);
}

function normalizeAcceptList(accept = '') {
  return String(accept || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function fileExtension(file) {
  const name = String(file?.name || '').trim().toLowerCase();
  const dotIndex = name.lastIndexOf('.');
  return dotIndex >= 0 ? name.slice(dotIndex) : '';
}

function fileMimeType(file) {
  return String(file?.type || '').trim().toLowerCase();
}

function hasFileTransfer(dataTransfer) {
  if (!dataTransfer) {
    return false;
  }
  if (asArray(dataTransfer.files).length) {
    return true;
  }
  return asArray(dataTransfer.types)
    .map((type) => String(type || '').trim().toLowerCase())
    .includes('files');
}

// Same matching rules as <input accept>: ".ext", "type/*", or an exact MIME.
export function fileMatchesAccept(file, accept = '') {
  const acceptList = normalizeAcceptList(accept);
  if (!acceptList.length) {
    return true;
  }

  const extension = fileExtension(file);
  const mimeType = fileMimeType(file);

  return acceptList.some((token) => {
    if (token.startsWith('.')) {
      return Boolean(extension) && extension === token;
    }
    if (token.endsWith('/*')) {
      const prefix = token.slice(0, -1);
      return Boolean(mimeType) && mimeType.startsWith(prefix);
    }
    return Boolean(mimeType) && mimeType === token;
  });
}

export function filterAcceptedFiles(files, accept = '') {
  return asArray(files).filter((file) => fileMatchesAccept(file, accept));
}

// FileList is read-only; the only way to set input.files is through a fresh
// DataTransfer. Returns false where DataTransfer cannot be constructed.
export function mergeFilesIntoInput(input, files, { append = true } = {}) {
  if (!input || !files) {
    return false;
  }

  const DataTransferCtor = input?.ownerDocument?.defaultView?.DataTransfer || globalThis?.DataTransfer;
  if (typeof DataTransferCtor !== 'function') {
    return false;
  }

  try {
    const transfer = new DataTransferCtor();
    const nextFiles = append
      ? [...asArray(input.files), ...asArray(files)]
      : asArray(files);
    nextFiles.forEach((file) => {
      transfer.items.add(file);
    });
    input.files = transfer.files;
    return true;
  } catch {
    return false;
  }
}

// Hands dropped files to a file input as if the user had picked them, so the
// input's existing change handler does the import.
export function dropIntoInput(input, files) {
  if (mergeFilesIntoInput(input, files, { append: false })) {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

// One shared ring drawn over the active target. It is fixed-positioned so the
// target's child backgrounds, overflow clipping or the window edge can't hide it.
function placeDropRing(target, show, caption = null) {
  const doc = target.ownerDocument;
  const win = doc?.defaultView;
  if (!doc?.body || !win || typeof target.getBoundingClientRect !== 'function') {
    return;
  }
  let ring = doc.querySelector('.app-file-drop-ring');
  if (!show) {
    if (ring) ring.hidden = true;
    return;
  }
  if (!ring) {
    ring = doc.createElement('div');
    ring.className = 'app-file-drop-ring';
    ring.setAttribute('aria-hidden', 'true');
    doc.body.append(ring);
  }
  const rect = target.getBoundingClientRect();
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const width = Math.min(win.innerWidth, rect.right) - left;
  const height = Math.min(win.innerHeight, rect.bottom) - top;
  if (width < 1 || height < 1) {
    ring.hidden = true;
    return;
  }
  Object.assign(ring.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
  // Resolved on every drag so a language switch is picked up; CSS shows it in
  // place of the generic label.
  ring.dataset.caption = (typeof caption === 'function' ? caption() : caption) || '';
  ring.hidden = false;
}

// Makes an element accept dropped files. Non-file drags (text, rail rows) are
// ignored so they keep their own handlers. Pass `input` instead of `onFiles`
// to reuse a file input's accept, multiple and change handler. `caption`
// (text or a function returning it) says what the drop will do; `highlight`
// returns the element to draw the ring around when that is narrower than the
// target. Returns an unbind function.
export function bindFileDropTarget({
  target,
  input = null,
  accept = input?.getAttribute?.('accept') || '',
  multiple = Boolean(input?.multiple),
  disabled = null,
  onFiles = input ? (files) => dropIntoInput(input, files) : null,
  onRejected = null,
  onError = null,
  activeClass = 'is-file-drop-active',
  ring = true,
  caption = null,
  highlight = null
} = {}) {
  if (!target?.addEventListener || typeof onFiles !== 'function') {
    return () => {};
  }

  // dragenter/dragleave fire for every child element crossed, so count depth
  // and only clear the highlight when the drag has really left the target.
  let dragDepth = 0;
  target.classList?.add?.('app-file-drop-target');

  function isDisabled() {
    return Boolean(input?.disabled) || (typeof disabled === 'function' && disabled());
  }

  function activateDropState() {
    target.classList?.add?.(activeClass);
    if (ring) placeDropRing(highlight?.() || target, true, caption);
  }

  function clearDropState() {
    dragDepth = 0;
    target.classList?.remove?.(activeClass);
    if (ring) placeDropRing(target, false);
  }

  function prepareDragEvent(event) {
    if (!hasFileTransfer(event?.dataTransfer) || isDisabled()) {
      return false;
    }
    event.preventDefault?.();
    event.stopPropagation?.();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    return true;
  }

  function onDragEnter(event) {
    if (!prepareDragEvent(event)) {
      return;
    }
    dragDepth += 1;
    activateDropState();
  }

  function onDragOver(event) {
    if (!prepareDragEvent(event)) {
      return;
    }
    activateDropState();
  }

  function onDragLeave(event) {
    if (!dragDepth) {
      return;
    }
    event.preventDefault?.();
    event.stopPropagation?.();
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) {
      clearDropState();
    }
  }

  function onDrop(event) {
    if (!prepareDragEvent(event)) {
      return;
    }
    clearDropState();

    const droppedFiles = asArray(event?.dataTransfer?.files);
    const acceptedFiles = filterAcceptedFiles(droppedFiles, accept);
    const selectedFiles = multiple ? acceptedFiles : acceptedFiles.slice(0, 1);

    if (!selectedFiles.length) {
      onRejected?.({
        acceptedFiles,
        droppedFiles,
        event
      });
      return;
    }

    Promise.resolve(onFiles(selectedFiles, event)).catch((error) => {
      onError?.(error);
    });
  }

  target.addEventListener('dragenter', onDragEnter);
  target.addEventListener('dragover', onDragOver);
  target.addEventListener('dragleave', onDragLeave);
  target.addEventListener('drop', onDrop);

  return () => {
    clearDropState();
    target.classList?.remove?.('app-file-drop-target');
    target.removeEventListener('dragenter', onDragEnter);
    target.removeEventListener('dragover', onDragOver);
    target.removeEventListener('dragleave', onDragLeave);
    target.removeEventListener('drop', onDrop);
  };
}
