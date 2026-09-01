import { mad, median } from './value.js';

const UNITS = [
  { name: 'minute', milliseconds: 60_000, tolerance: 0.2 },
  { name: '5-minute', milliseconds: 300_000, tolerance: 0.2 },
  { name: '15-minute', milliseconds: 900_000, tolerance: 0.2 },
  { name: '30-minute', milliseconds: 1_800_000, tolerance: 0.2 },
  { name: 'hourly', milliseconds: 3_600_000, tolerance: 0.2 },
  { name: 'daily', milliseconds: 86_400_000, tolerance: 0.2 },
  { name: 'weekly', milliseconds: 604_800_000, tolerance: 0.25 },
  { name: 'monthly', milliseconds: 2_629_746_000, tolerance: 0.2 },
  { name: 'quarterly', milliseconds: 7_889_238_000, tolerance: 0.2 },
  { name: 'yearly', milliseconds: 31_556_952_000, tolerance: 0.2 }
];

export function describeFrequency(milliseconds) {
  const match = UNITS
    .map((unit) => ({ ...unit, relative: Math.abs(milliseconds - unit.milliseconds) / unit.milliseconds }))
    .sort((a, b) => a.relative - b.relative)[0];
  if (match && match.relative <= match.tolerance) return match.name;
  if (milliseconds < 60_000) return `${Math.round(milliseconds / 1_000)}-second`;
  if (milliseconds < 3_600_000) return `${Math.round(milliseconds / 60_000)}-minute`;
  if (milliseconds < 86_400_000) return `${Math.round(milliseconds / 3_600_000)}-hour`;
  return `${Math.round(milliseconds / 86_400_000)}-day`;
}

export function inferFrequency(timestamps) {
  const sorted = [...new Set(timestamps.filter(Number.isFinite))].sort((a, b) => a - b);
  const deltas = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const delta = sorted[index] - sorted[index - 1];
    if (delta > 0) deltas.push(delta);
  }
  const step = median(deltas);
  if (!step) return { milliseconds: null, label: 'unknown', regularity: 0, deltaMad: null, observations: sorted.length };
  const deltaMad = mad(deltas, step) ?? 0;
  const regularity = Math.max(0, Math.min(1, 1 - deltaMad / Math.max(step, 1)));
  const nearStep = deltas.filter((delta) => Math.abs(delta - step) / step <= 0.1).length / Math.max(1, deltas.length);
  return {
    milliseconds: step,
    label: describeFrequency(step),
    regularity: Number(Math.min(regularity, nearStep).toFixed(4)),
    deltaMad,
    observations: sorted.length
  };
}

export function defaultSeasonality(label) {
  if (label === 'minute') return 60;
  if (label === '5-minute') return 12;
  if (label === '15-minute') return 4;
  if (label === '30-minute') return 48;
  if (label === 'hourly') return 24;
  if (label === 'daily') return 7;
  if (label === 'weekly') return 52;
  if (label === 'monthly') return 12;
  if (label === 'quarterly') return 4;
  return 1;
}

export function defaultHorizon(label) {
  if (label === 'minute' || label.endsWith('-minute')) return 60;
  if (label === 'hourly' || label.endsWith('-hour')) return 24;
  if (label === 'daily' || label.endsWith('-day')) return 14;
  if (label === 'weekly') return 12;
  if (label === 'monthly') return 12;
  if (label === 'quarterly') return 8;
  return 10;
}
