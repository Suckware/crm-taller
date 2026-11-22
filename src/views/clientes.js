import { sb, esc, attr, ok, fdate, fdt, ftime, money, chip, ESTADOS_REP, ESTADOS_CITA, modal, toast, fail, formData, puedeFacturar, esAdmin, confirmar } from '../lib.js';
import { formCliente, validarCliente, nuevoCliente, nuevaMoto } from './comun.js';
import { I } from '../icons.js';

export async function renderLista(el, params) {
  const s = (params.q || '').replace(/[%,()*]/g, ' ').trim();
  let q = sb.from('clientes').select('id,nombre,telefono,email,motos(marca,modelo,matricula)').order('nombre').limit(200);
  if (s) q = q.or(`nombre.ilike.%${s}%,telefono.ilike.%${s}%,email.ilike.%${s}%,nif.ilike.%${s}%`);
  const C = ok(await q);
  el.innerHTML = `
  <div class="head"><div class="t"><h1>Clientes</h1><div class="muted">${C.length} clientes</div></div>
    <div class="actions"><button type="button" class="btn pri" data-nuevo>${I.plus} Nuevo cliente</button></div></div>
  <form data-buscar><input type="search" class="search" name="q" value="${attr(s)}" placeholder="Buscar por nombre, teléfono, email o NIF…" aria-label="Buscar cliente" maxlength="60"></form>
  <section class="card"><div class="tablewrap"><table>
    <thead><tr><th>Cliente</th><th>Teléfono</th><th class="hide-movil">Email</th><th>Motos</th></tr></thead>
    <tbody>${C.map((c) => `<tr class="click" data-id="${c.id}"><td><b>${esc(c.nombre)}</b></td><td><a href="tel:${attr(c.telefono || '')}">${esc(c.telefono || '')}</a></td><td class="hide-movil">${esc(c.email || '')}</td>
      <td class="small">${c.motos.map((m) => esc(`${m.marca} ${m.modelo} (${m.matricula || '—'})`)).join('<br>')}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Sin clientes</td></tr>'}</tbody>
  </table></div></section>`;
  el.querySelector('[data-buscar]').addEventListener('submit', (e) => { e.preventDefault(); location.hash = '#/clientes?q=' + encodeURIComponent(e.target.q.value.trim()); });
  el.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a')) location.hash = `#/cliente/${tr.dataset.id}`; }));
  el.querySelector('[data-nuevo]').addEventListener('click', () => nuevoCliente('', (c) => { location.hash = `#/cliente/${c.id}`; }));
}

export async function renderFicha(el, params) {
  const id = Number(params.id);
  const tab = params.t || 'datos';
  const [cq, mq, rq, aq, fq] = await Promise.all([
    sb.from('clientes').select('*').eq('id', id).single(),
    sb.from('motos').select('*').eq('cliente_id', id).order('id'),
    sb.from('reparaciones').select('id,numero,estado,fecha_entrada,motivo,motos(marca,modelo)').eq('cliente_id', id).order('fecha_entrada', { ascending: false }),
    sb.from('citas').select('id,inicio,servicio,estado').eq('cliente_id', id).order('inicio', { ascending: false }).limit(30),
    puedeFacturar() ? sb.from('facturas').select('id,numero,fecha,total,estado').eq('cliente_id', id).order('fecha', { ascending: false }) : Promise.resolve({ data: [] }),
  ]);
  const c = ok(cq), M = ok(mq), R = ok(rq), A = ok(aq), F = ok(fq);
  const tabs = [['datos', 'Datos'], ['motos', `Motos (${M.length})`], ['historial', `Reparaciones (${R.length})`], ['citas', 'Citas']];
  if (puedeFacturar()) tabs.push(['facturas', `Facturas (${F.length})`]);
  el.innerHTML = `
  <div class="head"><div class="t"><div class="muted small"><a href="#/clientes">Clientes</a> › ficha</div><h1>${esc(c.nombre)}</h1>
    <div class="muted">${c.telefono ? `<a href="tel:${attr(c.telefono)}">${esc(c.telefono)}</a>` : ''}${c.email ? ` · <a href="mailto:${attr(c.email)}">${esc(c.email)}</a>` : ''}</div></div>
    <div class="actions"><a class="btn" href="#/cita/nueva">${I.agenda} Nueva cita</a><a class="btn pri" href="#/recepcion">Recibir moto</a></div></div>
  <nav class="tabs">${tabs.map(([k, t]) => `<a href="#/cliente/${id}?t=${k}" class="${k === tab ? 'on' : ''}">${esc(t)}</a>`).join('')}</nav>
  <div data-tab></div>`;
  const T = el.querySelector('[data-tab]');
  const recargar = () => renderFicha(el, params);

  if (tab === 'datos') {
    T.innerHTML = `<section class="card" data-f>${formCliente(c)}<div class="actions"><button type="button" class="btn pri" data-g>Guardar cambios</button>${esAdmin() ? '<button type="button" class="btn danger" data-del>Eliminar cliente</button>' : ''}</div><p class="muted small" style="margin:0">Cliente desde ${fdate(c.created_at)}</p></section>`;
    T.querySelector('[data-g]').addEventListener('click', async () => {
      try { const o = validarCliente(formData(T.querySelector('[data-f]'))); ok(await sb.from('clientes').update(o).eq('id', id)); toast('Cliente guardado'); recargar(); } catch (e) { fail(e); }
    });
    T.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!(await confirmar(`¿Eliminar a ${c.nombre} y sus motos? No se puede deshacer.`, 'Eliminar'))) return;
      try { ok(await sb.from('clientes').delete().eq('id', id)); toast('Cliente eliminado'); location.hash = '#/clientes'; } catch (e) { fail(e.message?.includes('foreign') ? new Error('Tiene reparaciones o facturas: no se puede eliminar') : e); }
    });
  }
  if (tab === 'motos') {
    T.innerHTML = `<section class="card"><div class="head"><h2>Motos</h2><button type="button" class="btn pri" data-nm>${I.plus} Añadir moto</button></div>
      <div class="list">${M.map((m) => `<div><span style="color:var(--accent)">${I.moto.replace('<svg', '<svg width="28" height="28"')}</span><span class="grow"><b>${esc(m.marca)} ${esc(m.modelo)}${m.anio ? ' · ' + m.anio : ''}</b><span class="muted small">${esc(m.matricula || 'Sin matrícula')}${m.km ? ' · ' + m.km.toLocaleString('es-ES') + ' km' : ''}${m.bastidor ? ' · ' + esc(m.bastidor) : ''}${m.color ? ' · ' + esc(m.color) : ''}</span></span><button type="button" class="btn sm" data-em="${m.id}">Editar</button></div>`).join('') || '<div class="empty">Sin motos</div>'}</div></section>`;
    T.querySelector('[data-nm]').addEventListener('click', () => nuevaMoto(id, recargar));
    T.querySelectorAll('[data-em]').forEach((b) => b.addEventListener('click', () => nuevaMoto(id, recargar, M.find((m) => m.id == b.dataset.em))));
  }
  if (tab === 'historial') {
    T.innerHTML = `<section class="card"><div class="list">${R.map((r) => `<a href="#/reparacion/${r.id}"><span class="grow"><b>${esc(r.numero)} · ${esc(r.motos ? r.motos.marca + ' ' + r.motos.modelo : '')}</b><span class="muted small">${fdate(r.fecha_entrada)} · ${esc(r.motivo || '')}</span></span>${chip(ESTADOS_REP, r.estado)}</a>`).join('') || '<div class="empty">Sin reparaciones</div>'}</div></section>`;
  }
  if (tab === 'citas') {
    T.innerHTML = `<section class="card"><div class="list">${A.map((a) => `<a href="#/agenda?d=${a.inicio.slice(0, 10)}&v=dia&c=${a.id}"><b class="num" style="width:130px">${fdate(a.inicio)} ${ftime(a.inicio)}</b><span class="grow">${esc(a.servicio)}</span>${chip(ESTADOS_CITA, a.estado)}</a>`).join('') || '<div class="empty">Sin citas</div>'}</div></section>`;
  }
  if (tab === 'facturas' && puedeFacturar()) {
    T.innerHTML = `<section class="card"><div class="list">${F.map((f) => `<a href="#/factura/${f.id}"><b style="width:120px">${esc(f.numero)}</b><span class="grow">${fdate(f.fecha)}</span><b class="num">${money(f.total)}</b><span class="chip ${f.estado === 'cobrada' ? 'ok' : f.estado === 'anulada' ? 'bad' : 'warn'}">${esc(f.estado)}</span></a>`).join('') || '<div class="empty">Sin facturas</div>'}</div></section>`;
  }
}
export { fdt, modal };
