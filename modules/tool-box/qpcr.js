export function linearRegression(xValues, yValues) {
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
