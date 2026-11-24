// Qué se puede importar y cómo se convierte cada fila del archivo en datos del CRM.
// Cada tipo: campos (con los nombres de columna habituales en otros programas), opciones,
// cargar() lo que ya hay en el CRM, planificar() sin tocar nada y ejecutar() lo planificado.
import { sb, state } from '../lib.js';
import { aNumero, aFecha, aSiNo, normal, nifNormal, matNormal } from './leer.js';

export const COD_ANTERIOR = 'Código anterior';

// ---------- utilidades ----------
async function todo(tabla, select, filtro) {
  const out = []; const N = 1000;
  for (let i = 0; ; i += N) {
    let q = sb.from(tabla).select(select).order('id').range(i, i + N - 1);
    if (filtro) q = filtro(q);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...data);
    if (data.length < N) return out;
  }
}
// Ejecuta fn sobre cada elemento con varias peticiones a la vez
export async function enParalelo(items, n, fn, progreso) {
  let i = 0, hechos = 0;
  const trabajador = async () => {
    while (i < items.length) {
      const it = items[i++];
      try { await fn(it); it.resultado = 'ok'; } catch (e) { it.resultado = 'error'; it.error = traducirError(e); }
      progreso?.(++hechos, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, trabajador));
}
function traducirError(e) {
  const m = e?.message || String(e);
  if (/row-level security|permission|42501/i.test(m)) return 'Sin permiso con tu usuario';
  if (/duplicate key|23505/i.test(m)) return 'Ya existe (repetido)';
  if (/modo consulta|licencia/i.test(m)) return m;
  if (/check constraint/i.test(m)) return 'Algún dato no tiene un formato válido';
  return m.slice(0, 200);
}
const txt = (v, max = 200) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s ? s.slice(0, max) : null; };
const ESTADOS = ['nuevo', 'actualizar', 'saltar', 'error'];
const item = (filas, accion, extra = {}) => ({ filas: Array.isArray(filas) ? filas : [filas], accion, avisos: [], ...extra });

// Valor de un campo en una fila, según la relación de columnas elegida
const getter = (mapa) => (fila, k) => (mapa[k] ? fila[mapa[k]] ?? '' : '');

function telefonos(...vals) {
  return vals.flatMap((v) => String(v ?? '').split(/\s*(?:\/|,|;|\by\b|\|)\s*/)).map((t) => t.replace(/[.\s]+/g, ' ').trim()).filter(Boolean);
}
const telOk = (t) => /^[+\d\s()-]{6,20}$/.test(t);
const emailOk = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const esEmpresa = (nif) => /^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(nif);

// IBAN: valida con el dígito de control; convierte una cuenta de 20 dígitos (CCC) en IBAN español
export function ibanDe(v) {
  let s = String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s) return null;
  if (/^\d{20}$/.test(s)) { const r = mod97(s + '142800'); s = 'ES' + String(98 - r).padStart(2, '0') + s; }
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return NaN;
  return mod97(s.slice(4) + s.slice(0, 4).replace(/[A-Z]/g, (c) => c.charCodeAt(0) - 55)) === 1 ? s : NaN;
}
function mod97(d) {
  d = d.replace(/[A-Z]/g, (c) => c.charCodeAt(0) - 55);
  let r = 0; for (const ch of d) r = (r * 10 + Number(ch)) % 97; return r;
}

// Índices para encontrar clientes / proveedores ya existentes
function indiceTerceros(lista) {
  const porNif = new Map(), porCod = new Map(), porNombre = new Map();
  for (const c of lista) {
    if (c.nif) porNif.set(nifNormal(c.nif), c);
    const cod = c.campos_extra?.[COD_ANTERIOR]; if (cod) porCod.set(String(cod).trim().toUpperCase(), c);
    const n = normal(c.nombre); if (!porNombre.has(n)) porNombre.set(n, []); porNombre.get(n).push(c);
  }
  return {
    porNif, porCod, porNombre,
    buscar({ nif, codigo, nombre, telefono } = {}) {
      if (nif && porNif.has(nifNormal(nif))) return porNif.get(nifNormal(nif));
      if (codigo && porCod.has(String(codigo).trim().toUpperCase())) return porCod.get(String(codigo).trim().toUpperCase());
      const cand = nombre ? porNombre.get(normal(nombre)) || [] : [];
      if (cand.length === 1 && (!telefono || !cand[0].telefono || matNormal(cand[0].telefono) === matNormal(telefono))) return cand[0];
      if (cand.length > 1 && telefono) return cand.find((c) => matNormal(c.telefono) === matNormal(telefono)) || null;
      return null;
    },
    anadir(c) {
      if (c.nif) porNif.set(nifNormal(c.nif), c);
      const cod = c.campos_extra?.[COD_ANTERIOR]; if (cod) porCod.set(String(cod).trim().toUpperCase(), c);
      const n = normal(c.nombre); if (!porNombre.has(n)) porNombre.set(n, []); porNombre.get(n).push(c);
    },
  };
}
const CAMPOS_TERCERO = 'id,nombre,nif,telefono,email,es_cliente,es_proveedor,campos_extra';

// Campos para identificar al cliente o proveedor en otros archivos
const camposRef = (quien, l) => [
  { k: `${quien}_nif`, l: `NIF del ${l}`, syn: [`nif ${l}`, `cif ${l}`, `dni ${l}`, `nif cif ${l}`, 'nif', 'cif', 'dni', 'nif cif', 'cif nif'] },
  { k: `${quien}_codigo`, l: `Código del ${l} (programa anterior)`, syn: [`codigo ${l}`, `cod ${l}`, `n ${l}`, `num ${l}`, `id ${l}`] },
  { k: `${quien}_nombre`, l: `Nombre del ${l}`, syn: [l, `nombre ${l}`, `nombre del ${l}`, 'razon social', 'nombre'] },
];

// ======================================================================
//  CLIENTES Y PROVEEDORES
// ======================================================================
const clientes = {
  id: 'clientes', titulo: 'Clientes y proveedores', icono: 'clientes',
  desc: 'Fichas con datos fiscales, contacto, forma de pago y datos bancarios. Una misma ficha puede ser cliente, proveedor o las dos cosas.',
  unidad: ['ficha', 'fichas'],
  campos: [
    { k: 'codigo', l: 'Código en el programa anterior', syn: ['codigo', 'cod', 'cod cliente', 'codigo cliente', 'n cliente', 'num cliente', 'id', 'id cliente', 'codigo proveedor', 'cod proveedor', 'n proveedor'], ayuda: 'Sirve para enlazar después vehículos, facturas y compras' },
    { k: 'nombre', l: 'Nombre o razón social', req: true, syn: ['nombre', 'razon social', 'nombre fiscal', 'cliente', 'proveedor', 'nombre y apellidos', 'nombre completo', 'denominacion', 'titular', 'name', 'company'] },
    { k: 'apellidos', l: 'Apellidos (si vienen aparte)', syn: ['apellidos', 'apellido', 'primer apellido', 'apellido 1'] },
    { k: 'nombre_comercial', l: 'Nombre comercial', syn: ['nombre comercial', 'comercial', 'alias', 'rotulo'] },
    { k: 'nif', l: 'NIF / CIF', syn: ['nif', 'cif', 'dni', 'nif cif', 'cif nif', 'nie', 'documento', 'dni nif', 'vat', 'nif dni'] },
    { k: 'rol', l: 'Cliente o proveedor', syn: ['rol', 'tipo', 'tipo cliente', 'tipo tercero', 'cliente proveedor', 'clase', 'tipo ficha'], ayuda: 'Valores tipo "cliente", "proveedor" o "ambos". Si no viene, se usa lo que elijas abajo' },
    { k: 'telefono', l: 'Teléfono', syn: ['telefono', 'tel', 'telf', 'tlf', 'telefono 1', 'telefono fijo', 'phone', 'telefonos'] },
    { k: 'movil', l: 'Móvil / otro teléfono', syn: ['movil', 'telefono movil', 'tel movil', 'telefono 2', 'celular', 'mobile', 'whatsapp'] },
    { k: 'email', l: 'Email', syn: ['email', 'e mail', 'correo', 'correo electronico', 'mail'] },
    { k: 'web', l: 'Web', syn: ['web', 'pagina web', 'url', 'website'] },
    { k: 'direccion', l: 'Dirección', syn: ['direccion', 'domicilio', 'calle', 'address', 'direccion fiscal'] },
    { k: 'codigo_postal', l: 'Código postal', syn: ['cp', 'c p', 'codigo postal', 'cod postal', 'postal', 'zip'] },
    { k: 'poblacion', l: 'Población', syn: ['poblacion', 'localidad', 'municipio', 'ciudad', 'city'] },
    { k: 'provincia', l: 'Provincia', syn: ['provincia', 'prov', 'state'] },
    { k: 'contacto', l: 'Persona de contacto', syn: ['contacto', 'persona contacto', 'persona de contacto', 'atencion', 'att'] },
    { k: 'forma_pago', l: 'Forma de pago', syn: ['forma pago', 'forma de pago', 'fpago', 'metodo pago', 'modo pago'] },
    { k: 'plazo_pago_dias', l: 'Plazo de pago (días)', syn: ['plazo pago', 'plazo', 'dias plazo', 'vencimiento', 'dias vencimiento'] },
    { k: 'dias_pago', l: 'Días de pago', syn: ['dias pago', 'dias de pago', 'dia pago'] },
    { k: 'descuento_pct', l: 'Descuento fijo (%)', syn: ['descuento', 'dto', 'dto %', 'descuento %', 'dto cliente'] },
    { k: 'iban', l: 'IBAN o cuenta bancaria', syn: ['iban', 'cuenta bancaria', 'ccc', 'n cuenta', 'cuenta', 'banco cuenta', 'cuenta corriente'], ayuda: 'Solo lo ve el administrador. Las cuentas de 20 dígitos se pasan a IBAN' },
    { k: 'bic', l: 'BIC / SWIFT', syn: ['bic', 'swift', 'bic swift'] },
    { k: 'banco', l: 'Banco', syn: ['banco', 'entidad', 'entidad bancaria'] },
    { k: 'mandato_sepa', l: 'Referencia del mandato SEPA', syn: ['mandato', 'mandato sepa', 'referencia mandato', 'ref mandato'] },
    { k: 'fecha_mandato', l: 'Fecha del mandato SEPA', syn: ['fecha mandato', 'fecha firma mandato'] },
    { k: 'notas', l: 'Notas / observaciones', syn: ['notas', 'observaciones', 'obs', 'comentarios', 'nota'] },
  ],
  opciones: [
    { k: 'rol', l: 'Si el archivo no dice si es cliente o proveedor, son…', def: 'cliente', vals: [['cliente', 'Clientes'], ['proveedor', 'Proveedores'], ['ambos', 'Clientes y proveedores']] },
    { k: 'existentes', l: 'Si la ficha ya existe en el CRM (mismo NIF, código o nombre y teléfono)…', def: 'completar', vals: [['saltar', 'No tocarla'], ['completar', 'Rellenar solo los datos que le falten'], ['sobrescribir', 'Cambiar sus datos por los del archivo']] },
  ],
  async cargar() { return { terceros: indiceTerceros(await todo('clientes', CAMPOS_TERCERO)) }; },
  planificar(filas, mapa, op, ctx) {
    const g = getter(mapa); const vistos = new Map(); const plan = [];
    filas.forEach((f, i) => {
      const n = i + 1; const it = item(n, 'nuevo'); plan.push(it);
      let nombre = txt([g(f, 'nombre'), g(f, 'apellidos')].filter((x) => String(x).trim()).join(' '), 120);
      if (!nombre || nombre.length < 2) { it.accion = 'error'; it.motivo = 'Falta el nombre'; return; }
      const nif = nifNormal(g(f, 'nif')) || null;
      const codigo = txt(g(f, 'codigo'), 40);
      const r = normal(g(f, 'rol'));
      const rol = !r ? op.rol : /ambos|c p|cliente y proveedor|cli prov/.test(r) ? 'ambos' : /^(p|prov|proveedor|acreedor|proveedores)/.test(r) ? 'proveedor' : 'cliente';
      const notas = [];
      const tels = telefonos(g(f, 'telefono'), g(f, 'movil'));
      const tel = tels.find(telOk) || null;
      const otros = tels.filter((t) => t !== tel); if (otros.length) notas.push(`Otros teléfonos: ${otros.join(', ')}`);
      if (tels.length && !tel) it.avisos.push('Teléfono con formato raro: se guarda en notas');
      let email = txt(g(f, 'email'), 120); if (email) email = email.split(/[;,\s]+/)[0];
      if (email && !emailOk(email)) { notas.push(`Email: ${email}`); it.avisos.push('Email no válido: se guarda en notas'); email = null; }
      const cp = txt(g(f, 'codigo_postal'), 10)?.replace(/\D/g, '').padStart(5, '0').slice(0, 5) || null;
      const dto = aNumero(g(f, 'descuento_pct')); const plazo = aNumero(g(f, 'plazo_pago_dias'));
      if (txt(g(f, 'notas'), 900)) notas.unshift(txt(g(f, 'notas'), 900));
      let web = txt(g(f, 'web'), 120); if (web && !/^https?:\/\//i.test(web)) web = 'https://' + web;
      const d = {
        nombre, nif, nombre_comercial: txt(g(f, 'nombre_comercial'), 120), telefono: tel, email, web,
        direccion: txt(g(f, 'direccion'), 200), codigo_postal: cp, poblacion: txt(g(f, 'poblacion'), 80), provincia: txt(g(f, 'provincia'), 60),
        forma_pago: txt(g(f, 'forma_pago'), 60), dias_pago: txt(g(f, 'dias_pago'), 60),
        plazo_pago_dias: plazo != null && plazo >= 0 && plazo <= 365 ? Math.round(plazo) : null,
        descuento_pct: dto != null && dto >= 0 && dto <= 100 ? dto : null,
        notas: notas.length ? notas.join('\n').slice(0, 1000) : null,
        es_cliente: rol !== 'proveedor', es_proveedor: rol !== 'cliente',
        tipo: nif && esEmpresa(nif) ? 'empresa' : 'particular',
      };
      if (dto != null && d.descuento_pct === null) it.avisos.push('Descuento no válido: no se importa');
      it.extra = codigo ? { [COD_ANTERIOR]: codigo } : {};
      // Datos bancarios
      const iban = ibanDe(g(f, 'iban'));
      if (Number.isNaN(iban)) it.avisos.push('IBAN no válido: no se importan los datos bancarios');
      else if (iban) {
        let bic = txt(g(f, 'bic'), 11)?.toUpperCase().replace(/\s/g, '') || null; if (bic && !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(bic)) { bic = null; it.avisos.push('BIC no válido: se deja vacío'); }
        const fm = aFecha(g(f, 'fecha_mandato'));
        it.banco = { iban, bic, banco: txt(g(f, 'banco'), 80), titular: nombre, mandato_sepa: txt(g(f, 'mandato_sepa'), 35), fecha_mandato: Number.isNaN(fm) ? null : fm };
      }
      const contacto = txt(g(f, 'contacto'), 120);
      if (contacto) it.contacto = { nombre: contacto, emails: email ? [email] : [], telefonos: tels.filter(telOk).slice(0, 5), principal: true };
      it.datos = d;
      it.ver = [nombre, nif || '', tel || '', email || '', rol];
      // ¿Repetido en el archivo o ya en el CRM?
      const clave = nif || (codigo && 'C' + codigo) || normal(nombre) + '|' + matNormal(tel);
      if (vistos.has(clave)) { it.accion = 'saltar'; it.motivo = `Repetido en el archivo (fila ${vistos.get(clave)})`; return; }
      vistos.set(clave, n);
      const ex = ctx.terceros.buscar({ nif, codigo, nombre, telefono: tel });
      if (ex) {
        it.existente = ex;
        if (op.existentes === 'saltar') { it.accion = 'saltar'; it.motivo = `Ya existe: ${ex.nombre}`; }
        else { it.accion = 'actualizar'; it.motivo = `Ya existe: ${ex.nombre}`; }
      }
    });
    return plan;
  },
  async ejecutar(plan, op, ctx, progreso) {
    const hacer = plan.filter((x) => x.accion === 'nuevo' || x.accion === 'actualizar');
    const full = op.existentes === 'sobrescribir';
    await enParalelo(hacer, 5, async (it) => {
      const d = it.datos; let id;
      if (it.accion === 'nuevo') {
        const ins = { ...d, descuento_pct: d.descuento_pct ?? 0, campos_extra: it.extra };
        const c = await sb.from('clientes').insert(ins).select(CAMPOS_TERCERO).single(); if (c.error) throw c.error;
        id = c.data.id; ctx.terceros.anadir(c.data);
        if (it.contacto) { const r = await sb.from('contactos').insert({ ...it.contacto, cliente_id: id }); if (r.error) it.avisos.push('No se pudo guardar el contacto'); }
      } else {
        const ex = (await sb.from('clientes').select('*').eq('id', it.existente.id).single()).data; id = ex.id;
        const upd = {};
        for (const [k, v] of Object.entries(d)) {
          if (k === 'es_cliente' || k === 'es_proveedor') { if (v && !ex[k]) upd[k] = true; continue; }
          if (k === 'tipo') { if (full && v === 'empresa') upd[k] = v; continue; }
          if (v === null || v === undefined) continue;
          if (k === 'notas' && ex.notas && !full) { if (!ex.notas.includes(v)) upd.notas = (ex.notas + '\n' + v).slice(0, 1000); continue; }
          if (full || ex[k] == null || ex[k] === '' || (k === 'descuento_pct' && !Number(ex[k]))) if (ex[k] !== v) upd[k] = v;
        }
        if (it.extra[COD_ANTERIOR] && !ex.campos_extra?.[COD_ANTERIOR]) upd.campos_extra = { ...(ex.campos_extra || {}), ...it.extra };
        if (Object.keys(upd).length) { const r = await sb.from('clientes').update(upd).eq('id', id); if (r.error) throw r.error; }
        else it.sinCambios = true;
      }
      if (it.banco) {
        const r = await sb.from('datos_bancarios').upsert({ ...it.banco, cliente_id: id }, { onConflict: 'cliente_id', ignoreDuplicates: it.accion === 'actualizar' && !full });
        if (r.error) it.avisos.push('No se pudieron guardar los datos bancarios');
      }
    }, progreso);
  },
};

// ======================================================================
//  VEHÍCULOS
// ======================================================================
const vehiculos = {
  id: 'vehiculos', titulo: 'Vehículos', icono: 'moto',
  desc: 'Motos y vehículos de los clientes: matrícula, bastidor, marca, modelo, km, ITV… Se enlazan con el cliente por NIF, código o nombre.',
  unidad: ['vehículo', 'vehículos'], requiere: 'clientes',
  campos: [
    ...camposRef('cliente', 'cliente').map((c) => ({ ...c, syn: [...c.syn, ...(c.k === 'cliente_nombre' ? ['propietario', 'titular'] : [])] })),
    { k: 'matricula', l: 'Matrícula', syn: ['matricula', 'matr', 'placa', 'plate'] },
    { k: 'bastidor', l: 'Bastidor (VIN)', syn: ['bastidor', 'vin', 'n bastidor', 'num bastidor', 'chasis', 'numero bastidor'] },
    { k: 'vehiculo', l: 'Marca y modelo juntos', syn: ['vehiculo', 'marca modelo', 'marca y modelo', 'moto', 'modelo vehiculo'], ayuda: 'Si el programa los da juntos ("Yamaha MT-07"), la primera palabra es la marca' },
    { k: 'marca', l: 'Marca', syn: ['marca', 'fabricante'] },
    { k: 'modelo', l: 'Modelo', syn: ['modelo', 'version'] },
    { k: 'anio', l: 'Año', syn: ['ano', 'anio', 'year', 'ano fabricacion', 'ano matriculacion'] },
    { k: 'km', l: 'Kilómetros', syn: ['km', 'kms', 'kilometros', 'kilometraje', 'km actuales'] },
    { k: 'color', l: 'Color', syn: ['color'] },
    { k: 'combustible', l: 'Carburante', syn: ['combustible', 'carburante', 'fuel'] },
    { k: 'cilindrada', l: 'Cilindrada (cc)', syn: ['cilindrada', 'cc', 'c c', 'cm3'] },
    { k: 'motor', l: 'Motor', syn: ['motor', 'tipo motor', 'codigo motor', 'n motor'] },
    { k: 'fecha_matriculacion', l: 'Fecha de matriculación', syn: ['fecha matriculacion', 'f matriculacion', 'matriculacion', 'fecha matricula', 'primera matriculacion'] },
    { k: 'fecha_itv', l: 'Próxima ITV', syn: ['itv', 'fecha itv', 'proxima itv', 'caducidad itv'] },
    { k: 'notas', l: 'Notas', syn: ['notas', 'observaciones', 'obs', 'comentarios'] },
  ],
  opciones: [
    { k: 'existentes', l: 'Si el vehículo ya existe (misma matrícula o bastidor)…', def: 'completar', vals: [['saltar', 'No tocarlo'], ['completar', 'Rellenar solo los datos que le falten'], ['sobrescribir', 'Cambiar sus datos por los del archivo']] },
  ],
  async cargar() {
    const [t, m] = await Promise.all([todo('clientes', CAMPOS_TERCERO), todo('motos', 'id,cliente_id,matricula,bastidor')]);
    const porMat = new Map(), porBas = new Map();
    m.forEach((x) => { if (x.matricula) porMat.set(matNormal(x.matricula), x); if (x.bastidor) porBas.set(matNormal(x.bastidor), x); });
    return { terceros: indiceTerceros(t), porMat, porBas };
  },
  planificar(filas, mapa, op, ctx) {
    const g = getter(mapa); const vistos = new Map(); const plan = [];
    filas.forEach((f, i) => {
      const n = i + 1; const it = item(n, 'nuevo'); plan.push(it);
      let marca = txt(g(f, 'marca'), 40), modelo = txt(g(f, 'modelo'), 60);
      const junto = txt(g(f, 'vehiculo'), 100);
      if (junto && (!marca || !modelo)) { const [a, ...b] = junto.split(' '); if (!marca) marca = a; if (!modelo) modelo = b.join(' ') || null; }
      const matricula = matNormal(g(f, 'matricula')).slice(0, 15) || null; const bastidor = matNormal(g(f, 'bastidor')).slice(0, 30) || null;
      const cli = { nif: g(f, 'cliente_nif'), codigo: g(f, 'cliente_codigo'), nombre: g(f, 'cliente_nombre') };
      it.ver = [matricula || bastidor || '', [marca, modelo].filter(Boolean).join(' '), txt(cli.nombre) || txt(cli.nif) || txt(cli.codigo) || ''];
      if (!marca || !modelo) { it.accion = 'error'; it.motivo = 'Falta la marca o el modelo'; return; }
      const c = ctx.terceros.buscar(cli);
      if (!c) { it.accion = 'error'; it.motivo = 'No se encuentra el cliente en el CRM (importa antes los clientes)'; return; }
      const num = (k, min, max) => { const v = aNumero(g(f, k)); if (v === null) return null; if (Number.isNaN(v) || v < min || v > max) { it.avisos.push(`${k === 'km' ? 'Kilómetros' : k === 'anio' ? 'Año' : 'Cilindrada'} no válido`); return null; } return Math.round(v); };
      const fecha = (k, l) => { const v = aFecha(g(f, k)); if (Number.isNaN(v)) { it.avisos.push(`${l} no válida`); return null; } return v; };
      const fm = fecha('fecha_matriculacion', 'Fecha de matriculación');
      const d = {
        cliente_id: c.id, marca, modelo, matricula, bastidor, tipo: 'moto',
        anio: num('anio', 1900, 2100) ?? (fm ? Number(fm.slice(0, 4)) : null), km: num('km', 0, 999999), cilindrada: num('cilindrada', 0, 5000),
        color: txt(g(f, 'color'), 30), combustible: txt(g(f, 'combustible'), 30), motor: txt(g(f, 'motor'), 60),
        fecha_matriculacion: fm, fecha_itv: fecha('fecha_itv', 'Fecha de ITV'), notas: txt(g(f, 'notas'), 1000),
      };
      it.datos = d; it.ver[2] = c.nombre;
      const clave = matricula || bastidor;
      if (clave) {
        if (vistos.has(clave)) { it.accion = 'saltar'; it.motivo = `Repetido en el archivo (fila ${vistos.get(clave)})`; return; }
        vistos.set(clave, n);
      } else it.avisos.push('Sin matrícula ni bastidor');
      const ex = (matricula && ctx.porMat.get(matricula)) || (bastidor && ctx.porBas.get(bastidor));
      if (ex) {
        it.existente = ex;
        it.accion = op.existentes === 'saltar' ? 'saltar' : 'actualizar'; it.motivo = 'Ya existe ese vehículo';
        if (ex.cliente_id !== c.id) it.avisos.push('En el CRM está a nombre de otro cliente: no se cambia el propietario');
      }
    });
    return plan;
  },
  async ejecutar(plan, op, ctx, progreso) {
    const full = op.existentes === 'sobrescribir';
    await enParalelo(plan.filter((x) => x.accion === 'nuevo' || x.accion === 'actualizar'), 5, async (it) => {
      if (it.accion === 'nuevo') { const r = await sb.from('motos').insert(it.datos).select('id,cliente_id,matricula,bastidor').single(); if (r.error) throw r.error; if (r.data.matricula) ctx.porMat.set(r.data.matricula, r.data); return; }
      const ex = (await sb.from('motos').select('*').eq('id', it.existente.id).single()).data;
      const upd = {};
      for (const [k, v] of Object.entries(it.datos)) { if (k === 'cliente_id' || k === 'tipo' || v === null) continue; if ((full || ex[k] == null || ex[k] === '') && ex[k] !== v) upd[k] = v; }
      if (Object.keys(upd).length) { const r = await sb.from('motos').update(upd).eq('id', ex.id); if (r.error) throw r.error; } else it.sinCambios = true;
    }, progreso);
  },
};

// ======================================================================
//  ARTÍCULOS / PIEZAS DEL ALMACÉN
// ======================================================================
function indiceProveedores(provs, terceros) {
  const porTercero = new Map(provs.filter((p) => p.tercero_id).map((p) => [p.tercero_id, p]));
  const porNombre = new Map(provs.map((p) => [normal(p.nombre), p]));
  const porNif = new Map(provs.filter((p) => p.cif).map((p) => [nifNormal(p.cif), p]));
  return (v) => {
    const s = String(v ?? '').trim(); if (!s) return null;
    const t = terceros.buscar({ nif: s, codigo: s, nombre: s });
    return (t && porTercero.get(t.id)) || porNif.get(nifNormal(s)) || porNombre.get(normal(s)) || null;
  };
}
const impuestoDefecto = () => Number((state.impuestos.find((i) => i.por_defecto) || state.impuestos[0] || { porcentaje: 0 }).porcentaje);

const articulos = {
  id: 'articulos', titulo: 'Artículos y piezas', icono: 'almacen',
  desc: 'Catálogo del almacén con referencia, precios, stock, ubicación y proveedor. La referencia debe ser la misma que en la tienda online.',
  unidad: ['artículo', 'artículos'],
  campos: [
    { k: 'referencia', l: 'Referencia', req: true, syn: ['referencia', 'ref', 'reference', 'sku', 'codigo', 'cod articulo', 'codigo articulo', 'referencia articulo', 'articulo', 'ref articulo', 'codigo producto'], ayuda: 'La misma que en PrestaShop. Se guarda en mayúsculas' },
    { k: 'nombre', l: 'Nombre / descripción', req: true, syn: ['nombre', 'descripcion', 'denominacion', 'name', 'producto', 'descripcion articulo', 'nombre articulo', 'concepto'] },
    { k: 'categoria', l: 'Categoría / familia', syn: ['categoria', 'familia', 'grupo', 'category', 'subfamilia', 'seccion', 'categories'] },
    { k: 'marca', l: 'Marca', syn: ['marca', 'fabricante', 'manufacturer', 'brand'] },
    { k: 'pvp', l: 'PVP sin impuesto (€)', syn: ['pvp', 'precio venta', 'precio', 'p v p', 'precio sin iva', 'price', 'price tax excluded', 'tarifa', 'precio venta publico', 'pvp sin iva', 'pvp sin igic'] },
    { k: 'pvp_con', l: 'PVP con impuesto incluido (€)', syn: ['pvp iva incluido', 'precio con iva', 'pvp con iva', 'price tax included', 'pvp con igic', 'precio con igic', 'pvp iva', 'precio final'], ayuda: 'Si solo tienes el precio con IGIC/IVA, se le quita el impuesto por defecto' },
    { k: 'precio_compra', l: 'Precio de compra (€)', syn: ['precio compra', 'coste', 'precio coste', 'p compra', 'costo', 'ultimo coste', 'wholesale price', 'precio de coste', 'pmc', 'precio medio coste'] },
    { k: 'stock', l: 'Stock', syn: ['stock', 'existencias', 'cantidad', 'unidades', 'stock actual', 'quantity', 'uds'] },
    { k: 'stock_minimo', l: 'Stock mínimo', syn: ['stock minimo', 'minimo', 'stock min', 'min stock'] },
    { k: 'ubicacion', l: 'Ubicación', syn: ['ubicacion', 'estanteria', 'localizacion', 'hueco', 'location'] },
    { k: 'fecha_compra', l: 'Fecha de última compra', syn: ['fecha compra', 'ultima compra', 'fecha ultima compra', 'f compra'] },
    { k: 'proveedor', l: 'Proveedor (nombre, NIF o código)', syn: ['proveedor', 'supplier', 'nombre proveedor', 'cod proveedor', 'codigo proveedor', 'proveedor habitual'] },
  ],
  opciones: [
    { k: 'existentes', l: 'Si la referencia ya existe en el almacén…', def: 'sobrescribir', vals: [['saltar', 'No tocarla'], ['completar', 'Rellenar solo los datos que le falten'], ['sobrescribir', 'Actualizar nombre, precios y datos con los del archivo']] },
    { k: 'stock', l: 'Stock de las referencias que ya existen…', def: 'no', vals: [['no', 'No cambiarlo'], ['si', 'Poner el del archivo (queda un ajuste en Movimientos)']] },
  ],
  async cargar() {
    const [t, p, pz] = await Promise.all([todo('clientes', CAMPOS_TERCERO), todo('proveedores', 'id,nombre,cif,tercero_id'), todo('piezas', 'id,referencia')]);
    const terceros = indiceTerceros(t);
    return { proveedor: indiceProveedores(p, terceros), piezas: new Map(pz.map((x) => [x.referencia.toUpperCase(), x])) };
  },
  planificar(filas, mapa, op, ctx) {
    const g = getter(mapa); const vistos = new Map(); const plan = []; const pct = impuestoDefecto();
    filas.forEach((f, i) => {
      const n = i + 1; const it = item(n, 'nuevo'); plan.push(it);
      const ref = txt(g(f, 'referencia'), 40)?.toUpperCase();
      const nombre = txt(g(f, 'nombre'), 120);
      it.ver = [ref || '', nombre || ''];
      if (!ref) { it.accion = 'error'; it.motivo = 'Falta la referencia'; return; }
      if (!nombre) { it.accion = 'error'; it.motivo = 'Falta el nombre'; return; }
      const precio = (k, l) => { const v = aNumero(g(f, k)); if (v === null) return null; if (Number.isNaN(v) || v < 0) { it.avisos.push(`${l} no válido`); return null; } return Math.round(v * 10000) / 10000; };
      let pvp = precio('pvp', 'PVP'); const con = precio('pvp_con', 'PVP con impuesto');
      if (pvp === null && con !== null) pvp = Math.round((con / (1 + pct / 100)) * 100) / 100;
      const stock = aNumero(g(f, 'stock')); const smin = aNumero(g(f, 'stock_minimo'));
      if (stock !== null && (Number.isNaN(stock) || stock < 0)) it.avisos.push('Stock no válido o negativo: se deja a 0');
      if (stock > 0 && stock % 1) it.avisos.push('Stock con decimales: se redondea');
      const fc = aFecha(g(f, 'fecha_compra')); if (Number.isNaN(fc)) it.avisos.push('Fecha de compra no válida');
      const provTxt = txt(g(f, 'proveedor'), 120); const prov = provTxt ? ctx.proveedor(provTxt) : null;
      if (provTxt && !prov) it.avisos.push(`Proveedor "${provTxt}" no encontrado`);
      it.datos = {
        referencia: ref, nombre, categoria: txt(g(f, 'categoria'), 40), marca: txt(g(f, 'marca'), 40), ubicacion: txt(g(f, 'ubicacion'), 40),
        pvp, precio_compra: precio('precio_compra', 'Precio de compra'), fecha_compra: Number.isNaN(fc) ? null : fc,
        proveedor_id: prov?.id ?? null, stock_minimo: smin !== null && !Number.isNaN(smin) && smin >= 0 ? Math.round(smin) : null,
      };
      it.stock = stock !== null && !Number.isNaN(stock) && stock > 0 ? Math.round(stock) : (stock === 0 ? 0 : null);
      it.ver.push(pvp ?? '', it.stock ?? '');
      if (vistos.has(ref)) { it.accion = 'saltar'; it.motivo = `Referencia repetida en el archivo (fila ${vistos.get(ref)})`; return; }
      vistos.set(ref, n);
      const ex = ctx.piezas.get(ref);
      if (ex) { it.existente = ex; it.accion = op.existentes === 'saltar' ? 'saltar' : 'actualizar'; it.motivo = 'La referencia ya existe'; }
    });
    return plan;
  },
  async ejecutar(plan, op, ctx, progreso) {
    const full = op.existentes === 'sobrescribir';
    await enParalelo(plan.filter((x) => x.accion === 'nuevo' || x.accion === 'actualizar'), 5, async (it) => {
      const d = it.datos;
      if (it.accion === 'nuevo') {
        const ins = { ...d, pvp: d.pvp ?? 0, precio_compra: d.precio_compra ?? 0, stock_minimo: d.stock_minimo ?? 1, stock: 0 };
        const r = await sb.from('piezas').insert(ins).select('id,referencia').single(); if (r.error) throw r.error;
        ctx.piezas.set(r.data.referencia.toUpperCase(), r.data);
        if (it.stock > 0) {
          const s = await sb.rpc('registrar_compra', { p_pieza: r.data.id, p_cantidad: it.stock, p_precio: d.precio_compra, p_proveedor: d.proveedor_id, p_fecha: d.fecha_compra || new Date().toISOString().slice(0, 10), p_nota: 'Stock inicial (importado)' });
          if (s.error) it.avisos.push('No se pudo poner el stock inicial');
        }
        return;
      }
      const ex = (await sb.from('piezas').select('*').eq('id', it.existente.id).single()).data;
      const upd = {};
      for (const [k, v] of Object.entries(d)) { if (k === 'referencia' || v === null) continue; if ((full || ex[k] === null || ex[k] === '' || ((k === 'pvp' || k === 'precio_compra') && !Number(ex[k]))) && ex[k] !== v && Number(ex[k]) !== v) upd[k] = v; }
      if (Object.keys(upd).length) { const r = await sb.from('piezas').update(upd).eq('id', ex.id); if (r.error) throw r.error; } else it.sinCambios = true;
      if (op.stock === 'si' && it.stock !== null && it.stock !== ex.stock) {
        const dif = it.stock - ex.stock;
        const r = await sb.from('piezas').update({ stock: it.stock }).eq('id', ex.id); if (r.error) throw r.error;
        await sb.from('movimientos_stock').insert({ pieza_id: ex.id, tipo: 'ajuste', cantidad: dif, nota: 'Ajuste de stock (importación)' });
        it.sinCambios = false;
      }
    }, progreso);
  },
};

// ======================================================================
//  ALBARANES Y NOTAS DE COMPRA
// ======================================================================
const NOTA_COMPRA = (num) => `Albarán ${num} (importado)`;
const compras = {
  id: 'compras', titulo: 'Albaranes y notas de compra', icono: 'almacen',
  desc: 'Líneas de compra a proveedores (una fila por artículo). Quedan en el historial de compras de cada pieza y del proveedor, y si quieres suman al stock.',
  unidad: ['línea', 'líneas'], requiere: 'articulos',
  campos: [
    { k: 'albaran', l: 'Nº de albarán o nota', req: true, syn: ['albaran', 'n albaran', 'num albaran', 'numero albaran', 'numero', 'documento', 'n documento', 'nota', 'n nota', 'pedido', 'n pedido'] },
    { k: 'fecha', l: 'Fecha', syn: ['fecha', 'fecha albaran', 'fecha documento', 'fecha compra'] },
    { k: 'proveedor', l: 'Proveedor (nombre, NIF o código)', syn: ['proveedor', 'nombre proveedor', 'cif proveedor', 'nif proveedor', 'cod proveedor', 'codigo proveedor', 'supplier'] },
    { k: 'referencia', l: 'Referencia del artículo', req: true, syn: ['referencia', 'ref', 'codigo', 'cod articulo', 'codigo articulo', 'articulo', 'sku'] },
    { k: 'descripcion', l: 'Descripción', syn: ['descripcion', 'concepto', 'nombre', 'denominacion', 'nombre articulo'] },
    { k: 'cantidad', l: 'Cantidad', req: true, syn: ['cantidad', 'uds', 'unidades', 'cant', 'qty'] },
    { k: 'precio', l: 'Precio de compra unitario (€)', syn: ['precio', 'precio unitario', 'coste', 'precio compra', 'importe unitario', 'precio coste', 'p unitario'] },
  ],
  opciones: [
    { k: 'modo', l: 'Estas compras…', def: 'historial', vals: [['historial', 'Solo como historial (no cambian el stock: el stock viene de los artículos)'], ['stock', 'Suman al stock y actualizan el precio de compra']] },
    { k: 'crear', l: 'Si una referencia no está en el almacén…', def: 'crear', vals: [['crear', 'Crear el artículo (con stock 0)'], ['error', 'Dejar esa línea sin importar']] },
  ],
  async cargar() {
    const [t, p, pz, mv] = await Promise.all([todo('clientes', CAMPOS_TERCERO), todo('proveedores', 'id,nombre,cif,tercero_id'), todo('piezas', 'id,referencia'), todo('movimientos_stock', 'id,nota,proveedor_id', (q) => q.eq('tipo', 'entrada').like('nota', '%(importado)'))]);
    return { proveedor: indiceProveedores(p, indiceTerceros(t)), piezas: new Map(pz.map((x) => [x.referencia.toUpperCase(), x])), hechos: new Set(mv.map((m) => `${m.nota}|${m.proveedor_id ?? ''}`)) };
  },
  planificar(filas, mapa, op, ctx) {
    const g = getter(mapa); const plan = [];
    filas.forEach((f, i) => {
      const n = i + 1; const it = item(n, 'nuevo'); plan.push(it);
      const num = txt(g(f, 'albaran'), 40); const ref = txt(g(f, 'referencia'), 40)?.toUpperCase();
      const provTxt = txt(g(f, 'proveedor'), 120); const prov = provTxt ? ctx.proveedor(provTxt) : null;
      const cant = aNumero(g(f, 'cantidad')); const precio = aNumero(g(f, 'precio'));
      let fecha = aFecha(g(f, 'fecha'));
      it.ver = [num || '', fecha && !Number.isNaN(fecha) ? fecha : '', provTxt || '', ref || '', cant ?? ''];
      if (!num) { it.accion = 'error'; it.motivo = 'Falta el número de albarán'; return; }
      if (!ref) { it.accion = 'error'; it.motivo = 'Falta la referencia'; return; }
      if (cant === null || Number.isNaN(cant) || cant <= 0) { it.accion = 'error'; it.motivo = 'Cantidad no válida (debe ser mayor que 0)'; return; }
      if (cant % 1) it.avisos.push('Cantidad con decimales: se redondea');
      if (precio !== null && (Number.isNaN(precio) || precio < 0)) it.avisos.push('Precio no válido: se deja vacío');
      if (!fecha || Number.isNaN(fecha)) { it.avisos.push('Sin fecha válida: se pone la de hoy'); fecha = new Date().toISOString().slice(0, 10); }
      if (provTxt && !prov) it.avisos.push(`Proveedor "${provTxt}" no encontrado: la compra queda sin proveedor`);
      const pieza = ctx.piezas.get(ref);
      if (!pieza && op.crear !== 'crear') { it.accion = 'error'; it.motivo = 'La referencia no está en el almacén'; return; }
      if (!pieza) it.avisos.push('Se crea el artículo');
      it.datos = { num, ref, nombre: txt(g(f, 'descripcion'), 120) || ref, cantidad: Math.max(1, Math.round(cant)), precio: precio !== null && !Number.isNaN(precio) && precio >= 0 ? precio : null, proveedor_id: prov?.id ?? null, fecha };
      if (ctx.hechos.has(`${NOTA_COMPRA(num)}|${prov?.id ?? ''}`)) { it.accion = 'saltar'; it.motivo = 'Este albarán ya se importó antes'; }
    });
    return plan;
  },
  async ejecutar(plan, op, ctx, progreso) {
    const hacer = plan.filter((x) => x.accion === 'nuevo');
    // Primero se crean los artículos que falten (uno por referencia)
    for (const ref of [...new Set(hacer.filter((x) => !ctx.piezas.has(x.datos.ref)).map((x) => x.datos.ref))]) {
      const d = hacer.find((x) => x.datos.ref === ref).datos;
      const r = await sb.from('piezas').insert({ referencia: ref, nombre: d.nombre, pvp: 0, precio_compra: d.precio ?? 0, stock: 0, proveedor_id: d.proveedor_id }).select('id,referencia').single();
      if (!r.error) ctx.piezas.set(ref, r.data);
    }
    await enParalelo(hacer, 4, async (it) => {
      const d = it.datos; const pieza = ctx.piezas.get(d.ref);
      if (!pieza) throw new Error('No se pudo crear el artículo');
      if (op.modo === 'stock') {
        const r = await sb.rpc('registrar_compra', { p_pieza: pieza.id, p_cantidad: d.cantidad, p_precio: d.precio, p_proveedor: d.proveedor_id, p_fecha: d.fecha, p_nota: NOTA_COMPRA(d.num) }); if (r.error) throw r.error;
      } else {
        const r = await sb.from('movimientos_stock').insert({ pieza_id: pieza.id, tipo: 'entrada', cantidad: d.cantidad, precio: d.precio, proveedor_id: d.proveedor_id, nota: NOTA_COMPRA(d.num), fecha: `${d.fecha}T12:00:00` }); if (r.error) throw r.error;
      }
    }, progreso);
  },
};

// ======================================================================
//  FACTURAS DE VENTA (históricas)
// ======================================================================
const facturas = {
  id: 'facturas', titulo: 'Facturas emitidas', icono: 'fact', soloFacturacion: true,
  desc: 'Histórico de facturas a clientes, con sus líneas o solo con los totales. Se guardan con su número original y no cambian la numeración del CRM.',
  unidad: ['factura', 'facturas'], requiere: 'clientes',
  campos: [
    { k: 'numero', l: 'Nº de factura', req: true, syn: ['numero', 'n factura', 'num factura', 'factura', 'numero factura', 'n fra', 'documento', 'n documento', 'num'] },
    { k: 'serie', l: 'Serie (si viene aparte)', syn: ['serie', 'serie factura'] },
    { k: 'fecha', l: 'Fecha', req: true, syn: ['fecha', 'fecha factura', 'fecha emision', 'fecha expedicion', 'f factura'] },
    ...camposRef('cliente', 'cliente'),
    { k: 'concepto', l: 'Concepto de la línea', syn: ['concepto', 'descripcion', 'articulo', 'detalle', 'descripcion linea'], ayuda: 'Si el archivo trae una fila por línea. Si no, se crea una línea con la base' },
    { k: 'cantidad', l: 'Cantidad', syn: ['cantidad', 'uds', 'unidades', 'cant'] },
    { k: 'precio', l: 'Precio unitario', syn: ['precio', 'precio unitario', 'pvp', 'p unitario', 'importe unitario'] },
    { k: 'dto', l: 'Descuento de la línea (%)', syn: ['dto', 'descuento', 'dto %', '% dto', 'descuento linea'] },
    { k: 'importe_linea', l: 'Importe de la línea', syn: ['importe linea', 'importe neto', 'subtotal linea', 'neto linea'] },
    { k: 'base', l: 'Base imponible (total)', syn: ['base', 'base imponible', 'b imponible', 'subtotal', 'neto', 'total base', 'base imp'] },
    { k: 'pct', l: '% de impuesto (IGIC / IVA)', syn: ['% iva', 'iva %', 'tipo iva', '% igic', 'igic %', 'tipo igic', 'tipo impositivo', 'porcentaje iva', 'porcentaje igic', 'iva', 'igic'] },
    { k: 'cuota', l: 'Cuota de impuesto', syn: ['cuota', 'cuota iva', 'importe iva', 'cuota igic', 'importe igic', 'impuestos', 'total iva', 'total igic'] },
    { k: 'total', l: 'Total factura', syn: ['total', 'total factura', 'importe total', 'importe', 'total fra'] },
    { k: 'estado', l: 'Estado / cobrada', syn: ['estado', 'cobrada', 'pagada', 'situacion', 'cobro'], ayuda: 'Valores tipo "cobrada", "pagada", "sí", "pendiente"' },
    { k: 'fecha_cobro', l: 'Fecha de cobro', syn: ['fecha cobro', 'fecha pago', 'cobrada el', 'f cobro'] },
    { k: 'forma_pago', l: 'Forma de pago', syn: ['forma pago', 'forma de pago', 'fpago', 'metodo pago'] },
  ],
  opciones: [
    { k: 'estado', l: 'Si el archivo no dice si están cobradas…', def: 'cobrada', vals: [['cobrada', 'Marcarlas como cobradas'], ['pendiente', 'Dejarlas pendientes de cobro']] },
    { k: 'crear', l: 'Si el cliente de la factura no está en el CRM…', def: 'crear', vals: [['crear', 'Crear el cliente con el nombre y NIF de la factura'], ['error', 'Dejar la factura sin importar']] },
  ],
  async cargar() {
    const [t, f] = await Promise.all([todo('clientes', CAMPOS_TERCERO), todo('facturas', 'id,numero')]);
    return { terceros: indiceTerceros(t), numeros: new Set(f.map((x) => x.numero.toUpperCase())) };
  },
  planificar(filas, mapa, op, ctx) {
    const g = getter(mapa); const grupos = new Map(); const plan = []; const def = impuestoDefecto();
    filas.forEach((f, i) => {
      const n = i + 1;
      let num = txt(g(f, 'numero'), 30); const serie = txt(g(f, 'serie'), 12);
      if (num && serie && !num.toUpperCase().startsWith(serie.toUpperCase())) num = `${serie}${/[-/]$/.test(serie) ? '' : '-'}${num}`;
      if (!num) { plan.push(item(n, 'error', { motivo: 'Falta el número de factura', ver: ['', '', '', ''] })); return; }
      const k = num.toUpperCase();
      if (!grupos.has(k)) { const it = item([], 'nuevo', { num, fila0: f, lineas: [] }); grupos.set(k, it); plan.push(it); }
      const it = grupos.get(k); it.filas.push(n); it.lineas.push(f);
    });
    for (const it of plan.filter((x) => x.lineas)) {
      const f = it.fila0; const num = it.num;
      const fecha = aFecha(g(f, 'fecha'));
      const cli = { nif: g(f, 'cliente_nif'), codigo: g(f, 'cliente_codigo'), nombre: g(f, 'cliente_nombre') };
      it.ver = [num, fecha && !Number.isNaN(fecha) ? fecha : '', txt(cli.nombre) || txt(cli.nif) || txt(cli.codigo) || '', ''];
      if (!fecha || Number.isNaN(fecha)) { it.accion = 'error'; it.motivo = 'Falta la fecha o no es válida'; continue; }
      if (ctx.numeros.has(num.toUpperCase())) { it.accion = 'saltar'; it.motivo = 'Ya existe una factura con ese número'; continue; }
      const c = ctx.terceros.buscar(cli);
      if (!c) {
        const nombre = txt(cli.nombre, 120);
        if (op.crear !== 'crear' || !nombre || nombre.length < 2) { it.accion = 'error'; it.motivo = 'No se encuentra el cliente en el CRM'; continue; }
        it.nuevoCliente = { nombre, nif: nifNormal(cli.nif) || null, tipo: esEmpresa(nifNormal(cli.nif)) ? 'empresa' : 'particular', es_cliente: true, es_proveedor: false, campos_extra: txt(cli.codigo) ? { [COD_ANTERIOR]: txt(cli.codigo, 40) } : {} };
        it.avisos.push('Se crea el cliente');
      } else { it.cliente_id = c.id; it.ver[2] = c.nombre; }
      // Líneas
      const lineas = [];
      for (const l of it.lineas) {
        const concepto = txt(g(l, 'concepto'), 300);
        if (!concepto) continue;
        let cant = aNumero(g(l, 'cantidad')); let precio = aNumero(g(l, 'precio')); let dto = aNumero(g(l, 'dto')); const imp = aNumero(g(l, 'importe_linea'));
        if (cant === null || Number.isNaN(cant) || cant === 0) cant = 1;
        if (dto === null || Number.isNaN(dto) || dto < 0 || dto > 100) dto = 0;
        if ((precio === null || Number.isNaN(precio)) && imp !== null && !Number.isNaN(imp)) { precio = imp / cant; dto = 0; }
        if (precio === null || Number.isNaN(precio)) precio = 0;
        lineas.push({ tipo: 'otro', concepto, cantidad: cant, precio: Math.round(precio * 10000) / 10000, dto_pct: dto, orden: lineas.length });
      }
      const sumLineas = Math.round(lineas.reduce((s, l) => s + l.cantidad * l.precio * (1 - l.dto_pct / 100), 0) * 100) / 100;
      let base = aNumero(g(f, 'base')); let pct = aNumero(g(f, 'pct')); let cuota = aNumero(g(f, 'cuota')); let total = aNumero(g(f, 'total'));
      [base, pct, cuota, total] = [base, pct, cuota, total].map((v) => (v === null || Number.isNaN(v) ? null : v));
      if (pct !== null && pct > 0 && pct < 1) pct = Math.round(pct * 10000) / 100; // 0,07 = 7 %
      if (base === null) base = lineas.length ? sumLineas : (total !== null && cuota !== null ? total - cuota : (total !== null && pct !== null ? total / (1 + pct / 100) : null));
      if (base === null) { it.accion = 'error'; it.motivo = 'No hay base, total ni líneas con importe'; continue; }
      base = Math.round(base * 100) / 100;
      if (pct === null) pct = cuota !== null && base ? Math.round((cuota / base) * 10000) / 100 : (total !== null && base ? Math.round((total / base - 1) * 10000) / 100 : def);
      if (cuota === null) cuota = Math.round(base * pct) / 100;
      if (total === null) total = Math.round((base + cuota) * 100) / 100;
      if (Math.abs(base + cuota - total) > 0.05) it.avisos.push('Base + impuesto no coincide con el total: se respetan los importes del archivo');
      if (lineas.length && Math.abs(sumLineas - base) > 0.05) it.avisos.push('Las líneas no suman la base: se respeta la base del archivo');
      if (!lineas.length) lineas.push({ tipo: 'otro', concepto: `Factura ${num} (importada)`, cantidad: 1, precio: base, dto_pct: 0, orden: 0 });
      const imp = state.impuestos.find((x) => Number(x.porcentaje) === pct);
      const e = normal(g(f, 'estado')); const cobro = aFecha(g(f, 'fecha_cobro'));
      const cobrada = e ? (/cobrad|pagad|^s|^si$|liquidad|^1$/.test(e) && !/pendiente|no /.test(e)) : (cobro && !Number.isNaN(cobro) ? true : op.estado === 'cobrada');
      it.datos = {
        numero: num, fecha, impuesto_nombre: imp?.nombre || `Impuesto ${pct} %`, impuesto_pct: pct,
        forma_pago: txt(g(f, 'forma_pago'), 60), notas: 'Importada del programa anterior',
        tipo: total < 0 ? 'rectificativa' : 'ordinaria',
      };
      it.totales = { base, cuota: Math.round(cuota * 100) / 100, total, estado: total < 0 ? 'emitida' : cobrada ? 'cobrada' : 'pendiente', cobrada_en: cobrada ? `${cobro && !Number.isNaN(cobro) ? cobro : fecha}T12:00:00` : null };
      it.lineasOk = lineas;
      it.ver[3] = total;
      ctx.numeros.add(num.toUpperCase());
    }
    plan.forEach((x) => { delete x.fila0; delete x.lineas; });
    return plan;
  },
  async ejecutar(plan, op, ctx, progreso) {
    const hacer = plan.filter((x) => x.accion === 'nuevo');
    // Clientes que hay que crear (uno por nombre/NIF)
    const creados = new Map();
    for (const it of hacer.filter((x) => x.nuevoCliente)) {
      const k = it.nuevoCliente.nif || normal(it.nuevoCliente.nombre);
      if (!creados.has(k)) {
        const ya = ctx.terceros.buscar({ nif: it.nuevoCliente.nif, nombre: it.nuevoCliente.nombre });
        if (ya) creados.set(k, ya.id);
        else { const r = await sb.from('clientes').insert(it.nuevoCliente).select(CAMPOS_TERCERO).single(); if (!r.error) { creados.set(k, r.data.id); ctx.terceros.anadir(r.data); } }
      }
      it.cliente_id = creados.get(k);
    }
    await enParalelo(hacer, 3, async (it) => {
      if (!it.cliente_id) throw new Error('No se pudo crear el cliente');
      const f = await sb.from('facturas').insert({ ...it.datos, cliente_id: it.cliente_id, estado: 'pendiente' }).select('id').single(); if (f.error) throw f.error;
      const l = await sb.from('factura_lineas').insert(it.lineasOk.map((x) => ({ ...x, factura_id: f.data.id })));
      if (l.error) it.avisos.push('Factura creada sin líneas: revísala');
      const u = await sb.from('facturas').update(it.totales).eq('id', f.data.id); if (u.error) throw u.error;
    }, progreso);
  },
};

export const TIPOS = [clientes, vehiculos, articulos, compras, facturas];
export { ESTADOS };

// Relaciona automáticamente las columnas del archivo con los campos del CRM
export function autoMapa(tipo, columnas) {
  const mapa = {}; const usadas = new Set();
  const cols = columnas.map((c) => [c, normal(c)]);
  const asignar = (pred) => {
    for (const campo of tipo.campos) {
      if (mapa[campo.k]) continue;
      const nombres = [normal(campo.l), ...campo.syn.map(normal)];
      for (const nom of nombres) {
        const hit = cols.find(([c, n]) => !usadas.has(c) && pred(n, nom));
        if (hit) { mapa[campo.k] = hit[0]; usadas.add(hit[0]); break; }
      }
    }
  };
  const junto = (x) => x.replace(/ /g, '');
  asignar((n, nom) => n === nom);
  asignar((n, nom) => junto(n) === junto(nom)); // "N.I.F." = "NIF", "C.P." = "CP"
  asignar((n, nom) => nom.length > 3 && (n.startsWith(nom + ' ') || n.endsWith(' ' + nom)));
  return mapa;
}

// Plantillas de ejemplo (CSV) para quien no sepa cómo preparar el archivo
export const PLANTILLAS = {
  clientes: [['Código', 'Nombre', 'NIF', 'Tipo', 'Teléfono', 'Móvil', 'Email', 'Dirección', 'CP', 'Población', 'Provincia', 'Forma de pago', 'Plazo pago', 'IBAN', 'Observaciones'],
    ['C0001', 'Juan Pérez Rodríguez', '12345678Z', 'Cliente', '928 123 456', '600 111 222', 'juan@ejemplo.com', 'C/ Mayor 12', '35500', 'Arrecife', 'Las Palmas', 'Contado', '', '', ''],
    ['P0001', 'Recambios Canarias SL', 'B35000000', 'Proveedor', '928 999 000', '', 'pedidos@recambios.es', 'Pol. Ind. 4', '35500', 'Arrecife', 'Las Palmas', 'Transferencia', '30', 'ES9121000418450200051332', 'Pedidos antes de las 12']],
  vehiculos: [['NIF cliente', 'Código cliente', 'Matrícula', 'Bastidor', 'Marca', 'Modelo', 'Año', 'Km', 'Cilindrada', 'Fecha ITV'],
    ['12345678Z', 'C0001', '1234ABC', 'JYARN231000012345', 'Yamaha', 'MT-07', '2021', '18500', '689', '15/06/2027']],
  articulos: [['Referencia', 'Descripción', 'Familia', 'Marca', 'PVP', 'Precio coste', 'Stock', 'Stock mínimo', 'Ubicación', 'Proveedor'],
    ['EBC-FA252HH', 'Pastillas de freno sinterizadas', 'Frenos', 'EBC', '42,50', '24,90', '6', '2', 'A-3', 'Recambios Canarias SL']],
  compras: [['Nº albarán', 'Fecha', 'Proveedor', 'Referencia', 'Descripción', 'Cantidad', 'Precio'],
    ['A-2026-0153', '03/11/2026', 'B35000000', 'EBC-FA252HH', 'Pastillas de freno sinterizadas', '4', '24,90']],
  facturas: [['Nº factura', 'Fecha', 'NIF cliente', 'Cliente', 'Concepto', 'Cantidad', 'Precio', 'Dto', 'Base imponible', '% IGIC', 'Cuota', 'Total', 'Estado'],
    ['F2025-0412', '28/12/2025', '12345678Z', 'Juan Pérez Rodríguez', 'Revisión 20.000 km', '1', '120,00', '', '162,50', '7', '11,38', '173,88', 'Cobrada'],
    ['F2025-0412', '28/12/2025', '12345678Z', 'Juan Pérez Rodríguez', 'Pastillas de freno', '1', '42,50', '', '162,50', '7', '11,38', '173,88', 'Cobrada']],
};
