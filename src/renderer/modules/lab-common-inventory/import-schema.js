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


export {
  CHEMICAL_IMPORT_FIELDS,
  CHEMICAL_IMPORT_FIELD_BY_NORMALIZED_ALIAS,
  normalizeImportHeader,
  normalizeImportFieldKey,
  fieldLabel
};
