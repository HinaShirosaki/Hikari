// Float a selection card over the header without adding anything to its layout.
export function createPickerStatusPositioner({ rootDocument, getAnchor } = {}) {
  const windowRef = rootDocument?.defaultView;
  let banner = null;
  let observedAnchor = null;
  let observer = null;
  let frame = null;

  function position() {
    if (!banner || !windowRef) return;
    const anchor = getAnchor();
    if (anchor !== observedAnchor) {
      if (observedAnchor) observer?.unobserve(observedAnchor);
      observedAnchor = anchor;
      if (anchor) observer?.observe(anchor);
    }
    if (!anchor || anchor.closest('[hidden]') || !anchor.getClientRects().length) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    banner.dataset.pickerAnchor = anchor.id;
    const bounds = anchor.getBoundingClientRect();
    const workspace = anchor.closest('.sequence-viewer-detail-main, .sequence-viewer-vector-builder-workspace');
    const content = workspace?.querySelector('.sequence-viewer-results, .sequence-viewer-vector-builder-layout');
    const bottom = Math.min(content?.getBoundingClientRect().top ?? bounds.bottom, windowRef.innerHeight) - 4;
    const margin = Math.min(8, Math.max(0, bottom / 4));
    const right = Math.min(windowRef.innerWidth - margin, bounds.right);
    const maximumWidth = Math.max(1, Math.min(banner.matches('.sequence-viewer-pcr-picker') ? 620 : 560,
      right - Math.max(margin, bounds.left)));
    const controls = [...anchor.children].filter(child => child.getClientRects().length);
    const lastRight = Math.max(bounds.left, ...controls.map(child => child.getBoundingClientRect().right));
    const gapWidth = right - lastRight - 12;
    const applyWidth = width => { banner.style.width = `${width}px`; };
    banner.style.maxHeight = 'none';
    banner.firstElementChild.style.maxHeight = 'none';
    banner.classList.remove('is-header-constrained');
    applyWidth(gapWidth >= 280 ? Math.min(maximumWidth, gapWidth) : maximumWidth);
    let height = banner.getBoundingClientRect().height;
    // A wider card can keep the complete prompt above the DNA on short headers.
    if (height > bottom - margin && banner.getBoundingClientRect().width < maximumWidth) {
      applyWidth(maximumWidth);
      height = banner.getBoundingClientRect().height;
    }
    const maximumHeight = Math.max(1, bottom - margin);
    if (height > maximumHeight) banner.classList.add('is-header-constrained');
    banner.style.maxHeight = `${maximumHeight}px`;
    const style = windowRef.getComputedStyle(banner);
    const inset = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
      .reduce((sum, property) => sum + parseFloat(style[property] || 0), 0);
    banner.firstElementChild.style.maxHeight = `${Math.max(1, maximumHeight - inset)}px`;
    height = banner.getBoundingClientRect().height;
    banner.style.left = `${Math.max(margin, right - banner.getBoundingClientRect().width)}px`;
    banner.style.top = `${Math.max(margin, Math.min(bounds.top, bottom - height))}px`;
  }

  function refresh() {
    if (!banner || frame !== null) return;
    frame = windowRef.requestAnimationFrame(() => { frame = null; position(); });
  }

  function clear() {
    if (frame !== null) windowRef?.cancelAnimationFrame(frame);
    frame = null;
    observer?.disconnect();
    observer = null;
    observedAnchor = null;
    windowRef?.removeEventListener('resize', refresh);
    rootDocument?.removeEventListener('scroll', refresh, true);
    banner?.remove();
    banner = null;
  }

  function show(node) {
    clear();
    banner = node;
    rootDocument.body.appendChild(banner);
    if (typeof windowRef?.ResizeObserver === 'function') {
      observer = new windowRef.ResizeObserver(refresh);
      observer.observe(banner);
    }
    windowRef?.addEventListener('resize', refresh);
    rootDocument?.addEventListener('scroll', refresh, true);
    position();
  }

  return { show, clear, refresh };
}
