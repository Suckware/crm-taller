// Configuración › Importar datos: trae clientes, vehículos, artículos, compras y facturas de otro programa de taller.
// Pasos: elegir qué importar → subir el archivo → relacionar columnas → comprobar (sin guardar nada) → importar.
import { esc, attr, toast, fail, opt, confirmar, esAdmin, puedeFacturar, licEstado } from '../lib.js';
import { I } from '../icons.js';
import { leerArchivo, aCsv, descargar } from '../importar/leer.js';
import { TIPOS, autoMapa, PLANTILLAS, COD_ANTERIOR } from '../importar/tipos.js';

const VER = {
  clientes: ['Nombre', 'NIF', 'Teléfono', 'Email', 'Rol'],
  vehiculos: ['Matrícula', 'Vehículo', 'Cliente'],
  articulos: ['Referencia', 'Nombre', 'PVP', 'Stock'],
  compras: ['Albarán', 'Fecha', 'Proveedor', 'Referencia', 'Cantidad'],
  facturas: ['Nº', 'Fecha', 'Cliente', 'Total'],
};
const ACC = { nuevo: ['Nuevo', 'ok'], actualizar: ['Actualizar', 'info'], saltar: ['Se salta', ''], error: ['No se importa', 'bad'] };
const s = { tipo: null, archivo: null, tabla: null, mapa: {}, op: {}, plan: null, ctx: null, filtro: '', hecho: false };

export function render(T) {
  if (!esAdmin()) { T.innerHTML = '<section class="card"><p>Solo el administrador puede importar datos.</p></section>'; return; }
  if (licEstado() === 'consulta') { T.innerHTML = '<section class="card"><p>La licencia está en modo consulta: no se pueden importar datos.</p></section>'; return; }
  pintar(T);
}

function tiposVisibles() { return TIPOS.filter((t) => !t.soloFacturacion || puedeFacturar()); }
function reiniciar(tipo = null) { Object.assign(s, { tipo, archivo: null, tabla: null, mapa: {}, op: {}, plan: null, ctx: null, filtro: '', hecho: false }); }

function pintar(T) {
  if (!s.tipo) return pasoElegir(T);
  if (!s.tabla) return pasoArchivo(T);
  if (!s.plan) return pasoColumnas(T);
  return pasoRevisar(T);
}

function pasos(n) {
  const L = ['Qué importar', 'Archivo', 'Columnas', 'Comprobar e importar'];
  return `<ol class="imp-pasos">${L.map((l, i) => `<li class="${i + 1 === n ? 'on' : i + 1 < n ? 'hecho' : ''}"><b>${i + 1}</b>${esc(l)}</li>`).join('')}</ol>`;
}

// ---------- 1. Qué importar ----------
function pasoElegir(T) {
  T.innerHTML = `${pasos(1)}
  <section class="card"><h2>¿Qué quieres traer del programa anterior?</h2>
    <p class="muted" style="margin:0">Recomendado en este orden: primero clientes y proveedores, luego vehículos y artículos, y al final compras y facturas, porque se enlazan con los anteriores.</p>
    <div class="imp-tipos">${tiposVisibles().map((t, i) => `<button type="button" class="imp-tipo" data-t="${t.id}"><span class="imp-n">${i + 1}</span><span class="imp-ic">${I[t.icono] || ''}</span><b>${esc(t.titulo)}</b><span class="muted small">${esc(t.desc)}</span></button>`).join('')}
      <div class="imp-tipo off"><span class="imp-ic">${I.moto || I.rep}</span><b>Albaranes de venta y órdenes de trabajo</b><span class="muted small">Próximamente, cuando esté la facturación por periodos (albaranes que se facturan a fin de mes).</span></div>
    </div></section>
  <section class="card"><h2>Cómo sacar los datos del programa antiguo</h2>
    <ul class="imp-ayuda">
      <li>Casi todos los programas de taller tienen en cada listado (clientes, artículos, facturas…) un botón de <b>Exportar a Excel</b> o <b>CSV</b>. Sirve cualquiera de los dos.</li>
      <li>No hace falta que las columnas se llamen igual que aquí: en el paso 3 eliges qué columna es cada dato. Las columnas que no necesites se ignoran.</li>
      <li>Si el programa solo deja hacer una copia de la base de datos (Access, SQL…), pásanosla y la convertimos al formato de importación.</li>
      <li>Antes de guardar nada verás una comprobación fila a fila. Lo que ya exista en el CRM no se duplica.</li>
    </ul></section>`;
  T.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { reiniciar(TIPOS.find((t) => t.id === b.dataset.t)); pintar(T); }));
}

// ---------- 2. Archivo ----------
function pasoArchivo(T) {
  const t = s.tipo;
  T.innerHTML = `${pasos(2)}
  <section class="card"><div class="head"><div class="t"><h2>${esc(t.titulo)}</h2><span class="muted small">${esc(t.desc)}</span></div><button type="button" class="btn sm" data-volver>Elegir otra cosa</button></div>
    <label class="imp-drop" data-drop><input type="file" accept=".csv,.txt,.xlsx,.tsv" data-file class="sr">
      <b>Arrastra aquí el archivo o pulsa para elegirlo</b><span class="muted small">Excel (.xlsx) o CSV · máximo 15 MB · se lee en este ordenador, no se sube nada hasta que confirmes</span></label>
    <p class="muted small" style="margin:0">¿No sabes cómo debe ser el archivo? <button type="button" class="linkbtn" data-plantilla>Descarga una plantilla de ejemplo</button> y rellénala.</p>
    ${t.requiere ? `<p class="small" style="margin:0">Importa antes <b>${esc(TIPOS.find((x) => x.id === t.requiere).titulo.toLowerCase())}</b>, porque cada fila se enlaza con ellos.</p>` : ''}
  </section>`;
  T.querySelector('[data-volver]').addEventListener('click', () => { reiniciar(); pintar(T); });
  T.querySelector('[data-plantilla]').addEventListener('click', () => { const [c, ...f] = PLANTILLAS[t.id]; descargar(`plantilla-${t.id}.csv`, aCsv(c, f)); });
  const cargar = async (file) => {
    if (!file) return;
    const drop = T.querySelector('[data-drop] b'); drop.textContent = `Leyendo ${file.name}…`;
    try {
      s.tabla = await leerArchivo(file); s.archivo = file.name;
      s.mapa = autoMapa(t, s.tabla.columnas);
      s.op = Object.fromEntries(t.opciones.map((o) => [o.k, o.def]));
      pintar(T);
    } catch (e) { drop.textContent = 'Arrastra aquí el archivo o pulsa para elegirlo'; toast(e.message || String(e), true); }
  };
  T.querySelector('[data-file]').addEventListener('change', (e) => cargar(e.target.files[0]));
  const dz = T.querySelector('[data-drop]');
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); cargar(e.dataTransfer.files[0]); });
}

// ---------- 3. Columnas ----------
function pasoColumnas(T) {
  const t = s.tipo; const { columnas, filas } = s.tabla;
  const ejemplo = (col) => { if (!col) return ''; const v = filas.slice(0, 50).map((f) => f[col]).find((x) => x !== '' && x != null); return v == null ? '' : String(v).slice(0, 60); };
  const sinUsar = columnas.filter((c) => !Object.values(s.mapa).includes(c));
  T.innerHTML = `${pasos(3)}
  <section class="card"><div class="head"><div class="t"><h2>Relaciona las columnas</h2><span class="muted small">${esc(s.archivo)} · ${filas.length.toLocaleString('es-ES')} filas · ${columnas.length} columnas</span></div><button type="button" class="btn sm" data-otro>Cambiar archivo</button></div>
    <p class="muted small" style="margin:0">Ya hemos relacionado las que se reconocen por el nombre. Revisa que estén bien y elige las que falten. Lo marcado con * es obligatorio.</p>
    <div class="tablewrap"><table class="imp-map"><thead><tr><th>Dato en el CRM</th><th>Columna de tu archivo</th><th>Ejemplo de tu archivo</th></tr></thead><tbody>
    ${t.campos.map((c) => `<tr><td><b>${esc(c.l)}${c.req ? ' *' : ''}</b>${c.ayuda ? `<div class="small muted">${esc(c.ayuda)}</div>` : ''}</td>
      <td><select class="inp" data-k="${attr(c.k)}" aria-label="Columna para ${attr(c.l)}">${opt('', '— no importar —', s.mapa[c.k] || '')}${columnas.map((col) => opt(col, col, s.mapa[c.k] || '')).join('')}</select></td>
      <td class="small muted" data-ej="${attr(c.k)}">${esc(ejemplo(s.mapa[c.k]))}</td></tr>`).join('')}
    </tbody></table></div>
    ${sinUsar.length ? `<p class="small muted" style="margin:0">Columnas que no se van a importar: ${esc(sinUsar.slice(0, 30).join(', '))}${sinUsar.length > 30 ? '…' : ''}</p>` : ''}
  </section>
  <section class="card"><h2>Opciones</h2><div class="form">${t.opciones.map((o) => `<div class="field full"><label for="op-${o.k}">${esc(o.l)}</label><select id="op-${o.k}" data-op="${attr(o.k)}">${o.vals.map(([v, l]) => opt(v, l, s.op[o.k])).join('')}</select></div>`).join('')}</div>
    <div class="actions"><button type="button" class="btn pri" data-comprobar>Comprobar sin guardar</button></div></section>`;
  T.querySelector('[data-otro]').addEventListener('click', () => { s.tabla = null; pintar(T); });
  T.querySelectorAll('[data-k]').forEach((sel) => sel.addEventListener('change', () => {
    // una columna solo puede ir a un dato
    if (sel.value) Object.keys(s.mapa).forEach((k) => { if (s.mapa[k] === sel.value && k !== sel.dataset.k) delete s.mapa[k]; });
    if (sel.value) s.mapa[sel.dataset.k] = sel.value; else delete s.mapa[sel.dataset.k];
    pasoColumnas(T);
  }));
  T.querySelectorAll('[data-op]').forEach((sel) => sel.addEventListener('change', () => { s.op[sel.dataset.op] = sel.value; }));
  T.querySelector('[data-comprobar]').addEventListener('click', async (e) => {
    const falta = t.campos.filter((c) => c.req && !s.mapa[c.k]);
    if (falta.length) return toast(`Falta elegir la columna de: ${falta.map((c) => c.l).join(', ')}`, true);
    if (t.id === 'vehiculos' || t.id === 'facturas') if (!['cliente_nif', 'cliente_codigo', 'cliente_nombre'].some((k) => s.mapa[k])) return toast('Elige al menos una columna para identificar al cliente (NIF, código o nombre)', true);
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Comprobando…';
    try {
      s.ctx = await t.cargar();
      s.plan = t.planificar(s.tabla.filas, s.mapa, s.op, s.ctx);
      pintar(T);
    } catch (err) { fail(err); b.disabled = false; b.textContent = 'Comprobar sin guardar'; }
  });
}

// ---------- 4. Comprobar e importar ----------
function cuenta(plan) {
  const c = { nuevo: 0, actualizar: 0, saltar: 0, error: 0, avisos: 0, ok: 0, fallo: 0, igual: 0 };
  plan.forEach((x) => { c[x.accion]++; if (x.avisos.length) c.avisos++; if (x.resultado === 'ok') { if (x.sinCambios) c.igual++; else c.ok++; } if (x.resultado === 'error') c.fallo++; });
  return c;
}
function pasoRevisar(T) {
  const t = s.tipo; const plan = s.plan; const c = cuenta(plan); const [u1, uN] = t.unidad;
  const n = (k) => (k === 1 ? u1 : uN);
  const aHacer = c.nuevo + c.actualizar;
  const filtros = [['', `Todo (${plan.length})`], ['nuevo', `Nuevos (${c.nuevo})`], ['actualizar', `A actualizar (${c.actualizar})`], ['saltar', `Se saltan (${c.saltar})`], ['error', `No se importan (${c.error})`], ['avisos', `Con avisos (${c.avisos})`]].filter(([k], i) => i === 0 || (k === 'avisos' ? c.avisos : c[k]));
  if (s.hecho) filtros.push(['fallo', `Fallaron (${c.fallo})`]);
  const vis = plan.filter((x) => !s.filtro || (s.filtro === 'avisos' ? x.avisos.length : s.filtro === 'fallo' ? x.resultado === 'error' : x.accion === s.filtro));
  const MAX = 300;
  const estadoRes = (x) => (x.resultado === 'ok' ? `<span class="chip ok">${x.sinCambios ? 'Sin cambios' : 'Hecho'}</span>` : x.resultado === 'error' ? `<span class="chip bad">Error</span>` : '');
  T.innerHTML = `${pasos(4)}
  <section class="card"><div class="head"><div class="t"><h2>${s.hecho ? 'Importación terminada' : 'Comprobación'} · ${esc(t.titulo)}</h2><span class="muted small">${esc(s.archivo)}${s.hecho ? '' : ' · todavía no se ha guardado nada'}</span></div>
    <div class="actions">${s.hecho ? '<button type="button" class="btn" data-otra>Importar otra cosa</button>' : '<button type="button" class="btn sm" data-atras>Volver a las columnas</button>'}</div></div>
    <div class="imp-res">
      ${s.hecho ? `<div class="ok"><b>${c.ok}</b>${c.ok === 1 ? 'guardado' : 'guardados'}</div>${c.igual ? `<div><b>${c.igual}</b>ya estaban igual</div>` : ''}<div class="${c.fallo ? 'bad' : ''}"><b>${c.fallo}</b>con error</div>`
        : `<div class="ok"><b>${c.nuevo}</b>${n(c.nuevo)} nuev${u1.endsWith('a') ? 'a' : 'o'}${c.nuevo === 1 ? '' : 's'}</div><div class="info"><b>${c.actualizar}</b>a actualizar</div>`}
      <div><b>${c.saltar}</b>se saltan</div><div class="${c.error ? 'bad' : ''}"><b>${c.error}</b>no se importan</div><div class="${c.avisos ? 'warn' : ''}"><b>${c.avisos}</b>con avisos</div>
    </div>
    ${s.hecho ? '' : `<div class="actions"><button type="button" class="btn pri" data-importar ${aHacer ? '' : 'disabled'}>Importar ${aHacer.toLocaleString('es-ES')} ${n(aHacer)}</button>${c.error || c.avisos ? '<button type="button" class="btn" data-problemas>Descargar filas con problemas</button>' : ''}</div>`}
    ${s.hecho ? '<div class="actions"><button type="button" class="btn" data-informe>Descargar informe completo</button></div>' : ''}
    <div class="imp-prog" data-prog hidden><div><i style="width:0"></i></div><span class="small muted">Preparando…</span></div>
  </section>
  <section class="card"><nav class="tabs">${filtros.map(([k, l]) => `<button type="button" data-f="${k}" class="${s.filtro === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</nav>
    <div class="tablewrap"><table class="imp-prev"><thead><tr><th>Fila</th><th>Qué se hará</th>${VER[t.id].map((h) => `<th>${esc(h)}</th>`).join('')}<th>Detalle</th>${s.hecho ? '<th>Resultado</th>' : ''}</tr></thead>
    <tbody>${vis.slice(0, MAX).map((x) => `<tr><td class="num muted">${esc(fila(x))}</td><td><span class="chip ${ACC[x.accion][1]}">${ACC[x.accion][0]}</span></td>${(x.ver || []).map((v) => `<td>${esc(v)}</td>`).join('')}${'<td></td>'.repeat(Math.max(0, VER[t.id].length - (x.ver || []).length))}
      <td class="small">${x.motivo ? `<div>${esc(x.motivo)}</div>` : ''}${x.avisos.map((a) => `<div class="imp-aviso">${esc(a)}</div>`).join('')}${x.error ? `<div class="imp-err">${esc(x.error)}</div>` : ''}</td>${s.hecho ? `<td>${estadoRes(x)}</td>` : ''}</tr>`).join('') || `<tr><td colspan="${VER[t.id].length + 4}" class="empty">Nada en este filtro</td></tr>`}</tbody></table></div>
    ${vis.length > MAX ? `<p class="small muted" style="margin:0">Se muestran las primeras ${MAX} de ${vis.length.toLocaleString('es-ES')}. Descarga el listado para verlas todas.</p>` : ''}
  </section>`;
  T.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { s.filtro = b.dataset.f; pasoRevisar(T); }));
  T.querySelector('[data-atras]')?.addEventListener('click', () => { s.plan = null; pintar(T); });
  T.querySelector('[data-otra]')?.addEventListener('click', () => { reiniciar(); pintar(T); });
  T.querySelector('[data-problemas]')?.addEventListener('click', () => informe(plan.filter((x) => x.accion === 'error' || x.avisos.length), 'problemas'));
  T.querySelector('[data-informe]')?.addEventListener('click', () => informe(plan, 'informe'));
  T.querySelector('[data-importar]')?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    const extra = t.id === 'facturas' ? ' Las facturas importadas no se pueden borrar después (solo anular), como cualquier factura.' : '';
    if (!(await confirmar(`Se van a guardar ${aHacer} ${n(aHacer)} en el CRM (${c.nuevo} nuevos y ${c.actualizar} a actualizar).${extra} ¿Seguimos?`, 'Sí, importar'))) return;
    b.disabled = true;
    T.querySelectorAll('[data-atras],[data-problemas]').forEach((x) => { x.disabled = true; });
    const prog = T.querySelector('[data-prog]'); prog.hidden = false;
    const barra = prog.querySelector('i'); const txt = prog.querySelector('span');
    const salirAviso = (ev) => { ev.preventDefault(); ev.returnValue = ''; };
    window.addEventListener('beforeunload', salirAviso);
    try {
      await t.ejecutar(plan, s.op, s.ctx, (hechos, total) => { barra.style.width = `${Math.round((hechos / total) * 100)}%`; txt.textContent = `Guardando ${hechos.toLocaleString('es-ES')} de ${total.toLocaleString('es-ES')}…`; });
      s.hecho = true; s.filtro = cuenta(plan).fallo ? 'fallo' : '';
      const r = cuenta(plan);
      toast(r.fallo ? `Importación terminada con ${r.fallo} errores` : 'Importación terminada', !!r.fallo);
    } catch (err) { fail(err); s.hecho = true; } finally { window.removeEventListener('beforeunload', salirAviso); }
    pasoRevisar(T);
  });
}
const fila = (x) => (x.filas.length > 1 ? `${x.filas[0]}–${x.filas[x.filas.length - 1]}` : String(x.filas[0] ?? ''));

// Informe descargable: las filas originales del archivo + qué se hizo con cada una
function informe(items, nombre) {
  const { columnas, filas } = s.tabla;
  const accion = (x) => (x.resultado === 'ok' ? (x.sinCambios ? 'Sin cambios' : 'Importado') : x.resultado === 'error' ? 'Error' : ACC[x.accion][0]);
  const out = [];
  for (const x of items) for (const n of x.filas) out.push([n, accion(x), [x.motivo, ...x.avisos, x.error].filter(Boolean).join(' · '), ...columnas.map((c) => filas[n - 1]?.[c] ?? '')]);
  descargar(`${nombre}-${s.tipo.id}-${new Date().toISOString().slice(0, 10)}.csv`, aCsv(['Fila', 'Resultado', 'Detalle', ...columnas], out));
}
export { COD_ANTERIOR };
