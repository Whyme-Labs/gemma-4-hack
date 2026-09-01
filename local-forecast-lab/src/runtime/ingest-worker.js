import { ingestFile, parseTextInput } from '../core/ingest.js';

self.onmessage = async (event) => {
  const { id, type, payload } = event.data ?? {};
  try {
    let tables;
    if (type === 'file') tables = await ingestFile(payload.file);
    else if (type === 'text') tables = parseTextInput(payload.text, payload.filename);
    else throw new Error(`Unknown ingest operation '${type}'.`);
    self.postMessage({ id, ok: true, tables });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error.message });
  }
};
