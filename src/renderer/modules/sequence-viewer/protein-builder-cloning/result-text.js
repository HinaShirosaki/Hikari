import { cleanText, normalizeSequenceText } from '../shared.js';
import { asArray } from '../../../lib/normalize.js';
import { resolvePcrTargets } from './cloning-plan.js';
import { clampTemperature, formatBp, formatDuration, formatNumber, formatPrimerRole, formatStrategyName, roundToFiveSeconds } from './formatting.js';

function buildProteinBuilderPcrProgram(plan = {}) {
  const primers = asArray(plan?.primerOligoPlan?.primers).filter((primer) => primer.pcrStage !== 'oligo-assembly');
  const primerTms = primers
    .map((primer) => Number(primer?.tm))
    .filter((tm) => Number.isFinite(tm) && tm > 0);
  const lowestPrimerTm = primerTms.length ? Math.min(...primerTms) : 60;
  const annealingTemperature = clampTemperature(lowestPrimerTm + 3);
  const pcrTargets = resolvePcrTargets(plan);
  const longestAmpliconLength = Math.max(
    0,
    ...pcrTargets.map((target) => Math.max(0, Number(target?.length) || 0))
  );
  const extensionSeconds = roundToFiveSeconds(Math.max(30, (longestAmpliconLength / 1000) * 30));

  return {
    polymerase: 'High-fidelity DNA polymerase',
    annealingTemperature,
    longestAmpliconLength,
    pcrTargets,
    steps: [
      { label: 'Initial denaturation', temperature: '98 C', time: '30 s', cycles: '1' },
      { label: 'Denaturation', temperature: '98 C', time: '10 s', cycles: '30' },
      { label: 'Annealing', temperature: `${annealingTemperature} C`, time: '20 s', cycles: '30' },
      { label: 'Extension', temperature: '72 C', time: formatDuration(extensionSeconds), cycles: '30' },
      { label: 'Final extension', temperature: '72 C', time: '2 min', cycles: '1' },
      { label: 'Hold', temperature: '4 C', time: 'hold', cycles: '1' }
    ],
    notes: [
      ...[...new Set(primers.map((primer) => primer.templateSourceLabel).filter(Boolean))]
        .map((label) => `Template: ${label}. Prepare it in the separate oligo assembly reaction before outer-primer PCR.`),
      `Annealing temperature is estimated from the lowest primer binding Tm (${formatNumber(lowestPrimerTm, 1)} C) plus 3 C for Q5-style high-fidelity PCR.`,
      'Binding Tm uses a SantaLucia nearest-neighbour estimate at 0.5 uM primer and 80 mM sodium-equivalent salt.',
      `Extension is estimated at 30 s/kb for the longest planned PCR target (${formatBp(longestAmpliconLength)}). Adjust to the polymerase data sheet.`
    ]
  };
}

function buildProteinBuilderPrimerResultTable(plan = {}) {
  const primers = asArray(plan?.primerOligoPlan?.primers);
  if (!primers.length) {
    return null;
  }

  const columns = [
    { field: 'name', title: 'Primer' },
    { field: 'role', title: 'Role' },
    { field: 'sequence', title: 'Sequence' },
    { field: 'length', title: 'Length' },
    { field: 'tm', title: 'Binding Tm' },
    { field: 'gc', title: 'GC%' },
    { field: 'notes', title: 'Notes' }
  ];
  const rows = primers.map((primer, index) => ({
    id: cleanText(primer?.name, 120) || `primer_${index + 1}`,
    name: cleanText(primer?.name, 160) || `Primer ${index + 1}`,
    role: formatPrimerRole(primer?.role),
    sequence: normalizeSequenceText(primer?.sequence || ''),
    length: String(Math.max(0, Number(primer?.length) || normalizeSequenceText(primer?.sequence || '').length)),
    tm: `${formatNumber(primer?.tm, 1)} C`,
    gc: `${formatNumber(primer?.gcContent, 1)}%`,
    notes: [...asArray(primer?.warnings), ...asArray(primer?.qualityWarnings)].filter(Boolean).join(' | ')
  }));

  return {
    columns,
    rows
  };
}

function formatPcrProgramLines(program = {}) {
  const lines = [
    `Polymerase: ${program.polymerase || 'High-fidelity DNA polymerase'}`,
    `Longest PCR target: ${formatBp(program.longestAmpliconLength)}`
  ];
  asArray(program.steps).forEach((step) => {
    lines.push(`- ${step.label}: ${step.temperature}, ${step.time}, ${step.cycles} cycle${String(step.cycles) === '1' ? '' : 's'}`);
  });
  asArray(program.notes).forEach((note) => {
    lines.push(`- ${note}`);
  });
  return lines;
}

function formatPrimerLines(plan = {}) {
  const primers = asArray(plan?.primerOligoPlan?.primers);
  if (!primers.length) {
    return ['No primer set was generated for the selected route.'];
  }
  return primers.map((primer) => {
    const notes = [...asArray(primer?.warnings), ...asArray(primer?.qualityWarnings)].filter(Boolean).join(' ');
    return [
      `- ${cleanText(primer?.name, 160) || 'Primer'}`,
      `role: ${formatPrimerRole(primer?.role)}`,
      `sequence: ${normalizeSequenceText(primer?.sequence || '')}`,
      `length: ${Math.max(0, Number(primer?.length) || 0)} nt`,
      `Tm: ${formatNumber(primer?.tm, 1)} C`,
      `GC: ${formatNumber(primer?.gcContent, 1)}%`,
      notes ? `notes: ${notes}` : ''
    ].filter(Boolean).join('; ');
  });
}

function formatProcedureLines(plan = {}) {
  return asArray(plan?.stepByStepProcedure).map((step, index) => {
    const title = cleanText(step?.title, 160) || `Step ${index + 1}`;
    const details = cleanText(step?.details, 600);
    return `${index + 1}. ${title}${details ? `: ${details}` : ''}`;
  });
}

function formatValidationLines(plan = {}) {
  return asArray(plan?.validationPlan).map((item) => {
    const method = cleanText(item?.method, 120) || 'validation';
    const target = cleanText(item?.target, 240);
    const rationale = cleanText(item?.rationale, 400);
    return `- ${method}${target ? `, ${target}` : ''}${rationale ? `: ${rationale}` : ''}`;
  });
}

function formatProteinBuilderCloningNotebookResult({
  constructName = '',
  backboneName = '',
  assembledRecord = {},
  plan = {},
  pcrProgram = {}
} = {}) {
  const lines = [
    'Protein Builder cloning assembly design',
    '',
    `Construct: ${cleanText(constructName, 160) || cleanText(assembledRecord?.name, 160) || 'Protein Builder Insert'}`,
    `Backbone: ${cleanText(backboneName, 160) || 'Stored backbone'}`,
    `Assembled construct length: ${formatBp(assembledRecord?.sequence?.length || plan?.assembledVectorDesign?.predictedResultLength)}`,
    `Recommended route: ${formatStrategyName(plan?.recommendedAssemblyStrategy)}`,
    `Primer threshold: ${cleanText(plan?.primerOligoPlan?.selectedThresholdLevel, 80) || 'not selected'}`,
    '',
    'PCR program',
    ...formatPcrProgramLines(pcrProgram),
    '',
    'Primers',
    ...formatPrimerLines(plan),
    '',
    'Assembly procedure',
    ...formatProcedureLines(plan),
    '',
    'Validation plan',
    ...formatValidationLines(plan)
  ];

  const warnings = asArray(plan?.warnings).filter(Boolean);
  if (warnings.length) {
    lines.push('', 'Warnings', ...warnings.map((warning) => `- ${warning}`));
  }
  if (plan?.alternateStrategyRecommendation) {
    lines.push('', `Alternate strategy: ${plan.alternateStrategyRecommendation}`);
  }

  return lines.filter((line, index, list) => line || list[index - 1]).join('\n').trim();
}

export {
  buildProteinBuilderPcrProgram,
  buildProteinBuilderPrimerResultTable,
  formatProteinBuilderCloningNotebookResult
};
