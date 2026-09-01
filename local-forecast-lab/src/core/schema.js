import { defaultHorizon, defaultSeasonality, inferFrequency } from './frequency.js';
import { parseDateValue } from './value.js';

function top(columns, key, minimum = 0) {
  return columns.filter((column) => column.scores[key] >= minimum).sort((a, b) => b.scores[key] - a.scores[key]);
}

export function inferSchema(profile, table) {
  const time = top(profile.columns, 'time', 0.35)[0] ?? null;
  if (!time) {
    return {
      table: profile.name,
      mode: 'unknown',
      confidence: 0,
      timestampColumn: null,
      entityColumns: [],
      targetColumns: [],
      pastCovariateColumns: [],
      futureCovariateColumns: [],
      warnings: ['No column looks reliably temporal. Select a timestamp column manually.']
    };
  }

  const numeric = top(profile.columns.filter((column) => column.name !== time.name), 'numericTarget', 0.55);
  const entities = top(profile.columns.filter((column) => column.name !== time.name && column.numericRatio < 0.5), 'entity', 0.45);
  const valueLike = numeric.filter((column) => column.semanticHints.nameValue);
  const likelyLong = valueLike.length === 1 && entities.length >= 1 && numeric.length <= 4;
  const targetColumns = likelyLong ? [valueLike[0].name] : numeric.filter((column) => !column.semanticHints.nameFuture).slice(0, 24).map((column) => column.name);
  const futureCovariateColumns = numeric
    .filter((column) => column.semanticHints.nameFuture && !targetColumns.includes(column.name))
    .slice(0, 8)
    .map((column) => column.name);
  const pastCovariateColumns = numeric
    .filter((column) => !targetColumns.includes(column.name) && !futureCovariateColumns.includes(column.name))
    .slice(0, 8)
    .map((column) => column.name);
  const entityColumns = likelyLong ? [entities[0].name] : [];

  const timestamps = table.rows.slice(0, 20_000).map((row) => parseDateValue(row[time.name])).filter((value) => value !== null);
  const frequency = inferFrequency(timestamps);
  const warnings = [];
  if (time.dateRatio < 0.9) warnings.push(`${time.name} only parsed as dates in ${Math.round(time.dateRatio * 100)}% of sampled non-empty rows.`);
  if (frequency.regularity < 0.8) warnings.push('The inferred time grid is irregular. Review aggregation and resampling before trusting a forecast.');
  if (!targetColumns.length) warnings.push('No numeric target was selected automatically.');
  if (targetColumns.length + pastCovariateColumns.length + futureCovariateColumns.length > 32) warnings.push('TimesFM-3 accepts at most 32 combined variates per run.');

  const confidenceParts = [time.scores.time, targetColumns.length ? 0.9 : 0, frequency.milliseconds ? 0.8 : 0];
  const confidence = confidenceParts.reduce((sum, value) => sum + value, 0) / confidenceParts.length;
  return {
    version: 1,
    table: profile.name,
    mode: likelyLong ? 'long' : 'wide',
    confidence: Number(confidence.toFixed(3)),
    timestampColumn: time.name,
    entityColumns,
    valueColumn: likelyLong ? targetColumns[0] : null,
    targetColumns,
    pastCovariateColumns,
    futureCovariateColumns,
    frequency,
    horizon: defaultHorizon(frequency.label),
    seasonality: defaultSeasonality(frequency.label),
    duplicatePolicy: 'sum',
    missingPolicy: 'null',
    dayFirst: true,
    warnings
  };
}

export function applyPlannerPatch(schema, patch, profile) {
  const known = new Set(profile.columns.map((column) => column.name));
  const cleanList = (values) => [...new Set((Array.isArray(values) ? values : []).filter((value) => known.has(value)))];
  const next = {
    ...schema,
    mode: patch.mode === 'long' || patch.mode === 'wide' ? patch.mode : schema.mode,
    timestampColumn: known.has(patch.timestampColumn) ? patch.timestampColumn : schema.timestampColumn,
    entityColumns: cleanList(patch.entityColumns ?? schema.entityColumns),
    targetColumns: cleanList(patch.targetColumns ?? schema.targetColumns),
    pastCovariateColumns: cleanList(patch.pastCovariateColumns ?? schema.pastCovariateColumns),
    futureCovariateColumns: cleanList(patch.futureCovariateColumns ?? schema.futureCovariateColumns),
    horizon: Number.isInteger(patch.horizon) && patch.horizon > 0 && patch.horizon <= 1024 ? patch.horizon : schema.horizon,
    seasonality: Number.isInteger(patch.seasonality) && patch.seasonality > 0 && patch.seasonality <= 100_000 ? patch.seasonality : schema.seasonality
  };
  if (next.mode === 'long') next.valueColumn = next.targetColumns[0] ?? schema.valueColumn;
  return next;
}
