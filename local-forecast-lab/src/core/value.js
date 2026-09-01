const ISO_DATE_RE = /^\d{4}-\d{1,2}-\d{1,2}(?:[T\s].*)?$/;
const YMD_COMPACT_RE = /^\d{4}[\/-]\d{1,2}[\/-]\d{1,2}$/;
const DMY_RE = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})(?:[\sT].*)?$/;
const MONTH_RE = /^\d{4}[\/-]\d{1,2}$/;

export function isBlank(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

export function parseFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
  }
  if (typeof value !== 'string') return null;
  let text = value.trim();
  if (!text) return null;

  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  const percent = text.endsWith('%');
  text = text
    .replace(/[\s,_]/g, '')
    .replace(/^[^\d+\-.]+/, '')
    .replace(/[^\d.eE+\-]+$/, '');
  if (!text || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null;
  let number = Number(text);
  if (!Number.isFinite(number)) return null;
  if (negative) number = -Math.abs(number);
  if (percent) number /= 100;
  return number;
}

export function parseDateValue(value, options = {}) {
  const { dayFirst = true, allowMonth = true } = options;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime();
  if (typeof value === 'number') {
    // Excel serial dates. Reject ordinary small and epoch-like numeric IDs by default.
    if (value >= 20_000 && value <= 100_000) {
      return Math.round((value - 25_569) * 86_400_000);
    }
    return null;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;

  if (ISO_DATE_RE.test(text) || YMD_COMPACT_RE.test(text)) {
    const timestamp = Date.parse(text);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  if (allowMonth && MONTH_RE.test(text)) {
    const [year, month] = text.split(/[\/-]/).map(Number);
    if (month >= 1 && month <= 12) return Date.UTC(year, month - 1, 1);
  }

  const dmy = text.match(DMY_RE);
  if (dmy) {
    let first = Number(dmy[1]);
    let second = Number(dmy[2]);
    let year = Number(dmy[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    let day;
    let month;
    if (first > 12) {
      day = first;
      month = second;
    } else if (second > 12) {
      day = second;
      month = first;
    } else if (dayFirst) {
      day = first;
      month = second;
    } else {
      day = second;
      month = first;
    }
    const date = Date.UTC(year, month - 1, day);
    const check = new Date(date);
    if (check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day) {
      return date;
    }
  }

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) && /[A-Za-z]/.test(text) ? parsed : null;
}

export function normalizeName(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\p{L}]+/gu, '_')
    .replace(/^_+|_+$/g, '') || 'column';
}

export function uniqueNames(names) {
  const counts = new Map();
  return names.map((name, index) => {
    const base = normalizeName(name || `column_${index + 1}`);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

export function quantile(sortedValues, probability) {
  if (!sortedValues.length) return null;
  const p = Math.min(1, Math.max(0, probability));
  const index = (sortedValues.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

export function median(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  return quantile(sorted, 0.5);
}

export function mad(values, center = median(values)) {
  if (center === null) return null;
  return median(values.filter(Number.isFinite).map((value) => Math.abs(value - center)));
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}
