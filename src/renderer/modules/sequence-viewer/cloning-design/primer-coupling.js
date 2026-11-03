import { reverseComplementIupac } from '../shared.js';
import { alignPrimerToDna } from './primer-annealing-model.js';

const direction = primer => String(primer?.role || '').includes('reverse') ? -1
  : String(primer?.role || '').includes('forward') ? 1 : 0;
const setValue = (range, side, position) => side === '5' ? { ...range, start: position } : { ...range, end: position };
const mod = (n, length) => ((n % length) + length) % length;

export function primerEndBounds(range, side, window) {
  return side === '5'
    ? { min: Math.max(window.minStart, range.end - window.maxLength), max: range.end - window.minLength }
    : { min: range.start + window.minLength, max: Math.min(window.maxEnd, range.start + window.maxLength) };
}

// Links constrain endpoint coordinates in each oligo's 5′→3′ direction. Opposite
// strands run in opposite directions, so their linked coordinates have a fixed
// sum. This preserves a zero-length Q5 junction or the intended assembly overlap.
export function buildPrimerCouplings(displayPlan, product, primers = displayPlan?.primers || []) {
  const links = [], mapped = new Map();
  const map = index => {
    if (!mapped.has(index)) mapped.set(index, alignPrimerToDna(primers[index]?.sequence, product));
    const site = mapped.get(index);
    return site && !site.ambiguous && site.columns.every(column => column.primerIndex === null || column.paired) ? site : null;
  };
  const find = (templateId, strand) => {
    const matches = primers.map((primer, index) => ({ primer, index }))
      .filter(({ primer }) => primer.templateId === templateId && direction(primer) === strand && primer.template_kind !== 'oligo_pool');
    return matches.length === 1 ? matches[0].index : -1;
  };
  const junctionLink = (forward, reverse, overlapLength, junction = null) => {
    const f = map(forward), r = map(reverse);
    if (!f || !r || f.strand !== 1 || r.strand !== -1) {
      links.push({ first: { index: forward, side: '5' }, second: { index: reverse, side: '5' },
        kind: junction ? 'overlap' : 'q5', unavailable: true });
      return;
    }
    const firstF = f.columns.find(column => column.primerIndex === 0)?.targetIndex;
    const firstR = r.columns.find(column => column.primerIndex === 0)?.targetIndex;
    if (!Number.isFinite(firstF) || !Number.isFinite(firstR)) return;
    const reverseFive = product.sequence.length - 1 - firstR;
    const difference = reverseFive + 1 - firstF - overlapLength;
    const sum = product.topology === 'linear' ? difference
      : mod(difference + product.sequence.length / 2, product.sequence.length) - product.sequence.length / 2;
    links.push({ first: { index: forward, side: '5' }, second: { index: reverse, side: '5' },
      sum, kind: junction ? 'overlap' : 'q5', overlapLength, junction, forwardStart: firstF });
  };
  if (displayPlan?.strategy === 'q5-kld') {
    const forward = primers.flatMap((primer, index) => direction(primer) === 1 ? [index] : []);
    const reverse = primers.flatMap((primer, index) => direction(primer) === -1 ? [index] : []);
    if (forward.length === 1 && reverse.length === 1) junctionLink(forward[0], reverse[0], 0);
  }
  if (['gibson', 'in-fusion', 'overlap-extension', 'overlap-pcr'].includes(displayPlan?.strategy)) {
    const seen = new Set();
    for (const entry of displayPlan.plans || []) {
      const plan = entry?.plan || {};
      const junctions = plan.primerOligoPlan?.junctions || plan.expectedJunctionLogic || [];
      for (const junction of junctions) {
        if (junction.mode !== 'primer-introduced' || !junction.overlapLength) continue;
        const forward = find(junction.rightFragmentId, 1), reverse = find(junction.leftFragmentId, -1);
        const key = `${forward}:${reverse}`;
        if (forward < 0 || reverse < 0 || seen.has(key)) continue;
        seen.add(key);
        junctionLink(forward, reverse, junction.overlapLength, junction);
      }
    }
  }
  // Fully complementary whole-plasmid primers share both physical ends. Their
  // 5′ and partner 3′ endpoints move together to retain that complementarity.
  if (displayPlan?.strategy === 'whole-plasmid' && primers.length === 2
    && primers[0].sequence === reverseComplementIupac(primers[1].sequence)) {
    const unavailable = !map(0) || !map(1);
    links.push({ first: { index: 0, side: '5' }, second: { index: 1, side: '3' }, sum: primers[0].sequence.length, kind: 'complementary', unavailable },
      { first: { index: 0, side: '3' }, second: { index: 1, side: '5' }, sum: primers[0].sequence.length, kind: 'complementary', unavailable });
  }
  return links;
}

export function resizeCoupledPrimerEnd({ index, side, position, links, getRange, getWindow }) {
  const range = getRange(index), bounds = primerEndBounds(range, side, getWindow(index));
  const link = links.find(entry => [entry.first, entry.second].some(end => end.index === index && end.side === side));
  if (!link) {
    return [{ index, range: setValue(range, side, Math.max(bounds.min, Math.min(bounds.max, Math.round(position)))) }];
  }
  if (link.unavailable) return [];
  const partner = link.first.index === index && link.first.side === side ? link.second : link.first;
  const partnerRange = getRange(partner.index), partnerBounds = primerEndBounds(partnerRange, partner.side, getWindow(partner.index));
  const min = Math.max(bounds.min, link.sum - partnerBounds.max), max = Math.min(bounds.max, link.sum - partnerBounds.min);
  if (min > max) return [];
  const next = Math.max(min, Math.min(max, Math.round(position)));
  return [{ index, range: setValue(range, side, next) },
    { index: partner.index, range: setValue(partnerRange, partner.side, link.sum - next) }];
}

