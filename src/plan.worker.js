import { createPlan, parseMrk, parseTab } from './indoor.js';

const maxSide = 4096;
const maxPng = 4 * 1024 * 1024;

// Read dimensions from the header so huge BMPs can be decoded straight to a smaller bitmap.
async function headerSize(file) {
  const view = new DataView(await file.slice(0, 32).arrayBuffer());
  if (view.byteLength >= 26 && view.getUint16(0) === 0x424d) {
    return { width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)) };
  }
  if (view.byteLength >= 24 && view.getUint32(0) === 0x89504e47) return { width: view.getUint32(16), height: view.getUint32(20) };
  return null;
}

async function encode(file) {
  let size = await headerSize(file);
  let bitmap;
  if (size?.width && size?.height) {
    const scale = Math.min(1, maxSide / Math.max(size.width, size.height));
    bitmap = await createImageBitmap(file, scale < 1
      ? { resizeWidth: Math.round(size.width * scale), resizeHeight: Math.round(size.height * scale), resizeQuality: 'high' } : {});
  } else {
    bitmap = await createImageBitmap(file);
    size = { width: bitmap.width, height: bitmap.height };
    const scale = Math.min(1, maxSide / Math.max(size.width, size.height));
    if (scale < 1) {
      const resized = await createImageBitmap(bitmap, { resizeWidth: Math.round(size.width * scale),
        resizeHeight: Math.round(size.height * scale), resizeQuality: 'high' });
      bitmap.close();
      bitmap = resized;
    }
  }
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  const output = { imageWidth: bitmap.width, imageHeight: bitmap.height, ...size };
  bitmap.close();
  let blob = await canvas.convertToBlob({ type: 'image/png' });
  if (blob.size > maxPng) blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: .9 });
  return { ...output, image: new FileReaderSync().readAsDataURL(blob) };
}

self.onmessage = async ({ data: { id, tab, image, mrk } }) => {
  try {
    const parsedTab = parseTab(await tab.text());
    const parsedMrk = mrk ? parseMrk(await mrk.text()) : null;
    let encoded;
    try {
      encoded = await encode(image);
    } catch {
      throw new Error(`${image.name} could not be decoded as an image.`);
    }
    self.postMessage({ plan: createPlan({ id, tab: parsedTab, mrk: parsedMrk, ...encoded }) });
  } catch (error) {
    self.postMessage({ error: error.message || 'The floor plan could not be read.' });
  }
};
