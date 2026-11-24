import { sb, state, esc, attr, ok, modal, toast, formData, req, field, area, opt, fdate, today, money, chip, ESTADOS_REP, puedeFacturar } from '../lib.js';

const limpiar = (s) => (s || '').replace(/[%,()*]/g, ' ').trim();

// ---------- Aviso de notas del cliente (se muestra al agendar / recibir) ----------
export function avisoNotas(cliente) {
  if (!cliente?.notas_agenda) return '';
  return `<div class="aviso" role="note"><b>Nota del cliente</b><span>${esc(cliente.notas_agenda)}</span></div>`;
}

// ---------- Buscador de cliente + selección/alta de vehículo ----------
export function selectorClienteMoto(root, onChange, inicial = {}) {
  const st = { cliente: inicial.cliente || null, moto: inicial.moto || null, motos: [] };
  root.innerHTML = `
    <div class="field"><label for="bc">Cliente</label>
      <div class="combo"><input id="bc" type="search" class="inp" placeholder="Elige o busca un cliente…" autocomplete="off" maxlength="60"><button type="button" class="combo-btn" data-abrir aria-label="Ver todos los clientes">▾</button></div></div>
    <div data-res class="list desplegable"></div>
    <div data-sel></div>`;
  const inp = root.querySelector('#bc');
  const res = root.querySelector('[data-res]');
  const sel = root.querySelector('[data-sel]');
  let timer;
  const COLS = 'id,nombre,telefono,notas_agenda,tarifa_id,descuento_pct';

  async function buscar(t) {
    const s = limpiar(t);
    if (s.length < 2) {
      // sin texto: despliega todos los clientes por orden alfabético
      const todos = ok(await sb.from('clientes').select(COLS).eq('es_cliente', true).order('nombre').limit(200));
      return pintarLista(todos, '');
    }
    const [a, b, c] = await Promise.all([
      sb.from('clientes').select(COLS).eq('es_cliente', true).or(`nombre.ilike.%${s}%,telefono.ilike.%${s}%,nombre_comercial.ilike.%${s}%`).limit(8),
      sb.from('motos').select(`cliente_id,clientes(${COLS})`).or(`matricula.ilike.%${s}%,bastidor.ilike.%${s}%`).limit(5),
      sb.from('contactos').select(`cliente_id,clientes(${COLS})`).ilike('nombre', `%${s}%`).limit(5),
    ]);
    const lista = [...(a.data || [])];
    [...(b.data || []), ...(c.data || [])].forEach((m) => { if (m.clientes && !lista.find((x) => x.id === m.clientes.id)) lista.push(m.clientes); });
    pintarLista(lista, s);
  }
  function pintarLista(lista, s) {
    res.innerHTML = `<button type="button" class="linkbtn nuevo" data-nuevo>+ Crear cliente nuevo${s ? ` «${esc(s)}»` : ''}</button>`
      + (lista.length ? '' : '<div class="muted small" style="padding:8px 4px">No hay clientes que coincidan</div>')
      + lista.map((c) => `<button type="button" class="linkbtn" data-c="${c.id}" style="text-align:left;color:inherit;font-weight:400"><span class="grow"><b>${esc(c.nombre)}</b><span class="muted small">${esc(c.telefono || '')}${c.notas_agenda ? ' · tiene notas' : ''}</span></span></button>`).join('');
    res.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => elegir(lista.find((c) => c.id == b.dataset.c))));
    res.querySelector('[data-nuevo]').addEventListener('click', () => nuevoCliente(s, elegir));
  }
  inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => buscar(inp.value), 250); });
  inp.addEventListener('focus', () => { if (!res.innerHTML) buscar(inp.value); });
  root.querySelector('[data-abrir]').addEventListener('click', () => { if (res.innerHTML) res.innerHTML = ''; else buscar(inp.value); });
  const fuera = (e) => { if (!root.isConnected) return document.removeEventListener('pointerdown', fuera); if (!root.contains(e.target) && !e.target.closest('.modal, .overlay')) res.innerHTML = ''; };
  document.addEventListener('pointerdown', fuera);

  async function elegir(c, motoId) {
    res.innerHTML = ''; inp.value = '';
    const [full, motos] = await Promise.all([
      sb.from('clientes').select(COLS).eq('id', c.id).single(),
      sb.from('motos').select('*').eq('cliente_id', c.id).order('id'),
    ]);
    st.cliente = ok(full); st.motos = ok(motos);
    st.moto = st.motos.find((m) => m.id == motoId) || st.motos[0] || null;
    pintar(); onChange(st);
  }
  function pintar() {
    if (!st.cliente) { sel.innerHTML = ''; inp.parentElement.style.display = ''; return; }
    inp.parentElement.style.display = 'none';
    sel.innerHTML = `
      <div class="card flat" style="padding:14px;gap:10px">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><div style="flex:1 1 180px;min-width:0"><b>${esc(st.cliente.nombre)}</b><div class="muted small">${esc(st.cliente.telefono || '')}</div></div><div class="actions"><button type="button" class="btn sm" data-editar>Editar datos</button><button type="button" class="btn sm" data-cambiar>Cambiar cliente</button></div></div>
        ${avisoNotas(st.cliente)}
        <div class="field"><label for="selmoto">Vehículo</label><select id="selmoto" class="inp">${st.motos.map((m) => `<option value="${m.id}" ${st.moto?.id === m.id ? 'selected' : ''}>${esc(`${m.marca} ${m.modelo} · ${m.matricula || 'sin matrícula'}`)}</option>`).join('')}<option value="">Sin vehículo</option></select></div>
        <div data-alertas-moto></div>
        <div class="actions">${st.moto ? '<button type="button" class="linkbtn" data-em style="text-align:left">Editar datos del vehículo</button>' : ''}<button type="button" class="linkbtn" data-nm style="text-align:left">+ Añadir otro vehículo a este cliente</button></div>
      </div>`;
    sel.querySelector('[data-cambiar]').addEventListener('click', () => { st.cliente = null; st.moto = null; pintar(); onChange(st); inp.focus(); });
    sel.querySelector('#selmoto').addEventListener('change', (e) => { st.moto = st.motos.find((m) => m.id == e.target.value) || null; alertasMoto(); onChange(st); });
    sel.querySelector('[data-editar]').addEventListener('click', () => editarClienteRapido(st.cliente.id, (c) => elegir(c, st.moto?.id)));
    sel.querySelector('[data-em]')?.addEventListener('click', () => editarVehiculo(st.moto, (m) => elegir(st.cliente, m?.id ?? st.moto?.id)));
    sel.querySelector('[data-nm]').addEventListener('click', () => editarVehiculo({ cliente_id: st.cliente.id }, (m) => elegir(st.cliente, m.id)));
    alertasMoto();
  }
  function alertasMoto() {
    const box = sel.querySelector('[data-alertas-moto]'); if (!box) return;
    const a = alertasVehiculo(st.moto);
    box.innerHTML = a.length ? `<div class="aviso">${a.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : '';
  }
  if (st.cliente) elegir(st.cliente, st.moto?.id);
  return st;
}

export function alertasVehiculo(m) {
  if (!m) return [];
  const out = []; const hoy = today();
  const en30 = new Date(); en30.setDate(en30.getDate() + 30);
  if (m.fecha_itv && m.fecha_itv <= isoD(en30)) out.push(`ITV ${m.fecha_itv < hoy ? 'caducada' : 'vence'} el ${fdate(m.fecha_itv)}`);
  if (m.proxima_revision_fecha && m.proxima_revision_fecha <= isoD(en30)) out.push(`Revisión prevista el ${fdate(m.proxima_revision_fecha)}`);
  if (m.proxima_revision_km && m.km && m.km >= m.proxima_revision_km - 500) out.push(`Revisión a los ${m.proxima_revision_km.toLocaleString('es-ES')} km (lleva ${m.km.toLocaleString('es-ES')})`);
  return out;
}
const isoD = (d) => d.toISOString().slice(0, 10);

// ---------- Ficha de cliente / proveedor ----------
export function formCliente(c = {}, { completo = true } = {}) {
  const esCli = c.es_cliente ?? true, esProv = c.es_proveedor ?? false;
  const campos = state.campos.filter((x) => x.entidad === 'cliente');
  return `<div class="form">
    <div class="field full"><span class="lbl">Rol</span><div class="actions">
      <label class="check"><input type="checkbox" name="es_cliente" ${esCli ? 'checked' : ''}> Cliente</label>
      <label class="check"><input type="checkbox" name="es_proveedor" ${esProv ? 'checked' : ''}> Proveedor</label></div></div>
    <div class="field"><label for="f-tipo">Tipo</label><select id="f-tipo" name="tipo">${opt('particular', 'Particular', c.tipo || 'particular')}${opt('empresa', 'Empresa', c.tipo)}</select></div>
    ${field('Nombre / razón social *', 'nombre', c.nombre, 'text', 'maxlength="120" required')}
    ${completo ? field('Nombre comercial', 'nombre_comercial', c.nombre_comercial, 'text', 'maxlength="120"') : ''}
    ${field('NIF / CIF', 'nif', c.nif, 'text', 'maxlength="20"')}
    ${field('Teléfono', 'telefono', c.telefono, 'tel', 'maxlength="20" inputmode="tel"')}
    ${field('Email', 'email', c.email, 'email', 'maxlength="120"')}
    ${completo ? field('Web', 'web', c.web, 'url', 'maxlength="120"') : ''}
    ${field('Dirección', 'direccion', c.direccion, 'text', 'maxlength="200"')}
    ${field('Código postal', 'codigo_postal', c.codigo_postal, 'text', 'maxlength="5" inputmode="numeric" autocomplete="off" placeholder="Ej.: 35500"') + field('Población', 'poblacion', c.poblacion, 'text', 'maxlength="80"') + field('Provincia', 'provincia', c.provincia, 'text', 'maxlength="60"')}
    <div class="field"><label for="f-tar">Tarifa</label><select id="f-tar" name="tarifa_id">${opt('', '—', c.tarifa_id ?? '')}${state.tarifas.filter((t) => t.activa || t.id === c.tarifa_id).map((t) => opt(t.id, `${t.nombre}${Number(t.descuento_pct) ? ` (${Number(t.descuento_pct)} %)` : ''}`, c.tarifa_id)).join('')}</select></div>
    ${field('Descuento fijo (%)', 'descuento_pct', c.descuento_pct ?? 0, 'number', 'min="0" max="100" step="0.5"')}
    <div class="field full"><label for="f-na">Notas que se muestran al agendar</label><textarea id="f-na" name="notas_agenda" maxlength="500" placeholder="Ej.: solo puede por las tardes, avisar antes de superar el presupuesto…">${esc(c.notas_agenda || '')}</textarea></div>
    ${area('Notas internas', 'notas', c.notas, 'maxlength="1000"')}
    ${completo && campos.length ? `<div class="field full"><span class="lbl">Otros datos</span></div>${campos.map((k) => campoExtra(k, (c.campos_extra || {})[k.nombre])).join('')}` : ''}
  </div>`;
}
export function campoExtra(k, v) {
  const n = `x__${k.id}`;
  if (k.tipo === 'si_no') return `<label class="check"><input type="checkbox" name="${n}" ${v ? 'checked' : ''}> ${esc(k.nombre)}</label>`;
  const t = { texto: 'text', numero: 'number', fecha: 'date' }[k.tipo];
  return `<div class="field"><label for="f-${n}">${esc(k.nombre)}</label><input id="f-${n}" name="${n}" type="${t}" value="${attr(v ?? '')}" maxlength="200"></div>`;
}
// Extrae los campos personalizados del objeto del formulario
export function extraerExtras(o, entidad, previos = {}) {
  const out = { ...previos };
  state.campos.filter((k) => k.entidad === entidad).forEach((k) => {
    const n = `x__${k.id}`; if (!(n in o)) return;
    let v = o[n]; delete o[n];
    if (k.tipo === 'numero' && v !== null) v = Number(v);
    if (v === null || v === '' || v === false) delete out[k.nombre]; else out[k.nombre] = v;
  });
  return out;
}
export function validarCliente(o, previo = {}) {
  req(o, [['nombre', 'nombre']]);
  if (!o.es_cliente && !o.es_proveedor) throw new Error('Marca si es cliente, proveedor o ambos');
  if (o.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.email)) throw new Error('El email no es válido');
  if (o.telefono && !/^[+\d\s()-]{6,20}$/.test(o.telefono)) throw new Error('El teléfono no es válido');
  if (o.web && !/^https?:\/\//i.test(o.web)) o.web = 'https://' + o.web;
  if (o.nif) o.nif = o.nif.toUpperCase();
  o.tarifa_id = o.tarifa_id ? Number(o.tarifa_id) : null;
  o.descuento_pct = Math.min(100, Math.max(0, Number(o.descuento_pct) || 0));
  if ('codigo_postal' in o || Object.keys(o).some((k) => k.startsWith('x__'))) o.campos_extra = extraerExtras(o, 'cliente', previo.campos_extra || {});
  return o;
}

// Editar la ficha del cliente sin salir de la cita o la recepción
export async function editarClienteRapido(id, cb) {
  const c = ok(await sb.from('clientes').select('*').eq('id', id).single());
  modal(`Editar ${c.nombre}`, formCliente(c, { completo: false }) + '<p class="muted small" style="margin:8px 0 0">Contactos, datos de pago y el resto de la ficha se cambian en Clientes.</p>', {
    okText: 'Guardar cambios', wide: true,
    onOk: async (root) => {
      const o = validarCliente(formData(root), c);
      const n = ok(await sb.from('clientes').update(o).eq('id', id).select().single());
      toast('Ficha del cliente actualizada');
      cb(n);
    },
  });
}

export function nuevoCliente(texto, cb, { proveedor = false } = {}) {
  const pre = /^[+\d\s]{6,}$/.test(texto || '') ? { telefono: texto } : { nombre: texto };
  if (proveedor) { pre.es_cliente = false; pre.es_proveedor = true; pre.tipo = 'empresa'; }
  modal(proveedor ? 'Nuevo proveedor' : 'Nuevo cliente', formCliente(pre, { completo: false }) + (proveedor ? '' : '<h3 style="margin-top:16px">Vehículo (opcional)</h3>' + formVehiculoBasico('m_')), {
    okText: 'Crear', wide: true,
    onOk: async (root) => {
      const o = formData(root);
      const veh = {}; Object.keys(o).filter((k) => k.startsWith('m_')).forEach((k) => { veh[k.slice(2)] = o[k]; delete o[k]; });
      const cli = validarCliente(o);
      const c = ok(await sb.from('clientes').insert(cli).select().single());
      let motoId;
      if (veh.marca && veh.modelo) {
        const m = ok(await sb.from('motos').insert(vehiculoDe(veh, c.id)).select().single());
        motoId = m.id;
      }
      toast(proveedor ? 'Proveedor creado' : 'Cliente creado');
      cb(c, motoId);
    },
  });
}

// ---------- Vehículo ----------
const MARCAS = ['Yamaha', 'Honda', 'Kawasaki', 'Suzuki', 'KTM', 'Ducati', 'BMW', 'Triumph', 'Aprilia', 'Husqvarna', 'GasGas', 'Beta', 'Sherco', 'Piaggio', 'Vespa', 'Kymco', 'SYM', 'Harley-Davidson', 'Royal Enfield'];
function formVehiculoBasico(p = '') {
  return `<div class="form">
    ${field('Matrícula', p + 'matricula', '', 'text', 'maxlength="15" style="text-transform:uppercase"')}
    ${field('Marca', p + 'marca', '', 'text', 'maxlength="40" list="marcas"')}
    ${field('Modelo', p + 'modelo', '', 'text', 'maxlength="60"')}
    ${field('Kilómetros', p + 'km', '', 'number', 'min="0" max="999999"')}
    <datalist id="marcas">${MARCAS.map((x) => `<option value="${x}">`).join('')}</datalist></div>`;
}

export function vehiculoDe(o, clienteId) {
  const n = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  return {
    cliente_id: clienteId, marca: o.marca, modelo: o.modelo, matricula: o.matricula?.toUpperCase() || null,
    bastidor: o.bastidor?.toUpperCase() || null, color: o.color ?? null, tipo: o.tipo || 'moto',
    combustible: o.combustible ?? null, estado: o.estado ?? null, motor: o.motor ?? null,
    anio: n(o.anio), km: n(o.km), cilindrada: n(o.cilindrada),
    fecha_matriculacion: o.fecha_matriculacion ?? null, fecha_itv: o.fecha_itv ?? null,
    ultima_revision_fecha: o.ultima_revision_fecha ?? null, ultima_revision_km: n(o.ultima_revision_km),
    proxima_revision_fecha: o.proxima_revision_fecha ?? null, proxima_revision_km: n(o.proxima_revision_km),
    notas: o.notas ?? null,
  };
}

// Ficha completa del vehículo, con propietario buscable entre los clientes
export async function editarVehiculo(m, cb) {
  m = m || {};
  let propietario = null;
  let ultimaVisita = null;
  if (m.cliente_id) propietario = ok(await sb.from('clientes').select('id,nombre,telefono').eq('id', m.cliente_id).single());
  if (m.id) {
    const r = (await sb.from('reparaciones').select('fecha_entrada').eq('moto_id', m.id).order('fecha_entrada', { ascending: false }).limit(1)).data;
    ultimaVisita = r?.[0]?.fecha_entrada || null;
  }
  const campos = state.campos.filter((x) => x.entidad === 'vehiculo');
  const sec = (t) => `<div class="field full" style="margin-top:6px"><span class="lbl" style="font-size:14px">${esc(t)}</span></div>`;
  const root = modal(m.id ? `${m.marca} ${m.modelo}` : 'Nuevo vehículo', `
    <div class="form">
      ${sec('Identificación')}
      ${field('Matrícula', 'matricula', m.matricula, 'text', 'maxlength="15" style="text-transform:uppercase"')}
      ${field('Nº de bastidor (VIN)', 'bastidor', m.bastidor, 'text', 'maxlength="17" style="text-transform:uppercase" pattern="[A-HJ-NPR-Za-hj-npr-z0-9]{11,17}"')}
      <div class="field"><label for="f-tipo">Tipo</label><select id="f-tipo" name="tipo">${['moto', 'scooter', 'quad', 'ciclomotor', 'otro'].map((t) => opt(t, t[0].toUpperCase() + t.slice(1), m.tipo || 'moto')).join('')}</select></div>
      ${field('Marca *', 'marca', m.marca, 'text', 'maxlength="40" list="marcas2"')}
      ${field('Modelo *', 'modelo', m.modelo, 'text', 'maxlength="60"')}
      ${field('Color', 'color', m.color, 'text', 'maxlength="30"')}
      <div class="field full"><span class="lbl">Propietario</span><div data-prop></div></div>
      ${sec('Características')}
      <div class="field"><label for="f-comb">Carburante</label><select id="f-comb" name="combustible">${opt('', '—', m.combustible ?? '')}${['Gasolina', 'Gasolina (mezcla 2T)', 'Eléctrico', 'Híbrido', 'Diésel'].map((x) => opt(x, x, m.combustible)).join('')}</select></div>
      ${field('Motor', 'motor', m.motor, 'text', 'maxlength="80" placeholder="Ej.: 4T bicilíndrico"')}
      ${field('Cilindrada (cc)', 'cilindrada', m.cilindrada, 'number', 'min="0" max="5000"')}
      ${field('Año del modelo', 'anio', m.anio, 'number', 'min="1950" max="2035"')}
      ${field('Fecha de matriculación', 'fecha_matriculacion', m.fecha_matriculacion, 'date')}
      ${field('Kilómetros actuales', 'km', m.km, 'number', 'min="0" max="999999"')}
      ${field('Estado', 'estado', m.estado, 'text', 'maxlength="120" placeholder="Ej.: bueno, preparada para circuito…"')}
      ${sec('Mantenimiento e ITV')}
      ${field('ITV válida hasta', 'fecha_itv', m.fecha_itv, 'date')}
      <div class="field"><span class="lbl">Última visita al taller</span><b style="padding:10px 0">${ultimaVisita ? fdate(ultimaVisita) : 'Sin visitas registradas'}</b></div>
      ${field('Última revisión (fecha)', 'ultima_revision_fecha', m.ultima_revision_fecha, 'date')}
      ${field('Última revisión (km)', 'ultima_revision_km', m.ultima_revision_km, 'number', 'min="0"')}
      ${field('Próxima revisión (fecha)', 'proxima_revision_fecha', m.proxima_revision_fecha, 'date')}
      ${field('Próxima revisión (km)', 'proxima_revision_km', m.proxima_revision_km, 'number', 'min="0"')}
      ${campos.length ? sec('Otros datos') + campos.map((k) => campoExtra(k, (m.campos_extra || {})[k.nombre])).join('') : ''}
      ${area('Notas', 'notas', m.notas, 'maxlength="1000"')}
      <datalist id="marcas2">${MARCAS.map((x) => `<option value="${x}">`).join('')}</datalist>
    </div>`, {
    wide: true,
    onOk: async (r) => {
      const o = formData(r);
      req(o, [['marca', 'marca'], ['modelo', 'modelo']]);
      if (!propietario) throw new Error('Elige el propietario');
      if (o.bastidor && !/^[A-HJ-NPR-Z0-9]{11,17}$/i.test(o.bastidor)) throw new Error('El bastidor (VIN) no es válido');
      const extras = extraerExtras(o, 'vehiculo', m.campos_extra || {});
      const datos = { ...vehiculoDe(o, propietario.id), campos_extra: extras };
      const res = m.id ? ok(await sb.from('motos').update(datos).eq('id', m.id).select().single()) : ok(await sb.from('motos').insert(datos).select().single());
      toast('Vehículo guardado');
      cb(res);
    },
  });
  const box = root.querySelector('[data-prop]');
  const pintarProp = () => {
    box.innerHTML = propietario
      ? `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b>${esc(propietario.nombre)}</b><span class="muted small">${esc(propietario.telefono || '')}</span><button type="button" class="btn sm" data-camb>Cambiar propietario</button></div>`
      : `<input type="search" class="inp" placeholder="Buscar cliente por nombre o teléfono…" data-bp maxlength="60" aria-label="Buscar propietario"><div class="list" data-rp></div>`;
    box.querySelector('[data-camb]')?.addEventListener('click', () => { propietario = null; pintarProp(); box.querySelector('[data-bp]').focus(); });
    const bp = box.querySelector('[data-bp]'); let t;
    bp?.addEventListener('input', () => {
      clearTimeout(t); t = setTimeout(async () => {
        const s = limpiar(bp.value); const rp = box.querySelector('[data-rp]');
        if (s.length < 2) { rp.innerHTML = ''; return; }
        const L = (await sb.from('clientes').select('id,nombre,telefono').eq('es_cliente', true).or(`nombre.ilike.%${s}%,telefono.ilike.%${s}%`).limit(8)).data || [];
        rp.innerHTML = L.map((c) => `<button type="button" class="linkbtn" data-p="${c.id}" style="text-align:left;color:inherit;font-weight:400"><b>${esc(c.nombre)}</b>&nbsp;<span class="muted small">${esc(c.telefono || '')}</span></button>`).join('') || '<div class="empty">Sin resultados</div>';
        rp.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => { propietario = L.find((c) => c.id == b.dataset.p); pintarProp(); }));
      }, 250);
    });
  };
  pintarProp();
}
// Compatibilidad
export const nuevaMoto = (clienteId, cb, m = null) => editarVehiculo(m || { cliente_id: clienteId }, cb);
export { attr };

// ---------- Histórico de ventas de piezas ----------
// Cada pieza montada o vendida en una orden (reparacion_piezas), con su cliente, vehículo,
// orden y, si ya está facturada, la factura. Sirve tanto para la ficha de la pieza como para la del cliente.
export async function cargarVentas({ pieza, cliente }) {
  let q = sb.from('reparacion_piezas')
    .select('id,cantidad,pvp,created_at,pieza_id,piezas(id,referencia,nombre),reparaciones!inner(id,numero,estado,fecha_entrada,fecha_fin,cliente_id,clientes(id,nombre),motos(marca,modelo,matricula))')
    .order('created_at', { ascending: false }).limit(1000);
  if (pieza) q = q.eq('pieza_id', pieza);
  if (cliente) q = q.eq('reparaciones.cliente_id', cliente);
  const V = ok(await q);
  const fact = {};
  if (puedeFacturar() && V.length) {
    const ids = [...new Set(V.map((v) => v.reparaciones.id))];
    const [a, b] = await Promise.all([
      sb.from('facturas').select('id,numero,fecha,estado,tipo,reparacion_id').in('reparacion_id', ids),
      sb.from('factura_reparaciones').select('reparacion_id,facturas(id,numero,fecha,estado,tipo)').in('reparacion_id', ids),
    ]);
    const todas = [...ok(a), ...ok(b).map((x) => ({ ...x.facturas, reparacion_id: x.reparacion_id }))].filter((f) => f.id && f.tipo !== 'rectificativa');
    // Si hay varias, vale la que no está anulada
    for (const f of todas) { const y = fact[f.reparacion_id]; if (!y || (y.estado === 'anulada' && f.estado !== 'anulada')) fact[f.reparacion_id] = f; }
  }
  return V.map((v) => ({ ...v, factura: fact[v.reparaciones.id] || null }));
}

export function tablaVentas(T, V, { porPieza }) {
  const clientes = new Set(V.map((v) => v.reparaciones.cliente_id)).size;
  const uds = V.reduce((s, v) => s + v.cantidad, 0);
  const importe = V.reduce((s, v) => s + v.cantidad * v.pvp, 0);
  const fac = puedeFacturar();
  T.innerHTML = `
  <div class="kpis"><div class="kpi"><span class="l">Unidades vendidas</span><span class="v">${uds}</span></div>
    <div class="kpi"><span class="l">${porPieza ? 'Clientes distintos' : 'Piezas distintas'}</span><span class="v">${porPieza ? clientes : new Set(V.map((v) => v.pieza_id)).size}</span></div>
    <div class="kpi"><span class="l">Importe (PVP)</span><span class="v">${money(importe)}</span></div></div>
  <div class="agenda-bar"><input type="search" class="search" data-qv placeholder="${porPieza ? 'Buscar por cliente, matrícula, moto u orden…' : 'Buscar por pieza, referencia, matrícula u orden…'}" aria-label="Buscar en el histórico"></div>
  <section class="card"><div class="tablewrap"><table>
    <thead><tr><th class="hide-movil">Fecha</th><th>${porPieza ? 'Cliente' : 'Pieza'}</th><th class="hide-movil">Vehículo</th><th>Orden${fac ? ' / factura' : ''}</th><th class="right">Cant.</th><th class="right hide-movil">Precio</th><th class="right">Total</th></tr></thead>
    <tbody>${V.map((v) => { const r = v.reparaciones, m = r.motos, f = v.factura;
      const moto = m ? `${m.marca} ${m.modelo}${m.matricula ? ' · ' + m.matricula : ''}` : '';
      return `<tr data-txt="${attr(`${r.clientes?.nombre || ''} ${v.piezas?.nombre || ''} ${v.piezas?.referencia || ''} ${moto} ${r.numero} ${f?.numero || ''}`.toLowerCase())}">
      <td class="small hide-movil">${fdate(v.created_at)}</td>
      <td>${porPieza ? `<a href="#/cliente/${r.cliente_id}"><b>${esc(r.clientes?.nombre || '—')}</b></a>` : `<a href="#/pieza/${v.pieza_id}"><b>${esc(v.piezas?.nombre || '—')}</b></a><div class="small muted">${esc(v.piezas?.referencia || '')}</div>`}
        <div class="small muted show-movil">${fdate(v.created_at)}${moto ? ' · ' + esc(moto) : ''}</div></td>
      <td class="hide-movil small">${esc(moto)}</td>
      <td><a href="#/reparacion/${r.id}" style="white-space:nowrap">${esc(r.numero)}</a> ${chip(ESTADOS_REP, r.estado)}${fac ? `<div class="small">${f ? `<a href="#/factura/${f.id}">Factura ${esc(f.numero)}</a>${f.estado === 'anulada' ? ' <span class="chip bad">anulada</span>' : ''}` : '<span class="muted">Sin facturar</span>'}</div>` : ''}</td>
      <td class="right num"><b>${v.cantidad}</b></td><td class="right num hide-movil">${money(v.pvp)}</td><td class="right num">${money(v.cantidad * v.pvp)}</td></tr>`; }).join('') || `<tr><td colspan="7" class="empty">${porPieza ? 'Esta pieza aún no se ha vendido ni montado a ningún cliente' : 'Este cliente aún no tiene piezas'}</td></tr>`}</tbody>
  </table></div></section>`;
  const q = T.querySelector('[data-qv]');
  q.addEventListener('input', () => { const s = q.value.toLowerCase().trim(); T.querySelectorAll('tr[data-txt]').forEach((tr) => { tr.style.display = !s || tr.dataset.txt.includes(s) ? '' : 'none'; }); });
}
