// Service worker: hace que la app (instalada o en el navegador) arranque
// rápido guardando en el equipo SOLO los archivos de la propia app
// (código, estilos, fuentes, iconos). Los datos del taller (Supabase)
// nunca pasan por aquí: siempre se piden a la nube, así no se ven datos viejos.
//
// - Archivos con huella en el nombre (assets/…-HASH.js/css/woff2): se sirven
//   del equipo al instante; al publicar una versión nueva cambian de nombre.
// - La página principal (index.html): se pide siempre a la nube para tener la
//   última versión; si la red tarda o no hay, se usa la copia guardada.
const CACHE = 'sms-app-v1';
const ESPERA_RED_MS = 3000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

const base = new URL('./', self.location).href;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(base)) return; // Supabase y otros: sin tocar
  const url = new URL(req.url);
  if (url.search) return;
  if (req.mode === 'navigate') { e.respondWith(paginaPrincipal(req)); return; }
  const ruta = url.href.slice(base.length);
  if (/^assets\//.test(ruta) || /\.(png|webmanifest)$/.test(ruta) || ruta === 'cp.json') {
    e.respondWith(primeroGuardado(req));
  }
});

async function primeroGuardado(req) {
  const c = await caches.open(CACHE);
  const guardado = await c.match(req);
  if (guardado) return guardado;
  const r = await fetch(req);
  if (r.ok) c.put(req, r.clone());
  return r;
}

async function paginaPrincipal(req) {
  const c = await caches.open(CACHE);
  const red = fetch(req).then((r) => {
    if (r.ok) { c.put(base, r.clone()); limpiarAntiguos(r.clone()); }
    return r;
  });
  red.catch(() => {});
  const tiempo = new Promise((res) => setTimeout(res, ESPERA_RED_MS));
  try {
    const r = await Promise.race([red, tiempo]);
    if (r) return r;
  } catch (_) { /* sin red */ }
  return (await c.match(base)) || red;
}

// Borra del equipo los archivos de versiones anteriores que ya no usa la página.
async function limpiarAntiguos(resp) {
  try {
    const html = await resp.text();
    const c = await caches.open(CACHE);
    for (const k of await c.keys()) {
      const ruta = k.url.slice(base.length);
      if (/^assets\/index-[\w-]+\.(js|css)$/.test(ruta) && !html.includes(ruta)) await c.delete(k);
    }
  } catch (_) { /* nada */ }
}
