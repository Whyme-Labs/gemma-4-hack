import { Bash } from 'just-bash/browser';
import { validateShellCommand } from './shell-policy.js';

let bash = null;

self.onmessage = async (event) => {
  const { id, type, payload } = event.data ?? {};
  try {
    if (type === 'init') {
      const files = Object.fromEntries(Object.entries(payload.files ?? {}).map(([path, content]) => [path, String(content).slice(0, 8 * 1024 * 1024)]));
      bash = new Bash({
        files,
        cwd: '/workspace',
        executionLimitProfile: 'hardened',
        executionLimits: {
          maxExecutionTimeMs: 3_000,
          maxCommandCount: 200,
          maxLoopIterations: 2_000,
          maxWorkUnits: 20_000,
          maxOutputSize: 1 * 1024 * 1024,
          maxInputBytes: 16 * 1024 * 1024,
          maxFileSystemBytes: 32 * 1024 * 1024,
          maxStringLength: 4 * 1024 * 1024
        }
      });
      self.postMessage({ id, ok: true, result: { initialized: true, files: Object.keys(files) } });
      return;
    }
    if (type === 'exec') {
      if (!bash) throw new Error('Shell worker is not initialized.');
      const command = validateShellCommand(payload.command);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3_250);
      try {
        const result = await bash.exec(command, { signal: controller.signal });
        self.postMessage({ id, ok: true, result: { stdout: result.stdout.slice(0, 1_000_000), stderr: result.stderr.slice(0, 64_000), exitCode: result.exitCode } });
      } finally {
        clearTimeout(timer);
      }
      return;
    }
    throw new Error(`Unknown worker operation '${type}'.`);
  } catch (error) {
    self.postMessage({ id, ok: false, error: error.message });
  }
};
