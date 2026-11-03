import { createPresentation } from '../../../lib/i18n/presentation.js';
import '../localization.js';
import { escapeHtml } from '../../../lib/html.js';
import { reverseComplementIupac } from '../shared.js';
import { parseInputRecords } from '../parsing.js';
import { alignPrimerToDna, annealingStats, buildPrimerReferenceFrame, normalizePrimerTmFloor, primerAlignmentInReferenceFrame, primerResizeWindow, primerTemplateRecord, primerWithTemplateBinding, resizePrimerInterval, templateBindingTooLow } from './primer-annealing-model.js';
import { buildPrimerCouplings, resizeCoupledPrimerEnd } from './primer-coupling.js';

const i18nUi = createPresentation('dna');
const number = value => value === null || value === undefined ? '—' : Number(value).toFixed(1);
const measuredStats = alignment => ({ ...annealingStats(alignment), ...(alignment?.ambiguous ? { tm: null } : {}) });

function renderDuplex(view, record, alignment, frame) {
  const { primer, options, range, locked, lowTemplateBinding } = view;
  if (!alignment) return `<p class="small-note">${i18nUi.html('No reliable binding site was found in this DNA. The primer remains available in the table.')}</p>`;
  const reverse = alignment.strand === -1;
  const key = column => column.targetIndex === null ? `insertion:${column.sourcePrimerIndex ?? column.primerIndex ?? column.insertionIndex}` : `target:${column.targetIndex}`;
  const overlay = new Map(alignment.columns.filter(column => column.base).map(column => [key(column), column]));
  const columns = frame.columns.map(column => ({ base: '', primerIndex: null, ...overlay.get(key(column)), ...column }));
  if (reverse) columns.reverse();
  const advance = 15, left = 76, width = left + columns.length * advance + 46;
  const x = index => left + (index + 0.5) * advance;
  const oligo = columns.map((column, index) => ({ ...column, index })).filter(column => column.base);
  const start = oligo[0]?.index || 0, end = oligo.at(-1)?.index || start;
  const fivePrime = reverse ? oligo.at(-1) : oligo[0];
  const threePrime = reverse ? oligo[0] : oligo.at(-1);
  const outlineY = column => reverse ? (column?.paired ? 171 : 191) : (column?.paired ? 50 : 30);
  const baseY = column => outlineY(column) + 16;
  const referenceBases = columns.map((column, index) => {
    const position = column.targetIndex === null ? null : ((column.targetIndex % record.sequence.length) + record.sequence.length) % record.sequence.length;
    const coordinate = position === null ? '' : alignment.strand === 1 ? position + 1 : record.sequence.length - position;
    const plusBase = reverse ? reverseComplementIupac(column.referenceBase) : column.referenceBase;
    // Keep the reference in genomic left-to-right order. The complementary
    // strand is above the plus strand, so each primer pairs with the adjacent
    // antiparallel strand: forward above the duplex, reverse below it.
    return `${coordinate && index % 10 === 0 ? `<text class="primer-annealing-coordinate" x="${x(index)}" y="18">${coordinate}</text>` : ''}
      <text x="${x(index)}" y="112" class="primer-annealing-base" data-reference-strand="-1">${escapeHtml(reverseComplementIupac(plusBase) || '·')}</text>
      ${plusBase ? `<line class="primer-annealing-dna-bond" x1="${x(index)}" x2="${x(index)}" y1="118" y2="125"/>` : ''}
      <text x="${x(index)}" y="141" class="primer-annealing-base" data-reference-strand="1">${escapeHtml(plusBase || '·')}</text>`;
  }).join('');
  const primerBases = columns.map((column, index) => {
    const state = column.paired ? 'paired' : column.unpaired ? 'overhang' : column.targetIndex === null || column.primerIndex === null ? 'gap' : 'mismatch';
    return `${column.paired ? `<line class="primer-annealing-pair-bond" x1="${x(index)}" x2="${x(index)}" y1="${reverse ? 148 : 78}" y2="${reverse ? 168 : 96}"/>` : ''}
      ${column.base ? `<text x="${x(index)}" y="${baseY(column)}" class="primer-annealing-oligo-base is-${state}" data-pair-state="${state}" data-primer-index="${column.primerIndex}">${escapeHtml(column.base)}</text>` : ''}`;
  }).join('');
  // The oligo outline steps out of the duplex at mismatches and insertions.
  const top = [], bottom = [];
  oligo.forEach(column => {
    const x0 = left + column.index * advance, x1 = x0 + advance;
    const y = outlineY(column);
    top.push(`${x0},${y}`, `${x1},${y}`);
    bottom.unshift(`${x1},${y + 22}`, `${x0},${y + 22}`);
  });
  const leftEnd = left + start * advance, rightEnd = left + (end + 1) * advance;
  const fiveX = reverse ? rightEnd : leftEnd, threeX = reverse ? leftEnd : rightEnd;
  const handle = side => {
    if (locked || view.blockedEnds.includes(side)) return '';
    const x = side === '5' ? fiveX : threeX;
    const y = outlineY(side === '5' ? fivePrime : threePrime);
    const max = Math.min(options.maxLength, side === '5' ? range.end - options.minStart : options.maxEnd - range.start);
    return `<g class="primer-annealing-handle" data-annealing-length-handle="${side}" tabindex="0" role="slider" aria-orientation="horizontal"
      aria-label="${escapeHtml(i18nUi.text(side === '5' ? 'Primer 5′ end — drag to resize' : 'Primer 3′ end — drag to resize'))}" aria-valuemin="${options.minLength}" aria-valuemax="${max}" aria-valuenow="${primer.sequence.length}" aria-valuetext="${escapeHtml(i18nUi.text('{length} nucleotides', { length: primer.sequence.length }))}">
      <title>${escapeHtml(i18nUi.text('Drag either primer end to resize. Arrow keys move one base; Escape cancels a drag.'))}</title>
      <rect class="primer-annealing-handle-hit" x="${x - 12}" y="${y - 7}" width="24" height="36"/>
      <rect class="primer-annealing-handle-grip" x="${x - 4}" y="${y - 3}" width="8" height="28" rx="3"/>
      <line class="primer-annealing-handle-line" x1="${x}" x2="${x}" y1="${y + 3}" y2="${y + 19}"/>
    </g>`;
  };
  return `<div class="primer-annealing-scroll" tabindex="0" aria-label="${escapeHtml(i18nUi.text('Single-row primer and double-stranded DNA alignment'))}">
    <svg class="primer-annealing-duplex" width="${width}" height="250" viewBox="0 0 ${width} 250" data-annealing-direction="${alignment.strand}" role="group" aria-label="${escapeHtml(i18nUi.text('Primer annealing to {name}', { name: record.name || i18nUi.text('DNA') }))}">
      <g data-annealing-reference>
        <text x="18" y="112" class="primer-annealing-end">3′</text><text x="18" y="141" class="primer-annealing-end">5′</text>
        <text x="${width - 24}" y="112" class="primer-annealing-end">5′</text><text x="${width - 24}" y="141" class="primer-annealing-end">3′</text>
        ${referenceBases}
      </g>
      <g data-annealing-primer class="${lowTemplateBinding ? 'is-low-template-binding' : ''}">
      ${lowTemplateBinding ? `<title>${escapeHtml(i18nUi.text('Template binding Tm is below the {floor} °C minimum.', { floor: view.tmFloor }))}</title>` : ''}
      <polygon class="primer-annealing-outline" points="${[...top, ...bottom].join(' ')}"/>
      ${primerBases}
      <text x="${fiveX + (reverse ? 25 : -25)}" y="${baseY(fivePrime)}" class="primer-annealing-end" data-primer-end="5">5′</text>
      <text x="${threeX + (reverse ? -25 : 25)}" y="${baseY(threePrime)}" class="primer-annealing-end" data-primer-end="3">${reverse ? '← 3′' : '3′ →'}</text>
      ${handle('3')}${handle('5')}
      <text x="${left}" y="241" class="primer-annealing-coordinate">${escapeHtml(primer.name)}</text>
      </g>
    </svg>
  </div>`;
}

export function createPrimerAnnealingController({ root, getContext, getBridge = () => null, getStoragePath = () => '', onApply = () => {}, onTmFloorChange = () => {} } = {}) {
  let activePlan = null, index = 0, mode = 'template';
  let drag = null, applying = false;
  let couplings = null, couplingProduct = '';
  const drafts = new Map(), templateCache = new Map(), alignmentCache = new Map(), referenceFrames = new Map(), editSessions = new Map();

  function align(sequence, record) {
    const key = `${record.topology}|${record.sequence}|${sequence}`;
    if (!alignmentCache.has(key)) {
      if (alignmentCache.size >= 32) alignmentCache.clear();
      alignmentCache.set(key, alignPrimerToDna(sequence, record));
    }
    return alignmentCache.get(key);
  }

  function templateFor(context, primer) {
    const template = primerTemplateRecord({ ...context, primer });
    if (!template.entryId) return template;
    const key = `${getStoragePath()}|${template.entryId}`;
    const cached = templateCache.get(key);
    if (cached) return { ...template, ...cached };
    const bridge = getBridge();
    if (!bridge?.sequenceLibraryGet || !getStoragePath()) return template;
    templateCache.set(key, { loading: true });
    void (async () => {
      try {
        const response = await bridge.sequenceLibraryGet({ storagePath: getStoragePath(), id: template.entryId, includeGbk: true });
        if (!response?.ok) throw new Error(response?.error || 'Template unavailable');
        const record = parseInputRecords(String(response.gbkText || '')).records?.[0];
        if (!record?.sequence) throw new Error('Template has no DNA');
        templateCache.set(key, record);
      } catch {
        templateCache.set(key, { unavailable: true });
      }
      if (activePlan === context.displayPlan) render();
    })();
    return { ...template, loading: true };
  }

  function sessionFor(position, product, primers) {
    let session = editSessions.get(position);
    if (!session || session.product !== product.sequence) {
      const primer = primers[position];
      const options = primerResizeWindow(primer, product, align(primer.sequence, product));
      session = { primer, options, range: { start: 0, end: primer.sequence.length }, product: product.sequence };
      editSessions.set(position, session);
    }
    return session;
  }

  function linksFor(view) {
    if (!couplings || couplingProduct !== view.product.sequence) {
      const seeds = view.primers.map((primer, position) => editSessions.get(position)?.primer || primer);
      couplings = buildPrimerCouplings(view.context.displayPlan, view.product, seeds);
      couplingProduct = view.product.sequence;
    }
    return couplings;
  }

  function data(position) {
    const context = getContext();
    const plan = context.displayPlan;
    if (plan !== activePlan) {
      activePlan = plan; drafts.clear(); alignmentCache.clear(); index = 0;
      if (!applying) { referenceFrames.clear(); editSessions.clear(); couplings = null; }
    }
    const primers = plan?.primers || [];
    index = Math.max(0, Math.min(index, primers.length - 1));
    const primerIndex = position === undefined ? index : Math.max(0, Math.min(position, primers.length - 1));
    const original = primers[primerIndex];
    if (!original) return null;
    const product = { ...context.record, name: context.record?.name || i18nUi.text('Final plasmid') };
    const template = templateFor(context, original);
    const session = sessionFor(primerIndex, product, primers);
    const options = session.options;
    const productSearch = align(session.primer.sequence, product);
    const templateSearch = align(session.primer.sequence, template);
    const frameFor = (kind, record, alignment) => {
      const key = `${primerIndex}:${kind}`;
      let frame = referenceFrames.get(key);
      if (!frame || frame.sequence !== record.sequence || frame.topology !== record.topology) {
        frame = buildPrimerReferenceFrame(record, alignment, options.maxLength, options);
        if (frame) referenceFrames.set(key, frame);
      }
      return frame;
    };
    const productFrame = frameFor('product', product, productSearch);
    const templateFrame = frameFor('template', template, templateSearch);
    const range = drafts.get(primerIndex) || session.range;
    let primer = resizePrimerInterval(session.primer, range, options);
    const productAlignment = primerAlignmentInReferenceFrame(primer.sequence, product, productFrame, align(primer.sequence, product), range.start);
    const templateAlignment = primerAlignmentInReferenceFrame(primer.sequence, template, templateFrame, align(primer.sequence, template), range.start);
    primer = primerWithTemplateBinding(primer, templateAlignment, session.primer, range.start);
    const tmFloor = normalizePrimerTmFloor(context.tmFloor);
    const view = { context, primers, original, primer, product, template, productAlignment, templateAlignment, options, productFrame, templateFrame, range, index: primerIndex,
      tmFloor, lowTemplateBinding: templateBindingTooLow(templateAlignment, tmFloor),
      dirty: primer.sequence !== original.sequence,
      locked: context.locked || original.template_kind === 'oligo_pool' || !templateAlignment || template.loading || options.minLength === options.maxLength };
    const links = linksFor(view);
    view.blockedEnds = links.filter(link => link.unavailable)
      .flatMap(link => [link.first, link.second].filter(end => end.index === primerIndex).map(end => end.side));
    if (context.displayPlan.strategy === 'q5-kld' && !links.some(link => [link.first, link.second].some(end => end.index === primerIndex && end.side === '5'))) view.blockedEnds.push('5');
    return view;
  }

  function detailMarkup(view) {
    const { primer, template, product, templateAlignment, productAlignment } = view;
    const selected = mode === 'product' ? product : template;
    const alignment = mode === 'product' ? productAlignment : templateAlignment;
    const stats = measuredStats(alignment), templateStats = measuredStats(templateAlignment), productStats = measuredStats(productAlignment);
    const gc = (primer.sequence.match(/[GC]/g) || []).length / primer.sequence.length * 100;
    const metric = (label, value, key) => `<div><dt>${i18nUi.html(label)}</dt><dd data-annealing-metric="${key}">${value}</dd></div>`;
    return `<dl class="primer-annealing-metrics" aria-live="polite">
      ${metric('Oligo length', `${primer.sequence.length} nt`, 'length')}
      ${metric('Oligo GC', `${number(gc)}%`, 'gc')}
      ${metric('Template paired-region Tm', `${number(templateStats.tm)} °C`, 'template-tm')}
      ${metric('Product paired-region Tm', `${number(productStats.tm)} °C`, 'product-tm')}
    </dl>
    <div class="primer-annealing-dna-label"><strong>${i18nUi.html(mode === 'product' ? 'Final plasmid' : 'Template DNA')}</strong>
      <span>${escapeHtml(selected.name || '')}${selected.sequence ? ` · ${selected.sequence.length.toLocaleString()} bp` : ''}${alignment ? ` · ${i18nUi.html(alignment.strand === 1 ? 'Forward strand' : 'Reverse strand')}` : ''}</span>
    </div>
    ${!selected.sequence ? `<p class="small-note">${i18nUi.html(template.loading ? 'Loading template DNA…' : 'Template DNA is unavailable for this primer. Select Product to inspect the final construct.')}</p>` : renderDuplex(view, selected, alignment, mode === 'product' ? view.productFrame : view.templateFrame)}
    <div data-annealing-binding-note>${alignment?.ambiguous ? `<p class="small-note primer-annealing-warning">${i18nUi.html('Multiple equally scoring binding sites were found. This is one possible alignment; its Tm is not reported.')}</p>` : ''}</div>
    ${alignment ? `<div class="primer-annealing-legend"><span class="is-paired">${i18nUi.html('Paired')}: ${stats.paired} nt</span><span class="is-unpaired">${i18nUi.html('Unpaired ends')}: ${stats.unpaired} nt</span><span class="is-unpaired">${i18nUi.html('Mismatches / gaps')}: ${stats.mismatches} / ${stats.gaps}</span><span>${i18nUi.html('Paired GC')}: ${number(stats.gc)}%</span></div>` : ''}`;
  }

  function renderDetail(view) {
    const host = root?.querySelector?.('[data-primer-annealing-detail]');
    const scrollLeft = host?.querySelector('.primer-annealing-scroll')?.scrollLeft || 0;
    const focused = root?.ownerDocument?.activeElement?.getAttribute?.('data-annealing-length-handle');
    if (host) {
      const next = host.ownerDocument.createElement('div');
      i18nUi.setHtml(next, detailMarkup(view));
      const reference = host.querySelector('[data-annealing-reference]');
      const nextReference = next.querySelector('[data-annealing-reference]');
      if (reference && nextReference && reference.innerHTML === nextReference.innerHTML) {
        // Keep the actual duplex and its scroll container mounted while only
        // replacing the oligo, its statistics, and any specificity note.
        for (const selector of ['[data-annealing-primer]', '.primer-annealing-metrics', '.primer-annealing-legend', '[data-annealing-binding-note]']) {
          const current = host.querySelector(selector), replacement = next.querySelector(selector);
          if (current && replacement) current.replaceWith(replacement);
        }
      } else host.replaceChildren(...next.childNodes);
    }
    const scroller = host?.querySelector('.primer-annealing-scroll');
    if (scroller) scroller.scrollLeft = scrollLeft;
    if (focused) host?.querySelector(`[data-annealing-length-handle="${focused}"]`)?.focus({ preventScroll: true });
  }

  function render() {
    const host = root?.querySelector?.('[data-primer-annealing-host]');
    if (!host) return;
    const view = data();
    if (!view) { host.innerHTML = ''; return; }
    i18nUi.setHtml(host, `<div class="primer-annealing-head">
      <h4>${i18nUi.html('Primer annealing')}</h4>
      <div class="primer-annealing-navigation">
        <button type="button" class="ghost-btn" data-annealing-action="previous" aria-label="${escapeHtml(i18nUi.text('Previous primer'))}" ${view.primers.length < 2 ? 'disabled' : ''}>←</button>
        <select data-annealing-primer aria-label="${escapeHtml(i18nUi.text('Primer'))}">${view.primers.map((primer, i) => `<option value="${i}" ${i === index ? 'selected' : ''}>${i + 1} / ${view.primers.length} · ${escapeHtml(primer.name)}</option>`).join('')}</select>
        <button type="button" class="ghost-btn" data-annealing-action="next" aria-label="${escapeHtml(i18nUi.text('Next primer'))}" ${view.primers.length < 2 ? 'disabled' : ''}>→</button>
      </div>
      <label class="primer-annealing-tm-floor"><span>${i18nUi.html('Minimum template Tm')}</span>
        <input type="number" data-annealing-tm-floor min="0" max="100" step="0.5" value="${view.tmFloor}" aria-label="${escapeHtml(i18nUi.text('Minimum template Tm (°C)'))}"><span>°C</span>
      </label>
      <div class="primer-annealing-modes" role="group" aria-label="${escapeHtml(i18nUi.text('DNA view'))}">
        ${['template', 'product'].map(value => `<button type="button" class="sequence-viewer-mode-btn${mode === value ? ' sequence-viewer-mode-btn-active' : ''}" data-annealing-mode="${value}" aria-pressed="${mode === value}">${i18nUi.html(value === 'template' ? 'Template' : 'Product')}</button>`).join('')}
      </div>
    </div>
    <div data-primer-annealing-detail>${detailMarkup(view)}</div>`);
    const scroller = host.querySelector('.primer-annealing-scroll');
    const oligo = host.querySelector('.primer-annealing-outline');
    if (scroller && oligo) {
      const bounds = oligo.getBBox();
      scroller.scrollLeft = Math.max(0, bounds.x + bounds.width / 2 - scroller.clientWidth / 2);
    }
  }

  function applyDraft() {
    if (applying) return;
    const view = data();
    if (!view || view.locked) return;
    const updates = [...drafts.keys()].flatMap(position => {
      const draft = data(position);
      if (!draft?.dirty) return [];
      return [{ index: position, primer: draft.primer, templateAlignment: draft.templateAlignment, range: draft.range,
        startDelta: draft.range.start - editSessions.get(position).range.start }];
    });
    if (!updates.length) return;
    const selectedIndex = index;
    const scrollLeft = root?.querySelector('.primer-annealing-scroll')?.scrollLeft || 0;
    const focused = root?.ownerDocument?.activeElement?.getAttribute?.('data-annealing-length-handle');
    applying = true;
    try {
      const nextPlan = onApply(updates, { links: linksFor(view), product: view.product });
      if (nextPlan) {
        activePlan = nextPlan; index = selectedIndex; drafts.clear();
        updates.forEach(update => { const session = editSessions.get(update.index); if (session) session.range = update.range; });
      }
      render();
    } finally { applying = false; }
    const scroller = root?.querySelector('.primer-annealing-scroll');
    if (scroller) scroller.scrollLeft = scrollLeft;
    if (focused) root?.querySelector(`[data-annealing-length-handle="${focused}"]`)?.focus({ preventScroll: true });
  }

  function setEnd(side, position) {
    const view = data();
    if (!view || view.locked || view.blockedEnds.includes(side)) return;
    const changes = resizeCoupledPrimerEnd({ index, side, position, links: linksFor(view),
      getRange: target => drafts.get(target) || sessionFor(target, view.product, view.primers).range,
      getWindow: target => sessionFor(target, view.product, view.primers).options });
    if (!changes.some(change => {
      const range = drafts.get(change.index) || editSessions.get(change.index).range;
      return change.range.start !== range.start || change.range.end !== range.end;
    })) return;
    changes.forEach(change => drafts.set(change.index, change.range));
    renderDetail(data());
  }

  function resizeFromPointer() {
    if (!drag) return;
    const view = data();
    if (!view || view.context.displayPlan !== drag.plan || index !== drag.index || view.locked) { endDrag(true); return; }
    const scroller = root.querySelector('.primer-annealing-scroll');
    const scroll = scroller?.scrollLeft || 0;
    const start = drag.side === '5' ? drag.startRange.start : drag.startRange.end;
    setEnd(drag.side, start + drag.direction * (drag.clientX - drag.startX + scroll - drag.startScroll) / drag.advance);
  }

  function endDrag(cancel = false) {
    if (!drag) return;
    const current = drag;
    drag = null;
    root.classList.remove('is-resizing-primer');
    if (root.hasPointerCapture?.(current.pointerId)) root.releasePointerCapture(current.pointerId);
    if (cancel) {
      if (activePlan === current.plan) {
        drafts.clear(); current.startDrafts.forEach((range, position) => drafts.set(position, range));
        renderDetail(data());
      }
    } else applyDraft();
  }

  function bindEvents() {
    const updateTmFloor = event => {
      const input = event.target;
      if (!input?.matches?.('[data-annealing-tm-floor]')) return;
      if (input.value === '' || !Number.isFinite(input.valueAsNumber)) {
        if (event.type === 'change') input.value = String(data()?.tmFloor ?? normalizePrimerTmFloor());
        return;
      }
      const floor = normalizePrimerTmFloor(input.valueAsNumber);
      onTmFloorChange(floor);
      if (event.type === 'change') input.value = String(floor);
      const view = data();
      if (view) renderDetail(view);
    };
    root?.addEventListener('input', updateTmFloor);
    root?.addEventListener('change', updateTmFloor);
    root?.addEventListener('click', event => {
      const modeButton = event.target?.closest?.('[data-annealing-mode]');
      const action = event.target?.closest?.('[data-annealing-action]')?.dataset.annealingAction;
      if (!modeButton && !action) return;
      event.preventDefault();
      const view = data();
      if (!view) return;
      if (modeButton) mode = modeButton.dataset.annealingMode === 'product' ? 'product' : 'template';
      if (action === 'next') index = (index + 1) % view.primers.length;
      if (action === 'previous') index = (index + view.primers.length - 1) % view.primers.length;
      render();
    });
    root?.addEventListener('change', event => {
      if (!event.target?.matches?.('[data-annealing-primer]')) return;
      index = Number(event.target.value) || 0;
      render();
    });
    root?.addEventListener('pointerdown', event => {
      const handle = event.target?.closest?.('[data-annealing-length-handle]');
      if (!handle || event.button !== 0 || drag) return;
      const view = data();
      if (!view || view.locked) return;
      event.preventDefault();
      handle.focus({ preventScroll: true });
      drag = { pointerId: event.pointerId, plan: view.context.displayPlan, index,
        side: handle.dataset.annealingLengthHandle, startRange: { ...view.range },
        startDrafts: new Map([...drafts].map(([position, range]) => [position, { ...range }])),
        direction: Number(handle.ownerSVGElement.dataset.annealingDirection) || 1,
        startX: event.clientX, clientX: event.clientX,
        startScroll: root.querySelector('.primer-annealing-scroll')?.scrollLeft || 0,
        advance: 15 * (handle.ownerSVGElement.getScreenCTM()?.a || 1) };
      root.setPointerCapture(event.pointerId);
      root.classList.add('is-resizing-primer');
    });
    root?.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      event.preventDefault();
      drag.clientX = event.clientX;
      resizeFromPointer();
    });
    root?.addEventListener('pointerup', event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      drag.clientX = event.clientX;
      resizeFromPointer();
      endDrag();
    });
    root?.addEventListener('pointercancel', () => endDrag(true));
    root?.addEventListener('lostpointercapture', () => endDrag(true));
    root?.addEventListener('keydown', event => {
      if (event.key === 'Escape' && drag) { event.preventDefault(); endDrag(true); return; }
      const handle = event.target?.closest?.('[data-annealing-length-handle]');
      if (!handle) return;
      const view = data();
      if (!view || view.locked) return;
      const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -5, PageUp: 5 }[event.key];
      if (step === undefined && !['Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const side = handle.dataset.annealingLengthHandle;
      const lower = side === '5' ? Math.max(view.options.minStart, view.range.end - view.options.maxLength) : view.range.start + view.options.minLength;
      const upper = side === '5' ? view.range.end - view.options.minLength : Math.min(view.options.maxEnd, view.range.start + view.options.maxLength);
      const direction = Number(handle.ownerSVGElement.dataset.annealingDirection) || 1;
      setEnd(side, event.key === 'Home' ? (direction === 1 ? lower : upper) : event.key === 'End' ? (direction === 1 ? upper : lower)
        : (side === '5' ? view.range.start : view.range.end) + direction * step);
    });
    root?.addEventListener('keyup', event => {
      if (event.target?.closest?.('[data-annealing-length-handle]') && ['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(event.key)) applyDraft();
    });
    root?.addEventListener('focusout', event => {
      if (!drag && event.target?.closest?.('[data-annealing-length-handle]') && !event.relatedTarget?.closest?.('[data-annealing-length-handle]')) applyDraft();
    });
  }

  return { render, bindEvents };
}
