export function workerRequest(worker, data) {
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data: result }) => {
      worker.terminate();
      if (result.error) reject(new Error(result.error));
      else resolve(result);
    };
    const fail = event => {
      worker.terminate();
      reject(new Error(event.message || 'The background worker could not finish.'));
    };
    worker.onerror = fail;
    worker.onmessageerror = fail;
    try {
      worker.postMessage(data);
    } catch (error) {
      worker.terminate();
      reject(error);
    }
  });
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
