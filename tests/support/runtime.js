const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    }
  };
}

function loadEsmStyleModule(filePath, extraGlobals = {}, additionalExports = []) {
  const source = fs.readFileSync(filePath, 'utf8');
  const exportNames = new Set();
  const declaredNames = new Set();
  const importGlobals = {};
  let importCounter = 0;

  const resolveImportSpecifier = (specifier) => {
    const raw = String(specifier || '').trim();
    if (!raw.startsWith('.')) {
      return raw;
    }
    const resolved = path.resolve(path.dirname(filePath), raw);
    return path.extname(resolved) ? resolved : `${resolved}.js`;
  };

  const buildImportExpression = (specifier) => {
    const resolved = resolveImportSpecifier(specifier);
    if (!resolved.startsWith('/')) {
      return `require(${JSON.stringify(resolved)})`;
    }
    if (!fs.existsSync(resolved)) {
      return `require(${JSON.stringify(resolved)})`;
    }

    const importedSource = fs.readFileSync(resolved, 'utf8');
    const looksLikeEsm = /^\s*export\s+/m.test(importedSource) || /^\s*import\s+/m.test(importedSource);
    if (!looksLikeEsm) {
      return `require(${JSON.stringify(resolved)})`;
    }

    const key = `__esmImport${importCounter += 1}`;
    importGlobals[key] = loadEsmStyleModule(resolved, extraGlobals);
    return key;
  };

  let transformed = source
    .replace(/^\s*import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm, (_match, names, specifier) => {
      const importedNames = names
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);
      importedNames.forEach((name) => {
        const [sourceName, localName = sourceName] = name.split(/\s+as\s+/).map((value) => value.trim());
        declaredNames.add(localName);
      });
      const destructuredNames = importedNames
        .map((name) => name.replace(/\s+as\s+/, ': '))
        .join(', ');
      return `const { ${destructuredNames} } = ${buildImportExpression(specifier)};`;
    })
    .replace(/^\s*import\s+\*\s+as\s+([A-Za-z0-9_$]+)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm, (_match, name, specifier) => {
      declaredNames.add(name);
      return `const ${name} = ${buildImportExpression(specifier)};`;
    })
    .replace(/^\s*import\s+([A-Za-z0-9_$]+)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm, (_match, name, specifier) => {
      declaredNames.add(name);
      return `const ${name} = ${buildImportExpression(specifier)};`;
    })
    .replace(/^\s*import\s+['"]([^'"]+)['"]\s*;?\s*$/gm, (_match, specifier) => (
      `${buildImportExpression(specifier)};`
    ))
    .replace(/^\s*export\s*\{([^}]+)\}\s*from\s+['"]([^'"]+)['"]\s*;?\s*$/gm, (_match, names, specifier) => {
      const importedBindings = [];
      const aliases = [];
      names
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((part) => {
          const [sourceName, exportName = sourceName] = part.split(/\s+as\s+/).map((value) => value.trim());
          exportNames.add(exportName);
          if (declaredNames.has(sourceName)) {
            if (sourceName !== exportName) {
              declaredNames.add(exportName);
              aliases.push(`const ${exportName} = ${sourceName};`);
            }
            return;
          }
          declaredNames.add(exportName);
          importedBindings.push(sourceName === exportName ? sourceName : `${sourceName}: ${exportName}`);
        });
      const importStatement = importedBindings.length > 0
        ? `const { ${importedBindings.join(', ')} } = ${buildImportExpression(specifier)};`
        : '';
      return [importStatement, ...aliases].filter(Boolean).join('\n');
    })
    .replace(/^\s*export\s+(const|let|var)\s+([A-Za-z0-9_$]+)\s*=/gm, (match, _kind, name) => {
      exportNames.add(name);
      return match.replace('export ', '');
    })
    .replace(/^\s*export\s+function\s+([A-Za-z0-9_$]+)\s*\(/gm, (match, name) => {
      exportNames.add(name);
      return match.replace('export ', '');
    })
    .replace(/^\s*export\s+async\s+function\s+([A-Za-z0-9_$]+)\s*\(/gm, (match, name) => {
      exportNames.add(name);
      return match.replace('export ', '');
    })
    .replace(/^\s*export\s+class\s+([A-Za-z0-9_$]+)\s*/gm, (match, name) => {
      exportNames.add(name);
      return match.replace('export ', '');
    })
    .replace(/^\s*export\s*\{([^}]+)\}\s*;?\s*$/gm, (_match, names) => {
      const aliases = [];
      names
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((part) => {
          const [left, right] = part.split(/\s+as\s+/);
          const sourceName = left.trim();
          const exportName = (right || left).trim();
          exportNames.add(exportName);
          if (sourceName !== exportName) {
            aliases.push(`const ${exportName} = ${sourceName};`);
          }
        });
      return aliases.join('\n');
    });

  additionalExports.forEach((name) => exportNames.add(name));
  transformed += `\nmodule.exports = { ${[...exportNames].join(', ')} };`;

  const context = vm.createContext({
    module: { exports: {} },
    exports: {},
    require,
    console,
    Date,
    Math,
    JSON,
    Array,
    Object,
    Number,
    String,
    Boolean,
    RegExp,
    Set,
    Map,
    structuredClone,
    ...importGlobals,
    ...extraGlobals
  });

  vm.runInContext(transformed, context, { filename: filePath });
  return context.module.exports;
}

function toCamelCase(value) {
  return String(value || '').replace(/-([a-z])/g, (_match, char) => char.toUpperCase());
}

class MockClassList {
  constructor() {
    this.valueSet = new Set();
  }

  add(...tokens) {
    tokens.forEach((token) => {
      if (token) {
        this.valueSet.add(String(token));
      }
    });
  }

  remove(...tokens) {
    tokens.forEach((token) => this.valueSet.delete(String(token)));
  }

  contains(token) {
    return this.valueSet.has(String(token));
  }

  toggle(token, force) {
    const normalized = String(token);
    if (typeof force === 'boolean') {
      if (force) {
        this.valueSet.add(normalized);
      } else {
        this.valueSet.delete(normalized);
      }
      return force;
    }

    if (this.valueSet.has(normalized)) {
      this.valueSet.delete(normalized);
      return false;
    }
    this.valueSet.add(normalized);
    return true;
  }
}

class MockElement {
  constructor(id = '') {
    this.id = id;
    this.value = '';
    this.checked = false;
    this.hidden = false;
    this.textContent = '';
    this.dataset = {};
    this.files = [];
    this.style = {
      setProperty() {}
    };
    this.classList = new MockClassList();
    this.listeners = {};
    this.attributes = new Map();
    this._innerHTML = '';
    this._queryCache = new Map();
    this._submitButton = null;
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value || '');
    this._queryCache.clear();
  }

  addEventListener(type, listener) {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }
    this.listeners[type].push(listener);
  }

  removeEventListener(type, listener) {
    const handlers = this.listeners[type];
    if (!handlers || !handlers.length) {
      return;
    }
    this.listeners[type] = handlers.filter((item) => item !== listener);
  }

  dispatch(type, event = {}) {
    const handlers = [...(this.listeners[type] || [])];
    handlers.forEach((handler) => {
      handler({
        preventDefault() {},
        stopPropagation() {},
        ...event,
        currentTarget: this,
        target: event.target || this
      });
    });
  }

  click() {
    this.dispatch('click');
  }

  change() {
    this.dispatch('change');
  }

  setSelectionRange() {}

  focus() {}

  reset() {}

  setAttribute(name, value) {
    this.attributes.set(String(name || ''), String(value));
  }

  getAttribute(name) {
    const key = String(name || '');
    return this.attributes.has(key) ? this.attributes.get(key) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(String(name || ''));
  }

  hasAttribute(name) {
    return this.attributes.has(String(name || ''));
  }

  setSubmitButton(element) {
    this._submitButton = element;
  }

  querySelector(selector) {
    if (selector === 'button[type="submit"]') {
      return this._submitButton;
    }
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const key = String(selector || '');
    if (!this._queryCache.has(key)) {
      this._queryCache.set(key, this._buildDataMatches(key));
    }
    return this._queryCache.get(key);
  }

  _buildDataMatches(selector) {
    const attrMatch = selector.match(/\[data-([a-z0-9-]+)(?:=[^\]]+)?\]/i);
    if (!attrMatch) {
      return [];
    }

    const dataKey = attrMatch[1];
    const datasetKey = toCamelCase(dataKey);
    const attributeName = `data-${dataKey}`;
    const pattern = new RegExp(`${attributeName}(?:=\"([^\"]*)\")?(?=[\\s>])`, 'g');

    const results = [];
    let match;
    while ((match = pattern.exec(this._innerHTML))) {
      const element = new MockElement(`${this.id}:${attributeName}:${results.length}`);
      element.dataset[datasetKey] = String(match[1] || '');
      const tagStart = this._innerHTML.lastIndexOf('<', match.index);
      const tagEnd = this._innerHTML.indexOf('>', match.index);
      const tagMarkup = tagStart >= 0 && tagEnd >= tagStart
        ? this._innerHTML.slice(tagStart, tagEnd + 1)
        : '';
      const valueMatch = tagMarkup.match(/\bvalue="([^"]*)"/i);
      if (valueMatch) {
        element.value = String(valueMatch[1] || '');
      }
      element.hidden = /\shidden(?:[\s=>]|$)/i.test(tagMarkup);
      results.push(element);
    }
    return results;
  }
}

function createMockDocument(ids = []) {
  const elements = new Map();
  ids.forEach((id) => {
    elements.set(id, new MockElement(id));
  });
  const appended = [];

  return {
    body: {
      appendChild(node) {
        appended.push(node);
        return node;
      }
    },
    createElement(tagName) {
      return new MockElement(String(tagName || ''));
    },
    // ponytail: attribute selectors over appended nodes only — enough for the
    // shared transient notice. Widen it when a test needs a real selector.
    querySelector(selector) {
      const attribute = String(selector || '').match(/^\[([a-z0-9-]+)\]$/i);
      if (!attribute) {
        return null;
      }
      return appended.find((node) => node.hasAttribute(attribute[1])) || null;
    },
    getElementById(id) {
      const key = String(id || '');
      if (!elements.has(key)) {
        elements.set(key, new MockElement(key));
      }
      return elements.get(key);
    }
  };
}

function wireFormReset(formElement, inputElements) {
  formElement.reset = () => {
    (inputElements || []).forEach((item) => {
      item.value = '';
      item.checked = false;
      item.files = [];
    });
  };
}

function trigger(element, type, event = {}) {
  element.dispatch(type, event);
}

function flushAsync() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function btoaPolyfill(value) {
  return Buffer.from(String(value || ''), 'binary').toString('base64');
}

function atobPolyfill(value) {
  return Buffer.from(String(value || ''), 'base64').toString('binary');
}

function encodeBase64Url(raw) {
  return Buffer.from(String(raw || ''), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

module.exports = {
  createMemoryStorage,
  loadEsmStyleModule,
  toCamelCase,
  MockClassList,
  MockElement,
  createMockDocument,
  wireFormReset,
  trigger,
  flushAsync,
  btoaPolyfill,
  atobPolyfill,
  encodeBase64Url
};
