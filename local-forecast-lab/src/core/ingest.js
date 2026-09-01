import { parseDelimited } from './delimited.js';
import { uniqueNames } from './value.js';

export const INGEST_LIMITS = Object.freeze({
  maxInputBytes: 64 * 1024 * 1024,
  maxRows: 250_000,
  maxColumns: 2_048,
  maxCells: 5_000_000
});

function utf8Bytes(text) {
  return new TextEncoder().encode(text).byteLength;
}

function enforceTableBounds(tables) {
  let rows = 0;
  let cells = 0;
  for (const table of tables) {
    if (table.columns.length > INGEST_LIMITS.maxColumns) {
      throw new Error(`Table '${table.name}' has ${table.columns.length.toLocaleString()} columns. The local limit is ${INGEST_LIMITS.maxColumns.toLocaleString()}.`);
    }
    rows += table.rows.length;
    cells += table.rows.length * table.columns.length;
    if (rows > INGEST_LIMITS.maxRows) throw new Error(`Parsed row count exceeds the local limit of ${INGEST_LIMITS.maxRows.toLocaleString()}. Aggregate or split the input.`);
    if (cells > INGEST_LIMITS.maxCells) throw new Error(`Parsed cell count exceeds the local limit of ${INGEST_LIMITS.maxCells.toLocaleString()}. Aggregate or split the input.`);
  }
  return tables;
}

function rowsFromArray(values, name = 'data') {
  if (!values.length) return { name, columns: [], rows: [] };
  if (values.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
    const columns = uniqueNames([...new Set(values.flatMap((item) => Object.keys(item)))]);
    const sourceKeys = [...new Set(values.flatMap((item) => Object.keys(item)))];
    const keyMap = new Map(sourceKeys.map((key, index) => [key, columns[index]]));
    const rows = values.map((item) => Object.fromEntries(sourceKeys.map((key) => [keyMap.get(key), item[key] ?? null])));
    return { name, columns, rows };
  }
  if (values.every(Array.isArray)) {
    const width = Math.max(...values.map((row) => row.length));
    const header = uniqueNames(Array.from({ length: width }, (_, index) => values[0][index] || `column_${index + 1}`));
    const rows = values.slice(1).map((row) => Object.fromEntries(header.map((column, index) => [column, row[index] ?? null])));
    return { name, columns: header, rows };
  }
  return { name, columns: ['value'], rows: values.map((value) => ({ value })) };
}

export function parseJsonText(text) {
  if (utf8Bytes(text) > INGEST_LIMITS.maxInputBytes) throw new Error(`Text input exceeds ${INGEST_LIMITS.maxInputBytes / 1024 / 1024} MiB.`);
  const value = JSON.parse(text);
  if (Array.isArray(value)) return enforceTableBounds([rowsFromArray(value)]);
  if (!value || typeof value !== 'object') return enforceTableBounds([{ name: 'data', columns: ['value'], rows: [{ value }] }]);

  const arrays = Object.entries(value).filter(([, candidate]) => Array.isArray(candidate));
  if (arrays.length) return enforceTableBounds(arrays.map(([name, candidate]) => rowsFromArray(candidate, name)));
  return enforceTableBounds([rowsFromArray([value])]);
}

export function parseTextInput(text, filename = 'data.txt') {
  if (utf8Bytes(text) > INGEST_LIMITS.maxInputBytes) throw new Error(`Text input exceeds ${INGEST_LIMITS.maxInputBytes / 1024 / 1024} MiB.`);
  const trimmed = text.trim();
  const lower = filename.toLowerCase();
  if (lower.endsWith('.json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return parseJsonText(trimmed);
    } catch (error) {
      if (lower.endsWith('.json') || !(error instanceof SyntaxError)) throw new Error(`JSON input was rejected: ${error.message}`);
    }
  }
  const parsed = parseDelimited(text);
  return enforceTableBounds([{ name: filename.replace(/\.[^.]+$/, '') || 'data', ...parsed }]);
}

async function loadSheetJs() {
  const candidates = ['/vendor/xlsx.mjs', 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs'];
  let lastError;
  for (const url of candidates) {
    try {
      return await import(/* @vite-ignore */ url);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`SheetJS could not be loaded. Vendor xlsx.mjs at /public/vendor/xlsx.mjs for strict offline use. ${lastError?.message ?? ''}`);
}

export async function parseWorkbookBuffer(buffer, filename = 'workbook.xlsx') {
  if (buffer.byteLength > INGEST_LIMITS.maxInputBytes) throw new Error(`Workbook exceeds ${INGEST_LIMITS.maxInputBytes / 1024 / 1024} MiB.`);
  const XLSX = await loadSheetJs();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, dense: true });
  let declaredCells = 0;
  const tables = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    if (sheet?.['!ref']) {
      const range = XLSX.utils.decode_range(sheet['!ref']);
      const rowCount = range.e.r - range.s.r + 1;
      const columnCount = range.e.c - range.s.c + 1;
      declaredCells += rowCount * columnCount;
      if (rowCount > INGEST_LIMITS.maxRows || columnCount > INGEST_LIMITS.maxColumns || declaredCells > INGEST_LIMITS.maxCells) {
        throw new Error(`Workbook sheet '${name}' declares ${rowCount.toLocaleString()} rows and ${columnCount.toLocaleString()} columns, beyond the local safety limits.`);
      }
    }
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: false });
    return rowsFromArray(rawRows, name);
  }).filter((table) => table.columns.length && table.rows.length);
  return enforceTableBounds(tables);
}

export async function ingestFile(file) {
  if (file.size > INGEST_LIMITS.maxInputBytes) throw new Error(`File exceeds ${INGEST_LIMITS.maxInputBytes / 1024 / 1024} MiB.`);
  const lower = file.name.toLowerCase();
  const spreadsheet = /\.(xlsx|xls|xlsb|ods|fods|numbers)$/i.test(lower);
  if (spreadsheet) return parseWorkbookBuffer(await file.arrayBuffer(), file.name);
  return parseTextInput(await file.text(), file.name);
}
