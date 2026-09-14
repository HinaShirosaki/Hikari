// Patch the conversation without resetting disclosure state, text selection,
// or a tool output's sandboxed browsing context on every streamed update.
function nodeKey(node) {
  if (node.nodeType !== 1) return `node:${node.nodeType}`;
  const key = node.dataset.agentRenderKey || node.dataset.agentCardKey
    || node.dataset.agentHtmlId || node.dataset.agentHtmlFrame
    || node.dataset.agentUserQuestionCard || node.id || node.classList[0] || '';
  return `${node.tagName}:${key}`;
}

function patchNode(current, next) {
  if (current.isEqualNode(next)) return;
  if (current.nodeType === 3) {
    // Appending keeps selection offsets within the already streamed text.
    if (next.data.startsWith(current.data)) current.appendData(next.data.slice(current.data.length));
    else current.replaceData(0, current.data.length, next.data);
    return;
  }
  if (current.nodeType !== 1) return;
  // Tool outputs are immutable by id. Retain the frame and its resized height.
  if (current.dataset.agentHtmlFrame && current.dataset.htmlMounted) return;
  for (const attribute of [...current.attributes]) {
    if (attribute.name === 'open' && current.tagName === 'DETAILS') continue;
    if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
  }
  for (const attribute of [...next.attributes]) {
    if (attribute.name === 'open' && current.tagName === 'DETAILS') continue;
    if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
  }
  patchChildren(current, next);
}

function patchChildren(current, next) {
  const available = new Map();
  for (const child of [...current.childNodes]) {
    const key = nodeKey(child);
    if (!available.has(key)) available.set(key, []);
    available.get(key).push(child);
  }
  const ordered = [...next.childNodes].map(child => {
    const old = available.get(nodeKey(child))?.shift();
    if (!old) return child;
    patchNode(old, child);
    return old;
  });
  const retained = new Set(ordered);
  for (const child of [...current.childNodes]) if (!retained.has(child)) child.remove();
  ordered.forEach((child, index) => {
    const before = current.childNodes[index] || null;
    if (child === before) return;
    if (child.parentNode === current && typeof current.moveBefore === 'function') current.moveBefore(child, before);
    else current.insertBefore(child, before);
  });
}

export function updateHistoryKeepingHtmlFrames(historyNode, markup) {
  const document = historyNode.ownerDocument;
  const template = document?.createElement?.('template');
  // Lightweight test/embedded DOM hosts may only implement innerHTML.
  if (!template?.content || !historyNode.childNodes) {
    historyNode.innerHTML = markup;
    return;
  }
  template.innerHTML = markup;
  patchChildren(historyNode, template.content);
}
