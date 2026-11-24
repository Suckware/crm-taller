import { sb, state, esc, attr, ok, money, fdate, modal, toast, fail, opt, confirmar, formData, field, esAdmin, today, isoDay, PERIODOS, finPeriodo, ultimoCorte, volverA, botonVolver } from '../lib.js';
import { I } from '../icons.js';
import { renderRemesas } from './remesas.js';

const chipF = (e) => `<span class="chip ${e === 'cobrada' ? 'ok' : e === 'anulada' ? 'bad' : e === 'emitida' ? 'info' : 'warn'}">${esc({ cobrada: 'Cobrada', anulada: 'Anulada', pendiente: 'Pendiente de cobro', emitida: 'Rectificativa' }[e])}</span>`;

export async function render(el, params) {
  const tab = params.t || 'facturas';
  el.innerHTML = `
  <div class="head"><div class="t"><h1>Facturación</h1><div class="muted">Facturas de reparaciones · ${esc((state.impuestos.find((i) => i.por_defecto) || {}).nombre || '')} por defecto</div></div></div>
  <nav class="tabs">${[['facturas', 'Facturas'], ['pendientes', 'Pendientes de facturar'], ...(esAdmin() ? [['remesas', 'Remesas al banco']] : []), ['resumen', 'Resumen']].map(([k, t]) => `<a href="#/facturacion?t=${k}" class="${k === tab ? 'on' : ''}">${t}</a>`).join('')}</nav>
  <div data-tab></div>`;
  const T = el.querySelector('[data-tab]');

  if (tab === 'facturas') {
    // Filtros: fechas en el servidor; cliente, estado y número al momento
    const hoy = today();
    const d1 = /^\d{4}-\d{2}-\d{2}$/.test(params.d1 || '') ? params.d1 : isoDay(new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1, 12));
    const d2 = /^\d{4}-\d{2}-\d{2}$/.test(params.d2 || '') ? params.d2 : hoy;
    const F = ok(await sb.from('facturas').select('*,clientes(nombre),reparaciones!facturas_reparacion_id_fkey(numero)').gte('fecha', d1).lte('fecha', d2)
      .order('fecha', { ascending: false }).order('id', { ascending: false }).limit(2000));
    const ESTADOS = [['pendiente', 'Pendiente de cobro'], ['cobrada', 'Cobrada'], ['anulada', 'Anulada'], ['rectificativa', 'Rectificativa']];
    T.innerHTML = `<section class="card filtros-mov" data-fil><div class="form">
        ${field('Desde', 'd1', d1, 'date', `max="${hoy}"`)}${field('Hasta', 'd2', d2, 'date')}
        ${field('Cliente', 'cli', '', 'search', 'placeholder="Nombre del cliente" maxlength="60"')}
        <div class="field"><label for="ff-e">Estado</label><select id="ff-e" name="est">${opt('', 'Todos', params.e || '')}${ESTADOS.map(([k, t]) => opt(k, t, params.e || '')).join('')}</select></div>
        ${field('Número', 'num', '', 'search', 'placeholder="Nº de factura u orden" maxlength="30"')}
      </div><div class="actions"><span class="muted small" data-cuenta></span><button type="button" class="btn sm" data-limpiar>Quitar filtros</button></div></section>
    <section class="card"><div class="tablewrap"><table><thead><tr><th>Nº</th><th>Fecha</th><th>Cliente</th><th>Reparación</th><th class="right">Base</th><th class="right">Impuesto</th><th class="right">Total</th><th>Estado</th></tr></thead>
    <tbody>${F.map((f, i) => `<tr class="click" data-id="${f.id}" data-i="${i}"><td><b>${esc(f.numero)}</b></td><td>${fdate(f.fecha)}</td><td>${esc(f.clientes?.nombre)}</td><td>${esc(f.reparaciones?.numero || '')}</td><td class="right num">${money(f.base)}</td><td class="right num">${money(f.cuota)} <span class="small muted">${esc(f.impuesto_nombre)} ${Number(f.impuesto_pct)}%</span></td><td class="right num"><b>${money(f.total)}</b></td><td>${chipF(f.estado)}</td></tr>`).join('')}
    <tr data-vacio style="display:none"><td colspan="8" class="empty">Sin facturas con estos filtros</td></tr></tbody>
    <tfoot><tr><td colspan="4"><b>Total filtrado</b></td><td class="right num" data-sb></td><td class="right num" data-sc></td><td class="right num" data-st></td><td></td></tr></tfoot></table></div></section>`;
    const Fi = T.querySelector('[data-fil]');
    const filas = [...T.querySelectorAll('tr[data-i]')];
    const aplicar = () => {
      const o = formData(Fi); const cl = (o.cli || '').toLowerCase(); const nu = (o.num || '').toLowerCase();
      let n = 0, b = 0, c = 0, t = 0;
      filas.forEach((tr) => {
        const f = F[tr.dataset.i];
        const v = (!cl || (f.clientes?.nombre || '').toLowerCase().includes(cl)) && (!nu || `${f.numero} ${f.reparaciones?.numero || ''}`.toLowerCase().includes(nu))
          && (!o.est || (o.est === 'rectificativa' ? f.tipo === 'rectificativa' : f.estado === o.est));
        tr.style.display = v ? '' : 'none';
        if (v) { n++; b += Number(f.base); c += Number(f.cuota); t += Number(f.total); }
      });
      T.querySelector('[data-vacio]').style.display = n ? 'none' : '';
      T.querySelector('[data-sb]').textContent = money(b); T.querySelector('[data-sc]').textContent = money(c); T.querySelector('[data-st]').textContent = money(t);
      Fi.querySelector('[data-cuenta]').textContent = `${n} de ${F.length} facturas`;
    };
    Fi.querySelectorAll('[name=cli],[name=est],[name=num]').forEach((x) => x.addEventListener('input', aplicar));
    Fi.querySelectorAll('[name=d1],[name=d2]').forEach((x) => x.addEventListener('change', () => {
      const a = Fi.querySelector('[name=d1]').value, z = Fi.querySelector('[name=d2]').value;
      if (a && z && a <= z) location.hash = `#/facturacion?${new URLSearchParams({ t: 'facturas', d1: a, d2: z })}`;
    }));
    Fi.querySelector('[data-limpiar]').addEventListener('click', () => { location.hash = '#/facturacion?t=facturas&r=' + Date.now(); });
    filas.forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/factura/${tr.dataset.id}`; }));
    aplicar();
  }

  if (tab === 'pendientes') await renderPendientes(T, params);

  if (tab === 'remesas' && esAdmin()) await renderRemesas(T, params);

  if (tab === 'resumen') {
    const y = new Date().getFullYear(); const mes = new Date(); mes.setDate(1);
    const F = ok(await sb.from('facturas').select('fecha,base,cuota,total,estado,impuesto_nombre,impuesto_pct').gte('fecha', `${y}-01-01`).neq('estado', 'anulada').neq('tipo', 'rectificativa'));
    const delMes = F.filter((f) => new Date(f.fecha) >= new Date(mes.toDateString()));
    const sum = (a, k) => a.reduce((s, f) => s + Number(f[k]), 0);
    const porImp = {};
    F.forEach((f) => { const k = `${f.impuesto_nombre} ${Number(f.impuesto_pct)}%`; porImp[k] = porImp[k] || { base: 0, cuota: 0 }; porImp[k].base += Number(f.base); porImp[k].cuota += Number(f.cuota); });
    T.innerHTML = `<div class="kpis">
      <div class="kpi"><span class="l">Facturado este mes</span><span class="v">${money(sum(delMes, 'total'))}</span><span class="l">${delMes.length} facturas</span></div>
      <div class="kpi"><span class="l">Facturado ${y}</span><span class="v">${money(sum(F, 'total'))}</span><span class="l">${F.length} facturas</span></div>
      <div class="kpi"><span class="l">Pendiente de cobro</span><span class="v">${money(sum(F.filter((f) => f.estado === 'pendiente'), 'total'))}</span></div>
      <div class="kpi"><span class="l">Impuestos repercutidos ${y}</span><span class="v">${money(sum(F, 'cuota'))}</span></div></div>
      <p class="muted small" style="margin:0">Las facturas anuladas y sus rectificativas se compensan entre sí y no cuentan en estos totales.</p>
      <section class="card"><h2>Por tipo de impuesto (${y})</h2><div class="tablewrap"><table><thead><tr><th>Impuesto</th><th class="right">Base</th><th class="right">Cuota</th></tr></thead><tbody>
      ${Object.entries(porImp).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="right num">${money(v.base)}</td><td class="right num">${money(v.cuota)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Sin datos</td></tr>'}</tbody></table></div></section>`;
  }
}

export async function renderFactura(el, params) {
  const id = Number(params.id);
  const [fq, lq, oq] = await Promise.all([
    sb.from('facturas').select('*,clientes(*),reparaciones!facturas_reparacion_id_fkey(id,numero,km_entrada,motos(marca,modelo,matricula,bastidor))').eq('id', id).single(),
    sb.from('factura_lineas').select('*').eq('factura_id', id).order('orden').order('id'),
    sb.from('factura_reparaciones').select('reparaciones(id,numero,fecha_fin,motos(marca,modelo,matricula))').eq('factura_id', id),
  ]);
  const f = ok(fq), L = ok(lq), cfg = state.config, cli = f.clientes, moto = f.reparaciones?.motos;
  // Factura recapitulativa: varias órdenes (albaranes) en una sola factura
  const ordenes = (oq.data || []).map((x) => x.reparaciones).filter(Boolean);
  const ordenDe = Object.fromEntries(ordenes.map((o) => [o.id, o]));
  const agrupada = ordenes.length > 1 || (f.tipo === 'rectificativa' && new Set(L.map((l) => l.reparacion_id).filter(Boolean)).size > 1);
  const remesa = esAdmin() ? ((await sb.from('remesa_recibos').select('estado,remesas(id,numero,fecha_cargo,estado)').eq('factura_id', id).order('id', { ascending: false }).limit(1)).data || [])[0] : null;
  const rect = f.tipo === 'rectificativa';
  // factura relacionada: la original (si es rectificativa) o su rectificativa (si está anulada)
  const rel = rect
    ? (await sb.from('facturas').select('id,numero,fecha').eq('id', f.rectifica_id).maybeSingle()).data
    : f.estado === 'anulada' ? (await sb.from('facturas').select('id,numero,fecha').eq('rectifica_id', f.id).maybeSingle()).data : null;
  const editable = f.estado === 'pendiente';
  const conDto = editable || L.some((l) => Number(l.dto_pct));
  const titulo = rect ? 'Factura rectificativa' : 'Factura';
  const recargar = () => renderFactura(el, params);
  el.innerHTML = `
  <div class="head no-print"><div class="t"><h1>${titulo} ${esc(f.numero)}</h1><div>${chipF(f.estado)}</div></div>
    <div class="actions">
      ${botonVolver(volverA('factura', id, '#/facturacion'))}
      <button type="button" class="btn" data-print>${I.print} Imprimir / PDF</button>
      ${cli.email ? `<a class="btn" href="mailto:${attr(cli.email)}?subject=${encodeURIComponent(`${titulo} ${f.numero} · ${cfg.nombre_taller}`)}&body=${encodeURIComponent(`Hola ${cli.nombre},\n\nTe enviamos la ${titulo.toLowerCase()} ${f.numero} por importe de ${money(f.total)}${rel && rect ? `, que rectifica la factura ${rel.numero}` : ''}.\n\nGracias por confiar en ${cfg.nombre_taller}.`)}">Enviar por email</a>` : ''}
      ${editable ? '<button type="button" class="btn pri" data-cobrar>Registrar cobro</button>' : ''}
      ${f.estado !== 'anulada' && !rect ? '<button type="button" class="btn danger" data-anular>Anular (genera rectificativa)</button>' : ''}
    </div></div>
  ${editable ? `<section class="card no-print" style="flex-direction:row;flex-wrap:wrap;align-items:flex-end;gap:12px">
     <div class="field" style="min-width:220px"><label for="fi-imp">Impuesto de la factura</label><select id="fi-imp" class="inp">${state.impuestos.filter((i) => i.activo).map((i) => opt(i.id, `${i.nombre} ${Number(i.porcentaje).toLocaleString('es-ES')} %`, (state.impuestos.find((x) => x.nombre === f.impuesto_nombre && Number(x.porcentaje) === Number(f.impuesto_pct)) || {}).id)).join('')}</select></div>
     <button type="button" class="btn" data-linea>${I.plus} Añadir línea</button></section>` : ''}
  <article class="invoice">
    <div class="ih">
      <div style="display:flex;gap:14px;align-items:center"><img src="./logo.png" alt=""><div><b style="font-size:18px">${esc(cfg.razon_social || cfg.nombre_taller)}</b><div class="small">${esc(cfg.cif || '')}<br>${esc(cfg.direccion || '')}<br>${esc([cfg.telefono, cfg.email].filter(Boolean).join(' · '))}</div></div></div>
      <div class="right"><div class="lbl">${rect ? 'FACTURA RECTIFICATIVA' : 'FACTURA'}</div><b style="font-size:22px">${esc(f.numero)}</b><div>Fecha: ${fdate(f.fecha)}</div>${f.periodo_desde && f.periodo_hasta && (f.periodo_desde !== f.periodo_hasta || f.periodo_hasta !== f.fecha) ? `<div class="small">Operaciones: ${f.periodo_desde === f.periodo_hasta ? fdate(f.periodo_desde) : `${fdate(f.periodo_desde)} – ${fdate(f.periodo_hasta)}`}</div>` : ''}${agrupada ? `<div class="small muted">Órdenes ${esc(ordenes.map((o) => o.numero).join(', '))}</div>` : f.reparaciones ? `<div class="small muted">Orden ${esc(f.reparaciones.numero)}</div>` : ''}</div>
    </div>
    <div class="ih">
      <div><div class="lbl">Cliente</div><b>${esc(cli.nombre)}</b><div class="small">${esc(cli.nif || '')}<br>${esc(cli.direccion || '')}<br>${esc(cli.telefono || '')}</div></div>
      ${moto ? `<div class="right"><div class="lbl">Vehículo</div><b>${esc(moto.marca)} ${esc(moto.modelo)}</b><div class="small">${esc(moto.matricula || '')}${moto.bastidor ? '<br>' + esc(moto.bastidor) : ''}${f.reparaciones.km_entrada ? '<br>' + f.reparaciones.km_entrada.toLocaleString('es-ES') + ' km' : ''}</div></div>` : ''}
    </div>
    <div class="tablewrap"><table><thead><tr><th>Concepto</th><th class="right">Cant.</th><th class="right">Precio</th>${conDto ? '<th class="right">Dto.</th>' : ''}<th class="right">Importe</th>${editable ? '<th class="no-print"></th>' : ''}</tr></thead>
      <tbody>${L.map((l, i) => `${agrupada && l.reparacion_id && l.reparacion_id !== L[i - 1]?.reparacion_id ? cabeceraOrden(ordenDe[l.reparacion_id], 4 + (conDto ? 1 : 0) + (editable ? 1 : 0)) : ''}<tr><td>${esc(l.concepto)}</td><td class="right num">${Number(l.cantidad).toLocaleString('es-ES')}</td><td class="right num">${money(l.precio)}</td>${conDto ? `<td class="right num">${editable
        ? `<span class="no-print"><input class="inp dto" type="number" min="0" max="100" step="0.5" inputmode="decimal" value="${attr(Number(l.dto_pct) || 0)}" data-dto="${l.id}" aria-label="Descuento de la línea en %"> %</span><span class="solo-print">${Number(l.dto_pct) ? `${Number(l.dto_pct).toLocaleString('es-ES')} %` : ''}</span>`
        : (Number(l.dto_pct) ? `${Number(l.dto_pct).toLocaleString('es-ES')} %` : '')}</td>` : ''}<td class="right num">${money(l.importe)}</td>${editable ? `<td class="right no-print"><button type="button" class="btn sm danger" data-del="${l.id}" aria-label="Quitar línea">✕</button></td>` : ''}</tr>`).join('')}</tbody></table></div>
    <div class="totals">
      <div><span>Base imponible</span><b class="num">${money(f.base)}</b></div>
      <div><span>${esc(f.impuesto_nombre)} ${Number(f.impuesto_pct).toLocaleString('es-ES')} %</span><b class="num">${money(f.cuota)}</b></div>
      <div class="tot"><span>Total</span><span class="num">${money(f.total)}</span></div>
    </div>
    ${f.estado === 'cobrada' ? `<p style="margin:0"><b>Cobrada</b> el ${fdate(f.cobrada_en)} · ${esc(f.forma_pago || '')}</p>` : f.forma_pago === 'Domiciliación SEPA' && f.estado === 'pendiente' ? '<p style="margin:0">Forma de pago: <b>domiciliación bancaria</b></p>' : ''}
    ${remesa ? `<p class="small no-print" style="margin:0">Remesa <a href="#/facturacion?t=remesas">${esc(remesa.remesas.numero)}</a> · cargo el ${fdate(remesa.remesas.fecha_cargo)} · recibo ${esc({ incluido: 'incluido', cobrado: 'cobrado', devuelto: 'DEVUELTO', anulado: 'anulado' }[remesa.estado])}</p>` : ''}
    ${rect ? `<p style="margin:0"><b>Rectifica la factura ${rel ? `<a href="#/factura/${rel.id}">${esc(rel.numero)}</a> de fecha ${fdate(rel.fecha)}` : ''}</b> por anulación total.${f.motivo_rectificacion ? `<br>Motivo: ${esc(f.motivo_rectificacion)}` : ''}</p>` : ''}
    ${f.estado === 'anulada' ? `<p style="margin:0;color:var(--bad);font-weight:700">FACTURA ANULADA${rel ? ` · rectificada por <a href="#/factura/${rel.id}">${esc(rel.numero)}</a>` : ''}</p>${f.motivo_rectificacion ? `<p class="small" style="margin:0">Motivo: ${esc(f.motivo_rectificacion)}</p>` : ''}` : ''}
    <p class="small muted" style="margin:0">${esc(cfg.pie_factura || '')}</p>
  </article>`;

  el.querySelector('[data-print]').addEventListener('click', () => window.print());
  el.querySelector('#fi-imp')?.addEventListener('change', async (e) => {
    const i = state.impuestos.find((x) => x.id == e.target.value);
    try { ok(await sb.from('facturas').update({ impuesto_nombre: i.nombre, impuesto_pct: i.porcentaje }).eq('id', id)); ok(await sb.rpc('recalcular_factura', { p_factura: id })); toast('Impuesto cambiado'); recargar(); } catch (err) { fail(err); }
  });
  el.querySelector('[data-linea]')?.addEventListener('click', () => modal('Añadir línea', `<div class="form">${field('Concepto', 'concepto', '', 'text', 'maxlength="200"')}${field('Cantidad', 'cantidad', 1, 'number', 'min="0.01" step="0.01"')}${field('Precio (€)', 'precio', '', 'number', 'step="0.01"')}${field('Descuento (%)', 'dto_pct', 0, 'number', 'min="0" max="100" step="0.5"')}</div>`, {
    okText: 'Añadir',
    onOk: async (root) => {
      const o = formData(root); const c = Number(o.cantidad), p = Number(o.precio), d = Number(o.dto_pct) || 0;
      if (!o.concepto || !(c > 0) || Number.isNaN(p)) throw new Error('Rellena concepto, cantidad y precio');
      if (d < 0 || d > 100) throw new Error('El descuento debe estar entre 0 y 100 %');
      ok(await sb.from('factura_lineas').insert({ factura_id: id, tipo: 'otro', concepto: o.concepto, cantidad: c, precio: p, dto_pct: d, importe: Math.round(c * p * (1 - d / 100) * 100) / 100, orden: 3 }));
      ok(await sb.rpc('recalcular_factura', { p_factura: id })); toast('Línea añadida'); recargar();
    },
  }));
  el.querySelectorAll('[data-dto]').forEach((inp) => inp.addEventListener('change', async () => {
    const d = Number(inp.value);
    if (Number.isNaN(d) || d < 0 || d > 100) { toast('El descuento debe estar entre 0 y 100 %'); inp.value = Number(L.find((l) => l.id == inp.dataset.dto)?.dto_pct) || 0; return; }
    inp.disabled = true;
    try { ok(await sb.from('factura_lineas').update({ dto_pct: d }).eq('id', inp.dataset.dto)); ok(await sb.rpc('recalcular_factura', { p_factura: id })); toast('Descuento aplicado'); recargar(); } catch (e) { fail(e); inp.disabled = false; }
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
  el.querySelector('[data-anular]')?.addEventListener('click', () => modal(`Anular la factura ${f.numero}`, `
    <p style="margin:0 0 6px">Se generará una <b>factura rectificativa</b> de <b>${money(-Number(f.total))}</b> que anula esta factura. ${f.reparaciones ? `La orden ${esc(f.reparaciones.numero)} volverá a <b>Pendientes de facturar</b> para hacer la factura correcta.` : ''}</p>
    ${f.estado === 'cobrada' ? '<p class="aviso" style="margin:0">Esta factura ya estaba cobrada: si hay que devolver dinero al cliente, hazlo aparte.</p>' : ''}
    <div class="form"><div class="field full"><label for="an-mot">Motivo de la anulación</label><textarea id="an-mot" name="motivo" maxlength="300" required>Error en la factura</textarea></div></div>`, {
    okText: 'Anular y generar rectificativa',
    onOk: async (root) => {
      const motivo = root.querySelector('#an-mot').value.trim();
      if (!motivo) throw new Error('Escribe el motivo');
      const rid = ok(await sb.rpc('rectificar_factura', { p_factura: id, p_motivo: motivo }));
      toast('Factura anulada y rectificativa generada');
      location.hash = `#/factura/${rid}`;
    },
  }));
}

function cabeceraOrden(o, cols) {
  if (!o) return '';
  const m = o.motos ? [`${o.motos.marca} ${o.motos.modelo}`, o.motos.matricula].filter(Boolean).join(' · ') : '';
  return `<tr class="grupo"><td colspan="${cols}"><b>Orden ${esc(o.numero)}</b>${m ? ` · ${esc(m)}` : ''}${o.fecha_fin ? ` · ${fdate(o.fecha_fin)}` : ''}</td></tr>`;
}

// ---------- Pendientes de facturar: albaranes agrupados por cliente y periodo ----------
const NOMBRE_P = { inmediata: 'En el momento', decenal: 'Cada 10 días', quincenal: 'Cada 15 días', mensual: 'Mensual' };
const mesDe = (dia) => dia.slice(0, 7);
// Plazo legal de una factura recapitulativa a empresas: antes del día 16 del mes siguiente
const plazoMes = (mes) => { const [y, m] = mes.split('-').map(Number); return isoDay(new Date(y, m, 15, 12)); };

// Una sola lista de albaranes con filtros (fechas, cliente, periodicidad, situación).
// Se marca lo que interese y sale una factura por cliente y mes.
async function renderPendientes(T, params) {
  const hoy = today();
  const R = ok(await sb.rpc('por_facturar'));
  const imp = state.impuestos.find((i) => i.por_defecto) || state.impuestos[0];
  const facturable = (r) => r.estado !== 'en_reparacion' && r.dia_fin && r.lineas > 0;
  // ¿Ha terminado el periodo de facturación del cliente para esta orden?
  const toca = (r) => facturable(r) && (r.periodo === 'inmediata' || finPeriodo(r.dia_fin, r.periodo) < hoy);
  const dia = (r) => r.dia_fin || isoDay(r.fecha_entrada);
  const situacion = (r) => {
    if (r.estado === 'en_reparacion') return '<span class="chip">En reparación</span>';
    if (!(r.lineas > 0)) return '<span class="chip">Sin piezas ni horas</span>';
    if (toca(r)) {
      const lim = mesDe(r.dia_fin) < mesDe(hoy) ? plazoMes(mesDe(r.dia_fin)) : null;
      return `<span class="chip warn">Toca facturar</span>${lim ? (hoy > lim ? ` <span class="chip bad">Fuera de plazo (${fdate(lim)})</span>` : ` <span class="small muted">como tarde el ${fdate(lim)}</span>`) : ''}`;
    }
    return `<span class="small muted">Su periodo cierra el ${fdate(finPeriodo(r.dia_fin, r.periodo))}</span>`;
  };
  // Agrupar por cliente
  const porCliente = new Map();
  R.forEach((r) => { if (!porCliente.has(r.cliente_id)) porCliente.set(r.cliente_id, []); porCliente.get(r.cliente_id).push(r); });
  const C = [...porCliente.entries()].map(([id, rs]) => ({ id, nombre: rs[0].cliente, periodo: rs[0].periodo, rs }));

  T.innerHTML = `
  <section class="card filtros-mov" data-fil>
    <div class="form">
      ${field('Desde', 'd1', params.d1 || '', 'date', `max="${hoy}"`)}${field('Hasta', 'd2', params.d2 || '', 'date', `max="${hoy}"`)}
      ${field('Cliente', 'cli', '', 'search', 'placeholder="Nombre del cliente" maxlength="60"')}
      <div class="field"><label for="pf-per">Periodicidad</label><select id="pf-per" name="per">${opt('', 'Todas', '')}${Object.entries(NOMBRE_P).map(([k, t]) => opt(k, t, '')).join('')}</select></div>
      <div class="field"><label for="pf-sit">Situación</label><select id="pf-sit" name="sit">${opt('', 'Todas', '')}${opt('toca', 'Toca facturar', '')}${opt('notoca', 'Aún no toca', '')}</select></div>
    </div>
    <div class="actions"><span class="muted small" data-cuenta></span><button type="button" class="btn sm" data-marcar>Marcar todo lo filtrado</button><button type="button" class="btn sm" data-desmarcar>Desmarcar todo</button><button type="button" class="btn sm" data-limpiar>Quitar filtros</button></div>
  </section>
  <section class="card">
    <p class="muted small" style="margin:0">Órdenes sin factura. Marca las que quieras facturar: sale <b>una factura por cliente y mes</b> con todas sus órdenes marcadas. Vienen marcadas las que ya toca facturar según la periodicidad de cada cliente (ficha › Pagos).</p>
    <div class="tablewrap"><table><thead><tr><th style="width:34px"></th><th>Orden</th><th>Terminada</th><th>Moto</th><th>Situación</th><th class="right">Base</th></tr></thead>
    <tbody>${C.map((c) => `<tr class="grupo-cli" data-c="${c.id}"><td><input type="checkbox" data-cc="${c.id}" aria-label="Marcar todo ${attr(c.nombre)}"></td>
        <td colspan="4"><a href="#/cliente/${c.id}?t=pago"><b>${esc(c.nombre)}</b></a> <span class="small muted">· ${esc(NOMBRE_P[c.periodo] || c.periodo)}</span></td><td class="right num" data-tc></td></tr>
      ${c.rs.map((r) => `<tr data-r="${r.id}" data-cli="${c.id}"><td>${facturable(r) ? `<input type="checkbox" data-o="${r.id}" ${toca(r) ? 'checked' : ''} aria-label="Facturar ${attr(r.numero)}">` : ''}</td>
        <td><a href="#/reparacion/${r.id}">${esc(r.numero)}</a></td><td>${r.dia_fin ? fdate(r.dia_fin) : '—'}</td><td class="small">${esc(r.moto || '')}</td>
        <td>${situacion(r)}${r.estado === 'en_reparacion' && r.lineas > 0 ? ` <a class="btn sm" href="#/reparacion/${r.id}?t=factura">Facturar</a>` : ''}</td><td class="right num">${money(r.base)}</td></tr>`).join('')}`).join('')}
      <tr data-vacio style="display:none"><td colspan="6" class="empty">Nada pendiente con estos filtros</td></tr>
      ${R.length ? '' : '<tr><td colspan="6" class="empty">No hay órdenes pendientes de facturar</td></tr>'}</tbody></table></div>
    <div class="actions" style="align-items:flex-end">
      <div class="field" style="min-width:200px"><label for="pf-imp">Impuesto</label><select id="pf-imp" class="inp">${state.impuestos.filter((i) => i.activo).map((i) => opt(i.id, `${i.nombre} ${Number(i.porcentaje).toLocaleString('es-ES')} %`, imp?.id)).join('')}</select></div>
      <button type="button" class="btn pri" data-gen></button><span class="small muted">La base no incluye el descuento del cliente; se aplica en la factura.</span>
    </div>
  </section>`;

  const F = T.querySelector('[data-fil]');
  const btn = T.querySelector('[data-gen]');
  const filas = [...T.querySelectorAll('tr[data-r]')];
  const cabeceras = [...T.querySelectorAll('tr[data-c]')];
  const porId = Object.fromEntries(R.map((r) => [r.id, r]));
  const visible = (tr) => tr.style.display !== 'none';
  const marcadas = () => filas.filter((tr) => visible(tr) && tr.querySelector('[data-o]')?.checked).map((tr) => porId[tr.dataset.r]);
  const pinta = () => {
    const O = marcadas();
    const n = new Set(O.map((o) => `${o.cliente_id}|${mesDe(o.dia_fin)}`)).size;
    btn.textContent = n ? `Generar ${n} ${n === 1 ? 'factura' : 'facturas'} · ${money(O.reduce((s, o) => s + Number(o.base), 0))}` : 'Marca lo que quieras facturar';
    btn.disabled = !n;
    cabeceras.forEach((h) => {
      const fs = filas.filter((tr) => tr.dataset.cli === h.dataset.c && visible(tr));
      const bs = fs.map((tr) => tr.querySelector('[data-o]')).filter(Boolean);
      const cb = h.querySelector('[data-cc]');
      cb.checked = bs.length > 0 && bs.every((b) => b.checked); cb.indeterminate = bs.some((b) => b.checked) && !cb.checked; cb.disabled = !bs.length;
      h.querySelector('[data-tc]').textContent = money(fs.filter((tr) => tr.querySelector('[data-o]')?.checked).reduce((s, tr) => s + Number(porId[tr.dataset.r].base), 0));
    });
  };
  const aplicar = () => {
    const o = formData(F); const cl = (o.cli || '').toLowerCase();
    let n = 0;
    filas.forEach((tr) => {
      const r = porId[tr.dataset.r], d = dia(r);
      const v = (!o.d1 || d >= o.d1) && (!o.d2 || d <= o.d2) && (!cl || r.cliente.toLowerCase().includes(cl)) && (!o.per || r.periodo === o.per)
        && (!o.sit || (o.sit === 'toca' ? toca(r) : !toca(r)));
      tr.style.display = v ? '' : 'none'; if (v) n++;
    });
    cabeceras.forEach((h) => { h.style.display = filas.some((tr) => tr.dataset.cli === h.dataset.c && visible(tr)) ? '' : 'none'; });
    T.querySelector('[data-vacio]').style.display = n || !R.length ? 'none' : '';
    F.querySelector('[data-cuenta]').textContent = `${n} de ${R.length} órdenes`;
    pinta();
  };
  F.querySelectorAll('input,select').forEach((x) => x.addEventListener('input', aplicar));
  T.querySelectorAll('[data-o]').forEach((b) => b.addEventListener('change', pinta));
  T.querySelectorAll('[data-cc]').forEach((cb) => cb.addEventListener('change', () => {
    filas.filter((tr) => tr.dataset.cli === cb.dataset.cc && visible(tr)).forEach((tr) => { const b = tr.querySelector('[data-o]'); if (b) b.checked = cb.checked; });
    pinta();
  }));
  const marcarTodo = (v) => { filas.filter(visible).forEach((tr) => { const b = tr.querySelector('[data-o]'); if (b) b.checked = v; }); pinta(); };
  F.querySelector('[data-marcar]').addEventListener('click', () => marcarTodo(true));
  F.querySelector('[data-desmarcar]').addEventListener('click', () => marcarTodo(false));
  F.querySelector('[data-limpiar]').addEventListener('click', () => { F.querySelectorAll('input,select').forEach((x) => { x.value = ''; }); aplicar(); });
  aplicar();

  btn.addEventListener('click', () => {
    const O = marcadas();
    const n = new Set(O.map((o) => `${o.cliente_id}|${mesDe(o.dia_fin)}`)).size;
    const clientes = new Set(O.map((o) => o.cliente_id)).size;
    const impSel = state.impuestos.find((i) => i.id == T.querySelector('#pf-imp').value);
    modal('Generar facturas', `<p style="margin:0">Se van a emitir <b>${n} ${n === 1 ? 'factura' : 'facturas'}</b> con fecha de hoy (${fdate(hoy)}) para ${clientes} ${clientes === 1 ? 'cliente' : 'clientes'}, con <b>${O.length} ${O.length === 1 ? 'orden' : 'órdenes'}</b>. Impuesto: ${esc(impSel ? `${impSel.nombre} ${Number(impSel.porcentaje).toLocaleString('es-ES')} %` : '')}.</p>
      <p class="muted small" style="margin:0">Las facturas emitidas no se borran: si hay un error, se anulan con una rectificativa y las órdenes vuelven aquí.</p>`, {
      okText: 'Emitir facturas',
      onOk: async () => {
        const ids = ok(await sb.rpc('facturar_albaranes', { p_reparaciones: O.map((o) => o.id), p_impuesto: Number(T.querySelector('#pf-imp').value) }));
        toast(`${ids.length} ${ids.length === 1 ? 'factura emitida' : 'facturas emitidas'}`);
        location.hash = ids.length === 1 ? `#/factura/${ids[0]}` : '#/facturacion?t=facturas&e=pendiente';
      },
    });
  });
}
