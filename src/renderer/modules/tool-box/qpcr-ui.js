import { toNumber } from './common.js';
import { linearRegression } from './qpcr.js';

export function initQpcrTool(options = {}) {
  const rootDocument = options?.document || globalThis?.document || null;
  if (!rootDocument) {
    return;
  }

  const qpcrForm = rootDocument.getElementById('qpcr-form');
  const qpcrResult = rootDocument.getElementById('qpcr-result');
  if (!qpcrForm || !qpcrResult) {
    return;
  }

  function renderQpcr() {
    const slopeInput = toNumber(rootDocument.getElementById('qpcr-slope')?.value);
    const pointsRaw = rootDocument.getElementById('qpcr-points')?.value.trim();

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

  qpcrForm.addEventListener('input', renderQpcr);
  qpcrForm.addEventListener('submit', (event) => {
    event.preventDefault();
    renderQpcr();
  });

  renderQpcr();
}
