import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/plus-jakarta-sans/800.css';
import './styles.css';
import { sb, state, esc, attr, toast, cargarComunes, DOMINIO_USUARIOS, puedeFacturar, esAdmin, licEstado, tieneModulo, refrescarLicencia, fdate } from './lib.js';
import { I } from './icons.js';
import { activarCodigoPostal } from './cp.js';
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
import * as registro from './views/registro.js';

const app = document.getElementById('app');

// Qué módulo de la licencia hace falta para cada sección del menú
const MODULO_DE = { agenda: ['AGENDA'], rep: ['AUTORIZACION', 'REPARACIONES'], clientes: ['CLIENTES'], almacen: ['ALMACEN'], fact: ['FACTURACION'] };
const permitido = (k) => !MODULO_DE[k] || tieneModulo(...MODULO_DE[k]);

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
  [/^\/pieza\/(\d+)$/, almacen.renderFicha, 'almacen'],
  [/^\/facturacion$/, facturacion.render, 'fact'],
  [/^\/factura\/(\d+)$/, facturacion.renderFactura, 'fact'],
  [/^\/config$/, config.render, 'config'],
  [/^\/registro$/, registro.render, 'registro'],
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
  if (esAdmin()) items.push(['#/registro', 'registro', 'Registro de cambios', I.registro]);
  items.push(['#/config', 'config', 'Configuración', I.config]);
  return items.filter(([, k]) => permitido(k));
}

function shell(active) {
  const cfg = state.config || {};
  const items = navItems();
  const nav = items.map(([h, k, t, ic]) => `<a href="${h}" class="${k === active ? 'on' : ''}" title="${attr(t)}">${ic}<span>${esc(t)}</span></a>`).join('');
  const bottom = items.filter(([, k]) => ['panel', 'agenda', 'rep', 'clientes', 'almacen'].includes(k))
    .map(([h, k, t, ic]) => `<a href="${h}" class="${k === active ? 'on' : ''}">${ic}<span>${esc(t)}</span></a>`).join('');
  const rolTxt = { admin: 'Administrador', recepcion: 'Recepción', comercial: 'Comercial', mecanico: 'Mecánico' }[state.perfil.rol];
  app.innerHTML = `
  <div class="shell ${menuFijo() ? '' : 'plegado'}">
    <nav class="side" aria-label="Principal">
      <a class="brand" href="#/"><img src="./logo.png" alt="Logo de ${attr(cfg.nombre_taller)}"><div><b>${esc(cfg.nombre_taller)}</b><span>Gestión del taller</span></div></a>
      <div class="nav">${nav}</div>
      <div class="grow"></div>
      <button type="button" class="fijar" data-fijar title="Dejar el menú siempre abierto">${I.pin}<span>${menuFijo() ? 'Plegar el menú' : 'Fijar menú abierto'}</span></button>
      <div class="me"><strong>${esc(state.perfil.nombre)}</strong><span>${esc(rolTxt)}</span><button type="button" data-salir>Cerrar sesión</button></div>
    </nav>
    <div style="flex:1;min-width:0;display:flex;flex-direction:column">
      <header class="topbar"><img src="./logo.png" alt=""><b>${esc(cfg.nombre_taller)}</b><a href="#/config" style="color:#fff" aria-label="Configuración">${I.config.replace('<svg', '<svg width="22" height="22"')}</a><button type="button" data-salir>Salir</button></header>
      ${avisoLicencia()}
      <main class="main" id="view"></main>
    </div>
    <nav class="bottomnav" aria-label="Accesos rápidos">${bottom}</nav>
  </div>`;
  app.querySelectorAll('[data-salir]').forEach((b) => b.addEventListener('click', salir));
  menuPlegable();
  return document.getElementById('view');
}

// Menú lateral plegado: solo iconos; se abre al pasar el ratón (en tablet, al tocar) y se pliega al elegir.
function menuFijo() { try { return localStorage.getItem('menu_fijo') === '1'; } catch { return false; } }
function menuPlegable() {
  const shellEl = app.querySelector('.shell'); const side = app.querySelector('.side');
  if (!shellEl || !side) return;
  const tactil = () => !window.matchMedia('(hover: hover)').matches;
  side.querySelector('[data-fijar]').addEventListener('click', () => {
    const fijo = !menuFijo();
    try { localStorage.setItem('menu_fijo', fijo ? '1' : '0'); } catch { /* sin almacenamiento: solo esta vez */ }
    shellEl.classList.toggle('plegado', !fijo); side.classList.remove('abierto');
    side.querySelector('[data-fijar] span').textContent = fijo ? 'Plegar el menú' : 'Fijar menú abierto';
  });
  side.addEventListener('click', (e) => {
    if (!shellEl.classList.contains('plegado')) return;
    const a = e.target.closest('a');
    // en pantalla táctil, el primer toque abre el menú; el segundo elige
    if (tactil() && !side.classList.contains('abierto')) { e.preventDefault(); side.classList.add('abierto'); return; }
    if (a) { side.classList.remove('abierto'); side.classList.add('cerrando'); }
  });
  side.addEventListener('mouseleave', () => side.classList.remove('cerrando'));
  document.addEventListener('pointerdown', (e) => { if (!side.contains(e.target)) side.classList.remove('abierto'); });
}

function avisoLicencia() {
  const e = licEstado(); const l = state.licencia;
  if (e === 'consulta') {
    const motivo = l.bloqueada ? 'La licencia está bloqueada' : (l.termina && new Date() > new Date(l.termina)) ? `La licencia terminó el ${fdate(l.termina)}` : 'No se ha podido comprobar la licencia en los últimos días';
    return `<div class="lic-aviso bad" role="status"><b>Modo consulta.</b> ${esc(motivo)}. Puedes ver los datos, pero no crear ni cambiar nada.${esAdmin() ? ' <a href="#/config?t=licencia">Ver licencia</a>' : ' Avisa al administrador.'}</div>`;
  }
  if (e === 'gracia') return `<div class="lic-aviso" role="status">La licencia terminó el ${esc(fdate(l.termina))}. Renuévala pronto para no pasar a modo consulta.${esAdmin() ? ' <a href="#/config?t=licencia">Ver licencia</a>' : ''}</div>`;
  return '';
}

async function salir() {
  try { await sb.rpc('liberar_sesion'); } catch { /* sin conexión: caducará sola */ } // el usuario queda libre para otro dispositivo al momento
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
  document.querySelectorAll('.modal-bg').forEach((m) => m.remove()); // al cambiar de pantalla se cierran las ventanas abiertas
  const { path, params } = parseHash();
  const hit = ROUTES.find(([re]) => re.test(path));
  if (!hit) { location.hash = '#/'; return; }
  const [re, fn, active] = hit;
  if (active === 'fact' && !puedeFacturar()) { location.hash = '#/'; return; }
  if (active === 'registro' && !esAdmin()) { location.hash = '#/'; return; }
  if (!permitido(active)) { location.hash = '#/'; return; }
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
// Se guarda la pantalla anterior para los botones "Volver"
window.addEventListener('hashchange', (e) => { try { state.anterior = new URL(e.oldURL).hash || '#/'; } catch { state.anterior = null; } route(); });
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
      <button type="button" class="linkbtn" data-olvido>He olvidado mi contraseña</button>
    </form>
  </div>`;
  app.querySelector('[data-olvido]').addEventListener('click', () => renderOlvido(app.querySelector('#u').value.trim()));
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
    let r;
    try { r = await ocuparSesion('reclamar_sesion'); } catch (e2) {
      r = { estado: 'error', mensaje: /acceso/i.test(e2.message || '') ? 'Este usuario no tiene acceso al taller.' : 'No se ha podido conectar. Inténtalo de nuevo.' };
    }
    if (r.estado !== 'ok') {
      await sb.auth.signOut({ scope: 'local' }); // se descarta esta entrada; la otra sigue abierta
      btn.disabled = false; btn.textContent = 'Entrar';
      err.textContent = r.mensaje || mensajeSesion(r);
      return;
    }
    await arrancar(data.session);
  });
  f.usuario.focus();
}

// ---------- Una sola sesión por usuario ----------
// Manda el primero que entró: si el usuario ya está abierto en otro dispositivo,
// aquí no se entra y se dice dónde está abierto. Al de dentro no se le echa.
// Mientras la app está abierta da señal de vida cada minuto; si un equipo se
// apaga sin cerrar sesión, a los 10 minutos queda libre. El administrador
// también puede cerrar sesiones desde Configuración > Usuarios.
const MIN_CADUCIDAD = 10;
function nombreDispositivo() {
  const ua = navigator.userAgent;
  const tipo = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) ? 'Tablet' : /Mobi|iPhone|Android/i.test(ua) ? 'Móvil' : 'Ordenador';
  const nav = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'navegador';
  return `${tipo} · ${nav}`;
}
// reclamar_sesion al entrar; latido_sesion mientras se trabaja. Devuelve { estado: 'ok' | 'ocupada' | 'cerrada', ... }
async function ocuparSesion(fn) {
  const { data, error } = await sb.rpc(fn, { p_dispositivo: nombreDispositivo() });
  if (error) throw error;
  return data || { estado: 'ok' };
}
function mensajeSesion(r) {
  if (r.estado === 'cerrada') return 'El administrador ha cerrado tu sesión. Vuelve a entrar.';
  const hora = r.ultimo ? new Date(r.ultimo).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '';
  return `Este usuario ya tiene la sesión abierta en otro dispositivo: ${r.dispositivo || 'otro equipo'}${hora ? ` (activo a las ${hora})` : ''}. `
    + `Cierra la sesión allí para entrar aquí, o pide al administrador que la cierre. Si ese equipo se apagó sin cerrar sesión, podrás entrar pasados ${MIN_CADUCIDAD} minutos.`;
}
// true si esta sesión es la que tiene el usuario. Si no, sale de aquí y explica por qué.
async function comprobarSesion() {
  let r;
  try { r = await ocuparSesion('latido_sesion'); } catch { return true; } // sin conexión: no se saca a nadie por un fallo de red
  if (r.estado === 'ok') return true;
  state.perfil = null;
  await sb.auth.signOut({ scope: 'local' });
  renderLogin(mensajeSesion(r));
  return false;
}
let vigilando = false;
function vigilarSesion() {
  if (vigilando) return; vigilando = true;
  const mirar = () => { if (state.perfil) comprobarSesion(); };
  setInterval(mirar, 60_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') mirar(); });
}

// ---------- He olvidado mi contraseña ----------
function renderOlvido(usuario = '') {
  app.innerHTML = `
  <div class="login">
    <form novalidate>
      <img class="logo" src="./logo.png" alt="Logo de Sergio Moto Sport">
      <h1>Recuperar la contraseña</h1>
      <p class="muted small">Escribe tu usuario. Te enviaremos un enlace al correo que tengas registrado en el taller.</p>
      <div class="field"><label for="u">Usuario</label><input id="u" name="usuario" autocomplete="username" autocapitalize="none" spellcheck="false" required maxlength="60" value="${attr(usuario.replace(/@.*$/, ''))}"></div>
      <div class="err" role="alert"></div>
      <button class="btn pri" type="submit">Enviar enlace</button>
      <button type="button" class="linkbtn" data-volver>Volver a entrar</button>
    </form>
  </div>`;
  const f = app.querySelector('form');
  f.querySelector('[data-volver]').addEventListener('click', () => renderLogin());
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button[type=submit]'); const err = f.querySelector('.err');
    const u = f.usuario.value.trim().toLowerCase().replace(/@.*$/, '');
    if (!/^[a-z0-9._-]{2,40}$/.test(u)) { err.textContent = 'Usuario no válido.'; return; }
    btn.disabled = true; btn.textContent = 'Enviando…'; err.textContent = '';
    const { error } = await sb.functions.invoke('recuperar-clave', { body: { usuario: u } });
    if (error) { btn.disabled = false; btn.textContent = 'Enviar enlace'; err.textContent = 'No se ha podido enviar. Inténtalo de nuevo en un momento.'; return; }
    f.innerHTML = `<img class="logo" src="./logo.png" alt="Logo de Sergio Moto Sport"><h1>Revisa tu correo</h1>
      <p>Si el usuario <b>${esc(u)}</b> tiene un correo registrado, le hemos enviado un enlace para poner una contraseña nueva. Caduca en 1 hora.</p>
      <p class="muted small">Mira también en correo no deseado. Si no te llega, pide al administrador que revise tu correo en Configuración o que te cambie la contraseña.</p>
      <button type="button" class="btn pri" data-volver>Volver a entrar</button>`;
    f.querySelector('[data-volver]').addEventListener('click', () => renderLogin(u));
  });
  f.usuario.focus();
}

// Pantalla del enlace del correo (?clave=...). El enlace solo se usa al pulsar el botón,
// así los programas de correo que abren enlaces solos no lo gastan.
function renderNuevaClave(tokenHash) {
  const limpiarUrl = () => history.replaceState(null, '', location.pathname);
  app.innerHTML = `
  <div class="login">
    <form novalidate>
      <img class="logo" src="./logo.png" alt="Logo de Sergio Moto Sport">
      <h1>Nueva contraseña</h1>
      <div class="field"><label for="pw1">Nueva contraseña</label><input id="pw1" type="password" autocomplete="new-password" required minlength="10" maxlength="128"></div>
      <div class="field"><label for="pw2">Repetir</label><input id="pw2" type="password" autocomplete="new-password" required maxlength="128"></div>
      <p class="muted small" style="margin:0">Mínimo 10 caracteres, con mayúsculas, minúsculas y números.</p>
      <div class="err" role="alert"></div>
      <button class="btn pri" type="submit">Guardar y entrar</button>
      <button type="button" class="linkbtn" data-volver>Volver a entrar</button>
    </form>
  </div>`;
  const f = app.querySelector('form');
  f.querySelector('[data-volver]').addEventListener('click', () => { limpiarUrl(); renderLogin(); });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button[type=submit]'); const err = f.querySelector('.err');
    const a = f.querySelector('#pw1').value, b = f.querySelector('#pw2').value;
    if (a !== b) { err.textContent = 'Las contraseñas no coinciden.'; return; }
    if (a.length < 10 || !/[a-z]/.test(a) || !/[A-Z]/.test(a) || !/\d/.test(a)) { err.textContent = 'La contraseña no es suficientemente segura.'; return; }
    btn.disabled = true; btn.textContent = 'Guardando…'; err.textContent = '';
    const { data, error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
    if (error || !data.session) {
      limpiarUrl();
      renderLogin('El enlace no es válido o ha caducado. Pide otro desde "He olvidado mi contraseña".');
      return;
    }
    const { error: e2 } = await sb.auth.updateUser({ password: a });
    if (e2) {
      btn.disabled = false; btn.textContent = 'Guardar y entrar';
      err.textContent = /same|different/i.test(e2.message) ? 'Tiene que ser distinta de la anterior.' : /weak|short|password/i.test(e2.message) ? 'La contraseña no es suficientemente segura.' : 'No se ha podido guardar. Inténtalo de nuevo.';
      return;
    }
    limpiarUrl();
    let r;
    try { r = await ocuparSesion('reclamar_sesion'); } catch { r = { estado: 'error' }; }
    if (r.estado !== 'ok') {
      await sb.auth.signOut({ scope: 'local' });
      renderLogin(`Contraseña cambiada. ${r.estado === 'error' ? 'No se ha podido entrar: inténtalo de nuevo.' : mensajeSesion(r)}`);
      return;
    }
    toast('Contraseña cambiada');
    await arrancar(data.session);
  });
  f.querySelector('#pw1').focus();
}

async function arrancar(session) {
  if (!(await comprobarSesion())) return;
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
  vigilarSesion();
  // Una vez al entrar (como mucho cada 6 h) se pregunta a la consola cómo está la licencia
  const antes = JSON.stringify(state.licencia);
  refrescarLicencia().then(() => { if (JSON.stringify(state.licencia) !== antes) route(); }).catch((e) => console.warn(e));
}

sb.auth.onAuthStateChange((ev) => {
  if (ev === 'SIGNED_OUT' && state.perfil) { state.perfil = null; renderLogin(); }
});

(async () => {
  const clave = new URLSearchParams(location.search).get('clave');
  if (clave && /^[A-Za-z0-9_-]{10,200}$/.test(clave)) { await sb.auth.signOut({ scope: 'local' }); renderNuevaClave(clave); return; }
  const { data } = await sb.auth.getSession();
  if (data.session) await arrancar(data.session);
  else renderLogin();
})();

activarCodigoPostal();
