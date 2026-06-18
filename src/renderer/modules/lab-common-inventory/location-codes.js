export function installLocationCodeHelpers(ctx) {
  const { state } = ctx;
  const ensureLabInventoryShape = () => ctx.ensureLabInventoryShape();
function normalizeLocationKey(value) {
  return String(value || '').trim().toLowerCase();
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
  Object.assign(ctx, {
    normalizeLocationKey,
    encodeLocationLetter,
    ensureLocationLetter,
    parseLocationCode,
    readMaxLocationCodeNumber,
    assignLocationCode,
    ensureChemicalCodes
  });
}
