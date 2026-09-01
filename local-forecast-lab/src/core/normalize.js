import { inferFrequency } from './frequency.js';
import { parseDateValue, parseFiniteNumber } from './value.js';

function aggregate(values, policy) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return null;
  if (policy === 'last') return finite.at(-1);
  if (policy === 'mean') return finite.reduce((sum, value) => sum + value, 0) / finite.length;
  if (policy === 'min') return Math.min(...finite);
  if (policy === 'max') return Math.max(...finite);
  return finite.reduce((sum, value) => sum + value, 0);
}

function entityKey(row, columns) {
  if (!columns?.length) return '';
  return columns.map((column) => String(row[column] ?? 'missing')).join(' / ');
}

export function normalizeTable(table, schema) {
  if (!schema.timestampColumn) throw new Error('Select a timestamp column.');
  const cells = [];
  const roles = new Map([
    ...schema.targetColumns.map((column) => [column, 'target']),
    ...schema.pastCovariateColumns.map((column) => [column, 'past_covariate']),
    ...schema.futureCovariateColumns.map((column) => [column, 'future_covariate'])
  ]);
  const parseFailures = { timestamp: 0, numeric: 0 };

  for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
    const row = table.rows[rowIndex];
    const timestamp = parseDateValue(row[schema.timestampColumn], { dayFirst: schema.dayFirst });
    if (timestamp === null) {
      parseFailures.timestamp += 1;
      continue;
    }
    const entity = entityKey(row, schema.entityColumns);
    if (schema.mode === 'long') {
      const column = schema.valueColumn ?? schema.targetColumns[0];
      const value = parseFiniteNumber(row[column]);
      if (value === null) {
        parseFailures.numeric += 1;
        continue;
      }
      cells.push({ timestamp, seriesId: entity || column, sourceColumn: column, role: 'target', value, rowIndex });
      for (const covariate of [...schema.pastCovariateColumns, ...schema.futureCovariateColumns]) {
        const covariateValue = parseFiniteNumber(row[covariate]);
        if (covariateValue !== null) cells.push({ timestamp, seriesId: entity ? `${entity} / ${covariate}` : covariate, sourceColumn: covariate, role: roles.get(covariate), value: covariateValue, rowIndex });
      }
    } else {
      for (const [column, role] of roles) {
        const value = parseFiniteNumber(row[column]);
        if (value === null) {
          if (role === 'target') parseFailures.numeric += 1;
          continue;
        }
        const seriesId = entity ? `${entity} / ${column}` : column;
        cells.push({ timestamp, seriesId, sourceColumn: column, role, value, rowIndex });
      }
    }
  }

  const grouped = new Map();
  for (const cell of cells) {
    const key = `${cell.role}\u0000${cell.seriesId}\u0000${cell.timestamp}`;
    if (!grouped.has(key)) grouped.set(key, { ...cell, values: [] });
    grouped.get(key).values.push(cell.value);
  }
  const points = [...grouped.values()].map(({ values, ...cell }) => ({ ...cell, value: aggregate(values, schema.duplicatePolicy), duplicateCount: values.length }));
  points.sort((a, b) => a.timestamp - b.timestamp || a.seriesId.localeCompare(b.seriesId));

  const targetPoints = points.filter((point) => point.role === 'target');
  const frequency = inferFrequency(targetPoints.map((point) => point.timestamp));
  const series = new Map();
  for (const point of points) {
    const key = `${point.role}\u0000${point.seriesId}`;
    if (!series.has(key)) series.set(key, { seriesId: point.seriesId, role: point.role, sourceColumn: point.sourceColumn, points: [] });
    series.get(key).points.push({ timestamp: point.timestamp, value: point.value, duplicateCount: point.duplicateCount });
  }

  return {
    points,
    series: [...series.values()],
    frequency,
    parseFailures,
    acceptedRows: new Set(points.map((point) => point.rowIndex)).size,
    sourceRows: table.rows.length
  };
}

export function alignSeries(normalized, role = 'target', stepMs = normalized.frequency.milliseconds) {
  const candidates = normalized.series.filter((series) => series.role === role);
  if (!candidates.length || !stepMs) return { timestamps: [], series: [] };
  const allTimes = candidates.flatMap((series) => series.points.map((point) => point.timestamp));
  const start = Math.min(...allTimes);
  const end = Math.max(...allTimes);
  const count = Math.floor((end - start) / stepMs) + 1;
  if (count > 250_000) throw new Error(`Resampled grid would contain ${count.toLocaleString()} rows. Aggregate to a coarser frequency.`);
  const timestamps = Array.from({ length: count }, (_, index) => start + index * stepMs);
  const aligned = candidates.map((series) => {
    const map = new Map(series.points.map((point) => [Math.round((point.timestamp - start) / stepMs), point.value]));
    return { ...series, values: timestamps.map((_, index) => map.get(index) ?? null) };
  });
  return { timestamps, series: aligned };
}

export function fillMissing(values, policy = 'null') {
  const output = values.slice();
  if (policy === 'zero') return output.map((value) => Number.isFinite(value) ? value : 0);
  if (policy === 'forward') {
    let last = null;
    for (let index = 0; index < output.length; index += 1) {
      if (Number.isFinite(output[index])) last = output[index];
      else if (last !== null) output[index] = last;
    }
  }
  if (policy === 'linear') {
    let index = 0;
    while (index < output.length) {
      if (Number.isFinite(output[index])) {
        index += 1;
        continue;
      }
      const start = index - 1;
      let end = index;
      while (end < output.length && !Number.isFinite(output[end])) end += 1;
      if (start >= 0 && end < output.length) {
        const left = output[start];
        const right = output[end];
        for (let cursor = index; cursor < end; cursor += 1) {
          output[cursor] = left + (right - left) * ((cursor - start) / (end - start));
        }
      }
      index = end;
    }
  }
  return output;
}
