import { annotatePlasmidSequence } from '../plannotate-js.js';
import { escapeHtml, toNumber } from './common.js';
import {
  buildPlannotateSequenceViewerPayload,
  formatPlannotateLocation,
  renderPlannotateCircularMap,
  renderPlannotateLegend,
  renderPlannotateLinearMap,
  sanitizePlannotateRecordName
} from './plannotate-map.js';

export function initPlannotateTool(options = {}) {
  const rootDocument = options?.document || globalThis?.document || null;
  const onOpenSequenceViewer = typeof options?.onOpenSequenceViewer === 'function'
    ? options.onOpenSequenceViewer
    : null;
  if (!rootDocument) {
    return;
  }

  const plannotateForm = rootDocument.getElementById('plannotate-form');
  const plannotateResult = rootDocument.getElementById('plannotate-result');
  const plannotateSequenceInput = rootDocument.getElementById('plannotate-sequence');
  const plannotateTopologySelect = rootDocument.getElementById('plannotate-topology');
  const plannotateDetailedToggle = rootDocument.getElementById('plannotate-detailed');
  const plannotateMinIdentityInput = rootDocument.getElementById('plannotate-min-identity');
  const plannotateMinCoverageInput = rootDocument.getElementById('plannotate-min-coverage');
  const plannotateMinLengthInput = rootDocument.getElementById('plannotate-min-length');
  const plannotateMapHost = rootDocument.getElementById('plannotate-map');
  const plannotateMapMeta = rootDocument.getElementById('plannotate-map-meta');
  const plannotateHitCount = rootDocument.getElementById('plannotate-hit-count');
  const plannotateTableBody = rootDocument.getElementById('plannotate-table-body');
  const plannotateRunStatus = rootDocument.getElementById('plannotate-run-status');
  const plannotateModeTextBtn = rootDocument.getElementById('plannotate-mode-text');
  const plannotateModeFileBtn = rootDocument.getElementById('plannotate-mode-file');
  const plannotateTextPanel = rootDocument.getElementById('plannotate-text-panel');
  const plannotateFilePanel = rootDocument.getElementById('plannotate-file-panel');
  const plannotateEngineStatus = rootDocument.getElementById('plannotate-engine-status');
  const plannotateInstallAllBtn = rootDocument.getElementById('plannotate-install-all');
  const plannotateFileInput = rootDocument.getElementById('plannotate-file-input');
  const plannotateFileChooseBtn = rootDocument.getElementById('plannotate-file-choose');
  const plannotateFileName = rootDocument.getElementById('plannotate-file-name');
  const plannotateOpenSequenceViewerBtn = rootDocument.getElementById('plannotate-open-sequence-viewer');
  const plannotateDownloadGbkBtn = rootDocument.getElementById('plannotate-download-gbk');

  if (!plannotateForm || !plannotateResult || !plannotateMapHost || !plannotateTableBody) {
    return;
  }

  const plannotateState = {
    mode: 'text',
    fileName: '',
    fileText: '',
    lastGbk: '',
    lastRecordName: 'plasmid',
    lastSequenceViewerPayload: null
  };

  function setPlannotateStatus(message, isError = false) {
    if (!plannotateRunStatus) {
      return;
    }
    plannotateRunStatus.textContent = message;
    plannotateRunStatus.style.color = isError ? 'var(--danger)' : '';
  }

  async function refreshPlannotateEngineStatus() {
    if (!plannotateEngineStatus) {
      return;
    }

    plannotateEngineStatus.textContent = 'Checking blastn/diamond backend...';
    const checker = window.enanaApi?.plannotateCheckEnv;
    if (typeof checker !== 'function') {
      plannotateEngineStatus.textContent = 'Native backend bridge unavailable.';
      return;
    }

    try {
      const response = await checker();
      if (!response?.ok) {
        plannotateEngineStatus.textContent = `Backend check failed: ${response?.error || 'unknown error'}`;
        return;
      }

      const status = response.status || {};
      if (status.ok) {
        plannotateEngineStatus.textContent = 'Backend ready: blastn + diamond + databases detected.';
        return;
      }

      const missing = [];
      if (!status.dataDir) {
        missing.push('metadata');
      }
      if (!status.dbDir || !status.databases?.snapgene || !status.databases?.fpbase || !status.databases?.swissprot) {
        missing.push('BLAST_dbs');
      }
      if (!status.executables?.blastn) {
        missing.push('blastn');
      }
      if (!status.executables?.diamond) {
        missing.push('diamond');
      }
      const details = missing.length ? `Missing: ${missing.join(', ')}` : 'Missing backend components.';
      plannotateEngineStatus.textContent = `Backend not ready. ${details}`;
    } catch (error) {
      plannotateEngineStatus.textContent = `Backend check failed: ${error.message || error}`;
    }
  }

  function setupPlannotateMapInteractions() {
    const viewport = plannotateMapHost.querySelector('.plannotate-panzoom-viewport');
    const content = viewport?.querySelector('.plannotate-panzoom-content');
    if (!viewport || !content) {
      return;
    }

    const tooltip = rootDocument.createElement('div');
    tooltip.className = 'plannotate-map-tooltip';
    tooltip.hidden = true;
    viewport.appendChild(tooltip);

    const state = {
      scale: 1,
      panX: 0,
      panY: 0,
      dragging: false,
      pointerId: null,
      lastX: 0,
      lastY: 0
    };

    function hideTooltip() {
      tooltip.hidden = true;
    }

    function clampPan() {
      const viewportWidth = viewport.clientWidth || 1;
      const viewportHeight = viewport.clientHeight || 1;
      const contentWidth = content.scrollWidth || viewportWidth;
      const contentHeight = content.scrollHeight || viewportHeight;

      const maxX = Math.max(40, ((contentWidth * state.scale) - viewportWidth) / 2 + 24);
      const maxY = Math.max(40, ((contentHeight * state.scale) - viewportHeight) / 2 + 24);
      state.panX = Math.max(-maxX, Math.min(maxX, state.panX));
      state.panY = Math.max(-maxY, Math.min(maxY, state.panY));
    }

    function applyTransform() {
      clampPan();
      content.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.scale})`;
    }

    function updateTooltipPosition(event, text) {
      if (!text || state.dragging) {
        hideTooltip();
        return;
      }

      tooltip.textContent = text;
      tooltip.hidden = false;

      const bounds = viewport.getBoundingClientRect();
      let x = event.clientX - bounds.left + 14;
      let y = event.clientY - bounds.top + 14;
      const maxX = viewport.clientWidth - tooltip.offsetWidth - 8;
      const maxY = viewport.clientHeight - tooltip.offsetHeight - 8;
      x = Math.max(8, Math.min(maxX, x));
      y = Math.max(8, Math.min(maxY, y));
      tooltip.style.left = `${x}px`;
      tooltip.style.top = `${y}px`;
    }

    viewport.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }
      state.dragging = true;
      state.pointerId = event.pointerId;
      state.lastX = event.clientX;
      state.lastY = event.clientY;
      viewport.classList.add('is-dragging');
      viewport.setPointerCapture(event.pointerId);
      hideTooltip();
      event.preventDefault();
    });

    viewport.addEventListener('pointermove', (event) => {
      if (state.dragging && event.pointerId === state.pointerId) {
        const dx = event.clientX - state.lastX;
        const dy = event.clientY - state.lastY;
        state.lastX = event.clientX;
        state.lastY = event.clientY;
        state.panX += dx;
        state.panY += dy;
        applyTransform();
        return;
      }

      const hoverTarget = event.target?.closest?.('[data-hit-info]');
      if (hoverTarget && viewport.contains(hoverTarget)) {
        updateTooltipPosition(event, hoverTarget.getAttribute('data-hit-info'));
      } else {
        hideTooltip();
      }
    });

    function stopDragging(event) {
      if (!state.dragging || event.pointerId !== state.pointerId) {
        return;
      }
      state.dragging = false;
      state.pointerId = null;
      viewport.classList.remove('is-dragging');
      hideTooltip();
      try {
        viewport.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore pointer-capture release errors.
      }
    }

    viewport.addEventListener('pointerup', stopDragging);
    viewport.addEventListener('pointercancel', stopDragging);
    viewport.addEventListener('pointerleave', () => {
      if (!state.dragging) {
        hideTooltip();
      }
    });

    viewport.addEventListener('wheel', (event) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.12 : (1 / 1.12);
      const nextScale = Math.max(0.55, Math.min(4.5, state.scale * factor));
      if (nextScale === state.scale) {
        return;
      }
      state.scale = nextScale;
      applyTransform();
      hideTooltip();
    }, { passive: false });

    viewport.addEventListener('dblclick', () => {
      state.scale = 1;
      state.panX = 0;
      state.panY = 0;
      applyTransform();
      hideTooltip();
    });

    applyTransform();
  }

  function setPlannotateMode(mode) {
    const resolvedMode = mode === 'file' ? 'file' : 'text';
    plannotateState.mode = resolvedMode;

    if (plannotateModeTextBtn) {
      plannotateModeTextBtn.classList.toggle('plannotate-mode-btn-active', resolvedMode === 'text');
    }
    if (plannotateModeFileBtn) {
      plannotateModeFileBtn.classList.toggle('plannotate-mode-btn-active', resolvedMode === 'file');
    }
    if (plannotateTextPanel) {
      plannotateTextPanel.hidden = resolvedMode !== 'text';
    }
    if (plannotateFilePanel) {
      plannotateFilePanel.hidden = resolvedMode !== 'file';
    }
  }

  function clearPlannotateTable(message = 'No annotations yet.') {
    plannotateTableBody.innerHTML = `
      <tr>
        <td colspan="8" class="small-note">${escapeHtml(message)}</td>
      </tr>
    `;
  }

  function renderPlannotateEmptyMap(message = 'Run annotation to display the plasmid map.') {
    plannotateMapHost.innerHTML = `<p class="small-note">${escapeHtml(message)}</p>`;
  }

  function normalizeIupacDna(raw) {
    return String(raw || '')
      .toUpperCase()
      .replace(/U/g, 'T')
      .replace(/[^ACGTRYSWKMBDHVN]/g, '');
  }

  function extractPlannotateSequence(rawInput) {
    const raw = String(rawInput || '');
    const trimmed = raw.trim();
    if (!trimmed) {
      return { sequence: '', warning: '' };
    }

    const hasGenbankHeader = /^\s*LOCUS\b/im.test(trimmed);
    const originMatch = trimmed.match(/^\s*ORIGIN\b([\s\S]*)$/im);
    if (originMatch) {
      const fromOrigin = originMatch[1];
      const stopIndex = fromOrigin.search(/^\s*\/\/\s*$/m);
      const originBody = stopIndex >= 0 ? fromOrigin.slice(0, stopIndex) : fromOrigin;
      const sequence = normalizeIupacDna(originBody);
      return {
        sequence,
        warning: sequence ? '' : 'GenBank ORIGIN block was found but no DNA symbols were parsed.'
      };
    }

    if (hasGenbankHeader) {
      return {
        sequence: '',
        warning: 'GenBank input detected, but no ORIGIN section was found.'
      };
    }

    if (/^\s*>/m.test(trimmed)) {
      const sequence = normalizeIupacDna(trimmed.replace(/^>.*$/gm, ''));
      return { sequence, warning: '' };
    }

    return {
      sequence: normalizeIupacDna(trimmed),
      warning: ''
    };
  }

  function readPlannotateFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('No file selected.'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read selected file.'));
      reader.readAsText(file);
    });
  }

  function guessPlannotateRecordName(rawInput) {
    const raw = String(rawInput || '');

    if (plannotateState.mode === 'file' && plannotateState.fileName) {
      const base = plannotateState.fileName.replace(/\.[^/.]+$/, '');
      return sanitizePlannotateRecordName(base);
    }

    const locusMatch = raw.match(/^\s*LOCUS\s+(\S+)/im);
    if (locusMatch?.[1]) {
      return sanitizePlannotateRecordName(locusMatch[1]);
    }

    const fastaMatch = raw.match(/^\s*>\s*([^\s]+)/m);
    if (fastaMatch?.[1]) {
      return sanitizePlannotateRecordName(fastaMatch[1]);
    }

    return 'plasmid';
  }

  function setPlannotateGbkDownloadEnabled(isEnabled) {
    if (plannotateDownloadGbkBtn) {
      plannotateDownloadGbkBtn.disabled = !isEnabled;
    }
  }

  function setPlannotateSequenceViewerEnabled(isEnabled) {
    if (plannotateOpenSequenceViewerBtn) {
      plannotateOpenSequenceViewerBtn.disabled = !isEnabled;
    }
  }

  function clearPlannotateGbkState() {
    plannotateState.lastGbk = '';
    plannotateState.lastRecordName = 'plasmid';
    plannotateState.lastSequenceViewerPayload = null;
    setPlannotateGbkDownloadEnabled(false);
    setPlannotateSequenceViewerEnabled(false);
  }

  function downloadTextFile(content, fileName, mimeType = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = rootDocument.createElement('a');
    link.href = url;
    link.download = fileName;
    rootDocument.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function resolvePlannotateGbk(result, rawInput) {
    if (typeof result?.gbk === 'string' && result.gbk.trim()) {
      return result.gbk;
    }

    const generator = window.enanaApi?.plannotateGenerateGbk;
    if (typeof generator !== 'function') {
      return '';
    }

    const response = await generator({
      sequence: result?.sequence || '',
      topology: result?.topology || 'circular',
      hits: Array.isArray(result?.hits) ? result.hits : [],
      recordName: guessPlannotateRecordName(rawInput)
    });

    if (!response?.ok) {
      throw new Error(response?.error || 'Failed to generate GenBank output.');
    }

    return String(response.gbk || '');
  }

  async function runPlannotateAnnotation(sequence, annotationOptions) {
    const backend = window.enanaApi?.plannotateAnnotate;
    if (typeof backend === 'function') {
      const response = await backend({
        sequenceText: sequence,
        topology: annotationOptions.topology,
        detailed: annotationOptions.detailed,
        minIdentity: annotationOptions.minIdentity,
        minCoverage: annotationOptions.minCoverage,
        minHitLength: annotationOptions.minHitLength
      });
      if (!response?.ok) {
        throw new Error(response?.error || 'pLannotate backend annotation failed.');
      }
      return response.result;
    }

    const fallback = annotatePlasmidSequence(sequence, annotationOptions);
    fallback.warnings = [
      'Native blastn/diamond backend unavailable. Displaying JS fallback annotations.',
      ...(fallback.warnings || [])
    ];
    return fallback;
  }

  async function renderPlannotate() {
    const raw = plannotateState.mode === 'file'
      ? plannotateState.fileText
      : (plannotateSequenceInput?.value || '');

    const parsed = extractPlannotateSequence(raw);
    if (!parsed.sequence) {
      clearPlannotateGbkState();

      const emptyReason = plannotateState.mode === 'file'
        ? (plannotateState.fileName ? 'Selected file does not contain a valid sequence.' : 'Choose a FASTA/GenBank file to annotate.')
        : 'Paste a DNA sequence, FASTA entry, or GenBank content to annotate.';

      if (plannotateMapMeta) {
        plannotateMapMeta.textContent = '';
      }
      if (plannotateHitCount) {
        plannotateHitCount.textContent = '0 hits';
      }
      renderPlannotateEmptyMap(emptyReason);
      clearPlannotateTable(emptyReason);
      plannotateResult.innerHTML = parsed.warning
        ? `<p class="small-note">${escapeHtml(parsed.warning)}</p>`
        : `<p class="small-note">${escapeHtml(emptyReason)}</p>`;
      setPlannotateStatus('Idle');
      return;
    }

    const baseOptions = {
      topology: plannotateTopologySelect?.value || 'circular',
      detailed: Boolean(plannotateDetailedToggle?.checked),
      minIdentity: toNumber(plannotateMinIdentityInput?.value || 85),
      minCoverage: toNumber(plannotateMinCoverageInput?.value || 25) / 100,
      minHitLength: Math.round(toNumber(plannotateMinLengthInput?.value || 24))
    };

    const result = await runPlannotateAnnotation(parsed.sequence, baseOptions);
    const recordName = guessPlannotateRecordName(raw);
    const warnings = [];
    if (parsed.warning) {
      warnings.push(parsed.warning);
    }
    warnings.push(...(result.warnings || []));

    try {
      const gbk = await resolvePlannotateGbk(result, raw);
      if (gbk.trim()) {
        plannotateState.lastGbk = gbk;
        plannotateState.lastRecordName = recordName;
        setPlannotateGbkDownloadEnabled(true);
      } else {
        clearPlannotateGbkState();
        plannotateState.lastRecordName = recordName;
        warnings.push('GenBank export text was empty.');
      }
    } catch (error) {
      clearPlannotateGbkState();
      plannotateState.lastRecordName = recordName;
      warnings.push(error.message || 'GenBank export generation failed.');
    }

    if (String(result?.sequence || '').length) {
      plannotateState.lastSequenceViewerPayload = buildPlannotateSequenceViewerPayload(result, recordName);
      setPlannotateSequenceViewerEnabled(Boolean(onOpenSequenceViewer));
    } else {
      plannotateState.lastSequenceViewerPayload = null;
      setPlannotateSequenceViewerEnabled(false);
    }

    const warningRows = warnings
      .map((warning) => `<p class="small-note">${escapeHtml(warning)}</p>`)
      .join('');

    if (plannotateMapMeta) {
      plannotateMapMeta.textContent = `${result.sequenceLength.toLocaleString()} bp | ${result.topology}`;
    }
    if (plannotateHitCount) {
      plannotateHitCount.textContent = `${result.hits.length} hits`;
    }

    const mapMarkup = result.topology === 'linear'
      ? renderPlannotateLinearMap(result)
      : renderPlannotateCircularMap(result);
    const legendMarkup = renderPlannotateLegend(result.hits);
    plannotateMapHost.innerHTML = mapMarkup
      ? `${mapMarkup}${legendMarkup}`
      : '<p class="small-note">No annotations passed the current thresholds.</p>';
    setupPlannotateMapInteractions();

    if (!result.hits.length) {
      clearPlannotateTable('No annotations passed the current thresholds.');
      plannotateResult.innerHTML = `
        <p><strong>Reference features scanned:</strong> ${result.stats.referenceFeatures}</p>
        <p class="small-note">No annotations passed the current thresholds.</p>
        ${warningRows}
      `;
      setPlannotateStatus('Completed: 0 hits');
      return;
    }

    const tableRows = result.hits.map((hit, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(hit.Feature)}</td>
        <td>${escapeHtml(hit.Type)}</td>
        <td>${escapeHtml(formatPlannotateLocation(hit, result.sequenceLength))}</td>
        <td>${hit.sframe === -1 ? '-' : '+'}</td>
        <td>${hit.pident.toFixed(2)}%</td>
        <td>${hit.percmatch.toFixed(2)}%</td>
        <td>${hit.matchMode}</td>
      </tr>
    `).join('');

    plannotateTableBody.innerHTML = tableRows;
    plannotateResult.innerHTML = `
      <p><strong>Sequence length:</strong> ${result.sequenceLength.toLocaleString()} bp</p>
      <p><strong>Hits:</strong> ${result.stats.finalHits} (exact: ${result.stats.exactHits}, partial: ${result.stats.partialHits})</p>
      <p><strong>Reference features scanned:</strong> ${result.stats.referenceFeatures}</p>
      ${warningRows}
    `;
    setPlannotateStatus(`Completed: ${result.hits.length} hits`);
  }

  setPlannotateMode('text');
  setPlannotateStatus('Idle');
  renderPlannotateEmptyMap('Run annotation to display the plasmid map.');
  clearPlannotateTable('No annotations yet.');
  clearPlannotateGbkState();
  void refreshPlannotateEngineStatus();

  plannotateDownloadGbkBtn?.addEventListener('click', () => {
    if (!plannotateState.lastGbk) {
      setPlannotateStatus('Run annotation before downloading a GBK file.', true);
      return;
    }

    const baseName = sanitizePlannotateRecordName(plannotateState.lastRecordName || 'plasmid');
    downloadTextFile(plannotateState.lastGbk, `${baseName}_pLann.gbk`, 'text/plain;charset=utf-8');
    setPlannotateStatus(`Downloaded ${baseName}_pLann.gbk`);
  });

  plannotateOpenSequenceViewerBtn?.addEventListener('click', () => {
    if (!plannotateState.lastSequenceViewerPayload) {
      setPlannotateStatus('Run annotation before opening Sequence Viewer.', true);
      return;
    }
    if (!onOpenSequenceViewer) {
      setPlannotateStatus('Sequence Viewer bridge unavailable.', true);
      return;
    }

    try {
      onOpenSequenceViewer(plannotateState.lastSequenceViewerPayload);
      setPlannotateStatus('Opened annotation in Sequence Viewer.');
    } catch (error) {
      setPlannotateStatus(error?.message || 'Failed to open Sequence Viewer.', true);
    }
  });

  plannotateInstallAllBtn?.addEventListener('click', async () => {
    const installer = window.enanaApi?.plannotateInstallAll;
    if (typeof installer !== 'function') {
      setPlannotateStatus('Installer bridge unavailable.', true);
      return;
    }

    plannotateInstallAllBtn.disabled = true;
    setPlannotateStatus('Installing metadata + BLAST databases + executables...');
    if (plannotateEngineStatus) {
      plannotateEngineStatus.textContent = 'Installing pLannotate backend assets...';
    }

    try {
      const response = await installer();
      if (!response?.ok) {
        throw new Error(response?.error || 'Installation failed.');
      }

      const logs = response.result?.logs || [];
      const status = response.result?.status || {};
      const missing = [];
      if (!status.dataDir) {
        missing.push('metadata');
      }
      if (!status.dbDir || !status.databases?.snapgene || !status.databases?.fpbase || !status.databases?.swissprot) {
        missing.push('BLAST_dbs');
      }
      if (!status.executables?.blastn) {
        missing.push('blastn');
      }
      if (!status.executables?.diamond) {
        missing.push('diamond');
      }

      if (logs.length) {
        plannotateResult.innerHTML = `<p class="small-note">${escapeHtml(logs.join(' | '))}</p>`;
      }
      if (missing.length) {
        setPlannotateStatus(`Install finished, missing: ${missing.join(', ')}`, true);
      } else {
        setPlannotateStatus('Install completed.');
      }
    } catch (error) {
      setPlannotateStatus(error.message || 'Install failed.', true);
    } finally {
      plannotateInstallAllBtn.disabled = false;
      await refreshPlannotateEngineStatus();
    }
  });

  plannotateModeTextBtn?.addEventListener('click', () => {
    setPlannotateMode('text');
    clearPlannotateGbkState();
    setPlannotateStatus('Idle');
  });

  plannotateModeFileBtn?.addEventListener('click', () => {
    setPlannotateMode('file');
    clearPlannotateGbkState();
    setPlannotateStatus('Idle');
  });

  plannotateFileChooseBtn?.addEventListener('click', () => {
    plannotateFileInput?.click();
  });

  plannotateFileInput?.addEventListener('change', async () => {
    const file = plannotateFileInput.files?.[0];
    if (!file) {
      return;
    }

    try {
      setPlannotateStatus('Loading file...');
      clearPlannotateGbkState();
      plannotateState.fileText = await readPlannotateFile(file);
      plannotateState.fileName = file.name || '';
      if (plannotateFileName) {
        plannotateFileName.textContent = plannotateState.fileName || 'No file selected';
      }
      setPlannotateStatus(`Loaded ${plannotateState.fileName || 'file'}`);
    } catch (error) {
      clearPlannotateGbkState();
      plannotateState.fileText = '';
      plannotateState.fileName = '';
      if (plannotateFileName) {
        plannotateFileName.textContent = 'No file selected';
      }
      setPlannotateStatus(error.message || 'Failed to load file.', true);
    }
  });

  plannotateSequenceInput?.addEventListener('input', () => {
    if (plannotateState.mode === 'text') {
      clearPlannotateGbkState();
      setPlannotateStatus('Ready');
    }
  });

  plannotateForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setPlannotateStatus('Running annotation...');
    try {
      await renderPlannotate();
    } catch (error) {
      setPlannotateStatus(error.message || 'Annotation failed.', true);
      plannotateResult.innerHTML = `<p class="small-note">${escapeHtml(error.message || 'Annotation failed.')}</p>`;
    }
  });

  void renderPlannotate().catch(() => {});
}
