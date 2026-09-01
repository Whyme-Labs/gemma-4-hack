export class IngestWorkerClient {
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.worker = null;
    this.sequence = 0;
    this.pending = new Map();
  }

  start() {
    if (this.worker) return;
    this.worker = new Worker(new URL('./ingest-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event) => {
      const { id, ok, tables, error } = event.data;
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      if (ok) pending.resolve(tables);
      else pending.reject(new Error(error));
    };
    this.worker.onerror = (error) => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
      this.close();
    };
  }

  call(type, payload) {
    this.start();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.close();
        reject(new Error(`Local parsing exceeded ${this.timeoutMs / 1_000} seconds and its worker was terminated.`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, type, payload });
    });
  }

  file(file) { return this.call('file', { file }); }
  text(text, filename) { return this.call('text', { text, filename }); }

  close() {
    this.worker?.terminate();
    this.worker = null;
  }
}
