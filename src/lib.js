import { createClient } from '@supabase/supabase-js';

// Solo la clave pública (publishable). La seguridad la aplica la base de datos con RLS por roles.
export const SUPABASE_URL = 'https://sxrakoktzmwjmzlmnvts.supabase.co';
const SUPABASE_KEY = 'sb_publishable_VW3JAL_qNwgqBRPGEkF4CQ_INJjwP51';
export const DOMINIO_USUARIOS = 'sergiomotosport.app';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sms-taller-auth' },
});

export const state = { user: null, perfil: null, config: null, perfiles: [], impuestos: [] };

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
export const chip = (map, k) => { const [t, c] = map[k] || [k, '']; return `<span class="chip ${c}">${esc(t)}</span>`; };

export const rol = () => state.perfil?.rol;
export const esOficina = () => ['admin', 'recepcion'].includes(rol());
export const esAdmin = () => rol() === 'admin';
export const esEscritorio = () => window.matchMedia('(min-width: 1101px)').matches;
export const puedeFacturar = () => esOficina() && esEscritorio();
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
  (vacio ? opt('', 'Sin asignar', sel ?? '') : '') + state.perfiles.filter((p) => p.activo).map((p) => opt(p.id, p.nombre, sel)).join('');

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
  const [c, p, i] = await Promise.all([
    sb.from('config').select('*').eq('id', 1).single(),
    sb.from('perfiles').select('*').order('nombre'),
    sb.from('impuestos').select('*').order('id'),
  ]);
  if (c.error) throw c.error;
  state.config = c.data; state.perfiles = p.data || []; state.impuestos = i.data || [];
  aplicarTema(state.config);
}
