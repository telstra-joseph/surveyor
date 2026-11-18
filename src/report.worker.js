import { makeReport } from './report.js';

self.onmessage = async ({ data }) => {
  try {
    const buffer = await makeReport(data);
    self.postMessage({ buffer }, [buffer]);
  } catch (error) {
    self.postMessage({ error: error.message || 'The PowerPoint report could not be generated.' });
  }
};
