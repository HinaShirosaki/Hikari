// Hover readout for sequence maps, shared by the Vector Builder and the library
// preview.
//
// Short features -- primer binding sites especially -- render as slivers on a
// multi-kb plasmid, so their only on-map identification is a name in the label
// column, which is hard to associate with the arc under the cursor. This puts
// the name (and its span) right at the pointer. It replaces the native <title>
// tooltip, which took about a second to appear and could not be styled.

const TOOLTIP_CLASS = 'vector-map__tooltip';
const POINTER_OFFSET_PX = 14;

export function attachMapHoverLabel(config = {}) {
  const resolveHost = typeof config?.host === 'function' ? config.host : () => config?.host || null;
  const rootDocument = config?.rootDocument || globalThis?.document || null;
  let node = null;

  function ensureNode() {
    if (node || !rootDocument?.createElement || !rootDocument?.body?.appendChild) {
      return node;
    }
    node = rootDocument.createElement('div');
    node.className = TOOLTIP_CLASS;
    node.hidden = true;
    rootDocument.body.appendChild(node);
    return node;
  }

  function hide() {
    if (node) {
      node.hidden = true;
    }
  }

  function show(text, clientX, clientY) {
    const element = ensureNode();
    if (!element) {
      return;
    }
    element.textContent = text;
    element.hidden = false;

    // Flip to the other side of the cursor rather than letting the readout run
    // off the edge of the window.
    const viewWidth = Number(globalThis?.innerWidth) || 0;
    const viewHeight = Number(globalThis?.innerHeight) || 0;
    const width = Number(element.offsetWidth) || 0;
    const height = Number(element.offsetHeight) || 0;
    let left = clientX + POINTER_OFFSET_PX;
    let top = clientY + POINTER_OFFSET_PX;
    if (viewWidth && left + width > viewWidth - 8) {
      left = Math.max(8, clientX - width - POINTER_OFFSET_PX);
    }
    if (viewHeight && top + height > viewHeight - 8) {
      top = Math.max(8, clientY - height - POINTER_OFFSET_PX);
    }
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }

  function readLabel(target) {
    return String(target?.getAttribute?.('aria-label') || '').trim();
  }

  function bind() {
    const host = resolveHost();
    if (!host?.addEventListener) {
      return;
    }

    host.addEventListener('mousemove', (event) => {
      const trigger = event.target?.closest?.('[data-feature-index]') || null;
      const label = trigger ? readLabel(trigger) : '';
      if (!label) {
        hide();
        return;
      }
      show(label, event.clientX, event.clientY);
    });

    host.addEventListener('mouseleave', hide);
    // Zooming and panning move the map out from under the pointer.
    host.addEventListener('wheel', hide, { passive: true });
    host.addEventListener('scroll', hide, { passive: true });
    host.addEventListener('mousedown', hide);
  }

  return { bind, hide };
}
