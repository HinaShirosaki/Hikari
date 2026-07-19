export const DEFAULT_SAMPLE_INVENTORY_LOCATIONS = [
  'Room Temp',
  '4 Degree',
  '-20 Degree',
  '-80 Degree',
  'Liquid Nitrogen'
];

export const DEFAULT_SAMPLE_INVENTORY_LOCATION_DISPLAY = {
  'Room Temp': { short: 'RT', title: 'Room Temp', note: 'Bench and cabinet storage' },
  '4 Degree': { short: '4C', title: '4 C', note: 'Cold shelf storage' },
  '-20 Degree': { short: '-20', title: '-20 C', note: 'Short-term freezer storage' },
  '-80 Degree': { short: '-80', title: '-80 C', note: 'Long-term freezer storage' },
  'Liquid Nitrogen': { short: 'LN2', title: 'Liquid Nitrogen', note: 'Cryogenic storage' }
};

export const DEFAULT_SAMPLE_TYPE_LABELS = {
  plasmid: 'Plasmid',
  cell_line: 'Cell Line',
  strain: 'Strain',
  antibody: 'Antibody',
  protein: 'Protein',
  chemical: 'Chemical',
  primer: 'Primer',
  other: 'Other'
};

export const SAMPLE_TYPE_ORDER = Object.keys(DEFAULT_SAMPLE_TYPE_LABELS);
export const CUSTOM_SAMPLE_TYPE_PREFIX = 'custom_';

function cleanSettingText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function uniqueSettingStrings(values = []) {
  const seen = new Set();
  const result = [];
  values.forEach((value) => {
    const cleanValue = cleanSettingText(value);
    if (!cleanValue) {
      return;
    }
    const key = cleanValue.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(cleanValue);
  });
  return result;
}

export function normalizeSampleInventoryLocations(rawValue) {
  if (!Array.isArray(rawValue)) {
    return [...DEFAULT_SAMPLE_INVENTORY_LOCATIONS];
  }
  const locations = uniqueSettingStrings(rawValue);
  return locations.length ? locations : [...DEFAULT_SAMPLE_INVENTORY_LOCATIONS];
}

export function getSampleInventoryLocationNames(settings = {}, inventory = {}) {
  const configured = normalizeSampleInventoryLocations(settings?.sampleInventoryLocations);
  const inventoryNames = inventory && typeof inventory === 'object' && !Array.isArray(inventory)
    ? Object.keys(inventory).filter((name) => Array.isArray(inventory[name]) && inventory[name].length)
    : [];
  return uniqueSettingStrings([...configured, ...inventoryNames]);
}

function buildFallbackShortLabel(name) {
  const parts = cleanSettingText(name).split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return '--';
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 4).toUpperCase();
  }
  return parts.map((part) => part[0]).join('').slice(0, 4).toUpperCase();
}

export function getSampleInventoryLocationDisplay(locationName = '') {
  const cleanName = cleanSettingText(locationName);
  return DEFAULT_SAMPLE_INVENTORY_LOCATION_DISPLAY[cleanName] || {
    short: buildFallbackShortLabel(cleanName),
    title: cleanName || 'Unknown',
    note: ''
  };
}

export function normalizeSampleType(type) {
  const key = String(type || '').trim().toLowerCase();
  if (!key) {
    return 'other';
  }
  if (key === 'compound') {
    return 'chemical';
  }
  if (Object.prototype.hasOwnProperty.call(DEFAULT_SAMPLE_TYPE_LABELS, key)) {
    return key;
  }
  return isCustomSampleType(key) ? key : 'other';
}

export function isCustomSampleType(type = '') {
  return new RegExp(`^${CUSTOM_SAMPLE_TYPE_PREFIX}[a-z0-9_]+$`).test(String(type || '').trim().toLowerCase());
}

export function createCustomSampleTypeId(label = '', existingTypes = []) {
  const stem = cleanSettingText(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'sample_type';
  const existing = new Set((Array.isArray(existingTypes) ? existingTypes : [])
    .map((type) => String(type || '').trim().toLowerCase())
    .filter(Boolean));
  const base = `${CUSTOM_SAMPLE_TYPE_PREFIX}${stem}`;
  let candidate = base;
  let suffix = 2;
  while (existing.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function normalizeSampleTypeHidden(rawValue) {
  const source = Array.isArray(rawValue) ? rawValue : [];
  return Array.from(new Set(source
    .map((type) => normalizeSampleType(type))
    .filter((type) => type !== 'other' && Object.prototype.hasOwnProperty.call(DEFAULT_SAMPLE_TYPE_LABELS, type))));
}

export function normalizeSampleTypeLabels(rawValue) {
  const source = rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)
    ? rawValue
    : {};
  const labels = SAMPLE_TYPE_ORDER.reduce((result, type) => {
    const cleanLabel = cleanSettingText(source[type]);
    result[type] = cleanLabel || DEFAULT_SAMPLE_TYPE_LABELS[type];
    return result;
  }, {});
  Object.entries(source).forEach(([rawType, rawLabel]) => {
    const type = normalizeSampleType(rawType);
    const label = cleanSettingText(rawLabel);
    if (isCustomSampleType(type) && label) {
      labels[type] = label;
    }
  });
  return labels;
}

export function getSampleTypeLabels(settings = {}) {
  return normalizeSampleTypeLabels(settings?.sampleTypeLabels);
}

export function getSampleTypeLabel(settings = {}, type = '') {
  const labels = getSampleTypeLabels(settings);
  const normalized = normalizeSampleType(type);
  return labels[normalized] || labels.other || DEFAULT_SAMPLE_TYPE_LABELS.other;
}

export function getConfiguredSampleTypeLabel(settings = {}, type = '') {
  return getSampleTypeLabel(settings, type);
}

export function normalizeConfiguredSampleType(type = '') {
  return normalizeSampleType(type);
}

export function getEditableSampleTypeEntries(settings = {}) {
  const labels = getSampleTypeLabels(settings);
  const hiddenTypes = new Set(normalizeSampleTypeHidden(settings?.sampleTypeHidden));
  const configuredTypes = SAMPLE_TYPE_ORDER
    .filter((type) => type !== 'other' && !hiddenTypes.has(type))
    .map((type) => ({
      type,
      label: labels[type] || DEFAULT_SAMPLE_TYPE_LABELS[type],
      defaultLabel: DEFAULT_SAMPLE_TYPE_LABELS[type],
      isCustom: false
    }));
  const customTypes = Object.keys(labels)
    .filter((type) => isCustomSampleType(type))
    .map((type) => ({
      type,
      label: labels[type],
      defaultLabel: labels[type],
      isCustom: true
    }));
  return configuredTypes.concat(customTypes);
}
