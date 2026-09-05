import { calculateFixedReaction } from '../../lib/bench-calculations.js';
import { buildFixedReactionCalculationTable } from '../../lib/notebook-tool-calculations.js';
import { cleanText } from './shared.js';
import { asArray } from '../../lib/normalize.js';

// The bench setup that goes with a generated protocol: one fixed-volume
// reaction, so every notebook page that plans a reaction carries the tube it is
// planning. The table itself is built by the shared notebook builder, which is
// also what re-renders it after someone edits a cell.

export function buildFixedReactionCalculation({
  id = '',
  totalVolume = '50 uL',
  fillName = 'Nuclease-free water',
  reagents = [],
  reactionLabels = [],
  nowIso = ''
} = {}) {
  const result = calculateFixedReaction({
    totalVolumeValue: totalVolume,
    totalVolumeUnit: 'uL',
    fillName,
    reagents: asArray(reagents)
  });
  // A route that runs this same setup more than once says so: which tubes those
  // are is not obvious from a single table.
  const labels = asArray(reactionLabels)
    .map((label) => cleanText(label, 120))
    .filter(Boolean);

  return {
    id: cleanText(id, 160) || 'fixed-reaction',
    type: result.type,
    mode: result.mode,
    title: result.title,
    inputs: result.inputs,
    table: buildFixedReactionCalculationTable(result, {
      totalVolume,
      extraMetaRows: labels.length > 1 ? [['Set up one reaction each', labels.join(', '), '', '', '']] : []
    }),
    result: result.resultText,
    formula: result.formulaText,
    summary: result.resultText || result.formulaText,
    createdAt: nowIso,
    status: result.status || ''
  };
}

export function buildPcrFixedReactionCalculation(pcrProgram = {}, nowIso = '', options = {}) {
  const polymerase = cleanText(pcrProgram?.polymerase, 160) || 'High-fidelity DNA polymerase';
  const formulation = cleanText(pcrProgram?.reactionFormulation, 80);
  const usesTwoXMasterMix = formulation === '2x-master-mix' || /\b2x\b.*master mix/i.test(polymerase);
  const reagents = usesTwoXMasterMix
    ? [
        { rowIndex: 1, name: 'Forward primer', stockConcentration: '10 uM', finalConcentration: '0.5 uM' },
        { rowIndex: 2, name: 'Reverse primer', stockConcentration: '10 uM', finalConcentration: '0.5 uM' },
        { rowIndex: 3, name: polymerase, stockConcentration: '2x', finalConcentration: '1x' },
        { rowIndex: 4, name: 'Template DNA (1-10 ng)', manualVolumeValue: '1 uL', note: 'Adjust template volume to its measured concentration and subtract the same volume from water.' }
      ]
    : [
        { rowIndex: 1, name: 'Forward primer', stockConcentration: '10 uM', finalConcentration: '0.5 uM' },
        { rowIndex: 2, name: 'Reverse primer', stockConcentration: '10 uM', finalConcentration: '0.5 uM' },
        { rowIndex: 3, name: 'dNTP mix', stockConcentration: '10 mM', finalConcentration: '0.2 mM' },
        { rowIndex: 4, name: polymerase, manualVolumeValue: '0.5 uL' },
        { rowIndex: 5, name: '5x polymerase buffer', stockConcentration: '5x', finalConcentration: '1x' },
        { rowIndex: 6, name: 'Template DNA (10 ng)', finalConcentration: '0.2 ng/uL' }
      ];
  return buildFixedReactionCalculation({
    id: cleanText(options?.id, 160) || 'pcr-fixed-reaction',
    totalVolume: '50 uL',
    reagents,
    reactionLabels: options?.reactionLabels,
    nowIso
  });
}

// Notes are the one part of a generated table a person wrote themselves -- the
// ng of DNA actually used, which tube it came from -- so a regenerated table
// keeps them against the row they were written on.
function withCarriedNotes(previous, next) {
  const notesByName = new Map(asArray(previous?.inputs?.reagents)
    .map((row) => [cleanText(row?.name, 160), cleanText(row?.note, 240)])
    .filter(([name, note]) => name && note));
  if (!notesByName.size) {
    return next;
  }
  const noteFor = (name) => notesByName.get(cleanText(name, 160)) || '';
  return {
    ...next,
    inputs: {
      ...next?.inputs,
      reagents: asArray(next?.inputs?.reagents).map((row) => {
        const note = noteFor(row?.name);
        return note ? { ...row, note } : row;
      })
    },
    table: next?.table
      ? {
          ...next.table,
          rows: asArray(next.table.rows).map((row) => {
            const note = noteFor(row?.[0]);
            return note ? [...row.slice(0, 4), note] : row;
          })
        }
      : next?.table
  };
}

// The generated table is replaced rather than stacked, so re-running a design
// does not leave a pile of near-identical reaction tables on the page.
export function appendGeneratedPcrReaction(calculations, reactionCalculation) {
  const generatedId = cleanText(reactionCalculation?.id, 160);
  const previous = asArray(calculations).find((calculation) => cleanText(calculation?.id, 160) === generatedId);
  return asArray(calculations)
    .filter((calculation) => cleanText(calculation?.id, 160) !== generatedId)
    .concat(withCarriedNotes(previous, reactionCalculation));
}
