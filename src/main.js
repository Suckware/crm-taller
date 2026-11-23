import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/plus-jakarta-sans/800.css';
import './styles.css';
import { sb, state, esc, attr, toast, cargarComunes, DOMINIO_USUARIOS, puedeFacturar, esAdmin } from './lib.js';
import { I } from './icons.js';
import * as panel from './views/panel.js';
import * as agenda from './views/agenda.js';
import * as cita from './views/cita.js';
import * as recepcion from './views/recepcion.js';
import * as reparaciones from './views/reparaciones.js';
import * as reparacion from './views/reparacion.js';
import * as clientes from './views/clientes.js';
import * as almacen from './views/almacen.js';
import * as facturacion from './views/facturacion.js';
import * as config from './views/config.js';

const app = document.getElementById('app');

const ROUTES = [
  [/^\/?$/, panel.render, 'panel'],
  [/^\/agenda$/, agenda.render, 'agenda'],
  [/^\/cita\/nueva$/, cita.render, 'agenda'],
  [/^\/recepcion$/, recepcion.render, 'rep'],
  [/^\/reparaciones$/, reparaciones.render, 'rep'],
  [/^\/reparacion\/(\d+)$/, reparacion.render, 'rep'],
  [/^\/clientes$/, clientes.renderLista, 'clientes'],
  [/^\/cliente\/(\d+)$/, clientes.renderFicha, 'clientes'],
  [/^\/almacen$/, almacen.render, 'almacen'],
  [/^\/facturacion$/, facturacion.render, 'fact'],
  [/^\/factura\/(\d+)$/, facturacion.renderFactura, 'fact'],
  [/^\/config$/, config.render, 'config'],
];

function navItems() {
  const items = [
    ['#/', 'panel', 'Panel', I.panel],
    ['#/agenda', 'agenda', 'Agenda', I.agenda],
    ['#/reparaciones', 'rep', 'Reparaciones', I.rep],
    ['#/clientes', 'clientes', 'Clientes', I.clientes],
    ['#/almacen', 'almacen', 'Almacén', I.almacen],
  ];
  if (puedeFacturar()) items.push(['#/facturacion', 'fact', 'Facturación', I.fact]);
  items.push(['#/config', 'config', 'Configuración', I.config]);
  return items;
}

function shell(active) {
  const cfg = state.config || {};
  const items = navItems();
  const nav = items.map(([h, k, t, ic]) => `<a href="${h}" class="${k === active ? 'on' : ''}" title="${attr(t)}">${ic}<span>${esc(t)}</span></a>`).join('');
  const bottom = items.filter(([, k]) => ['panel', 'agenda', 'rep', 'clientes', 'almacen'].includes(k))
    .map(([h, k, t, ic]) => `<a href="${h}" class="${k === active ? 'on' : ''}">${ic}<span>${esc(t)}</span></a>`).join('');
  const rolTxt = { admin: 'Administrador', recepcion: 'Recepción', comercial: 'Comercial', mecanico: 'Mecánico' }[state.perfil.rol];
  app.innerHTML = `
  <div class="shell">
    <nav class="side" aria-label="Principal">
      <a class="brand" href="#/"><img src="./logo.png" alt="Logo de ${attr(cfg.nombre_taller)}"><div><b>${esc(cfg.nombre_taller)}</b><span>Gestión del taller</span></div></a>
      <div class="nav">${nav}</div>
      <div class="grow"></div>
      <div class="me"><strong>${esc(state.perfil.nombre)}</strong><span>${esc(rolTxt)}</span><button type="button" data-salir>Cerrar sesión</button></div>
    </nav>
    <div style="flex:1;min-width:0;display:flex;flex-direction:column">
      <header class="topbar"><img src="./logo.png" alt=""><b>${esc(cfg.nombre_taller)}</b><a href="#/config" style="color:#fff" aria-label="Configuración">${I.config.replace('<svg', '<svg width="22" height="22"')}</a><button type="button" data-salir>Salir</button></header>
      <main class="main" id="view"></main>
    </div>
    <nav class="bottomnav" aria-label="Accesos rápidos">${bottom}</nav>
  </div>`;
  app.querySelectorAll('[data-salir]').forEach((b) => b.addEventListener('click', salir));
  return document.getElementById('view');
}

async function salir() {
  await sb.auth.signOut();
  state.user = state.perfil = null;
  location.hash = '#/';
  renderLogin();
}

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path, params: Object.fromEntries(new URLSearchParams(qs || '')) };
}

let rendering = 0;
async function route() {
  if (!state.perfil) return;
  const { path, params } = parseHash();
  const hit = ROUTES.find(([re]) => re.test(path));
  if (!hit) { location.hash = '#/'; return; }
  const [re, fn, active] = hit;
  if (active === 'fact' && !puedeFacturar()) { location.hash = '#/'; return; }
  const m = path.match(re);
  const view = shell(active);
  const my = ++rendering;
  view.innerHTML = '<p class="muted">Cargando…</p>';
  try {
    await fn(view, { ...params, id: m[1] }, () => my === rendering);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="card"><h2>No se ha podido cargar</h2><p class="muted">${esc(e.message || e)}</p><a class="btn" href="#/">Volver al panel</a></div>`;
  }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
let lastDesk = window.matchMedia('(min-width: 1101px)').matches;
window.addEventListener('resize', () => {
  const d = window.matchMedia('(min-width: 1101px)').matches;
  if (d !== lastDesk) { lastDesk = d; if (state.perfil) route(); }
});


function renderLogin(msg = '') {
  app.innerHTML = `
  <div class="login">
    <form autocomplete="on" novalidate>
      <img class="logo" src="./logo.png" alt="Logo de Sergio Moto Sport">
      <h1>Acceso del personal</h1>
      <p class="muted small">Solo para el equipo del taller</p>
      <div class="field"><label for="u">Usuario</label><input id="u" name="usuario" autocomplete="username" autocapitalize="none" spellcheck="false" required maxlength="60"></div>
      <div class="field"><label for="p">Contraseña</label><input id="p" name="password" type="password" autocomplete="current-password" required maxlength="128"></div>
      <div class="err" role="alert">${esc(msg)}</div>
      <button class="btn pri" type="submit">Entrar</button>
    </form>
  </div>`;
  const f = app.querySelector('form');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button'); const err = f.querySelector('.err');
    const u = f.usuario.value.trim().toLowerCase();
    const p = f.password.value;
    if (!u || !p) { err.textContent = 'Escribe usuario y contraseña.'; return; }
    if (!/^[a-z0-9._-]{2,40}(@[a-z0-9.-]+)?$/.test(u)) { err.textContent = 'Usuario no válido.'; return; }
    btn.disabled = true; btn.textContent = 'Entrando…'; err.textContent = '';
    const email = u.includes('@') ? u : `${u}@${DOMINIO_USUARIOS}`;
    const { data, error } = await sb.auth.signInWithPassword({ email, password: p });
    if (error) {
      btn.disabled = false; btn.textContent = 'Entrar';
      err.textContent = /rate|many/i.test(error.message) ? 'Demasiados intentos. Espera un momento.' : 'Usuario o contraseña incorrectos.';
      return;
    }
    await arrancar(data.session);
  });
  f.usuario.focus();
}

async function arrancar(session) {
  state.user = session.user;
  const { data: perfil } = await sb.from('perfiles').select('*').eq('id', session.user.id).maybeSingle();
  if (!perfil || !perfil.activo) {
    await sb.auth.signOut();
    renderLogin('Este usuario no tiene acceso al taller.');
    return;
  }
  state.perfil = perfil;
  try { await cargarComunes(); } catch (e) { renderLogin('No se ha podido conectar. Inténtalo de nuevo.'); return; }
  route();
}

sb.auth.onAuthStateChange((ev) => {
  if (ev === 'SIGNED_OUT' && state.perfil) { state.perfil = null; renderLogin(); }
});

(async () => {
  const { data } = await sb.auth.getSession();
  if (data.session) await arrancar(data.session);
  else renderLogin();
})();

