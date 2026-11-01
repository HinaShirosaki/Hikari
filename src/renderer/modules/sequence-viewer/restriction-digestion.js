import { buildDnaFragmentRecord } from './dna-fragments.js';
import { normalizeSequenceText, normalizeTopology, reverseComplementIupac } from './shared.js';

const mod = (value, length) => ((value % length) + length) % length;
export const isDigestSite = feature => String(feature?.type || '').toLowerCase() === 'restriction_site';
export const digestSiteKey = feature => JSON.stringify([feature?.site, feature?.strand,
  (feature?.segments || []).map(part => [part.start, part.end])]);

export function digestSiteEnzymes(feature) {
  const enzymes = feature?.enzymes?.length ? feature.enzymes : [{ name: feature?.name, cut: feature?.cut }];
  return enzymes.map(enzyme => ({ name: String(enzyme.name || ''), cut: String(enzyme.cut || '') }));
}

// REBASE notation: ^ cuts within the recognition site, a leading (a/b)
// cuts upstream, and a trailing (a/b) cuts downstream. A type IIB enzyme can
// make both upstream and downstream breaks from one recognition site.
export function resolveDigestSiteCuts(template, feature, enzymeName = feature?.name) {
  if (!isDigestSite(feature)) throw new Error('Choose a restriction enzyme site.');
  const enzyme = digestSiteEnzymes(feature).find(item => item.name === enzymeName);
  if (!enzyme) throw new Error('Choose an enzyme for this recognition site.');
  const pattern = enzyme.cut.toUpperCase().replace(/\s/g, '');
  const match = /^(?:\(([-+]?\d+)\/([-+]?\d+)\))?([A-Z^]+)(?:\(([-+]?\d+)\/([-+]?\d+)\))?$/.exec(pattern);
  const motif = normalizeSequenceText(feature.site);
  if (!match || !motif || match[3].replace(/\^/g, '') !== motif) {
    throw new Error('This enzyme has no supported, unambiguous cut pattern.');
  }
  const offsets = [];
  if (match[3].includes('^')) {
    if ((match[3].match(/\^/g) || []).length !== 1 || match[1] !== undefined || match[4] !== undefined) {
      throw new Error('This enzyme has no supported, unambiguous cut pattern.');
    }
    const top = match[3].indexOf('^');
    offsets.push({ top, bottom: motif.length - top });
  } else {
    if (match[1] !== undefined) offsets.push({ top: -Number(match[1]), bottom: -Number(match[2]) });
    if (match[4] !== undefined) offsets.push({ top: motif.length + Number(match[4]), bottom: motif.length + Number(match[5]) });
  }
  if (!offsets.length) throw new Error('This enzyme has no supported, unambiguous cut pattern.');
  const start = Number(feature.segments?.[0]?.start);
  const length = template.sequence.length;
  if (!Number.isInteger(start) || start < 0 || start >= length) throw new Error('Invalid restriction site coordinates.');
  return offsets.map(offset => {
    let top = start + (feature.strand === -1 ? motif.length - offset.bottom : offset.top);
    let bottom = start + (feature.strand === -1 ? motif.length - offset.top : offset.bottom);
    if (normalizeTopology(template.topology) === 'circular') {
      const delta = bottom - top;
      top = mod(top, length);
      bottom = top + delta;
    } else if (Math.min(top, bottom) <= 0 || Math.max(top, bottom) >= length) {
      throw new Error('The cut must fall inside both strands of the linear template.');
    }
    if (Math.abs(bottom - top) >= length) throw new Error('The cut extends beyond one copy of the template.');
    return { top, bottom, enzyme: enzyme.name, pattern };
  });
}

function templateSlice(template, start, end) {
  if (normalizeTopology(template.topology) !== 'circular') return template.sequence.slice(start, end);
  const at = mod(start, template.sequence.length);
  return (template.sequence + template.sequence).slice(at, at + end - start);
}

function productEnd(template, cut, side) {
  if (!cut.enzyme) return { kind: 'original', sequence: '', enzyme: '' };
  const delta = cut.bottom - cut.top;
  let sequence = templateSlice(template, Math.min(cut.top, cut.bottom), Math.max(cut.top, cut.bottom));
  if ((delta > 0 && side === 'right') || (delta < 0 && side === 'left')) sequence = reverseComplementIupac(sequence);
  return { kind: delta > 0 ? '5-prime' : delta < 0 ? '3-prime' : 'blunt', sequence,
    enzyme: cut.enzyme, top: mod(cut.top, template.sequence.length), bottom: mod(cut.bottom, template.sequence.length) };
}

function digestFragment(template, start, end, name) {
  const length = template.sequence.length;
  const product = buildDnaFragmentRecord(template, { start, end }, name);
  // A circular template linearized inside a gene has two interrupted gene
  // pieces, rather than an intact CDS joined across the new linear ends.
  const windows = [{ start, end: Math.min(end, length), offset: -start }];
  if (end > length) windows.push({ start: 0, end: end - length, offset: length - start });
  product.features = (template.features || []).flatMap(feature => {
    const mapped = (feature.segments || []).flatMap(segment => windows.map(window => ({
      sourceStart: Math.max(segment.start, window.start), sourceEnd: Math.min(segment.end, window.end), offset: window.offset
    })).filter(part => part.sourceEnd > part.sourceStart).sort((a, b) => a.sourceStart - b.sourceStart)
      .map(part => ({ start: part.sourceStart + part.offset, end: part.sourceEnd + part.offset })));
    if (!mapped.length) return [];
    const groups = [[]];
    for (const segment of mapped) {
      if (groups.at(-1).length && segment.start < groups.at(-1).at(-1).end) groups.push([]);
      groups.at(-1).push(segment);
    }
    if (groups.length === 1) {
      const retained = buildDnaFragmentRecord({ ...template, features: [feature] }, { start, end }).features[0];
      return [{ ...retained, segments: mapped }];
    }
    return groups.flatMap((segments, index) => {
      const first = Math.min(...segments.map(part => part.start));
      const last = Math.max(...segments.map(part => part.end));
      const sourceStart = mod(start + first, length);
      return buildDnaFragmentRecord({ ...template, features: [feature] }, { start: sourceStart, end: sourceStart + last - first }).features
        .map(part => ({ ...part, id: `${feature.id || feature.name}-digest-part-${index + 1}`,
          segments: part.segments.map(segment => ({ start: segment.start + first, end: segment.end + first })) }));
    });
  });
  return product;
}

export function describeDigestEnd(end) {
  if (end.kind === 'original') return 'Original template end';
  if (end.kind === 'blunt') return `${end.enzyme}: blunt end`;
  return `${end.enzyme}: ${end.kind === '5-prime' ? '5′' : '3′'} overhang ${end.sequence} (5′→3′)`;
}

export function buildRestrictionDigestProducts(template, selections) {
  template = { ...template, sequence: normalizeSequenceText(template?.sequence) };
  const length = template.sequence.length;
  if (!length || !Array.isArray(selections) || selections.length < 1 || selections.length > 2) {
    throw new Error('Choose one or two restriction sites.');
  }
  if (selections.length === 2 && digestSiteKey(selections[0].site) === digestSiteKey(selections[1].site)) {
    throw new Error('Choose a different second restriction site.');
  }
  const cuts = selections.flatMap(selection => resolveDigestSiteCuts(template, selection.site, selection.enzymeName))
    .sort((a, b) => a.top - b.top);
  const circular = normalizeTopology(template.topology) === 'circular';
  const boundaries = circular ? [...cuts, { ...cuts[0], top: cuts[0].top + length, bottom: cuts[0].bottom + length }]
    : [{ top: 0, bottom: 0 }, ...cuts, { top: length, bottom: length }];
  const names = [...new Set(cuts.map(cut => cut.enzyme))].join(' + ');
  return boundaries.slice(0, -1).map((left, index) => {
    const right = boundaries[index + 1];
    if (right.top <= left.top || Math.max(left.top, left.bottom) >= Math.min(right.top, right.bottom)) {
      throw new Error('The selected cuts overlap or leave no double-stranded DNA between them.');
    }
    const product = digestFragment(template, left.top, right.top, `${template.name}_${names}_digest_${index + 1}`);
    product.digestEnds = { left: productEnd(template, left, 'left'), right: productEnd(template, right, 'right') };
    product.description = `Restriction digest of ${template.name} with ${names}. GenBank sequence is the plus strand. Left: ${describeDigestEnd(product.digestEnds.left)}. Right: ${describeDigestEnd(product.digestEnds.right)}.`;
    // GenBank qualifiers retain terminal chemistry on disk and through reloads.
    for (const side of ['left', 'right']) {
      const end = product.digestEnds[side];
      const at = side === 'left' ? 0 : product.sequence.length - 1;
      product.features.push({ id: `digest-${side}-end`, type: 'misc_feature', name: `${side} digest end`, strand: 1,
        description: describeDigestEnd(end), source: 'manual', segments: [{ start: at, end: at + 1 }],
        qualifiers: { hikari_digest_end: side, hikari_digest_end_type: end.kind,
          hikari_digest_overhang: end.sequence, hikari_digest_enzyme: end.enzyme,
          ...(end.enzyme ? { hikari_digest_template_top_cut: String(end.top), hikari_digest_template_bottom_cut: String(end.bottom) } : {}) }
      });
    }
    return product;
  });
}
