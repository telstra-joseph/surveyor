import { parseWorkbook } from './survey.js';

self.onmessage = async ({ data: file }) => {
  try {
    self.postMessage({ survey: await parseWorkbook(await file.arrayBuffer(), file.name) });
  } catch (error) {
    self.postMessage({ error: error.message || 'The workbook could not be read.' });
  }
};
