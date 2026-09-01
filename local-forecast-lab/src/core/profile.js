import { isBlank, parseDateValue, parseFiniteNumber } from './value.js';

const DATE_NAMES = /(^|_)(date|time|timestamp|datetime|day|week|month|period|ds)($|_)/i;
const ID_NAMES = /(^|_)(id|sku|item|product|branch|store|site|sensor|device|entity|series|category|name|code)($|_)/i;
const VALUE_NAMES = /(^|_)(value|sales|demand|quantity|qty|count|revenue|load|usage|temperature|temp|pm25|price|amount)($|_)/i;
const FUTURE_NAMES = /(^|_)(planned|plan|scheduled|forecast|holiday|promo|promotion|price|tariff|weather|booking|capacity)($|_)/i;

function numericStats(values) {
  const numbers = values.map(parseFiniteNumber).filter((value) => value !== null);
  if (!numbers.length) return null;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const value of numbers) {
    sum += value;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { count: numbers.length, min, max, mean: sum / numbers.length };
}

export function profileTable(table, options = {}) {
  const sampleLimit = options.sampleLimit ?? 2_000;
  const sampleRows = table.rows.slice(0, sampleLimit);
  const rowCount = table.rows.length;
  const columns = table.columns.map((name) => {
    const values = sampleRows.map((row) => row[name]);
    const nonBlank = values.filter((value) => !isBlank(value));
    const numeric = nonBlank.filter((value) => parseFiniteNumber(value) !== null).length;
    const dates = nonBlank.filter((value) => parseDateValue(value) !== null).length;
    const booleans = nonBlank.filter((value) => typeof value === 'boolean' || /^(true|false|yes|no)$/i.test(String(value))).length;
    const unique = new Set(nonBlank.map((value) => String(value))).size;
    const denominator = Math.max(1, nonBlank.length);
    const uniqueRatio = unique / denominator;
    const nameDate = DATE_NAMES.test(name);
    const nameId = ID_NAMES.test(name);
    const nameValue = VALUE_NAMES.test(name);
    const nameFuture = FUTURE_NAMES.test(name);
    return {
      name,
      sampled: values.length,
      nonBlank: nonBlank.length,
      missingRatio: 1 - nonBlank.length / Math.max(1, values.length),
      numericRatio: numeric / denominator,
      dateRatio: dates / denominator,
      booleanRatio: booleans / denominator,
      unique,
      uniqueRatio,
      numericStats: numericStats(nonBlank),
      sample: [...new Set(nonBlank.slice(0, 8).map((value) => value instanceof Date ? value.toISOString() : value))],
      semanticHints: { nameDate, nameId, nameValue, nameFuture },
      scores: {
        time: Math.min(1, (dates / denominator) * 0.78 + (nameDate ? 0.35 : 0)),
        numericTarget: Math.min(1, (numeric / denominator) * 0.75 + (nameValue ? 0.25 : 0)),
        entity: Math.min(1, (nameId ? 0.45 : 0) + (unique > 1 && uniqueRatio < 0.5 ? 0.45 : 0) + (numeric / denominator < 0.2 ? 0.1 : 0)),
        futureCovariate: Math.min(1, (nameFuture ? 0.65 : 0) + (numeric / denominator > 0.8 ? 0.2 : 0))
      }
    };
  });

  return {
    name: table.name,
    rowCount,
    sampledRows: sampleRows.length,
    columnCount: table.columns.length,
    columns,
    samples: sampleRows.slice(0, 12)
  };
}

export function profileTables(tables) {
  return tables.map((table) => profileTable(table));
}

export function plannerDigest(profile) {
  return {
    table: profile.name,
    rowCount: profile.rowCount,
    columns: profile.columns.map((column) => ({
      name: column.name,
      missingRatio: Number(column.missingRatio.toFixed(3)),
      numericRatio: Number(column.numericRatio.toFixed(3)),
      dateRatio: Number(column.dateRatio.toFixed(3)),
      unique: column.unique,
      uniqueRatio: Number(column.uniqueRatio.toFixed(3)),
      hints: column.semanticHints,
      sample: column.sample.slice(0, 4)
    })),
    sampleRows: profile.samples.slice(0, 5)
  };
}
