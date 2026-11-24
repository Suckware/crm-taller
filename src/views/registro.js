// Registro de cambios: quién cambió qué y cuándo. Solo para el administrador.
// Lo escribe la base de datos (disparadores), así que aquí solo se consulta.
// La base de datos además solo deja leerlo al administrador y si la licencia
// incluye el módulo AUDITORIA: esta pantalla no decide nada de seguridad.
import { sb, state, esc, attr, ok, opt, fdt, money, modal, fail, nombreTecnico, today, isoDay, esAdmin, tieneModulo } from '../lib.js';

const POR_PAGINA = 100;

const PESTANAS = [
  ['todo', 'Todos los cambios'],
  ['citas', 'Citas cambiadas'],
  ['lineas_borradas', 'Líneas borradas'],
  ['lineas_cambiadas', 'Líneas cambiadas'],
  ['precios', 'Precios cambiados'],
];

const TABLAS = {
  citas: 'Cita', factura_lineas: 'Línea de factura', reparacion_piezas: 'Pieza en orden', reparacion_horas: 'Horas en orden',
  facturas: 'Factura', reparaciones: 'Orden de reparación', piezas: 'Artículo del almacén', clientes: 'Cliente / proveedor',
  contactos: 'Contacto', datos_bancarios: 'Datos bancarios', motos: 'Vehículo', perfiles: 'Usuario', tarifas: 'Tarifa',
  impuestos: 'Impuesto', config: 'Configuración', factura_reparaciones: 'Orden en factura', remesas: 'Remesa', remesa_recibos: 'Recibo de remesa', roles: 'Rol',
};
const ACCIONES = { alta: ['Alta', 'ok'], cambio: ['Cambio', 'info'], borrado: ['Borrado', 'bad'] };

const CAMPOS = {
  inicio: 'Fecha y hora', duracion_min: 'Duración (min)', servicio: 'Servicio', tecnico_id: 'Técnico', estado: 'Estado', notas: 'Notas',
  cliente_id: 'Cliente', moto_id: 'Vehículo', concepto: 'Concepto', cantidad: 'Cantidad', precio: 'Precio', dto_pct: 'Dto. %', importe: 'Importe',
  pvp: 'PVP', precio_compra: 'Precio de compra', precio_hora: 'Precio hora', horas: 'Horas', descripcion: 'Descripción',
  nombre: 'Nombre', referencia: 'Referencia', descuento_pct: 'Descuento %', tarifa_id: 'Tarifa', total: 'Total', base: 'Base', cuota: 'Cuota',
  impuesto_pct: 'Impuesto %', numero: 'Número', fecha: 'Fecha', rol: 'Rol', activo: 'Activo', usuario: 'Usuario', matricula: 'Matrícula',
  iban: 'IBAN', titular: 'Titular', porcentaje: 'Porcentaje', forma_pago: 'Forma de pago',
  acceso_ios: 'Entra desde iPhone/iPad', acceso_android: 'Entra desde Android', acceso_windows: 'Entra desde Windows', acceso_otros: 'Entra desde otros equipos',
  ventanas: 'Ventanas', nivel: 'Permisos', tecnico: 'Sale como mecánico',
};
const DINERO = new Set(['precio', 'importe', 'pvp', 'precio_compra', 'precio_hora', 'total', 'base', 'cuota', 'importe_max_autorizado']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA_HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function valor(k, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (DINERO.has(k) && !isNaN(Number(v))) return money(v);
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (typeof v === 'string' && UUID.test(v) && (k === 'tecnico_id' || k === 'usuario_id' || k === 'creada_por')) return nombreTecnico(v);
  if (typeof v === 'string' && FECHA_HORA.test(v)) return fdt(v);
  if (Array.isArray(v)) return v.join(', ') || '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
const campo = (k) => CAMPOS[k] || k.replace(/_/g, ' ');

// Resumen de los cambios en una línea: "Precio: 40,00 € → 35,00 €"
function resumen(r) {
  if (r.accion === 'cambio') {
    return (r.campos || []).map((k) => `<span class="reg-c"><b>${esc(campo(k))}:</b> <s>${esc(valor(k, r.antes?.[k]))}</s> → ${esc(valor(k, r.despues?.[k]))}</span>`).join(' ');
  }
  const f = r.accion === 'alta' ? r.despues : r.antes;
  if (!f) return '';
  const claves = ['concepto', 'cantidad', 'precio', 'dto_pct', 'pvp', 'horas', 'precio_hora', 'inicio', 'estado', 'total'].filter((k) => k in f && f[k] !== null);
  return claves.map((k) => `<span class="reg-c"><b>${esc(campo(k))}:</b> ${esc(valor(k, f[k]))}</span>`).join(' ');
}

function consulta(p, desde) {
  let q = sb.from('registro_cambios').select('*').order('fecha', { ascending: false }).order('id', { ascending: false });
  if (p.tab === 'citas') q = q.eq('tabla', 'citas').in('accion', ['cambio', 'borrado']);
  if (p.tab === 'lineas_borradas') q = q.eq('es_linea', true).eq('accion', 'borrado');
  if (p.tab === 'lineas_cambiadas') q = q.eq('es_linea', true).eq('accion', 'cambio');
  if (p.tab === 'precios') q = q.eq('precio_cambiado', true);
  if (p.desde) q = q.gte('fecha', new Date(p.desde + 'T00:00:00').toISOString());
  if (p.hasta) q = q.lt('fecha', new Date(new Date(p.hasta + 'T00:00:00').getTime() + 86400000).toISOString());
  if (p.u) q = q.eq('usuario_id', p.u);
  if (p.q) q = q.ilike('referencia', `%${p.q.replace(/[%_\\]/g, (c) => '\\' + c)}%`);
  return q.range(desde, desde + POR_PAGINA - 1);
}

export async function render(el, params) {
  if (!esAdmin()) { location.hash = '#/'; return; }
  const p = {
    tab: PESTANAS.some(([k]) => k === params.t) ? params.t : 'todo',
    desde: /^\d{4}-\d{2}-\d{2}$/.test(params.desde || '') ? params.desde : isoDay(Date.now() - 30 * 86400000),
    hasta: /^\d{4}-\d{2}-\d{2}$/.test(params.hasta || '') ? params.hasta : today(),
    u: UUID.test(params.u || '') ? params.u : '',
    q: (params.q || '').slice(0, 80),
  };
  const enlace = (o) => '#/registro?' + new URLSearchParams(Object.entries({ ...p, t: p.tab, ...o }).filter(([k, v]) => v && k !== 'tab'));

  el.innerHTML = `<div class="head"><div class="t"><h1>Registro de cambios</h1><div class="muted">Qué ha cambiado cada usuario. Solo lo ve el administrador y no se puede modificar ni borrar.</div></div>
    <div class="actions"><button type="button" class="btn" data-csv>Descargar Excel (CSV)</button><button type="button" class="btn" data-print>Imprimir</button></div></div>
  <nav class="tabs">${PESTANAS.map(([k, t]) => `<a href="${attr(enlace({ t: k }))}" class="${k === p.tab ? 'on' : ''}">${esc(t)}</a>`).join('')}</nav>
  ${!tieneModulo('AUDITORIA') ? '<div class="card"><h2>No incluido en tu plan</h2><p class="muted">El registro de cambios y sus informes no están en el plan contratado. Los cambios se siguen apuntando: al ampliar el plan verás todo el historial.</p></div>' : `
  <form class="agenda-bar reg-filtros" data-f>
    <label class="small">Desde <input class="inp" type="date" name="desde" value="${attr(p.desde)}"></label>
    <label class="small">Hasta <input class="inp" type="date" name="hasta" value="${attr(p.hasta)}"></label>
    <label class="small">Usuario <select class="inp" name="u">${opt('', 'Todos', p.u)}${state.perfiles.map((x) => opt(x.id, x.nombre, p.u)).join('')}</select></label>
    <input type="search" class="search" name="q" value="${attr(p.q)}" placeholder="Buscar factura, orden, cliente, concepto…" aria-label="Buscar en el registro" maxlength="80">
    <button class="btn pri" type="submit">Ver</button>
  </form>
  <section class="card"><div class="tablewrap"><table class="reg-tabla"><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Dónde</th><th>Referencia</th><th>Detalle</th></tr></thead><tbody data-body><tr><td colspan="6" class="muted">Cargando…</td></tr></tbody></table></div>
  <div style="text-align:center"><button type="button" class="btn" data-mas hidden>Ver más</button></div></section>`}`;

  el.querySelector('[data-print]').addEventListener('click', () => window.print());
  if (!tieneModulo('AUDITORIA')) { el.querySelector('[data-csv]').remove(); return; }

  const filas = [];
  const body = el.querySelector('[data-body]');
  const mas = el.querySelector('[data-mas]');
  const fila = (r, i) => `<tr data-i="${i}" style="cursor:pointer"><td class="num" style="white-space:nowrap">${esc(fdt(r.fecha))}</td><td>${esc(r.usuario_nombre)}</td>
    <td>${(() => { const [t, c] = ACCIONES[r.accion] || [r.accion, '']; return `<span class="chip ${c}">${esc(t)}</span>`; })()}${r.precio_cambiado ? ' <span class="chip warn">Precio</span>' : ''}</td>
    <td>${esc(TABLAS[r.tabla] || r.tabla)}</td><td>${esc(r.referencia || (r.tabla === 'roles' ? (r.despues || r.antes)?.nombre || state.roles.find((x) => String(x.id) === String(r.registro_id))?.nombre || '' : ''))}</td><td class="small">${resumen(r)}</td></tr>`;
  const cargar = async () => {
    mas.disabled = true;
    const R = ok(await consulta(p, filas.length));
    const desde = filas.length;
    filas.push(...R);
    if (!desde) body.innerHTML = '';
    body.insertAdjacentHTML('beforeend', R.map((r, j) => fila(r, desde + j)).join(''));
    if (!filas.length) body.innerHTML = '<tr><td colspan="6" class="muted">No hay cambios con estos filtros.</td></tr>';
    mas.hidden = R.length < POR_PAGINA; mas.disabled = false;
  };
  await cargar();
  mas.addEventListener('click', cargar);

  el.querySelector('[data-f]').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    location.hash = enlace({ desde: f.get('desde'), hasta: f.get('hasta'), u: f.get('u'), q: String(f.get('q') || '').trim() });
  });

  body.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-i]'); if (!tr) return;
    const r = filas[Number(tr.dataset.i)];
    const claves = [...new Set([...Object.keys(r.antes || {}), ...Object.keys(r.despues || {})])];
    modal(`${(ACCIONES[r.accion] || [r.accion])[0]} · ${TABLAS[r.tabla] || r.tabla}`, `
      <p style="margin:0 0 10px"><b>${esc(r.referencia || '')}</b><br><span class="muted small">${esc(fdt(r.fecha))} · ${esc(r.usuario_nombre)}</span></p>
      <div class="tablewrap"><table><thead><tr><th>Campo</th><th>Antes</th><th>Después</th></tr></thead><tbody>
      ${claves.map((k) => `<tr${(r.campos || []).includes(k) ? ' style="background:var(--warn-bg)"' : ''}><td>${esc(campo(k))}</td><td>${esc(valor(k, r.antes?.[k]))}</td><td>${esc(valor(k, r.despues?.[k]))}</td></tr>`).join('')}
      </tbody></table></div>`, { cancelText: 'Cerrar', wide: true });
  });

  // Exporta todo lo filtrado (no solo lo que se ve), en páginas, para abrir con Excel
  el.querySelector('[data-csv]').addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true; const txt = b.textContent; b.textContent = 'Preparando…';
    try {
      const todo = [];
      for (let n = 0; n < 50; n++) { // hasta 5.000 filas
        const R = ok(await consulta(p, todo.length));
        todo.push(...R);
        if (R.length < POR_PAGINA) break;
      }
      const c = (v) => { const s = String(v ?? '').replace(/\s+/g, ' '); return /[";\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; };
      const lineas = [['Fecha', 'Usuario', 'Acción', 'Dónde', 'Referencia', 'Campo', 'Antes', 'Después'].join(';')];
      for (const r of todo) {
        const base = [fdt(r.fecha), r.usuario_nombre, (ACCIONES[r.accion] || [r.accion])[0], TABLAS[r.tabla] || r.tabla, r.referencia];
        const ks = r.accion === 'cambio' ? r.campos : [''];
        for (const k of ks) lineas.push([...base, k ? campo(k) : '', k ? valor(k, r.antes?.[k]) : '', k ? valor(k, r.despues?.[k]) : ''].map(c).join(';'));
      }
      const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `registro-${p.tab}-${p.desde}-a-${p.hasta}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (err) { fail(err); } finally { b.disabled = false; b.textContent = txt; }
  });
}
