import { normalizeSampleType } from '../../lib/inventory-settings.js';
import { escapeHtml } from '../../lib/html.js';

// Type-specific fields, stored flat on record.details as { key: string }.
// Keys are snake_case so they double as CSV column headers without a mapping.
// `wide` marks long values that take a whole row where short fields pair up;
// put one after an even number of short fields, or the last short one sits alone.
export const SAMPLE_TYPE_FIELDS = {
  plasmid: [
    { key: 'backbone', label: 'Backbone / Vector', placeholder: 'e.g. pET28a' },
    { key: 'resistance', label: 'Antibiotic Resistance', placeholder: 'e.g. Kan' },
    { key: 'host_strain', label: 'Host Strain', placeholder: 'e.g. DH5α' },
    { key: 'size_bp', label: 'Size (bp)', placeholder: 'e.g. 5369' }
  ],
  cell_line: [
    { key: 'species', label: 'Species', placeholder: 'e.g. Human' },
    { key: 'medium', label: 'Culture Medium', placeholder: 'e.g. DMEM + 10% FBS' },
    { key: 'mycoplasma_test_date', label: 'Mycoplasma Test', type: 'date' }
  ],
  strain: [
    { key: 'species', label: 'Species', placeholder: 'e.g. E. coli' },
    { key: 'resistance', label: 'Antibiotic Resistance', placeholder: 'e.g. Cm' },
    { key: 'genotype', label: 'Genotype', placeholder: 'e.g. F- ompT hsdSB gal dcm (DE3)', wide: true }
  ],
  antibody: [
    { key: 'target', label: 'Target', placeholder: 'e.g. GFP' },
    { key: 'host_species', label: 'Host Species', placeholder: 'e.g. Rabbit' },
    { key: 'clonality', label: 'Clonality', options: ['Monoclonal', 'Polyclonal'] },
    { key: 'conjugate', label: 'Conjugate', placeholder: 'e.g. HRP, Alexa 488' },
    { key: 'dilution', label: 'Working Dilution', placeholder: 'e.g. 1:1000' },
    { key: 'catalog', label: 'Vendor / Catalog #', placeholder: 'e.g. Abcam ab290' }
  ],
  protein: [
    { key: 'molecular_weight', label: 'MW (kDa)', placeholder: 'e.g. 27' },
    { key: 'tag', label: 'Tag', placeholder: 'e.g. His6, GST' },
    { key: 'buffer', label: 'Buffer', placeholder: 'e.g. 20 mM Tris pH 7.5, 150 mM NaCl', wide: true },
    { key: 'expression_host', label: 'Expression Host', placeholder: 'e.g. E. coli BL21(DE3)' }
  ],
  primer: [
    { key: 'sequence', label: "Sequence (5'→3')", placeholder: 'e.g. ATGGTGAGCAAGGGCGAG', wide: true },
    { key: 'direction', label: 'Direction', options: ['Forward', 'Reverse'] },
    { key: 'tm', label: 'Tm (°C)', placeholder: 'e.g. 62' },
    { key: 'target', label: 'Target', placeholder: 'e.g. GFP N-term' }
  ],
  chemical: [
    { key: 'cas', label: 'CAS #', placeholder: 'e.g. 67-68-5' },
    { key: 'molecular_weight', label: 'MW (g/mol)', placeholder: 'e.g. 78.13' },
    { key: 'purity', label: 'Purity', placeholder: 'e.g. ≥99%' },
    { key: 'catalog', label: 'Vendor / Catalog #', placeholder: 'e.g. Sigma D8418' }
  ]
};

export const DETAIL_KEYS = [...new Set(Object.values(SAMPLE_TYPE_FIELDS).flat().map((field) => field.key))];

export function getTypeFields(type) {
  return SAMPLE_TYPE_FIELDS[normalizeSampleType(type)] || [];
}

// Keeps only this type's keys with non-empty string values; null when nothing is set.
export function normalizeSampleDetails(type, raw) {
  const details = {};
  getTypeFields(type).forEach(({ key }) => {
    const value = String(raw?.[key] ?? '').trim();
    if (value) {
      details[key] = value;
    }
  });
  return Object.keys(details).length ? details : null;
}

export function renderTypeFieldsMarkup(type, details = null) {
  return getTypeFields(type).map(({ key, label, placeholder = '', type: inputType = 'text', options, wide }) => {
    const value = String(details?.[key] || '');
    const control = options
      ? `<select data-sample-detail="${escapeHtml(key)}">
          <option value="">-</option>
          ${options.map((option) => `<option value="${escapeHtml(option)}"${option === value ? ' selected' : ''}>${escapeHtml(option)}</option>`).join('')}
        </select>`
      : `<input data-sample-detail="${escapeHtml(key)}" type="${inputType}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" />`;
    return `<label${wide ? ' class="sample-type-field-wide"' : ''}>${escapeHtml(label)}${control}</label>`;
  }).join('');
}

export function readTypeFieldsFrom(root, type) {
  const raw = {};
  root?.querySelectorAll?.('[data-sample-detail]').forEach((control) => {
    raw[control.dataset.sampleDetail] = control.value;
  });
  return normalizeSampleDetails(type, raw);
}
