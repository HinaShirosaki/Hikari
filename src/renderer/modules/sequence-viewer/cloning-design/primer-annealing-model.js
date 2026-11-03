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

// Reserve the available resizing span once. Reference columns and their gap
// slots belong to the DNA context, rather than the current oligo length.
export function buildPrimerReferenceFrame(record, alignment, maxPrimerLength, bounds = null) {
  if (!alignment) return null;
  const first = alignment.columns.find(column => column.targetIndex !== null)?.targetIndex ?? 0;
  const last = alignment.columns.findLast(column => column.targetIndex !== null)?.targetIndex ?? first;
  const primerLength = Math.max(...alignment.columns.map(column => column.primerIndex ?? -1)) + 1;
  const flank = targetIndex => ({ targetIndex, referenceBase: orientedBase(record, targetIndex, alignment.strand) });
  return { alignment, sequence: record.sequence, topology: record.topology, strand: alignment.strand,
    columns: [
      ...Array.from({ length: 10 + Math.max(0, -(bounds?.minStart || 0)) }, (_, i) => flank(first - 10 + Math.min(0, bounds?.minStart || 0) + i)),
      ...alignment.columns.map(column => ({ targetIndex: column.targetIndex, referenceBase: column.referenceBase,
        insertionIndex: column.targetIndex === null ? column.primerIndex : null })),
      ...Array.from({ length: 10 + Math.max(0, (bounds?.maxEnd ?? maxPrimerLength) - primerLength) }, (_, i) => flank(last + i + 1))
    ] };
}

export function primerAlignmentInReferenceFrame(sequence, record, frame, searchAlignment = frame?.alignment, offset = 0) {
  if (!frame) return searchAlignment;
  const primer = dna(sequence);
  const original = frame.alignment;
  const originalLength = Math.max(...original.columns.map(column => column.primerIndex ?? -1)) + 1;
  // Length edits keep the original site and strand. A shorter repeated seed
  // may make the specificity search ambiguous, but must not move this drawing
  // to a different matching location on the plasmid.
  const end = offset + primer.length;
  const firstTarget = original.columns.find(column => column.targetIndex !== null)?.targetIndex ?? original.start;
  const lastTarget = original.columns.findLast(column => column.targetIndex !== null)?.targetIndex ?? original.start - 1;
  const columns = [];
  const append = (sourcePrimerIndex, targetIndex) => {
    const referenceBase = orientedBase(record, targetIndex, frame.strand);
    const base = primer[sourcePrimerIndex - offset];
    columns.push({ primerIndex: sourcePrimerIndex - offset, sourcePrimerIndex, targetIndex, base, referenceBase,
      paired: concrete(base) && base === referenceBase, unpaired: !referenceBase });
  };
  for (let i = offset; i < Math.min(0, end); i++) append(i, firstTarget + i);
  const retained = column => column.primerIndex !== null && column.primerIndex >= offset && column.primerIndex < end;
  const from = original.columns.findIndex(retained), to = original.columns.findLastIndex(retained);
  if (from >= 0) {
    for (const column of original.columns.slice(from, to + 1)) {
      const primerIndex = column.primerIndex === null ? null : column.primerIndex - offset;
      columns.push({ ...column, sourcePrimerIndex: column.primerIndex, primerIndex,
        base: primerIndex === null ? '' : primer[primerIndex] });
    }
  }
  for (let i = Math.max(originalLength, offset); i < end; i++) append(i, lastTarget + 1 + i - originalLength);
  return { ...original, columns, ambiguous: searchAlignment?.ambiguous ?? original.ambiguous,
    siteCount: searchAlignment?.siteCount ?? original.siteCount };
}

export function primerResizeWindow(primer, product, alignment = alignPrimerToDna(primer?.sequence, product)) {
  const seed = dna(primer.sequence);
  const minLength = Math.min(8, seed.length), maxLength = Math.max(120, seed.length);
  const first = alignment?.columns.find(column => column.primerIndex === 0);
  const last = alignment?.columns.findLast(column => column.primerIndex === seed.length - 1);
  let upstream = '', downstream = '';
  if (alignment && !alignment.ambiguous) {
    const limit = Math.min(maxLength - minLength, Math.max(0, dna(product.sequence).length - minLength));
    for (let i = 1; first?.targetIndex !== null && first && i <= limit; i++) {
      const base = orientedBase(product, first.targetIndex - i, alignment.strand);
      if (!concrete(base)) break;
      upstream = base + upstream;
    }
    for (let i = 1; last?.targetIndex !== null && last && i <= limit; i++) {
      const base = orientedBase(product, last.targetIndex + i, alignment.strand);
      if (!concrete(base)) break;
      downstream += base;
    }
  }
  return { sequence: upstream + seed + downstream, origin: upstream.length,
    minStart: upstream.length ? -upstream.length : 0, maxEnd: seed.length + downstream.length, minLength,
    maxLength: Math.max(seed.length, Math.min(maxLength, dna(product.sequence).length || seed.length)), seedLength: seed.length };
}

export function clampPrimerEnd(range, end, position, window) {
  if (end === '5') {
    return { start: Math.max(window.minStart, range.end - window.maxLength,
      Math.min(Math.round(position), range.end - window.minLength)), end: range.end };
  }
  return { start: range.start, end: Math.min(window.maxEnd, range.start + window.maxLength,
    Math.max(Math.round(position), range.start + window.minLength)) };
}

export function resizePrimerInterval(primer, range, window) {
  const sequence = window.sequence.slice(window.origin + range.start, window.origin + range.end);
  const tailLength = Math.max(0, Math.min(range.end, dna(primer.tailSequence).length) - range.start);
  const tailSequence = dna(primer.tailSequence).length ? sequence.slice(0, tailLength) : '';
  return { ...primer, ...buildPrimerRecord({ ...primer, sequence, tailSequence, bindingSequence: sequence.slice(tailSequence.length) }), manuallyAdjusted: true };
}

export function primerWithTemplateBinding(primer, alignment, originalPrimer = null, offset = 0) {
  // An incidental match inside an insertion tail is not a contiguous PCR
  // binding sequence. Keep only the exact paired suffix at the extending 3′
  // end, so reconstructing a linked pair uses the actual physical template.
  let bindingStart = primer.sequence.length;
  const bindingFloor = originalPrimer?.bindingSequence
    ? Math.max(0, originalPrimer.sequence.length - originalPrimer.bindingSequence.length - offset) : 0;
  const columns = alignment?.columns || [];
  for (let i = columns.length - 1; i >= 0; i--) {
    const column = columns[i];
    if (!column.paired || column.primerIndex === null || column.primerIndex < bindingFloor || column.primerIndex !== bindingStart - 1) break;
    bindingStart = column.primerIndex;
  }
  return { ...primer, tailSequence: primer.sequence.slice(0, bindingStart), bindingSequence: primer.sequence.slice(bindingStart) };
}

export function normalizePrimerTmFloor(value) {
  const number = value === '' || value === null || value === undefined ? NaN : Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : CLONING_PRIMER_TM_THRESHOLDS.relaxed.primerTm.min;
}

export function templateBindingTooLow(alignment, floor) {
  if (!alignment) return false;
  const { tm } = annealingStats(alignment);
  return tm === null || tm < normalizePrimerTmFloor(floor);
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

export function replacePlanPrimers(displayPlan, updates, { links = [], product } = {}) {
  let next = updates.reduce((plan, update) => replacePlanPrimer(plan, update.index, update.primer, update.templateAlignment), displayPlan);
  const group = primer => [primer.templateId, primer.groupLabel, primer.pcrStage, primer.templateEntryId].join('|');
  const deltas = new Map();
  for (const update of updates) {
    const key = group(displayPlan.primers[update.index]);
    deltas.set(key, (deltas.get(key) || 0) + (Number(update.startDelta) || 0));
  }
  const lengths = new Map();
  for (const primer of displayPlan.primers) {
    const key = group(primer);
    if (!deltas.has(key)) continue;
    const before = Number(primer.ampliconLength) || (displayPlan.strategy === 'q5-kld' ? product?.sequence?.length : 0);
    if (before) lengths.set(key, displayPlan.strategy === 'q5-kld' && product?.sequence
      ? product.sequence.length : Math.max(0, before - deltas.get(key)));
  }
  const changedLinks = links.filter(link => !link.unavailable && product?.sequence && link.kind === 'overlap'
    && updates.some(update => update.startDelta && [link.first.index, link.second.index].includes(update.index)));
  const junctions = changedLinks.map(link => {
    const forward = next.primers[link.first.index], reverse = next.primers[link.second.index];
    const range = updates.find(update => update.index === link.first.index)?.range;
    const start = link.forwardStart + (range?.start || 0);
    const overlapSequence = Array.from({ length: link.overlapLength }, (_, i) => orientedBase(product, start + i)).join('');
    return { ...link.junction, overlapSequence, overlapLength: link.overlapLength,
      overlapTm: cloningPrimerTm(overlapSequence), overlapGcContent: (overlapSequence.match(/[GC]/g) || []).length / overlapSequence.length * 100,
      leftBindingTm: reverse.tm,
      leftReverseTargetTail: reverseComplementIupac(reverse.tailSequence), rightForwardTargetTail: forward.tailSequence };
  });
  const primerKey = primer => [primer.role, primer.templateId, primer.sequence].join('|');
  const primerChanges = new Map(next.primers.map(primer => {
    const ampliconLength = lengths.get(group(primer));
    const updated = ampliconLength === undefined ? primer : { ...primer, ampliconLength };
    if (displayPlan.strategy === 'q5-kld' && updates.length > 1) {
      updated.warnings = [...(updated.warnings || []).filter(warning => !/^(Carries |Anneals back-to-back|Adds \d+ nt at the 5′ end; the linked primer pair retains)/.test(warning)),
        `Adds ${updated.tailSequence.length} nt at the 5′ end; the linked primer pair retains the complete Q5/KLD product.`];
    }
    return [primerKey(primer), updated];
  }));
  const refresh = value => {
    if (Array.isArray(value)) return value.map(refresh);
    if (!value || typeof value !== 'object') return value;
    if (value.role && value.sequence && primerChanges.has(primerKey(value))) {
      const updated = primerChanges.get(primerKey(value));
      return { ...value, ampliconLength: updated.ampliconLength, warnings: updated.warnings };
    }
    const replacement = junctions.find(junction => value.leftFragmentId === junction.leftFragmentId
      && value.rightFragmentId === junction.rightFragmentId && value.mode === junction.mode);
    const current = replacement ? { ...value, ...replacement } : value;
    return Object.fromEntries(Object.entries(current).map(([key, child]) => [key, refresh(child)]));
  };
  next = refresh(next);
  const limits = displayPlan.strategy === 'in-fusion' ? { min: 45, max: 75 } : CLONING_PRIMER_TM_THRESHOLDS.relaxed.overlapTm;
  if (junctions.some(junction => junction.overlapTm < limits.min || junction.overlapTm > limits.max)) {
    next.feasible = false;
    next.warnings = [...next.warnings, 'The adjusted overlap needs review: its melting temperature is outside the overlap range.'];
  }
  return next;
}
