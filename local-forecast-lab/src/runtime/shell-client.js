export class LocalShell {
  constructor() {
    this.worker = null;
    this.sequence = 0;
    this.pending = new Map();
  }

  start() {
    if (this.worker) return;
    this.worker = new Worker(new URL('./shell-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event) => {
      const { id, ok, result, error } = event.data;
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (ok) pending.resolve(result);
      else pending.reject(new Error(error));
    };
    this.worker.onerror = (error) => {
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      this.stop();
    };
  }

  call(type, payload, timeoutMs = 5_000) {
    this.start();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.stop();
        reject(new Error(`Shell operation exceeded ${timeoutMs} ms and its worker was terminated.`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
      this.worker.postMessage({ id, type, payload });
    });
  }

  init(files) {
    return this.call('init', { files });
  }

  exec(command) {
    return this.call('exec', { command });
  }

  stop() {
    this.worker?.terminate();
    this.worker = null;
  }
}
