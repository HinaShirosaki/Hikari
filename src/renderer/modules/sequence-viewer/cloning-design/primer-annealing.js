import { createPresentation } from '../../../lib/i18n/presentation.js';
import '../localization.js';
import { escapeHtml } from '../../../lib/html.js';
import { reverseComplementIupac } from '../shared.js';
import { parseInputRecords } from '../parsing.js';
import { alignPrimerToDna, annealingStats, orientedBase, primerLengthOptions, primerTemplateRecord, resizedPrimer } from './primer-annealing-model.js';

const i18nUi = createPresentation('dna');
const number = value => value === null || value === undefined ? '—' : Number(value).toFixed(1);
const measuredStats = alignment => ({ ...annealingStats(alignment), ...(alignment?.ambiguous ? { tm: null } : {}) });

function renderDuplex(primer, record, alignment, options, locked) {
  if (!alignment) return `<p class="small-note">${i18nUi.html('No reliable binding site was found in this DNA. The primer remains available in the table.')}</p>`;
  const first = alignment.columns.find(column => column.targetIndex !== null)?.targetIndex || 0;
  const last = alignment.columns.findLast(column => column.targetIndex !== null)?.targetIndex ?? first;
  const flank = index => ({ targetIndex: index, referenceBase: orientedBase(record, index, alignment.strand), base: '', primerIndex: null });
  const columns = [
    ...Array.from({ length: 10 }, (_, i) => flank(first - 10 + i)),
    ...alignment.columns,
    ...Array.from({ length: 10 }, (_, i) => flank(last + i + 1))
  ];
  const advance = 15, left = 76, width = left + columns.length * advance + 46;
  const x = index => left + (index + 0.5) * advance;
  const oligo = columns.map((column, index) => ({ ...column, index })).filter(column => column.base);
  const start = oligo[0]?.index || 0, end = oligo.at(-1)?.index || start;
  const bases = columns.map((column, index) => {
    const position = column.targetIndex === null ? null : ((column.targetIndex % record.sequence.length) + record.sequence.length) % record.sequence.length;
    const coordinate = position === null ? '' : alignment.strand === 1 ? position + 1 : record.sequence.length - position;
    const state = column.paired ? 'paired' : column.unpaired ? 'overhang' : column.targetIndex === null || column.primerIndex === null ? 'gap' : 'mismatch';
    return `${coordinate && index % 10 === 0 ? `<text class="primer-annealing-coordinate" x="${x(index)}" y="23">${coordinate}</text>` : ''}
      <text x="${x(index)}" y="57" class="primer-annealing-base">${escapeHtml(column.referenceBase || '·')}</text>
      ${column.referenceBase ? `<line class="primer-annealing-dna-bond" x1="${x(index)}" x2="${x(index)}" y1="63" y2="70"/>` : ''}
      <text x="${x(index)}" y="86" class="primer-annealing-base">${escapeHtml(reverseComplementIupac(column.referenceBase) || '·')}</text>
      ${column.paired ? `<line class="primer-annealing-pair-bond" x1="${x(index)}" x2="${x(index)}" y1="93" y2="108"/>` : ''}
      ${column.base ? `<text x="${x(index)}" y="${column.paired ? 127 : 147}" class="primer-annealing-oligo-base is-${state}" data-pair-state="${state}">${escapeHtml(column.base)}</text>` : ''}`;
  }).join('');
  // The oligo outline steps out of the duplex at mismatches and insertions.
  const top = [], bottom = [];
  oligo.forEach(column => {
    const x0 = left + column.index * advance, x1 = x0 + advance;
    const y = column.paired ? 111 : 131;
    top.push(`${x0},${y}`, `${x1},${y}`);
    bottom.unshift(`${x1},${y + 22}`, `${x0},${y + 22}`);
  });
  const handleX = left + (end + 1) * advance;
  const handleY = oligo.at(-1)?.paired ? 111 : 131;
  return `<div class="primer-annealing-scroll" tabindex="0" aria-label="${escapeHtml(i18nUi.text('Single-row primer and double-stranded DNA alignment'))}">
    <svg class="primer-annealing-duplex" width="${width}" height="190" viewBox="0 0 ${width} 190" role="group" aria-label="${escapeHtml(i18nUi.text('Primer annealing to {name}', { name: record.name || i18nUi.text('DNA') }))}">
      <text x="18" y="57" class="primer-annealing-end">5′</text><text x="18" y="86" class="primer-annealing-end">3′</text>
      <text x="${width - 24}" y="57" class="primer-annealing-end">3′</text><text x="${width - 24}" y="86" class="primer-annealing-end">5′</text>
      <polygon class="primer-annealing-outline" points="${[...top, ...bottom].join(' ')}"/>
      ${bases}
      <text x="${left + start * advance - 18}" y="${oligo[0]?.paired ? 127 : 147}" class="primer-annealing-end">5′</text>
      <text x="${handleX + 25}" y="${oligo.at(-1)?.paired ? 127 : 147}" class="primer-annealing-end">3′ →</text>
      ${locked ? '' : `<g class="primer-annealing-handle" data-annealing-length-handle tabindex="0" role="slider" aria-orientation="horizontal"
        aria-label="${escapeHtml(i18nUi.text('Primer 3′ end — drag to resize'))}" aria-valuemin="${options.min}" aria-valuemax="${options.max}" aria-valuenow="${primer.sequence.length}" aria-valuetext="${escapeHtml(i18nUi.text('{length} nucleotides', { length: primer.sequence.length }))}">
        <title>${escapeHtml(i18nUi.text('Drag the primer’s 3′ end to resize. Arrow keys adjust one base; Escape cancels a drag.'))}</title>
        <rect class="primer-annealing-handle-hit" x="${handleX - 12}" y="${handleY - 7}" width="24" height="36"/>
        <rect class="primer-annealing-handle-grip" x="${handleX - 4}" y="${handleY - 3}" width="8" height="28" rx="3"/>
        <line class="primer-annealing-handle-line" x1="${handleX}" x2="${handleX}" y1="${handleY + 3}" y2="${handleY + 19}"/>
      </g>`}
      <text x="${left}" y="179" class="primer-annealing-coordinate">${escapeHtml(primer.name)}</text>
    </svg>
  </div>`;
}

export function createPrimerAnnealingController({ root, getContext, getBridge = () => null, getStoragePath = () => '', onApply = () => {} } = {}) {
  let activePlan = null, index = 0, mode = 'template';
  let drag = null, dragFrame = null;
  const drafts = new Map(), templateCache = new Map(), alignmentCache = new Map();

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

  function data() {
    const context = getContext();
    const plan = context.displayPlan;
    if (plan !== activePlan) { activePlan = plan; drafts.clear(); alignmentCache.clear(); index = 0; }
    const primers = plan?.primers || [];
    index = Math.max(0, Math.min(index, primers.length - 1));
    const original = primers[index];
    if (!original) return null;
    const product = { ...context.record, name: context.record?.name || i18nUi.text('Final plasmid') };
    const template = templateFor(context, original);
    const productOriginalAlignment = align(original.sequence, product);
    const originalTemplateAlignment = align(original.sequence, template);
    const options = primerLengthOptions(original, product, productOriginalAlignment, originalTemplateAlignment);
    const length = drafts.get(index) ?? original.sequence.length;
    const primer = length === original.sequence.length ? original : resizedPrimer(original, length, options);
    const productAlignment = length === original.sequence.length ? productOriginalAlignment : align(primer.sequence, product);
    const templateAlignment = length === original.sequence.length ? originalTemplateAlignment : align(primer.sequence, template);
    return { context, primers, original, primer, product, template, productAlignment, templateAlignment, options,
      dirty: primer.sequence !== original.sequence,
      locked: context.locked || original.template_kind === 'oligo_pool' || !templateAlignment || template.loading || options.min === options.max };
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
    ${!selected.sequence ? `<p class="small-note">${i18nUi.html(template.loading ? 'Loading template DNA…' : 'Template DNA is unavailable for this primer. Select Product to inspect the final construct.')}</p>` : renderDuplex(primer, selected, alignment, view.options, view.locked)}
    ${alignment?.ambiguous ? `<p class="small-note primer-annealing-warning">${i18nUi.html('Multiple equally scoring binding sites were found. This is one possible alignment; its Tm is not reported.')}</p>` : ''}
    ${alignment ? `<div class="primer-annealing-legend"><span class="is-paired">${i18nUi.html('Paired')}: ${stats.paired} nt</span><span class="is-unpaired">${i18nUi.html('Unpaired ends')}: ${stats.unpaired} nt</span><span class="is-unpaired">${i18nUi.html('Mismatches / gaps')}: ${stats.mismatches} / ${stats.gaps}</span><span>${i18nUi.html('Paired GC')}: ${number(stats.gc)}%</span></div>` : ''}`;
  }

  function renderDetail(view) {
    const host = root?.querySelector?.('[data-primer-annealing-detail]');
    const scrollLeft = host?.querySelector('.primer-annealing-scroll')?.scrollLeft || 0;
    const focused = root?.ownerDocument?.activeElement?.matches?.('[data-annealing-length-handle]');
    if (host) i18nUi.setHtml(host, detailMarkup(view));
    const scroller = host?.querySelector('.primer-annealing-scroll');
    if (scroller) scroller.scrollLeft = scrollLeft;
    if (focused) host?.querySelector('[data-annealing-length-handle]')?.focus({ preventScroll: true });
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
      <div class="primer-annealing-modes" role="group" aria-label="${escapeHtml(i18nUi.text('DNA view'))}">
        ${['template', 'product'].map(value => `<button type="button" class="sequence-viewer-mode-btn${mode === value ? ' sequence-viewer-mode-btn-active' : ''}" data-annealing-mode="${value}" aria-pressed="${mode === value}">${i18nUi.html(value === 'template' ? 'Template' : 'Product')}</button>`).join('')}
      </div>
    </div>
    <div data-primer-annealing-detail>${detailMarkup(view)}</div>`);
  }

  function applyDraft() {
    const view = data();
    if (!view?.dirty || view.locked) return;
    const selectedIndex = index;
    const scrollLeft = root?.querySelector('.primer-annealing-scroll')?.scrollLeft || 0;
    const focused = root?.ownerDocument?.activeElement?.matches?.('[data-annealing-length-handle]');
    const nextPlan = onApply(index, view.primer, view.templateAlignment);
    if (nextPlan) { activePlan = nextPlan; index = selectedIndex; drafts.clear(); }
    render();
    const scroller = root?.querySelector('.primer-annealing-scroll');
    if (scroller) scroller.scrollLeft = scrollLeft;
    if (focused) root?.querySelector('[data-annealing-length-handle]')?.focus({ preventScroll: true });
  }

  function setLength(length) {
    const view = data();
    if (!view || view.locked) return;
    const next = Math.max(view.options.min, Math.min(view.options.max, Math.round(length)));
    if (next === view.primer.sequence.length) return;
    drafts.set(index, next);
    renderDetail(data());
  }

  function resizeFromPointer() {
    if (!drag) return;
    const view = data();
    if (!view || view.context.displayPlan !== drag.plan || index !== drag.index || view.locked) { endDrag(true); return; }
    const scroller = root.querySelector('.primer-annealing-scroll');
    const bounds = scroller?.getBoundingClientRect();
    const direction = bounds && drag.clientX > bounds.right - 24 ? 1 : bounds && drag.clientX < bounds.left + 24 ? -1 : 0;
    if (scroller && direction && (direction > 0 ? view.primer.sequence.length < view.options.max : view.primer.sequence.length > view.options.min)) scroller.scrollLeft += direction * 10;
    const scroll = scroller?.scrollLeft || 0;
    setLength(drag.startLength + (drag.clientX - drag.startX + scroll - drag.startScroll) / drag.advance);
    return direction;
  }

  function continueDrag() {
    dragFrame = null;
    if (resizeFromPointer() && drag) dragFrame = root.ownerDocument.defaultView.requestAnimationFrame(continueDrag);
  }

  function endDrag(cancel = false) {
    if (!drag) return;
    const current = drag;
    drag = null;
    if (dragFrame !== null) root.ownerDocument.defaultView.cancelAnimationFrame(dragFrame);
    dragFrame = null;
    root.classList.remove('is-resizing-primer');
    if (root.hasPointerCapture?.(current.pointerId)) root.releasePointerCapture(current.pointerId);
    if (cancel) {
      if (activePlan === current.plan) { drafts.set(current.index, current.startLength); renderDetail(data()); }
    } else applyDraft();
  }

  function bindEvents() {
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
      drag = { pointerId: event.pointerId, plan: view.context.displayPlan, index, startLength: view.primer.sequence.length,
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
      if (dragFrame === null) continueDrag();
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
      if (!event.target?.closest?.('[data-annealing-length-handle]')) return;
      const view = data();
      if (!view || view.locked) return;
      const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -5, PageUp: 5 }[event.key];
      if (step === undefined && !['Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      setLength(event.key === 'Home' ? view.options.min : event.key === 'End' ? view.options.max : view.primer.sequence.length + step);
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
