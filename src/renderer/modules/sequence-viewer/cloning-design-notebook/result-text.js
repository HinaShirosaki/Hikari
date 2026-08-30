import { cleanText, normalizeSequenceText } from '../shared.js';
import { asArray } from '../../../lib/normalize.js';
import { formatBp, formatDuration, formatNumber, formatPrimerRole, formatStrategy } from './pcr-programs.js';

function buildPrimerResultTable(primers = []) {
  if (!asArray(primers).length) {
    return null;
  }
  return {
    columns: [
      { field: 'step', title: 'PCR Step' },
      { field: 'name', title: 'Primer' },
      { field: 'role', title: 'Role' },
      { field: 'sequence', title: 'Sequence' },
      { field: 'length', title: 'Length' },
      { field: 'tm', title: 'Binding Tm' },
      { field: 'gc', title: 'GC%' },
      { field: 'notes', title: 'Notes' }
    ],
    rows: asArray(primers).map((primer, index) => ({
      id: cleanText(primer?.name, 120) || `primer_${index + 1}`,
      step: cleanText(primer?.groupLabel, 120) || 'PCR',
      name: cleanText(primer?.name, 160) || `Primer ${index + 1}`,
      role: formatPrimerRole(primer?.role),
      sequence: normalizeSequenceText(primer?.sequence || ''),
      length: String(Math.max(0, Number(primer?.length) || normalizeSequenceText(primer?.sequence || '').length)),
      tm: `${formatNumber(primer?.tm, 1)} C`,
      gc: `${formatNumber(primer?.gcContent, 1)}%`,
      notes: [...asArray(primer?.warnings), ...asArray(primer?.qualityWarnings)].filter(Boolean).join(' | ')
    }))
  };
}

function formatPcrPrograms(pcrPrograms = []) {
  return asArray(pcrPrograms).flatMap((program) => [
    cleanText(program?.label, 120) || 'PCR',
    `- Primers: ${asArray(program?.primerNames).join(', ') || 'designed primer set'}`,
    `- Planned amplicon: ${formatBp(program?.ampliconLength)}`,
    `- Ta: ${formatNumber(program?.annealingTemperature, 0)} C (lowest binding Tm ${formatNumber(program?.lowestPrimerTm, 1)} C plus 3 C)`,
    `- Extension time: ${formatDuration(program?.extensionSeconds)} at 72 C (30 s/kb)`,
    ...asArray(program?.steps).map((step) => `- ${step.label}: ${step.temperature}, ${step.time}, ${step.cycles} cycle${String(step.cycles) === '1' ? '' : 's'}`),
    ''
  ]);
}

function formatProcedure(displayPlan = {}) {
  return asArray(displayPlan?.plans).flatMap((entry) => asArray(entry?.plan?.stepByStepProcedure).map((step, index) => {
    const planLabel = cleanText(entry?.label, 120);
    const title = cleanText(step?.title, 160) || `Step ${index + 1}`;
    const details = cleanText(step?.details, 900);
    return `${planLabel ? `${planLabel} - ` : ''}${title}${details ? `: ${details}` : ''}`;
  }));
}

function formatRestrictionEnzymes(displayPlan = {}) {
  return asArray(displayPlan?.plans)
    .flatMap((entry) => asArray(entry?.plan?.restrictionEnzymeSelection))
    .map((enzyme) => {
      const name = cleanText(enzyme?.name || enzyme?.site, 80) || 'Enzyme';
      const site = cleanText(enzyme?.site, 80);
      const cut = cleanText(enzyme?.cut || asArray(enzyme?.cutPatterns)[0], 80);
      return `- ${name}${site ? ` (${site})` : ''}${cut ? `, cut ${cut}` : ''}`;
    });
}

function formatNotebookResult({ source = {}, record = {}, displayPlan = {}, pcrPrograms = [] } = {}) {
  const edit = source?.editRequest || {};
  const summary = displayPlan?.summary || {};
  const procedure = formatProcedure(displayPlan);
  const restrictionEnzymes = formatRestrictionEnzymes(displayPlan);
  const warnings = asArray(displayPlan?.warnings).filter(Boolean);
  const lines = [
    'Sequence Viewer cloning design',
    '',
    `Sequence: ${cleanText(source?.recordName || record?.name, 160) || 'Edited sequence'}`,
    `Route: ${formatStrategy(displayPlan?.strategy)}`,
    `Edit: ${formatPrimerRole(edit?.type)} at ${Math.max(1, Number(edit?.start) || 1)}..${Math.max(1, Number(edit?.end) || Number(edit?.start) || 1)}`,
    `Template length: ${formatBp(summary.templateLength || normalizeSequenceText(source?.originalSequence || '').length)}`,
    `Designed result length: ${formatBp(summary.resultLength || normalizeSequenceText(record?.sequence || source?.editedSequence || '').length)}`,
    `Primer count: ${asArray(displayPlan?.primers).length.toLocaleString()}`,
    '',
    'PCR thermocycle programs',
    ...formatPcrPrograms(pcrPrograms),
    'Bench procedure',
    ...(procedure.length ? procedure.map((step, index) => `${index + 1}. ${step}`) : ['No assembly procedure was generated.'])
  ];
  if (restrictionEnzymes.length) {
    lines.push('', 'Restriction enzymes', ...restrictionEnzymes);
  }
  if (warnings.length) {
    lines.push('', 'Warnings', ...warnings.map((warning) => `- ${warning}`));
  }
  return lines.filter((line, index, list) => line || list[index - 1]).join('\n').trim();
}

export {
  buildPrimerResultTable,
  formatNotebookResult
};
