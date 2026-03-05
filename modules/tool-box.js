import { BUFFER_COMPOUNDS } from './buffer-compounds.js';

const RESIDUE_MASS = {
  A: 71.08,
  R: 156.19,
  N: 114.1,
  D: 115.09,
  C: 103.15,
  E: 129.12,
  Q: 128.13,
  G: 57.05,
  H: 137.14,
  I: 113.16,
  L: 113.16,
  K: 128.17,
  M: 131.19,
  F: 147.18,
  P: 97.12,
  S: 87.08,
  T: 101.11,
  W: 186.21,
  Y: 163.18,
  V: 99.13
};

const PKA = {
  nTerminus: 9.69,
  cTerminus: 2.34,
  K: 10.54,
  R: 12.48,
  H: 6.04,
  D: 3.9,
  E: 4.07,
  C: 8.37,
  Y: 10.46
};

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const CONCENTRATION_TO_M = {
  fM: 1e-15,
  pM: 1e-12,
  nM: 1e-9,
  uM: 1e-6,
  mM: 1e-3,
  M: 1
};

const VOLUME_TO_L = {
  uL: 1e-6,
  mL: 1e-3,
  L: 1
};

const MASS_TO_G = {
  ug: 1e-6,
  mg: 1e-3,
  g: 1,
  kg: 1e3
};

const CODON_TABLE = {
  TTT: 'F', TTC: 'F', TTA: 'L', TTG: 'L',
  TCT: 'S', TCC: 'S', TCA: 'S', TCG: 'S',
  TAT: 'Y', TAC: 'Y', TAA: '*', TAG: '*',
  TGT: 'C', TGC: 'C', TGA: '*', TGG: 'W',
  CTT: 'L', CTC: 'L', CTA: 'L', CTG: 'L',
  CCT: 'P', CCC: 'P', CCA: 'P', CCG: 'P',
  CAT: 'H', CAC: 'H', CAA: 'Q', CAG: 'Q',
  CGT: 'R', CGC: 'R', CGA: 'R', CGG: 'R',
  ATT: 'I', ATC: 'I', ATA: 'I', ATG: 'M',
  ACT: 'T', ACC: 'T', ACA: 'T', ACG: 'T',
  AAT: 'N', AAC: 'N', AAA: 'K', AAG: 'K',
  AGT: 'S', AGC: 'S', AGA: 'R', AGG: 'R',
  GTT: 'V', GTC: 'V', GTA: 'V', GTG: 'V',
  GCT: 'A', GCC: 'A', GCA: 'A', GCG: 'A',
  GAT: 'D', GAC: 'D', GAA: 'E', GAG: 'E',
  GGT: 'G', GGC: 'G', GGA: 'G', GGG: 'G'
};

const DNA_BASE_MW = { A: 313.21, T: 304.2, G: 329.21, C: 289.18 };
const RNA_BASE_MW = { A: 329.21, U: 306.17, G: 345.21, C: 305.18 };

const DNA_EXTINCTION = { A: 15400, C: 7400, G: 11500, T: 8700 };
const RNA_EXTINCTION = { A: 15400, C: 7400, G: 11500, U: 9900 };

function formatSequenceLines(sequence, lineLength = 60) {
  const lines = [];
  for (let i = 0; i < sequence.length; i += lineLength) {
    lines.push(sequence.slice(i, i + lineLength));
  }
  return lines.join('<br />');
}

function concentrationToM(value, unit) {
  return toNumber(value) * (CONCENTRATION_TO_M[unit] || 0);
}

function concentrationFromM(valueM, unit) {
  const factor = CONCENTRATION_TO_M[unit] || 0;
  return factor ? valueM / factor : 0;
}

function volumeToL(value, unit) {
  return toNumber(value) * (VOLUME_TO_L[unit] || 0);
}

function volumeFromL(valueL, unit) {
  const factor = VOLUME_TO_L[unit] || 0;
  return factor ? valueL / factor : 0;
}

function massToG(value, unit) {
  return toNumber(value) * (MASS_TO_G[unit] || 0);
}

function massFromG(valueG, unit) {
  const factor = MASS_TO_G[unit] || 0;
  return factor ? valueG / factor : 0;
}

function cleanNucleotideSequence(raw, type = 'DNA') {
  const normalized = String(raw || '').toUpperCase().replace(/[^A-Z]/g, '');
  const targetType = type === 'RNA' ? 'RNA' : 'DNA';
  if (targetType === 'RNA') {
    return normalized.replace(/T/g, 'U').replace(/[^ACGU]/g, '');
  }
  return normalized.replace(/U/g, 'T').replace(/[^ACGT]/g, '');
}

function nucleotideCounts(sequence) {
  const counts = {};
  for (const base of sequence) {
    counts[base] = (counts[base] || 0) + 1;
  }
  return counts;
}

function reverseComplementDna(sequence) {
  const complement = { A: 'T', T: 'A', G: 'C', C: 'G' };
  return [...sequence]
    .reverse()
    .map((base) => complement[base] || 'N')
    .join('');
}

function translateDnaSequence(sequence, frame = 1, stopMode = 'star') {
  const numericFrame = Number(frame);
  const isNegativeStrand = numericFrame < 0;
  const absFrame = Math.max(1, Math.min(3, Math.abs(numericFrame) || 1));
  const startIndex = absFrame - 1;
  const template = isNegativeStrand ? reverseComplementDna(sequence) : sequence;
  const coding = template.slice(startIndex);
  let protein = '';
  let codons = 0;

  for (let i = 0; i + 2 < coding.length; i += 3) {
    const codon = coding.slice(i, i + 3);
    const aa = CODON_TABLE[codon] || 'X';
    codons += 1;
    if (aa === '*' && stopMode === 'trim') {
      break;
    }
    protein += aa;
  }

  return {
    protein,
    codons,
    frame: absFrame,
    strand: isNegativeStrand ? '-' : '+',
    remainderBases: coding.length % 3
  };
}

function oligoMolecularWeight(sequence, type = 'DNA') {
  const map = type === 'RNA' ? RNA_BASE_MW : DNA_BASE_MW;
  return [...sequence].reduce((sum, base) => sum + (map[base] || 0), 0);
}

function oligoExtinction(sequence, type = 'DNA') {
  const map = type === 'RNA' ? RNA_EXTINCTION : DNA_EXTINCTION;
  return [...sequence].reduce((sum, base) => sum + (map[base] || 0), 0);
}

function oligoTm(sequence, type = 'DNA') {
  const counts = nucleotideCounts(sequence);
  const a = counts.A || 0;
  const g = counts.G || 0;
  const c = counts.C || 0;
  const tOrU = type === 'RNA' ? (counts.U || 0) : (counts.T || 0);
  const n = sequence.length;
  const gc = g + c;

  if (!n) {
    return 0;
  }

  if (n < 14) {
    return (2 * (a + tOrU)) + (4 * (g + c));
  }

  return 64.9 + (41 * (gc - 16.4)) / n;
}

function linearRegression(xValues, yValues) {
  const n = xValues.length;
  if (!n || n !== yValues.length) {
    return null;
  }

  const xMean = xValues.reduce((sum, value) => sum + value, 0) / n;
  const yMean = yValues.reduce((sum, value) => sum + value, 0) / n;

  let ssXX = 0;
  let ssXY = 0;
  let ssYY = 0;

  for (let i = 0; i < n; i += 1) {
    const dx = xValues[i] - xMean;
    const dy = yValues[i] - yMean;
    ssXX += dx * dx;
    ssXY += dx * dy;
    ssYY += dy * dy;
  }

  if (ssXX === 0) {
    return null;
  }

  const slope = ssXY / ssXX;
  const intercept = yMean - (slope * xMean);
  const rSquared = ssYY === 0 ? 1 : (ssXY * ssXY) / (ssXX * ssYY);

  return { slope, intercept, rSquared };
}

function cleanSequence(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

function countResidues(sequence) {
  const counts = {};
  for (const aa of sequence) {
    counts[aa] = (counts[aa] || 0) + 1;
  }
  return counts;
}

function calculatePeptideMass(sequence) {
  if (!sequence.length) {
    return 0;
  }

  const residueSum = [...sequence].reduce((sum, aa) => sum + (RESIDUE_MASS[aa] || 0), 0);
  return residueSum + 18.015;
}

function positiveCharge(pH, pKa, count) {
  return count * (1 / (1 + 10 ** (pH - pKa)));
}

function negativeCharge(pH, pKa, count) {
  return count * (1 / (1 + 10 ** (pKa - pH)));
}

function calculateNetCharge(sequence, pH) {
  const counts = countResidues(sequence);
  const positive =
    positiveCharge(pH, PKA.nTerminus, 1) +
    positiveCharge(pH, PKA.K, counts.K || 0) +
    positiveCharge(pH, PKA.R, counts.R || 0) +
    positiveCharge(pH, PKA.H, counts.H || 0);

  const negative =
    negativeCharge(pH, PKA.cTerminus, 1) +
    negativeCharge(pH, PKA.D, counts.D || 0) +
    negativeCharge(pH, PKA.E, counts.E || 0) +
    negativeCharge(pH, PKA.C, counts.C || 0) +
    negativeCharge(pH, PKA.Y, counts.Y || 0);

  return positive - negative;
}

function estimatePI(sequence) {
  if (!sequence.length) {
    return 0;
  }

  let low = 0;
  let high = 14;
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    const charge = calculateNetCharge(sequence, mid);
    if (charge > 0) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return (low + high) / 2;
}

function residueSummary(counts) {
  const keys = Object.keys(counts).sort();
  return keys.map((key) => `${key}:${counts[key]}`).join('  ');
}

function peptideStats(sequence) {
  const counts = countResidues(sequence);
  const invalidResidues = [...sequence].filter((aa) => !RESIDUE_MASS[aa]);
  const mass = calculatePeptideMass(sequence);
  const netCharge7 = calculateNetCharge(sequence, 7);
  const pI = estimatePI(sequence);

  const tyr = counts.Y || 0;
  const trp = counts.W || 0;
  const cys = counts.C || 0;

  return {
    counts,
    invalidResidues,
    length: sequence.length,
    mass,
    netCharge7,
    pI,
    extinctionReduced: 5500 * trp + 1490 * tyr,
    extinctionOxidized: 5500 * trp + 1490 * tyr + 125 * Math.floor(cys / 2)
  };
}

function renderChemicalOptions() {
  const options = BUFFER_COMPOUNDS.map(
    (chemical) => {
      const formTag = chemical.form === 'liquid' ? '; liquid' : '; solid';
      return `<option value="${chemical.name}">${chemical.name} (${chemical.mw} g/mol; ${chemical.category}${formTag})</option>`;
    }
  ).join('');
  return `${options}<option value="__custom__">Custom</option>`;
}

function makeBufferRow() {
  const wrapper = document.createElement('div');
  wrapper.className = 'buffer-row';
  wrapper.innerHTML = `
    <label>
      Chemical
      <select class="buffer-chemical-select">
        ${renderChemicalOptions()}
      </select>
    </label>
    <label>
      Custom Name
      <input class="buffer-custom-name" placeholder="Chemical name" disabled />
    </label>
    <label class="buffer-custom-form-wrap" hidden>
      Custom Type
      <select class="buffer-custom-form" disabled>
        <option value="solid" selected>Solid</option>
        <option value="liquid">Liquid</option>
      </select>
    </label>
    <label>
      MW (g/mol)
      <input class="buffer-mw" type="number" min="0" step="0.001" />
    </label>
    <label>
      <span class="buffer-concentration-label">Concentration (mM)</span>
      <input class="buffer-concentration" type="number" min="0" step="0.001" placeholder="e.g. 150" />
    </label>
    <div class="buffer-output">
      <span class="buffer-weight">0 mg</span>
    </div>
    <button type="button" class="ghost-btn buffer-remove-btn">Remove</button>
  `;

  const select = wrapper.querySelector('.buffer-chemical-select');
  const mwInput = wrapper.querySelector('.buffer-mw');
  const customNameInput = wrapper.querySelector('.buffer-custom-name');

  const first = BUFFER_COMPOUNDS[0];
  select.value = first.name;
  mwInput.value = first.mw;
  customNameInput.value = '';

  return wrapper;
}

export function initToolBox() {
  const toolTiles = [...document.querySelectorAll('.tool-tile')];
  const toolSubviews = [...document.querySelectorAll('.tool-subview')];
  const molarityMassForm = document.getElementById('molarity-mass-form');
  const massCalcResult = document.getElementById('mass-calc-result');
  const molarityVolumeForm = document.getElementById('molarity-volume-form');
  const volumeCalcResult = document.getElementById('volume-calc-result');
  const molarityConcentrationForm = document.getElementById('molarity-concentration-form');
  const concCalcResult = document.getElementById('conc-calc-result');
  const molarityDilutionForm = document.getElementById('molarity-dilution-form');
  const dilutionCalcResult = document.getElementById('dilution-calc-result');

  const peptideForm = document.getElementById('peptide-form');
  const peptideResult = document.getElementById('peptide-result');

  const bufferVolumeInput = document.getElementById('buffer-volume-ml');
  const bufferRows = document.getElementById('buffer-rows');
  const addBufferChemicalBtn = document.getElementById('add-buffer-chemical-btn');
  const bufferTotalResult = document.getElementById('buffer-total-result');

  const dnaProteinForm = document.getElementById('dna-protein-form');
  const dnaProteinResult = document.getElementById('dna-protein-result');

  const oligoForm = document.getElementById('oligo-form');
  const oligoResult = document.getElementById('oligo-result');

  const extinctionForm = document.getElementById('extinction-form');
  const extinctionResult = document.getElementById('extinction-result');

  const qpcrForm = document.getElementById('qpcr-form');
  const qpcrResult = document.getElementById('qpcr-result');

  function getSelectedCompound(row) {
    const select = row.querySelector('.buffer-chemical-select');
    if (select.value === '__custom__') {
      return null;
    }
    return BUFFER_COMPOUNDS.find((item) => item.name === select.value) || null;
  }

  function getBufferRowForm(row) {
    const select = row.querySelector('.buffer-chemical-select');
    if (select.value === '__custom__') {
      return row.querySelector('.buffer-custom-form').value;
    }

    const compound = getSelectedCompound(row);
    return compound?.form === 'liquid' ? 'liquid' : 'solid';
  }

  function applyBufferRowMode(row) {
    const form = getBufferRowForm(row);
    const mwInput = row.querySelector('.buffer-mw');
    const concentrationLabel = row.querySelector('.buffer-concentration-label');
    const concentrationInput = row.querySelector('.buffer-concentration');

    if (form === 'liquid') {
      concentrationLabel.textContent = 'Volume (% v/v)';
      concentrationInput.placeholder = 'e.g. 0.1';
      concentrationInput.step = '0.0001';
      mwInput.disabled = true;
    } else {
      concentrationLabel.textContent = 'Concentration (mM)';
      concentrationInput.placeholder = 'e.g. 150';
      concentrationInput.step = '0.001';
      mwInput.disabled = false;
    }
  }

  function showToolView(viewId) {
    toolSubviews.forEach((subview) => {
      subview.hidden = subview.id !== viewId;
    });
    toolTiles.forEach((tile) => {
      tile.classList.toggle('tool-tile-active', tile.dataset.toolView === viewId);
    });
  }

  function renderMolarity() {
    const massConcValue = toNumber(document.getElementById('mass-calc-concentration').value);
    const massConcUnit = document.getElementById('mass-calc-concentration-unit').value;
    const massMw = toNumber(document.getElementById('mass-calc-mw').value);
    const massVolumeValue = toNumber(document.getElementById('mass-calc-volume').value);
    const massVolumeUnit = document.getElementById('mass-calc-volume-unit').value;
    const massOutputUnit = document.getElementById('mass-calc-output-unit').value;

    const massM = concentrationToM(massConcValue, massConcUnit);
    const massL = volumeToL(massVolumeValue, massVolumeUnit);
    const massMoles = massM * massL;
    const massG = massMoles * massMw;
    const massOutput = massFromG(massG, massOutputUnit);

    if (massM > 0 && massL > 0 && massMw > 0) {
      massCalcResult.textContent = `Mass needed: ${massOutput.toFixed(6)} ${massOutputUnit} (${massG.toExponential(6)} g, ${massMoles.toExponential(6)} mol).`;
    } else {
      massCalcResult.textContent = 'Enter concentration, formula weight, and volume to calculate mass.';
    }

    const volumeMassValue = toNumber(document.getElementById('volume-calc-mass').value);
    const volumeMassUnit = document.getElementById('volume-calc-mass-unit').value;
    const volumeMw = toNumber(document.getElementById('volume-calc-mw').value);
    const volumeConcValue = toNumber(document.getElementById('volume-calc-concentration').value);
    const volumeConcUnit = document.getElementById('volume-calc-concentration-unit').value;
    const volumeOutputUnit = document.getElementById('volume-calc-output-unit').value;

    const volumeG = massToG(volumeMassValue, volumeMassUnit);
    const volumeM = concentrationToM(volumeConcValue, volumeConcUnit);
    const volumeMoles = volumeMw > 0 ? volumeG / volumeMw : 0;
    const volumeL = volumeM > 0 ? volumeMoles / volumeM : 0;
    const volumeOutput = volumeFromL(volumeL, volumeOutputUnit);

    if (volumeG > 0 && volumeMw > 0 && volumeM > 0) {
      volumeCalcResult.textContent = `Final volume: ${volumeOutput.toFixed(6)} ${volumeOutputUnit} (${volumeL.toExponential(6)} L).`;
    } else {
      volumeCalcResult.textContent = 'Enter mass, formula weight, and concentration to calculate volume.';
    }

    const concMassValue = toNumber(document.getElementById('conc-calc-mass').value);
    const concMassUnit = document.getElementById('conc-calc-mass-unit').value;
    const concMw = toNumber(document.getElementById('conc-calc-mw').value);
    const concVolumeValue = toNumber(document.getElementById('conc-calc-volume').value);
    const concVolumeUnit = document.getElementById('conc-calc-volume-unit').value;
    const concOutputUnit = document.getElementById('conc-calc-output-unit').value;

    const concMassG = massToG(concMassValue, concMassUnit);
    const concVolumeL = volumeToL(concVolumeValue, concVolumeUnit);
    const concMoles = concMw > 0 ? concMassG / concMw : 0;
    const concM = concVolumeL > 0 ? concMoles / concVolumeL : 0;
    const concOutput = concentrationFromM(concM, concOutputUnit);

    if (concMassG > 0 && concMw > 0 && concVolumeL > 0) {
      concCalcResult.textContent = `Concentration: ${concOutput.toFixed(6)} ${concOutputUnit} (${concM.toExponential(6)} M).`;
    } else {
      concCalcResult.textContent = 'Enter mass, formula weight, and volume to calculate concentration.';
    }

    const stockConcValue = toNumber(document.getElementById('dilution-stock-conc').value);
    const stockConcUnit = document.getElementById('dilution-stock-conc-unit').value;
    const targetConcValue = toNumber(document.getElementById('dilution-target-conc').value);
    const targetConcUnit = document.getElementById('dilution-target-conc-unit').value;
    const targetVolumeValue = toNumber(document.getElementById('dilution-target-volume').value);
    const targetVolumeUnit = document.getElementById('dilution-target-volume-unit').value;
    const dilutionOutputUnit = document.getElementById('dilution-output-unit').value;

    const stockM = concentrationToM(stockConcValue, stockConcUnit);
    const targetM = concentrationToM(targetConcValue, targetConcUnit);
    const targetVL = volumeToL(targetVolumeValue, targetVolumeUnit);
    const stockVL = stockM > 0 ? (targetM * targetVL) / stockM : 0;
    const diluentVL = targetVL - stockVL;
    const stockOutput = volumeFromL(stockVL, dilutionOutputUnit);
    const diluentOutput = volumeFromL(diluentVL, dilutionOutputUnit);

    if (stockM > 0 && targetM > 0 && targetVL > 0 && stockM >= targetM && diluentVL >= 0) {
      dilutionCalcResult.textContent = `Use ${stockOutput.toFixed(6)} ${dilutionOutputUnit} stock + ${diluentOutput.toFixed(6)} ${dilutionOutputUnit} diluent.`;
    } else if (stockM > 0 && targetM > stockM) {
      dilutionCalcResult.textContent = 'Desired concentration cannot be higher than stock concentration.';
    } else {
      dilutionCalcResult.textContent = 'Enter stock concentration, desired concentration, and final volume to calculate dilution.';
    }
  }

  function renderPeptide() {
    const sequence = cleanSequence(document.getElementById('peptide-sequence').value);

    if (!sequence.length) {
      peptideResult.innerHTML = '<p class="small-note">Enter a peptide sequence to calculate properties.</p>';
      return;
    }

    const stats = peptideStats(sequence);
    const countsText = residueSummary(stats.counts);

    peptideResult.innerHTML = `
      <p><strong>Length:</strong> ${stats.length} aa</p>
      <p><strong>Molecular weight:</strong> ${stats.mass.toFixed(2)} Da</p>
      <p><strong>Estimated pI:</strong> ${stats.pI.toFixed(2)}</p>
      <p><strong>Estimated net charge (pH 7.0):</strong> ${stats.netCharge7.toFixed(2)}</p>
      <p><strong>Extinction coefficient 280 nm (reduced):</strong> ${stats.extinctionReduced} M^-1 cm^-1</p>
      <p><strong>Extinction coefficient 280 nm (oxidized):</strong> ${stats.extinctionOxidized} M^-1 cm^-1</p>
      <p><strong>Residue counts:</strong> ${countsText || 'N/A'}</p>
    `;

    if (stats.invalidResidues.length) {
      peptideResult.innerHTML += '<p class="small-note">Sequence includes non-standard residues. Their masses are treated as 0.</p>';
    }
  }

  function renderDnaProtein() {
    const raw = document.getElementById('dna-protein-sequence').value;
    const type = document.getElementById('dna-protein-type').value;
    const frame = document.getElementById('dna-protein-frame').value;
    const stopMode = document.getElementById('dna-protein-stop-mode').value;

    const nucleotideSequence = cleanNucleotideSequence(raw, type);
    if (!nucleotideSequence.length) {
      dnaProteinResult.innerHTML = '<p class="small-note">Enter DNA or RNA sequence for translation.</p>';
      return;
    }

    const dnaSequence = type === 'RNA'
      ? nucleotideSequence.replace(/U/g, 'T')
      : nucleotideSequence;
    const translated = translateDnaSequence(dnaSequence, frame, stopMode);

    dnaProteinResult.innerHTML = `
      <p><strong>Nucleotide length:</strong> ${nucleotideSequence.length}</p>
      <p><strong>Reading frame:</strong> ${translated.strand}${translated.frame}</p>
      <p><strong>Codons translated:</strong> ${translated.codons}</p>
      <p><strong>Remainder bases:</strong> ${translated.remainderBases}</p>
      <p><strong>Protein length:</strong> ${translated.protein.length} aa</p>
      <p><strong>Protein sequence:</strong></p>
      <div class="sequence-block">${formatSequenceLines(translated.protein || '-')}</div>
    `;
  }

  function renderOligo() {
    const type = document.getElementById('oligo-type').value;
    const sequence = cleanNucleotideSequence(document.getElementById('oligo-sequence').value, type);
    if (!sequence.length) {
      oligoResult.innerHTML = '<p class="small-note">Enter an oligo sequence to calculate properties.</p>';
      return;
    }

    const counts = nucleotideCounts(sequence);
    const length = sequence.length;
    const gcCount = (counts.G || 0) + (counts.C || 0);
    const gcPercent = (gcCount / length) * 100;
    const tm = oligoTm(sequence, type);
    const mw = oligoMolecularWeight(sequence, type);
    const ext = oligoExtinction(sequence, type);
    const ugPerMlA260 = ext > 0 ? (mw * 1000) / ext : 0;
    const countsText = Object.keys(counts)
      .sort()
      .map((base) => `${base}:${counts[base]}`)
      .join('  ');

    oligoResult.innerHTML = `
      <p><strong>Type:</strong> ${type}</p>
      <p><strong>Length:</strong> ${length} nt</p>
      <p><strong>GC content:</strong> ${gcPercent.toFixed(2)}%</p>
      <p><strong>Approx Tm:</strong> ${tm.toFixed(2)} C</p>
      <p><strong>Approx molecular weight:</strong> ${mw.toFixed(2)} g/mol</p>
      <p><strong>Extinction coefficient (260 nm):</strong> ${ext.toFixed(0)} M^-1 cm^-1</p>
      <p><strong>A260 conversion:</strong> 1 A260 ~= ${ugPerMlA260.toFixed(2)} ug/mL</p>
      <p><strong>Base counts:</strong> ${countsText}</p>
    `;
  }

  function renderExtinction() {
    const type = document.getElementById('extinction-type').value;
    const raw = document.getElementById('extinction-sequence').value;

    if (type === 'protein') {
      const sequence = cleanSequence(raw);
      if (!sequence.length) {
        extinctionResult.innerHTML = '<p class="small-note">Enter a protein sequence.</p>';
        return;
      }

      const counts = countResidues(sequence);
      const trp = counts.W || 0;
      const tyr = counts.Y || 0;
      const cys = counts.C || 0;
      const reduced = 5500 * trp + 1490 * tyr;
      const oxidized = reduced + 125 * Math.floor(cys / 2);

      extinctionResult.innerHTML = `
        <p><strong>Sequence length:</strong> ${sequence.length} aa</p>
        <p><strong>Reduced extinction (280 nm):</strong> ${reduced} M^-1 cm^-1</p>
        <p><strong>Oxidized extinction (280 nm):</strong> ${oxidized} M^-1 cm^-1</p>
        <p><strong>Counts:</strong> W:${trp} Y:${tyr} C:${cys}</p>
      `;
      return;
    }

    const sequence = cleanNucleotideSequence(raw, type);
    if (!sequence.length) {
      extinctionResult.innerHTML = '<p class="small-note">Enter a nucleotide sequence.</p>';
      return;
    }

    const ext = oligoExtinction(sequence, type);
    const mw = oligoMolecularWeight(sequence, type);
    const ugPerMlA260 = ext > 0 ? (mw * 1000) / ext : 0;

    extinctionResult.innerHTML = `
      <p><strong>Type:</strong> ${type}</p>
      <p><strong>Length:</strong> ${sequence.length} nt</p>
      <p><strong>Extinction coefficient (260 nm):</strong> ${ext.toFixed(0)} M^-1 cm^-1</p>
      <p><strong>A260 conversion:</strong> 1 A260 ~= ${ugPerMlA260.toFixed(2)} ug/mL</p>
    `;
  }

  function renderQpcr() {
    const slopeInput = toNumber(document.getElementById('qpcr-slope').value);
    const pointsRaw = document.getElementById('qpcr-points').value.trim();

    let slope = Number.isFinite(slopeInput) && slopeInput !== 0 ? slopeInput : 0;
    let intercept = null;
    let rSquared = null;
    let pointCount = 0;

    if (pointsRaw) {
      const rows = pointsRaw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      const xValues = [];
      const yValues = [];
      rows.forEach((line) => {
        const parts = line.split(/[,\t ]+/).filter(Boolean);
        if (parts.length < 2) {
          return;
        }
        const qty = Number(parts[0]);
        const ct = Number(parts[1]);
        if (qty > 0 && Number.isFinite(ct)) {
          xValues.push(Math.log10(qty));
          yValues.push(ct);
        }
      });

      pointCount = xValues.length;
      if (pointCount >= 2) {
        const fit = linearRegression(xValues, yValues);
        if (fit) {
          slope = fit.slope;
          intercept = fit.intercept;
          rSquared = fit.rSquared;
        }
      }
    }

    if (!slope) {
      qpcrResult.innerHTML = '<p class="small-note">Enter slope or at least two quantity/Ct points.</p>';
      return;
    }

    const efficiency = (10 ** (-1 / slope)) - 1;
    const efficiencyPercent = efficiency * 100;
    const status = (efficiencyPercent >= 90 && efficiencyPercent <= 110)
      ? 'Within typical acceptable range (90-110%).'
      : 'Outside typical acceptable range (90-110%).';

    const extra = [];
    if (pointCount >= 2) {
      extra.push(`<p><strong>Points used:</strong> ${pointCount}</p>`);
    }
    if (intercept !== null) {
      extra.push(`<p><strong>Intercept:</strong> ${intercept.toFixed(4)}</p>`);
    }
    if (rSquared !== null) {
      extra.push(`<p><strong>R^2:</strong> ${rSquared.toFixed(4)}</p>`);
    }

    qpcrResult.innerHTML = `
      <p><strong>Slope:</strong> ${slope.toFixed(6)}</p>
      <p><strong>Efficiency:</strong> ${efficiencyPercent.toFixed(2)}%</p>
      <p><strong>Status:</strong> ${status}</p>
      ${extra.join('')}
    `;
  }

  function resolveChemicalName(row) {
    const select = row.querySelector('.buffer-chemical-select');
    if (select.value !== '__custom__') {
      return select.value;
    }

    return row.querySelector('.buffer-custom-name').value.trim() || 'Custom Chemical';
  }

  function renderBuffer() {
    const volumeMl = toNumber(bufferVolumeInput.value);
    const volumeL = volumeMl / 1000;

    let totalSolidMg = 0;
    let totalLiquidMl = 0;

    [...bufferRows.querySelectorAll('.buffer-row')].forEach((row) => {
      const name = resolveChemicalName(row);
      const form = getBufferRowForm(row);
      const concentrationValue = toNumber(row.querySelector('.buffer-concentration').value);

      if (form === 'liquid') {
        const requiredMl = (concentrationValue / 100) * volumeMl;
        const requiredUl = requiredMl * 1000;
        totalLiquidMl += requiredMl;
        row.querySelector('.buffer-weight').textContent = `${name}: ${requiredMl.toFixed(4)} mL (${requiredUl.toFixed(1)} uL) at ${concentrationValue.toFixed(4)}% v/v`;
        return;
      }

      const mw = toNumber(row.querySelector('.buffer-mw').value);
      const concentrationMm = concentrationValue;
      const grams = (concentrationMm / 1000) * volumeL * mw;
      const mg = grams * 1000;
      totalSolidMg += mg;
      row.querySelector('.buffer-weight').textContent = `${name}: ${mg.toFixed(3)} mg (${grams.toFixed(6)} g) at ${concentrationMm.toFixed(3)} mM`;
    });

    bufferTotalResult.textContent = `Total solids: ${totalSolidMg.toFixed(3)} mg (${(totalSolidMg / 1000).toFixed(6)} g) | Total liquids: ${totalLiquidMl.toFixed(4)} mL (${(totalLiquidMl * 1000).toFixed(1)} uL)`;
  }

  function addRow() {
    const row = makeBufferRow();
    applyBufferRowMode(row);
    bufferRows.appendChild(row);
    renderBuffer();
  }

  [
    molarityMassForm,
    molarityVolumeForm,
    molarityConcentrationForm,
    molarityDilutionForm
  ].forEach((form) => {
    form.addEventListener('input', renderMolarity);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      renderMolarity();
    });
  });

  peptideForm.addEventListener('input', renderPeptide);
  peptideForm.addEventListener('submit', (event) => {
    event.preventDefault();
    renderPeptide();
  });

  dnaProteinForm.addEventListener('input', renderDnaProtein);
  dnaProteinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    renderDnaProtein();
  });

  oligoForm.addEventListener('input', renderOligo);
  oligoForm.addEventListener('submit', (event) => {
    event.preventDefault();
    renderOligo();
  });

  extinctionForm.addEventListener('input', renderExtinction);
  extinctionForm.addEventListener('submit', (event) => {
    event.preventDefault();
    renderExtinction();
  });

  qpcrForm.addEventListener('input', renderQpcr);
  qpcrForm.addEventListener('submit', (event) => {
    event.preventDefault();
    renderQpcr();
  });

  addBufferChemicalBtn.addEventListener('click', addRow);
  bufferVolumeInput.addEventListener('input', renderBuffer);

  bufferRows.addEventListener('input', (event) => {
    const row = event.target.closest('.buffer-row');
    if (!row) {
      return;
    }

    if (event.target.classList.contains('buffer-custom-form')) {
      applyBufferRowMode(row);
    }

    renderBuffer();
  });

  bufferRows.addEventListener('click', (event) => {
    if (!event.target.classList.contains('buffer-remove-btn')) {
      return;
    }

    const row = event.target.closest('.buffer-row');
    if (!row) {
      return;
    }

    row.remove();

    if (!bufferRows.children.length) {
      addRow();
    }

    renderBuffer();
  });

  bufferRows.addEventListener('change', (event) => {
    const customForm = event.target.closest('.buffer-custom-form');
    if (customForm) {
      const row = customForm.closest('.buffer-row');
      if (row) {
        applyBufferRowMode(row);
        renderBuffer();
      }
      return;
    }

    const select = event.target.closest('.buffer-chemical-select');
    if (!select) {
      return;
    }

    const row = select.closest('.buffer-row');
    const customNameInput = row.querySelector('.buffer-custom-name');
    const customFormWrap = row.querySelector('.buffer-custom-form-wrap');
    const customFormSelect = row.querySelector('.buffer-custom-form');
    const mwInput = row.querySelector('.buffer-mw');

    if (select.value === '__custom__') {
      customNameInput.disabled = false;
      customNameInput.focus();
      customFormWrap.hidden = false;
      customFormSelect.disabled = false;
      if (customFormSelect.value === 'solid') {
        mwInput.disabled = false;
      } else {
        mwInput.disabled = true;
      }
      renderBuffer();
      return;
    }

    customNameInput.disabled = true;
    customNameInput.value = '';
    customFormWrap.hidden = true;
    customFormSelect.disabled = true;

    const chemical = BUFFER_COMPOUNDS.find((item) => item.name === select.value);
    mwInput.value = chemical ? chemical.mw : '';
    applyBufferRowMode(row);
    renderBuffer();
  });

  toolTiles.forEach((tile) => {
    tile.addEventListener('click', () => {
      showToolView(tile.dataset.toolView);
    });
  });

  showToolView('tool-molarity-view');

  addRow();
  renderMolarity();
  renderPeptide();
  renderDnaProtein();
  renderOligo();
  renderExtinction();
  renderQpcr();
}
