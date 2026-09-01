import { mkdir, writeFile } from 'node:fs/promises';

const PARAMS = 330_000_000;
const GIB = 1024 ** 3;
const QWEN_ARTIFACT = 570_000_000;
const variants = [
  ['TimesFM-3 FP32', PARAMS * 4],
  ['TimesFM-3 FP16', PARAMS * 2],
  ['TimesFM-3 INT8 weights only', PARAMS],
  ['TimesFM-3 INT4 weights only', PARAMS / 2],
  ['Qwen3-0.6B q4f16 browser artifact', QWEN_ARTIFACT]
];

const line = (name, bytes) => ({ name, bytes: Math.round(bytes), gib: bytes / GIB });
const rows = variants.map(([name, bytes]) => line(name, bytes));
const timesFmInt4 = PARAMS / 2;
const simultaneousWeightFloor = timesFmInt4 + QWEN_ARTIFACT;
const serializedWeightFloor = Math.max(timesFmInt4, QWEN_ARTIFACT);
const sensitivityMultiplier = 1.55;

const report = {
  assumptions: {
    timesFmParameters: PARAMS,
    qwenArtifactBytes: QWEN_ARTIFACT,
    sensitivityMultiplier,
    note: 'Weight and artifact bytes are lower bounds. The 1.55 multiplier is a planning sensitivity, not a measured browser peak.'
  },
  variants: rows,
  simultaneousWeightFloor: line('simultaneous', simultaneousWeightFloor),
  serializedWeightFloor: line('serialized', serializedWeightFloor),
  simultaneousSensitivityAt1_55x: line('simultaneous-sensitivity', simultaneousWeightFloor * sensitivityMultiplier),
  serializedSensitivityAt1_55x: line('serialized-sensitivity', serializedWeightFloor * sensitivityMultiplier),
  recommendation: 'Load the planner, produce a schema, unload it, then load TimesFM-3. Do not keep both models resident by default.'
};
await mkdir(new URL('../evidence/', import.meta.url), { recursive: true });
await writeFile(new URL('../evidence/memory-budget.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
