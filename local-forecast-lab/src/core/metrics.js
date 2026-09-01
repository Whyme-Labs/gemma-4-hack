export function wape(actual, predicted) {
  let error = 0;
  let denominator = 0;
  for (let index = 0; index < Math.min(actual.length, predicted.length); index += 1) {
    if (!Number.isFinite(actual[index]) || !Number.isFinite(predicted[index])) continue;
    error += Math.abs(actual[index] - predicted[index]);
    denominator += Math.abs(actual[index]);
  }
  return denominator ? error / denominator : null;
}

export function mae(actual, predicted) {
  const errors = [];
  for (let index = 0; index < Math.min(actual.length, predicted.length); index += 1) {
    if (Number.isFinite(actual[index]) && Number.isFinite(predicted[index])) errors.push(Math.abs(actual[index] - predicted[index]));
  }
  return errors.length ? errors.reduce((sum, value) => sum + value, 0) / errors.length : null;
}

export function mase(actual, predicted, training, seasonality = 1) {
  const numerator = mae(actual, predicted);
  const naiveErrors = [];
  for (let index = seasonality; index < training.length; index += 1) {
    if (Number.isFinite(training[index]) && Number.isFinite(training[index - seasonality])) {
      naiveErrors.push(Math.abs(training[index] - training[index - seasonality]));
    }
  }
  if (numerator === null || !naiveErrors.length) return null;
  const denominator = naiveErrors.reduce((sum, value) => sum + value, 0) / naiveErrors.length;
  return denominator ? numerator / denominator : null;
}

export function pinball(actual, predictedQuantile, probability) {
  const losses = [];
  for (let index = 0; index < Math.min(actual.length, predictedQuantile.length); index += 1) {
    if (!Number.isFinite(actual[index]) || !Number.isFinite(predictedQuantile[index])) continue;
    const residual = actual[index] - predictedQuantile[index];
    losses.push(residual >= 0 ? probability * residual : (probability - 1) * residual);
  }
  return losses.length ? losses.reduce((sum, value) => sum + value, 0) / losses.length : null;
}
