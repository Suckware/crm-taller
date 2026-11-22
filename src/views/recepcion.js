import { sb, state, esc, attr, ok, today, tecnicoOpts, opt, toast, fail, formData } from '../lib.js';
import { selectorClienteMoto } from './comun.js';

export const CONDICIONES_DEF = `1. El cliente autoriza al taller a realizar los trabajos indicados y las pruebas necesarias, incluida la circulación por vía pública y el banco de potencia.
2. Cualquier trabajo adicional o que supere el importe máximo autorizado se comunicará al cliente antes de realizarse.
3. El cliente tiene derecho a presupuesto previo por escrito. Si renuncia a él, lo hace constar con su firma.
4. Las piezas sustituidas quedarán a disposición del cliente salvo que indique lo contrario.
5. Pasados 15 días desde el aviso de finalización sin retirar el vehículo, podrán cobrarse gastos de estancia.
6. Los datos personales se tratan para la gestión de la reparación y la facturación, conforme al RGPD.`;

export async function render(el, params) {
  let ini = {};
  let cita = null;
  if (params.cita) {
    cita = ok(await sb.from('citas').select('*,clientes(id,nombre,telefono),motos(*)').eq('id', params.cita).maybeSingle());
    if (cita) ini = { cliente: cita.clientes, moto: cita.motos };
  }
  const st = { cliente: null, moto: null };
  el.innerHTML = `
  <div class="head"><div class="t"><h1>Recibir moto</h1><div class="muted">Hoja de autorización de reparación</div></div><div class="actions"><a class="btn" href="#/">Cancelar</a></div></div>
  <div class="row">
    <section class="card"><h2>Cliente y moto</h2><div data-cli></div></section>
    <section class="card wide"><h2>Estado de entrada</h2>
      <div class="form" data-f>
        <div class="field"><label for="r-km">Kilómetros</label><input id="r-km" name="km_entrada" type="number" min="0" max="999999" inputmode="numeric"></div>
        <div class="field"><label for="r-comb">Combustible</label><select id="r-comb" name="combustible">${['Reserva', '1/4', '1/2', '3/4', 'Lleno'].map((x) => opt(x, x, '1/2')).join('')}</select></div>
        <div class="field"><label for="r-tec">Técnico asignado</label><select id="r-tec" name="tecnico_id">${tecnicoOpts(cita?.tecnico_id || '')}</select></div>
        <div class="field"><label for="r-prev">Fecha prevista de entrega</label><input id="r-prev" name="fecha_prevista" type="date" min="${today()}"></div>
        <div class="field full"><label for="r-mot">Motivo de la visita / lo que nota el cliente *</label><textarea id="r-mot" name="motivo" maxlength="2000" required>${esc(cita?.notas || (cita ? cita.servicio : ''))}</textarea></div>
        <div class="field full"><label for="r-trab">Trabajos que autoriza</label><textarea id="r-trab" name="trabajos_autorizados" maxlength="2000" placeholder="Ej.: diagnóstico, cambio de aceite y filtro, revisión de frenos"></textarea></div>
        <div class="field"><label for="r-max">Importe máximo autorizado (€)</label><input id="r-max" name="importe_max_autorizado" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Sin límite: avisar antes"></div>
        <div class="field"><label for="r-obj">Objetos que deja (casco, maletas…)</label><input id="r-obj" name="objetos_personales" maxlength="300"></div>
        <div class="field full"><label for="r-vis">Daños o golpes visibles</label><textarea id="r-vis" name="estado_visual" maxlength="1000" placeholder="Ej.: arañazo en el carenado izquierdo, retrovisor derecho suelto"></textarea></div>
      </div>
    </section>
  </div>
  <section class="card">
    <h2>Condiciones y firma del cliente</h2>
    <div class="terms">${esc(state.config.condiciones_autorizacion || CONDICIONES_DEF)}</div>
    <label class="check"><input type="checkbox" data-acepta> El cliente ha leído y acepta las condiciones y autoriza los trabajos indicados.</label>
    <div class="field"><label for="r-firmante">Nombre de quien firma</label><input id="r-firmante" class="inp" maxlength="120" data-firmante></div>
    <div class="lbl">Firma (con el dedo o el ratón)</div>
    <canvas class="sig" data-sig aria-label="Zona de firma"></canvas>
    <div class="actions"><button type="button" class="btn sm" data-limpiar>Borrar firma</button></div>
    <div class="actions" style="justify-content:flex-end">
      <button type="button" class="btn" data-sinfirma>Guardar sin firma</button>
      <button type="button" class="btn pri" data-guardar>Firmar y abrir orden de reparación</button>
    </div>
  </section>`;

  selectorClienteMoto(el.querySelector('[data-cli]'), (s) => {
    st.cliente = s.cliente; st.moto = s.moto;
    const f = el.querySelector('[data-firmante]'); if (s.cliente && !f.value) f.value = s.cliente.nombre;
    if (s.moto?.km && !el.querySelector('#r-km').value) el.querySelector('#r-km').value = s.moto.km;
  }, ini);
  const pad = firmaPad(el.querySelector('[data-sig]'));
  el.querySelector('[data-limpiar]').addEventListener('click', pad.clear);

  async function guardar(conFirma, btn) {
    btn.disabled = true;
    try {
      if (!st.cliente) throw new Error('Elige el cliente');
      const o = formData(el.querySelector('[data-f]'));
      if (!o.motivo) throw new Error('Escribe el motivo de la visita');
      const acepta = el.querySelector('[data-acepta]').checked;
      if (conFirma) {
        if (!acepta) throw new Error('El cliente debe aceptar las condiciones');
        if (pad.empty()) throw new Error('Falta la firma del cliente');
      }
      const rep = {
        cliente_id: st.cliente.id, moto_id: st.moto?.id || null, cita_id: cita?.id || null,
        km_entrada: o.km_entrada ? Number(o.km_entrada) : null, combustible: o.combustible, tecnico_id: o.tecnico_id,
        fecha_prevista: o.fecha_prevista, motivo: o.motivo, trabajos_autorizados: o.trabajos_autorizados,
        importe_max_autorizado: o.importe_max_autorizado ? Number(o.importe_max_autorizado) : null,
        objetos_personales: o.objetos_personales, estado_visual: o.estado_visual, acepta_condiciones: conFirma && acepta,
        firma: conFirma ? pad.data() : null, firmado_en: conFirma ? new Date().toISOString() : null,
        firmado_por: conFirma ? (el.querySelector('[data-firmante]').value.trim() || st.cliente.nombre) : null,
        estado: 'recibida',
      };
      const r = ok(await sb.from('reparaciones').insert(rep).select('id,numero').single());
      if (st.moto && rep.km_entrada) await sb.from('motos').update({ km: rep.km_entrada }).eq('id', st.moto.id);
      if (cita) await sb.from('citas').update({ estado: 'en_taller' }).eq('id', cita.id);
      toast(`Orden ${r.numero} creada`);
      location.hash = `#/reparacion/${r.id}`;
    } catch (e) { fail(e); btn.disabled = false; }
  }
  el.querySelector('[data-guardar]').addEventListener('click', (e) => guardar(true, e.currentTarget));
  el.querySelector('[data-sinfirma]').addEventListener('click', (e) => guardar(false, e.currentTarget));
}

export function firmaPad(canvas) {
  const ctx = canvas.getContext('2d');
  let drawing = false, dirty = false, last = null;
  function size() {
    const r = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
    canvas.width = r.width * dpr; canvas.height = r.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111827';
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, r.width, r.height); dirty = false;
  }
  size();
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', (e) => { drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId); e.preventDefault(); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return; const p = pos(e);
    ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke(); last = p; dirty = true; e.preventDefault();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => canvas.addEventListener(t, () => { drawing = false; }));
  return {
    clear: size,
    empty: () => !dirty,
    data: () => {
      // exporta reducida para no pesar demasiado
      const c = document.createElement('canvas'); const w = 600; const h = Math.round(w * canvas.height / canvas.width);
      c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(canvas, 0, 0, w, h);
      return c.toDataURL('image/png');
    },
  };
}
export { attr };
