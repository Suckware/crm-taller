import { sb, esc, attr, ok, fdate, ESTADOS_REP, nombreTecnico, colorTecnico, state, opt } from '../lib.js';
import { I } from '../icons.js';

export async function render(el, params) {
  const verEntregadas = params.e === '1';
  const tec = params.t || '';
  let q = sb.from('reparaciones').select('id,numero,estado,fecha_entrada,fecha_prevista,tecnico_id,motivo,firma,clientes(nombre),motos(marca,modelo,matricula)').order('fecha_entrada', { ascending: false });
  if (!verEntregadas) q = q.neq('estado', 'entregada');
  if (tec) q = q.eq('tecnico_id', tec);
  const R = ok(await q);
  const cols = Object.entries(ESTADOS_REP).filter(([k]) => verEntregadas || k !== 'entregada');
  el.innerHTML = `
  <div class="head"><div class="t"><h1>Reparaciones</h1><div class="muted">${R.length} órdenes ${verEntregadas ? '' : 'abiertas'}</div></div>
    <div class="actions"><a class="btn pri" href="#/recepcion">${I.plus} Recibir moto</a></div></div>
  <div class="agenda-bar">
    <input type="search" class="search" placeholder="Buscar por cliente, matrícula o nº…" data-q aria-label="Buscar reparación">
    <select class="inp" style="width:auto;min-height:44px" data-tec aria-label="Técnico">${opt('', 'Todo el equipo', tec)}${state.perfiles.map((p) => opt(p.id, p.nombre, tec)).join('')}</select>
    <label class="check" style="align-items:center"><input type="checkbox" data-ent ${verEntregadas ? 'checked' : ''}> Ver entregadas</label>
  </div>
  <div class="board">${cols.map(([k, [t]]) => {
    const rs = R.filter((r) => r.estado === k);
    return `<div class="col"><h3><span>${esc(t)}</span><span class="muted">${rs.length}</span></h3>
      ${rs.map((r) => `<a class="rcard" href="#/reparacion/${r.id}" data-txt="${attr(`${r.numero} ${r.clientes?.nombre} ${r.motos?.matricula} ${r.motos?.marca} ${r.motos?.modelo}`.toLowerCase())}">
        <div style="display:flex;justify-content:space-between;gap:6px"><b>${esc(r.numero)}</b><span class="small muted">${fdate(r.fecha_entrada)}</span></div>
        <div><b>${esc(r.motos ? r.motos.marca + ' ' + r.motos.modelo : 'Sin moto')}</b></div>
        <div class="small muted">${esc(r.motos?.matricula || '')} · ${esc(r.clientes?.nombre || '')}</div>
        <div class="small" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(r.motivo || '')}</div>
        <div class="small" style="display:flex;justify-content:space-between;gap:6px;flex-wrap:wrap"><span style="color:${attr(colorTecnico(r.tecnico_id))};font-weight:600">${esc(nombreTecnico(r.tecnico_id))}</span>${!r.firma ? '<span class="chip warn">Sin firmar</span>' : ''}${r.fecha_prevista ? `<span class="muted">Entrega ${fdate(r.fecha_prevista)}</span>` : ''}</div>
      </a>`).join('') || '<span class="small muted" style="padding:4px">Vacío</span>'}
    </div>`;
  }).join('')}</div>`;
  const nav = (o) => { location.hash = '#/reparaciones?' + new URLSearchParams({ ...(tec ? { t: tec } : {}), ...(verEntregadas ? { e: '1' } : {}), ...o }); };
  el.querySelector('[data-tec]').addEventListener('change', (e) => nav({ t: e.target.value }));
  el.querySelector('[data-ent]').addEventListener('change', (e) => nav({ e: e.target.checked ? '1' : '' }));
  el.querySelector('[data-q]').addEventListener('input', (e) => {
    const s = e.target.value.toLowerCase().trim();
    el.querySelectorAll('.rcard').forEach((c) => { c.style.display = !s || c.dataset.txt.includes(s) ? '' : 'none'; });
  });
}
