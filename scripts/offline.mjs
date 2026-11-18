import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const out = resolve('dist');
const files = (await readdir(out, { recursive: true, withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name !== 'sw.js')
  .map(entry => resolve(entry.parentPath, entry.name).slice(out.length + 1).replaceAll('\\', '/'))
  .sort();
const hash = createHash('sha256');
for (const file of files) hash.update(file).update(await readFile(resolve(out, file)));

await writeFile(resolve(out, 'sw.js'), `
const prefix = 'surveyor:' + self.registration.scope + ':';
const cacheName = prefix + '${hash.digest('hex').slice(0, 16)}';
const assets = ${JSON.stringify(files.map(file => `./${file}`))};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assets)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith(prefix) && key !== cacheName).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});
const urls = new Set(assets.map(asset => new URL(asset, self.registration.scope).href));
const index = new URL('./index.html', self.registration.scope).href;
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = request.mode === 'navigate' ? index : request.url;
  if (!urls.has(url)) return;
  // The allowlist contains static files, regardless of the request's Origin header.
  event.respondWith(caches.open(cacheName).then(async cache =>
    (await cache.match(url, { ignoreVary: true })) || fetch(request)));
});
`);
