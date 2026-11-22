import { sb, esc, attr, ok, modal, toast, formData, req, field, area } from '../lib.js';

// Buscador de cliente + selección/alta de moto. Llama a onChange({cliente, moto}) al cambiar.
export function selectorClienteMoto(root, onChange, inicial = {}) {
  const st = { cliente: inicial.cliente || null, moto: inicial.moto || null, motos: [] };
  root.innerHTML = `
    <div class="field"><label for="bc">Cliente</label>
      <input id="bc" type="search" class="inp" placeholder="Nombre, teléfono o matrícula…" autocomplete="off" maxlength="60"></div>
    <div data-res class="list"></div>
    <div data-sel></div>`;
  const inp = root.querySelector('#bc');
  const res = root.querySelector('[data-res]');
  const sel = root.querySelector('[data-sel]');
  let timer;

  async function buscar(t) {
    const s = t.replace(/[%,()*]/g, ' ').trim();
    if (s.length < 2) { res.innerHTML = ''; return; }
    const [a, b] = await Promise.all([
      sb.from('clientes').select('id,nombre,telefono').or(`nombre.ilike.%${s}%,telefono.ilike.%${s}%`).limit(8),
      sb.from('motos').select('cliente_id,clientes(id,nombre,telefono)').ilike('matricula', `%${s}%`).limit(5),
    ]);
    const lista = [...(a.data || [])];
    (b.data || []).forEach((m) => { if (m.clientes && !lista.find((c) => c.id === m.clientes.id)) lista.push(m.clientes); });
    res.innerHTML = lista.map((c) => `<button type="button" class="linkbtn" data-c="${c.id}" style="text-align:left;color:inherit;font-weight:400"><span class="grow"><b>${esc(c.nombre)}</b><span class="muted small">${esc(c.telefono || '')}</span></span></button>`).join('')
      + `<button type="button" class="linkbtn" data-nuevo>+ Crear cliente nuevo${s ? ` «${esc(s)}»` : ''}</button>`;
    res.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => elegir(lista.find((c) => c.id == b.dataset.c))));
    res.querySelector('[data-nuevo]').addEventListener('click', () => nuevoCliente(s, elegir));
  }
  inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => buscar(inp.value), 250); });

  async function elegir(c, motoId) {
    st.cliente = c; res.innerHTML = ''; inp.value = '';
    st.motos = ok(await sb.from('motos').select('*').eq('cliente_id', c.id).order('id'));
    st.moto = st.motos.find((m) => m.id == motoId) || st.motos[0] || null;
    pintar(); onChange(st);
  }
  function pintar() {
    if (!st.cliente) { sel.innerHTML = ''; inp.parentElement.style.display = ''; return; }
    inp.parentElement.style.display = 'none';
    sel.innerHTML = `
      <div class="card flat" style="padding:14px;gap:10px">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><div><b>${esc(st.cliente.nombre)}</b><div class="muted small">${esc(st.cliente.telefono || '')}</div></div><button type="button" class="btn sm" data-cambiar>Cambiar</button></div>
        <div class="field"><label for="selmoto">Moto</label><select id="selmoto" class="inp">${st.motos.map((m) => `<option value="${m.id}" ${st.moto?.id === m.id ? 'selected' : ''}>${esc(`${m.marca} ${m.modelo} · ${m.matricula || 'sin matrícula'}`)}</option>`).join('')}<option value="">Sin moto</option></select></div>
        <button type="button" class="linkbtn" data-nm style="text-align:left">+ Añadir otra moto a este cliente</button>
      </div>`;
    sel.querySelector('[data-cambiar]').addEventListener('click', () => { st.cliente = null; st.moto = null; pintar(); onChange(st); inp.focus(); });
    sel.querySelector('#selmoto').addEventListener('change', (e) => { st.moto = st.motos.find((m) => m.id == e.target.value) || null; onChange(st); });
    sel.querySelector('[data-nm]').addEventListener('click', () => nuevaMoto(st.cliente.id, (m) => elegir(st.cliente, m.id)));
  }
  if (st.cliente) elegir(st.cliente, st.moto?.id);
  return st;
}

export function formCliente(c = {}) {
  return `<div class="form">
    ${field('Nombre y apellidos *', 'nombre', c.nombre, 'text', 'maxlength="120" required')}
    ${field('Teléfono', 'telefono', c.telefono, 'tel', 'maxlength="20" inputmode="tel"')}
    ${field('Email', 'email', c.email, 'email', 'maxlength="120"')}
    ${field('NIF / CIF', 'nif', c.nif, 'text', 'maxlength="20"')}
    ${field('Dirección', 'direccion', c.direccion, 'text', 'maxlength="200"')}
    ${area('Notas', 'notas', c.notas, 'maxlength="1000"')}
  </div>`;
}
export function validarCliente(o) {
  req(o, [['nombre', 'nombre']]);
  if (o.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.email)) throw new Error('El email no es válido');
  if (o.telefono && !/^[+\d\s()-]{6,20}$/.test(o.telefono)) throw new Error('El teléfono no es válido');
  if (o.nif) o.nif = o.nif.toUpperCase();
  return o;
}

export function nuevoCliente(texto, cb) {
  const pre = /^[+\d\s]{6,}$/.test(texto || '') ? { telefono: texto } : { nombre: texto };
  modal('Nuevo cliente', formCliente(pre) + '<h3 style="margin-top:16px">Moto (opcional)</h3>' + formMoto({}, 'm_'), {
    okText: 'Crear cliente',
    onOk: async (root) => {
      const o = formData(root);
      const cli = validarCliente({ nombre: o.nombre, telefono: o.telefono, email: o.email, nif: o.nif, direccion: o.direccion, notas: o.notas });
      const c = ok(await sb.from('clientes').insert(cli).select().single());
      let motoId;
      if (o.m_marca && o.m_modelo) {
        const m = ok(await sb.from('motos').insert(motoDe(o, 'm_', c.id)).select().single());
        motoId = m.id;
      }
      toast('Cliente creado');
      cb(c, motoId);
    },
  });
}

export function formMoto(m = {}, p = '') {
  return `<div class="form">
    ${field('Marca', p + 'marca', m.marca, 'text', 'maxlength="40" list="marcas"')}
    ${field('Modelo', p + 'modelo', m.modelo, 'text', 'maxlength="60"')}
    ${field('Matrícula', p + 'matricula', m.matricula, 'text', 'maxlength="15" style="text-transform:uppercase"')}
    ${field('Año', p + 'anio', m.anio, 'number', 'min="1950" max="2030"')}
    ${field('Kilómetros', p + 'km', m.km, 'number', 'min="0" max="999999"')}
    ${field('Nº de bastidor', p + 'bastidor', m.bastidor, 'text', 'maxlength="20"')}
    ${field('Color', p + 'color', m.color, 'text', 'maxlength="30"')}
    <datalist id="marcas">${['Yamaha', 'Honda', 'Kawasaki', 'Suzuki', 'KTM', 'Ducati', 'BMW', 'Triumph', 'Aprilia', 'Husqvarna', 'GasGas', 'Beta', 'Sherco', 'Piaggio', 'Vespa', 'Kymco', 'SYM'].map((x) => `<option value="${x}">`).join('')}</datalist>
  </div>`;
}
export function motoDe(o, p, clienteId) {
  return {
    cliente_id: clienteId, marca: o[p + 'marca'], modelo: o[p + 'modelo'], matricula: o[p + 'matricula']?.toUpperCase() || null,
    anio: o[p + 'anio'] ? Number(o[p + 'anio']) : null, km: o[p + 'km'] ? Number(o[p + 'km']) : null,
    bastidor: o[p + 'bastidor']?.toUpperCase() || null, color: o[p + 'color'],
  };
}
export function nuevaMoto(clienteId, cb, m = null) {
  modal(m ? 'Editar moto' : 'Nueva moto', formMoto(m || {}), {
    onOk: async (root) => {
      const o = formData(root);
      req(o, [['marca', 'marca'], ['modelo', 'modelo']]);
      const datos = motoDe(o, '', clienteId);
      const r = m ? ok(await sb.from('motos').update(datos).eq('id', m.id).select().single()) : ok(await sb.from('motos').insert(datos).select().single());
      toast('Moto guardada');
      cb(r);
    },
  });
}
export { attr };
