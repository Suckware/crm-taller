import { sb, esc, attr, ok, money, fdate, fdt, today, modal, toast, fail, formData, req, field, area, opt, esOficina, esAdmin, confirmar } from '../lib.js';
import { I } from '../icons.js';

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
    <div class="agenda-bar"><input type="search" class="search" data-q placeholder="Buscar por nombre, referencia o marca…" value="${attr(params.q || '')}" aria-label="Buscar pieza">
      <select class="inp" data-cat style="width:auto;min-height:44px" aria-label="Categoría">${opt('', 'Todas las categorías', '')}${cats.map((c) => opt(c, c, '')).join('')}</select>
      <label class="check" style="align-items:center"><input type="checkbox" data-bajo> Solo stock bajo</label></div>
    <section class="card"><div class="tablewrap"><table>
      <thead><tr><th>Ref.</th><th>Pieza</th><th class="right">Stock</th><th class="right">PVP</th>${of ? '<th class="right hide-movil">Compra</th>' : ''}<th class="hide-movil">Última compra</th><th class="hide-movil">Proveedor</th><th class="hide-movil">Ubicación</th></tr></thead>
      <tbody>${P.map((p) => `<tr class="${of ? 'click' : ''}" data-id="${p.id}" data-txt="${attr(`${p.referencia} ${p.nombre} ${p.marca || ''}`.toLowerCase())}" data-cat="${attr(p.categoria || '')}" data-bajo="${p.stock <= p.stock_minimo ? 1 : 0}">
        <td class="small">${esc(p.referencia)}</td><td><b>${esc(p.nombre)}</b><div class="small muted">${esc([p.marca, p.categoria].filter(Boolean).join(' · '))}</div></td>
        <td class="right num"><b style="color:${p.stock <= p.stock_minimo ? 'var(--bad)' : 'inherit'}">${p.stock}</b><div class="small muted">mín. ${p.stock_minimo}</div></td>
        <td class="right num">${money(p.pvp)}</td>${of ? `<td class="right num hide-movil">${money(p.precio_compra)}</td>` : ''}
        <td class="hide-movil">${fdate(p.fecha_compra)}</td><td class="hide-movil">${esc(p.proveedores?.nombre || '')}</td><td class="hide-movil">${esc(p.ubicacion || '')}</td></tr>`).join('')}</tbody>
    </table></div></section>`;
    const filtrar = () => {
      const s = T.querySelector('[data-q]').value.toLowerCase().trim(); const c = T.querySelector('[data-cat]').value; const b = T.querySelector('[data-bajo]').checked;
      T.querySelectorAll('tr[data-id]').forEach((tr) => { tr.style.display = (!s || tr.dataset.txt.includes(s)) && (!c || tr.dataset.cat === c) && (!b || tr.dataset.bajo === '1') ? '' : 'none'; });
    };
    T.querySelectorAll('[data-q],[data-cat],[data-bajo]').forEach((x) => x.addEventListener('input', filtrar));
    filtrar();
    if (of) T.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => editarPieza(P.find((p) => p.id == tr.dataset.id), provs, recargar)));
  }

  if (tab === 'compras' && of) {
    const P = ok(await sb.from('piezas').select('id,referencia,nombre,stock,precio_compra,proveedor_id').order('nombre'));
    T.innerHTML = `<section class="card" style="max-width:760px"><h2>Registrar compra a proveedor</h2>
      <p class="muted small" style="margin:0">Suma el stock y guarda precio de compra, fecha y proveedor en la pieza.</p>
      <div class="form" data-f>
        <div class="field full"><label for="c-p">Pieza</label><select id="c-p" name="pieza">${P.map((p) => opt(p.id, `${p.nombre} · ${p.referencia} (stock ${p.stock})`, params.p || '')).join('')}</select></div>
        <div class="field"><label for="c-prov">Proveedor</label><select id="c-prov" name="proveedor">${provs.map((v) => opt(v.id, v.nombre, '')).join('')}</select></div>
        ${field('Cantidad', 'cantidad', 1, 'number', 'min="1" max="10000" inputmode="numeric"')}
        ${field('Precio de compra por unidad (€)', 'precio', '', 'number', 'min="0" step="0.01" inputmode="decimal"')}
        ${field('Fecha de compra', 'fecha', today(), 'date', `max="${today()}"`)}
        ${field('Nº de albarán / nota', 'nota', '', 'text', 'maxlength="120"')}
      </div>
      <button type="button" class="btn pri" data-g style="align-self:flex-start">Registrar entrada</button></section>`;
    const selP = T.querySelector('#c-p');
    const pre = () => { const p = P.find((x) => x.id == selP.value); if (p) { T.querySelector('[name=precio]').value = p.precio_compra; if (p.proveedor_id) T.querySelector('#c-prov').value = p.proveedor_id; } };
    selP.addEventListener('change', pre); pre();
    T.querySelector('[data-g]').addEventListener('click', async (e) => {
      try {
        const o = formData(T.querySelector('[data-f]'));
        const cant = Math.floor(Number(o.cantidad));
        if (!(cant > 0)) throw new Error('Cantidad no válida');
        e.currentTarget.disabled = true;
        ok(await sb.rpc('registrar_compra', { p_pieza: Number(o.pieza), p_cantidad: cant, p_precio: o.precio === null ? null : Number(o.precio), p_proveedor: o.proveedor ? Number(o.proveedor) : null, p_fecha: o.fecha || today(), p_nota: o.nota ? `Albarán ${o.nota}` : null }));
        toast('Entrada registrada'); location.hash = '#/almacen?t=movimientos';
      } catch (err) { fail(err); e.currentTarget.disabled = false; }
    });
  }

  if (tab === 'proveedores') {
    T.innerHTML = `<section class="card"><div class="head"><h2>Proveedores</h2>${of ? `<button type="button" class="btn pri" data-nv>${I.plus} Nuevo proveedor</button>` : ''}</div>
      <div class="tablewrap"><table><thead><tr><th>Proveedor</th><th>Contacto</th><th>Teléfono</th><th class="hide-movil">Email</th><th class="hide-movil">CIF</th></tr></thead>
      <tbody>${provs.map((v) => `<tr class="${of ? 'click' : ''}" data-id="${v.id}"><td><b>${esc(v.nombre)}</b><div class="small muted">${esc(v.notas || '')}</div></td><td>${esc(v.contacto || '')}</td><td><a href="tel:${attr(v.telefono || '')}">${esc(v.telefono || '')}</a></td><td class="hide-movil">${esc(v.email || '')}</td><td class="hide-movil">${esc(v.cif || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sin proveedores</td></tr>'}</tbody></table></div></section>`;
    T.querySelector('[data-nv]')?.addEventListener('click', () => editarProveedor(null, recargar));
    if (of) T.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => editarProveedor(provs.find((v) => v.id == tr.dataset.id), recargar)));
  }

  if (tab === 'movimientos') {
    const M = ok(await sb.from('movimientos_stock').select('*,piezas(referencia,nombre),proveedores(nombre),reparaciones(id,numero)').order('fecha', { ascending: false }).limit(150));
    const tipo = { entrada: ['Entrada', 'ok'], salida: ['Salida', 'info'], devolucion: ['Devolución', 'warn'], ajuste: ['Ajuste', ''] };
    T.innerHTML = `<section class="card"><div class="tablewrap"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Pieza</th><th class="right">Cant.</th><th class="hide-movil">Origen / destino</th></tr></thead>
      <tbody>${M.map((m) => `<tr><td class="small">${fdt(m.fecha)}</td><td><span class="chip ${tipo[m.tipo][1]}">${tipo[m.tipo][0]}</span></td><td>${esc(m.piezas?.nombre)}<div class="small muted">${esc(m.piezas?.referencia)}</div></td>
        <td class="right num"><b>${m.tipo === 'salida' ? '−' : '+'}${m.cantidad}</b></td>
        <td class="hide-movil small">${m.reparaciones ? `<a href="#/reparacion/${m.reparaciones.id}">${esc(m.reparaciones.numero)}</a> · ` : ''}${esc(m.proveedores?.nombre || '')}${m.nota ? ' · ' + esc(m.nota) : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sin movimientos</td></tr>'}</tbody></table></div></section>`;
  }
}

function editarPieza(p, provs, recargar) {
  p = p || {};
  const m = modal(p.id ? 'Editar pieza' : 'Nueva pieza', `<div class="form">
    ${field('Referencia *', 'referencia', p.referencia, 'text', 'maxlength="40" required')}
    ${field('Nombre *', 'nombre', p.nombre, 'text', 'maxlength="120" required')}
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
    ${p.id && p.precio_compra > 0 ? `<p class="muted small full" style="margin:0">Margen actual: ${(((p.pvp - p.precio_compra) / p.precio_compra) * 100).toFixed(0)} %</p>` : ''}
  </div>${p.id && esAdmin() ? '<button type="button" class="btn danger sm" data-del style="align-self:flex-start">Eliminar pieza</button>' : ''}`, {
    onOk: async (root) => {
      const o = formData(root);
      req(o, [['referencia', 'referencia'], ['nombre', 'nombre'], ['pvp', 'PVP'], ['precio_compra', 'precio de compra']]);
      const d = { referencia: o.referencia.toUpperCase(), nombre: o.nombre, marca: o.marca, categoria: o.categoria, pvp: Number(o.pvp), precio_compra: Number(o.precio_compra), fecha_compra: o.fecha_compra, proveedor_id: o.proveedor_id ? Number(o.proveedor_id) : null, stock_minimo: Number(o.stock_minimo) || 0, ubicacion: o.ubicacion };
      if (d.pvp < 0 || d.precio_compra < 0) throw new Error('Los precios no pueden ser negativos');
      if (p.id) ok(await sb.from('piezas').update(d).eq('id', p.id));
      else {
        const stock = Math.max(0, Math.floor(Number(o.stock) || 0));
        const n = ok(await sb.from('piezas').insert({ ...d, stock: 0 }).select('id').single());
        if (stock > 0) ok(await sb.rpc('registrar_compra', { p_pieza: n.id, p_cantidad: stock, p_precio: d.precio_compra, p_proveedor: d.proveedor_id, p_fecha: d.fecha_compra || today(), p_nota: 'Stock inicial' }));
      }
      toast('Pieza guardada'); recargar();
    },
  });
  m.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!(await confirmar('¿Eliminar esta pieza del almacén?', 'Eliminar'))) return;
    try { ok(await sb.from('piezas').delete().eq('id', p.id)); m.remove(); toast('Pieza eliminada'); recargar(); } catch (e) { fail(/foreign/.test(e.message) ? new Error('Se ha usado en reparaciones: no se puede eliminar') : e); }
  });
}

function editarProveedor(v, recargar) {
  v = v || {};
  modal(v.id ? 'Editar proveedor' : 'Nuevo proveedor', `<div class="form">
    ${field('Nombre *', 'nombre', v.nombre, 'text', 'maxlength="120" required')}
    ${field('CIF', 'cif', v.cif, 'text', 'maxlength="20"')}
    ${field('Persona de contacto', 'contacto', v.contacto, 'text', 'maxlength="80"')}
    ${field('Teléfono', 'telefono', v.telefono, 'tel', 'maxlength="20"')}
    ${field('Email', 'email', v.email, 'email', 'maxlength="120"')}
    ${area('Notas', 'notas', v.notas, 'maxlength="500"')}
  </div>`, {
    onOk: async (root) => {
      const o = formData(root); req(o, [['nombre', 'nombre']]);
      if (o.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.email)) throw new Error('Email no válido');
      if (v.id) ok(await sb.from('proveedores').update(o).eq('id', v.id)); else ok(await sb.from('proveedores').insert(o));
      toast('Proveedor guardado'); recargar();
    },
  });
}
