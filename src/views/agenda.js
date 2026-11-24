import { sb, state, esc, attr, ok, ftime, fdatel, cap, isoDay, today, chip, ESTADOS_CITA, nombreTecnico, colorTecnico, modal, opt, toast, fail, tecnicoOpts, esEscritorio, confirmar } from '../lib.js';
import { I } from '../icons.js';
import { botonesAviso } from '../avisos.js';
import { pintarAvisoSync } from '../sync.js';

const addDays = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return isoDay(x); };
// La semana del taller es de lunes a sábado: el domingo muestra la semana siguiente
const lunes = (d) => { const x = new Date(d + 'T12:00:00'); if (x.getDay() === 0) x.setDate(x.getDate() + 1); const w = (x.getDay() + 6) % 7; x.setDate(x.getDate() - w); return isoDay(x); };

export async function render(el, params) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(params.d || '') ? params.d : today();
  const vista = params.v || (esEscritorio() ? 'semana' : 'dia');
  const tec = params.t || '';
  const desde = vista === 'semana' ? lunes(d) : d;
  const hasta = vista === 'semana' ? addDays(desde, 6) : addDays(d, 1);
  let q = sb.from('citas').select('*,clientes(id,nombre,telefono,email),motos(id,marca,modelo,matricula)')
    .gte('inicio', new Date(desde + 'T00:00:00').toISOString()).lt('inicio', new Date(hasta + 'T00:00:00').toISOString()).order('inicio');
  if (tec) q = q.eq('tecnico_id', tec);
  const citas = ok(await q);
  const link = (o) => '#/agenda?' + new URLSearchParams({ d, v: vista, ...(tec ? { t: tec } : {}), ...o }).toString();
  const paso = vista === 'semana' ? 7 : 1;
  const titulo = vista === 'semana'
    ? `Semana del ${new Date(desde + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}`
    : fdatel(d + 'T12:00:00');

  const citaBtn = (c) => `<button type="button" class="cita ${c.estado === 'cancelada' ? 'cancelada' : ''}" data-cita="${c.id}" style="--c:${attr(colorTecnico(c.tecnico_id))}">
      <b>${ftime(c.inicio)} · ${esc(c.clientes?.nombre || 'Sin cliente')}</b>
      <span>${esc(c.servicio)}</span>${c.motos ? `<span class="muted"> · ${esc(c.motos.marca + ' ' + c.motos.modelo)}</span>` : ''}
      <div style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span class="small muted">${esc(nombreTecnico(c.tecnico_id))}</span>${chip(ESTADOS_CITA, c.estado)}</div>
    </button>`;

  let cuerpo;
  if (vista === 'semana') {
    cuerpo = '<div class="week">' + [0, 1, 2, 3, 4, 5].map((i) => {
      const dia = addDays(desde, i);
      const cs = citas.filter((c) => isoDay(c.inicio) === dia);
      const f = new Date(dia + 'T12:00:00');
      return `<div class="wday ${dia === today() ? 'today' : ''}">
        <h3><span>${esc(cap(f.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' })))}</span><a href="#/cita/nueva?d=${dia}" aria-label="Nueva cita el ${attr(dia)}">+</a></h3>
        ${cs.map(citaBtn).join('') || '<span class="muted small">Libre</span>'}
      </div>`;
    }).join('') + '</div>';
  } else {
    const horas = [];
    for (let h = 9; h < 19; h++) if (h !== 14) horas.push(h);
    cuerpo = `<div class="card daylist"><div class="list">${horas.map((h) => {
      const cs = citas.filter((c) => new Date(c.inicio).getHours() === h);
      return `<div style="align-items:flex-start"><b class="num" style="width:50px;padding-top:10px">${String(h).padStart(2, '0')}:00</b>
        <div class="grow" style="gap:8px">${cs.map(citaBtn).join('')}
        <a class="small" href="#/cita/nueva?d=${d}&h=${String(h).padStart(2, '0')}:00" style="padding:10px 0">+ Añadir cita</a></div></div>`;
    }).join('')}</div></div>`;
  }

  el.innerHTML = `
  <div class="head"><div class="t"><h1>Agenda</h1><div class="muted">${citas.filter((c) => c.estado !== 'cancelada').length} citas ${vista === 'semana' ? 'esta semana' : 'este día'}</div></div>
    <div class="actions"><a class="btn pri" href="#/cita/nueva?d=${d}">${I.plus} Nueva cita</a></div></div>
  <nav class="tabs" aria-label="Vista"><a href="${link({ v: 'dia' })}" class="${vista === 'dia' ? 'on' : ''}">Día</a><a href="${link({ v: 'semana' })}" class="${vista === 'semana' ? 'on' : ''}">Semana</a></nav>
  <div class="agenda-bar">
    <a class="btn sm" href="${link({ d: addDays(d, -paso) })}" aria-label="Anterior">${I.left}</a>
    <span class="day">${esc(titulo)}</span>
    <a class="btn sm" href="${link({ d: addDays(d, paso) })}" aria-label="Siguiente">${I.right}</a>
    <a class="btn sm" href="${link({ d: today() })}">Hoy</a>
    <input class="inp" type="date" value="${attr(d)}" aria-label="Ir a fecha" style="width:auto;min-height:36px" data-fecha>
    <select class="inp" aria-label="Técnico" style="width:auto;min-height:36px" data-tec>${opt('', 'Todo el equipo', tec)}${state.perfiles.filter((p) => p.activo).map((p) => opt(p.id, p.nombre, tec)).join('')}</select>
  </div>
  <div data-sync></div>
  ${cuerpo}`;
  pintarAvisoSync(el.querySelector('[data-sync]'), tec ? nombreTecnico(tec) : '');

  el.querySelector('[data-fecha]').addEventListener('change', (e) => { if (e.target.value) location.hash = link({ d: e.target.value }); });
  el.querySelector('[data-tec]').addEventListener('change', (e) => { location.hash = '#/agenda?' + new URLSearchParams({ d, v: vista, ...(e.target.value ? { t: e.target.value } : {}) }); });
  el.querySelectorAll('[data-cita]').forEach((b) => b.addEventListener('click', () => abrirCita(citas.find((c) => c.id == b.dataset.cita), () => render(el, params))));
  if (params.c) { const c = citas.find((x) => x.id == params.c); if (c) abrirCita(c, () => render(el, params)); }
}

export function abrirCita(c, recargar) {
  const ini = new Date(c.inicio);
  const body = `
    <p style="margin:0"><b>${esc(c.clientes?.nombre || 'Sin cliente')}</b>${c.clientes?.telefono ? ` · <a href="tel:${attr(c.clientes.telefono)}">${esc(c.clientes.telefono)}</a>` : ''}<br>
    <span class="muted">${c.motos ? esc(`${c.motos.marca} ${c.motos.modelo} · ${c.motos.matricula || ''}`) : 'Sin moto'}</span></p>
    <div class="form">
      <div class="field"><label for="c-fecha">Fecha</label><input id="c-fecha" type="date" name="fecha" value="${isoDay(ini)}"></div>
      <div class="field"><label for="c-hora">Hora</label><input id="c-hora" type="time" step="900" name="hora" value="${ftime(ini)}"></div>
      <div class="field"><label for="c-dur">Duración (min)</label><input id="c-dur" type="number" min="10" max="600" step="5" name="duracion_min" value="${c.duracion_min}"></div>
      <div class="field"><label for="c-serv">Servicio</label><input id="c-serv" name="servicio" maxlength="120" value="${attr(c.servicio)}"></div>
      <div class="field"><label for="c-tec">Técnico</label><select id="c-tec" name="tecnico_id">${tecnicoOpts(c.tecnico_id)}</select></div>
      <div class="field"><label for="c-est">Estado</label><select id="c-est" name="estado">${Object.entries(ESTADOS_CITA).map(([k, [t]]) => opt(k, t, c.estado)).join('')}</select></div>
      <div class="field full"><label for="c-notas">Notas</label><textarea id="c-notas" name="notas" maxlength="1000">${esc(c.notas || '')}</textarea></div>
    </div>
    <div class="actions">
      <a class="btn" href="#/recepcion?cita=${c.id}">Recibir moto (hoja de autorización)</a>
      ${c.clientes ? `<a class="btn" href="#/cliente/${c.clientes.id}">Ficha del cliente</a>` : ''}
      <button type="button" class="btn danger" data-borrar>Eliminar cita</button>
    </div>
    ${c.clientes && c.estado !== 'cancelada' ? botonesAviso(new Date(c.inicio) > new Date() ? 'recordatorio' : 'confirmacion', c, c.clientes, c.motos) : ''}`;
  const m = modal('Cita', body, {
    onOk: async (root) => {
      const f = Object.fromEntries([...root.querySelectorAll('[name]')].map((e) => [e.name, e.value.trim()]));
      if (!f.fecha || !f.hora) throw new Error('Indica fecha y hora');
      const upd = {
        inicio: new Date(`${f.fecha}T${f.hora}:00`).toISOString(), duracion_min: Number(f.duracion_min) || 60,
        servicio: f.servicio || 'Cita', tecnico_id: f.tecnico_id || null, estado: f.estado, notas: f.notas || null,
      };
      ok(await sb.from('citas').update(upd).eq('id', c.id));
      toast('Cita guardada');
      recargar();
    },
  });
  m.querySelector('[data-borrar]').addEventListener('click', async () => {
    if (!(await confirmar('¿Eliminar esta cita? Si solo se ha anulado, mejor marca el estado "Cancelada".', 'Eliminar'))) return;
    try { ok(await sb.from('citas').delete().eq('id', c.id)); m.remove(); toast('Cita eliminada'); recargar(); } catch (e) { fail(e); }
  });
}
