(function exposeAnalysis(root) {
  'use strict';

  const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

  function numeric(value, label) {
    const text = String(value).trim();
    const number = Number(text);
    if (!NUMBER.test(text) || !Number.isFinite(number) || number <= 0) {
      throw new Error(`${label}: enter a finite number greater than zero.`);
    }
    return number;
  }

  function mean(values) {
    return values.reduce((sum, value) => sum + value / values.length, 0);
  }

  function sd(values) {
    if (values.length < 2) return null;
    const average = mean(values);
    return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
  }

  function ctReplicates(value, label) {
    const text = String(value).trim();
    if (!text || /(?:undetermined|undet|n\/?a|nan|infinity)/i.test(text)) {
      throw new Error(`${label}: enter measured Ct values; blank or undetermined wells need review. They are not replaced with zero.`);
    }
    const parts = text.split(/[,;\s]+/);
    // An empty comma-delimited cell is usually an omitted well, not a zero.
    if (/^[,;]|[,;]\s*[,;]|[,;]$/.test(text) || parts.length > 96) {
      throw new Error(`${label}: use up to 96 Ct values separated by commas, with no empty values.`);
    }
    const values = parts.map(part => numeric(part, label));
    const average = mean(values);
    const deviation = sd(values);
    if (!Number.isFinite(average) || (deviation !== null && !Number.isFinite(deviation))) {
      throw new Error(`${label}: Ct values exceed the supported numeric range.`);
    }
    return { values, mean: average, sd: deviation, n: values.length };
  }

  function readRows(text, headers) {
    if (typeof text !== 'string' || text.length > 60000) throw new Error('Paste at most 60,000 characters.');
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((value, index) => ({ value, line: index + 1 }))
      .filter(({ value }) => value.trim());
    if (!lines.length) throw new Error('Paste data or load the example before analyzing.');
    const normalize = value => value.trim().toLowerCase().replace(/[ _]+/g, '');
    const first = lines[0].value.split('\t').map(normalize);
    if (headers.every((header, index) => first[index] === normalize(header)) && first.length === headers.length) lines.shift();
    if (!lines.length || lines.length > 500) throw new Error('Enter between 1 and 500 data rows.');
    return lines.map(({ value, line }) => {
      const cells = value.split('\t').map(cell => cell.trim());
      if (cells.length !== headers.length || cells.some(cell => !cell)) {
        throw new Error(`Line ${line}: expected ${headers.length} non-empty tab-separated columns (${headers.join(', ')}).`);
      }
      return { cells, line };
    });
  }

  function format(value) {
    if (value === null || value === undefined) return '—';
    if (!Number.isFinite(value)) throw new Error('Result exceeds the supported numeric range.');
    if (value !== 0 && (Math.abs(value) < 0.0001 || Math.abs(value) >= 100000)) return value.toExponential(5);
    return String(Number(value.toFixed(6)));
  }

  function expression(text, calibrator) {
    const control = String(calibrator).trim();
    if (!control) throw new Error('Choose a calibrator group.');
    const seen = new Set();
    const samples = readRows(text, ['Sample', 'Group', 'Target Ct', 'Reference Ct']).map(({ cells, line }) => {
      const [sample, group, targetText, referenceText] = cells;
      if (sample.length > 200 || group.length > 200) throw new Error(`Line ${line}: sample and group names must be at most 200 characters.`);
      const key = sample.toLowerCase();
      if (seen.has(key)) throw new Error(`Line ${line}: sample “${sample}” is repeated. Use a unique name for each biological sample and combine its technical wells in one row.`);
      seen.add(key);
      const target = ctReplicates(targetText, `Line ${line}, target`);
      const reference = ctReplicates(referenceText, `Line ${line}, reference`);
      return { sample, group, target, reference, deltaCt: target.mean - reference.mean };
    });
    const controls = samples.filter(sample => sample.group === control);
    if (!controls.length) throw new Error(`Calibrator group “${control}” does not match a group in the data (case-sensitive).`);
    const calibratorDeltaCt = mean(controls.map(sample => sample.deltaCt));
    for (const sample of samples) {
      sample.deltaDeltaCt = sample.deltaCt - calibratorDeltaCt;
      sample.log2Fold = -sample.deltaDeltaCt;
      sample.fold = 2 ** sample.log2Fold;
      if (!Number.isFinite(sample.fold) || sample.fold === 0) throw new Error(`Sample “${sample.sample}”: fold change exceeds the supported numeric range.`);
    }
    const groups = Array.from(new Set(samples.map(sample => sample.group))).map(group => {
      const members = samples.filter(sample => sample.group === group);
      const deltaValues = members.map(sample => sample.deltaCt);
      const deltaCt = mean(deltaValues);
      const log2Fold = calibratorDeltaCt - deltaCt;
      return { group, n: members.length, deltaCt, deltaCtSd: sd(deltaValues), log2Fold, geometricFold: 2 ** log2Fold };
    });
    return { kind: 'expression', samples, groups, calibrator: control, calibratorDeltaCt, controlN: controls.length };
  }

  function standardCurve(text) {
    const seen = new Set();
    const points = readRows(text, ['Quantity', 'Ct']).map(({ cells, line }) => {
      const quantity = numeric(cells[0], `Line ${line}, quantity`);
      if (seen.has(quantity)) throw new Error(`Line ${line}: repeated quantity. Combine technical replicates for the same quantity in one row.`);
      seen.add(quantity);
      return { quantity, x: Math.log10(quantity), ct: ctReplicates(cells[1], `Line ${line}, Ct`) };
    });
    if (points.length < 3) throw new Error('A standard curve needs at least three distinct positive quantities.');
    points.sort((a, b) => a.x - b.x);
    const xMean = mean(points.map(point => point.x));
    const yMean = mean(points.map(point => point.ct.mean));
    const xx = points.reduce((sum, point) => sum + (point.x - xMean) ** 2, 0);
    const yy = points.reduce((sum, point) => sum + (point.ct.mean - yMean) ** 2, 0);
    const xy = points.reduce((sum, point) => sum + (point.x - xMean) * (point.ct.mean - yMean), 0);
    const slope = xy / xx;
    if (!(slope < 0) || !Number.isFinite(slope)) throw new Error('The fitted slope must be negative: Ct should decrease as starting quantity increases.');
    const intercept = yMean - slope * xMean;
    const efficiency = 100 * (10 ** (-1 / slope) - 1);
    const rSquared = Math.min(1, Math.max(0, (xy / xx) * (xy / yy)));
    if (![intercept, efficiency, rSquared].every(Number.isFinite) || efficiency <= 0) throw new Error('The fitted curve exceeds the supported numeric range. Check the quantities and Ct values.');
    for (const point of points) {
      point.fittedCt = yMean + slope * (point.x - xMean);
      point.residual = point.ct.mean - point.fittedCt;
    }
    return { kind: 'curve', points, slope, intercept, efficiency, rSquared };
  }

  function resultTable(result) {
    const definitions = result.kind === 'expression' ? [
      ['sample', 'Sample'], ['group', 'Group'], ['target_ct_values', 'Target Ct values'], ['reference_ct_values', 'Reference Ct values'], ['target_n', 'Target wells'], ['reference_n', 'Reference wells'],
      ['target_mean', 'Target mean Ct'], ['target_sd', 'Target Ct SD'], ['reference_mean', 'Reference mean Ct'],
      ['reference_sd', 'Reference Ct SD'], ['delta_ct', 'ΔCt'], ['delta_delta_ct', 'ΔΔCt'], ['log2_fold', 'log₂ fold change'], ['fold', 'Fold change']
    ] : [['quantity', 'Starting quantity'], ['log_quantity', 'log₁₀ quantity'], ['ct_values', 'Ct values'], ['n', 'Wells'], ['mean_ct', 'Mean Ct'], ['sd', 'Ct SD'], ['fitted_ct', 'Fitted Ct'], ['residual', 'Residual Ct']];
    const rows = result.kind === 'expression' ? result.samples.map((sample, index) => ({
      id: `sample_${index + 1}`, sample: sample.sample, group: sample.group,
      target_ct_values: sample.target.values.map(format).join(', '), reference_ct_values: sample.reference.values.map(format).join(', '),
      target_n: String(sample.target.n), reference_n: String(sample.reference.n),
      target_mean: format(sample.target.mean), target_sd: format(sample.target.sd),
      reference_mean: format(sample.reference.mean), reference_sd: format(sample.reference.sd),
      delta_ct: format(sample.deltaCt), delta_delta_ct: format(sample.deltaDeltaCt), log2_fold: format(sample.log2Fold), fold: format(sample.fold)
    })) : result.points.map((point, index) => ({
      id: `standard_${index + 1}`, quantity: format(point.quantity), log_quantity: format(point.x), ct_values: point.ct.values.map(format).join(', '), n: String(point.ct.n),
      mean_ct: format(point.ct.mean), sd: format(point.ct.sd), fitted_ct: format(point.fittedCt), residual: format(point.residual)
    }));
    return { title: result.kind === 'expression' ? 'qPCR relative expression' : 'qPCR standard curve', columns: definitions.map(([field, title]) => ({ field, title })), rows };
  }

  function tsvCell(value) {
    let text = String(value).replace(/[\t\r\n]/g, ' ');
    if (/^[=+@-]/.test(text) && !NUMBER.test(text)) text = `'${text}`;
    return text;
  }

  function toTsv(table) {
    return [table.columns.map(column => tsvCell(column.title)).join('\t'),
      ...table.rows.map(row => table.columns.map(column => tsvCell(row[column.field])).join('\t'))].join('\n') + '\n';
  }

  const api = Object.freeze({ expression, standardCurve, ctReplicates, resultTable, toTsv, format });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QpcrAnalysis = api;
}(typeof window === 'object' ? window : globalThis));
