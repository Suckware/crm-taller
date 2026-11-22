import { sb, state, esc, ok, money, ftime, fdatel, chip, ESTADOS_CITA, ESTADOS_REP, nombreTecnico, colorTecnico, puedeFacturar, today } from '../lib.js';

export async function render(el) {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const d1 = new Date(d0); d1.setDate(d1.getDate() + 1);
  const [citas, reps, piezas, facts] = await Promise.all([
    sb.from('citas').select('id,inicio,servicio,estado,tecnico_id,clientes(nombre),motos(marca,modelo,matricula)').gte('inicio', d0.toISOString()).lt('inicio', d1.toISOString()).order('inicio'),
    sb.from('reparaciones').select('id,numero,estado,firma,motivo,clientes(nombre),motos(marca,modelo,matricula)').neq('estado', 'entregada').order('fecha_entrada', { ascending: false }),
    sb.from('piezas').select('id,referencia,nombre,stock,stock_minimo').order('stock'),
    puedeFacturar() ? sb.from('facturas').select('total,estado').eq('estado', 'pendiente') : Promise.resolve({ data: [] }),
  ]);
  const C = ok(citas), R = ok(reps), P = ok(piezas).filter((p) => p.stock <= p.stock_minimo), F = ok(facts);
  const sinConfirmar = C.filter((c) => c.estado === 'pendiente').length;
  const listas = R.filter((r) => r.estado === 'lista').length;
  const sinFirma = R.filter((r) => !r.firma).length;
  const accion = R.filter((r) => ['esperando_aprobacion', 'lista', 'esperando_piezas'].includes(r.estado) || !r.firma).slice(0, 6);
  const pendCobro = F.reduce((s, f) => s + Number(f.total), 0);
  const hora = new Date().getHours();
  const saludo = hora < 13 ? 'Buenos días' : hora < 20 ? 'Buenas tardes' : 'Buenas noches';

  el.innerHTML = `
  <div class="head">
    <div class="t"><h1>${saludo}, ${esc(state.perfil.nombre.split(' ')[0])}</h1><div class="muted">${esc(fdatel(new Date()))}</div></div>
    <div class="actions"><a class="btn" href="#/recepcion">Recibir moto</a><a class="btn pri" href="#/cita/nueva?d=${today()}">+ Nueva cita</a></div>
  </div>
  <div class="kpis">
    <a class="kpi" href="#/agenda"><span class="l">Citas hoy</span><span class="v">${C.length}</span><span class="l">${sinConfirmar} sin confirmar</span></a>
    <a class="kpi" href="#/reparaciones"><span class="l">Reparaciones en curso</span><span class="v">${R.length}</span><span class="l">${listas} listas para recoger</span></a>
    <a class="kpi" href="#/almacen"><span class="l">Piezas con stock bajo</span><span class="v">${P.length}</span><span class="l">Ver almacén</span></a>
    <a class="kpi" href="#/reparaciones"><span class="l">Hojas sin firmar</span><span class="v">${sinFirma}</span><span class="l">Revisar</span></a>
    ${puedeFacturar() ? `<a class="kpi" href="#/facturacion"><span class="l">Pendiente de cobro</span><span class="v">${money(pendCobro)}</span><span class="l">${F.length} facturas</span></a>` : ''}
  </div>
  <div class="row">
    <section class="card wide">
      <div class="head"><h2>Citas de hoy</h2><a href="#/agenda">Abrir agenda</a></div>
      <div class="list">${C.length ? C.map((c) => `
        <a href="#/agenda?d=${today()}&c=${c.id}">
          <b class="num" style="width:52px">${ftime(c.inicio)}</b>
          <span class="grow"><b>${esc(c.clientes?.nombre || 'Sin cliente')}</b><span class="muted small">${esc(c.servicio)}${c.motos ? ' · ' + esc(c.motos.marca + ' ' + c.motos.modelo) : ''} · <span style="color:${esc(colorTecnico(c.tecnico_id))}">${esc(nombreTecnico(c.tecnico_id))}</span></span></span>
          ${chip(ESTADOS_CITA, c.estado)}
        </a>`).join('') : '<div class="empty">No hay citas hoy. <a href="#/cita/nueva">Crear una</a></div>'}
      </div>
    </section>
    <div style="display:flex;flex-direction:column;gap:20px">
      <section class="card">
        <h2>Requieren acción</h2>
        <div class="list">${accion.length ? accion.map((r) => `
          <a href="#/reparacion/${r.id}"><span class="grow"><b>${esc(r.numero)} · ${esc(r.motos ? r.motos.marca + ' ' + r.motos.modelo : '')}</b><span class="muted small">${esc(r.clientes?.nombre)}${!r.firma ? ' · falta firma de autorización' : ''}</span></span>${chip(ESTADOS_REP, r.estado)}</a>`).join('') : '<div class="empty">Todo al día</div>'}
        </div>
        <a href="#/reparaciones">Ir al tablero</a>
      </section>
      <section class="card">
        <h2>Stock bajo</h2>
        <div class="list">${P.length ? P.slice(0, 6).map((p) => `
          <a href="#/almacen?q=${encodeURIComponent(p.referencia)}"><span class="grow"><b>${esc(p.nombre)}</b><span class="muted small">${esc(p.referencia)}</span></span><b style="color:var(--bad)">Quedan ${p.stock}</b></a>`).join('') : '<div class="empty">Stock correcto</div>'}
        </div>
        <a href="#/almacen?t=compras">Registrar compra</a>
      </section>
    </div>
  </div>`;
}
