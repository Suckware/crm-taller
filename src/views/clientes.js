import { sb, state, esc, attr, ok, fdate, ftime, money, chip, ESTADOS_REP, ESTADOS_CITA, modal, toast, fail, formData, field, area, opt, puedeFacturar, esAdmin, esOficina, confirmar, PERIODOS } from '../lib.js';
import { formCliente, validarCliente, nuevoCliente, editarVehiculo, alertasVehiculo, cargarVentas, tablaVentas } from './comun.js';
import { I } from '../icons.js';
import { ibanValido } from '../sepa.js';

const rolChips = (c) => `${c.es_cliente ? '<span class="chip info">Cliente</span> ' : ''}${c.es_proveedor ? '<span class="chip warn">Proveedor</span>' : ''}`;

export async function renderLista(el, params) {
  const s = (params.q || '').replace(/[%,()*]/g, ' ').trim();
  const rol = params.r || '';
  let q = sb.from('clientes').select('id,nombre,nombre_comercial,telefono,email,es_cliente,es_proveedor,tipo,notas_agenda,motos(marca,modelo,matricula)').order('nombre').limit(300);
  if (s) q = q.or(`nombre.ilike.%${s}%,nombre_comercial.ilike.%${s}%,telefono.ilike.%${s}%,email.ilike.%${s}%,nif.ilike.%${s}%`);
  if (rol === 'c') q = q.eq('es_cliente', true);
  if (rol === 'p') q = q.eq('es_proveedor', true);
  const C = ok(await q);
  const link = (r) => `#/clientes?${new URLSearchParams({ ...(s ? { q: s } : {}), ...(r ? { r } : {}) })}`;
  el.innerHTML = `
  <div class="head"><div class="t"><h1>Clientes y proveedores</h1><div class="muted">${C.length} fichas</div></div>
    <div class="actions">${esOficina() ? `<button type="button" class="btn" data-nprov>${I.plus} Proveedor</button>` : ''}<button type="button" class="btn pri" data-nuevo>${I.plus} Cliente</button></div></div>
  <nav class="tabs">${[['', 'Todos'], ['c', 'Clientes'], ['p', 'Proveedores']].map(([k, t]) => `<a href="${link(k)}" class="${rol === k ? 'on' : ''}">${t}</a>`).join('')}</nav>
  <form data-buscar><input type="search" class="search" name="q" value="${attr(s)}" placeholder="Buscar por nombre, teléfono, email o NIF…" aria-label="Buscar" maxlength="60"></form>
  <section class="card"><div class="tablewrap"><table>
    <thead><tr><th>Nombre</th><th>Rol</th><th>Teléfono</th><th class="hide-movil">Email</th><th class="hide-movil">Vehículos</th></tr></thead>
    <tbody>${C.map((c) => `<tr class="click" data-id="${c.id}"><td><b>${esc(c.nombre)}</b>${c.nombre_comercial ? `<div class="small muted">${esc(c.nombre_comercial)}</div>` : ''}${c.notas_agenda ? '<div class="small" style="color:#6B4A00">Tiene notas</div>' : ''}</td><td>${rolChips(c)}</td>
      <td><a href="tel:${attr(c.telefono || '')}">${esc(c.telefono || '')}</a></td><td class="hide-movil">${esc(c.email || '')}</td>
      <td class="small hide-movil">${c.motos.map((m) => esc(`${m.marca} ${m.modelo} (${m.matricula || '—'})`)).join('<br>')}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sin resultados</td></tr>'}</tbody>
  </table></div></section>`;
  el.querySelector('[data-buscar]').addEventListener('submit', (e) => { e.preventDefault(); location.hash = '#/clientes?' + new URLSearchParams({ q: e.target.q.value.trim(), ...(rol ? { r: rol } : {}) }); });
  el.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a')) location.hash = `#/cliente/${tr.dataset.id}`; }));
  el.querySelector('[data-nuevo]').addEventListener('click', () => nuevoCliente('', (c) => { location.hash = `#/cliente/${c.id}`; }));
  el.querySelector('[data-nprov]')?.addEventListener('click', () => nuevoCliente('', (c) => { location.hash = `#/cliente/${c.id}`; }, { proveedor: true }));
}

export async function renderFicha(el, params) {
  const id = Number(params.id);
  const [cq, mq, kq] = await Promise.all([
    sb.from('clientes').select('*').eq('id', id).single(),
    sb.from('motos').select('*').eq('cliente_id', id).order('id'),
    sb.from('contactos').select('*').eq('cliente_id', id).order('principal', { ascending: false }).order('id'),
  ]);
  const c = ok(cq), M = ok(mq), K = ok(kq);
  const tabs = [['datos', 'Datos'], ['contactos', `Contactos (${K.length})`], ['pago', esAdmin() ? 'Pagos y banco' : 'Pagos']];
  if (c.es_cliente) tabs.push(['vehiculos', `Vehículos (${M.length})`], ['historial', 'Reparaciones'], ['piezas', 'Piezas compradas'], ['citas', 'Citas']);
  if (c.es_proveedor) tabs.push(['compras', 'Compras']);
  if (c.es_cliente && puedeFacturar()) tabs.push(['facturas', 'Facturas']);
  const tab = tabs.some(([k]) => k === params.t) ? params.t : 'datos';
  const tarifa = state.tarifas.find((t) => t.id === c.tarifa_id);
  el.innerHTML = `
  <div class="head"><div class="t"><div class="muted small"><a href="#/clientes">Clientes y proveedores</a> › ficha</div><h1>${esc(c.nombre)}</h1>
    <div class="muted" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${rolChips(c)}${c.telefono ? `<a href="tel:${attr(c.telefono)}">${esc(c.telefono)}</a>` : ''}${c.email ? `<a href="mailto:${attr(c.email)}">${esc(c.email)}</a>` : ''}${tarifa ? `<span class="chip">Tarifa ${esc(tarifa.nombre)}</span>` : ''}${Number(c.descuento_pct) ? `<span class="chip ok">Dto. ${Number(c.descuento_pct)} %</span>` : ''}</div></div>
    ${c.es_cliente ? `<div class="actions"><a class="btn" href="#/cita/nueva?cliente=${id}">${I.agenda} Nueva cita</a><a class="btn pri" href="#/recepcion?cliente=${id}">Recibir moto</a></div>` : ''}</div>
  ${c.notas_agenda ? `<div class="aviso"><b>Nota del cliente</b><span>${esc(c.notas_agenda)}</span></div>` : ''}
  <nav class="tabs">${tabs.map(([k, t]) => `<a href="#/cliente/${id}?t=${k}" class="${k === tab ? 'on' : ''}">${esc(t)}</a>`).join('')}</nav>
  <div data-tab></div>`;
  const T = el.querySelector('[data-tab]');
  const recargar = () => renderFicha(el, params);

  if (tab === 'datos') {
    T.innerHTML = `<section class="card" data-f>${formCliente(c)}<div class="actions"><button type="button" class="btn pri" data-g>Guardar cambios</button>${esAdmin() ? '<button type="button" class="btn danger" data-del>Eliminar ficha</button>' : ''}</div><p class="muted small" style="margin:0">Alta: ${fdate(c.created_at)}</p></section>`;
    T.querySelector('[data-g]').addEventListener('click', async () => {
      try { const o = validarCliente(formData(T.querySelector('[data-f]')), c); ok(await sb.from('clientes').update(o).eq('id', id)); toast('Ficha guardada'); recargar(); } catch (e) { fail(e); }
    });
    T.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!(await confirmar(`¿Eliminar la ficha de ${c.nombre}, sus contactos y vehículos? No se puede deshacer.`, 'Eliminar'))) return;
      try { ok(await sb.from('clientes').delete().eq('id', id)); toast('Ficha eliminada'); location.hash = '#/clientes'; } catch (e) { fail(/foreign/.test(e.message) ? new Error('Tiene reparaciones o facturas: no se puede eliminar') : e); }
    });
  }

  if (tab === 'contactos') {
    T.innerHTML = `<section class="card"><div class="head"><h2>Personas de contacto</h2><button type="button" class="btn pri" data-n>${I.plus} Añadir contacto</button></div>
      <div class="grid-cards">${K.map((k) => `<div class="contacto"><div class="row1"><b>${esc(k.nombre)}</b>${k.principal ? '<span class="chip ok">Principal</span>' : ''}</div>
        ${k.cargo ? `<div class="muted small">${esc(k.cargo)}</div>` : ''}
        ${k.telefonos.map((t) => `<a href="tel:${attr(t)}">${esc(t)}</a>`).join('')}
        ${k.emails.map((m) => `<a href="mailto:${attr(m)}">${esc(m)}</a>`).join('')}
        ${k.notas ? `<div class="small muted">${esc(k.notas)}</div>` : ''}
        <div class="actions"><button type="button" class="btn sm" data-e="${k.id}">Editar</button><button type="button" class="btn sm danger" data-d="${k.id}">Quitar</button></div></div>`).join('') || '<div class="empty">Sin contactos. Útil para empresas y clubes con varias personas.</div>'}</div></section>`;
    T.querySelector('[data-n]').addEventListener('click', () => editarContacto(id, null, recargar));
    T.querySelectorAll('[data-e]').forEach((b) => b.addEventListener('click', () => editarContacto(id, K.find((k) => k.id == b.dataset.e), recargar)));
    T.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmar('¿Quitar este contacto?', 'Quitar'))) return;
      try { ok(await sb.from('contactos').delete().eq('id', b.dataset.d)); recargar(); } catch (e) { fail(e); }
    }));
  }

  if (tab === 'pago') {
    const banco = esAdmin() ? (await sb.from('datos_bancarios').select('*').eq('cliente_id', id).maybeSingle()).data || {} : null;
    T.innerHTML = `<section class="card" data-p><h2>Condiciones de pago</h2><div class="form">
        <div class="field"><label for="f-fp">Forma de pago</label><select id="f-fp" name="forma_pago">${opt('', '—', c.forma_pago ?? '')}${['Efectivo', 'Tarjeta', 'Bizum', 'Transferencia', 'Domiciliación SEPA', 'Pagaré'].map((x) => opt(x, x, c.forma_pago)).join('')}</select></div>
        ${field('Plazo de pago (días)', 'plazo_pago_dias', c.plazo_pago_dias, 'number', 'min="0" max="365"')}
        ${field('Días de pago', 'dias_pago', c.dias_pago, 'text', 'maxlength="80" placeholder="Ej.: días 5 y 20 de cada mes"')}
        ${c.es_cliente ? `<div class="field"><label for="f-pf">Facturar</label><select id="f-pf" name="periodo_facturacion">${Object.entries(PERIODOS).map(([k, t]) => opt(k, k === 'inmediata' ? 'En el momento (al entregar)' : t.charAt(0).toUpperCase() + t.slice(1), c.periodo_facturacion || 'inmediata')).join('')}</select></div>` : ''}
      </div>
      ${c.es_cliente ? '<p class="muted small" style="margin:0">Con facturación periódica, las órdenes terminadas quedan como albarán y se agrupan en una factura por periodo desde Facturación › Pendientes de facturar. La factura periódica es para empresas, clubes y profesionales: a un particular se le factura en el momento.</p>' : ''}
      <button type="button" class="btn pri" data-gp style="align-self:flex-start">Guardar condiciones</button></section>
      ${banco ? `<section class="card" data-b><h2>Datos bancarios</h2><p class="muted small" style="margin:0">Solo los ve y modifica el administrador.</p><div class="form">
        ${field('Titular', 'titular', banco.titular, 'text', 'maxlength="120"')}
        ${field('IBAN', 'iban', banco.iban, 'text', 'maxlength="34" style="text-transform:uppercase" autocomplete="off"')}
        ${field('BIC / SWIFT', 'bic', banco.bic, 'text', 'maxlength="11" style="text-transform:uppercase"')}
        ${field('Banco', 'banco', banco.banco, 'text', 'maxlength="80"')}
        ${field('Referencia del mandato SEPA', 'mandato_sepa', banco.mandato_sepa, 'text', `maxlength="35" placeholder="Ej.: SMS-${String(id).padStart(5, '0')}"`)}
        ${field('Fecha del mandato', 'fecha_mandato', banco.fecha_mandato, 'date')}
      </div><p class="muted small" style="margin:0">Para cobrarle por remesa bancaria hacen falta el IBAN, la referencia y la fecha del mandato SEPA firmado por el cliente (guarda el papel firmado).</p>
      <button type="button" class="btn pri" data-gb style="align-self:flex-start">Guardar datos bancarios</button></section>` : ''}`;
    T.querySelector('[data-gp]').addEventListener('click', async () => {
      try {
        const o = formData(T.querySelector('[data-p]'));
        const upd = { forma_pago: o.forma_pago, plazo_pago_dias: o.plazo_pago_dias === null ? null : Math.floor(Number(o.plazo_pago_dias)), dias_pago: o.dias_pago };
        if (o.periodo_facturacion && Object.hasOwn(PERIODOS, o.periodo_facturacion)) upd.periodo_facturacion = o.periodo_facturacion;
        ok(await sb.from('clientes').update(upd).eq('id', id));
        toast('Condiciones guardadas'); recargar();
      } catch (e) { fail(e); }
    });
    T.querySelector('[data-gb]')?.addEventListener('click', async () => {
      try {
        const o = formData(T.querySelector('[data-b]'));
        if (o.iban) { o.iban = o.iban.replace(/\s+/g, '').toUpperCase(); if (!ibanValido(o.iban)) throw new Error('El IBAN no es válido'); }
        if (o.bic) { o.bic = o.bic.toUpperCase(); if (!/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(o.bic)) throw new Error('El BIC no es válido'); }
        ok(await sb.from('datos_bancarios').upsert({ cliente_id: id, ...o, updated_at: new Date().toISOString() }));
        toast('Datos bancarios guardados'); recargar();
      } catch (e) { fail(e); }
    });
  }

  if (tab === 'vehiculos') {
    const ult = {};
    if (M.length) ((await sb.from('reparaciones').select('moto_id,fecha_entrada').eq('cliente_id', id).order('fecha_entrada', { ascending: false })).data || []).forEach((r) => { if (!ult[r.moto_id]) ult[r.moto_id] = r.fecha_entrada; });
    T.innerHTML = `<section class="card"><div class="head"><h2>Vehículos</h2><button type="button" class="btn pri" data-nm>${I.plus} Añadir vehículo</button></div>
      <div class="grid-cards">${M.map((m) => {
        const al = alertasVehiculo(m);
        return `<div class="contacto"><div class="row1"><b>${esc(m.marca)} ${esc(m.modelo)}</b><span class="chip">${esc(m.matricula || 'Sin matrícula')}</span></div>
        <div class="small muted">${esc([m.color, m.cilindrada ? m.cilindrada + ' cc' : '', m.combustible, m.anio].filter(Boolean).join(' · '))}</div>
        <div class="small">${m.km ? m.km.toLocaleString('es-ES') + ' km' : ''}${m.bastidor ? ` · VIN ${esc(m.bastidor)}` : ''}</div>
        <div class="small">Última visita: ${ult[m.id] ? fdate(ult[m.id]) : '—'} · ITV: ${m.fecha_itv ? fdate(m.fecha_itv) : '—'}</div>
        <div class="small">Próxima revisión: ${[m.proxima_revision_fecha ? fdate(m.proxima_revision_fecha) : '', m.proxima_revision_km ? m.proxima_revision_km.toLocaleString('es-ES') + ' km' : ''].filter(Boolean).join(' o ') || '—'}</div>
        ${al.length ? `<div class="aviso">${al.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
        <div class="actions"><button type="button" class="btn sm" data-em="${m.id}">Abrir ficha</button></div></div>`;
      }).join('') || '<div class="empty">Sin vehículos</div>'}</div></section>`;
    T.querySelector('[data-nm]').addEventListener('click', () => editarVehiculo({ cliente_id: id }, recargar));
    T.querySelectorAll('[data-em]').forEach((b) => b.addEventListener('click', () => editarVehiculo(M.find((m) => m.id == b.dataset.em), recargar)));
  }

  if (tab === 'historial') {
    const R = ok(await sb.from('reparaciones').select('id,numero,estado,fecha_entrada,motivo,motos(marca,modelo)').eq('cliente_id', id).order('fecha_entrada', { ascending: false }));
    T.innerHTML = `<section class="card"><div class="list">${R.map((r) => `<a href="#/reparacion/${r.id}"><span class="grow"><b>${esc(r.numero)} · ${esc(r.motos ? r.motos.marca + ' ' + r.motos.modelo : '')}</b><span class="muted small">${fdate(r.fecha_entrada)} · ${esc(r.motivo || '')}</span></span>${chip(ESTADOS_REP, r.estado)}</a>`).join('') || '<div class="empty">Sin reparaciones</div>'}</div></section>`;
  }
  if (tab === 'piezas') tablaVentas(T, await cargarVentas({ cliente: id }), { porPieza: false });
  if (tab === 'citas') {
    const A = ok(await sb.from('citas').select('id,inicio,servicio,estado').eq('cliente_id', id).order('inicio', { ascending: false }).limit(30));
    T.innerHTML = `<section class="card"><div class="list">${A.map((a) => `<a href="#/agenda?d=${a.inicio.slice(0, 10)}&v=dia&c=${a.id}"><b class="num" style="width:130px">${fdate(a.inicio)} ${ftime(a.inicio)}</b><span class="grow">${esc(a.servicio)}</span>${chip(ESTADOS_CITA, a.estado)}</a>`).join('') || '<div class="empty">Sin citas</div>'}</div></section>`;
  }
  if (tab === 'compras') {
    const prov = (await sb.from('proveedores').select('id').eq('tercero_id', id).maybeSingle()).data;
    const Mv = prov ? ok(await sb.from('movimientos_stock').select('fecha,cantidad,precio,nota,piezas(nombre,referencia)').eq('proveedor_id', prov.id).eq('tipo', 'entrada').order('fecha', { ascending: false }).limit(100)) : [];
    const P = prov ? ok(await sb.from('piezas').select('id,referencia,nombre,stock,precio_compra').eq('proveedor_id', prov.id).order('nombre')) : [];
    T.innerHTML = `<div class="row"><section class="card"><h2>Piezas que nos suministra</h2><div class="list">${P.map((p) => `<a href="#/pieza/${p.id}"><span class="grow"><b>${esc(p.nombre)}</b><span class="muted small">${esc(p.referencia)} · compra ${money(p.precio_compra)}</span></span><b>stock ${p.stock}</b></a>`).join('') || '<div class="empty">Sin piezas</div>'}</div></section>
      <section class="card"><h2>Últimas compras</h2><div class="list">${Mv.map((m) => `<div><span class="grow"><b>${esc(m.piezas?.nombre)}</b><span class="muted small">${fdate(m.fecha)} · ${esc(m.nota || '')}</span></span><span class="num">${m.cantidad} × ${money(m.precio)}</span></div>`).join('') || '<div class="empty">Sin compras</div>'}</div>
      ${esOficina() ? '<a class="btn" href="#/almacen?t=compras" style="align-self:flex-start">Registrar compra</a>' : ''}</section></div>`;
  }
  if (tab === 'facturas' && puedeFacturar()) {
    const F = ok(await sb.from('facturas').select('id,numero,fecha,total,estado').eq('cliente_id', id).order('fecha', { ascending: false }));
    T.innerHTML = `<section class="card"><div class="list">${F.map((f) => `<a href="#/factura/${f.id}"><b style="width:120px">${esc(f.numero)}</b><span class="grow">${fdate(f.fecha)}</span><b class="num">${money(f.total)}</b><span class="chip ${f.estado === 'cobrada' ? 'ok' : f.estado === 'anulada' ? 'bad' : f.estado === 'emitida' ? 'info' : 'warn'}">${esc(f.tipo === 'rectificativa' ? 'rectificativa' : f.estado)}</span></a>`).join('') || '<div class="empty">Sin facturas</div>'}</div></section>`;
  }
}

function editarContacto(clienteId, k, recargar) {
  k = k || { emails: [], telefonos: [] };
  modal(k.id ? 'Editar contacto' : 'Nuevo contacto', `<div class="form">
    ${field('Nombre *', 'nombre', k.nombre, 'text', 'maxlength="120"')}
    ${field('Cargo', 'cargo', k.cargo, 'text', 'maxlength="80" placeholder="Ej.: jefe de taller, administración…"')}
    ${area('Emails (uno por línea)', 'emails', k.emails.join('\n'), 'maxlength="600" style="min-height:70px"')}
    ${area('Teléfonos (uno por línea)', 'telefonos', k.telefonos.join('\n'), 'maxlength="300" style="min-height:70px"')}
    ${area('Notas', 'notas', k.notas, 'maxlength="500"')}
    <label class="check full"><input type="checkbox" name="principal" ${k.principal ? 'checked' : ''}> Contacto principal</label>
  </div>`, {
    onOk: async (root) => {
      const o = formData(root);
      if (!o.nombre) throw new Error('Falta el nombre');
      const lista = (v) => (v || '').split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean).slice(0, 10);
      const emails = lista(o.emails), telefonos = lista(o.telefonos);
      const malEmail = emails.find((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)); if (malEmail) throw new Error(`Email no válido: ${malEmail}`);
      const malTel = telefonos.find((t) => !/^[+\d\s()-]{6,20}$/.test(t)); if (malTel) throw new Error(`Teléfono no válido: ${malTel}`);
      const d = { cliente_id: clienteId, nombre: o.nombre, cargo: o.cargo, emails, telefonos, notas: o.notas, principal: o.principal };
      if (d.principal) await sb.from('contactos').update({ principal: false }).eq('cliente_id', clienteId);
      if (k.id) ok(await sb.from('contactos').update(d).eq('id', k.id)); else ok(await sb.from('contactos').insert(d));
      toast('Contacto guardado'); recargar();
    },
  });
}

