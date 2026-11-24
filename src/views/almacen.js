import { sb, state, esc, attr, ok, money, fdate, fdt, today, modal, toast, fail, formData, req, field, area, opt, esOficina, esAdmin, confirmar } from '../lib.js';
import { I } from '../icons.js';
import { nuevoCliente, cargarVentas, tablaVentas, buscadorPiezas, SEL_PIEZA_BUSCAR } from './comun.js';

export async function render(el, params) {
  const tab = params.t || 'stock';
  const of = esOficina();
  const tabs = [['stock', 'Stock'], ...(of ? [['compras', 'Registrar compra']] : []), ['proveedores', 'Proveedores'], ['movimientos', 'Movimientos']];
  el.innerHTML = `
  <div class="head"><div class="t"><h1>Almacén</h1><div class="muted">Piezas, compras y proveedores</div></div>
    <div class="actions">${of ? `<a class="btn" href="#/almacen?t=compras">Registrar compra</a><button type="button" class="btn pri" data-np>${I.plus} Nueva pieza</button>` : ''}</div></div>
  <nav class="tabs">${tabs.map(([k, t]) => `<a href="#/almacen?t=${k}" class="${k === tab ? 'on' : ''}">${esc(t)}</a>`).join('')}</nav>
  <div data-tab><p class="muted">Cargando…</p></div>`;
  const T = el.querySelector('[data-tab]');
  const provs = ok(await sb.from('proveedores').select('*').order('nombre'));
  el.querySelector('[data-np]')?.addEventListener('click', () => editarPieza(null, provs, () => render(el, { ...params, t: 'stock' })));
  const recargar = () => render(el, params);

  if (tab === 'stock') {
    const P = ok(await sb.from('piezas').select('*,proveedores(nombre)').order('nombre'));
    const bajo = P.filter((p) => p.stock <= p.stock_minimo).length;
    const valor = P.reduce((s, p) => s + p.stock * p.precio_compra, 0);
    const cats = [...new Set(P.map((p) => p.categoria).filter(Boolean))].sort();
    T.innerHTML = `
    <div class="kpis"><div class="kpi"><span class="l">Referencias</span><span class="v">${P.length}</span></div>
      <div class="kpi"><span class="l">Stock bajo</span><span class="v" style="color:${bajo ? 'var(--bad)' : 'inherit'}">${bajo}</span></div>
      ${of ? `<div class="kpi"><span class="l">Valor del stock (a coste)</span><span class="v">${money(valor)}</span></div>` : ''}</div>
    <div class="agenda-bar"><input type="search" class="search" data-q placeholder="Buscar por nombre, referencia, marca o código de barras…" value="${attr(params.q || '')}" aria-label="Buscar pieza">
      <select class="inp" data-cat style="width:auto;min-height:44px" aria-label="Categoría">${opt('', 'Todas las categorías', '')}${cats.map((c) => opt(c, c, '')).join('')}</select>
      <label class="check" style="align-items:center"><input type="checkbox" data-bajo> Solo stock bajo</label></div>
    <section class="card"><div class="tablewrap"><table>
      <thead><tr><th>Ref.</th><th>Pieza</th><th class="right">Stock</th><th class="right">PVP</th>${of ? '<th class="right hide-movil">Compra</th><th class="right hide-movil">Margen</th>' : ''}<th class="hide-movil">Última compra</th><th class="hide-movil">Proveedor</th><th class="hide-movil">Ubicación</th></tr></thead>
      <tbody>${P.map((p) => `<tr class="click" data-id="${p.id}" data-txt="${attr(`${p.referencia} ${p.nombre} ${p.marca || ''} ${p.codigo_barras || ''}`.toLowerCase())}" data-cat="${attr(p.categoria || '')}" data-bajo="${p.stock <= p.stock_minimo ? 1 : 0}">
        <td class="small">${esc(p.referencia)}</td><td><b>${esc(p.nombre)}</b><div class="small muted">${esc([p.marca, p.categoria].filter(Boolean).join(' · '))}</div></td>
        <td class="right num"><b style="color:${p.stock <= p.stock_minimo ? 'var(--bad)' : 'inherit'}">${p.stock}</b><div class="small muted">mín. ${p.stock_minimo}</div></td>
        <td class="right num">${money(p.pvp)}</td>${of ? `<td class="right num hide-movil">${money(p.precio_compra)}</td><td class="right num hide-movil">${margenHtml(p)}</td>` : ''}
        <td class="hide-movil">${fdate(p.fecha_compra)}</td><td class="hide-movil">${esc(p.proveedores?.nombre || '')}</td><td class="hide-movil">${esc(p.ubicacion || '')}</td></tr>`).join('')}</tbody>
    </table></div></section>`;
    const filtrar = () => {
      const s = T.querySelector('[data-q]').value.toLowerCase().trim(); const c = T.querySelector('[data-cat]').value; const b = T.querySelector('[data-bajo]').checked;
      T.querySelectorAll('tr[data-id]').forEach((tr) => { tr.style.display = (!s || tr.dataset.txt.includes(s)) && (!c || tr.dataset.cat === c) && (!b || tr.dataset.bajo === '1') ? '' : 'none'; });
    };
    T.querySelectorAll('[data-q],[data-cat],[data-bajo]').forEach((x) => x.addEventListener('input', filtrar));
    T.querySelector('[data-q]').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const v = e.target.value.trim().toUpperCase();
      const p = v && P.find((x) => (x.codigo_barras || '').toUpperCase() === v || x.referencia === v);
      if (p) location.hash = `#/pieza/${p.id}`;
    });
    filtrar();
    T.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/pieza/${tr.dataset.id}`; }));
  }

  if (tab === 'compras' && of) {
    // Pensado para muchas piezas: se busca la pieza (o se pasa el lector) y se registra.
    // Proveedor, fecha y albarán se mantienen para ir metiendo todas las líneas del mismo albarán.
    T.innerHTML = `<section class="card" style="max-width:860px"><h2>Registrar compra a proveedor</h2>
      <p class="muted small" style="margin:0">Suma el stock y guarda precio de compra, fecha y proveedor en la pieza. Proveedor, fecha y albarán se quedan puestos para la siguiente pieza.</p>
      <div class="form" data-cab>
        <div class="field"><label for="c-prov">Proveedor</label><select id="c-prov" name="proveedor">${opt('', '—', '')}${provs.map((v) => opt(v.id, v.nombre, '')).join('')}</select></div>
        ${field('Fecha de compra', 'fecha', today(), 'date', `max="${today()}"`)}
        ${field('Nº de albarán / nota', 'nota', '', 'text', 'maxlength="120"')}
      </div>
      <div data-buscador></div>
      <div data-elegida></div></section>
      <section class="card" style="max-width:860px" data-hechas hidden><h2>Entradas registradas ahora</h2><div class="list" data-lista></div></section>`;
    const cab = T.querySelector('[data-cab]'), E = T.querySelector('[data-elegida]');
    const hechas = T.querySelector('[data-hechas]'), lista = T.querySelector('[data-lista]');
    const elegir = (p) => {
      if (!p) { E.innerHTML = ''; return; }
      if (p.proveedor_id && !cab.querySelector('#c-prov').value) cab.querySelector('#c-prov').value = p.proveedor_id;
      E.innerHTML = `<div class="pieza-elegida"><span class="grow"><b>${esc(p.nombre)}</b><span class="muted small">${esc(p.referencia)}${p.codigo_barras ? ' · ' + esc(p.codigo_barras) : ''} · stock ${p.stock}</span></span></div>
        <div class="form" data-f>
          ${field('Cantidad', 'cantidad', 1, 'number', 'min="1" max="10000" inputmode="numeric"')}
          ${field('Precio de compra por unidad (€)', 'precio', p.precio_compra, 'number', 'min="0" step="0.01" inputmode="decimal"')}
        </div>
        <div class="actions"><button type="button" class="btn pri" data-g>Registrar entrada</button><button type="button" class="btn" data-x>Cambiar pieza</button></div>`;
      const cant = E.querySelector('[name=cantidad]'); cant.focus(); cant.select();
      E.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); E.querySelector('[data-g]').click(); } }));
      E.querySelector('[data-x]').addEventListener('click', () => { elegir(null); B.limpiar(); });
      E.querySelector('[data-g]').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        try {
          const o = { ...formData(cab), ...formData(E.querySelector('[data-f]')) };
          const n = Math.floor(Number(o.cantidad));
          if (!(n > 0)) throw new Error('Cantidad no válida');
          if (o.precio !== null && Number(o.precio) < 0) throw new Error('El precio no puede ser negativo');
          btn.disabled = true;
          ok(await sb.rpc('registrar_compra', { p_pieza: p.id, p_cantidad: n, p_precio: o.precio === null ? null : Number(o.precio), p_proveedor: o.proveedor ? Number(o.proveedor) : null, p_fecha: o.fecha || today(), p_nota: o.nota ? `Albarán ${o.nota}` : null }));
          toast(`${p.nombre}: +${n} en stock`);
          hechas.hidden = false;
          lista.insertAdjacentHTML('afterbegin', `<div><span class="grow"><a href="#/pieza/${p.id}"><b>${esc(p.nombre)}</b></a><span class="muted small">${esc(p.referencia)} · stock ${p.stock} → ${p.stock + n}</span></span><b class="num">+${n}${o.precio !== null ? ' × ' + money(Number(o.precio)) : ''}</b></div>`);
          elegir(null); B.limpiar();
        } catch (err) { fail(err); btn.disabled = false; }
      });
    };
    const B = buscadorPiezas(T.querySelector('[data-buscador]'), { onPick: (p) => { B.ocultar(); elegir(p); } });
    if (params.p) { const p0 = (await sb.from('piezas').select(SEL_PIEZA_BUSCAR).eq('id', Number(params.p)).maybeSingle()).data; if (p0) elegir(p0); }
  }

  if (tab === 'proveedores') {
    const V = ok(await sb.from('clientes').select('id,nombre,nombre_comercial,telefono,email,nif,forma_pago,plazo_pago_dias,dias_pago,es_cliente,contactos(nombre,cargo,principal)').eq('es_proveedor', true).order('nombre'));
    T.innerHTML = `<section class="card"><div class="head"><h2>Proveedores</h2>${of ? `<button type="button" class="btn pri" data-nv>${I.plus} Nuevo proveedor</button>` : ''}</div>
      <p class="muted small" style="margin:0">Los proveedores comparten ficha con los clientes: una misma empresa puede ser las dos cosas.</p>
      <div class="tablewrap"><table><thead><tr><th>Proveedor</th><th>Contacto</th><th>Teléfono</th><th class="hide-movil">Pago</th><th class="hide-movil">CIF</th></tr></thead>
      <tbody>${V.map((v) => { const k = v.contactos.find((x) => x.principal) || v.contactos[0]; return `<tr class="click" data-id="${v.id}"><td><b>${esc(v.nombre)}</b>${v.es_cliente ? ' <span class="chip info">También cliente</span>' : ''}</td><td>${k ? esc(k.nombre) + (k.cargo ? `<div class="small muted">${esc(k.cargo)}</div>` : '') : ''}</td><td><a href="tel:${attr(v.telefono || '')}">${esc(v.telefono || '')}</a></td><td class="hide-movil small">${esc([v.forma_pago, v.plazo_pago_dias != null ? v.plazo_pago_dias + ' días' : '', v.dias_pago].filter(Boolean).join(' · '))}</td><td class="hide-movil">${esc(v.nif || '')}</td></tr>`; }).join('') || '<tr><td colspan="5" class="empty">Sin proveedores</td></tr>'}</tbody></table></div></section>`;
    T.querySelector('[data-nv]')?.addEventListener('click', () => nuevoCliente('', (c) => { location.hash = `#/cliente/${c.id}`; }, { proveedor: true }));
    T.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a')) location.hash = `#/cliente/${tr.dataset.id}?t=datos`; }));
  }

  if (tab === 'movimientos') {
    // Las fechas se filtran en la base de datos (por defecto, los últimos 90 días); el resto, al momento en pantalla
    const hace90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const desde = /^\d{4}-\d{2}-\d{2}$/.test(params.d1 || '') ? params.d1 : hace90;
    const hasta = /^\d{4}-\d{2}-\d{2}$/.test(params.d2 || '') ? params.d2 : today();
    const M = ok(await sb.from('movimientos_stock').select(SEL_MOV)
      .gte('fecha', new Date(desde + 'T00:00:00').toISOString()).lte('fecha', new Date(hasta + 'T23:59:59.999').toISOString())
      .order('fecha', { ascending: false }).limit(2000));
    tablaMovimientos(T, M, { desde, hasta, provs, params });
  }
}

const SEL_MOV = '*,piezas(referencia,nombre),proveedores(nombre),reparaciones(id,numero,clientes(nombre))';
const TIPO_MOV = { entrada: ['Entrada', 'ok'], salida: ['Salida', 'info'], devolucion: ['Devolución', 'warn'], ajuste: ['Ajuste', ''] };

// Tabla de movimientos. Con "f" muestra la barra de filtros (fechas, tipo, proveedor, pieza, cliente y documento).
function tablaMovimientos(T, M, f) {
  const txt = (m) => ({
    pieza: `${m.piezas?.referencia || ''} ${m.piezas?.nombre || ''}`.toLowerCase(),
    cliente: (m.reparaciones?.clientes?.nombre || '').toLowerCase(),
    doc: `${m.reparaciones?.numero || ''} ${m.nota || ''}`.toLowerCase(),
  });
  T.innerHTML = `${f ? `<section class="card filtros-mov" data-fil>
      <div class="form">
        ${field('Desde', 'd1', f.desde, 'date', `max="${today()}"`)}${field('Hasta', 'd2', f.hasta, 'date')}
        <div class="field"><label for="m-tipo">Tipo</label><select id="m-tipo" name="tipo">${opt('', 'Todos', '')}${Object.entries(TIPO_MOV).map(([k, [t]]) => opt(k, t, '')).join('')}</select></div>
        <div class="field"><label for="m-prov">Proveedor</label><select id="m-prov" name="prov">${opt('', 'Todos', '')}${f.provs.map((v) => opt(v.id, v.nombre, '')).join('')}</select></div>
        ${field('Pieza', 'pieza', f.params.pz || '', 'search', 'placeholder="Nombre o referencia" maxlength="60"')}
        ${field('Cliente', 'cliente', '', 'search', 'placeholder="Nombre del cliente" maxlength="60"')}
        ${field('Documento', 'doc', '', 'search', 'placeholder="Nº de orden o albarán" maxlength="60"')}
      </div>
      <div class="actions"><span class="muted small" data-cuenta></span><button type="button" class="btn sm" data-limpiar>Quitar filtros</button></div></section>` : ''}
    <section class="card"><div class="tablewrap"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Pieza</th><th class="right">Cant.</th><th class="hide-movil">Cliente / proveedor</th><th class="hide-movil">Documento</th></tr></thead>
      <tbody>${M.map((m, i) => `<tr data-i="${i}"><td class="small">${fdt(m.fecha)}</td><td><span class="chip ${TIPO_MOV[m.tipo][1]}">${TIPO_MOV[m.tipo][0]}</span></td><td><a href="#/pieza/${m.pieza_id}">${esc(m.piezas?.nombre)}</a><div class="small muted">${esc(m.piezas?.referencia)}</div></td>
        <td class="right num"><b>${m.tipo === 'salida' ? '−' : '+'}${m.cantidad}</b></td>
        <td class="hide-movil small">${esc(m.reparaciones?.clientes?.nombre || m.proveedores?.nombre || '')}</td>
        <td class="hide-movil small">${m.reparaciones ? `<a href="#/reparacion/${m.reparaciones.id}">${esc(m.reparaciones.numero)}</a>` : ''}${m.reparaciones && m.nota ? ' · ' : ''}${esc(m.nota || '')}</td></tr>`).join('')}
        <tr data-vacio style="display:none"><td colspan="6" class="empty">Sin movimientos${f ? ' con estos filtros' : ''}</td></tr></tbody></table></div></section>`;
  const filas = [...T.querySelectorAll('tr[data-i]')];
  const vacio = T.querySelector('[data-vacio]');
  if (!f) { vacio.style.display = M.length ? 'none' : ''; return; }
  const F = T.querySelector('[data-fil]');
  const X = M.map(txt);
  const aplicar = () => {
    const o = formData(F);
    const pz = (o.pieza || '').toLowerCase(), cl = (o.cliente || '').toLowerCase(), dc = (o.doc || '').toLowerCase();
    let n = 0;
    filas.forEach((tr) => {
      const m = M[tr.dataset.i], x = X[tr.dataset.i];
      const v = (!o.tipo || m.tipo === o.tipo) && (!o.prov || String(m.proveedor_id) === String(o.prov)) && (!pz || x.pieza.includes(pz)) && (!cl || x.cliente.includes(cl)) && (!dc || x.doc.includes(dc));
      tr.style.display = v ? '' : 'none'; if (v) n++;
    });
    vacio.style.display = n ? 'none' : '';
    F.querySelector('[data-cuenta]').textContent = `${n} de ${M.length} movimientos${M.length >= 2000 ? ' (se muestran los 2.000 más recientes: acorta las fechas)' : ''}`;
  };
  F.querySelectorAll('[name=tipo],[name=prov],[name=pieza],[name=cliente],[name=doc]').forEach((x) => x.addEventListener('input', aplicar));
  F.querySelectorAll('[name=d1],[name=d2]').forEach((x) => x.addEventListener('change', () => {
    const d1 = F.querySelector('[name=d1]').value, d2 = F.querySelector('[name=d2]').value;
    if (d1 && d2 && d1 <= d2) location.hash = `#/almacen?${new URLSearchParams({ t: 'movimientos', d1, d2 })}`;
  }));
  F.querySelector('[data-limpiar]').addEventListener('click', () => { location.hash = '#/almacen?t=movimientos&r=' + Date.now(); });
  aplicar();
}

// Margen sobre el precio de compra, en % y en euros
export const margen = (p) => (Number(p.precio_compra) > 0 ? { pct: ((p.pvp - p.precio_compra) / p.precio_compra) * 100, eur: p.pvp - p.precio_compra } : null);
function margenHtml(p) {
  const m = margen(p);
  if (!m) return '—';
  return `<b style="color:${m.pct < 0 ? 'var(--bad)' : m.pct < 15 ? '#8A5A00' : 'var(--ok)'}">${m.pct.toFixed(0)} %</b><div class="small muted">${money(m.eur)}</div>`;
}

// ---------- Ficha de la pieza: Datos · Histórico de ventas · Movimientos ----------
export async function renderFicha(el, params) {
  const id = Number(params.id);
  const of = esOficina();
  const [pq, vq] = await Promise.all([sb.from('piezas').select('*,proveedores(nombre)').eq('id', id).single(), sb.from('proveedores').select('*').order('nombre')]);
  const p = ok(pq), provs = ok(vq);
  const tabs = [['datos', 'Datos'], ['ventas', 'Histórico de ventas'], ['movimientos', 'Movimientos']];
  const tab = tabs.some(([k]) => k === params.t) ? params.t : 'datos';
  const bajo = p.stock <= p.stock_minimo;
  // "Volver" lleva a la pantalla desde la que se abrió la ficha (no a la pestaña anterior de la ficha)
  if (state.anterior && !state.anterior.startsWith(`#/pieza/${id}`)) state.volverPieza = { id, a: state.anterior };
  const volver = state.volverPieza?.id === id ? state.volverPieza.a : '#/almacen';
  const mg = margen(p);
  el.innerHTML = `
  <div class="head"><div class="t"><div class="muted small"><a href="#/almacen">Almacén</a> › pieza</div><h1>${esc(p.nombre)}</h1>
    <div class="muted" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span class="chip">${esc(p.referencia)}</span>${p.marca ? `<span>${esc(p.marca)}</span>` : ''}${p.categoria ? `<span class="chip info">${esc(p.categoria)}</span>` : ''}<span class="chip ${bajo ? 'bad' : 'ok'}">Stock ${p.stock}</span>${of && mg ? `<span class="chip ${mg.pct < 0 ? 'bad' : mg.pct < 15 ? 'warn' : 'ok'}">Margen ${mg.pct.toFixed(0)} % · ${money(mg.eur)}</span>` : ''}</div></div>
    <div class="actions"><a class="btn" href="${attr(volver)}" data-volver>← Volver</a>${of ? `<a class="btn" href="#/almacen?t=compras&p=${id}">Registrar compra</a><button type="button" class="btn pri" data-ed>Editar pieza</button>` : ''}</div></div>
  <nav class="tabs">${tabs.map(([k, t]) => `<a href="#/pieza/${id}?t=${k}" class="${k === tab ? 'on' : ''}">${esc(t)}</a>`).join('')}</nav>
  <div data-tab><p class="muted">Cargando…</p></div>`;
  const T = el.querySelector('[data-tab]');
  const recargar = () => renderFicha(el, params);
  el.querySelector('[data-ed]')?.addEventListener('click', () => editarPieza(p, provs, recargar, () => { location.hash = '#/almacen'; }));

  if (tab === 'datos') {
    const fila = (l, v) => `<div class="field"><span class="lbl">${esc(l)}</span><b style="padding:6px 0">${v}</b></div>`;
    T.innerHTML = `<section class="card"><div class="form">
      ${fila('Referencia', esc(p.referencia))}${fila('Nombre', esc(p.nombre))}${fila('Marca', esc(p.marca || '—'))}${fila('Categoría', esc(p.categoria || '—'))}
      ${fila('Código de barras', esc(p.codigo_barras || '—'))}${fila('PVP', money(p.pvp))}${of ? fila('Precio de compra', money(p.precio_compra)) + fila('Margen', mg ? `${mg.pct.toFixed(0)} % · ${money(mg.eur)} por unidad` : '—') : ''}
      ${fila('Stock', `<span style="color:${bajo ? 'var(--bad)' : 'inherit'}">${p.stock}</span> <span class="muted small">(mín. ${p.stock_minimo})</span>`)}
      ${fila('Última compra', fdate(p.fecha_compra) || '—')}${fila('Proveedor', esc(p.proveedores?.nombre || '—'))}${fila('Ubicación', esc(p.ubicacion || '—'))}
    </div></section>`;
  }
  if (tab === 'ventas') tablaVentas(T, await cargarVentas({ pieza: id }), { porPieza: true });
  if (tab === 'movimientos') tablaMovimientos(T, ok(await sb.from('movimientos_stock').select(SEL_MOV).eq('pieza_id', id).order('fecha', { ascending: false }).limit(500)));
}

function editarPieza(p, provs, recargar, trasBorrar) {
  p = p || {};
  const m = modal(p.id ? 'Editar pieza' : 'Nueva pieza', `<div class="form">
    ${field('Referencia *', 'referencia', p.referencia, 'text', 'maxlength="40" required')}
    ${field('Nombre *', 'nombre', p.nombre, 'text', 'maxlength="120" required')}
    ${field('Código de barras', 'codigo_barras', p.codigo_barras, 'text', 'maxlength="40" autocomplete="off" placeholder="Pasa el lector o escríbelo"')}
    ${field('Marca', 'marca', p.marca, 'text', 'maxlength="40"')}
    ${field('Categoría', 'categoria', p.categoria, 'text', 'maxlength="40" list="cats"')}
    ${field('PVP (€) *', 'pvp', p.pvp, 'number', 'min="0" step="0.01" required')}
    ${field('Precio de compra (€) *', 'precio_compra', p.precio_compra, 'number', 'min="0" step="0.01" required')}
    ${field('Fecha de compra', 'fecha_compra', p.fecha_compra, 'date')}
    <div class="field"><label for="f-prov">Proveedor</label><select id="f-prov" name="proveedor_id">${opt('', '—', p.proveedor_id ?? '')}${provs.map((v) => opt(v.id, v.nombre, p.proveedor_id)).join('')}</select></div>
    ${p.id ? `<div class="field"><span class="lbl">Stock actual</span><b style="padding:10px 0">${p.stock}</b></div>` : field('Stock inicial', 'stock', 0, 'number', 'min="0"')}
    ${field('Stock mínimo', 'stock_minimo', p.stock_minimo ?? 1, 'number', 'min="0"')}
    ${field('Ubicación', 'ubicacion', p.ubicacion, 'text', 'maxlength="40" placeholder="Ej.: Estantería A-3"')}
    <datalist id="cats">${['Frenos', 'Transmisión', 'Motor', 'Filtros', 'Aceites', 'Neumáticos', 'Electricidad', 'Suspensión', 'Carrocería', 'Competición'].map((c) => `<option value="${c}">`).join('')}</datalist>
    <p class="muted small full" style="margin:0" data-mg></p>
  </div>${p.id && esAdmin() ? '<button type="button" class="btn danger sm" data-del style="align-self:flex-start">Eliminar pieza</button>' : ''}`, {
    onOk: async (root) => {
      const o = formData(root);
      req(o, [['referencia', 'referencia'], ['nombre', 'nombre'], ['pvp', 'PVP'], ['precio_compra', 'precio de compra']]);
      const d = { referencia: o.referencia.toUpperCase(), codigo_barras: o.codigo_barras || null, nombre: o.nombre, marca: o.marca, categoria: o.categoria, pvp: Number(o.pvp), precio_compra: Number(o.precio_compra), fecha_compra: o.fecha_compra, proveedor_id: o.proveedor_id ? Number(o.proveedor_id) : null, stock_minimo: Number(o.stock_minimo) || 0, ubicacion: o.ubicacion };
      if (d.pvp < 0 || d.precio_compra < 0) throw new Error('Los precios no pueden ser negativos');
      const dup = (e) => { if (/duplicate|unique/i.test(e.message)) throw new Error(/codigo_barras/.test(e.message) ? 'Ese código de barras ya lo tiene otra pieza' : 'Esa referencia ya existe en el almacén'); throw e; };
      if (p.id) { try { ok(await sb.from('piezas').update(d).eq('id', p.id)); } catch (e) { dup(e); } }
      else {
        const stock = Math.max(0, Math.floor(Number(o.stock) || 0));
        let n; try { n = ok(await sb.from('piezas').insert({ ...d, stock: 0 }).select('id').single()); } catch (e) { dup(e); }
        if (stock > 0) ok(await sb.rpc('registrar_compra', { p_pieza: n.id, p_cantidad: stock, p_precio: d.precio_compra, p_proveedor: d.proveedor_id, p_fecha: d.fecha_compra || today(), p_nota: 'Stock inicial' }));
      }
      toast('Pieza guardada'); recargar();
    },
  });
  // Margen al momento mientras se cambian los precios
  const pintaMg = () => { const v = margen({ pvp: Number(m.querySelector('[name=pvp]').value), precio_compra: Number(m.querySelector('[name=precio_compra]').value) }); m.querySelector('[data-mg]').textContent = v ? `Margen: ${v.pct.toFixed(0)} % (${money(v.eur)} por unidad)` : ''; };
  m.querySelectorAll('[name=pvp],[name=precio_compra]').forEach((x) => x.addEventListener('input', pintaMg)); pintaMg();
  m.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!(await confirmar('¿Eliminar esta pieza del almacén?', 'Eliminar'))) return;
    try { ok(await sb.from('piezas').delete().eq('id', p.id)); m.remove(); toast('Pieza eliminada'); (trasBorrar || recargar)(); } catch (e) { fail(/foreign/.test(e.message) ? new Error('Se ha usado en reparaciones: no se puede eliminar') : e); }
  });
}
