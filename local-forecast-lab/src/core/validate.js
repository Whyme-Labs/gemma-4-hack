export function validateForecastInput(table, schema, normalized) {
  const errors = [];
  const warnings = [...(schema.warnings ?? [])];
  const targetSeries = normalized.series.filter((series) => series.role === 'target');
  const variates = normalized.series.filter((series) => ['target', 'past_covariate', 'future_covariate'].includes(series.role)).length;
  const selectedRoles = [
    ...schema.targetColumns.map((column) => [column, 'target']),
    ...schema.pastCovariateColumns.map((column) => [column, 'past-only covariate']),
    ...schema.futureCovariateColumns.map((column) => [column, 'known-future covariate'])
  ];
  const rolesByColumn = new Map();
  for (const [column, role] of selectedRoles) {
    if (!rolesByColumn.has(column)) rolesByColumn.set(column, []);
    rolesByColumn.get(column).push(role);
  }

  if (!schema.timestampColumn || !table.columns.includes(schema.timestampColumn)) errors.push('A valid timestamp column is required.');
  if (!schema.targetColumns.length) errors.push('Select at least one target column.');
  for (const [column, roles] of rolesByColumn) {
    if (roles.length > 1) errors.push(`Column '${column}' has multiple roles: ${roles.join(', ')}.`);
  }
  if (schema.timestampColumn && selectedRoles.some(([column]) => column === schema.timestampColumn)) errors.push('The timestamp column cannot also be a target or covariate.');
  for (const column of schema.entityColumns ?? []) {
    if (selectedRoles.some(([selected]) => selected === column)) errors.push(`Entity column '${column}' cannot also be a target or covariate.`);
  }
  if (!targetSeries.length) errors.push('No numeric target observations survived parsing.');
  if (!normalized.frequency.milliseconds) errors.push('At least two distinct target timestamps are required.');
  if (variates > 32) errors.push(`TimesFM-3 allows at most 32 combined target and covariate variates. Current selection: ${variates}.`);
  if (schema.horizon < 1 || schema.horizon > 1024) errors.push('Forecast horizon must be between 1 and 1024.');
  if (schema.seasonality < 1) errors.push('Seasonality must be positive.');

  const shortest = targetSeries.length ? Math.min(...targetSeries.map((series) => series.points.length)) : 0;
  const preferred = Math.max(16, schema.seasonality * 2);
  if (shortest < preferred) warnings.push(`The shortest target series has ${shortest} observations. At least ${preferred} is preferred for this seasonality.`);
  if (normalized.frequency.regularity < 0.8) warnings.push(`Time-grid regularity is ${Math.round(normalized.frequency.regularity * 100)}%. Resampling choices can dominate model output.`);
  if (normalized.parseFailures.timestamp > 0) warnings.push(`${normalized.parseFailures.timestamp} rows were skipped because their timestamp did not parse.`);
  if (normalized.parseFailures.numeric > 0) warnings.push(`${normalized.parseFailures.numeric} target cells were skipped because they were not numeric.`);
  const producedColumns = new Set(normalized.series.map((series) => series.sourceColumn));
  for (const column of [...schema.pastCovariateColumns, ...schema.futureCovariateColumns]) {
    if (!producedColumns.has(column)) warnings.push(`Covariate column '${column}' had no numeric observations and will not reach the model.`);
  }
  const duplicates = normalized.points.filter((point) => point.duplicateCount > 1).length;
  if (duplicates) warnings.push(`${duplicates} timestamp-series cells had duplicates and used the '${schema.duplicatePolicy}' policy.`);

  for (const series of targetSeries) {
    const finite = series.points.filter((point) => Number.isFinite(point.value));
    if (finite.length && finite.every((point) => point.value === finite[0].value)) warnings.push(`${series.seriesId} is constant. A complex model is unlikely to add value.`);
  }

  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    stats: {
      sourceRows: normalized.sourceRows,
      acceptedRows: normalized.acceptedRows,
      targetSeries: targetSeries.length,
      combinedVariates: variates,
      shortestTargetSeries: shortest,
      frequency: normalized.frequency
    }
  };
}
