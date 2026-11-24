// Service worker mínimo: solo sirve para que la app se pueda instalar
// (Chrome, Edge y Android lo piden). No guarda nada en caché: todo va
// siempre contra la nube, así no se muestran datos viejos.
// El modo sin conexión del equipo del taller, si se hace, irá aparte.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
