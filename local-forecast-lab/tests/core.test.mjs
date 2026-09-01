import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDelimited } from '../src/core/delimited.js';
import { parseJsonText } from '../src/core/ingest.js';
import { profileTable } from '../src/core/profile.js';
import { inferSchema } from '../src/core/schema.js';
import { normalizeTable, alignSeries } from '../src/core/normalize.js';
import { validateForecastInput } from '../src/core/validate.js';
import { forecastSeasonalNaive, rollingBacktestSeasonalNaive } from '../src/core/forecast/seasonal-naive.js';
import { buildTimesFmForwardInputs, decodeTimesFmLogits } from '../src/runtime/timesfm3-contract.js';
import { extractFirstJsonObject } from '../src/runtime/json.js';
import { validateShellCommand } from '../src/runtime/shell-policy.js';

const manifest = {
  format: 'timesfm3-forward-onnx-v1',
  graphFile: 'model.onnx',
  externalData: [],
  contextLength: 64,
  forecastHorizon: 32,
  maxVariates: 32,
  inputPatchLength: 32,
  outputPatchLength: 64,
  quantiles: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
  staticShape: true
};

test('delimited parser handles quotes, embedded delimiters, and normalized duplicate headers', () => {
  const parsed = parseDelimited('Date,Value,Value\n2026-01-01,"1,200",3\n');
  assert.deepEqual(parsed.columns, ['date', 'value', 'value_2']);
  assert.equal(parsed.rows[0].value, '1,200');
  assert.equal(parsed.rows[0].value_2, '3');
});

test('JSON object arrays become a table', () => {
  const tables = parseJsonText('[{"timestamp":"2026-01-01","sales":10},{"timestamp":"2026-01-02","sales":12}]');
  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0].columns, ['timestamp', 'sales']);
});

test('schema inference identifies a wide daily table and separates known-future columns', () => {
  const parsed = parseDelimited('date,sales_units,promotion_planned\n2026-01-01,10,0\n2026-01-02,12,1\n2026-01-03,14,0\n');
  const table = { name: 'sales', ...parsed };
  const profile = profileTable(table);
  const schema = inferSchema(profile, table);
  assert.equal(schema.mode, 'wide');
  assert.equal(schema.timestampColumn, 'date');
  assert.deepEqual(schema.targetColumns, ['sales_units']);
  assert.deepEqual(schema.futureCovariateColumns, ['promotion_planned']);
  assert.equal(schema.frequency.label, 'daily');
});

test('normalization aggregates duplicate cells deterministically', () => {
  const parsed = parseDelimited('date,sales\n2026-01-01,10\n2026-01-01,4\n2026-01-02,9\n');
  const table = { name: 'sales', ...parsed };
  const profile = profileTable(table);
  const schema = { ...inferSchema(profile, table), duplicatePolicy: 'sum' };
  const normalized = normalizeTable(table, schema);
  assert.equal(normalized.series[0].points[0].value, 14);
  assert.equal(normalized.series[0].points[0].duplicateCount, 2);
});

test('validation accepts an adequate weekly seasonal series', () => {
  const lines = ['date,sales'];
  for (let index = 0; index < 42; index += 1) lines.push(`2026-01-${String(index + 1).padStart(2, '0')},${10 + index % 7}`);
  // Use valid dates across months instead of relying on impossible January dates.
  const start = Date.UTC(2026, 0, 1);
  const text = ['date,sales', ...Array.from({ length: 42 }, (_, index) => `${new Date(start + index * 86400000).toISOString().slice(0, 10)},${10 + index % 7}`)].join('\n');
  const parsed = parseDelimited(text);
  const table = { name: 'sales', ...parsed };
  const profile = profileTable(table);
  const schema = inferSchema(profile, table);
  const normalized = normalizeTable(table, schema);
  const validation = validateForecastInput(table, schema, normalized);
  assert.equal(validation.ok, true);
  assert.equal(alignSeries(normalized).series[0].values.length, 42);
});

test('seasonal naive recovers a repeated weekly pattern', () => {
  const values = Array.from({ length: 70 }, (_, index) => [10, 11, 15, 13, 17, 25, 22][index % 7]);
  const forecast = forecastSeasonalNaive(values, 14, 7);
  assert.deepEqual(forecast.map((row) => row.point), values.slice(0, 14));
  const backtest = rollingBacktestSeasonalNaive(values, { seasonality: 7, holdout: 14 });
  assert.equal(backtest.metrics.wape, 0);
  assert.equal(backtest.metrics.mase, null); // The scale denominator is zero for a perfect seasonal repeat.
});

test('TimesFM forward input builder pads to 32 variates and a fixed patch shape', () => {
  const prepared = buildTimesFmForwardInputs({
    horizon: 12,
    targets: [{ id: 'sales', values: Array(80).fill(5) }]
  }, manifest);
  assert.deepEqual(prepared.tensors.values.dims, [1, 32, 4, 32]);
  assert.deepEqual(prepared.tensors.patch_cpm_mask.dims, [1, 4]);
  assert.equal(prepared.tensors.masks.data.length, 32 * 4 * 32);
  assert.equal(prepared.targetCount, 1);
});

test('TimesFM output decoder extracts median quantiles from the context anchor patch', () => {
  const prepared = buildTimesFmForwardInputs({
    horizon: 3,
    targets: [{ id: 'sales', values: Array(64).fill(5) }]
  }, manifest);
  const dims = [1, 32, 4, 64, 9];
  const data = new Float32Array(dims.reduce((a, b) => a * b));
  const flatIndex = (v, n, o, q) => ((((v * dims[2]) + n) * dims[3] + o) * dims[4]) + q;
  for (let output = 0; output < 64; output += 1) {
    for (let q = 0; q < 9; q += 1) data[flatIndex(0, 1, output, q)] = output * 10 + q;
  }
  const decoded = decodeTimesFmLogits({ data, dims }, prepared, manifest);
  assert.equal(decoded[0].seriesId, 'sales');
  assert.deepEqual(decoded[0].forecast.map((row) => row.point), [4, 14, 24]);
});

test('JSON extraction ignores wrapper text but preserves the first balanced object', () => {
  assert.deepEqual(extractFirstJsonObject('Result:\n```json\n{"mode":"wide","targetColumns":["sales"]}\n```'), {
    mode: 'wide', targetColumns: ['sales']
  });
});

test('shell policy permits read-only pipelines and rejects escape primitives', () => {
  assert.equal(validateShellCommand("jq '.columns[]' profile.json | head -20"), "jq '.columns[]' profile.json | head -20");
  assert.throws(() => validateShellCommand('cat profile.json > stolen.txt'));
  assert.throws(() => validateShellCommand('curl https://example.com'));
  assert.throws(() => validateShellCommand('echo $(cat profile.json)'));
});


test('validation counts expanded long-format entities against the 32-variate model limit', () => {
  const start = Date.UTC(2026, 0, 1);
  const rows = ['date,sensor,value'];
  for (let sensor = 0; sensor < 33; sensor += 1) {
    for (let day = 0; day < 2; day += 1) {
      rows.push(`${new Date(start + day * 86400000).toISOString().slice(0, 10)},sensor_${sensor + 1},${sensor + day}`);
    }
  }
  const parsed = parseDelimited(rows.join('\n'));
  const table = { name: 'sensors', ...parsed };
  const schema = {
    ...inferSchema(profileTable(table), table),
    mode: 'long',
    timestampColumn: 'date',
    entityColumns: ['sensor'],
    targetColumns: ['value'],
    valueColumn: 'value',
    pastCovariateColumns: [],
    futureCovariateColumns: [],
    horizon: 1,
    seasonality: 1
  };
  const normalized = normalizeTable(table, schema);
  const validation = validateForecastInput(table, schema, normalized);
  assert.equal(validation.stats.combinedVariates, 33);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(' '), /at most 32/);
});

test('validation rejects overlapping semantic roles', () => {
  const parsed = parseDelimited('date,sales\n2026-01-01,10\n2026-01-02,12\n');
  const table = { name: 'sales', ...parsed };
  const schema = {
    ...inferSchema(profileTable(table), table),
    targetColumns: ['sales'],
    pastCovariateColumns: ['sales'],
    futureCovariateColumns: [],
    horizon: 1,
    seasonality: 1
  };
  const normalized = normalizeTable(table, schema);
  const validation = validateForecastInput(table, schema, normalized);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(' '), /multiple roles/);
});
