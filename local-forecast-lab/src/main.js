import { profileTable } from './core/profile.js';
import { inferSchema } from './core/schema.js';
import { normalizeTable, alignSeries } from './core/normalize.js';
import { validateForecastInput } from './core/validate.js';
import { forecastAlignedSeries } from './core/forecast/seasonal-naive.js';
import { buildForecastRows, resultNarrative, rowsToCsv } from './core/format.js';
import { buildTimesFmRequestFromNormalized } from './core/timesfm-request.js';
import { LocalSchemaPlanner } from './runtime/llm-planner.js';
import { LocalShell } from './runtime/shell-client.js';
import { IngestWorkerClient } from './runtime/ingest-client.js';
import { probeCapabilities, humanBytes } from './runtime/capabilities.js';
import { TimesFm3OnnxEngine, readTimesFmManifest } from './runtime/timesfm3-onnx.js';
import { drawForecastChart } from './ui/chart.js';
import { downloadText, option, selectedValues, setText } from './ui/dom.js';

const state = {
  tables: [],
  table: null,
  profile: null,
  schema: null,
  normalized: null,
  validation: null,
  results: null,
  resultRows: [],
  planner: null,
  shell: new LocalShell(),
  ingest: new IngestWorkerClient(),
  timesfm: new TimesFm3OnnxEngine(),
  timesfmManifest: null,
  timesfmFiles: null
};

const $ = (id) => document.getElementById(id);
const elements = Object.fromEntries([
  'capabilitySummary', 'fileInput', 'dropZone', 'loadSample', 'tableSelect', 'dataStatus', 'profileBody', 'profileSummary',
  'modeSelect', 'timestampSelect', 'entitySelect', 'targetSelect', 'pastSelect', 'futureSelect', 'horizonInput', 'seasonalityInput',
  'schemaJson', 'schemaWarnings', 'plannerGoal', 'runPlanner', 'plannerStatus', 'shellLog', 'inspectShell',
  'runBaseline', 'engineStatus', 'resultSummary', 'resultWarnings', 'resultTableBody', 'seriesSelect', 'forecastCanvas', 'exportCsv', 'exportJson',
  'timesfmFiles', 'timesfmLicense', 'loadTimesfm', 'runTimesfm', 'timesfmStatus', 'modelManifest'
].map((id) => [id, $(id)]));

function formatRatio(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(0)}%` : 'n/a';
}

function rowsToSmallCsv(rows, columns, limit = 30) {
  return rowsToCsv(rows.slice(0, limit).map((row) => Object.fromEntries(columns.map((column) => [column, row[column]]))));
}

function status(element, message, kind = '') {
  element.className = `status ${kind}`.trim();
  setText(element, message);
}

function syncSchemaFromForm() {
  if (!state.schema) return;
  state.schema = {
    ...state.schema,
    mode: elements.modeSelect.value,
    timestampColumn: elements.timestampSelect.value || null,
    entityColumns: selectedValues(elements.entitySelect),
    targetColumns: selectedValues(elements.targetSelect),
    valueColumn: elements.modeSelect.value === 'long' ? selectedValues(elements.targetSelect)[0] ?? null : null,
    pastCovariateColumns: selectedValues(elements.pastSelect),
    futureCovariateColumns: selectedValues(elements.futureSelect),
    horizon: Math.max(1, Number.parseInt(elements.horizonInput.value, 10) || 1),
    seasonality: Math.max(1, Number.parseInt(elements.seasonalityInput.value, 10) || 1)
  };
  renderSchemaJson();
}

function fillMultiSelect(select, columns, selected) {
  select.replaceChildren(...columns.map((column) => option(column, column, selected.includes(column))));
}

function renderProfile() {
  if (!state.profile) return;
  elements.profileSummary.textContent = `${state.profile.rowCount.toLocaleString()} rows, ${state.profile.columnCount} columns, ${state.profile.sampledRows.toLocaleString()} rows profiled.`;
  elements.profileBody.replaceChildren(...state.profile.columns.map((column) => {
    const row = document.createElement('tr');
    for (const value of [
      column.name,
      formatRatio(column.missingRatio),
      formatRatio(column.numericRatio),
      formatRatio(column.dateRatio),
      column.unique.toLocaleString(),
      column.sample.slice(0, 3).join(' · ')
    ]) {
      const cell = document.createElement('td');
      cell.textContent = String(value);
      row.appendChild(cell);
    }
    return row;
  }));
}

function renderSchemaForm() {
  if (!state.schema || !state.profile) return;
  const columns = state.profile.columns.map((column) => column.name);
  elements.modeSelect.value = state.schema.mode;
  elements.timestampSelect.replaceChildren(option('', 'Select timestamp'), ...columns.map((column) => option(column, column, column === state.schema.timestampColumn)));
  fillMultiSelect(elements.entitySelect, columns, state.schema.entityColumns ?? []);
  fillMultiSelect(elements.targetSelect, columns, state.schema.targetColumns ?? []);
  fillMultiSelect(elements.pastSelect, columns, state.schema.pastCovariateColumns ?? []);
  fillMultiSelect(elements.futureSelect, columns, state.schema.futureCovariateColumns ?? []);
  elements.horizonInput.value = state.schema.horizon ?? 14;
  elements.seasonalityInput.value = state.schema.seasonality ?? 7;
  renderSchemaJson();
}

function renderSchemaJson() {
  if (!state.schema) return;
  elements.schemaJson.textContent = JSON.stringify(state.schema, null, 2);
  elements.schemaWarnings.replaceChildren(...(state.schema.warnings ?? []).map((warning) => {
    const item = document.createElement('li');
    item.textContent = warning;
    return item;
  }));
}

function selectTable(index) {
  state.table = state.tables[index];
  state.profile = profileTable(state.table);
  state.schema = inferSchema(state.profile, state.table);
  state.normalized = null;
  state.results = null;
  renderProfile();
  renderSchemaForm();
  status(elements.dataStatus, `Loaded '${state.table.name}'. Review the proposed schema before forecasting.`, 'ok');
}

function setTables(tables) {
  if (!tables.length) throw new Error('No non-empty table was found.');
  state.tables = tables;
  elements.tableSelect.replaceChildren(...tables.map((table, index) => option(String(index), `${table.name} · ${table.rows.length.toLocaleString()} rows`, index === 0)));
  selectTable(0);
}

async function ingestFile(file) {
  status(elements.dataStatus, `Reading ${file.name} locally...`, 'working');
  const tables = await state.ingest.file(file);
  setTables(tables);
}

async function loadSample() {
  status(elements.dataStatus, 'Loading bundled sample...', 'working');
  const response = await fetch('/samples/daily-sales.csv');
  if (!response.ok) throw new Error('Sample file could not be loaded.');
  setTables(await state.ingest.text(await response.text(), 'daily-sales.csv'));
}

function renderValidation(validation) {
  elements.resultWarnings.replaceChildren(...[...validation.errors, ...validation.warnings].map((message) => {
    const item = document.createElement('li');
    item.textContent = message;
    item.className = validation.errors.includes(message) ? 'error-text' : '';
    return item;
  }));
}

function renderResults(results, rows, narrative, engineLabel) {
  state.results = results;
  state.resultRows = rows;
  elements.resultSummary.innerHTML = '';
  const title = document.createElement('h3');
  title.textContent = narrative.title;
  const summary = document.createElement('p');
  summary.textContent = narrative.summary;
  const engine = document.createElement('p');
  engine.className = 'muted';
  engine.textContent = engineLabel;
  elements.resultSummary.append(title, summary, engine);

  elements.seriesSelect.replaceChildren(...results.map((series, index) => option(String(index), series.seriesId, index === 0)));
  elements.resultTableBody.replaceChildren(...rows.slice(0, 200).map((item) => {
    const row = document.createElement('tr');
    for (const value of [item.series, item.timestamp, item.point, item.q10, item.q90]) {
      const cell = document.createElement('td');
      cell.textContent = typeof value === 'number' ? value.toFixed(4) : String(value);
      row.appendChild(cell);
    }
    return row;
  }));
  drawForecastChart(elements.forecastCanvas, results[0]);
  elements.exportCsv.disabled = false;
  elements.exportJson.disabled = false;
}

function prepareData() {
  syncSchemaFromForm();
  state.normalized = normalizeTable(state.table, state.schema);
  state.validation = validateForecastInput(state.table, state.schema, state.normalized);
  renderValidation(state.validation);
  if (!state.validation.ok) throw new Error(state.validation.errors.join(' '));
  return state.normalized;
}

async function runBaseline() {
  try {
    status(elements.engineStatus, 'Running deterministic baseline and rolling holdout test...', 'working');
    const normalized = prepareData();
    const aligned = alignSeries(normalized, 'target');
    const results = forecastAlignedSeries(aligned, { horizon: state.schema.horizon, seasonality: state.schema.seasonality });
    const lastTimestamp = aligned.timestamps.at(-1);
    const rows = buildForecastRows(results, lastTimestamp, normalized.frequency.milliseconds);
    const narrative = resultNarrative(results, state.validation, 'Seasonal-naive');
    renderResults(results, rows, narrative, 'Deterministic local baseline. This is the threshold TimesFM-3 must beat.');
    status(elements.engineStatus, `Completed ${results.length} series without a server.`, 'ok');
  } catch (error) {
    status(elements.engineStatus, error.message, 'error');
  }
}

async function initShell() {
  if (!state.profile || !state.table) throw new Error('Load data first.');
  await state.shell.init({
    '/workspace/profile.json': JSON.stringify(state.profile, null, 2),
    '/workspace/sample.csv': rowsToSmallCsv(state.table.rows, state.table.columns)
  });
}

async function inspectWithShell(commands = null) {
  await initShell();
  const selected = commands?.length ? commands : ["jq '.columns[] | {name, numericRatio, dateRatio, unique}' profile.json | head -80", 'head -12 sample.csv'];
  const evidence = [];
  elements.shellLog.textContent = '';
  for (const command of selected.slice(0, 3)) {
    const result = await state.shell.exec(command);
    const record = { command, stdout: result.stdout.slice(0, 8_000), stderr: result.stderr, exitCode: result.exitCode };
    evidence.push(record);
    elements.shellLog.textContent += `$ ${command}\n${record.stdout}${record.stderr ? `\n[stderr] ${record.stderr}` : ''}\n`;
  }
  return evidence;
}

async function runPlanner() {
  try {
    syncSchemaFromForm();
    if (state.timesfm.session) {
      status(elements.plannerStatus, 'Unloading TimesFM-3 before loading the planner to cap peak memory...', 'working');
      await state.timesfm.unload();
      elements.runTimesfm.disabled = true;
      status(elements.timesfmStatus, 'TimesFM-3 was unloaded to free GPU memory. Reload the artifact before the next TimesFM run.');
    }
    status(elements.plannerStatus, 'Loading the local 0.6B planner. First use downloads and caches the model...', 'working');
    if (!state.planner) state.planner = new LocalSchemaPlanner({ onProgress: (event) => status(elements.plannerStatus, event.status ?? event.file ?? 'Loading local model...', 'working') });
    let proposal = await state.planner.propose(state.profile, state.schema, elements.plannerGoal.value);
    let evidence = [];
    if (proposal.shellCommands.length) {
      status(elements.plannerStatus, 'Planner requested bounded local inspection tools...', 'working');
      evidence = await inspectWithShell(proposal.shellCommands);
      proposal = await state.planner.propose(state.profile, proposal.schema, elements.plannerGoal.value, evidence);
    }
    state.schema = proposal.schema;
    renderSchemaForm();
    const details = [proposal.reasoningSummary, ...proposal.ambiguities].filter(Boolean).join(' ');
    status(elements.plannerStatus, details || 'Planner returned a valid schema proposal.', 'ok');
  } catch (error) {
    status(elements.plannerStatus, error.message, 'error');
  }
}

async function loadTimesFm() {
  try {
    if (!elements.timesfmLicense.checked) throw new Error('Confirm that you obtained and may use the TimesFM-3 artifact under its license.');
    const files = [...elements.timesfmFiles.files];
    const manifestFile = files.find((file) => file.name.endsWith('.json'));
    if (!manifestFile) throw new Error('Select the generated manifest JSON, ONNX graph, and external-data files together.');
    const manifest = await readTimesFmManifest(manifestFile);
    status(elements.timesfmStatus, 'Loading local TimesFM-3 artifact...', 'working');
    if (state.planner) {
      await state.planner.unload();
      state.planner = null;
      status(elements.plannerStatus, 'Planner unloaded to free GPU memory before TimesFM-3 inference.');
    }
    const loaded = await state.timesfm.load({ manifest, files, onProgress: (event) => status(elements.timesfmStatus, event.message, 'working') });
    state.timesfmManifest = manifest;
    state.timesfmFiles = files;
    elements.modelManifest.textContent = JSON.stringify(manifest, null, 2);
    elements.runTimesfm.disabled = false;
    status(elements.timesfmStatus, `TimesFM-3 loaded through ${loaded.backend}. No uploaded data left this browser.`, 'ok');
  } catch (error) {
    status(elements.timesfmStatus, error.message, 'error');
  }
}

async function runTimesFm() {
  try {
    status(elements.timesfmStatus, 'Preparing fixed-shape tensors and running TimesFM-3...', 'working');
    const normalized = prepareData();
    const request = buildTimesFmRequestFromNormalized(normalized, state.timesfmManifest, state.schema.horizon);
    const output = await state.timesfm.forecast(request);
    const aligned = alignSeries(normalized, 'target');
    const histories = new Map(aligned.series.map((series) => [series.seriesId, series.values]));
    const results = output.results.map((series) => ({
      ...series,
      history: histories.get(series.seriesId) ?? [],
      backtest: { metrics: { wape: null, mase: null, pinballMedian: null, intervalCoverage10to90: null } }
    }));
    const rows = buildForecastRows(results, request.lastTimestamp, request.stepMs);
    const narrative = resultNarrative(results, state.validation, 'TimesFM-3');
    narrative.summary = `TimesFM-3 produced ${rows.length.toLocaleString()} forecast rows in ${output.latencyMs.toFixed(0)} ms. Run the parity and rolling backtest harness before treating this artifact as validated.`;
    renderResults(results, rows, narrative, output.engine);
    status(elements.timesfmStatus, `Inference completed in ${output.latencyMs.toFixed(0)} ms.`, 'ok');
  } catch (error) {
    status(elements.timesfmStatus, error.message, 'error');
  }
}

async function initCapabilities() {
  try {
    const capabilities = await probeCapabilities();
    const storage = capabilities.storage ? `${humanBytes(capabilities.storage.usage)} used of ${humanBytes(capabilities.storage.quota)}` : 'storage estimate unavailable';
    elements.capabilitySummary.textContent = `${capabilities.browser}. WebGPU ${capabilities.webgpuAdapter ? 'available' : 'unavailable'}. WASM ${capabilities.wasm ? 'available' : 'unavailable'}. ${storage}. Recommended mode: ${capabilities.recommendation}.`;
  } catch (error) {
    elements.capabilitySummary.textContent = `Capability probe failed: ${error.message}`;
  }
}

for (const element of [elements.modeSelect, elements.timestampSelect, elements.entitySelect, elements.targetSelect, elements.pastSelect, elements.futureSelect, elements.horizonInput, elements.seasonalityInput]) {
  element.addEventListener('change', syncSchemaFromForm);
}
elements.fileInput.addEventListener('change', () => elements.fileInput.files[0] && ingestFile(elements.fileInput.files[0]).catch((error) => status(elements.dataStatus, error.message, 'error')));
elements.tableSelect.addEventListener('change', () => selectTable(Number(elements.tableSelect.value)));
elements.loadSample.addEventListener('click', () => loadSample().catch((error) => status(elements.dataStatus, error.message, 'error')));
elements.runBaseline.addEventListener('click', runBaseline);
elements.runPlanner.addEventListener('click', runPlanner);
elements.inspectShell.addEventListener('click', () => inspectWithShell().catch((error) => status(elements.plannerStatus, error.message, 'error')));
elements.loadTimesfm.addEventListener('click', loadTimesFm);
elements.runTimesfm.addEventListener('click', runTimesFm);
elements.seriesSelect.addEventListener('change', () => drawForecastChart(elements.forecastCanvas, state.results?.[Number(elements.seriesSelect.value)]));
elements.exportCsv.addEventListener('click', () => downloadText('forecast.csv', rowsToCsv(state.resultRows), 'text/csv'));
elements.exportJson.addEventListener('click', () => downloadText('forecast.json', JSON.stringify({ schema: state.schema, validation: state.validation, results: state.results }, null, 2), 'application/json'));

elements.dropZone.addEventListener('dragover', (event) => { event.preventDefault(); elements.dropZone.classList.add('dragging'); });
elements.dropZone.addEventListener('dragleave', () => elements.dropZone.classList.remove('dragging'));
elements.dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  elements.dropZone.classList.remove('dragging');
  const file = event.dataTransfer.files[0];
  if (file) ingestFile(file).catch((error) => status(elements.dataStatus, error.message, 'error'));
});

window.addEventListener('resize', () => drawForecastChart(elements.forecastCanvas, state.results?.[Number(elements.seriesSelect.value || 0)]));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
initCapabilities();
loadSample().catch((error) => status(elements.dataStatus, error.message, 'error'));
