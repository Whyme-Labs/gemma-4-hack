function escapeCsv(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildForecastRows(results, lastTimestamp, stepMs) {
  return results.flatMap((series) => series.forecast.map((row) => ({
    series: series.seriesId,
    timestamp: new Date(lastTimestamp + row.step * stepMs).toISOString(),
    point: row.point,
    q10: row.quantiles['0.1'],
    q50: row.quantiles['0.5'],
    q90: row.quantiles['0.9']
  })));
}

export function rowsToCsv(rows) {
  if (!rows.length) return '';
  const columns = Object.keys(rows[0]);
  return [columns.join(','), ...rows.map((row) => columns.map((column) => escapeCsv(row[column])).join(','))].join('\n');
}

export function resultNarrative(results, validation, engineName) {
  const metricValues = results.map((series) => series.backtest.metrics.wape).filter(Number.isFinite);
  const medianWape = metricValues.length ? metricValues.slice().sort((a, b) => a - b)[Math.floor(metricValues.length / 2)] : null;
  const confidence = medianWape === null ? 'not measured' : medianWape < 0.15 ? 'strong baseline fit' : medianWape < 0.35 ? 'usable baseline fit' : 'weak baseline fit';
  return {
    title: `${engineName} forecast for ${results.length} series`,
    summary: medianWape === null
      ? 'A forecast was produced, but the holdout window did not contain enough finite observations for WAPE.'
      : `Median holdout WAPE is ${(medianWape * 100).toFixed(1)}%, which is a ${confidence}. Compare TimesFM-3 against this result before accepting the larger model.`,
    cautions: validation.warnings,
    medianWape
  };
}
