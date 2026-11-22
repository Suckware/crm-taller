import { sb, state, esc, attr, ok, money, fdate, modal, toast, fail, opt, confirmar, formData, field } from '../lib.js';
import { I } from '../icons.js';

const chipF = (e) => `<span class="chip ${e === 'cobrada' ? 'ok' : e === 'anulada' ? 'bad' : 'warn'}">${esc({ cobrada: 'Cobrada', anulada: 'Anulada', pendiente: 'Pendiente de cobro' }[e])}</span>`;

export async function render(el, params) {
  const tab = params.t || 'facturas';
  el.innerHTML = `
  <div class="head"><div class="t"><h1>Facturación</h1><div class="muted">Facturas de reparaciones · ${esc((state.impuestos.find((i) => i.por_defecto) || {}).nombre || '')} por defecto</div></div></div>
  <nav class="tabs">${[['facturas', 'Facturas'], ['pendientes', 'Pendientes de facturar'], ['resumen', 'Resumen']].map(([k, t]) => `<a href="#/facturacion?t=${k}" class="${k === tab ? 'on' : ''}">${t}</a>`).join('')}</nav>
  <div data-tab></div>`;
  const T = el.querySelector('[data-tab]');

  if (tab === 'facturas') {
    const est = params.e || '';
    let q = sb.from('facturas').select('*,clientes(nombre),reparaciones(numero)').order('created_at', { ascending: false }).limit(200);
    if (est) q = q.eq('estado', est);
    const F = ok(await q);
    T.innerHTML = `<div class="agenda-bar">${[['', 'Todas'], ['pendiente', 'Pendientes'], ['cobrada', 'Cobradas'], ['anulada', 'Anuladas']].map(([k, t]) => `<a class="btn sm ${est === k ? 'pri' : ''}" href="#/facturacion?t=facturas&e=${k}">${t}</a>`).join('')}</div>
    <section class="card"><div class="tablewrap"><table><thead><tr><th>Nº</th><th>Fecha</th><th>Cliente</th><th>Reparación</th><th class="right">Base</th><th class="right">Impuesto</th><th class="right">Total</th><th>Estado</th></tr></thead>
    <tbody>${F.map((f) => `<tr class="click" data-id="${f.id}"><td><b>${esc(f.numero)}</b></td><td>${fdate(f.fecha)}</td><td>${esc(f.clientes?.nombre)}</td><td>${esc(f.reparaciones?.numero || '')}</td><td class="right num">${money(f.base)}</td><td class="right num">${money(f.cuota)} <span class="small muted">${esc(f.impuesto_nombre)} ${Number(f.impuesto_pct)}%</span></td><td class="right num"><b>${money(f.total)}</b></td><td>${chipF(f.estado)}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">Sin facturas</td></tr>'}</tbody></table></div></section>`;
    T.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/factura/${tr.dataset.id}`; }));
  }

  if (tab === 'pendientes') {
    const [rq, fq] = await Promise.all([
      sb.from('reparaciones').select('id,numero,estado,fecha_entrada,clientes(nombre),motos(marca,modelo,matricula),reparacion_piezas(cantidad,pvp),reparacion_horas(horas,precio_hora)').in('estado', ['lista', 'entregada', 'en_reparacion']).order('fecha_entrada', { ascending: false }),
      sb.from('facturas').select('reparacion_id').neq('estado', 'anulada'),
    ]);
    const hechas = new Set(ok(fq).map((f) => f.reparacion_id));
    const R = ok(rq).filter((r) => !hechas.has(r.id)).map((r) => ({ ...r, base: r.reparacion_piezas.reduce((s, p) => s + p.cantidad * p.pvp, 0) + r.reparacion_horas.reduce((s, h) => s + h.horas * h.precio_hora, 0) }));
    T.innerHTML = `<section class="card"><p class="muted small" style="margin:0">Reparaciones terminadas o en curso que todavía no tienen factura.</p><div class="tablewrap"><table><thead><tr><th>Orden</th><th>Cliente</th><th>Moto</th><th>Estado</th><th class="right">Base</th><th></th></tr></thead>
    <tbody>${R.map((r) => `<tr><td><a href="#/reparacion/${r.id}">${esc(r.numero)}</a></td><td>${esc(r.clientes?.nombre)}</td><td>${esc(r.motos ? `${r.motos.marca} ${r.motos.modelo}` : '')}</td><td>${esc(r.estado.replace('_', ' '))}</td><td class="right num">${money(r.base)}</td><td class="right"><a class="btn sm pri" href="#/reparacion/${r.id}?t=factura">Facturar</a></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nada pendiente de facturar</td></tr>'}</tbody></table></div></section>`;
  }

  if (tab === 'resumen') {
    const y = new Date().getFullYear(); const mes = new Date(); mes.setDate(1);
    const F = ok(await sb.from('facturas').select('fecha,base,cuota,total,estado,impuesto_nombre,impuesto_pct').gte('fecha', `${y}-01-01`).neq('estado', 'anulada'));
    const delMes = F.filter((f) => new Date(f.fecha) >= new Date(mes.toDateString()));
    const sum = (a, k) => a.reduce((s, f) => s + Number(f[k]), 0);
    const porImp = {};
    F.forEach((f) => { const k = `${f.impuesto_nombre} ${Number(f.impuesto_pct)}%`; porImp[k] = porImp[k] || { base: 0, cuota: 0 }; porImp[k].base += Number(f.base); porImp[k].cuota += Number(f.cuota); });
    T.innerHTML = `<div class="kpis">
      <div class="kpi"><span class="l">Facturado este mes</span><span class="v">${money(sum(delMes, 'total'))}</span><span class="l">${delMes.length} facturas</span></div>
      <div class="kpi"><span class="l">Facturado ${y}</span><span class="v">${money(sum(F, 'total'))}</span><span class="l">${F.length} facturas</span></div>
      <div class="kpi"><span class="l">Pendiente de cobro</span><span class="v">${money(sum(F.filter((f) => f.estado === 'pendiente'), 'total'))}</span></div>
      <div class="kpi"><span class="l">Impuestos repercutidos ${y}</span><span class="v">${money(sum(F, 'cuota'))}</span></div></div>
      <section class="card"><h2>Por tipo de impuesto (${y})</h2><div class="tablewrap"><table><thead><tr><th>Impuesto</th><th class="right">Base</th><th class="right">Cuota</th></tr></thead><tbody>
      ${Object.entries(porImp).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="right num">${money(v.base)}</td><td class="right num">${money(v.cuota)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Sin datos</td></tr>'}</tbody></table></div></section>`;
  }
}

export async function renderFactura(el, params) {
  const id = Number(params.id);
  const [fq, lq] = await Promise.all([
    sb.from('facturas').select('*,clientes(*),reparaciones(id,numero,km_entrada,motos(marca,modelo,matricula,bastidor))').eq('id', id).single(),
    sb.from('factura_lineas').select('*').eq('factura_id', id).order('orden').order('id'),
  ]);
  const f = ok(fq), L = ok(lq), cfg = state.config, cli = f.clientes, moto = f.reparaciones?.motos;
  const editable = f.estado === 'pendiente';
  const recargar = () => renderFactura(el, params);
  el.innerHTML = `
  <div class="head no-print"><div class="t"><div class="muted small"><a href="#/facturacion">Facturación</a> › ${esc(f.numero)}</div><h1>Factura ${esc(f.numero)}</h1><div>${chipF(f.estado)}</div></div>
    <div class="actions">
      <button type="button" class="btn" data-print>${I.print} Imprimir / PDF</button>
      ${cli.email ? `<a class="btn" href="mailto:${attr(cli.email)}?subject=${encodeURIComponent(`Factura ${f.numero} · ${cfg.nombre_taller}`)}&body=${encodeURIComponent(`Hola ${cli.nombre},\n\nTe enviamos la factura ${f.numero} por importe de ${money(f.total)}.\n\nGracias por confiar en ${cfg.nombre_taller}.`)}">Enviar por email</a>` : ''}
      ${editable ? '<button type="button" class="btn pri" data-cobrar>Registrar cobro</button>' : ''}
      ${f.estado !== 'anulada' ? '<button type="button" class="btn danger" data-anular>Anular</button>' : ''}
    </div></div>
  ${editable ? `<section class="card no-print" style="flex-direction:row;flex-wrap:wrap;align-items:flex-end;gap:12px">
     <div class="field" style="min-width:220px"><label for="fi-imp">Impuesto de la factura</label><select id="fi-imp" class="inp">${state.impuestos.filter((i) => i.activo).map((i) => opt(i.id, `${i.nombre} ${Number(i.porcentaje).toLocaleString('es-ES')} %`, (state.impuestos.find((x) => x.nombre === f.impuesto_nombre && Number(x.porcentaje) === Number(f.impuesto_pct)) || {}).id)).join('')}</select></div>
     <button type="button" class="btn" data-linea>${I.plus} Añadir línea</button></section>` : ''}
  <article class="invoice">
    <div class="ih">
      <div style="display:flex;gap:14px;align-items:center"><img src="./logo.png" alt=""><div><b style="font-size:18px">${esc(cfg.razon_social || cfg.nombre_taller)}</b><div class="small">${esc(cfg.cif || '')}<br>${esc(cfg.direccion || '')}<br>${esc([cfg.telefono, cfg.email].filter(Boolean).join(' · '))}</div></div></div>
      <div class="right"><div class="lbl">FACTURA</div><b style="font-size:22px">${esc(f.numero)}</b><div>Fecha: ${fdate(f.fecha)}</div>${f.reparaciones ? `<div class="small muted">Orden ${esc(f.reparaciones.numero)}</div>` : ''}</div>
    </div>
    <div class="ih">
      <div><div class="lbl">Cliente</div><b>${esc(cli.nombre)}</b><div class="small">${esc(cli.nif || '')}<br>${esc(cli.direccion || '')}<br>${esc(cli.telefono || '')}</div></div>
      ${moto ? `<div class="right"><div class="lbl">Vehículo</div><b>${esc(moto.marca)} ${esc(moto.modelo)}</b><div class="small">${esc(moto.matricula || '')}${moto.bastidor ? '<br>' + esc(moto.bastidor) : ''}${f.reparaciones.km_entrada ? '<br>' + f.reparaciones.km_entrada.toLocaleString('es-ES') + ' km' : ''}</div></div>` : ''}
    </div>
    <div class="tablewrap"><table><thead><tr><th>Concepto</th><th class="right">Cant.</th><th class="right">Precio</th><th class="right">Importe</th>${editable ? '<th class="no-print"></th>' : ''}</tr></thead>
      <tbody>${L.map((l) => `<tr><td>${esc(l.concepto)}</td><td class="right num">${Number(l.cantidad).toLocaleString('es-ES')}</td><td class="right num">${money(l.precio)}</td><td class="right num">${money(l.importe)}</td>${editable ? `<td class="right no-print"><button type="button" class="btn sm danger" data-del="${l.id}" aria-label="Quitar línea">✕</button></td>` : ''}</tr>`).join('')}</tbody></table></div>
    <div class="totals">
      <div><span>Base imponible</span><b class="num">${money(f.base)}</b></div>
      <div><span>${esc(f.impuesto_nombre)} ${Number(f.impuesto_pct).toLocaleString('es-ES')} %</span><b class="num">${money(f.cuota)}</b></div>
      <div class="tot"><span>Total</span><span class="num">${money(f.total)}</span></div>
    </div>
    ${f.estado === 'cobrada' ? `<p style="margin:0"><b>Cobrada</b> el ${fdate(f.cobrada_en)} · ${esc(f.forma_pago || '')}</p>` : ''}
    ${f.estado === 'anulada' ? '<p style="margin:0;color:var(--bad);font-weight:700">FACTURA ANULADA</p>' : ''}
    <p class="small muted" style="margin:0">${esc(cfg.pie_factura || '')}</p>
  </article>`;

  el.querySelector('[data-print]').addEventListener('click', () => window.print());
  el.querySelector('#fi-imp')?.addEventListener('change', async (e) => {
    const i = state.impuestos.find((x) => x.id == e.target.value);
    try { ok(await sb.from('facturas').update({ impuesto_nombre: i.nombre, impuesto_pct: i.porcentaje }).eq('id', id)); ok(await sb.rpc('recalcular_factura', { p_factura: id })); toast('Impuesto cambiado'); recargar(); } catch (err) { fail(err); }
  });
  el.querySelector('[data-linea]')?.addEventListener('click', () => modal('Añadir línea', `<div class="form">${field('Concepto', 'concepto', '', 'text', 'maxlength="200"')}${field('Cantidad', 'cantidad', 1, 'number', 'min="0.01" step="0.01"')}${field('Precio (€)', 'precio', '', 'number', 'step="0.01"')}</div>`, {
    okText: 'Añadir',
    onOk: async (root) => {
      const o = formData(root); const c = Number(o.cantidad), p = Number(o.precio);
      if (!o.concepto || !(c > 0) || Number.isNaN(p)) throw new Error('Rellena concepto, cantidad y precio');
      ok(await sb.from('factura_lineas').insert({ factura_id: id, tipo: 'otro', concepto: o.concepto, cantidad: c, precio: p, importe: Math.round(c * p * 100) / 100, orden: 3 }));
      ok(await sb.rpc('recalcular_factura', { p_factura: id })); toast('Línea añadida'); recargar();
    },
  }));
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmar('¿Quitar esta línea de la factura?', 'Quitar'))) return;
    try { ok(await sb.from('factura_lineas').delete().eq('id', b.dataset.del)); ok(await sb.rpc('recalcular_factura', { p_factura: id })); recargar(); } catch (e) { fail(e); }
  }));
  el.querySelector('[data-cobrar]')?.addEventListener('click', () => modal('Registrar cobro', `<p style="margin:0">Total a cobrar: <b>${money(f.total)}</b></p><div class="form"><div class="field"><label for="fp">Forma de pago</label><select id="fp" name="forma_pago">${['Tarjeta', 'Efectivo', 'Bizum', 'Transferencia'].map((x) => opt(x, x, 'Tarjeta')).join('')}</select></div></div>`, {
    okText: 'Marcar como cobrada',
    onOk: async (root) => {
      ok(await sb.from('facturas').update({ estado: 'cobrada', forma_pago: root.querySelector('#fp').value, cobrada_en: new Date().toISOString() }).eq('id', id));
      if (f.reparaciones?.id) await sb.from('reparaciones').update({ estado: 'entregada' }).eq('id', f.reparaciones.id).eq('estado', 'lista');
      toast('Cobro registrado'); recargar();
    },
  }));
  el.querySelector('[data-anular]')?.addEventListener('click', async () => {
    if (!(await confirmar(`¿Anular la factura ${f.numero}? Quedará registrada como anulada y se podrá volver a facturar la reparación.`, 'Anular'))) return;
    try { ok(await sb.from('facturas').update({ estado: 'anulada' }).eq('id', id)); toast('Factura anulada'); recargar(); } catch (e) { fail(e); }
  });
}
