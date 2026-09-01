import { buildTimesFmForwardInputs, decodeTimesFmLogits, validateTimesFmManifest } from './timesfm3-contract.js';

export class TimesFm3OnnxEngine {
  constructor() {
    this.session = null;
    this.ort = null;
    this.manifest = null;
    this.backend = null;
  }

  async load({ manifest, files, onProgress = () => {} }) {
    validateTimesFmManifest(manifest);
    const byName = new Map([...files].map((file) => [file.name, file]));
    const graph = byName.get(manifest.graphFile);
    if (!graph) throw new Error(`Select the ONNX graph file '${manifest.graphFile}'.`);
    onProgress({ stage: 'runtime', message: 'Loading ONNX Runtime Web' });
    const ort = await import('onnxruntime-web/webgpu');
    ort.env.logLevel = 'warning';
    const externalData = (manifest.externalData ?? []).map((item) => {
      const file = byName.get(item.file);
      if (!file) throw new Error(`Select the external weight file '${item.file}'.`);
      return { path: item.path, data: file };
    });
    const graphBytes = new Uint8Array(await graph.arrayBuffer());
    const common = { externalData, graphOptimizationLevel: 'all' };

    let session;
    try {
      onProgress({ stage: 'model', message: 'Creating WebGPU session' });
      session = await ort.InferenceSession.create(graphBytes, {
        ...common,
        executionProviders: ['webgpu'],
        enableGraphCapture: Boolean(manifest.staticShape)
      });
      this.backend = 'webgpu';
    } catch (webGpuError) {
      if (manifest.allowWasmFallback === false) throw webGpuError;
      onProgress({ stage: 'model', message: `WebGPU failed. Trying WASM: ${webGpuError.message}` });
      session = await ort.InferenceSession.create(graphBytes, {
        ...common,
        executionProviders: ['wasm']
      });
      this.backend = 'wasm';
    }
    this.ort = ort;
    this.session = session;
    this.manifest = manifest;
    return { backend: this.backend, inputs: session.inputNames, outputs: session.outputNames };
  }

  async forecast(request) {
    if (!this.session || !this.ort || !this.manifest) throw new Error('Load a TimesFM-3 ONNX artifact first.');
    const prepared = buildTimesFmForwardInputs(request, this.manifest);
    const feeds = Object.fromEntries(Object.entries(prepared.tensors).map(([name, tensor]) => [
      this.manifest.inputs?.[name] ?? name,
      new this.ort.Tensor(tensor.type, tensor.data, tensor.dims)
    ]));
    const started = performance.now();
    const outputs = await this.session.run(feeds);
    const outputName = this.manifest.outputs?.logits ?? 'logits';
    const logits = outputs[outputName];
    if (!logits) throw new Error(`Model output '${outputName}' was not returned. Available outputs: ${Object.keys(outputs).join(', ')}.`);
    const results = decodeTimesFmLogits(logits, prepared, this.manifest);
    return { engine: `TimesFM-3 ONNX ${this.backend}`, latencyMs: performance.now() - started, results };
  }

  async unload() {
    if (this.session) await this.session.release();
    this.session = null;
    this.ort = null;
    this.manifest = null;
    this.backend = null;
  }
}

export async function readTimesFmManifest(file) {
  return validateTimesFmManifest(JSON.parse(await file.text()));
}
