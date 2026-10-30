import { AMINO_ACID_ROW_LABEL } from './constants.js';

export const DEFAULT_ORF_STOP_DISPLAY_MODE = 'trim';
export const DEFAULT_ORF_STOP_CODON_VISIBILITY = Object.freeze({
  TAG: false,
  TAA: false,
  TGA: false
});
export const DEFAULT_ORF_STOP_CODON_SELECTION = Object.freeze({
  TAG: true,
  TAA: true,
  TGA: true
});

const ORF_STOP_DISPLAY_MODE_SET = new Set(['trim', 'star', 'codon']);
const ORF_STOP_CODON_KEYS = ['TAG', 'TAA', 'TGA'];

const FALLBACK_AMINO_ACID_STYLE = Object.freeze({
  color: '#355a8a',
  background: 'rgba(92, 132, 191, 0.14)',
  border: 'rgba(92, 132, 191, 0.28)'
});

const AMINO_ACID_STYLE_BY_KEY = Object.freeze({
  A: Object.freeze({
    color: '#a84f08',
    background: 'rgba(251, 146, 60, 0.18)',
    border: 'rgba(251, 146, 60, 0.34)'
  }),
  R: Object.freeze({
    color: '#b42318',
    background: 'rgba(248, 113, 113, 0.18)',
    border: 'rgba(248, 113, 113, 0.34)'
  }),
  N: Object.freeze({
    color: '#0f766e',
    background: 'rgba(45, 212, 191, 0.18)',
    border: 'rgba(45, 212, 191, 0.34)'
  }),
  D: Object.freeze({
    color: '#b91c1c',
    background: 'rgba(252, 165, 165, 0.18)',
    border: 'rgba(252, 165, 165, 0.34)'
  }),
  C: Object.freeze({
    color: '#047857',
    background: 'rgba(52, 211, 153, 0.18)',
    border: 'rgba(52, 211, 153, 0.34)'
  }),
  Q: Object.freeze({
    color: '#7c3aed',
    background: 'rgba(167, 139, 250, 0.18)',
    border: 'rgba(167, 139, 250, 0.34)'
  }),
  E: Object.freeze({
    color: '#c2410c',
    background: 'rgba(251, 191, 36, 0.18)',
    border: 'rgba(251, 191, 36, 0.34)'
  }),
  G: Object.freeze({
    color: '#475569',
    background: 'rgba(148, 163, 184, 0.22)',
    border: 'rgba(148, 163, 184, 0.34)'
  }),
  H: Object.freeze({
    color: '#1d4ed8',
    background: 'rgba(96, 165, 250, 0.18)',
    border: 'rgba(96, 165, 250, 0.34)'
  }),
  I: Object.freeze({
    color: '#ca8a04',
    background: 'rgba(250, 204, 21, 0.18)',
    border: 'rgba(250, 204, 21, 0.34)'
  }),
  L: Object.freeze({
    color: '#9a3412',
    background: 'rgba(251, 113, 133, 0.18)',
    border: 'rgba(251, 113, 133, 0.34)'
  }),
  K: Object.freeze({
    color: '#c026d3',
    background: 'rgba(232, 121, 249, 0.18)',
    border: 'rgba(232, 121, 249, 0.34)'
  }),
  M: Object.freeze({
    color: '#15803d',
    background: 'rgba(134, 239, 172, 0.18)',
    border: 'rgba(134, 239, 172, 0.34)'
  }),
  F: Object.freeze({
    color: '#be185d',
    background: 'rgba(244, 114, 182, 0.18)',
    border: 'rgba(244, 114, 182, 0.34)'
  }),
  P: Object.freeze({
    color: '#0891b2',
    background: 'rgba(103, 232, 249, 0.18)',
    border: 'rgba(103, 232, 249, 0.34)'
  }),
  S: Object.freeze({
    color: '#2563eb',
    background: 'rgba(147, 197, 253, 0.18)',
    border: 'rgba(147, 197, 253, 0.34)'
  }),
  T: Object.freeze({
    color: '#0369a1',
    background: 'rgba(125, 211, 252, 0.18)',
    border: 'rgba(125, 211, 252, 0.34)'
  }),
  W: Object.freeze({
    color: '#6d28d9',
    background: 'rgba(196, 181, 253, 0.18)',
    border: 'rgba(196, 181, 253, 0.34)'
  }),
  Y: Object.freeze({
    color: '#65a30d',
    background: 'rgba(190, 242, 100, 0.18)',
    border: 'rgba(190, 242, 100, 0.34)'
  }),
  V: Object.freeze({
    color: '#ea580c',
    background: 'rgba(253, 186, 116, 0.18)',
    border: 'rgba(253, 186, 116, 0.34)'
  }),
  '*': Object.freeze({
    color: '#7c2d12',
    background: 'rgba(254, 215, 170, 0.24)',
    border: 'rgba(251, 146, 60, 0.34)'
  }),
  TAA: Object.freeze({
    color: '#991b1b',
    background: 'rgba(252, 165, 165, 0.22)',
    border: 'rgba(252, 165, 165, 0.38)'
  }),
  TAG: Object.freeze({
    color: '#9d174d',
    background: 'rgba(244, 114, 182, 0.22)',
    border: 'rgba(244, 114, 182, 0.38)'
  }),
  TGA: Object.freeze({
    color: '#7e22ce',
    background: 'rgba(216, 180, 254, 0.22)',
    border: 'rgba(216, 180, 254, 0.38)'
  }),
  X: FALLBACK_AMINO_ACID_STYLE
});

export function normalizeOrfStopDisplayMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ORF_STOP_DISPLAY_MODE_SET.has(normalized)
    ? normalized
    : DEFAULT_ORF_STOP_DISPLAY_MODE;
}

export function normalizeOrfStopCodonVisibility(value) {
  if (typeof value === 'string') {
    const normalizedMode = normalizeOrfStopDisplayMode(value);
    if (normalizedMode === 'codon') {
      return {
        TAG: true,
        TAA: true,
        TGA: true
      };
    }
    return { ...DEFAULT_ORF_STOP_CODON_VISIBILITY };
  }

  const source = value && typeof value === 'object' ? value : {};
  return ORF_STOP_CODON_KEYS.reduce((next, codon) => {
    next[codon] = source[codon] === true || source[codon.toLowerCase()] === true;
    return next;
  }, {});
}

export function normalizeOrfStopCodonSelection(value) {
  if (typeof value === 'string') {
    const selected = new Set(
      String(value || '')
        .toUpperCase()
        .split(/[\s,;|]+/)
        .filter((codon) => ORF_STOP_CODON_KEYS.includes(codon))
    );
    if (selected.size) {
      return ORF_STOP_CODON_KEYS.reduce((next, codon) => {
        next[codon] = selected.has(codon);
        return next;
      }, {});
    }
    return { ...DEFAULT_ORF_STOP_CODON_SELECTION };
  }

  const source = value && typeof value === 'object' ? value : {};
  return ORF_STOP_CODON_KEYS.reduce((next, codon) => {
    const hasUpper = Object.prototype.hasOwnProperty.call(source, codon);
    const hasLower = Object.prototype.hasOwnProperty.call(source, codon.toLowerCase());
    next[codon] = hasUpper || hasLower
      ? source[codon] === true || source[codon.toLowerCase()] === true
      : DEFAULT_ORF_STOP_CODON_SELECTION[codon];
    return next;
  }, {});
}

export function getEnabledOrfStopCodons(value) {
  const selection = normalizeOrfStopCodonSelection(value);
  return ORF_STOP_CODON_KEYS.filter((codon) => selection[codon] === true);
}

export function resolveOrfTranslationDisplay(aminoAcid, codon, stopDisplay = DEFAULT_ORF_STOP_CODON_VISIBILITY) {
  const aa = String(aminoAcid || '').trim().slice(0, 1).toUpperCase() || 'X';
  const normalizedCodon = String(codon || '').trim().toUpperCase();

  if (aa === '*') {
    if (typeof stopDisplay === 'string') {
      const normalizedMode = normalizeOrfStopDisplayMode(stopDisplay);
      if (normalizedMode === 'trim') {
        return null;
      }
      if (normalizedMode === 'codon' && normalizedCodon.length === 3) {
        return {
          text: normalizedCodon,
          colorKey: normalizedCodon,
          isStop: true
        };
      }
      return {
        text: '*',
        colorKey: '*',
        isStop: true
      };
    }

    const stopVisibility = normalizeOrfStopCodonVisibility(stopDisplay);
    if (normalizedCodon.length !== 3 || stopVisibility[normalizedCodon] !== true) {
      return null;
    }
    return {
      text: normalizedCodon,
      colorKey: normalizedCodon,
      isStop: true
    };
  }

  return {
    text: aa,
    colorKey: aa,
    isStop: false
  };
}

export function getAminoAcidVisualStyle(colorKey) {
  const normalized = String(colorKey || '').trim().toUpperCase();
  return AMINO_ACID_STYLE_BY_KEY[normalized] || FALLBACK_AMINO_ACID_STYLE;
}

export function getOrfTranslationRowLabel(strand) {
  return `${AMINO_ACID_ROW_LABEL}${strand === -1 ? '-' : '+'}`;
}
