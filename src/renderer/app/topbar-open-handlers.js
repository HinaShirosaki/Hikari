function isHtmlElement(element, windowObject) {
  const ElementConstructor = windowObject.HTMLElement
    || (typeof HTMLElement === 'function' ? HTMLElement : null);
  return ElementConstructor
    ? element instanceof ElementConstructor
    : Boolean(element?.nodeType === 1);
}

function requestNextFrame(windowObject, callback) {
  const requestFrame = windowObject.requestAnimationFrame
    || windowObject.setTimeout
    || ((handler) => setTimeout(handler, 0));
  requestFrame.call(windowObject, callback);
}

export function createTopbarOpenItemHandlers({
  views,
  moduleRegistry,
  rendererServices,
  showView,
  documentObject = document,
  windowObject = window,
  cssEscape
}) {
  const escapeSelectorValue = typeof cssEscape === 'function'
    ? cssEscape
    : (value) => String(value).replace(/["\\]/g, '\\$&');

  function clickItemBySelector(viewId, selector) {
    showView(viewId);
    const tryClick = () => {
      const element = documentObject.querySelector(selector);
      if (isHtmlElement(element, windowObject)) {
        element.click();
        if (typeof element.scrollIntoView === 'function') {
          element.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        return true;
      }
      return false;
    };
    if (tryClick()) {
      return true;
    }
    requestNextFrame(windowObject, () => {
      requestNextFrame(windowObject, () => {
        tryClick();
      });
    });
    return true;
  }

  function openItemViaDataAttr(viewId, attrName, itemId) {
    if (!itemId) {
      return false;
    }
    const safeId = escapeSelectorValue(String(itemId));
    return clickItemBySelector(viewId, `[${attrName}="${safeId}"]`);
  }

  return {
    Notebook: (itemId) => {
      if (!itemId) {
        return false;
      }
      showView(views.BIOLOGY_NOTEBOOK);
      return moduleRegistry.get('biologyNotebook')?.openEntry?.(itemId) !== undefined;
    },
    Protocol: (itemId) => rendererServices.protocol.openProtocol(itemId),
    Sample: (itemId) => {
      showView(views.SAMPLE_REGISTRY);
      return moduleRegistry.get('personalInventory')?.openSample?.(itemId) === true;
    },
    Chemical: (itemId) => openItemViaDataAttr(views.LAB_COMMON_INVENTORY, 'data-chemical-open', itemId),
    Assay: (itemId) => openItemViaDataAttr(views.ASSAY, 'data-assay-open-results', itemId),
    Project: (itemId) => {
      if (!itemId) {
        return false;
      }
      showView(views.BIOLOGY_NOTEBOOK);
      const biologyNotebook = moduleRegistry.get('biologyNotebook');
      if (typeof biologyNotebook?.openProjectDashboard !== 'function') {
        return false;
      }
      biologyNotebook.openProjectDashboard(itemId);
      return true;
    },
    Paper: (itemId) => openItemViaDataAttr(views.PAPERS, 'data-paper-view', itemId),
    Workflow: (itemId) => openItemViaDataAttr(views.WORKFLOW_MANAGEMENT, 'data-workflow-run-open', itemId)
  };
}
