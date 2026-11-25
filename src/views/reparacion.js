import { sb, state, esc, attr, ok, money, fdate, fdt, today, chip, ESTADOS_REP, nombreTecnico, tecnicoOpts, opt, toast, fail, modal, confirmar, puedeFacturar, esOficina, PERIODOS, volverA, botonVolver, puedeCambiarPrecios, esInventariable, udAbr, udNombre, numES } from '../lib.js';
import { CONDICIONES_DEF, firmaPad } from './recepcion.js';
import { I } from '../icons.js';
import { avisoNotas, alertasVehiculo, buscadorPiezas } from './comun.js';

const firmaOk = (f) => typeof f === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(f);

export async function render(el, params) {
  const id = Number(params.id);
  const tab = params.t || 'resumen';
  const [rq, pq, hq, fq] = await Promise.all([
    sb.from('reparaciones').select('*,clientes(*),motos(*)').eq('id', id).single(),
    sb.from('reparacion_piezas').select('*,piezas(*)').eq('reparacion_id', id).order('id'),
    sb.from('reparacion_horas').select('*').eq('reparacion_id', id).order('fecha'),
    puedeFacturar() ? sb.from('factura_reparaciones').select('facturas(id,numero,total,estado,tipo)').eq('reparacion_id', id) : Promise.resolve({ data: [] }),
  ]);
  const r = ok(rq), piezas = ok(pq), horas = ok(hq);
  const facts = ok(fq).map((x) => x.facturas).filter((f) => f && f.tipo === 'ordinaria' && f.estado !== 'anulada');
  const impLinea = (p) => Math.round(p.cantidad * p.pvp * (1 - (Number(p.dto_pct) || 0) / 100) * 100) / 100;
  const totPiezas = piezas.reduce((s, p) => s + impLinea(p), 0);
  const facturada = facts.length > 0;
  const totHoras = horas.reduce((s, h) => s + h.horas * h.precio_hora, 0);
  const numHoras = horas.reduce((s, h) => s + Number(h.horas), 0);
  const recargar = (t = tab) => { if (t === tab) render(el, params); else location.hash = `#/reparacion/${id}?t=${t}`; };

  const tabs = [['resumen', 'Resumen'], ['entrada', 'Entrada y autorización'], ['diagnostico', 'Diagnóstico'], ['piezas', `Piezas y artículos (${piezas.length})`], ['horas', `Horas (${numHoras.toLocaleString('es-ES')})`]];
  if (puedeFacturar()) tabs.push(['factura', 'Factura']);
  const moto = r.motos ? `${r.motos.marca} ${r.motos.modelo}` : 'Sin moto';

  el.innerHTML = `
  <div class="head">
    <div class="t">
      <h1>${esc(r.numero)} · ${esc(moto)}</h1>
      <div class="muted">${esc(r.motos?.matricula || '')} · <a href="#/cliente/${r.cliente_id}">${esc(r.clientes.nombre)}</a>${r.clientes.telefono ? ` · <a href="tel:${attr(r.clientes.telefono)}">${esc(r.clientes.telefono)}</a>` : ''}</div></div>
    <div class="actions" style="align-items:center">${botonVolver(volverA('reparacion', id, '#/reparaciones'))}${chip(ESTADOS_REP, r.estado)}
      <select class="inp" data-estado aria-label="Cambiar estado" style="width:auto">${Object.entries(ESTADOS_REP).map(([k, [t]]) => opt(k, t, r.estado)).join('')}</select></div>
  </div>
  <nav class="tabs" aria-label="Secciones de la reparación">${tabs.map(([k, t]) => `<a href="#/reparacion/${id}?t=${k}" class="${k === tab ? 'on' : ''}">${esc(t)}</a>`).join('')}</nav>
  <div data-tab></div>`;

  el.querySelector('[data-estado]').addEventListener('change', async (e) => {
    try { ok(await sb.from('reparaciones').update({ estado: e.target.value }).eq('id', id)); toast('Estado actualizado'); recargar(); } catch (err) { fail(err); }
  });
  const T = el.querySelector('[data-tab]');

  if (tab === 'resumen') {
    const al = alertasVehiculo(r.motos);
    T.innerHTML = `${avisoNotas(r.clientes)}${al.length ? `<div class="aviso">${al.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
    <div class="kpis">
      <div class="kpi"><span class="l">Entrada</span><span class="v" style="font-size:20px">${fdate(r.fecha_entrada)}</span><span class="l">${r.km_entrada ? r.km_entrada.toLocaleString('es-ES') + ' km' : ''}</span></div>
      <div class="kpi"><span class="l">Técnico</span><span class="v" style="font-size:20px">${esc(nombreTecnico(r.tecnico_id))}</span><span class="l">${r.fecha_prevista ? 'Entrega prevista ' + fdate(r.fecha_prevista) : 'Sin fecha prevista'}</span></div>
      <div class="kpi"><span class="l">Piezas y artículos</span><span class="v" style="font-size:20px">${money(totPiezas)}</span><span class="l">${piezas.length} líneas</span></div>
      <div class="kpi"><span class="l">Mano de obra</span><span class="v" style="font-size:20px">${money(totHoras)}</span><span class="l">${numHoras.toLocaleString('es-ES')} h</span></div>
      <div class="kpi"><span class="l">Total sin impuestos</span><span class="v" style="font-size:20px">${money(totPiezas + totHoras)}</span><span class="l">${r.importe_max_autorizado ? 'Autorizado hasta ' + money(r.importe_max_autorizado) : 'Sin importe máximo'}</span></div>
    </div>
    ${r.importe_max_autorizado && totPiezas + totHoras > r.importe_max_autorizado ? '<div class="card flat" style="background:var(--warn-bg);color:var(--warn);font-weight:600">Se ha superado el importe autorizado por el cliente. Hay que pedirle aprobación.</div>' : ''}
    <div class="row">
      <section class="card"><h2>Motivo de la visita</h2><p style="margin:0;white-space:pre-line">${esc(r.motivo || '—')}</p>
        <h3>Trabajos autorizados</h3><p style="margin:0;white-space:pre-line">${esc(r.trabajos_autorizados || '—')}</p></section>
      <section class="card"><h2>Diagnóstico</h2><p style="margin:0;white-space:pre-line">${esc(r.diagnostico || 'Pendiente de diagnóstico')}</p><a href="#/reparacion/${id}?t=diagnostico">Editar diagnóstico</a></section>
      <section class="card"><h2>Asignación</h2>
        <div class="form">
          <div class="field"><label for="a-tec">Técnico</label><select id="a-tec" data-k="tecnico_id">${tecnicoOpts(r.tecnico_id)}</select></div>
          <div class="field"><label for="a-prev">Entrega prevista</label><input id="a-prev" type="date" data-k="fecha_prevista" value="${attr(r.fecha_prevista || '')}"></div>
        </div>
        <div class="field"><label for="a-notas">Notas internas</label><textarea id="a-notas" class="inp" data-k="notas_internas" maxlength="2000">${esc(r.notas_internas || '')}</textarea></div>
        <button type="button" class="btn" data-guardar-asig>Guardar</button>
      </section>
    </div>`;
    T.querySelector('[data-guardar-asig]').addEventListener('click', async () => {
      const upd = {}; T.querySelectorAll('[data-k]').forEach((e) => { upd[e.dataset.k] = e.value.trim() || null; });
      try { ok(await sb.from('reparaciones').update(upd).eq('id', id)); toast('Guardado'); recargar(); } catch (e) { fail(e); }
    });
  }

  if (tab === 'entrada') {
    const cfg = state.config;
    T.innerHTML = `
    <section class="card print-area">
      <div class="head"><div style="display:flex;gap:14px;align-items:center"><img src="./logo.png" alt="" style="width:60px;height:60px;border-radius:50%"><div><h2>Hoja de autorización de reparación</h2><div class="muted small">${esc(cfg.nombre_taller)}${cfg.cif ? ' · ' + esc(cfg.cif) : ''}${cfg.direccion ? ' · ' + esc(cfg.direccion) : ''}${cfg.telefono ? ' · ' + esc(cfg.telefono) : ''}</div></div></div>
        <div class="actions no-print"><button type="button" class="btn" data-print>${I.print} Imprimir</button></div></div>
      <div class="form">
        <div><div class="lbl">Orden</div>${esc(r.numero)} · ${fdt(r.fecha_entrada)}</div>
        <div><div class="lbl">Cliente</div>${esc(r.clientes.nombre)}${r.clientes.nif ? ' · ' + esc(r.clientes.nif) : ''}<br>${esc(r.clientes.telefono || '')}</div>
        <div><div class="lbl">Moto</div>${esc(moto)} · ${esc(r.motos?.matricula || '')}${r.motos?.bastidor ? '<br>Bastidor ' + esc(r.motos.bastidor) : ''}</div>
        <div><div class="lbl">Kilómetros / combustible</div>${r.km_entrada ? r.km_entrada.toLocaleString('es-ES') + ' km' : '—'} · ${esc(r.combustible || '—')}</div>
        <div class="full"><div class="lbl">Motivo</div><span style="white-space:pre-line">${esc(r.motivo || '—')}</span></div>
        <div class="full"><div class="lbl">Trabajos autorizados</div><span style="white-space:pre-line">${esc(r.trabajos_autorizados || '—')}</span></div>
        <div><div class="lbl">Importe máximo autorizado</div>${r.importe_max_autorizado ? money(r.importe_max_autorizado) : 'Avisar antes de superar el presupuesto'}</div>
        <div><div class="lbl">Objetos que deja</div>${esc(r.objetos_personales || '—')}</div>
        <div class="full"><div class="lbl">Daños visibles a la entrada</div>${esc(r.estado_visual || 'Ninguno indicado')}</div>
      </div>
      <div class="terms" style="max-height:none">${esc(cfg.condiciones_autorizacion || CONDICIONES_DEF)}</div>
      ${firmaOk(r.firma) ? `<div><div class="lbl">Firmado por ${esc(r.firmado_por || r.clientes.nombre)} el ${fdt(r.firmado_en)} · acepta las condiciones</div><img class="sigimg" src="${attr(r.firma)}" alt="Firma del cliente"></div>`
        : `<div class="no-print" style="display:flex;flex-direction:column;gap:10px"><div class="chip warn" style="align-self:flex-start">Pendiente de firma</div>
          <label class="check"><input type="checkbox" data-acepta> El cliente acepta las condiciones y autoriza los trabajos.</label>
          <div class="field"><label for="e-firm">Nombre de quien firma</label><input id="e-firm" class="inp" data-firmante value="${attr(r.clientes.nombre)}" maxlength="120"></div>
          <canvas class="sig" data-sig aria-label="Zona de firma"></canvas>
          <div class="actions"><button type="button" class="btn sm" data-limpiar>Borrar</button><button type="button" class="btn pri" data-firmar>${I.sign} Guardar firma</button></div></div>`}
    </section>`;
    T.querySelector('[data-print]').addEventListener('click', () => window.print());
    const c = T.querySelector('[data-sig]');
    if (c) {
      const pad = firmaPad(c);
      T.querySelector('[data-limpiar]').addEventListener('click', pad.clear);
      T.querySelector('[data-firmar]').addEventListener('click', async (e) => {
        try {
          if (!T.querySelector('[data-acepta]').checked) throw new Error('El cliente debe aceptar las condiciones');
          if (pad.empty()) throw new Error('Falta la firma');
          e.currentTarget.disabled = true;
          ok(await sb.from('reparaciones').update({ firma: pad.data(), firmado_en: new Date().toISOString(), acepta_condiciones: true, firmado_por: T.querySelector('[data-firmante]').value.trim() || r.clientes.nombre }).eq('id', id));
          toast('Firma guardada'); recargar();
        } catch (err) { fail(err); e.currentTarget.disabled = false; }
      });
    }
  }

  if (tab === 'diagnostico') {
    T.innerHTML = `<section class="card">
      <div class="field"><label for="d-diag">Diagnóstico del técnico</label><textarea id="d-diag" class="inp" style="min-height:200px" maxlength="5000" placeholder="Qué se ha encontrado, pruebas realizadas, resultados del banco de potencia, propuesta de reparación…">${esc(r.diagnostico || '')}</textarea></div>
      <div class="actions">
        <button type="button" class="btn pri" data-g>Guardar diagnóstico</button>
        <button type="button" class="btn" data-g2>Guardar y pedir aprobación al cliente</button>
      </div></section>`;
    const g = async (estado) => {
      const upd = { diagnostico: T.querySelector('#d-diag').value.trim() || null };
      if (estado) upd.estado = estado; else if (r.estado === 'recibida') upd.estado = 'diagnostico';
      try { ok(await sb.from('reparaciones').update(upd).eq('id', id)); toast('Diagnóstico guardado'); recargar(); } catch (e) { fail(e); }
    };
    T.querySelector('[data-g]').addEventListener('click', () => g());
    T.querySelector('[data-g2]').addEventListener('click', () => g('esperando_aprobacion'));
  }

  if (tab === 'piezas') {
    const pc = puedeCambiarPrecios() && !facturada;
    const ed = !facturada;
    const fila = (p) => {
      const a = p.piezas, inv = esInventariable(a);
      const ud = p.en_cajas ? `caja${Number(p.cantidad) === 1 ? '' : 's'} de ${a.unidades_caja}` : udAbr(a);
      return `<tr data-l="${p.id}">
        <td class="small hide-movil"><a href="#/pieza/${p.pieza_id}">${esc(a.referencia)}</a>${inv ? '' : '<div><span class="chip" style="font-size:10px">NO INVENTARIABLE</span></div>'}</td>
        <td style="min-width:240px;width:40%">${ed ? `<input class="inp" data-k="descripcion" value="${attr(p.descripcion || a.nombre)}" maxlength="200" style="width:100%" aria-label="Descripción de la línea">` : esc(p.descripcion || a.nombre)}
          <div class="small muted">${p.descripcion ? `Artículo: ${esc(a.nombre)} · ` : ''}<span class="show-movil">${esc(a.referencia)} · </span>${inv ? `sale del stock: ${p.unidades_stock ?? '—'} ${esc(udNombre(a, p.unidades_stock))}` : 'no mueve stock'}</div></td>
        <td class="right num" style="white-space:nowrap">${ed ? `<input class="inp num" type="number" data-k="cantidad" value="${attr(Number(p.cantidad))}" min="0.01" step="${inv ? 1 : 0.25}" style="width:82px;text-align:right" inputmode="decimal" aria-label="Cantidad">` : numES(p.cantidad)} <span class="small muted">${esc(ud)}</span></td>
        <td class="right num">${pc ? `<input class="inp num" type="number" data-k="pvp" value="${attr(Number(p.pvp))}" min="0" step="0.01" style="width:96px;text-align:right" inputmode="decimal" aria-label="Precio">` : money(p.pvp)}</td>
        <td class="right num hide-movil">${pc ? `<input class="inp num" type="number" data-k="dto_pct" value="${attr(Number(p.dto_pct) || 0)}" min="0" max="100" step="0.5" style="width:70px;text-align:right" inputmode="decimal" aria-label="Descuento %">` : `${numES(p.dto_pct)} %`}</td>
        <td class="right num" data-imp>${money(impLinea(p))}</td>
        <td class="right" style="white-space:nowrap">${ed ? `<button type="button" class="btn sm pri" data-g="${p.id}" style="display:none">Guardar</button> <button type="button" class="btn sm danger" data-del="${p.id}">Quitar</button>` : ''}</td></tr>`;
    };
    T.innerHTML = `<section class="card">
      <div class="head"><h2>Piezas y artículos</h2>${ed ? `<button type="button" class="btn pri" data-add>${I.plus} Añadir del almacén</button>` : ''}</div>
      <p class="muted small" style="margin:0">${facturada ? 'Esta orden ya está facturada: sus líneas no se pueden cambiar. Para corregirla hay que anular la factura.'
        : `Las piezas con stock se descuentan del almacén al añadirlas; si cambias la cantidad se ajusta solo, y si las quitas vuelven al almacén. Los artículos NO INVENTARIABLE no mueven stock.${puedeCambiarPrecios() ? '' : ' Tu rol no permite cambiar precios ni descuentos.'}`}</p>
      <div class="tablewrap"><table><thead><tr><th class="hide-movil">Ref.</th><th>Descripción</th><th class="right">Cant.</th><th class="right">Precio</th><th class="right hide-movil">Dto.</th><th class="right">Importe</th><th></th></tr></thead><tbody>
      ${piezas.map(fila).join('') || '<tr><td colspan="7" class="empty">Sin piezas ni artículos</td></tr>'}
      </tbody><tfoot><tr><td class="hide-movil"></td><td colspan="3" class="right">Total</td><td class="hide-movil"></td><td class="right num">${money(totPiezas)}</td><td></td></tr></tfoot></table></div></section>`;
    T.querySelector('[data-add]')?.addEventListener('click', () => anadirPieza(id, recargar));
    T.querySelectorAll('tr[data-l]').forEach((tr) => {
      const p = piezas.find((x) => String(x.id) === tr.dataset.l);
      const g = tr.querySelector('[data-g]');
      const val = (k) => { const e = tr.querySelector(`[data-k="${k}"]`); return e ? e.value.trim() : null; };
      const cambios = () => {
        const u = {};
        const d = val('descripcion'); if (d !== null && d !== (p.descripcion || p.piezas.nombre)) u.descripcion = d && d !== p.piezas.nombre ? d : null;
        const c = val('cantidad'); if (c !== null && Number(c) !== Number(p.cantidad)) u.cantidad = Number(c);
        const v = val('pvp'); if (v !== null && Number(v) !== Number(p.pvp)) u.pvp = Number(v);
        const t = val('dto_pct'); if (t !== null && Number(t) !== Number(p.dto_pct || 0)) u.dto_pct = Number(t) || 0;
        return u;
      };
      const pinta = () => {
        const u = { ...p, ...cambios() };
        tr.querySelector('[data-imp]').textContent = money(impLinea(u));
        if (g) g.style.display = Object.keys(cambios()).length ? '' : 'none';
      };
      tr.querySelectorAll('[data-k]').forEach((e) => {
        e.addEventListener('input', pinta);
        e.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); g?.click(); } });
      });
      g?.addEventListener('click', async () => {
        const u = cambios(); if (!Object.keys(u).length) return;
        if ('cantidad' in u && !(u.cantidad > 0)) { toast('La cantidad tiene que ser mayor que cero', true); return; }
        if ('pvp' in u && !(u.pvp >= 0)) { toast('Precio no válido', true); return; }
        if ('dto_pct' in u && !(u.dto_pct >= 0 && u.dto_pct <= 100)) { toast('El descuento va de 0 a 100 %', true); return; }
        g.disabled = true;
        try { ok(await sb.from('reparacion_piezas').update(u).eq('id', p.id)); toast('cantidad' in u && esInventariable(p.piezas) ? 'Línea guardada y stock ajustado' : 'Línea guardada'); recargar(); } catch (e) { fail(e); g.disabled = false; }
      });
    });
    T.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const p = piezas.find((x) => String(x.id) === b.dataset.del);
      const inv = esInventariable(p?.piezas);
      if (!(await confirmar(inv ? '¿Quitar esta línea? La pieza volverá al stock del almacén.' : '¿Quitar esta línea?', 'Quitar'))) return;
      try { ok(await sb.from('reparacion_piezas').delete().eq('id', b.dataset.del)); toast(inv ? 'Pieza devuelta al almacén' : 'Línea quitada'); recargar(); } catch (e) { fail(e); }
    }));
  }

  if (tab === 'horas') {
    const arts = ok(await sb.from('piezas').select('*').eq('inventariable', false).eq('unidad', 'hora').order('nombre'));
    const artDe = (h) => arts.find((a) => a.id === h.pieza_id);
    const porTec = {};
    horas.forEach((h) => { porTec[h.tecnico_id] = (porTec[h.tecnico_id] || 0) + Number(h.horas); });
    const ed = !facturada;
    T.innerHTML = `<section class="card">
      <div class="head"><h2>Horas por mecánico</h2>${ed ? `<button type="button" class="btn pri" data-add>${I.plus} Apuntar horas</button>` : ''}</div>
      ${facturada ? '<p class="muted small" style="margin:0">Esta orden ya está facturada: sus horas no se pueden cambiar.</p>' : ''}
      <div class="actions">${Object.entries(porTec).map(([t, n]) => `<span class="chip info">${esc(nombreTecnico(t))}: ${n.toLocaleString('es-ES')} h</span>`).join('')}</div>
      <div class="tablewrap"><table><thead><tr><th>Fecha</th><th>Mecánico</th><th>Trabajo</th><th class="right">Horas</th><th class="right">€/h</th><th class="right">Importe</th><th></th></tr></thead><tbody>
      ${horas.map((h) => `<tr><td>${fdate(h.fecha)}</td><td>${esc(nombreTecnico(h.tecnico_id))}</td><td><b>${esc(artDe(h)?.nombre || 'Mano de obra')}</b>${h.descripcion ? `<div class="small">${esc(h.descripcion)}</div>` : ''}</td><td class="right num">${Number(h.horas).toLocaleString('es-ES')}</td><td class="right num">${money(h.precio_hora)}</td><td class="right num">${money(h.horas * h.precio_hora)}</td><td class="right" style="white-space:nowrap">${ed ? `<button type="button" class="btn sm" data-e="${h.id}">Editar</button> <button type="button" class="btn sm danger" data-del="${h.id}">Quitar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Sin horas apuntadas</td></tr>'}
      </tbody><tfoot><tr><td colspan="3" class="right">Total</td><td class="right num">${numHoras.toLocaleString('es-ES')}</td><td></td><td class="right num">${money(totHoras)}</td><td></td></tr></tfoot></table></div></section>`;
    T.querySelector('[data-add]')?.addEventListener('click', () => apuntarHoras(id, r, recargar, arts));
    T.querySelectorAll('[data-e]').forEach((b) => b.addEventListener('click', () => apuntarHoras(id, r, recargar, arts, horas.find((h) => String(h.id) === b.dataset.e))));
    T.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmar('¿Quitar estas horas?', 'Quitar'))) return;
      try { ok(await sb.from('reparacion_horas').delete().eq('id', b.dataset.del)); recargar(); } catch (e) { fail(e); }
    }));
  }

  if (tab === 'factura' && puedeFacturar()) {
    const f = facts[0];
    const def = state.impuestos.find((i) => i.por_defecto) || state.impuestos[0];
    T.innerHTML = f ? `<section class="card"><h2>Factura ${esc(f.numero)}</h2><p style="margin:0">Total ${money(f.total)} · ${f.estado === 'cobrada' ? '<span class="chip ok">Cobrada</span>' : '<span class="chip warn">Pendiente de cobro</span>'}</p><a class="btn pri" href="#/factura/${f.id}" style="align-self:flex-start">Abrir factura</a></section>`
      : `<section class="card"><h2>Facturar esta reparación</h2>
        ${r.clientes?.periodo_facturacion && r.clientes.periodo_facturacion !== 'inmediata' ? `<p class="aviso" style="margin:0">Este cliente se factura <b>${esc(PERIODOS[r.clientes.periodo_facturacion])}</b>. Si no la facturas ahora, la orden queda como albarán y entra sola en su factura del periodo (Facturación › Pendientes de facturar).</p>` : ''}
        <p class="muted" style="margin:0">Se creará la factura con ${horas.length} líneas de mano de obra y ${piezas.length} de piezas. Base: <b>${money(totPiezas + totHoras)}</b>.</p>
        <div class="field" style="max-width:320px"><label for="f-imp">Impuesto</label><select id="f-imp" class="inp">${state.impuestos.filter((i) => i.activo).map((i) => opt(i.id, `${i.nombre} ${Number(i.porcentaje).toLocaleString('es-ES')} %`, def?.id)).join('')}</select></div>
        <button type="button" class="btn pri" data-fact style="align-self:flex-start" ${totPiezas + totHoras <= 0 ? 'disabled' : ''}>Crear factura</button>
        ${totPiezas + totHoras <= 0 ? '<p class="muted small" style="margin:0">Añade piezas u horas antes de facturar.</p>' : ''}</section>`;
    T.querySelector('[data-fact]')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        const fid = ok(await sb.rpc('facturar_reparacion', { p_reparacion: id, p_impuesto: Number(T.querySelector('#f-imp').value) }));
        toast('Factura creada'); location.hash = `#/factura/${fid}`;
      } catch (err) { fail(err); e.currentTarget.disabled = false; }
    });
  }
}

async function anadirPieza(repId, recargar) {
  const m = modal('Añadir del almacén', '<div data-buscador></div>', {});
  const fila = (p) => {
    const inv = esInventariable(p), caja = Number(p.unidades_caja) || 0;
    return `<div><span class="grow"><b>${esc(p.nombre)}</b><span class="muted small">${esc(p.referencia)}${p.codigo_barras ? ' · ' + esc(p.codigo_barras) : ''} · ${money(p.pvp)}/${esc(udAbr(p))}${caja ? ` · caja de ${caja}: ${money(p.pvp * caja)}` : ''} · ${p.ubicacion ? esc(p.ubicacion) + ' · ' : ''}${inv ? `<b style="color:${p.stock > 0 ? 'var(--ok)' : 'var(--bad)'}">stock ${p.stock}</b>` : '<span class="chip">NO INVENTARIABLE</span>'}</span></span>
      <input type="number" class="inp" value="1" min="${inv ? 1 : 0.01}" step="${inv ? 1 : 0.25}" ${inv ? `max="${Math.max(p.stock, 1)}"` : ''} style="width:76px" aria-label="Cantidad" data-cant="${p.id}" inputmode="decimal">
      ${caja ? `<select class="inp" data-en="${p.id}" style="width:auto" aria-label="Unidad">${opt('ud', udNombre(p), 'ud')}${opt('caja', `cajas (${caja})`, 'ud')}</select>` : `<span class="small muted">${esc(udAbr(p))}</span>`}
      <button type="button" class="btn sm pri" data-add="${p.id}" ${inv && p.stock <= 0 ? 'disabled' : ''}>Añadir</button></div>`;
  };
  const cont = m.querySelector('[data-buscador]');
  const vistos = {};
  async function anadir(p, b) {
    const inv = esInventariable(p);
    const cant = Number(String(cont.querySelector(`[data-cant="${p.id}"]`)?.value || '1').replace(',', '.'));
    const enCajas = cont.querySelector(`[data-en="${p.id}"]`)?.value === 'caja';
    const unid = cant * (enCajas ? Number(p.unidades_caja) : 1);
    if (!(cant > 0)) { toast('Cantidad no válida', true); return; }
    if (inv && unid % 1) { toast('De una pieza con stock solo pueden salir unidades enteras', true); return; }
    if (inv && unid > p.stock) { toast(`Solo hay ${p.stock} ${udNombre(p, p.stock)} en stock`, true); return; }
    if (b) b.disabled = true;
    // El precio lo pone la base de datos (PVP del artículo, o PVP × unidades de la caja)
    try { ok(await sb.from('reparacion_piezas').insert({ reparacion_id: repId, pieza_id: p.id, cantidad: cant, en_cajas: enCajas })); m.remove(); toast(inv ? `${p.nombre}: descontado del stock` : `${p.nombre}: añadido`); recargar('piezas'); } catch (e) { fail(e); if (b) b.disabled = false; }
  }
  // Con el lector (coincidencia exacta) se pasa directamente a la cantidad: Intro añade la pieza
  buscadorPiezas(cont, {
    placeholder: 'Buscar pieza o artículo por nombre, referencia o código de barras…',
    fila: (p) => { vistos[p.id] = p; return fila(p); },
    onPick: (p) => { vistos[p.id] = p; setTimeout(() => { const c = cont.querySelector(`[data-cant="${p.id}"]`); c?.focus(); c?.select(); }, 0); },
  });
  cont.addEventListener('click', (e) => { const b = e.target.closest('[data-add]'); if (b) anadir(vistos[b.dataset.add], b); });
  cont.addEventListener('keydown', (e) => { const c = e.target.closest('[data-cant]'); if (c && e.key === 'Enter') { e.preventDefault(); anadir(vistos[c.dataset.cant], cont.querySelector(`[data-add="${c.dataset.cant}"]`)); } });
}

function apuntarHoras(repId, r, recargar, arts = [], h = null) {
  const yo = state.perfil.id;
  const pc = puedeCambiarPrecios();
  const tec = state.perfiles.find((p) => p.id === (h?.tecnico_id || r.tecnico_id || yo)) || state.perfil;
  const tarifa = state.tarifas.find((t) => t.id === r.clientes?.tarifa_id);
  const precioTec = (p) => (tarifa?.precio_hora != null ? tarifa.precio_hora : p?.precio_hora || state.config.precio_hora);
  const art = (v) => arts.find((a) => String(a.id) === String(v));
  const precioDe = (artId, tecId) => (art(artId) ? art(artId).pvp : precioTec(state.perfiles.find((x) => x.id === tecId)));
  // sin permiso, al editar no se puede cambiar el artículo (cambiaría el precio)
  const artFijo = h && !pc;
  modal(h ? 'Editar horas' : 'Apuntar horas', `<div class="form">
    <div class="field"><label for="h-tec">Mecánico</label><select id="h-tec" name="tecnico_id">${tecnicoOpts(tec.id, false)}</select></div>
    <div class="field"><label for="h-f">Fecha</label><input id="h-f" type="date" name="fecha" value="${attr(h?.fecha || today())}" max="${today()}"></div>
    <div class="field full"><label for="h-a">Tipo de trabajo</label><select id="h-a" name="pieza_id" ${artFijo ? 'disabled' : ''}>${opt('', 'Mano de obra (precio del mecánico o de la tarifa)', h?.pieza_id ?? '')}${arts.map((a) => opt(a.id, `${a.nombre} · ${money(a.pvp)}/h`, h?.pieza_id ?? '')).join('')}</select></div>
    <div class="field"><label for="h-h">Horas</label><input id="h-h" type="number" name="horas" min="0.25" max="24" step="0.25" value="${attr(h ? Number(h.horas) : 1)}" inputmode="decimal"></div>
    <div class="field"><label for="h-p">Precio por hora (€)</label><input id="h-p" type="number" name="precio_hora" min="0" step="0.5" value="${attr(h ? h.precio_hora : precioDe('', tec.id))}" ${pc ? '' : 'readonly'}></div>
    <p class="small muted full" style="margin:0" data-nota></p>
    <div class="field full"><label for="h-d">Trabajo realizado</label><input id="h-d" name="descripcion" maxlength="200" value="${attr(h?.descripcion || '')}" placeholder="Ej.: desmontaje de horquilla y cambio de retenes"></div>
  </div>`, {
    okText: h ? 'Guardar' : 'Apuntar',
    onOk: async (root) => {
      const o = Object.fromEntries([...root.querySelectorAll('[name]')].map((e) => [e.name, e.value.trim()]));
      const horas = Number(o.horas);
      if (!(horas > 0 && horas <= 24)) throw new Error('Las horas deben estar entre 0,25 y 24');
      const fila = { tecnico_id: o.tecnico_id, fecha: o.fecha || today(), horas, precio_hora: Number(o.precio_hora) || 0, descripcion: o.descripcion || null };
      if (!artFijo) fila.pieza_id = o.pieza_id ? Number(o.pieza_id) : null;
      if (h) {
        if (!pc) delete fila.precio_hora;
        ok(await sb.from('reparacion_horas').update(fila).eq('id', h.id));
        toast('Horas guardadas');
      } else {
        ok(await sb.from('reparacion_horas').insert({ reparacion_id: repId, ...fila }));
        if (r.estado === 'recibida' || r.estado === 'diagnostico') await sb.from('reparaciones').update({ estado: 'en_reparacion' }).eq('id', repId);
        toast('Horas apuntadas');
      }
      recargar('horas');
    },
  });
  const sel = document.getElementById('h-tec'), selA = document.getElementById('h-a'), pr = document.getElementById('h-p'), nota = document.querySelector('[data-nota]');
  const pintaNota = () => {
    const a = art(selA.value);
    nota.textContent = a ? `Precio del artículo «${a.nombre}».` : tarifa?.precio_hora != null ? `Precio de la tarifa «${tarifa.nombre}» del cliente.` : 'Precio por hora del mecánico.';
    if (!pc) nota.textContent += ' Tu rol no permite cambiarlo.';
  };
  const ponPrecio = () => { if (!(h && !pc)) pr.value = precioDe(selA.value, sel.value); pintaNota(); };
  sel.addEventListener('change', ponPrecio);
  selA.addEventListener('change', ponPrecio);
  pintaNota();
}
