const CHEMICAL_IMPORT_FIELDS = [
  { key: 'name', label: 'Name', description: 'Chemical, reagent, compound, product, or item name.' },
  { key: 'casNumber', label: 'CAS Number', description: 'CAS registry number or CAS identifier.' },
  { key: 'location', label: 'Location', description: 'Storage location, storage position, shelf, freezer, cabinet, room, or position.' },
  { key: 'vendor', label: 'Vendor', description: 'Vendor, supplier, manufacturer, company, or brand.' },
  { key: 'catalogNumber', label: 'Catalog Number', description: 'Catalog, catalogue, SKU, product, part, or item number.' },
  { key: 'unitSize', label: 'Unit Size', description: 'Package size, unit size, bottle size, weight, or volume per item.' },
  { key: 'price', label: 'Price', description: 'Price, cost, or unit price.' },
  { key: 'amountInStock', label: 'Amount in Stock', description: 'Quantity on hand, count, stock, remaining amount, or available inventory.' },
  { key: 'url', label: 'URL', description: 'Product URL, supplier link, website, or web page.' },
  { key: 'expirationDate', label: 'Expiration Date', description: 'Expiration, expiry, use-by, or best-before date.' }
];

const CHEMICAL_IMPORT_ALIASES = {
  name: [
    'name',
    'chemical',
    'chemical name',
    'compound',
    'compound name',
    'item',
    'item name',
    'material',
    'material name',
    'product',
    'product name',
    'reagent',
    'reagent name'
  ],
  casNumber: [
    'cas',
    'cas number',
    'cas no',
    'cas #',
    'cas registry',
    'cas registry number',
    'registry number'
  ],
  location: [
    'location',
    'position',
    'storage',
    'storage location',
    'storage position',
    'place',
    'where',
    'room',
    'shelf',
    'freezer',
    'fridge',
    'refrigerator',
    'cabinet',
    'box',
    'rack'
  ],
  vendor: [
    'vendor',
    'supplier',
    'manufacturer',
    'company',
    'brand',
    'source'
  ],
  catalogNumber: [
    'catalog',
    'catalog number',
    'catalog no',
    'catalog #',
    'catalogue',
    'catalogue number',
    'cat',
    'cat no',
    'cat #',
    'sku',
    'product number',
    'part number',
    'item number'
  ],
  unitSize: [
    'unit size',
    'package size',
    'pack size',
    'bottle size',
    'container size',
    'size',
    'volume',
    'weight'
  ],
  price: [
    'price',
    'cost',
    'unit price',
    'unit cost'
  ],
  amountInStock: [
    'stock',
    'amount',
    'amount in stock',
    'qty',
    'quantity',
    'quantity on hand',
    'on hand',
    'inventory',
    'count',
    'remaining',
    'available',
    'current amount'
  ],
  url: [
    'url',
    'link',
    'product url',
    'supplier url',
    'web',
    'website',
    'web site'
  ],
  expirationDate: [
    'expiration',
    'expiration date',
    'expiry',
    'expiry date',
    'exp',
    'exp date',
    'expires',
    'use by',
    'best before'
  ]
};

const CHEMICAL_IMPORT_FIELD_BY_NORMALIZED_ALIAS = new Map();
Object.entries(CHEMICAL_IMPORT_ALIASES).forEach(([field, aliases]) => {
  aliases.forEach((alias) => {
    CHEMICAL_IMPORT_FIELD_BY_NORMALIZED_ALIAS.set(normalizeImportHeader(alias), field);
  });
});

function normalizeImportHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[#\u2116]/g, ' number ')
    .replace(/[_/\\().:;,[\]{}-]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeImportFieldKey(value) {
  const normalized = String(value || '').trim().replace(/[^a-zA-Z0-9]+/g, '').toLowerCase();
  if (normalized === 'ignore' || normalized === 'ignored' || normalized === 'none' || normalized === 'skip') {
    return 'ignore';
  }
  const match = CHEMICAL_IMPORT_FIELDS.find((field) => field.key.toLowerCase() === normalized);
  if (match) {
    return match.key;
  }
  if (['cas', 'casno', 'casnum', 'casnumber'].includes(normalized)) {
    return 'casNumber';
  }
  if (['catalog', 'catalogue', 'catno', 'catnumber', 'catalogno', 'catalognumber', 'sku'].includes(normalized)) {
    return 'catalogNumber';
  }
  if (['stock', 'quantity', 'qty', 'amount', 'amountstock', 'amountinstock'].includes(normalized)) {
    return 'amountInStock';
  }
  if (['expiry', 'expiration', 'expdate', 'expirydate', 'expirationdate'].includes(normalized)) {
    return 'expirationDate';
  }
  return '';
}

function fieldLabel(fieldKey) {
  return CHEMICAL_IMPORT_FIELDS.find((field) => field.key === fieldKey)?.label || fieldKey;
}

function guessChemicalImportField(header) {
  const normalized = normalizeImportHeader(header);
  if (!normalized) {
    return '';
  }
  const exact = CHEMICAL_IMPORT_FIELD_BY_NORMALIZED_ALIAS.get(normalized);
  if (exact) {
    return exact;
  }
  const compact = normalized.replace(/\s+/g, '');
  if (/\bcas\b/.test(normalized) || compact.includes('casregistry')) {
    return 'casNumber';
  }
  if (/\b(cat|catalog|catalogue|sku)\b/.test(normalized) || compact.includes('partnumber') || compact.includes('productnumber')) {
    return 'catalogNumber';
  }
  if (/\b(exp|expiry|expiration|expires)\b/.test(normalized) || compact.includes('bestbefore')) {
    return 'expirationDate';
  }
  if (/\b(url|link|website|web)\b/.test(normalized)) {
    return 'url';
  }
  if (/\b(vendor|supplier|manufacturer|company|brand)\b/.test(normalized)) {
    return 'vendor';
  }
  if (/\b(location|position|storage|shelf|freezer|fridge|cabinet|rack|box|room)\b/.test(normalized)) {
    return 'location';
  }
  if (/\b(stock|qty|quantity|remaining|available|inventory|count)\b/.test(normalized) || compact.includes('onhand')) {
    return 'amountInStock';
  }
  if (compact.includes('unitsize') || compact.includes('packagesize') || compact.includes('packsize') || compact.includes('bottlesize')) {
    return 'unitSize';
  }
  if (/\b(price|cost)\b/.test(normalized)) {
    return 'price';
  }
  if (/\b(name|chemical|compound|reagent|material|product|item)\b/.test(normalized) && !/\b(number|no|#|id)\b/.test(normalized)) {
    return 'name';
  }
  return '';
}

export function initLabCommonInventory({ state, persist, createId, safeText }) {
  const chemicalOpenAddBtn = document.getElementById('chemical-open-add-btn');
  const chemicalImportBtn = document.getElementById('chemical-import-btn');
  const chemicalImportFile = document.getElementById('chemical-import-file');
  const chemicalImportStatus = document.getElementById('chemical-import-status');
  const chemicalDialogOverlay = document.getElementById('chemical-dialog-overlay');
  const chemicalDialogTitle = document.getElementById('chemical-dialog-title');
  const chemicalDialogCloseBtn = document.getElementById('chemical-dialog-close-btn');
  const chemicalForm = document.getElementById('chemical-form');
  const chemicalId = document.getElementById('chemical-id');
  const chemicalName = document.getElementById('chemical-name');
  const chemicalCas = document.getElementById('chemical-cas');
  const chemicalLocation = document.getElementById('chemical-location');
  const chemicalVendor = document.getElementById('chemical-vendor');
  const chemicalCatalogNumber = document.getElementById('chemical-catalog-number');
  const chemicalUnitSize = document.getElementById('chemical-unit-size');
  const chemicalPrice = document.getElementById('chemical-price');
  const chemicalStock = document.getElementById('chemical-stock');
  const chemicalUrl = document.getElementById('chemical-url');
  const chemicalExpiration = document.getElementById('chemical-expiration');
  const chemicalCancelBtn = document.getElementById('chemical-cancel-btn');
  const chemicalList = document.getElementById('chemical-list');
  const chemicalSearch = document.getElementById('chemical-search');
  const chemicalResultsSummary = document.getElementById('chemical-results-summary');
  const chemicalFilterLocation = document.getElementById('chemical-filter-location');
  const chemicalSort = document.getElementById('chemical-sort');
  const chemicalDetailPanel = document.getElementById('chemical-detail-panel');
  const chemicalDetailTitle = document.getElementById('chemical-detail-title');
  const chemicalDetailContent = document.getElementById('chemical-detail-content');
  const chemicalDetailEditBtn = document.getElementById('chemical-detail-edit-btn');
  const chemicalDetailDeleteBtn = document.getElementById('chemical-detail-delete-btn');
  const blockchainList = document.getElementById('inventory-blockchain-list');

  chemicalOpenAddBtn.addEventListener('click', startNewChemical);
  chemicalImportBtn?.addEventListener('click', () => {
    chemicalImportFile?.click();
  });
  chemicalImportFile?.addEventListener('change', onChemicalImportFileChange);
  chemicalDialogCloseBtn.addEventListener('click', resetChemicalForm);
  chemicalDialogOverlay.addEventListener('click', onChemicalDialogOverlayClick);
  document.addEventListener('keydown', onChemicalDialogKeydown);
  chemicalForm.addEventListener('submit', onChemicalSubmit);
  chemicalCancelBtn.addEventListener('click', resetChemicalForm);
  chemicalSearch.addEventListener('input', renderChemicalList);
  chemicalFilterLocation.addEventListener('change', renderChemicalList);
  chemicalSort.addEventListener('change', renderChemicalList);
  chemicalList.addEventListener('click', onChemicalListClick);
  chemicalDetailEditBtn.addEventListener('click', () => {
    if (!selectedChemicalId) {
      return;
    }
    editChemical(selectedChemicalId);
  });
  chemicalDetailDeleteBtn.addEventListener('click', () => {
    if (!selectedChemicalId) {
      return;
    }
    deleteChemical(selectedChemicalId);
  });

  let selectedChemicalId = '';
  let lastChemicalSqliteSyncKey = '';
  ensureLabInventoryShape();

  function ensureLabInventoryShape() {
    if (!state.labInventory || typeof state.labInventory !== 'object') {
      state.labInventory = {
        chemicals: [],
        blocks: [],
        lastLocationNumber: 0
      };
    }
    if (!Array.isArray(state.labInventory.chemicals)) {
      state.labInventory.chemicals = [];
    }
    if (!Array.isArray(state.labInventory.blocks)) {
      state.labInventory.blocks = [];
    }
    if (!Number.isFinite(Number(state.labInventory.lastLocationNumber))) {
      state.labInventory.lastLocationNumber = 0;
    }
    if (!state.labInventory.locationCodeMap || typeof state.labInventory.locationCodeMap !== 'object') {
      state.labInventory.locationCodeMap = {};
    }
    if (!state.labInventory.locationCodeNextByLocation || typeof state.labInventory.locationCodeNextByLocation !== 'object') {
      state.labInventory.locationCodeNextByLocation = {};
    }
  }

  function normalizeLocationKey(value) {
    return String(value || '').trim().toLowerCase();
  }

  function updateChemicalDialogTitle() {
    if (!chemicalDialogTitle) {
      return;
    }
    chemicalDialogTitle.textContent = chemicalId.value ? 'Edit Chemical' : 'Add Chemical';
  }

  function openChemicalDialog() {
    if (!chemicalDialogOverlay) {
      return;
    }
    updateChemicalDialogTitle();
    chemicalDialogOverlay.hidden = false;
    requestAnimationFrame(() => {
      chemicalName.focus();
    });
  }

  function clearChemicalForm() {
    chemicalId.value = '';
    chemicalForm.reset();
    renderLocationOptions();
    updateChemicalDialogTitle();
  }

  function startNewChemical() {
    clearChemicalForm();
    openChemicalDialog();
  }

  function resetChemicalForm() {
    clearChemicalForm();
    if (chemicalDialogOverlay) {
      chemicalDialogOverlay.hidden = true;
    }
  }

  function onChemicalDialogOverlayClick(event) {
    if (event.target === chemicalDialogOverlay) {
      resetChemicalForm();
    }
  }

  function onChemicalDialogKeydown(event) {
    if (event.key === 'Escape' && chemicalDialogOverlay && !chemicalDialogOverlay.hidden) {
      event.preventDefault();
      resetChemicalForm();
    }
  }

  function encodeLocationLetter(index) {
    let value = Number(index) || 0;
    let out = '';
    while (value >= 0) {
      out = String.fromCharCode(65 + (value % 26)) + out;
      value = Math.floor(value / 26) - 1;
    }
    return out;
  }

  function ensureLocationLetter(location) {
    ensureLabInventoryShape();
    const key = normalizeLocationKey(location);
    if (!key) {
      return 'X';
    }
    const existing = String(state.labInventory.locationCodeMap[key] || '').trim().toUpperCase();
    if (existing) {
      return existing;
    }

    const usedLetters = new Set(
      Object.values(state.labInventory.locationCodeMap || {})
        .map((value) => String(value || '').trim().toUpperCase())
        .filter(Boolean)
    );

    let index = 0;
    let candidate = encodeLocationLetter(index);
    while (usedLetters.has(candidate)) {
      index += 1;
      candidate = encodeLocationLetter(index);
    }
    state.labInventory.locationCodeMap[key] = candidate;
    return candidate;
  }

  function parseLocationCode(value) {
    const matched = String(value || '').trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);
    if (!matched) {
      return null;
    }
    return {
      letter: matched[1],
      number: Number(matched[2]) || 0
    };
  }

  function readMaxLocationCodeNumber(location, letter) {
    const key = normalizeLocationKey(location);
    return state.labInventory.chemicals.reduce((max, item) => {
      if (normalizeLocationKey(item?.location) !== key) {
        return max;
      }
      const parsed = parseLocationCode(item?.locationCode);
      if (parsed && parsed.letter === letter) {
        return Math.max(max, parsed.number);
      }
      if (!parsed && Number.isFinite(Number(item?.locationNumber))) {
        return Math.max(max, Number(item.locationNumber));
      }
      return max;
    }, 0);
  }

  function assignLocationCode(location, existingCode = '') {
    ensureLabInventoryShape();
    const key = normalizeLocationKey(location);
    const parsedExisting = parseLocationCode(existingCode);
    const existingMappedLetter = String(state.labInventory.locationCodeMap[key] || '').trim().toUpperCase();
    if (!existingMappedLetter && parsedExisting?.letter) {
      state.labInventory.locationCodeMap[key] = parsedExisting.letter;
    }
    const letter = ensureLocationLetter(location);
    if (parsedExisting && parsedExisting.letter === letter && parsedExisting.number > 0) {
      const nextCurrent = Number(state.labInventory.locationCodeNextByLocation[key]) || 1;
      state.labInventory.locationCodeNextByLocation[key] = Math.max(nextCurrent, parsedExisting.number + 1);
      return `${letter}${parsedExisting.number}`;
    }

    const nextSeed = Number(state.labInventory.locationCodeNextByLocation[key]) || 0;
    const computedMax = readMaxLocationCodeNumber(location, letter);
    const nextNumber = Math.max(nextSeed, computedMax + 1, 1);
    state.labInventory.locationCodeNextByLocation[key] = nextNumber + 1;
    state.labInventory.lastLocationNumber = Math.max(Number(state.labInventory.lastLocationNumber) || 0, nextNumber);
    return `${letter}${nextNumber}`;
  }

  function ensureChemicalCodes() {
    ensureLabInventoryShape();
    const nextMap = {};
    state.labInventory.chemicals.forEach((item) => {
      const locationKey = normalizeLocationKey(item?.location);
      if (!locationKey) {
        return;
      }
      const parsed = parseLocationCode(item?.locationCode);
      if (!parsed) {
        return;
      }
      if (!state.labInventory.locationCodeMap[locationKey]) {
        state.labInventory.locationCodeMap[locationKey] = parsed.letter;
      }
      nextMap[locationKey] = Math.max(Number(nextMap[locationKey]) || 1, parsed.number + 1);
    });
    Object.entries(nextMap).forEach(([key, value]) => {
      const current = Number(state.labInventory.locationCodeNextByLocation[key]) || 1;
      state.labInventory.locationCodeNextByLocation[key] = Math.max(current, Number(value) || 1);
    });

    let changed = false;
    let maxLocationNumber = Number(state.labInventory.lastLocationNumber) || 0;
    state.labInventory.chemicals = state.labInventory.chemicals.map((item) => {
      const chemical = item && typeof item === 'object' ? { ...item } : {};
      const location = String(chemical.location || '').trim();
      if (!location) {
        return chemical;
      }
      const currentCode = String(chemical.locationCode || '').trim().toUpperCase();
      const nextCode = assignLocationCode(location, currentCode);
      const parsed = parseLocationCode(nextCode);
      const nextLocationNumber = Number(parsed?.number || chemical.locationNumber || 0);
      maxLocationNumber = Math.max(maxLocationNumber, nextLocationNumber);
      if (nextCode !== currentCode || Number(chemical.locationNumber) !== Number(parsed?.number || 0)) {
        changed = true;
      }
      return {
        ...chemical,
        locationCode: nextCode,
        locationNumber: nextLocationNumber
      };
    });
    if ((Number(state.labInventory.lastLocationNumber) || 0) !== maxLocationNumber) {
      state.labInventory.lastLocationNumber = maxLocationNumber;
      changed = true;
    }
    return changed;
  }

  function buildChemicalSqliteSyncKey() {
    const storagePath = String(state.settings?.storagePath || '').trim();
    const summary = state.labInventory.chemicals
      .map((item) => `${item.id}|${item.locationCode || ''}|${item.updatedAt || ''}`)
      .join('||');
    const locationCodeMapSummary = Object.entries(state.labInventory.locationCodeMap || {})
      .map(([location, letter]) => `${location}:${letter}`)
      .sort()
      .join('|');
    const nextByLocationSummary = Object.entries(state.labInventory.locationCodeNextByLocation || {})
      .map(([location, number]) => `${location}:${Number(number) || 0}`)
      .sort()
      .join('|');
    return `${storagePath}::${summary}::${state.labInventory.blocks.length}::${Number(state.labInventory.lastLocationNumber) || 0}::${locationCodeMapSummary}::${nextByLocationSummary}`;
  }

  async function syncChemicalSqliteBundle(force = false) {
    const storagePath = String(state.settings?.storagePath || '').trim();
    if (!storagePath || !window.enanaApi?.syncSqliteBundle) {
      return;
    }

    const syncKey = buildChemicalSqliteSyncKey();
    if (!force && syncKey === lastChemicalSqliteSyncKey) {
      return;
    }

    const normalizedRoot = storagePath.replace(/[\\/]+$/, '');
    const targetPath = `${normalizedRoot}/enana-chemicals.index.sqlite`;
    const inventorySnapshot = {
      labInventory: {
        chemicals: Array.isArray(state.labInventory.chemicals) ? state.labInventory.chemicals : [],
        blocks: Array.isArray(state.labInventory.blocks) ? state.labInventory.blocks : [],
        lastLocationNumber: Number(state.labInventory.lastLocationNumber) || 0,
        locationCodeMap: state.labInventory.locationCodeMap || {},
        locationCodeNextByLocation: state.labInventory.locationCodeNextByLocation || {}
      },
      inventory: state.inventory && typeof state.inventory === 'object' ? state.inventory : {},
      settings: {
        storagePath,
        inventoryLocations: Array.isArray(state.settings?.inventoryLocations)
          ? state.settings.inventoryLocations
          : []
      }
    };

    try {
      const result = await window.enanaApi.syncSqliteBundle({
        mode: 'chemical',
        snapshot: inventorySnapshot,
        sqlitePath: targetPath
      });
      if (result?.ok) {
        lastChemicalSqliteSyncKey = syncKey;
      } else {
        console.warn('Failed to sync chemical sqlite bundle:', result?.error || targetPath);
      }
    } catch (error) {
      console.warn('Failed to sync chemical sqlite bundle:', error);
    }
  }

  function simpleHash(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash |= 0;
    }
    return `h${Math.abs(hash).toString(16)}`;
  }

  function appendBlock(action, payload) {
    const prev = state.labInventory.blocks[state.labInventory.blocks.length - 1];
    const block = {
      index: state.labInventory.blocks.length + 1,
      timestamp: new Date().toISOString(),
      action,
      prevHash: prev?.hash || 'GENESIS',
      payload
    };
    block.hash = simpleHash(JSON.stringify(block));
    state.labInventory.blocks.push(block);
  }

  function broadcastInventoryUpdate(chemical) {
    const recipients = Array.from(new Set(
      state.members
        .map((member) => member.enanaEmail)
        .filter((email) => email && email.trim())
    ));

    const from = state.settings.personalInfo.enanaEmail || 'system@enana.local';
    recipients
      .filter((to) => to !== from)
      .forEach((to) => {
        state.messages.push({
          id: createId(),
          from,
          to,
          subject: '[Inventory Sync] Chemical Updated',
          body: `${chemical.name} (${chemical.casNumber}) updated.`,
          createdAt: new Date().toISOString(),
          readBy: [],
          type: 'inventory_sync',
          payload: {
            chemical
          }
        });
      });
  }

  function setChemicalImportStatus(message, tone = 'idle') {
    if (!chemicalImportStatus) {
      return;
    }
    chemicalImportStatus.textContent = String(message || '');
    chemicalImportStatus.dataset.status = tone;
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, offset + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  async function readImportFileBase64(file) {
    const buffer = await file.arrayBuffer();
    return arrayBufferToBase64(buffer);
  }

  function parseCsvRows(rawText) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    const text = String(rawText || '').replace(/^\uFEFF/, '');
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (char === '"') {
        if (inQuotes && text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (char === ',' && !inQuotes) {
        row.push(cell);
        cell = '';
        continue;
      }
      if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && text[index + 1] === '\n') {
          index += 1;
        }
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
        continue;
      }
      cell += char;
    }
    if (cell || row.length) {
      row.push(cell);
      rows.push(row);
    }
    const normalized = rows
      .map((item) => item.map((cellValue) => String(cellValue || '').trim()))
      .filter((item) => item.some((cellValue) => cellValue));
    return {
      headers: normalized[0] || [],
      rows: normalized.slice(1),
      rowCount: Math.max(0, normalized.length - 1),
      format: 'csv'
    };
  }

  async function parseChemicalImportFile(file) {
    if (window.enanaApi?.parseChemicalImportFile) {
      const dataBase64 = await readImportFileBase64(file);
      const parsed = await window.enanaApi.parseChemicalImportFile({
        fileName: file.name,
        dataBase64
      });
      if (!parsed?.ok) {
        throw new Error(parsed?.error || 'Could not parse chemical import file.');
      }
      return parsed;
    }

    if (!/\.csv$/i.test(file.name || '')) {
      throw new Error('This build can only import Excel files through the desktop parser.');
    }
    return parseCsvRows(await file.text());
  }

  function mapChemicalImportHeadersLocally(headers) {
    const fieldToColumn = {};
    const columnToField = {};
    const decisions = [];
    const unmappedHeaders = [];

    headers.forEach((header, index) => {
      const cleanHeader = String(header || '').trim();
      if (!cleanHeader) {
        return;
      }
      const field = guessChemicalImportField(cleanHeader);
      if (field && fieldToColumn[field] == null) {
        fieldToColumn[field] = index;
        columnToField[index] = field;
        decisions.push({
          header: cleanHeader,
          field,
          source: 'local'
        });
        return;
      }
      unmappedHeaders.push(cleanHeader);
    });

    return {
      fieldToColumn,
      columnToField,
      decisions,
      unmappedHeaders,
      usedLlm: false,
      llmError: ''
    };
  }

  function buildLlmHeaderPrompt(headers, rows, localInference) {
    const previewRows = rows.slice(0, 5).map((row) => {
      const entry = {};
      headers.forEach((header, index) => {
        entry[String(header || `Column ${index + 1}`).trim() || `Column ${index + 1}`] = String(row[index] ?? '').trim();
      });
      return entry;
    });
    const fields = CHEMICAL_IMPORT_FIELDS.map((field) => ({
      key: field.key,
      label: field.label,
      description: field.description
    }));
    return [
      'Map spreadsheet column headers into this chemical inventory schema.',
      'Return only JSON with this shape: {"mapping":{"Source Header":"fieldKey or ignore"},"notes":"short"}',
      'Use "ignore" for columns that do not fit. Important example: "position" should map to "location" when it means storage position.',
      `Allowed field keys: ${CHEMICAL_IMPORT_FIELDS.map((field) => field.key).join(', ')}`,
      '',
      `Schema: ${JSON.stringify(fields)}`,
      `Headers: ${JSON.stringify(headers)}`,
      `Local mapping already found: ${JSON.stringify(localInference.decisions)}`,
      `Preview rows: ${JSON.stringify(previewRows)}`
    ].join('\n');
  }

  function parseJsonObjectFromText(text) {
    const raw = String(text || '').trim();
    if (!raw) {
      return null;
    }
    const unfenced = raw
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/i, '')
      .trim();
    try {
      return JSON.parse(unfenced);
    } catch {
      const start = unfenced.indexOf('{');
      const end = unfenced.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(unfenced.slice(start, end + 1));
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  async function requestLlmChemicalHeaderMapping(headers, rows, localInference) {
    if (!window.enanaApi?.runCodexLlmPrompt) {
      return null;
    }
    const prompt = buildLlmHeaderPrompt(headers, rows, localInference);
    const result = await window.enanaApi.runCodexLlmPrompt({
      model: String(state.settings?.llm?.model || '').trim(),
      reasoningEffort: String(state.settings?.llm?.reasoningEffort || '').trim(),
      prompt
    });
    if (!result?.ok) {
      throw new Error(result?.error || 'LLM header mapping failed.');
    }
    return parseJsonObjectFromText(result.text);
  }

  function findHeaderIndex(headers, headerName) {
    const normalized = normalizeImportHeader(headerName);
    return headers.findIndex((header) => normalizeImportHeader(header) === normalized);
  }

  function applyLlmHeaderMapping(headers, inference, llmPayload) {
    const rawMapping = llmPayload?.mapping && typeof llmPayload.mapping === 'object'
      ? llmPayload.mapping
      : (llmPayload && typeof llmPayload === 'object' ? llmPayload : {});
    Object.entries(rawMapping).forEach(([headerName, fieldName]) => {
      let headerIndex = findHeaderIndex(headers, headerName);
      let field = normalizeImportFieldKey(fieldName);

      if (headerIndex < 0) {
        const keyAsField = normalizeImportFieldKey(headerName);
        const valueAsHeaderIndex = findHeaderIndex(headers, fieldName);
        if (keyAsField && valueAsHeaderIndex >= 0) {
          headerIndex = valueAsHeaderIndex;
          field = keyAsField;
        }
      }

      if (headerIndex < 0 || !field || field === 'ignore') {
        return;
      }
      if (inference.fieldToColumn[field] != null || inference.columnToField[headerIndex]) {
        return;
      }
      inference.fieldToColumn[field] = headerIndex;
      inference.columnToField[headerIndex] = field;
      inference.decisions.push({
        header: String(headers[headerIndex] || '').trim(),
        field,
        source: 'llm'
      });
    });
    inference.unmappedHeaders = headers.filter((header, index) => {
      return String(header || '').trim() && !inference.columnToField[index];
    });
    inference.usedLlm = true;
    return inference;
  }

  async function inferChemicalImportHeaders(headers, rows) {
    const cleanHeaders = headers.map((header, index) => String(header || `Column ${index + 1}`).trim() || `Column ${index + 1}`);
    const inference = mapChemicalImportHeadersLocally(cleanHeaders);
    const needsLlm = inference.unmappedHeaders.length > 0
      || inference.fieldToColumn.name == null
      || inference.fieldToColumn.location == null;
    if (!needsLlm || !window.enanaApi?.runCodexLlmPrompt) {
      return inference;
    }
    try {
      const llmPayload = await requestLlmChemicalHeaderMapping(cleanHeaders, rows, inference);
      if (llmPayload) {
        applyLlmHeaderMapping(cleanHeaders, inference, llmPayload);
      }
    } catch (error) {
      inference.llmError = String(error?.message || error);
    }
    return inference;
  }

  function cleanImportCell(value) {
    return String(value ?? '').trim();
  }

  function mappedImportValue(row, inference, field) {
    const index = inference.fieldToColumn[field];
    if (index == null || index < 0) {
      return '';
    }
    return cleanImportCell(row[index]);
  }

  function normalizeImportedDate(value) {
    const raw = cleanImportCell(value);
    if (!raw) {
      return '';
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return raw;
    }
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 20000 && numeric < 80000) {
      const excelEpoch = Date.UTC(1899, 11, 30);
      const date = new Date(excelEpoch + (Math.round(numeric) * 86400000));
      return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
    }
    const parsed = Date.parse(raw);
    if (!Number.isFinite(parsed)) {
      return raw;
    }
    return new Date(parsed).toISOString().slice(0, 10);
  }

  function ensureImportedLocation(location) {
    const cleanLocation = cleanImportCell(location) || 'Imported';
    if (!state.settings || typeof state.settings !== 'object') {
      state.settings = {};
    }
    if (!Array.isArray(state.settings.inventoryLocations)) {
      state.settings.inventoryLocations = [];
    }
    const exists = state.settings.inventoryLocations.some((item) => normalizeLocationKey(item) === normalizeLocationKey(cleanLocation));
    if (!exists) {
      state.settings.inventoryLocations.push(cleanLocation);
    }
    return cleanLocation;
  }

  function findExistingChemicalForImport(record) {
    const casKey = cleanImportCell(record.casNumber).toLowerCase();
    const catalogKey = cleanImportCell(record.catalogNumber).toLowerCase();
    const vendorKey = cleanImportCell(record.vendor).toLowerCase();
    const nameKey = cleanImportCell(record.name).toLowerCase();
    const locationKey = normalizeLocationKey(record.location);

    if (casKey) {
      const matchByCas = state.labInventory.chemicals.find((item) => cleanImportCell(item.casNumber).toLowerCase() === casKey);
      if (matchByCas) {
        return matchByCas;
      }
    }
    if (catalogKey) {
      const matchByCatalog = state.labInventory.chemicals.find((item) => {
        return cleanImportCell(item.catalogNumber).toLowerCase() === catalogKey
          && (!vendorKey || cleanImportCell(item.vendor).toLowerCase() === vendorKey);
      });
      if (matchByCatalog) {
        return matchByCatalog;
      }
    }
    if (nameKey && locationKey) {
      return state.labInventory.chemicals.find((item) => {
        return cleanImportCell(item.name).toLowerCase() === nameKey
          && normalizeLocationKey(item.location) === locationKey;
      }) || null;
    }
    return null;
  }

  function mergeImportedChemicalRecord(imported, existing = null) {
    const sameLocation = normalizeLocationKey(imported.location) === normalizeLocationKey(existing?.location);
    const locationCode = assignLocationCode(imported.location, sameLocation ? existing?.locationCode || '' : '');
    const parsedLocationCode = parseLocationCode(locationCode);
    const locationNumber = Number(parsedLocationCode?.number || existing?.locationNumber || 0);
    state.labInventory.lastLocationNumber = Math.max(Number(state.labInventory.lastLocationNumber) || 0, locationNumber);

    const valueOrExisting = (field) => {
      const importedValue = cleanImportCell(imported[field]);
      return importedValue || cleanImportCell(existing?.[field]);
    };

    return {
      ...(existing || {}),
      id: existing?.id || createId(),
      name: cleanImportCell(imported.name) || cleanImportCell(existing?.name),
      casNumber: valueOrExisting('casNumber'),
      location: cleanImportCell(imported.location) || cleanImportCell(existing?.location) || 'Imported',
      locationCode,
      locationNumber,
      vendor: valueOrExisting('vendor'),
      catalogNumber: valueOrExisting('catalogNumber'),
      unitSize: valueOrExisting('unitSize'),
      price: valueOrExisting('price'),
      amountInStock: valueOrExisting('amountInStock'),
      url: valueOrExisting('url'),
      expirationDate: normalizeImportedDate(imported.expirationDate) || cleanImportCell(existing?.expirationDate),
      updatedAt: new Date().toISOString()
    };
  }

  function importChemicalRows(parsed, inference, fileName) {
    ensureLabInventoryShape();
    const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
    const result = {
      created: 0,
      updated: 0,
      skipped: 0,
      importedIds: []
    };

    rows.forEach((row) => {
      const imported = {
        name: mappedImportValue(row, inference, 'name'),
        casNumber: mappedImportValue(row, inference, 'casNumber'),
        location: ensureImportedLocation(mappedImportValue(row, inference, 'location') || 'Imported'),
        vendor: mappedImportValue(row, inference, 'vendor'),
        catalogNumber: mappedImportValue(row, inference, 'catalogNumber'),
        unitSize: mappedImportValue(row, inference, 'unitSize'),
        price: mappedImportValue(row, inference, 'price'),
        amountInStock: mappedImportValue(row, inference, 'amountInStock'),
        url: mappedImportValue(row, inference, 'url'),
        expirationDate: mappedImportValue(row, inference, 'expirationDate')
      };
      if (!imported.name) {
        result.skipped += 1;
        return;
      }

      const existing = findExistingChemicalForImport(imported);
      const record = mergeImportedChemicalRecord(imported, existing);
      const index = state.labInventory.chemicals.findIndex((item) => item.id === record.id);
      if (index >= 0) {
        state.labInventory.chemicals[index] = record;
        result.updated += 1;
      } else {
        state.labInventory.chemicals.push(record);
        result.created += 1;
      }
      result.importedIds.push(record.id);
    });

    if (result.created || result.updated) {
      selectedChemicalId = result.importedIds[0] || selectedChemicalId;
      appendBlock('IMPORT_CHEMICALS', {
        fileName: cleanImportCell(fileName),
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        mappedColumns: inference.decisions.map((decision) => ({
          header: decision.header,
          field: decision.field,
          source: decision.source
        }))
      });
    }

    return result;
  }

  function buildImportMappingSummary(inference) {
    const decisions = inference.decisions
      .slice(0, 8)
      .map((decision) => `${decision.header} -> ${fieldLabel(decision.field)}${decision.source === 'llm' ? ' (LLM)' : ''}`);
    const remainingCount = Math.max(0, inference.decisions.length - decisions.length);
    const summary = decisions.join(', ');
    return `${summary}${remainingCount ? `, +${remainingCount} more` : ''}`;
  }

  async function onChemicalImportFileChange(event) {
    const file = event?.target?.files?.[0];
    if (!file) {
      return;
    }
    setChemicalImportStatus(`Reading ${file.name}...`, 'busy');
    try {
      const parsed = await parseChemicalImportFile(file);
      if (!Array.isArray(parsed.headers) || !parsed.headers.length) {
        throw new Error('Import file needs a header row.');
      }
      if (!Array.isArray(parsed.rows) || !parsed.rows.length) {
        throw new Error('Import file does not contain chemical rows.');
      }

      setChemicalImportStatus('Matching spreadsheet columns...', 'busy');
      const inference = await inferChemicalImportHeaders(parsed.headers, parsed.rows);
      if (inference.fieldToColumn.name == null) {
        throw new Error('Could not find a chemical name column.');
      }

      const result = importChemicalRows(parsed, inference, file.name);
      if (!result.created && !result.updated) {
        setChemicalImportStatus(`No chemicals imported from ${file.name}. ${result.skipped} rows were skipped.`, 'error');
        return;
      }

      persist();
      void syncChemicalSqliteBundle(true);
      renderAll();
      const mappingSummary = buildImportMappingSummary(inference);
      const llmNote = inference.llmError ? ` LLM mapping unavailable: ${inference.llmError}` : '';
      setChemicalImportStatus(
        `Imported ${result.created} new and updated ${result.updated} chemicals from ${file.name}. Skipped ${result.skipped}. ${mappingSummary ? `Mapped ${mappingSummary}.` : ''}${llmNote}`,
        inference.llmError ? 'warning' : 'success'
      );
    } catch (error) {
      setChemicalImportStatus(`Import failed: ${String(error?.message || error)}`, 'error');
    } finally {
      if (chemicalImportFile) {
        chemicalImportFile.value = '';
      }
    }
  }

  function onChemicalSubmit(event) {
    event.preventDefault();
    ensureLabInventoryShape();

    const location = chemicalLocation.value.trim();
    const name = chemicalName.value.trim();
    const casNumber = chemicalCas.value.trim();
    if (!name || !casNumber || !location) {
      return;
    }

    const existingId = chemicalId.value;
    const existing = state.labInventory.chemicals.find((item) => item.id === existingId);
    const locationCode = assignLocationCode(location, existing?.locationCode || '');
    const parsedLocationCode = parseLocationCode(locationCode);
    const locationNumber = Number(parsedLocationCode?.number || existing?.locationNumber || 0);
    state.labInventory.lastLocationNumber = Math.max(Number(state.labInventory.lastLocationNumber) || 0, locationNumber);

    const record = {
      id: existingId || createId(),
      name,
      casNumber,
      location,
      locationCode,
      locationNumber,
      vendor: chemicalVendor.value.trim(),
      catalogNumber: chemicalCatalogNumber.value.trim(),
      unitSize: chemicalUnitSize.value.trim(),
      price: chemicalPrice.value.trim(),
      amountInStock: chemicalStock.value.trim(),
      url: chemicalUrl.value.trim(),
      expirationDate: chemicalExpiration.value,
      updatedAt: new Date().toISOString()
    };

    const index = state.labInventory.chemicals.findIndex((item) => item.id === record.id);
    if (index >= 0) {
      state.labInventory.chemicals[index] = record;
    } else {
      state.labInventory.chemicals.push(record);
    }
    selectedChemicalId = record.id;

    appendBlock('UPSERT_CHEMICAL', {
      chemicalId: record.id,
      name: record.name,
      casNumber: record.casNumber,
      location: `${record.location}-${record.locationCode || record.locationNumber}`
    });

    broadcastInventoryUpdate(record);
    persist();
    void syncChemicalSqliteBundle(true);
    resetChemicalForm();
    renderAll();
  }

  function editChemical(id) {
    const item = state.labInventory.chemicals.find((chemical) => chemical.id === id);
    if (!item) {
      return;
    }

    chemicalId.value = item.id;
    chemicalName.value = item.name;
    chemicalCas.value = item.casNumber;
    chemicalLocation.value = item.location;
    chemicalVendor.value = item.vendor || '';
    chemicalCatalogNumber.value = item.catalogNumber || '';
    chemicalUnitSize.value = item.unitSize || '';
    chemicalPrice.value = item.price || '';
    chemicalStock.value = item.amountInStock || '';
    chemicalUrl.value = item.url || '';
    chemicalExpiration.value = item.expirationDate || '';
    selectedChemicalId = id;
    updateChemicalDialogTitle();
    openChemicalDialog();
    renderChemicalDetail();
  }

  function deleteChemical(id) {
    ensureLabInventoryShape();
    state.labInventory.chemicals = state.labInventory.chemicals.filter((item) => item.id !== id);
    state.samples = (state.samples || []).map((sample) => {
      const links = Array.isArray(sample.chemicalLinks) ? sample.chemicalLinks : [];
      if (!links.includes(id)) {
        return sample;
      }
      return {
        ...sample,
        chemicalLinks: links.filter((item) => item !== id),
        updatedAt: new Date().toISOString()
      };
    });
    if (selectedChemicalId === id) {
      selectedChemicalId = '';
    }
    appendBlock('DELETE_CHEMICAL', { chemicalId: id });
    persist();
    void syncChemicalSqliteBundle(true);
    renderAll();
  }

  function renderLocationOptions() {
    const locations = state.settings.inventoryLocations || [];
    const selected = chemicalLocation.value;
    const selectedFilter = chemicalFilterLocation.value;
    const options = ['<option value="">Select location</option>'];
    const filterOptions = ['<option value="">All locations</option>'];
    locations.forEach((location) => {
      const isSelected = selected === location ? ' selected' : '';
      options.push(`<option value="${safeText(location)}"${isSelected}>${safeText(location)}</option>`);
      const isFilterSelected = selectedFilter === location ? ' selected' : '';
      filterOptions.push(`<option value="${safeText(location)}"${isFilterSelected}>${safeText(location)}</option>`);
    });
    chemicalLocation.innerHTML = options.join('');
    chemicalFilterLocation.innerHTML = filterOptions.join('');
    if (selected && locations.includes(selected)) {
      chemicalLocation.value = selected;
    }
    if (selectedFilter && locations.includes(selectedFilter)) {
      chemicalFilterLocation.value = selectedFilter;
    }
  }

  function sortChemicals(list) {
    const sortBy = chemicalSort.value || 'updated_desc';
    const next = [...list];
    const locationCodeCompare = (left, right) => {
      const leftParsed = parseLocationCode(left.locationCode);
      const rightParsed = parseLocationCode(right.locationCode);
      const leftLetter = (leftParsed?.letter || '').toUpperCase();
      const rightLetter = (rightParsed?.letter || '').toUpperCase();
      if (leftLetter !== rightLetter) {
        return leftLetter.localeCompare(rightLetter);
      }
      const leftNumber = Number(leftParsed?.number || left.locationNumber || 0);
      const rightNumber = Number(rightParsed?.number || right.locationNumber || 0);
      if (leftNumber !== rightNumber) {
        return leftNumber - rightNumber;
      }
      return String(left.location || '').localeCompare(String(right.location || ''));
    };
    next.sort((a, b) => {
      switch (sortBy) {
        case 'updated_asc':
          return new Date(a.updatedAt) - new Date(b.updatedAt);
        case 'updated_desc':
          return new Date(b.updatedAt) - new Date(a.updatedAt);
        case 'name_asc':
          return a.name.localeCompare(b.name);
        case 'name_desc':
          return b.name.localeCompare(a.name);
        case 'location_asc':
          return locationCodeCompare(a, b);
        case 'location_desc':
          return locationCodeCompare(b, a);
        case 'expiration_asc':
          return (a.expirationDate || '9999-12-31').localeCompare(b.expirationDate || '9999-12-31');
        case 'expiration_desc':
          return (b.expirationDate || '').localeCompare(a.expirationDate || '');
        default:
          return 0;
      }
    });
    return next;
  }

  function getVisibleChemicals() {
    const term = chemicalSearch.value.trim().toLowerCase();
    const locationFilter = chemicalFilterLocation.value;
    const filtered = state.labInventory.chemicals.filter((item) => {
      const matchesLocation = !locationFilter || item.location === locationFilter;
      if (!matchesLocation) {
        return false;
      }
      if (!term) {
        return true;
      }
      const haystack = [
        item.name,
        item.casNumber,
        item.vendor,
        item.catalogNumber,
        item.location,
        item.locationCode,
        item.unitSize
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
    return sortChemicals(filtered);
  }

  function renderChemicalList() {
    const allChemicals = state.labInventory.chemicals;
    if (!allChemicals.length) {
      selectedChemicalId = '';
      if (chemicalResultsSummary) {
        chemicalResultsSummary.textContent = 'No chemicals recorded yet.';
      }
      chemicalList.innerHTML = '<p class="small-note">No chemicals recorded.</p>';
      renderChemicalDetail();
      return;
    }

    const chemicals = getVisibleChemicals();
    if (chemicalResultsSummary) {
      chemicalResultsSummary.textContent = `Showing ${chemicals.length} of ${allChemicals.length} chemicals.`;
    }
    if (!chemicals.length) {
      selectedChemicalId = '';
      chemicalList.innerHTML = '<p class="small-note">No chemicals match current search/filter.</p>';
      renderChemicalDetail();
      return;
    }

    if (!selectedChemicalId || !chemicals.some((item) => item.id === selectedChemicalId)) {
      selectedChemicalId = chemicals[0]?.id || '';
    }

    const rows = chemicals.map((item) => `
      <article class="list-row${selectedChemicalId === item.id ? ' list-row-selected' : ''}">
        <button class="list-main-btn text-list-btn" data-chemical-open="${item.id}">
          ${safeText(item.name)}
        </button>
        <span>${safeText(item.locationCode || '-')}</span>
        <span>${safeText(item.casNumber)}</span>
      </article>
    `).join('');

    chemicalList.innerHTML = `
      <article class="list-row list-row-header">
        <strong>Name</strong>
        <strong>Code</strong>
        <strong>CAS Number</strong>
      </article>
      ${rows}
    `;

    renderChemicalDetail();
  }

  function onChemicalListClick(event) {
    const button = event.target.closest('[data-chemical-open]');
    if (!button) {
      return;
    }
    selectedChemicalId = button.dataset.chemicalOpen;
    renderChemicalList();
  }

  function renderChemicalDetail() {
    const selected = state.labInventory.chemicals.find((item) => item.id === selectedChemicalId);
    if (!selected) {
      chemicalDetailPanel.hidden = true;
      chemicalDetailContent.innerHTML = '';
      return;
    }

    chemicalDetailPanel.hidden = false;
    chemicalDetailTitle.textContent = selected.name || 'Chemical Details';
    const linkedSamples = (state.samples || [])
      .filter((sample) => Array.isArray(sample.chemicalLinks) && sample.chemicalLinks.includes(selected.id))
      .map((sample) => sample.code || sample.name || sample.id);
    const locationText = selected.locationCode
      ? `${selected.location} (${selected.locationCode})`
      : (selected.locationNumber
        ? `${selected.location} #${selected.locationNumber}`
        : (selected.location || '-'));
    const locationCodeText = selected.locationCode
      ? String(selected.locationCode)
      : '-';
    const details = [
      { label: 'CAS', value: selected.casNumber || '-' },
      { label: 'Code', value: locationCodeText },
      { label: 'Location', value: locationText },
      { label: 'Updated', value: selected.updatedAt ? new Date(selected.updatedAt).toLocaleString() : '-' },
      { label: 'Vendor', value: selected.vendor || '-' },
      { label: 'Catalog', value: selected.catalogNumber || '-' },
      { label: 'Unit Size', value: selected.unitSize || '-' },
      { label: 'Price', value: selected.price || '-' },
      { label: 'Stock', value: selected.amountInStock || '-' },
      { label: 'Expiration', value: selected.expirationDate || '-' },
      { label: 'URL', value: selected.url || '-', wide: true },
      { label: 'Linked Samples', value: linkedSamples.join(', ') || '-', wide: true }
    ];
    const detailMarkup = details.map((item) => `
      <div class="chemical-detail-item${item.wide ? ' chemical-detail-item-wide' : ''}">
        <span class="chemical-detail-label">${safeText(item.label)}</span>
        <span class="chemical-detail-value">${safeText(item.value)}</span>
      </div>
    `).join('');

    chemicalDetailContent.innerHTML = `<div class="chemical-detail-grid">${detailMarkup}</div>`;
  }

  function renderBlockchain() {
    const blocks = state.labInventory.blocks;
    if (!blocks.length) {
      blockchainList.innerHTML = '<p class="small-note">No blockchain records yet.</p>';
      return;
    }

    blockchainList.innerHTML = blocks.slice().reverse().map((block) => `
      <article class="card">
        <p><strong>#${block.index}</strong> ${safeText(block.action)} - ${new Date(block.timestamp).toLocaleString()}</p>
        <p><strong>Hash:</strong> ${safeText(block.hash)}</p>
        <p><strong>Prev:</strong> ${safeText(block.prevHash)}</p>
      </article>
    `).join('');
  }

  function renderAll() {
    ensureLabInventoryShape();
    const migrated = ensureChemicalCodes();
    if (migrated) {
      persist();
    }
    renderLocationOptions();
    renderChemicalList();
    renderChemicalDetail();
    renderBlockchain();
    void syncChemicalSqliteBundle(migrated);
  }

  return { renderAll, renderLocationOptions };
}
