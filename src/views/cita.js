import { sb, state, esc, attr, ok, today, isoDay, fdatel, ftime, tecnicoOpts, opt, toast, fail, nombreTecnico } from '../lib.js';
import { selectorClienteMoto } from './comun.js';

const SERVICIOS = [
  ['Revisión / mantenimiento', 60], ['Diagnóstico', 60], ['Recepción de moto', 30], ['Cambio de neumáticos', 45],
  ['Frenos', 60], ['Banco de potencia', 90], ['Reprogramación de centralita', 120], ['Preparación de competición', 180],
  ['Entrega de moto', 15], ['ITV / pre-ITV', 45],
];

export async function render(el, params) {
  const st = { cliente: null, moto: null, fecha: /^\d{4}-\d{2}-\d{2}$/.test(params.d || '') ? params.d : today(), hora: params.h || null, servicio: SERVICIOS[0][0], dur: SERVICIOS[0][1], tecnico: '' , notas: ''};
  el.innerHTML = `
  <div class="head"><div class="t"><h1>Nueva cita</h1><div class="muted">Solo el personal del taller puede agendar</div></div><div class="actions"><a class="btn" href="#/agenda?d=${st.fecha}">Cancelar</a></div></div>
  <div class="row">
    <section class="card"><h2>1 · Cliente y moto</h2><div data-cli></div></section>
    <section class="card wide"><h2>2 · Servicio, día y hora</h2>
      <div class="form">
        <div class="field"><label for="n-serv">Servicio</label><select id="n-serv" class="inp">${SERVICIOS.map(([s]) => opt(s, s, st.servicio)).join('')}</select></div>
        <div class="field"><label for="n-tec">Técnico</label><select id="n-tec" class="inp">${tecnicoOpts('')}</select></div>
        <div class="field"><label for="n-fecha">Día</label><input id="n-fecha" type="date" class="inp" value="${attr(st.fecha)}" min="${today()}"></div>
        <div class="field"><label for="n-dur">Duración (min)</label><input id="n-dur" type="number" class="inp" min="10" max="600" step="5" value="${st.dur}"></div>
      </div>
      <div class="lbl" data-dia></div>
      <div class="slots" data-slots></div>
      <div class="field"><label for="n-notas">Notas para el taller</label><textarea id="n-notas" class="inp" maxlength="1000" placeholder="Ej.: ruido en la transmisión, trae neumáticos propios…"></textarea></div>
      <div data-resumen class="muted"></div>
      <button type="button" class="btn pri" data-ok disabled>Confirmar cita</button>
    </section>
  </div>`;

  selectorClienteMoto(el.querySelector('[data-cli]'), (s) => { st.cliente = s.cliente; st.moto = s.moto; resumen(); }, /^\d+$/.test(params.cliente || '') ? { cliente: { id: Number(params.cliente) } } : {});
  const $ = (s) => el.querySelector(s);
  $('#n-serv').addEventListener('change', (e) => { st.servicio = e.target.value; st.dur = SERVICIOS.find((x) => x[0] === st.servicio)[1]; $('#n-dur').value = st.dur; slots(); });
  $('#n-tec').addEventListener('change', (e) => { st.tecnico = e.target.value; slots(); });
  $('#n-fecha').addEventListener('change', (e) => { st.fecha = e.target.value; st.hora = null; slots(); });
  $('#n-dur').addEventListener('change', (e) => { st.dur = Math.min(600, Math.max(10, Number(e.target.value) || 60)); slots(); });
  $('#n-notas').addEventListener('input', (e) => { st.notas = e.target.value; });

  async function slots() {
    $('[data-dia]').textContent = st.fecha ? fdatel(st.fecha + 'T12:00:00') : '';
    const box = $('[data-slots]');
    if (!st.fecha) { box.innerHTML = ''; return; }
    const d = new Date(st.fecha + 'T00:00:00'); const d1 = new Date(d); d1.setDate(d1.getDate() + 1);
    let q = sb.from('citas').select('inicio,duracion_min,tecnico_id').neq('estado', 'cancelada').gte('inicio', d.toISOString()).lt('inicio', d1.toISOString());
    if (st.tecnico) q = q.eq('tecnico_id', st.tecnico);
    const ocupadas = (await q).data || [];
    const horas = [];
    for (let m = 9 * 60; m < 19 * 60; m += 30) { if (m >= 14 * 60 && m < 16 * 60) continue; horas.push(m); }
    const ahora = new Date();
    box.innerHTML = horas.map((m) => {
      const hh = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const ini = new Date(`${st.fecha}T${hh}:00`); const fin = new Date(ini.getTime() + st.dur * 60000);
      const busy = st.tecnico && ocupadas.some((c) => { const a = new Date(c.inicio); const b = new Date(a.getTime() + c.duracion_min * 60000); return ini < b && fin > a; });
      const pasado = ini < ahora;
      const dis = busy || pasado;
      return `<button type="button" class="slot ${dis ? 'busy' : ''} ${st.hora === hh ? 'on' : ''}" data-h="${hh}" ${dis ? 'disabled' : ''} aria-pressed="${st.hora === hh}">${hh}</button>`;
    }).join('');
    box.querySelectorAll('[data-h]').forEach((b) => b.addEventListener('click', () => { st.hora = b.dataset.h; slots(); }));
    resumen();
  }
  function resumen() {
    const listo = st.cliente && st.fecha && st.hora;
    $('[data-ok]').disabled = !listo;
    $('[data-resumen]').innerHTML = listo ? `Cita para <b>${esc(st.cliente.nombre)}</b> el <b>${esc(fdatel(st.fecha + 'T12:00:00'))}</b> a las <b>${esc(st.hora)}</b> · ${esc(st.servicio)} · ${esc(st.tecnico ? nombreTecnico(st.tecnico) : 'sin técnico asignado')}` : 'Elige cliente, día y hora.';
  }
  $('[data-ok]').addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      const c = ok(await sb.from('citas').insert({
        cliente_id: st.cliente.id, moto_id: st.moto?.id || null, inicio: new Date(`${st.fecha}T${st.hora}:00`).toISOString(),
        duracion_min: st.dur, servicio: st.servicio, tecnico_id: st.tecnico || null, estado: 'confirmada', notas: st.notas.trim() || null,
      }).select().single());
      confirmada(el, c, st);
    } catch (err) { fail(err); b.disabled = false; }
  });
  slots();
}

function confirmada(el, c, st) {
  el.innerHTML = `
  <section class="card" style="max-width:560px;margin:0 auto;text-align:center;align-items:center;gap:14px">
    <div style="width:72px;height:72px;border-radius:50%;background:var(--ok-bg);color:var(--ok);display:grid;place-items:center;font-size:36px" aria-hidden="true">✓</div>
    <h1>Cita confirmada</h1>
    <p style="margin:0"><b>${esc(st.cliente.nombre)}</b>${st.moto ? `<br><span class="muted">${esc(st.moto.marca + ' ' + st.moto.modelo + ' · ' + (st.moto.matricula || ''))}</span>` : ''}</p>
    <p style="margin:0"><b>${esc(fdatel(c.inicio))}</b> · ${esc(ftime(c.inicio))}</p>
    <p class="muted" style="margin:0">${esc(c.servicio)} · ${esc(c.tecnico_id ? nombreTecnico(c.tecnico_id) : 'sin técnico')}</p>
    <div class="actions" style="justify-content:center;width:100%">
      <a class="btn" href="#/agenda?d=${isoDay(c.inicio)}&v=dia">Ver en la agenda</a>
      <a class="btn pri" href="#/cita/nueva">Otra cita</a>
    </div>
  </section>`;
  toast('Cita guardada');
}
