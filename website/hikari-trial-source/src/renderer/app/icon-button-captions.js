const AUTO_CAPTION_ATTRIBUTE = 'data-hikari-auto-caption';
const ICON_GLYPH_PATTERN = /^[+\-−×✕✖✓✔✎✏…⋮⋯←→↑↓↔↕◀▶▲▼]+$/u;

function trimmedAttribute(element, name) {
  return String(element?.getAttribute?.(name) || '').trim();
}

function visibleButtonText(button) {
  const clone = button?.cloneNode?.(true);
  if (!clone) {
    return String(button?.textContent || '').trim();
  }

  clone.querySelectorAll?.('svg, img, .sr-only, [aria-hidden="true"]')
    .forEach((element) => element.remove());
  return String(clone.textContent || '').replace(/\s+/g, ' ').trim();
}

function hasIcon(button) {
  return String(button?.className || '').toLowerCase().includes('icon')
    || Boolean(button?.querySelector?.('svg, img, [data-icon], [class*="icon"]'));
}

export function isCaptionableIconButton(button) {
  if (String(button?.tagName || '').toUpperCase() !== 'BUTTON') {
    return false;
  }

  if (trimmedAttribute(button, 'data-icon-caption')) {
    return true;
  }

  const text = visibleButtonText(button);
  return hasIcon(button)
    ? !text || ICON_GLYPH_PATTERN.test(text)
    : ICON_GLYPH_PATTERN.test(text);
}

export function applyIconButtonCaption(button) {
  if (!button?.getAttribute || !button?.setAttribute) {
    return false;
  }

  const hasAutomaticCaption = button.hasAttribute?.(AUTO_CAPTION_ATTRIBUTE);
  if (trimmedAttribute(button, 'data-hover-caption')) {
    if (hasAutomaticCaption) {
      button.removeAttribute('title');
      button.removeAttribute(AUTO_CAPTION_ATTRIBUTE);
    }
    return false;
  }
  const explicitCaption = trimmedAttribute(button, 'title');
  if (explicitCaption && !hasAutomaticCaption) {
    return false;
  }

  const caption = trimmedAttribute(button, 'data-icon-caption')
    || trimmedAttribute(button, 'aria-label');
  if (!caption || !isCaptionableIconButton(button)) {
    if (hasAutomaticCaption) {
      button.removeAttribute('title');
      button.removeAttribute(AUTO_CAPTION_ATTRIBUTE);
    }
    return false;
  }

  if (explicitCaption !== caption) {
    button.setAttribute('title', caption);
  }
  button.setAttribute(AUTO_CAPTION_ATTRIBUTE, '');
  return true;
}

function refreshCaptions(root) {
  if (!root) {
    return;
  }

  if (String(root.tagName || '').toUpperCase() === 'BUTTON') {
    applyIconButtonCaption(root);
  }
  root.querySelectorAll?.('button').forEach(applyIconButtonCaption);
}

export function installIconButtonCaptions({
  documentObject = document,
  windowObject = window
} = {}) {
  const root = documentObject?.body || documentObject?.documentElement;
  if (!root) {
    return { disconnect() {}, refresh() {} };
  }

  const refresh = () => refreshCaptions(root);
  refresh();

  const MutationObserverConstructor = windowObject?.MutationObserver;
  if (typeof MutationObserverConstructor !== 'function') {
    return { disconnect() {}, refresh };
  }

  const observer = new MutationObserverConstructor((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        applyIconButtonCaption(record.target);
        continue;
      }
      record.addedNodes.forEach(refreshCaptions);
    }
  });
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-label', 'data-icon-caption', 'data-hover-caption']
  });

  return {
    disconnect: () => observer.disconnect(),
    refresh
  };
}
