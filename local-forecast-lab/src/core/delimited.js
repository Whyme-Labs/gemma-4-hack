import { uniqueNames } from './value.js';

const CANDIDATES = [',', '\t', ';', '|'];

function countFields(line, delimiter) {
  let count = 1;
  let quote = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quote && line[index + 1] === '"') index += 1;
      else quote = !quote;
    } else if (!quote && char === delimiter) count += 1;
  }
  return count;
}

export function detectDelimiter(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim()).slice(0, 25);
  if (!lines.length) return ',';
  let best = { delimiter: ',', score: -Infinity };
  for (const delimiter of CANDIDATES) {
    const counts = lines.map((line) => countFields(line, delimiter));
    const useful = counts.filter((count) => count > 1);
    const modeMap = new Map();
    for (const count of useful) modeMap.set(count, (modeMap.get(count) ?? 0) + 1);
    const [mode, frequency] = [...modeMap.entries()].sort((a, b) => b[1] - a[1])[0] ?? [1, 0];
    const score = frequency * 10 + mode - (counts.length - frequency) * 2;
    if (score > best.score) best = { delimiter, score };
  }
  return best.delimiter;
}

export function parseDelimited(text, options = {}) {
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const maxRows = options.maxRows ?? 250_000;
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
    row = [];
    if (rows.length > maxRows + 1) throw new Error(`File has more than ${maxRows.toLocaleString()} data rows.`);
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === '') quoted = true;
    else if (char === delimiter) pushField();
    else if (char === '\n') pushRow();
    else if (char !== '\r') field += char;
  }
  if (field.length || row.length) pushRow();
  if (!rows.length) return { columns: [], rows: [], delimiter };

  const width = Math.max(...rows.map((cells) => cells.length));
  const header = uniqueNames(Array.from({ length: width }, (_, index) => rows[0][index] || `column_${index + 1}`));
  const objects = rows.slice(1).map((cells) => Object.fromEntries(header.map((column, index) => [column, cells[index] ?? null])));
  return { columns: header, rows: objects, delimiter };
}
