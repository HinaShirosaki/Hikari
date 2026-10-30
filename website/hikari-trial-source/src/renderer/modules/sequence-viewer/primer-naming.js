import { cleanText } from './shared.js';
import { asArray } from '../../lib/normalize.js';

export { describeEditTarget } from './sequence-naming.js';

// Primer names read like a bench label, in the order a bench scientist says
// them: what the primer adds, what it targets, then the direction.
//
//   EcoRI His F   added site, added tag
//   GST APA2 R    fusion partner, insert
//   MPM2 A34J F   gene, amino-acid substitution
//   vector R      the backbone half of the same assembly
//
// Engine-level names (mutagenesis_F, gg_backbone_R, ApoI_F) stay as they are;
// this renames the finished plan, where the record and the construct are known.

function directionOf(primer) {
  const role = String(primer?.role || '').toLowerCase();
  if (role.includes('reverse')) {
    return 'R';
  }
  if (role.includes('forward')) {
    return 'F';
  }
  return /[_ ]R$/.test(String(primer?.name || '')) ? 'R' : 'F';
}

function isBackbonePrimer(primer, base, context) {
  const role = String(primer?.role || '').toLowerCase();
  return role.includes('backbone')
    || /backbone$/i.test(base)
    || base.toLowerCase() === 'gg_backbone'
    || asArray(context?.backboneNames).some((name) => cleanText(name, 160) && base === cleanText(name, 160));
}

function uniqueName(name, used) {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  let suffix = 2;
  while (used.has(`${name} ${suffix}`)) {
    suffix += 1;
  }
  const next = `${name} ${suffix}`;
  used.add(next);
  return next;
}

// context: { targetLabel, gene, mutation, enzyme, tags: { start, end }, backboneNames }
export function renamePrimers(primers, context = {}) {
  const used = new Set();
  return asArray(primers).map((primer) => {
    const base = String(primer?.name || '').replace(/[_ ]([FR])$/, '');
    const role = String(primer?.role || '').toLowerCase();
    const direction = directionOf(primer);
    const tags = context?.tags || {};

    if (isBackbonePrimer(primer, base, context)) {
      const enzyme = role.includes('restriction') || role.includes('golden-gate')
        ? cleanText(context?.enzyme, 40)
        : '';
      // A route with two backbone amplicons (the overlap-extension flanks) keeps
      // the side in the name, or "vector F" would label two different products.
      const side = (base.match(/^(upstream|downstream)\b/i)?.[1] || '').toLowerCase();
      return { ...primer, name: uniqueName([enzyme, side, 'vector', direction].filter(Boolean).join(' '), used) };
    }

    const isMutagenesis = role.includes('mutagenesis');
    // A restriction primer is named for the site it carries; the engine already
    // put that enzyme in the base name.
    const enzyme = role.includes('restriction')
      ? base
      : (role.includes('golden-gate') ? cleanText(context?.enzyme, 40) : '');
    const tag = cleanText(direction === 'R' ? tags.end : tags.start, 40);
    const fallbackTarget = /^(gg_insert|q5|mutagenesis|selection)$/i.test(base) ? '' : base;
    const target = isMutagenesis
      ? (cleanText(context?.gene, 60) || cleanText(context?.targetLabel, 60))
      : (cleanText(context?.targetLabel, 60) || fallbackTarget);
    const mutation = isMutagenesis ? cleanText(context?.mutation, 40) : '';

    const parts = [enzyme, tag, target, mutation, direction]
      .map((part) => cleanText(part, 60))
      .filter((part, index, list) => part && list.indexOf(part) === index);
    return { ...primer, name: uniqueName(parts.join(' '), used) };
  });
}
