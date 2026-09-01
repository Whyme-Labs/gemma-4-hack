import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { parseTextInput } from '../src/core/ingest.js';
import { profileTable } from '../src/core/profile.js';
import { inferSchema } from '../src/core/schema.js';
import { normalizeTable, alignSeries } from '../src/core/normalize.js';
import { validateForecastInput } from '../src/core/validate.js';
import { forecastAlignedSeries } from '../src/core/forecast/seasonal-naive.js';

const ROOT = new URL('..', import.meta.url).pathname;
const files = ['daily-sales.csv', 'daily-load.txt', 'long-sensors.json'];
const reports = [];

for (const filename of files) {
  const text = await readFile(join(ROOT, 'samples', filename), 'utf8');
  const tables = parseTextInput(text, filename);
  for (const table of tables) {
    const profile = profileTable(table);
    const schema = inferSchema(profile, table);
    const normalized = normalizeTable(table, schema);
    const validation = validateForecastInput(table, schema, normalized);
    let baseline = [];
    if (validation.ok) {
      baseline = forecastAlignedSeries(alignSeries(normalized, 'target'), {
        horizon: schema.horizon,
        seasonality: schema.seasonality
      }).map((series) => ({ seriesId: series.seriesId, holdout: series.backtest.holdout, metrics: series.backtest.metrics }));
    }
    reports.push({
      file: basename(filename),
      extension: extname(filename),
      table: table.name,
      rows: table.rows.length,
      columns: table.columns,
      schema: {
        mode: schema.mode,
        confidence: schema.confidence,
        timestampColumn: schema.timestampColumn,
        entityColumns: schema.entityColumns,
        targetColumns: schema.targetColumns,
        pastCovariateColumns: schema.pastCovariateColumns,
        futureCovariateColumns: schema.futureCovariateColumns,
        horizon: schema.horizon,
        seasonality: schema.seasonality
      },
      validation,
      baseline
    });
  }
}

const output = {
  generatedAt: new Date().toISOString(),
  method: 'Dependency-free deterministic ingestion, schema inference, normalization, validation, and seasonal-naive rolling holdout.',
  reports
};
await mkdir(join(ROOT, 'evidence'), { recursive: true });
await writeFile(join(ROOT, 'evidence', 'sample-evaluation.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
