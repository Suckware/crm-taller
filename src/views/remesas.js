// Remesas de recibos al banco (adeudos directos SEPA). Solo el administrador:
// lleva los IBAN de los clientes. La base de datos lo vuelve a comprobar en cada paso.
import { sb, state, esc, attr, ok, money, fdate, fdt, modal, toast, fail, opt, confirmar, isoDay, esAdmin } from '../lib.js';
import { I } from '../icons.js';
import { generarPain008, ibanOculto, idAcreedor, diasHabiles } from '../sepa.js';

const CHIP = { generada: ['Generada', 'warn'], enviada: ['Enviada al banco', 'info'], cobrada: ['Cobrada', 'ok'], anulada: ['Anulada', 'bad'] };
const chipR = (e) => { const [t, c] = CHIP[e] || [e, '']; return `<span class="chip ${c}">${esc(t)}</span>`; };
const CHIP_REC = { incluido: ['Incluido', ''], cobrado: ['Cobrado', 'ok'], devuelto: ['Devuelto', 'bad'], anulado: ['Anulado', 'bad'] };

export async function renderRemesas(T) {
  if (!esAdmin()) return;
  const cfg = state.config;
  const listo = cfg.sepa_iban && cfg.cif;
  const Rm = ok(await sb.from('remesas').select('*').order('id', { ascending: false }).limit(100));
  T.innerHTML = `
  ${listo ? '' : `<div class="aviso"><b>Falta configurar el cobro por banco</b><span>Pon el CIF y la cuenta (IBAN) donde se cobran los recibos en <a href="#/config?t=taller">Configuración › Datos del taller</a>.</span></div>`}
  <section class="card">
    <div class="head"><div><h2>Remesas de recibos</h2><p class="muted small" style="margin:0">Adeudos directos SEPA: el fichero XML que se sube a la banca online (sustituye al antiguo Cuaderno 19). Identificador de acreedor: <b>${esc(idAcreedor(cfg.cif, cfg.sepa_sufijo) || '—')}</b></p></div>
      <button type="button" class="btn pri" data-nueva ${listo ? '' : 'disabled'}>${I.plus} Nueva remesa</button></div>
    <div class="tablewrap"><table><thead><tr><th>Nº</th><th>Creada</th><th>Fecha de cargo</th><th>Tipo</th><th class="right">Recibos</th><th class="right">Total</th><th>Estado</th><th></th></tr></thead>
    <tbody>${Rm.map((r) => `<tr><td><b>${esc(r.numero)}</b></td><td>${fdt(r.creada_en)}</td><td>${fdate(r.fecha_cargo)}</td><td>${r.esquema === 'B2B' ? 'B2B (empresas)' : 'CORE'}</td>
      <td class="right num">${r.n_recibos}</td><td class="right num"><b>${money(r.total)}</b></td><td>${chipR(r.estado)}</td>
      <td class="right" style="white-space:nowrap"><button type="button" class="btn sm" data-ver="${r.id}">Recibos</button> ${r.estado !== 'anulada' ? `<button type="button" class="btn sm" data-xml="${r.id}">Descargar XML</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">Todavía no hay remesas</td></tr>'}</tbody></table></div>
    <p class="muted small" style="margin:0">Pasos: 1) Nueva remesa con las facturas a cobrar. 2) Descarga el XML y súbelo a la banca online. 3) Márcala como enviada. 4) Cuando el banco la abone, márcala como cobrada (las facturas quedan cobradas). Si el banco devuelve algún recibo, márcalo como devuelto y la factura vuelve a estar pendiente.</p>
  </section>`;

  const recargar = () => renderRemesas(T);
  T.querySelector('[data-nueva]')?.addEventListener('click', () => nuevaRemesa(recargar));
  T.querySelectorAll('[data-xml]').forEach((b) => b.addEventListener('click', async () => { try { await descargarXml(Number(b.dataset.xml)); } catch (e) { fail(e); } }));
  T.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => verRemesa(Rm.find((r) => r.id == b.dataset.ver), recargar)));
}

async function descargarXml(id) {
  const [rq, lq] = await Promise.all([
    sb.from('remesas').select('*').eq('id', id).single(),
    sb.from('remesa_recibos').select('*').eq('remesa_id', id).in('estado', ['incluido', 'cobrado', 'devuelto']).order('id'),
  ]);
  const re = ok(rq);
  const xml = generarPain008(re, ok(lq));
  const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
  const a = document.createElement('a');
  a.href = url; a.download = `${re.numero}-SEPA.xml`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('Fichero descargado. Súbelo a la banca online como remesa de adeudos SEPA.');
}

async function nuevaRemesa(recargar) {
  const [fq, bq, vq] = await Promise.all([
    sb.from('facturas').select('id,numero,fecha,total,cliente_id,clientes(nombre,forma_pago)').eq('tipo', 'ordinaria').eq('estado', 'pendiente').gt('total', 0).order('fecha').limit(1000),
    sb.from('datos_bancarios').select('cliente_id,iban,mandato_sepa,fecha_mandato'),
    sb.from('remesa_recibos').select('factura_id').in('estado', ['incluido', 'cobrado']),
  ]);
  const banco = Object.fromEntries(ok(bq).map((b) => [b.cliente_id, b]));
  const enRemesa = new Set(ok(vq).map((x) => x.factura_id));
  const F = ok(fq).filter((f) => !enRemesa.has(f.id)).map((f) => {
    const b = banco[f.cliente_id];
    const falta = !b?.iban ? 'Sin IBAN' : !b.mandato_sepa || !b.fecha_mandato ? 'Sin mandato SEPA' : '';
    return { ...f, b, falta, domiciliado: f.clientes?.forma_pago === 'Domiciliación SEPA' };
  });
  const cargo = isoDay(diasHabiles(3));
  const m = modal('Nueva remesa', `
    <div class="form">
      <div class="field"><label for="rm-f">Fecha de cargo</label><input id="rm-f" type="date" class="inp" value="${attr(cargo)}" min="${attr(isoDay(diasHabiles(1)))}"></div>
      <div class="field"><label for="rm-e">Tipo de adeudo</label><select id="rm-e" class="inp">${opt('CORE', 'CORE (particulares y empresas)', 'CORE')}${opt('B2B', 'B2B (solo empresas, sin devolución)', 'CORE')}</select></div>
    </div>
    <p class="muted small" style="margin:0">Facturas pendientes de cobro. Se marcan las de clientes con forma de pago «Domiciliación SEPA». Para incluir una factura, el cliente necesita IBAN y mandato firmado (ficha › Pagos y banco).</p>
    <div class="tablewrap" style="max-height:50vh;overflow:auto"><table><thead><tr><th style="width:34px"><input type="checkbox" data-all aria-label="Marcar todas"></th><th>Factura</th><th>Fecha</th><th>Cliente</th><th>Cuenta</th><th class="right">Total</th></tr></thead>
    <tbody>${F.map((f) => `<tr><td><input type="checkbox" data-f="${f.id}" ${f.falta ? 'disabled' : f.domiciliado ? 'checked' : ''} aria-label="Incluir ${attr(f.numero)}"></td><td><b>${esc(f.numero)}</b></td><td>${fdate(f.fecha)}</td>
      <td>${esc(f.clientes?.nombre)}</td><td class="small">${f.falta ? `<a href="#/cliente/${f.cliente_id}?t=pago" class="chip bad">${esc(f.falta)}</a>` : esc(ibanOculto(f.b.iban))}</td><td class="right num">${money(f.total)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No hay facturas pendientes de cobro fuera de otras remesas</td></tr>'}</tbody></table></div>
    <p style="margin:0" data-sum></p>`, {
    wide: true, okText: 'Generar remesa y descargar XML',
    onOk: async (root) => {
      const ids = [...root.querySelectorAll('[data-f]:checked')].map((b) => Number(b.dataset.f));
      if (!ids.length) throw new Error('Marca al menos una factura');
      const id = ok(await sb.rpc('crear_remesa', { p_facturas: ids, p_fecha_cargo: root.querySelector('#rm-f').value, p_esquema: root.querySelector('#rm-e').value }));
      toast('Remesa generada');
      try { await descargarXml(id); } catch (e) { fail(e); }
      recargar();
    },
  });
  const boxes = [...m.querySelectorAll('[data-f]')];
  const pinta = () => {
    const sel = F.filter((f) => boxes.find((b) => b.dataset.f == f.id)?.checked);
    m.querySelector('[data-sum]').innerHTML = `<b>${sel.length}</b> recibos · total <b>${money(sel.reduce((s, f) => s + Number(f.total), 0))}</b>`;
  };
  boxes.forEach((b) => b.addEventListener('change', pinta));
  m.querySelector('[data-all]').addEventListener('change', (e) => { boxes.forEach((b) => { if (!b.disabled) b.checked = e.target.checked; }); pinta(); });
  m.querySelectorAll('a[href^="#/cliente/"]').forEach((a) => a.addEventListener('click', () => m.remove()));
  pinta();
}

async function verRemesa(re, recargar) {
  const L = ok(await sb.from('remesa_recibos').select('*,clientes(nombre),facturas(id)').eq('remesa_id', re.id).order('id'));
  const vivo = ['generada', 'enviada'].includes(re.estado);
  const devolvible = ['enviada', 'cobrada'].includes(re.estado);
  const m = modal(`Remesa ${re.numero}`, `
    <p style="margin:0">${chipR(re.estado)} · Cargo el <b>${fdate(re.fecha_cargo)}</b> · ${re.n_recibos} recibos · <b>${money(re.total)}</b></p>
    <div class="tablewrap" style="max-height:50vh;overflow:auto"><table><thead><tr><th>Factura</th><th>Titular</th><th>Cuenta</th><th>Mandato</th><th class="right">Importe</th><th>Estado</th><th></th></tr></thead>
    <tbody>${L.map((r) => { const [t, c] = CHIP_REC[r.estado] || [r.estado, '']; return `<tr><td><a href="#/factura/${r.factura_id}">${esc(r.referencia)}</a></td><td>${esc(r.titular)}</td><td class="small">${esc(ibanOculto(r.iban))}</td>
      <td class="small">${esc(r.mandato)} · ${r.secuencia === 'FRST' ? 'primer cargo' : 'recurrente'}</td><td class="right num">${money(r.importe)}</td>
      <td><span class="chip ${c}">${esc(t)}</span>${r.motivo_devolucion ? `<div class="small muted">${esc(r.motivo_devolucion)}</div>` : ''}</td>
      <td class="right">${devolvible && ['incluido', 'cobrado'].includes(r.estado) ? `<button type="button" class="btn sm danger" data-dev="${r.id}">Devuelto</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>
    <div class="actions">${re.estado === 'generada' ? '<button type="button" class="btn" data-est="enviada">Marcar enviada al banco</button>' : ''}
      ${vivo ? '<button type="button" class="btn pri" data-est="cobrada">Marcar cobrada</button><button type="button" class="btn danger" data-est="anulada">Anular remesa</button>' : ''}</div>`, { wide: true, cancelText: 'Cerrar' });
  m.querySelectorAll('a[href^="#/factura/"]').forEach((a) => a.addEventListener('click', () => m.remove()));
  const TXT = {
    enviada: '¿Marcar la remesa como enviada al banco?',
    cobrada: `¿El banco ya ha abonado la remesa? Las ${re.n_recibos} facturas quedarán cobradas con fecha ${fdate(re.fecha_cargo)}.`,
    anulada: '¿Anular la remesa? Sus facturas quedan libres para otra remesa. Hazlo solo si NO la has subido al banco o el banco la ha rechazado.',
  };
  m.querySelectorAll('[data-est]').forEach((b) => b.addEventListener('click', async () => {
    const e = b.dataset.est;
    if (!(await confirmar(TXT[e], 'Sí'))) return;
    try { ok(await sb.rpc('remesa_cambiar_estado', { p_remesa: re.id, p_estado: e })); toast('Remesa actualizada'); m.remove(); recargar(); } catch (err) { fail(err); }
  }));
  m.querySelectorAll('[data-dev]').forEach((b) => b.addEventListener('click', () => {
    modal('Recibo devuelto', `<p style="margin:0">La factura volverá a quedar <b>pendiente de cobro</b>.</p><div class="form"><div class="field full"><label for="dv-m">Motivo que indica el banco</label><input id="dv-m" class="inp" maxlength="300" placeholder="Ej.: AM04 fondos insuficientes"></div></div>`, {
      okText: 'Marcar como devuelto',
      onOk: async (root) => {
        ok(await sb.rpc('devolver_recibo', { p_recibo: Number(b.dataset.dev), p_motivo: root.querySelector('#dv-m').value }));
        toast('Recibo marcado como devuelto'); m.remove(); recargar();
      },
    });
  }));
}
