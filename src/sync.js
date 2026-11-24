// Trabajar sin internet en el taller · fase 2: señal de vida y aviso para no solapar citas.
//
// * El administrador marca UN ordenador como "equipo del taller" (Configuración).
//   Ese ordenador guarda su código en este navegador y manda una señal de vida
//   cada minuto mientras la app está abierta, y otra al cerrarla de forma normal.
// * Cualquier otro dispositivo pregunta a la nube si algún equipo del taller
//   lleva más de X minutos sin dar señal (o tiene cambios sin subir). Si es así,
//   la agenda y la pantalla de nueva cita muestran un aviso amarillo. Si todo va
//   bien, no se ve nada. El aviso nunca impide guardar.
// * La hora la pone siempre el servidor, así que da igual la hora del móvil.
import { sb, state, esc, ftime, fdate, today, isoDay, SUPABASE_URL, SUPABASE_KEY } from './lib.js';

const CLAVE = 'sms-equipo-taller';

export function equipoLocal() {
  try { const v = localStorage.getItem(CLAVE); return /^[0-9a-f-]{36}$/i.test(v || '') ? v : null; } catch { return null; }
}
export function marcarEquipoLocal(id) {
  try { if (id) localStorage.setItem(CLAVE, id); else localStorage.removeItem(CLAVE); } catch { /* navegador sin almacenamiento */ }
}

// Cambios guardados en este equipo que aún no han subido a la nube.
// Hoy siempre 0: todo se guarda directamente en la nube. En la fase 3 (copia
// local) será el tamaño de la cola de cambios.
export const cambiosPendientes = () => 0;

let timer = null;
let token = null;
let alCerrar = null;

async function latir() {
  const id = equipoLocal();
  if (!id || !state.perfil) return;
  try {
    token = (await sb.auth.getSession()).data.session?.access_token || null;
    const { data, error } = await sb.rpc('latido_equipo', { p_equipo: id, p_pendientes: cambiosPendientes(), p_cerrado: false });
    if (!error && data === false) { marcarEquipoLocal(null); pararLatido(); } // el administrador lo retiró
  } catch { /* sin conexión: precisamente por eso los demás verán el aviso */ }
}

export function iniciarLatido() {
  if (timer || !equipoLocal()) return;
  latir();
  timer = setInterval(latir, 60_000);
  alCerrar = () => avisarCierre();
  addEventListener('pagehide', alCerrar);
  document.addEventListener('visibilitychange', visible);
}
function visible() { if (document.visibilityState === 'visible') latir(); }

export function pararLatido() {
  clearInterval(timer); timer = null;
  if (alCerrar) removeEventListener('pagehide', alCerrar);
  document.removeEventListener('visibilitychange', visible);
  alCerrar = null;
}

// Al cerrar la app (o la pestaña) de forma normal se avisa a la nube para que
// nadie vea el aviso amarillo por un ordenador que simplemente se ha apagado.
// keepalive deja que la petición salga aunque la página se esté cerrando.
export function avisarCierre() {
  const id = equipoLocal();
  if (!id || !token) return Promise.resolve();
  return fetch(`${SUPABASE_URL}/rest/v1/rpc/latido_equipo`, {
    method: 'POST', keepalive: true,
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_equipo: id, p_pendientes: cambiosPendientes(), p_cerrado: true }),
  }).catch(() => {});
}

// ---------- Lo que ven los demás ----------
let cache = { t: 0, data: [] };
export async function estadoSync(forzar = false) {
  if (!forzar && Date.now() - cache.t < 20_000) return cache.data;
  const { data, error } = await sb.rpc('estado_sync');
  if (error) return cache.data; // sin conexión: no se inventa un aviso
  cache = { t: Date.now(), data: data || [] };
  return cache.data;
}

const cuando = (d) => (isoDay(d) === today() ? `desde las ${ftime(d)}` : `desde el ${fdate(d)} a las ${ftime(d)}`);

// HTML del aviso, o '' si todo está sincronizado. tecnico = nombre del técnico elegido (opcional).
export async function avisoSync(tecnico = '') {
  const yo = equipoLocal();
  const malos = (await estadoSync()).filter((e) => e.aviso && e.id !== yo);
  if (!malos.length) return '';
  const partes = malos.map((e) => {
    const sinSenal = e.ultimo_latido ? `no sincroniza ${cuando(e.ultimo_latido)}` : 'todavía no ha sincronizado nunca';
    const cola = e.pendientes > 0 ? ` y tiene ${e.pendientes} ${e.pendientes === 1 ? 'cambio' : 'cambios'} sin subir` : '';
    return `<strong>${esc(e.nombre)}</strong> ${sinSenal}${cola}`;
  });
  return `<div class="aviso sync-aviso" role="status"><b>Posible problema de sincronización</b>
    <span>El equipo del taller (${partes.join('; ')}). Puede haber citas hechas allí que aún no han subido${tecnico ? `: puede que <strong>${esc(tecnico)}</strong> no esté libre aunque aquí lo parezca` : ''}. Llama al taller antes de confirmar.</span></div>`;
}

// Rellena un hueco de la pantalla con el aviso (si lo hay). No bloquea la pantalla mientras pregunta.
export function pintarAvisoSync(box, tecnico = '') {
  if (!box) return;
  avisoSync(tecnico).then((h) => { if (box.isConnected) box.innerHTML = h; }).catch(() => {});
}
