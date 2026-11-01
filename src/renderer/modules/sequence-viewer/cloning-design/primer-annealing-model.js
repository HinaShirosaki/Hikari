import { cloningPrimerTm } from '../calculations/oligo.js';
import { reverseComplementIupac } from '../shared.js';
import { buildPrimerRecord, summarizePrimerPlan } from '../cloning-assembly/primer-records.js';
import { CLONING_PRIMER_TM_THRESHOLDS } from '../cloning-assembly/constants.js';

const dna = value => String(value || '').toUpperCase().replace(/U/g, 'T').replace(/[^A-Z]/g, '');
const concrete = base => /^[ACGT]$/.test(base || '');
const circular = record => String(record?.topology || '').toLowerCase() !== 'linear';
const mod = (value, length) => ((value % length) + length) % length;

export function primerTemplateRecord({ primer = {}, source = {}, record = {}, displayPlan = {}, donor } = {}) {
  const fragments = (displayPlan.plans || []).flatMap(entry => entry?.plan?.orderedFragmentMap?.fragments || []);
  const fragment = fragments.find(entry => entry.id === primer.templateId);
  const metadata = fragment?.metadata || {};
  const entryId = primer.templateEntryId || primer.template_id || '';
  // Intermediate PCRs and oligo pools must never silently use the parent vector.
  const intermediate = ['hypothetical_intermediate', 'oligo_pool'].includes(primer.template_kind);
  if (!intermediate && entryId && entryId === donor?.id) return donor;
  if (!intermediate && entryId && entryId === source.parentEntryId) {
    return { name: source.recordName || 'Template', sequence: source.originalSequence, topology: record.topology };
  }
  const sequence = dna(metadata.specificitySequence || metadata.templateHostSequence || metadata.templateSequence || fragment?.templateSequence);
  if (sequence && !intermediate) {
    return { name: metadata.templateName || fragment.name || 'Template', sequence,
      topology: metadata.specificityCircular ? 'circular' : 'linear' };
  }
  if (intermediate) {
    // These primers are designed against an assembled fragment, rather than a
    // physical library stock. Do not fabricate that stock from the final plasmid.
    return { name: primer.template_kind === 'oligo_pool' ? 'Oligo pool' : 'Intermediate DNA',
      sequence: primer.template_kind === 'oligo_pool' ? '' : dna(primer.template_sequence || fragment?.sequence), topology: 'linear' };
  }
  if (entryId) return { entryId, name: 'Template', sequence: '' };
  return { name: source.recordName || 'Template', sequence: source.originalSequence || '', topology: record.topology };
}

export function orientedBase(record, index, strand = 1) {
  const sequence = dna(record?.sequence);
  if (!sequence.length || (!circular(record) && (index < 0 || index >= sequence.length))) return '';
  const position = mod(index, sequence.length);
  return strand === 1 ? sequence[position] : reverseComplementIupac(sequence[sequence.length - 1 - position]);
}

// Smith-Waterman keeps unmatched terminal additions outside the duplex while
// allowing internal substitutions, insertions and deletions. Both DNA strands
// and circular-origin sites are searched; ties are reported, never hidden.
function alignStrand(primer, record, strand) {
  const original = dna(record.sequence);
  const oriented = strand === 1 ? original : reverseComplementIupac(original);
  const target = circular(record) ? oriented + oriented.slice(0, Math.min(oriented.length - 1, primer.length + 32)) : oriented;
  const width = target.length + 1;
  const trace = new Uint8Array((primer.length + 1) * width);
  let previous = new Int32Array(width), current = new Int32Array(width);
  let best = 0, ends = [];
  for (let i = 1; i <= primer.length; i++) {
    current[0] = 0;
    for (let j = 1; j <= target.length; j++) {
      const match = concrete(primer[i - 1]) && primer[i - 1] === target[j - 1];
      const diagonal = previous[j - 1] + (match ? 3 : -3);
      const up = previous[j] - 4, left = current[j - 1] - 4;
      const score = Math.max(0, diagonal, up, left);
      current[j] = score;
      trace[i * width + j] = !score ? 0 : score === diagonal ? 1 : score === up ? 2 : 3;
      if (score > best) { best = score; ends = [{ i, j }]; }
      else if (score === best && score > 0 && ends.length < 64) ends.push({ i, j });
    }
    [previous, current] = [current, previous];
  }
  const sites = new Map();
  for (const end of ends) {
    let { i, j } = end;
    const aligned = [];
    while (i && j && trace[i * width + j]) {
      const direction = trace[i * width + j];
      if (direction === 1) {
        aligned.push({ primerIndex: --i, targetIndex: --j });
      } else if (direction === 2) aligned.push({ primerIndex: --i, targetIndex: null });
      else aligned.push({ primerIndex: null, targetIndex: --j });
    }
    if (j >= original.length || end.j - j > original.length) continue;
    aligned.reverse();
    const columns = [
      ...Array.from({ length: i }, (_, k) => ({ primerIndex: k, targetIndex: j - i + k, unpaired: true })),
      ...aligned,
      ...Array.from({ length: primer.length - end.i }, (_, k) => ({ primerIndex: end.i + k, targetIndex: end.j + k, unpaired: true }))
    ].map(column => {
      const base = column.primerIndex === null ? '' : primer[column.primerIndex];
      const referenceBase = column.targetIndex === null ? '' : orientedBase(record, column.targetIndex, strand);
      return { ...column, base, referenceBase,
        paired: !column.unpaired && concrete(base) && base === referenceBase };
    });
    if (columns.filter(column => column.paired).length < 8) continue;
    sites.set(`${strand}:${j}:${end.j}`, { strand, score: best, start: j, end: end.j, columns });
  }
  return [...sites.values()];
}

export function alignPrimerToDna(primerSequence, record = {}) {
  const primer = dna(primerSequence);
  if (!primer.length || !dna(record.sequence).length) return null;
  // Most product views are full exact matches. Locate them directly so dragging
  // stays responsive even for large plasmids; local alignment handles the tails
  // and edited template only when a complete duplex is absent.
  const exact = [];
  const original = dna(record.sequence);
  if (primer.length >= 8 && primer.length <= original.length && /^[ACGT]+$/.test(primer)) {
    for (const strand of [1, -1]) {
      const oriented = strand === 1 ? original : reverseComplementIupac(original);
      const target = circular(record) ? oriented + oriented.slice(0, primer.length - 1) : oriented;
      let start = target.indexOf(primer);
      while (start >= 0 && start < original.length && exact.length < 64) {
        exact.push({ strand, score: primer.length * 3, start, end: start + primer.length,
          columns: [...primer].map((base, i) => ({ primerIndex: i, targetIndex: start + i, base, referenceBase: base, paired: true })) });
        start = target.indexOf(primer, start + 1);
      }
    }
    if (exact.length) return { ...exact[0], siteCount: exact.length, ambiguous: exact.length > 1 };
  }
  const candidates = [...alignStrand(primer, record, 1), ...alignStrand(primer, record, -1)];
  const bestScore = candidates.reduce((score, site) => Math.max(score, site.score), 0);
  const best = candidates.filter(site => site.score === bestScore);
  return best.length ? { ...best[0], siteCount: best.length, ambiguous: best.length > 1 } : null;
}

export function annealingStats(alignment) {
  if (!alignment) return { tm: null, paired: 0, unpaired: 0, mismatches: 0, gaps: 0, tmBases: 0, gc: null };
  const columns = alignment.columns;
  let run = '', bestRun = '', bestTm = -Infinity;
  const finish = () => {
    if (run.length >= 8 && cloningPrimerTm(run) > bestTm) { bestRun = run; bestTm = cloningPrimerTm(run); }
    run = '';
  };
  columns.forEach(column => { if (column.paired) run += column.base; else finish(); });
  finish();
  // A full mismatched-duplex Tm requires mismatch/bulge thermodynamics. Report
  // the strongest uninterrupted paired region explicitly, not a fabricated
  // whole-oligo temperature or an arbitrary per-mismatch penalty.
  const paired = columns.filter(column => column.paired).length;
  const matched = columns.filter(column => column.paired).map(column => column.base).join('');
  return {
    tm: Number.isFinite(bestTm) ? bestTm : null, tmBases: bestRun.length, paired,
    gc: matched.length ? (matched.match(/[GC]/g) || []).length / matched.length * 100 : null,
    unpaired: columns.filter(column => column.base && column.unpaired).length,
    mismatches: columns.filter(column => column.base && column.referenceBase && !column.paired && !column.unpaired).length,
    gaps: columns.filter(column => column.primerIndex === null || column.targetIndex === null).length
  };
}

export function primerLengthOptions(primer, product, alignment = alignPrimerToDna(primer?.sequence, product), templateAlignment = null) {
  const sequence = dna(primer?.sequence);
  const tail = dna(primer?.tailSequence);
  let lastDisruption = -1, previousIndex = -1;
  for (const column of templateAlignment?.columns || []) {
    if (column.primerIndex !== null) previousIndex = column.primerIndex;
    if (!column.paired) lastDisruption = Math.max(lastDisruption, previousIndex);
  }
  const min = Math.min(sequence.length, Math.max(12, tail.length + 8, lastDisruption + 9));
  let extension = '';
  const last = alignment?.columns.findLast(column => column.primerIndex === sequence.length - 1);
  if (alignment && !alignment.ambiguous && last?.paired) {
    const limit = Math.min(Math.max(120, sequence.length) - sequence.length, dna(product.sequence).length - sequence.length);
    for (let offset = 1; offset <= limit; offset++) {
      const base = orientedBase(product, last.targetIndex + offset, alignment.strand);
      if (!concrete(base)) break;
      extension += base;
    }
  }
  return { min, max: sequence.length + extension.length, sequence: sequence + extension };
}

export function resizedPrimer(primer, length, options) {
  const sequence = options.sequence.slice(0, Math.max(options.min, Math.min(options.max, Math.round(length))));
  const originalSequence = dna(primer.sequence);
  // The 5′ end (including every cloning tail) stays fixed. Only the 3′ binding
  // region changes, following the final construct in the primer's orientation.
  let bindingSequence = dna(primer.bindingSequence);
  const delta = sequence.length - originalSequence.length;
  bindingSequence = delta >= 0 ? bindingSequence + sequence.slice(originalSequence.length)
    : bindingSequence.slice(0, Math.max(0, bindingSequence.length + delta));
  return { ...primer, ...buildPrimerRecord({ ...primer, sequence, bindingSequence }), manuallyAdjusted: true };
}

export function replacePlanPrimer(displayPlan, index, nextPrimer, bindingAlignment) {
  const previous = displayPlan.primers[index];
  const stats = annealingStats(bindingAlignment);
  const updated = { ...nextPrimer, tm: stats.tm ?? 0 };
  const replaceNested = value => {
    if (Array.isArray(value)) return value.map(replaceNested);
    if (!value || typeof value !== 'object') return value;
    if (value.sequence === previous.sequence && value.templateId === previous.templateId && value.role === previous.role) {
      return { ...value, ...updated, name: value.name, groupLabel: value.groupLabel };
    }
    const result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replaceNested(child)]));
    if (Array.isArray(result.primers)) {
      Object.assign(result, summarizePrimerPlan(result.primers, result.overlapSummary));
      if (Object.hasOwn(result, 'selectedThresholdLevel')) result.selectedThresholdLevel = 'manual';
    }
    return result;
  };
  const terminal = bindingAlignment?.columns.findLast(column => column.primerIndex !== null);
  updated.annealingNeedsReview = !bindingAlignment || bindingAlignment.ambiguous || !terminal?.paired || stats.tm === null;
  const primers = displayPlan.primers.map((primer, position) => position === index ? updated : primer);
  const quality = summarizePrimerPlan(primers);
  const limits = CLONING_PRIMER_TM_THRESHOLDS.relaxed;
  const temperatureReview = primers.some(primer => primer.manuallyAdjusted && (primer.tm < limits.primerTm.min || primer.tm > limits.primerTm.max))
    || quality.primerTmDifferences.some(pair => pair.tmDifference > limits.maxPrimerTmDifference);
  const invalid = primers.some(primer => primer.annealingNeedsReview) || quality.qualityBlockers.length > 0 || temperatureReview;
  const baseline = displayPlan.manualAdjustmentBaseline || { feasible: Boolean(displayPlan.feasible), warnings: displayPlan.warnings || [] };
  const adjustmentWarning = 'Primer length was adjusted manually. Review primer-pair balance and the PCR program before use.';
  return { ...displayPlan, primers, plans: replaceNested(displayPlan.plans || []),
    manualAdjustmentBaseline: baseline,
    feasible: baseline.feasible && !invalid,
    warnings: [...new Set([...baseline.warnings, adjustmentWarning, ...quality.qualityWarnings,
      ...(invalid ? ['The adjusted primer needs review: check its 3′ binding site, primer quality, binding Tm, and primer-pair Tm difference.'] : [])])],
    summary: { ...displayPlan.summary, ...quality } };
}
