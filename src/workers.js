export function workerRequest(worker, data, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data: result }) => {
      if (result.progress) {
        onProgress?.(result.progress);
        return;
      }
      cleanup();
      if (result.error) reject(new Error(result.error));
      else resolve(result);
    };
    const fail = event => {
      cleanup();
      reject(new Error(event.message || 'The background worker could not finish.'));
    };
    worker.onerror = fail;
    worker.onmessageerror = fail;
    try {
      worker.postMessage(data);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

export function orderWorkbookBatch(surveys) {
  const readUE = name => /(?:^|[^a-z0-9])UE[\s_-]*(\d+)(?![a-z0-9])/i.exec(name)?.[1];
  return surveys.map(survey => ({
    survey, ue: Number(readUE(survey.profile) ?? readUE(survey.filename) ?? Infinity),
  })).sort((a, b) => a.ue - b.ue).map(({ survey }) => survey);
}

export async function importFiles(files, onProgress) {
  const results = [];
  const concurrency = Math.min(files.length, Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)));
  let next = 0;
  let finished = 0;
  async function lane() {
    while (next < files.length) {
      const index = next++;
      const file = files[index];
      try {
        if (!/\.xlsx$/i.test(file.name)) throw new Error('Select an .xlsx workbook.');
        results[index] = await workerRequest(new Worker(new URL('./parse.worker.js', import.meta.url), { type: 'module' }), file);
      } catch (error) {
        results[index] = { filename: file.name, error: error.message };
      }
      onProgress(++finished);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, lane));
  return results;
}
