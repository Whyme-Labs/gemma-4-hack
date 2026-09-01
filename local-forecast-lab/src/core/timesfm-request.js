function seriesMap(series) {
  return new Map(series.points.map((point) => [point.timestamp, point.value]));
}

function range(start, count, step) {
  return Array.from({ length: count }, (_, index) => start + index * step);
}

export function buildTimesFmRequestFromNormalized(normalized, manifest, horizon) {
  const step = normalized.frequency.milliseconds;
  if (!step) throw new Error('A regular time step is required for TimesFM.');
  const targets = normalized.series.filter((series) => series.role === 'target');
  const pastOnly = normalized.series.filter((series) => series.role === 'past_covariate');
  const pastFuture = normalized.series.filter((series) => series.role === 'future_covariate');
  if (!targets.length) throw new Error('No target series is available.');

  const lastTargetTimestamp = Math.max(...targets.flatMap((series) => series.points.map((point) => point.timestamp)));
  const contextStart = lastTargetTimestamp - (manifest.contextLength - 1) * step;
  const contextTimes = range(contextStart, manifest.contextLength, step);
  const futureTimes = range(lastTargetTimestamp + step, manifest.forecastHorizon, step);
  const select = (series, times) => {
    const map = seriesMap(series);
    return times.map((timestamp) => map.get(timestamp) ?? null);
  };

  return {
    horizon,
    lastTimestamp: lastTargetTimestamp,
    stepMs: step,
    targets: targets.map((series) => ({ id: series.seriesId, values: select(series, contextTimes) })),
    pastOnlyCovariates: pastOnly.map((series) => ({ id: series.seriesId, values: select(series, contextTimes) })),
    pastFutureCovariates: pastFuture.map((series) => ({ id: series.seriesId, values: [...select(series, contextTimes), ...select(series, futureTimes)] }))
  };
}
