function withTimeout(promise, milliseconds, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds} ms`)), milliseconds); })
  ]).finally(() => clearTimeout(timer));
}

function browserFamily() {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua) && !/CriOS\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
  return 'Unknown';
}

export async function probeCapabilities() {
  const result = {
    browser: browserFamily(),
    secureContext: window.isSecureContext,
    webgpu: Boolean(navigator.gpu),
    webgpuAdapter: null,
    webgpuLimits: null,
    wasm: typeof WebAssembly === 'object',
    workers: typeof Worker === 'function',
    opfs: Boolean(navigator.storage?.getDirectory),
    storage: null,
    crossOriginIsolated: window.crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemoryGiB: navigator.deviceMemory ?? null,
    recommendation: 'baseline-only'
  };

  if (navigator.storage?.estimate) {
    const estimate = await navigator.storage.estimate();
    result.storage = { quota: estimate.quota ?? null, usage: estimate.usage ?? null };
  }
  if (navigator.gpu) {
    try {
      const adapter = await withTimeout(navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }), 2_000, 'WebGPU adapter request');
      if (adapter) {
        result.webgpuAdapter = adapter.info ? { ...adapter.info } : { available: true };
        result.webgpuLimits = {
          maxBufferSize: adapter.limits.maxBufferSize,
          maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
          maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize
        };
      }
    } catch (error) {
      result.webgpuAdapter = { error: error.message };
    }
  }

  if (result.webgpu && result.webgpuAdapter && ['Chrome', 'Edge'].includes(result.browser)) {
    result.recommendation = result.deviceMemoryGiB && result.deviceMemoryGiB < 8 ? 'llm-or-timesfm-one-at-a-time' : 'full-serialized';
  } else if (result.wasm) {
    result.recommendation = 'baseline-and-small-llm-wasm';
  }
  return result;
}

export function humanBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index < 2 ? 0 : 1)} ${units[index]}`;
}
