import { createClient } from '@supabase/supabase-js';

// Solo la clave pública (publishable). La seguridad la aplica la base de datos con RLS por roles.
export const SUPABASE_URL = 'https://sxrakoktzmwjmzlmnvts.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_VW3JAL_qNwgqBRPGEkF4CQ_INJjwP51';
export const DOMINIO_USUARIOS = 'sergiomotosport.app';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sms-taller-auth' },
});

export const state = { user: null, perfil: null, config: null, perfiles: [], roles: [], impuestos: [], tarifas: [], campos: [], licencia: null };

// ---------- Escapado (evita XSS: todo dato de la BD pasa por aquí) ----------
export function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"'`=\/]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;', '=': '&#61;', '/': '&#47;' }[c]));
}
export const attr = esc;

// ---------- Formatos ----------
const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
export const money = (n) => eur.format(Number(n || 0));
export const fdate = (d) => (d ? new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
export const fdatel = (d) => cap(new Date(d).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }));
export const ftime = (d) => new Date(d).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
export const fdt = (d) => (d ? `${fdate(d)} ${ftime(d)}` : '');
export const isoDay = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
export const today = () => isoDay(new Date());

export const ESTADOS_CITA = {
  pendiente: ['Pendiente', 'warn'], confirmada: ['Confirmada', 'ok'], en_taller: ['En el taller', 'info'],
  completada: ['Completada', ''], cancelada: ['Cancelada', 'bad'], no_vino: ['No vino', 'bad'],
};
export const ESTADOS_REP = {
  recibida: ['Recibida', 'info'], diagnostico: ['En diagnóstico', 'info'], esperando_aprobacion: ['Esperando aprobación', 'warn'],
  esperando_piezas: ['Esperando piezas', 'warn'], en_reparacion: ['En reparación', 'info'], lista: ['Lista para recoger', 'ok'], entregada: ['Entregada', ''],
};
// ---------- Periodicidad de facturación del cliente ----------
export const PERIODOS = { inmediata: 'en el momento', decenal: 'cada 10 días', quincenal: 'cada 15 días', mensual: 'cada mes' };
const ultimoDiaMes = (y, m) => new Date(y, m + 1, 0).getDate();
// Último día del periodo al que pertenece el día ('YYYY-MM-DD')
export function finPeriodo(dia, periodo) {
  const [y, m, d] = dia.split('-').map(Number);
  const u = ultimoDiaMes(y, m - 1);
  const fin = periodo === 'decenal' ? (d <= 10 ? 10 : d <= 20 ? 20 : u) : periodo === 'quincenal' ? (d <= 15 ? 15 : u) : periodo === 'mensual' ? u : d;
  return `${y}-${String(m).padStart(2, '0')}-${String(fin).padStart(2, '0')}`;
}
// Último día del último periodo ya cerrado antes de hoy (fecha de corte propuesta)
export function ultimoCorte(periodo, hoy = today()) {
  if (!periodo || periodo === 'inmediata') return hoy;
  const ayer = isoDay(new Date(new Date(hoy + 'T12:00:00').getTime() - 86400000));
  let f = finPeriodo(ayer, periodo);
  if (f > ayer) { // el periodo de ayer aún no ha terminado: el anterior
    const [y, m, d] = f.split('-').map(Number);
    const ini = periodo === 'mensual' ? 1 : periodo === 'quincenal' ? (d === 15 ? 1 : 16) : (d === 10 ? 1 : d === 20 ? 11 : 21);
    f = isoDay(new Date(y, m - 1, ini - 1, 12));
  }
  return f;
}

export const chip = (map, k) => { const [t, c] = map[k] || [k, '']; return `<span class="chip ${c}">${esc(t)}</span>`; };

// ---------- Roles (Configuración › Roles) ----------
// Esto solo decide qué se enseña. Lo que se puede leer y guardar lo decide la base de datos.
export const VENTANAS = [['agenda', 'Agenda'], ['rep', 'Reparaciones y recepción'], ['clientes', 'Clientes y proveedores'], ['almacen', 'Almacén'], ['fact', 'Facturación']];
export const NIVELES = { admin: 'Administrador: todo', oficina: 'Oficina: cambia precios, stock y factura', taller: 'Taller: consulta el almacén, no factura' };
export const DISPOSITIVOS = [['acceso_ios', 'iPhone / iPad'], ['acceso_android', 'Android'], ['acceso_windows', 'Windows'], ['acceso_otros', 'Otros (Mac, Linux)']];
export const rol = () => state.perfil?.rol;
// Los de serie, por si la base de datos aún no tiene la tabla de roles
const ROLES_SERIE = [
  { clave: 'admin', nombre: 'Administrador', nivel: 'admin', ventanas: ['agenda', 'rep', 'clientes', 'almacen', 'fact'], tecnico: true, sistema: true },
  { clave: 'recepcion', nombre: 'Recepción', nivel: 'oficina', ventanas: ['agenda', 'rep', 'clientes', 'almacen', 'fact'], tecnico: true, sistema: true },
  { clave: 'comercial', nombre: 'Comercial', nivel: 'oficina', ventanas: ['agenda', 'rep', 'clientes', 'almacen', 'fact'], tecnico: false, sistema: true },
  { clave: 'mecanico', nombre: 'Mecánico', nivel: 'taller', ventanas: ['agenda', 'rep', 'clientes', 'almacen'], tecnico: true, sistema: true },
];
export const rolDe = (clave) => (state.roles.length ? state.roles : ROLES_SERIE).find((r) => r.clave === clave);
export const nombreRol = (clave) => rolDe(clave)?.nombre || clave || '';
const nivel = () => rolDe(rol())?.nivel || 'taller';
export const esOficina = () => ['admin', 'oficina'].includes(nivel());
export const esAdmin = () => nivel() === 'admin';
export const puedeVentana = (v) => esAdmin() || !!rolDe(rol())?.ventanas?.includes(v);
export const esEscritorio = () => window.matchMedia('(min-width: 1101px)').matches;
export const puedeFacturar = () => esOficina() && esEscritorio() && puedeVentana('fact');
export const nombreTecnico = (id) => state.perfiles.find((p) => p.id === id)?.nombre || 'Sin asignar';
export const colorTecnico = (id) => state.perfiles.find((p) => p.id === id)?.color || '#1F3A6E';

// ---------- Toasts ----------
export function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), err ? 6000 : 3200);
}
export function fail(e) {
  console.error(e);
  const m = e?.message || String(e);
  let t = 'No se ha podido guardar. ' + m;
  if (/row-level security|permission|No tienes permiso|42501/i.test(m)) t = 'No tienes permiso para esta acción con tu usuario.';
  toast(t, true);
}
// Lanza si la respuesta de Supabase trae error
export function ok(res) { if (res.error) throw res.error; return res.data; }

// ---------- Modal ----------
export function modal(title, bodyHtml, { okText = 'Guardar', onOk, wide = false, cancelText = 'Cancelar' } = {}) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${attr(title)}" style="${wide ? 'max-width:860px' : ''}">
    <h2>${esc(title)}</h2><div class="mbody">${bodyHtml}</div>
    <div class="foot"><button type="button" class="btn" data-x>${esc(cancelText)}</button>${onOk ? `<button type="button" class="btn pri" data-ok>${esc(okText)}</button>` : ''}</div></div>`;
  const close = () => bg.remove();
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-x]')) close(); });
  bg.querySelector('[data-ok]')?.addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try { const r = await onOk(bg); if (r !== false) close(); } catch (err) { fail(err); } finally { b.disabled = false; }
  });
  document.body.appendChild(bg);
  bg.querySelector('input,select,textarea')?.focus();
  return bg;
}
export function confirmar(texto, okText = 'Sí, continuar') {
  return new Promise((res) => {
    const m = modal('Confirmar', `<p>${esc(texto)}</p>`, { okText, onOk: () => res(true) });
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-x]')) res(false); });
  });
}

// Lee un formulario a objeto: strings recortados; vacíos -> null
export function formData(root) {
  const o = {};
  root.querySelectorAll('[name]').forEach((el) => {
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else { const v = el.value.trim(); o[el.name] = v === '' ? null : v; }
  });
  return o;
}
export function req(o, campos) {
  for (const [k, label] of campos) if (o[k] === null || o[k] === undefined || o[k] === '') throw new Error(`Falta: ${label}`);
}

export const opt = (v, t, sel) => `<option value="${attr(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(t)}</option>`;
export const field = (label, name, val = '', type = 'text', extra = '') =>
  `<div class="field"><label for="f-${name}">${esc(label)}</label><input id="f-${name}" name="${name}" type="${type}" value="${attr(val ?? '')}" ${extra}></div>`;
export const area = (label, name, val = '', extra = '') =>
  `<div class="field full"><label for="f-${name}">${esc(label)}</label><textarea id="f-${name}" name="${name}" ${extra}>${esc(val ?? '')}</textarea></div>`;
export const select = (label, name, options, extra = '') =>
  `<div class="field"><label for="f-${name}">${esc(label)}</label><select id="f-${name}" name="${name}" ${extra}>${options}</select></div>`;

export const tecnicoOpts = (sel, vacio = true) =>
  (vacio ? opt('', 'Sin asignar', sel ?? '') : '') + state.perfiles.filter((p) => p.activo && rolDe(p.rol)?.tecnico !== false).map((p) => opt(p.id, p.nombre, sel)).join('');

// Color: valida hex
export const hex = (c, def) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : def);

export function aplicarTema(cfg) {
  const r = document.documentElement.style;
  const a = hex(cfg?.color_acento, '#1F3A6E');
  const s = hex(cfg?.color_lateral, '#111827');
  r.setProperty('--accent', a);
  r.setProperty('--side', s);
  r.setProperty('--side2', mix(s, '#ffffff', 0.1));
  r.setProperty('--accent-soft', mix(a, '#ffffff', 0.9));
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', s);
}
function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

export async function cargarComunes() {
  const [c, p, i, t, cp, l, r] = await Promise.all([
    sb.from('config').select('*').eq('id', 1).single(),
    sb.from('perfiles').select('*').order('nombre'),
    sb.from('impuestos').select('*').order('id'),
    sb.from('tarifas').select('*').order('id'),
    sb.from('campos_personalizados').select('*').order('orden'),
    sb.from('licencia').select('*').eq('id', 1).maybeSingle(),
    sb.from('roles').select('*').order('nombre'),
  ]);
  if (c.error) throw c.error;
  state.config = c.data; state.perfiles = p.data || []; state.impuestos = i.data || [];
  state.tarifas = t.data || []; state.campos = cp.data || []; state.licencia = l.data || null;
  state.roles = r.data || [];
  aplicarTema(state.config);
}

// ---------- Licencia (la manda la consola de proveedor) ----------
// Esto solo decide qué se enseña en pantalla. Lo que se puede guardar lo decide
// la base de datos (disparadores de licencia), así que tocar el navegador no sirve de nada.
// libre: sin licencia activada (sin límites) · activa · gracia · consulta (solo ver)
export function licEstado(l = state.licencia) {
  if (!l || !l.controlada) return 'libre';
  const hoy = today();
  const mas = (d, n) => isoDay(new Date(new Date(d + 'T12:00:00').getTime() + n * 86400000));
  if (l.bloqueada || !l.termina || hoy > mas(l.termina, l.dias_gracia)) return 'consulta';
  if (!l.ultima_ok || Date.now() - new Date(l.ultima_ok).getTime() > l.dias_gracia * 86400000) return 'consulta';
  return hoy > l.termina ? 'gracia' : 'activa';
}
// ¿Está el módulo en el plan? (con licencia libre, todo)
export function tieneModulo(...claves) {
  const l = state.licencia;
  if (licEstado() === 'libre') return true;
  return claves.some((k) => (l.modulos || []).includes(k));
}
export const MODULOS_CRM = {
  AGENDA: 'Agenda y citas', CLIENTES: 'Clientes y proveedores', VEHICULOS: 'Vehículos', AUTORIZACION: 'Hoja de autorización',
  REPARACIONES: 'Reparaciones', ALMACEN: 'Almacén', FACTURACION: 'Facturación (ordenador)', APPS: 'Apps Android, iOS y Windows',
  SEDES: 'Varias sedes', INFORMES: 'Informes', RECORDATORIOS: 'Recordatorios ITV y revisión', MEDIDA: 'Logo, colores y campos a medida',
  AUDITORIA: 'Registro de cambios e informes',
};
// Plan según los módulos: Premium si trae alguno de Premium, Profesional si trae alguno de Profesional
export function licPlan(l = state.licencia) {
  const m = l?.modulos || [];
  if (['SEDES', 'INFORMES', 'RECORDATORIOS', 'MEDIDA'].some((k) => m.includes(k))) return 'Premium';
  if (['REPARACIONES', 'ALMACEN', 'FACTURACION', 'APPS'].some((k) => m.includes(k))) return 'Profesional';
  return 'Básico';
}
// Pregunta a la consola (desde nuestro servidor) cómo está la licencia. Sin forzar, como mucho cada 6 horas.
export async function refrescarLicencia(forzar = false) {
  const l = state.licencia;
  if (!l || !l.controlada) return false;
  if (!forzar && l.ultima_consulta && Date.now() - new Date(l.ultima_consulta).getTime() < 6 * 3600000) return false;
  const { data, error } = await sb.functions.invoke('licencia', { body: { accion: 'actualizar' } });
  const r = await sb.from('licencia').select('*').eq('id', 1).maybeSingle();
  if (!r.error) state.licencia = r.data;
  if (error || data?.ok === false) throw new Error(data?.error || 'No se ha podido hablar con la consola de licencias.');
  return true;
}
export async function activarLicencia(codigo) {
  const { data, error } = await sb.functions.invoke('licencia', { body: { accion: 'activar', codigo } });
  if (error) {
    let m = '';
    try { m = (await error.context.json()).error; } catch { /* sin detalle */ }
    throw new Error(m || 'No se ha podido activar la licencia.');
  }
  if (!data?.ok) throw new Error(data?.error || 'No se ha podido activar la licencia.');
  const r = await sb.from('licencia').select('*').eq('id', 1).maybeSingle();
  if (!r.error) state.licencia = r.data;
}

// ---------- Botón "Volver" de las fichas ----------
// Lleva a la pantalla desde la que se abrió la ficha (no a la pestaña anterior de la misma ficha).
// Si se entra directamente (enlace o recarga), vuelve a la lista de su sección.
// Al llegar pulsando "Volver" no se apunta de dónde venimos, para no quedar dando vueltas entre dos fichas.
const volverDe = {};
let porVolver = false;
document.addEventListener('click', (e) => { if (e.target.closest?.('a[data-volver]')) porVolver = true; }, true);
export function volverA(ficha, id, defecto) {
  const propia = `#/${ficha}/${id}`;
  const a = state.anterior;
  if (!porVolver && a && a !== propia && !a.startsWith(propia + '?')) volverDe[ficha] = { id, a };
  porVolver = false;
  return volverDe[ficha]?.id === id ? volverDe[ficha].a : defecto;
}
export const botonVolver = (href) => `<a class="btn" href="${attr(href)}" data-volver>← Volver</a>`;
