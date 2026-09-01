import { quantile } from '../value.js';
import { mase, pinball, wape } from '../metrics.js';

export const DEFAULT_QUANTILES = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

function lastFinite(values) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (Number.isFinite(values[index])) return values[index];
  }
  return 0;
}

function residualDistribution(values, seasonality) {
  const residuals = [];
  for (let index = seasonality; index < values.length; index += 1) {
    if (Number.isFinite(values[index]) && Number.isFinite(values[index - seasonality])) residuals.push(values[index] - values[index - seasonality]);
  }
  if (!residuals.length) {
    for (let index = 1; index < values.length; index += 1) {
      if (Number.isFinite(values[index]) && Number.isFinite(values[index - 1])) residuals.push(values[index] - values[index - 1]);
    }
  }
  return residuals.length ? residuals.sort((a, b) => a - b) : [0];
}

export function forecastSeasonalNaive(values, horizon, seasonality = 1, probabilities = DEFAULT_QUANTILES) {
  if (!Array.isArray(values) || !values.length) throw new Error('A non-empty numeric history is required.');
  const season = Math.max(1, Math.min(Math.trunc(seasonality), values.length));
  const residuals = residualDistribution(values, season);
  const output = [];
  const fallback = lastFinite(values);

  for (let step = 0; step < horizon; step += 1) {
    const sourceIndex = values.length - season + (step % season);
    const center = Number.isFinite(values[sourceIndex]) ? values[sourceIndex] : fallback;
    const scale = Math.sqrt(1 + Math.floor(step / season));
    const quantiles = Object.fromEntries(probabilities.map((probability) => {
      const residual = quantile(residuals, probability) ?? 0;
      return [String(probability), center + residual * scale];
    }));
    output.push({ step: step + 1, point: quantiles['0.5'] ?? center, quantiles });
  }
  return output;
}

export function rollingBacktestSeasonalNaive(values, options = {}) {
  const seasonality = Math.max(1, Math.trunc(options.seasonality ?? 1));
  const requestedHoldout = Math.max(1, Math.trunc(options.holdout ?? Math.min(28, Math.floor(values.length / 4))));
  const holdout = Math.min(requestedHoldout, Math.max(1, values.length - Math.max(4, seasonality)));
  const training = values.slice(0, -holdout);
  const actual = values.slice(-holdout);
  const forecast = forecastSeasonalNaive(training, holdout, seasonality);
  const point = forecast.map((row) => row.point);
  const q10 = forecast.map((row) => row.quantiles['0.1']);
  const q90 = forecast.map((row) => row.quantiles['0.9']);
  const covered = actual.reduce((sum, value, index) => sum + (Number.isFinite(value) && value >= q10[index] && value <= q90[index] ? 1 : 0), 0);
  const finiteActual = actual.filter(Number.isFinite).length;
  return {
    holdout,
    actual,
    point,
    forecast,
    metrics: {
      wape: wape(actual, point),
      mase: mase(actual, point, training, seasonality),
      pinballMedian: pinball(actual, point, 0.5),
      intervalCoverage10to90: finiteActual ? covered / finiteActual : null
    }
  };
}

export function forecastAlignedSeries(aligned, options = {}) {
  const horizon = options.horizon ?? 14;
  const seasonality = options.seasonality ?? 1;
  return aligned.series.map((series) => ({
    seriesId: series.seriesId,
    role: series.role,
    history: series.values,
    forecast: forecastSeasonalNaive(series.values, horizon, seasonality),
    backtest: rollingBacktestSeasonalNaive(series.values, { seasonality, holdout: Math.min(horizon, 28) })
  }));
}
