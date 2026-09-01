import { plannerDigest } from '../core/profile.js';
import { applyPlannerPatch } from '../core/schema.js';
import { extractFirstJsonObject } from './json.js';

function withTimeout(promise, milliseconds) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => { timer = setTimeout(() => resolve(null), milliseconds); })
  ]).finally(() => clearTimeout(timer));
}

const SYSTEM = `You are a constrained time-series schema planner. You never calculate forecasts. You inspect a compact table profile and propose a schema patch.
Return one JSON object only. Do not use Markdown.
Allowed keys:
{
  "mode": "wide" | "long",
  "timestampColumn": string,
  "entityColumns": string[],
  "targetColumns": string[],
  "pastCovariateColumns": string[],
  "futureCovariateColumns": string[],
  "horizon": integer 1..1024,
  "seasonality": positive integer,
  "reasoningSummary": string,
  "ambiguities": string[],
  "shellCommands": string[]
}
Use only exact column names from the profile. shellCommands are optional read-only inspection commands over /workspace/profile.json and /workspace/sample.csv. Use at most 3 commands. Do not request network, Python, JavaScript, SQLite, redirection, command substitution, or file deletion. If the data cannot support forecasting, leave targetColumns empty and explain why in ambiguities.`;

function generatedText(output) {
  const first = Array.isArray(output) ? output[0] : output;
  const value = first?.generated_text ?? first?.text ?? first;
  if (Array.isArray(value)) {
    const assistant = [...value].reverse().find((message) => message.role === 'assistant');
    return assistant?.content ?? JSON.stringify(value);
  }
  return String(value ?? '');
}

export class LocalSchemaPlanner {
  constructor(options = {}) {
    this.modelId = options.modelId ?? 'onnx-community/Qwen3-0.6B-ONNX';
    this.dtype = options.dtype ?? null;
    this.device = null;
    this.generator = null;
    this.progress = options.onProgress ?? (() => {});
  }

  async load() {
    if (this.generator) return;
    const { pipeline } = await import('@huggingface/transformers');
    const candidates = [];
    if (navigator.gpu) {
      let fp16 = false;
      try {
        const adapter = await withTimeout(navigator.gpu.requestAdapter(), 2_000);
        fp16 = Boolean(adapter?.features?.has('shader-f16'));
      } catch {}
      candidates.push({ device: 'webgpu', dtype: this.dtype ?? (fp16 ? 'q4f16' : 'q4') });
    }
    candidates.push({ device: 'wasm', dtype: this.dtype ?? 'q8' });
    let lastError;
    for (const candidate of candidates) {
      try {
        this.progress({ status: `Loading ${this.modelId} with ${candidate.device}/${candidate.dtype}` });
        this.generator = await pipeline('text-generation', this.modelId, {
          device: candidate.device,
          dtype: candidate.dtype,
          progress_callback: (event) => this.progress(event)
        });
        this.device = candidate;
        return;
      } catch (error) {
        lastError = error;
        this.progress({ status: `${candidate.device}/${candidate.dtype} failed: ${error.message}` });
      }
    }
    throw new Error(`The local planner could not load: ${lastError?.message ?? 'unknown error'}`);
  }

  async propose(profile, currentSchema, userGoal = '', toolEvidence = []) {
    await this.load();
    const payload = {
      goal: userGoal.slice(0, 1_000),
      currentSchema,
      toolEvidence: toolEvidence.slice(0, 3),
      profile: plannerDigest(profile)
    };
    const messages = [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `${JSON.stringify(payload)}\n/no_think` }
    ];
    const output = await this.generator(messages, {
      max_new_tokens: 512,
      do_sample: false,
      temperature: 0,
      return_full_text: false
    });
    const raw = generatedText(output);
    const proposal = extractFirstJsonObject(raw);
    const schema = applyPlannerPatch(currentSchema, proposal, profile);
    return {
      schema,
      reasoningSummary: String(proposal.reasoningSummary ?? '').slice(0, 1_000),
      ambiguities: Array.isArray(proposal.ambiguities) ? proposal.ambiguities.map(String).slice(0, 10) : [],
      shellCommands: Array.isArray(proposal.shellCommands) ? proposal.shellCommands.map(String).slice(0, 3) : [],
      raw
    };
  }

  async unload() {
    if (this.generator?.dispose) await this.generator.dispose();
    this.generator = null;
    this.device = null;
  }
}
