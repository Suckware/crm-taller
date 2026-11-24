import { sb, state, esc, attr, ok, money, fdate, modal, toast, fail, opt, confirmar, formData, field, esAdmin, today, isoDay, PERIODOS, finPeriodo, ultimoCorte } from '../lib.js';
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
    const est = params.e || '';
    let q = sb.from('facturas').select('*,clientes(nombre),reparaciones(numero)').order('created_at', { ascending: false }).limit(200);
    if (est === 'rectificativa') q = q.eq('tipo', 'rectificativa'); else if (est) q = q.eq('estado', est);
    const F = ok(await q);
    T.innerHTML = `<div class="agenda-bar">${[['', 'Todas'], ['pendiente', 'Pendientes'], ['cobrada', 'Cobradas'], ['anulada', 'Anuladas'], ['rectificativa', 'Rectificativas']].map(([k, t]) => `<a class="btn sm ${est === k ? 'pri' : ''}" href="#/facturacion?t=facturas&e=${k}">${t}</a>`).join('')}</div>
    <section class="card"><div class="tablewrap"><table><thead><tr><th>Nº</th><th>Fecha</th><th>Cliente</th><th>Reparación</th><th class="right">Base</th><th class="right">Impuesto</th><th class="right">Total</th><th>Estado</th></tr></thead>
    <tbody>${F.map((f) => `<tr class="click" data-id="${f.id}"><td><b>${esc(f.numero)}</b></td><td>${fdate(f.fecha)}</td><td>${esc(f.clientes?.nombre)}</td><td>${esc(f.reparaciones?.numero || '')}</td><td class="right num">${money(f.base)}</td><td class="right num">${money(f.cuota)} <span class="small muted">${esc(f.impuesto_nombre)} ${Number(f.impuesto_pct)}%</span></td><td class="right num"><b>${money(f.total)}</b></td><td>${chipF(f.estado)}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">Sin facturas</td></tr>'}</tbody></table></div></section>`;
    T.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/factura/${tr.dataset.id}`; }));
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
    sb.from('facturas').select('*,clientes(*),reparaciones(id,numero,km_entrada,motos(marca,modelo,matricula,bastidor))').eq('id', id).single(),
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
  <div class="head no-print"><div class="t"><div class="muted small"><a href="#/facturacion">Facturación</a> › ${esc(f.numero)}</div><h1>${titulo} ${esc(f.numero)}</h1><div>${chipF(f.estado)}</div></div>
    <div class="actions">
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

async function renderPendientes(T, params) {
  const hoy = today();
  const per = Object.hasOwn(NOMBRE_P, params.p) ? params.p : '';
  // Sin fecha elegida: automático, cada cliente hasta el final de su último periodo cerrado
  const manual = /^\d{4}-\d{2}-\d{2}$/.test(params.h || '') ? (params.h <= hoy ? params.h : hoy) : null;
  const corteDe = (periodo) => manual || ultimoCorte(periodo, hoy);
  const R = ok(await sb.rpc('por_facturar')).filter((r) => !per || r.periodo === per);
  const entra = (r) => r.estado !== 'en_reparacion' && r.dia_fin && r.dia_fin <= corteDe(r.periodo) && r.lineas > 0;
  const grupos = new Map();
  R.filter(entra).forEach((r) => {
    if (!grupos.has(r.cliente_id)) grupos.set(r.cliente_id, { id: r.cliente_id, nombre: r.cliente, periodo: r.periodo, ordenes: [] });
    grupos.get(r.cliente_id).ordenes.push(r);
  });
  const G = [...grupos.values()].map((g) => {
    const base = g.ordenes.reduce((s, o) => s + Number(o.base), 0);
    const meses = [...new Set(g.ordenes.map((o) => mesDe(o.dia_fin)))].sort();
    // ¿Ha terminado ya el periodo de alguna de sus órdenes?
    const toca = g.periodo === 'inmediata' || g.ordenes.some((o) => finPeriodo(o.dia_fin, g.periodo) < hoy);
    const proximo = g.ordenes.map((o) => finPeriodo(o.dia_fin, g.periodo)).sort()[0];
    const plazo = meses[0] < mesDe(hoy) ? plazoMes(meses[0]) : null;
    return { ...g, base, meses, toca, proximo, plazo, corte: corteDe(g.periodo) };
  });
  const fuera = R.filter((r) => !entra(r));
  const imp = state.impuestos.find((i) => i.por_defecto) || state.impuestos[0];
  const link = (o) => `#/facturacion?${new URLSearchParams({ t: 'pendientes', ...(o.p ? { p: o.p } : {}), ...(o.h ? { h: o.h } : {}) })}`;
  const estadoG = (g) => {
    const out = [g.toca ? '<span class="chip warn">Toca facturar</span>' : `<span class="chip">Periodo abierto hasta ${fdate(g.proximo)}</span>`];
    if (g.plazo) out.push(hoy > g.plazo ? `<span class="chip bad">Fuera de plazo (límite ${fdate(g.plazo)})</span>` : `<span class="chip info">Facturar como tarde el ${fdate(g.plazo)}</span>`);
    if (g.meses.length > 1) out.push(`<span class="small muted">${g.meses.length} facturas (una por mes)</span>`);
    return out.join(' ');
  };

  T.innerHTML = `
  <div class="agenda-bar">${[['', 'Todos'], ...Object.entries(NOMBRE_P)].map(([k, t]) => `<a class="btn sm ${per === k ? 'pri' : ''}" href="${link({ p: k })}">${esc(t)}</a>`).join('')}</div>
  <section class="card" data-per>
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <div class="field"><label for="pf-h">Facturar hasta el día</label><input id="pf-h" type="date" class="inp" value="${attr(manual || '')}" max="${attr(hoy)}"></div>
      ${manual ? `<a class="btn" href="${link({ p: per })}" style="margin-bottom:2px">Automático</a>` : '<span class="small muted" style="padding-bottom:10px">Automático: cada cliente hasta el último día de su periodo ya terminado.</span>'}
      <div class="field" style="min-width:200px"><label for="pf-imp">Impuesto</label><select id="pf-imp" class="inp">${state.impuestos.filter((i) => i.activo).map((i) => opt(i.id, `${i.nombre} ${Number(i.porcentaje).toLocaleString('es-ES')} %`, imp?.id)).join('')}</select></div>
      ${!manual && per && per !== 'inmediata' ? `<span class="small muted" style="padding-bottom:10px">Último periodo cerrado (${esc(PERIODOS[per])}): hasta el ${fdate(ultimoCorte(per, hoy))}</span>` : ''}
    </div>
    <p class="muted small" style="margin:0">Órdenes terminadas (listas o entregadas) sin factura. Se hace <b>una factura por cliente y mes</b> con todas sus órdenes. La periodicidad de cada cliente se pone en su ficha, pestaña Pagos.</p>
    <div class="tablewrap"><table><thead><tr><th style="width:34px"><input type="checkbox" data-all aria-label="Marcar todos"></th><th>Cliente</th><th>Facturación</th><th>Hasta</th><th>Albaranes</th><th class="right">Base</th><th>Estado</th></tr></thead>
    <tbody>${G.map((g) => `<tr><td><input type="checkbox" data-c="${g.id}" ${g.toca ? 'checked' : ''} aria-label="Facturar a ${attr(g.nombre)}"></td>
      <td><a href="#/cliente/${g.id}?t=pago"><b>${esc(g.nombre)}</b></a></td><td>${esc(NOMBRE_P[g.periodo] || g.periodo)}</td><td>${fdate(g.corte)}</td>
      <td class="small">${g.ordenes.map((o) => `<div><a href="#/reparacion/${o.id}">${esc(o.numero)}</a> · ${fdate(o.dia_fin)}${o.moto ? ` · ${esc(o.moto)}` : ''} · <span class="num">${money(o.base)}</span></div>`).join('')}</td>
      <td class="right num"><b>${money(g.base)}</b></td><td>${estadoG(g)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No hay albaranes pendientes de facturar</td></tr>'}</tbody></table></div>
    ${G.length ? '<div class="actions"><button type="button" class="btn pri" data-gen></button><span class="small muted">La base no incluye el descuento del cliente; se aplica en la factura.</span></div>' : ''}
  </section>
  ${fuera.length ? `<section class="card"><h2>Todavía no toca</h2><p class="muted small" style="margin:0">Órdenes en el taller, de un periodo que aún no ha terminado o sin importe. Se pueden facturar una a una si hace falta.</p>
    <div class="tablewrap"><table><thead><tr><th>Orden</th><th>Cliente</th><th>Moto</th><th>Situación</th><th class="right">Base</th><th></th></tr></thead>
    <tbody>${fuera.map((r) => `<tr><td><a href="#/reparacion/${r.id}">${esc(r.numero)}</a></td><td>${esc(r.cliente)}</td><td>${esc(r.moto || '')}</td>
      <td class="small">${r.estado === 'en_reparacion' ? 'En reparación' : !(r.lineas > 0) ? 'Sin piezas ni horas' : `Terminada el ${fdate(r.dia_fin)} · ${manual ? 'después de la fecha elegida' : `su periodo cierra el ${fdate(finPeriodo(r.dia_fin, r.periodo))}`}`}</td><td class="right num">${money(r.base)}</td>
      <td class="right">${r.lineas > 0 ? `<a class="btn sm" href="#/reparacion/${r.id}?t=factura">Facturar</a>` : ''}</td></tr>`).join('')}</tbody></table></div></section>` : ''}`;

  T.querySelector('#pf-h').addEventListener('change', (e) => { location.hash = link({ p: per, h: e.target.value ? (e.target.value > hoy ? hoy : e.target.value) : '' }); });
  const boxes = [...T.querySelectorAll('[data-c]')];
  const btn = T.querySelector('[data-gen]');
  const elegidos = () => G.filter((g) => boxes.find((b) => b.dataset.c == g.id)?.checked);
  const pinta = () => {
    if (!btn) return;
    const E = elegidos(); const n = E.reduce((s, g) => s + g.meses.length, 0);
    btn.textContent = n ? `Generar ${n} ${n === 1 ? 'factura' : 'facturas'} · ${money(E.reduce((s, g) => s + g.base, 0))}` : 'Marca los clientes a facturar';
    btn.disabled = !n;
  };
  boxes.forEach((b) => b.addEventListener('change', pinta));
  T.querySelector('[data-all]')?.addEventListener('change', (e) => { boxes.forEach((b) => { b.checked = e.target.checked; }); pinta(); });
  pinta();
  btn?.addEventListener('click', () => {
    const E = elegidos(); const n = E.reduce((s, g) => s + g.meses.length, 0);
    const impSel = state.impuestos.find((i) => i.id == T.querySelector('#pf-imp').value);
    modal('Generar facturas del periodo', `<p style="margin:0">Se van a emitir <b>${n} ${n === 1 ? 'factura' : 'facturas'}</b> con fecha de hoy (${fdate(hoy)}) para ${E.length} ${E.length === 1 ? 'cliente' : 'clientes'}, con las órdenes terminadas hasta el ${manual ? `<b>${fdate(manual)}</b>` : 'el final del último periodo cerrado de cada uno'}. Impuesto: ${esc(impSel ? `${impSel.nombre} ${Number(impSel.porcentaje).toLocaleString('es-ES')} %` : '')}.</p>
      <p class="muted small" style="margin:0">Las facturas emitidas no se borran: si hay un error, se anulan con una rectificativa y las órdenes vuelven aquí.</p>`, {
      okText: 'Emitir facturas',
      onOk: async () => {
        // una llamada por fecha de corte (cada una se hace entera o no se hace)
        const porCorte = {}; E.forEach((g) => { (porCorte[g.corte] = porCorte[g.corte] || []).push(g.id); });
        const ids = [];
        for (const [h, cl] of Object.entries(porCorte)) ids.push(...ok(await sb.rpc('facturar_periodo', { p_hasta: h, p_clientes: cl, p_impuesto: Number(T.querySelector('#pf-imp').value) })));
        toast(`${ids.length} ${ids.length === 1 ? 'factura emitida' : 'facturas emitidas'}`);
        location.hash = ids.length === 1 ? `#/factura/${ids[0]}` : '#/facturacion?t=facturas&e=pendiente';
      },
    });
  });
}
