import { sb, state, esc, attr, ok, money, fdate, fdt, today, chip, ESTADOS_REP, nombreTecnico, tecnicoOpts, opt, toast, fail, modal, confirmar, puedeFacturar, esOficina, PERIODOS } from '../lib.js';
import { CONDICIONES_DEF, firmaPad } from './recepcion.js';
import { I } from '../icons.js';
import { avisoNotas, alertasVehiculo } from './comun.js';

const firmaOk = (f) => typeof f === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(f);

export async function render(el, params) {
  const id = Number(params.id);
  const tab = params.t || 'resumen';
  const [rq, pq, hq, fq] = await Promise.all([
    sb.from('reparaciones').select('*,clientes(*),motos(*)').eq('id', id).single(),
    sb.from('reparacion_piezas').select('*,piezas(referencia,nombre)').eq('reparacion_id', id).order('id'),
    sb.from('reparacion_horas').select('*').eq('reparacion_id', id).order('fecha'),
    puedeFacturar() ? sb.from('factura_reparaciones').select('facturas(id,numero,total,estado,tipo)').eq('reparacion_id', id) : Promise.resolve({ data: [] }),
  ]);
  const r = ok(rq), piezas = ok(pq), horas = ok(hq);
  const facts = ok(fq).map((x) => x.facturas).filter((f) => f && f.tipo === 'ordinaria' && f.estado !== 'anulada');
  const totPiezas = piezas.reduce((s, p) => s + p.cantidad * p.pvp, 0);
  const totHoras = horas.reduce((s, h) => s + h.horas * h.precio_hora, 0);
  const numHoras = horas.reduce((s, h) => s + Number(h.horas), 0);
  const recargar = (t = tab) => { if (t === tab) render(el, params); else location.hash = `#/reparacion/${id}?t=${t}`; };

  const tabs = [['resumen', 'Resumen'], ['entrada', 'Entrada y autorización'], ['diagnostico', 'Diagnóstico'], ['piezas', `Piezas (${piezas.length})`], ['horas', `Horas (${numHoras.toLocaleString('es-ES')})`]];
  if (puedeFacturar()) tabs.push(['factura', 'Factura']);
  const moto = r.motos ? `${r.motos.marca} ${r.motos.modelo}` : 'Sin moto';

  el.innerHTML = `
  <div class="head">
    <div class="t"><div class="muted small"><a href="#/reparaciones">Reparaciones</a> › ${esc(r.numero)}</div>
      <h1>${esc(r.numero)} · ${esc(moto)}</h1>
      <div class="muted">${esc(r.motos?.matricula || '')} · <a href="#/cliente/${r.cliente_id}">${esc(r.clientes.nombre)}</a>${r.clientes.telefono ? ` · <a href="tel:${attr(r.clientes.telefono)}">${esc(r.clientes.telefono)}</a>` : ''}</div></div>
    <div class="actions" style="align-items:center">${chip(ESTADOS_REP, r.estado)}
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
      <div class="kpi"><span class="l">Piezas</span><span class="v" style="font-size:20px">${money(totPiezas)}</span><span class="l">${piezas.length} líneas</span></div>
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
    T.innerHTML = `<section class="card">
      <div class="head"><h2>Piezas usadas</h2><button type="button" class="btn pri" data-add>${I.plus} Añadir pieza del almacén</button></div>
      <p class="muted small" style="margin:0">Al añadir una pieza se descuenta del stock. Si la quitas, vuelve al almacén.</p>
      <div class="tablewrap"><table><thead><tr><th class="hide-movil">Ref.</th><th>Pieza</th><th class="right">Cant.</th><th class="right">PVP</th><th class="right">Importe</th><th></th></tr></thead><tbody>
      ${piezas.map((p) => `<tr><td class="small hide-movil">${esc(p.piezas.referencia)}</td><td>${esc(p.piezas.nombre)}<div class="small muted">${esc(p.piezas.referencia)}</div></td><td class="right num">${p.cantidad}</td><td class="right num">${money(p.pvp)}</td><td class="right num">${money(p.cantidad * p.pvp)}</td><td class="right"><button type="button" class="btn sm danger" data-del="${p.id}">Quitar</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Sin piezas</td></tr>'}
      </tbody><tfoot><tr><td class="hide-movil"></td><td colspan="3" class="right">Total piezas</td><td class="right num">${money(totPiezas)}</td><td></td></tr></tfoot></table></div></section>`;
    T.querySelector('[data-add]').addEventListener('click', () => anadirPieza(id, recargar));
    T.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmar('¿Quitar esta pieza? Volverá al stock del almacén.', 'Quitar'))) return;
      try { ok(await sb.from('reparacion_piezas').delete().eq('id', b.dataset.del)); toast('Pieza devuelta al almacén'); recargar(); } catch (e) { fail(e); }
    }));
  }

  if (tab === 'horas') {
    const porTec = {};
    horas.forEach((h) => { porTec[h.tecnico_id] = (porTec[h.tecnico_id] || 0) + Number(h.horas); });
    T.innerHTML = `<section class="card">
      <div class="head"><h2>Horas por mecánico</h2><button type="button" class="btn pri" data-add>${I.plus} Apuntar horas</button></div>
      <div class="actions">${Object.entries(porTec).map(([t, n]) => `<span class="chip info">${esc(nombreTecnico(t))}: ${n.toLocaleString('es-ES')} h</span>`).join('')}</div>
      <div class="tablewrap"><table><thead><tr><th>Fecha</th><th>Mecánico</th><th>Trabajo</th><th class="right">Horas</th><th class="right">€/h</th><th class="right">Importe</th><th></th></tr></thead><tbody>
      ${horas.map((h) => `<tr><td>${fdate(h.fecha)}</td><td>${esc(nombreTecnico(h.tecnico_id))}</td><td>${esc(h.descripcion || '')}</td><td class="right num">${Number(h.horas).toLocaleString('es-ES')}</td><td class="right num">${money(h.precio_hora)}</td><td class="right num">${money(h.horas * h.precio_hora)}</td><td class="right"><button type="button" class="btn sm danger" data-del="${h.id}">Quitar</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">Sin horas apuntadas</td></tr>'}
      </tbody><tfoot><tr><td colspan="3" class="right">Total</td><td class="right num">${numHoras.toLocaleString('es-ES')}</td><td></td><td class="right num">${money(totHoras)}</td><td></td></tr></tfoot></table></div></section>`;
    T.querySelector('[data-add]').addEventListener('click', () => apuntarHoras(id, r, recargar));
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
  const m = modal('Añadir pieza del almacén', `
    <input type="search" class="inp" placeholder="Buscar por nombre o referencia…" data-q aria-label="Buscar pieza" maxlength="60">
    <div class="list" data-res style="margin-top:10px"></div>`, {});
  const res = m.querySelector('[data-res]');
  async function buscar(s) {
    s = s.replace(/[%,()*]/g, ' ').trim();
    let q = sb.from('piezas').select('id,referencia,nombre,stock,pvp,ubicacion').order('nombre').limit(25);
    if (s) q = q.or(`nombre.ilike.%${s}%,referencia.ilike.%${s}%,marca.ilike.%${s}%`);
    const P = (await q).data || [];
    res.innerHTML = P.map((p) => `<div><span class="grow"><b>${esc(p.nombre)}</b><span class="muted small">${esc(p.referencia)} · ${money(p.pvp)} · ${p.ubicacion ? esc(p.ubicacion) + ' · ' : ''}<b style="color:${p.stock > 0 ? 'var(--ok)' : 'var(--bad)'}">stock ${p.stock}</b></span></span>
      <input type="number" class="inp" value="1" min="1" max="${Math.max(p.stock, 1)}" style="width:70px" aria-label="Cantidad" data-cant="${p.id}">
      <button type="button" class="btn sm pri" data-pick="${p.id}" ${p.stock <= 0 ? 'disabled' : ''}>Añadir</button></div>`).join('') || '<div class="empty">Sin resultados</div>';
    res.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', async () => {
      const p = P.find((x) => x.id == b.dataset.pick);
      const cant = Math.floor(Number(res.querySelector(`[data-cant="${p.id}"]`).value) || 1);
      if (cant < 1 || cant > p.stock) { toast(`Solo hay ${p.stock} en stock`, true); return; }
      b.disabled = true;
      try { ok(await sb.from('reparacion_piezas').insert({ reparacion_id: repId, pieza_id: p.id, cantidad: cant, pvp: p.pvp })); m.remove(); toast(`${p.nombre}: descontado del stock`); recargar('piezas'); } catch (e) { fail(e); b.disabled = false; }
    }));
  }
  let t; m.querySelector('[data-q]').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => buscar(e.target.value), 250); });
  buscar('');
}

function apuntarHoras(repId, r, recargar) {
  const yo = state.perfil.id;
  const tec = state.perfiles.find((p) => p.id === (r.tecnico_id || yo)) || state.perfil;
  const tarifa = state.tarifas.find((t) => t.id === r.clientes?.tarifa_id);
  const precioDe = (p) => (tarifa?.precio_hora != null ? tarifa.precio_hora : p?.precio_hora || state.config.precio_hora);
  modal('Apuntar horas', `<div class="form">
    <div class="field"><label for="h-tec">Mecánico</label><select id="h-tec" name="tecnico_id">${tecnicoOpts(tec.id, false)}</select></div>
    <div class="field"><label for="h-f">Fecha</label><input id="h-f" type="date" name="fecha" value="${today()}" max="${today()}"></div>
    <div class="field"><label for="h-h">Horas</label><input id="h-h" type="number" name="horas" min="0.25" max="24" step="0.25" value="1" inputmode="decimal"></div>
    <div class="field"><label for="h-p">Precio por hora (€)</label><input id="h-p" type="number" name="precio_hora" min="0" step="0.5" value="${attr(precioDe(tec))}" ${esOficina() ? '' : 'readonly'}></div>${tarifa?.precio_hora != null ? `<p class="small muted full" style="margin:0">Precio de la tarifa «${esc(tarifa.nombre)}» del cliente.</p>` : ''}
    <div class="field full"><label for="h-d">Trabajo realizado</label><input id="h-d" name="descripcion" maxlength="200" placeholder="Ej.: desmontaje de horquilla y cambio de retenes"></div>
  </div>`, {
    okText: 'Apuntar',
    onOk: async (root) => {
      const o = Object.fromEntries([...root.querySelectorAll('[name]')].map((e) => [e.name, e.value.trim()]));
      const horas = Number(o.horas);
      if (!(horas > 0 && horas <= 24)) throw new Error('Las horas deben estar entre 0,25 y 24');
      ok(await sb.from('reparacion_horas').insert({ reparacion_id: repId, tecnico_id: o.tecnico_id, fecha: o.fecha || today(), horas, precio_hora: Number(o.precio_hora) || 0, descripcion: o.descripcion || null }));
      if (r.estado === 'recibida' || r.estado === 'diagnostico') await sb.from('reparaciones').update({ estado: 'en_reparacion' }).eq('id', repId);
      toast('Horas apuntadas'); recargar('horas');
    },
  });
  const sel = document.getElementById('h-tec');
  sel.addEventListener('change', () => { const p = state.perfiles.find((x) => x.id === sel.value); if (p) document.getElementById('h-p').value = precioDe(p); });
}
