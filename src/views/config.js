import { sb, state, esc, attr, ok, modal, toast, fail, formData, field, area, opt, esAdmin, aplicarTema, cargarComunes, hex, money, fdate, fdt, licEstado, licPlan, MODULOS_CRM, refrescarLicencia, activarLicencia, nombreRol, VENTANAS, NIVELES, DISPOSITIVOS, confirmar } from '../lib.js';
import { ibanValido, bicValido, idAcreedor } from '../sepa.js';
import { CONDICIONES_DEF } from './recepcion.js';
import * as importar from './importar.js';
import { equipoLocal, marcarEquipoLocal, iniciarLatido, pararLatido, avisarCierre, estadoSync } from '../sync.js';

const TEMAS = [
  ['Sergio Moto Sport', '#1F3A6E', '#111827'], ['Azul marino', '#1E3A8A', '#0B1B36'], ['Pizarra', '#334155', '#1E293B'],
  ['Verde inglés', '#1F5140', '#10241D'], ['Burdeos', '#7A1F2B', '#1F1316'], ['Grafito', '#3F3F46', '#18181B'],
];

// Las pestañas se agrupan en apartados para que quepan en cualquier pantalla.
// Los enlaces siguen siendo #/config?t=<pestaña>, así que los accesos directos de otras pantallas no cambian.
const GRUPOS = [
  ['taller', 'Taller', [['taller', 'Datos del taller'], ['apariencia', 'Logo y colores'], ['campos', 'Campos personalizados']]],
  ['precios', 'Precios e impuestos', [['impuestos', 'Impuestos'], ['tarifas', 'Tarifas']]],
  ['accesos', 'Usuarios y accesos', [['usuarios', 'Usuarios'], ['roles', 'Roles y ventanas'], ['equipos', 'Equipo del taller']]],
  ['sistema', 'Licencia y datos', [['licencia', 'Licencia'], ['importar', 'Importar datos']]],
  ['perfil', 'Mi perfil', [['perfil', 'Mi perfil']]],
];

export async function render(el, params) {
  const adm = esAdmin();
  const tab = params.t || (adm ? 'taller' : 'perfil');
  const grupos = adm ? GRUPOS : [['perfil', 'Mi perfil', [['perfil', 'Mi perfil']]]];
  const grupo = grupos.find((g) => g[2].some(([k]) => k === tab)) || grupos[0];
  el.innerHTML = `<div class="head"><div class="t"><h1>Configuración</h1><div class="muted">${adm ? 'Solo el administrador puede cambiar estos ajustes' : 'Los ajustes del taller los gestiona el administrador'}</div></div></div>
  ${grupos.length > 1 ? `<nav class="cfg-grupos" aria-label="Apartados de configuración">${grupos.map(([g, t, sub]) => `<a href="#/config?t=${sub[0][0]}" class="${g === grupo[0] ? 'on' : ''}"${g === grupo[0] ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav>` : ''}
  ${grupo[2].length > 1 ? `<nav class="tabs cfg-sub" aria-label="${attr(grupo[1])}">${grupo[2].map(([k, t]) => `<a href="#/config?t=${k}" class="${k === tab ? 'on' : ''}">${t}</a>`).join('')}</nav>` : ''}<div data-tab></div>`;
  const T = el.querySelector('[data-tab]');
  const cfg = state.config;
  const recargar = async () => { await cargarComunes(); render(el, params); };

  if (tab === 'perfil') {
    const p = state.perfil;
    T.innerHTML = `<section class="card" style="max-width:640px"><h2>${esc(p.nombre)}</h2>
      <p style="margin:0">Usuario: <b>${esc(p.usuario)}</b> · Rol: <b>${esc(nombreRol(p.rol))}</b></p>
      <h3>Correo para recuperar la contraseña</h3>
      <div class="form"><div class="field full"><label for="micorreo">Mi correo</label><input id="micorreo" type="email" autocomplete="email" maxlength="120" placeholder="nombre@correo.com"></div></div>
      <p class="muted small" style="margin:0">Si olvidas la contraseña, te llegará aquí un enlace para poner una nueva. Solo lo ves tú y el administrador.</p>
      <button type="button" class="btn" data-correo style="align-self:flex-start">Guardar correo</button>
      <h3>Cambiar mi contraseña</h3>
      <div class="form"><div class="field"><label for="pw1">Nueva contraseña</label><input id="pw1" type="password" autocomplete="new-password" minlength="10" maxlength="128"></div>
      <div class="field"><label for="pw2">Repetir</label><input id="pw2" type="password" autocomplete="new-password" maxlength="128"></div></div>
      <p class="muted small" style="margin:0">Mínimo 10 caracteres, con mayúsculas, minúsculas y números.</p>
      <button type="button" class="btn pri" data-pw style="align-self:flex-start">Cambiar contraseña</button></section>`;
    const inpC = T.querySelector('#micorreo');
    sb.from('usuarios_correo').select('correo').eq('user_id', p.id).maybeSingle().then(({ data }) => { if (data) inpC.value = data.correo; });
    T.querySelector('[data-correo]').addEventListener('click', async () => {
      try { await guardarCorreo(p.id, inpC.value); toast('Correo guardado'); } catch (e) { fail(e); }
    });
    T.querySelector('[data-pw]').addEventListener('click', async () => {
      const a = T.querySelector('#pw1').value, b = T.querySelector('#pw2').value;
      if (a !== b) return toast('Las contraseñas no coinciden', true);
      if (a.length < 10 || !/[a-z]/.test(a) || !/[A-Z]/.test(a) || !/\d/.test(a)) return toast('La contraseña no es suficientemente segura', true);
      const { error } = await sb.auth.updateUser({ password: a });
      if (error) fail(error); else { toast('Contraseña cambiada'); T.querySelector('#pw1').value = T.querySelector('#pw2').value = ''; }
    });
    return;
  }
  if (!adm) return;

  if (tab === 'taller') {
    T.innerHTML = `<section class="card" data-f><div class="form">
      ${field('Nombre comercial', 'nombre_taller', cfg.nombre_taller, 'text', 'maxlength="80" required')}
      ${field('Razón social', 'razon_social', cfg.razon_social, 'text', 'maxlength="120"')}
      ${field('CIF', 'cif', cfg.cif, 'text', 'maxlength="20"')}
      ${field('Teléfono', 'telefono', cfg.telefono, 'tel', 'maxlength="20"')}
      ${field('Email', 'email', cfg.email, 'email', 'maxlength="120"')}
      ${field('Dirección', 'direccion', cfg.direccion, 'text', 'maxlength="200"')}
      ${field('Precio hora por defecto (€)', 'precio_hora', cfg.precio_hora, 'number', 'min="0" step="0.5"')}
      ${field('Serie de facturas', 'serie_factura', cfg.serie_factura, 'text', 'maxlength="12" pattern="[A-Za-z0-9-]+"')}
      ${field('Próximo número de factura', 'siguiente_factura', cfg.siguiente_factura, 'number', 'min="1"')}
      ${field('Serie de facturas rectificativas', 'serie_rectificativa', cfg.serie_rectificativa, 'text', 'maxlength="12" pattern="[A-Za-z0-9-]+"')}
      ${field('Próximo número de rectificativa', 'siguiente_rectificativa', cfg.siguiente_rectificativa, 'number', 'min="1"')}
      ${area('Condiciones de la hoja de autorización', 'condiciones_autorizacion', cfg.condiciones_autorizacion || CONDICIONES_DEF, 'maxlength="4000" style="min-height:180px"')}
      ${area('Pie de factura', 'pie_factura', cfg.pie_factura, 'maxlength="600"')}
    </div>
    <h3 style="margin:0">Cobro de recibos por banco (remesas SEPA)</h3>
    <div class="form">
      ${field('Cuenta de cobro (IBAN)', 'sepa_iban', cfg.sepa_iban, 'text', 'maxlength="34" style="text-transform:uppercase" autocomplete="off"')}
      ${field('BIC de tu banco', 'sepa_bic', cfg.sepa_bic, 'text', 'maxlength="11" style="text-transform:uppercase"')}
      ${field('Sufijo del acreedor', 'sepa_sufijo', cfg.sepa_sufijo, 'text', 'maxlength="3" pattern="[0-9A-Z]{3}"')}
      ${field('Serie de remesas', 'serie_remesa', cfg.serie_remesa, 'text', 'maxlength="12" pattern="[A-Za-z0-9-]+"')}
    </div>
    <p class="muted small" style="margin:0">Identificador de acreedor SEPA (se calcula con el CIF y el sufijo): <b>${esc(idAcreedor(cfg.cif, cfg.sepa_sufijo) || 'pon el CIF')}</b>. El sufijo lo da el banco; normalmente es 000.</p><button type="button" class="btn pri" data-g style="align-self:flex-start">Guardar</button></section>`;
    T.querySelector('[data-g]').addEventListener('click', async () => {
      try {
        const o = formData(T.querySelector('[data-f]'));
        if (!o.nombre_taller) throw new Error('Falta el nombre');
        if (o.serie_factura && !/^[A-Za-z0-9-]{1,12}$/.test(o.serie_factura)) throw new Error('La serie solo admite letras, números y guiones');
        if (o.serie_rectificativa && !/^[A-Za-z0-9-]{1,12}$/.test(o.serie_rectificativa)) throw new Error('La serie de rectificativas solo admite letras, números y guiones');
        if (o.serie_rectificativa && o.serie_rectificativa === o.serie_factura) throw new Error('La serie de rectificativas debe ser distinta de la de facturas');
        o.precio_hora = Number(o.precio_hora) || 0; o.siguiente_factura = Math.max(1, Math.floor(Number(o.siguiente_factura) || 1));
        o.siguiente_rectificativa = Math.max(1, Math.floor(Number(o.siguiente_rectificativa) || 1));
        if (!o.serie_rectificativa) delete o.serie_rectificativa;
        if (o.sepa_iban) { o.sepa_iban = o.sepa_iban.replace(/\s+/g, '').toUpperCase(); if (!ibanValido(o.sepa_iban)) throw new Error('El IBAN de cobro no es válido'); }
        if (o.sepa_bic) { o.sepa_bic = o.sepa_bic.toUpperCase(); if (!bicValido(o.sepa_bic)) throw new Error('El BIC no es válido'); }
        o.sepa_sufijo = (o.sepa_sufijo || '000').toUpperCase(); if (!/^[0-9A-Z]{3}$/.test(o.sepa_sufijo)) throw new Error('El sufijo del acreedor son 3 números o letras');
        if (!o.serie_remesa) delete o.serie_remesa; else if (!/^[A-Za-z0-9-]{1,12}$/.test(o.serie_remesa)) throw new Error('La serie de remesas solo admite letras, números y guiones');
        ok(await sb.from('config').update(o).eq('id', 1)); toast('Datos guardados'); recargar();
      } catch (e) { fail(e); }
    });
  }

  if (tab === 'apariencia') {
    let acc = cfg.color_acento, side = cfg.color_lateral;
    T.innerHTML = `<section class="card" style="max-width:760px"><h2>Colores de la aplicación</h2>
      <p class="muted" style="margin:0">Los colores solo se cambian aquí y se aplican a todo el equipo.</p>
      <div class="swatches">${TEMAS.map(([n, a, s]) => `<button type="button" class="swatch ${a === acc && s === side ? 'on' : ''}" style="background:linear-gradient(135deg, ${a} 50%, ${s} 50%)" data-t="${attr(n)}" aria-label="${attr(n)}" title="${attr(n)}"></button>`).join('')}</div>
      <div class="form"><div class="field"><label for="ca">Color principal</label><input id="ca" type="color" value="${attr(acc)}" style="padding:4px"></div>
      <div class="field"><label for="cs">Menú lateral</label><input id="cs" type="color" value="${attr(side)}" style="padding:4px"></div></div>
      <div style="display:flex;gap:12px;align-items:center"><img src="./logo.png" alt="Logo actual" style="width:64px;height:64px;border-radius:50%"><span class="muted small">Logo del taller (Sergio Moto Sport)</span></div>
      <div class="actions"><button type="button" class="btn pri" data-g>Guardar colores</button><button type="button" class="btn" data-r>Restaurar originales</button></div></section>`;
    const prev = () => aplicarTema({ color_acento: acc, color_lateral: side });
    T.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { const t = TEMAS.find((x) => x[0] === b.dataset.t); acc = t[1]; side = t[2]; T.querySelector('#ca').value = acc; T.querySelector('#cs').value = side; T.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('on', s === b)); prev(); }));
    T.querySelector('#ca').addEventListener('input', (e) => { acc = e.target.value; prev(); });
    T.querySelector('#cs').addEventListener('input', (e) => { side = e.target.value; prev(); });
    const guardar = async (a, s) => { try { ok(await sb.from('config').update({ color_acento: hex(a, '#1F3A6E').toUpperCase(), color_lateral: hex(s, '#111827').toUpperCase() }).eq('id', 1)); toast('Colores guardados'); recargar(); } catch (e) { fail(e); } };
    T.querySelector('[data-g]').addEventListener('click', () => guardar(acc, side));
    T.querySelector('[data-r]').addEventListener('click', () => guardar('#1F3A6E', '#111827'));
  }

  if (tab === 'impuestos') {
    const I = ok(await sb.from('impuestos').select('*').order('id'));
    T.innerHTML = `<section class="card" style="max-width:760px"><div class="head"><h2>Tipos de impuesto</h2><button type="button" class="btn pri" data-n>+ Nuevo impuesto</button></div>
      <p class="muted small" style="margin:0">El impuesto por defecto se propone al facturar; en cada factura se puede elegir otro.</p>
      <div class="list">${I.map((i) => `<div><span class="grow"><b>${esc(i.nombre)} ${Number(i.porcentaje).toLocaleString('es-ES')} %</b><span class="small muted">${i.activo ? 'Activo' : 'Desactivado'}</span></span>
        ${i.por_defecto ? '<span class="chip ok">Por defecto</span>' : `<button type="button" class="btn sm" data-def="${i.id}">Usar por defecto</button>`}
        <button type="button" class="btn sm" data-act="${i.id}">${i.activo ? 'Desactivar' : 'Activar'}</button></div>`).join('')}</div></section>`;
    T.querySelector('[data-n]').addEventListener('click', () => modal('Nuevo impuesto', `<div class="form">${field('Nombre', 'nombre', '', 'text', 'maxlength="30" placeholder="IGIC, IVA, IPSI…"')}${field('Porcentaje', 'porcentaje', '', 'number', 'min="0" max="100" step="0.01"')}</div>`, {
      onOk: async (root) => { const o = formData(root); const p = Number(o.porcentaje); if (!o.nombre || Number.isNaN(p) || p < 0 || p > 100) throw new Error('Datos no válidos'); ok(await sb.from('impuestos').insert({ nombre: o.nombre, porcentaje: p })); toast('Impuesto creado'); recargar(); },
    }));
    T.querySelectorAll('[data-def]').forEach((b) => b.addEventListener('click', async () => {
      try { ok(await sb.from('impuestos').update({ por_defecto: false }).neq('id', Number(b.dataset.def))); ok(await sb.from('impuestos').update({ por_defecto: true, activo: true }).eq('id', Number(b.dataset.def))); toast('Impuesto por defecto cambiado'); recargar(); } catch (e) { fail(e); }
    }));
    T.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
      const i = I.find((x) => x.id == b.dataset.act);
      if (i.por_defecto && i.activo) return toast('No puedes desactivar el impuesto por defecto', true);
      try { ok(await sb.from('impuestos').update({ activo: !i.activo }).eq('id', i.id)); recargar(); } catch (e) { fail(e); }
    }));
  }

  if (tab === 'tarifas') {
    const Tt = ok(await sb.from('tarifas').select('*').order('id'));
    T.innerHTML = `<section class="card" style="max-width:860px"><div class="head"><h2>Tipos de tarifa</h2><button type="button" class="btn pri" data-n>+ Nueva tarifa</button></div>
      <p class="muted small" style="margin:0">Cada cliente puede tener una tarifa. Su descuento se aplica solo al facturar (si el cliente no tiene descuento fijo propio) y su precio por hora se propone al apuntar horas.</p>
      <div class="tablewrap"><table><thead><tr><th>Tarifa</th><th class="right">Descuento</th><th class="right">Precio hora</th><th>Estado</th><th>Conectado</th><th></th></tr></thead><tbody>
      ${Tt.map((t) => `<tr><td><b>${esc(t.nombre)}</b>${t.notas ? `<div class="small muted">${esc(t.notas)}</div>` : ''}</td><td class="right num">${Number(t.descuento_pct)} %</td><td class="right num">${t.precio_hora != null ? money(t.precio_hora) : 'Del mecánico'}</td><td>${t.activa ? '<span class="chip ok">Activa</span>' : '<span class="chip">Inactiva</span>'}</td><td class="right"><button type="button" class="btn sm" data-e="${t.id}">Editar</button></td></tr>`).join('')}
      </tbody></table></div></section>`;
    const editar = (t = {}) => modal(t.id ? 'Editar tarifa' : 'Nueva tarifa', `<div class="form">${field('Nombre', 'nombre', t.nombre, 'text', 'maxlength="60"')}${field('Descuento (%)', 'descuento_pct', t.descuento_pct ?? 0, 'number', 'min="0" max="100" step="0.5"')}${field('Precio por hora (€, opcional)', 'precio_hora', t.precio_hora, 'number', 'min="0" step="0.5"')}${area('Notas', 'notas', t.notas, 'maxlength="300"')}<label class="check full"><input type="checkbox" name="activa" ${t.activa ?? true ? 'checked' : ''}> Activa</label></div>`, {
      onOk: async (root) => {
        const o = formData(root); const d = Number(o.descuento_pct) || 0;
        if (!o.nombre) throw new Error('Falta el nombre'); if (d < 0 || d > 100) throw new Error('Descuento no válido');
        const row = { nombre: o.nombre, descuento_pct: d, precio_hora: o.precio_hora === null ? null : Number(o.precio_hora), notas: o.notas, activa: o.activa };
        if (t.id) ok(await sb.from('tarifas').update(row).eq('id', t.id)); else ok(await sb.from('tarifas').insert(row));
        toast('Tarifa guardada'); recargar();
      },
    });
    T.querySelector('[data-n]').addEventListener('click', () => editar());
    T.querySelectorAll('[data-e]').forEach((b) => b.addEventListener('click', () => editar(Tt.find((x) => x.id == b.dataset.e))));
  }

  if (tab === 'campos') {
    const K = ok(await sb.from('campos_personalizados').select('*').order('entidad').order('orden'));
    const tipoT = { texto: 'Texto', numero: 'Número', fecha: 'Fecha', si_no: 'Sí / No' };
    T.innerHTML = `<section class="card" style="max-width:760px"><div class="head"><h2>Campos personalizados</h2><button type="button" class="btn pri" data-n>+ Nuevo campo</button></div>
      <p class="muted small" style="margin:0">Añade los datos que necesites en las fichas de clientes y de vehículos, sin tocar el programa.</p>
      ${['cliente', 'vehiculo'].map((en) => `<h3>${en === 'cliente' ? 'Ficha de cliente / proveedor' : 'Ficha de vehículo'}</h3><div class="list">${K.filter((k) => k.entidad === en).map((k) => `<div><span class="grow"><b>${esc(k.nombre)}</b><span class="small muted">${tipoT[k.tipo]}</span></span><button type="button" class="btn sm danger" data-d="${k.id}">Quitar</button></div>`).join('') || '<div class="empty">Sin campos</div>'}</div>`).join('')}
    </section>`;
    T.querySelector('[data-n]').addEventListener('click', () => modal('Nuevo campo', `<div class="form"><div class="field"><label for="ce">Ficha</label><select id="ce" name="entidad">${opt('cliente', 'Cliente / proveedor', 'cliente')}${opt('vehiculo', 'Vehículo', '')}</select></div>${field('Nombre del campo', 'nombre', '', 'text', 'maxlength="60"')}<div class="field"><label for="ct">Tipo</label><select id="ct" name="tipo">${Object.entries(tipoT).map(([k, t]) => opt(k, t, 'texto')).join('')}</select></div></div>`, {
      onOk: async (root) => { const o = formData(root); if (!o.nombre) throw new Error('Falta el nombre'); ok(await sb.from('campos_personalizados').insert({ entidad: o.entidad, nombre: o.nombre, tipo: o.tipo, orden: K.length + 1 })); toast('Campo creado'); recargar(); },
    }));
    T.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', async () => {
      try { ok(await sb.from('campos_personalizados').delete().eq('id', b.dataset.d)); toast('Campo quitado (los datos ya guardados se conservan)'); recargar(); } catch (e) { fail(e); }
    }));
  }

  if (tab === 'importar') { importar.render(T); return; }

  if (tab === 'equipos') {
    const E = ok(await sb.from('equipos').select('*').eq('activo', true).order('alta'));
    const est = Object.fromEntries((await estadoSync(true)).map((x) => [x.id, x]));
    const aqui = equipoLocal();
    const esteRegistrado = E.some((x) => x.id === aqui);
    const estado = (x) => {
      if (x.id === aqui) return '<span class="chip info">Este ordenador</span>';
      if (est[x.id]?.aviso) return '<span class="chip warn">Sin señal: los demás ven el aviso</span>';
      if (x.cerrado) return '<span class="chip">Cerrado</span>';
      return '<span class="chip ok">Conectado</span>';
    };
    T.innerHTML = `<section class="card" style="max-width:900px"><h2>Equipo del taller</h2>
      <p style="margin:0">Marca aquí el ordenador del taller. Mientras tenga el programa abierto, avisa a la nube cada minuto de que está conectado.
      Si deja de avisar (por ejemplo, porque se ha ido internet en el taller), quien agenda desde el móvil o desde fuera ve un aviso amarillo:
      puede haber citas hechas en el taller que aún no han subido. Si todo va bien, no se ve ningún aviso.</p>
      <p class="muted small" style="margin:0">Si el programa se cierra de forma normal (cerrar sesión o cerrar la ventana), no sale el aviso. Si el ordenador se apaga de golpe, sí: puedes quitarlo aquí.</p>
      ${E.length ? `<div class="tablewrap"><table><thead><tr><th>Equipo</th><th>Estado</th><th>Última señal</th><th>Usuario</th><th></th></tr></thead><tbody>${E.map((x) => `<tr>
        <td><b>${esc(x.nombre)}</b><div class="muted small">dado de alta el ${esc(fdate(x.alta))}</div></td>
        <td>${estado(x)}</td><td>${x.ultimo_latido ? esc(fdt(x.ultimo_latido)) : '<span class="muted small">Nunca</span>'}</td>
        <td>${esc(x.ultimo_usuario ? (state.perfiles.find((p) => p.id === x.ultimo_usuario)?.nombre || '') : '')}</td>
        <td class="right" style="white-space:nowrap">${est[x.id]?.aviso ? `<button type="button" class="btn sm" data-quitar="${attr(x.id)}">Quitar aviso</button> ` : ''}<button type="button" class="btn sm danger" data-retirar="${attr(x.id)}">Retirar</button></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted" style="margin:0">Todavía no hay ningún equipo del taller.</p>'}
      ${esteRegistrado ? '<p style="margin:0"><b>Este ordenador es el equipo del taller.</b></p>'
        : '<button type="button" class="btn pri" data-alta style="align-self:flex-start">Usar este ordenador como equipo del taller</button>'}
      <h3>Cuándo avisar</h3>
      <div class="form"><div class="field"><label for="sync-min">Avisar tras estos minutos sin señal</label><input id="sync-min" type="number" min="1" max="120" step="1" value="${attr(cfg.sync_aviso_min ?? 3)}"></div></div>
      <button type="button" class="btn" data-min style="align-self:flex-start">Guardar</button></section>`;
    T.querySelector('[data-alta]')?.addEventListener('click', () => {
      modal('Equipo del taller', `<div class="form">${field('Nombre del equipo', 'nombre', 'Ordenador del taller', 'text', 'maxlength="60" required')}</div>
        <p class="muted small" style="margin:0">Hazlo en el ordenador que se queda en el taller. Se guarda en este navegador: si usas otro navegador en el mismo ordenador, hay que volver a darlo de alta.</p>`, {
        okText: 'Dar de alta',
        onOk: async (root) => {
          const nombre = formData(root).nombre;
          if (!nombre) throw new Error('Pon un nombre');
          const x = ok(await sb.from('equipos').insert({ nombre, cerrado: false, ultimo_latido: new Date().toISOString() }).select('id').single());
          marcarEquipoLocal(x.id); iniciarLatido();
          toast('Este ordenador ya es el equipo del taller'); recargar();
        },
      });
    });
    T.querySelectorAll('[data-quitar]').forEach((b) => b.addEventListener('click', async () => {
      try { ok(await sb.from('equipos').update({ cerrado: true }).eq('id', b.dataset.quitar)); toast('Aviso quitado'); recargar(); } catch (e) { fail(e); }
    }));
    T.querySelectorAll('[data-retirar]').forEach((b) => b.addEventListener('click', () => {
      const x = E.find((y) => y.id === b.dataset.retirar);
      modal('Retirar equipo', `<p style="margin:0">¿Retirar <b>${esc(x.nombre)}</b>? Deja de ser el equipo del taller y no volverá a salir el aviso por él.</p>`, {
        okText: 'Retirar',
        onOk: async () => {
          if (x.id === aqui) { await avisarCierre(); pararLatido(); marcarEquipoLocal(null); }
          ok(await sb.from('equipos').update({ activo: false, cerrado: true }).eq('id', x.id));
          toast('Equipo retirado'); recargar();
        },
      });
    }));
    T.querySelector('[data-min]').addEventListener('click', async () => {
      const n = Math.round(Number(T.querySelector('#sync-min').value));
      if (!(n >= 1 && n <= 120)) return toast('Pon entre 1 y 120 minutos', true);
      try { ok(await sb.from('config').update({ sync_aviso_min: n }).eq('id', 1)); toast('Guardado'); recargar(); } catch (e) { fail(e); }
    });
    return;
  }

  if (tab === 'licencia') {
    const l = state.licencia || {};
    const e = licEstado();
    const chipE = { libre: ['Sin activar', 'info'], activa: ['Activa', 'ok'], gracia: ['Terminada, en días de gracia', 'warn'], consulta: ['Modo consulta', 'bad'] }[e];
    const activos = state.perfiles.filter((p) => p.activo).length;
    const fila = (t, v) => `<div><span class="muted small">${esc(t)}</span><div><b>${v}</b></div></div>`;
    T.innerHTML = `<section class="card" style="max-width:860px">
      <h2 style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">Licencia <span class="chip ${chipE[1]}">${esc(chipE[0])}</span></h2>
      ${e === 'libre' ? `<p style="margin:0">Todavía no hay ninguna licencia activada, así que el programa funciona <b>sin límites</b>. Cuando tu proveedor te dé el código de licencia, pégalo abajo.</p>` : `
      <div class="form" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">
        ${fila('Plan', esc(licPlan(l)))}
        ${fila('Cliente', esc(l.cliente || '—'))}
        ${fila('Tipo', l.tipo === 'prueba' ? 'Prueba gratis' : 'Pagada')}
        ${fila('Válida hasta', esc(fdate(l.termina)))}
        ${fila('Usuarios activos', `${activos} de ${l.max_usuarios == null ? 'sin límite' : esc(l.max_usuarios)}`)}
        ${fila('Última comprobación', esc(fdt(l.ultima_ok) || 'Nunca'))}
      </div>
      ${l.ultimo_error ? `<div class="aviso"><b>Última comprobación fallida</b>${esc(l.ultimo_error)}</div>` : ''}
      <h3>Qué incluye</h3>
      <ul class="lic-mods">${Object.entries(MODULOS_CRM).map(([k, t]) => { const si = (l.modulos || []).includes(k); return `<li class="${si ? '' : 'no'}"><span class="chip ${si ? 'ok' : ''}">${si ? 'Sí' : 'No'}</span>${esc(t)}</li>`; }).join('')}</ul>
      <p class="muted small" style="margin:0">El programa pregunta cada día a tu proveedor cómo está la licencia. Si termina o se bloquea, pasa a modo consulta: se pueden ver los datos, pero no crear ni cambiar nada.</p>
      <button type="button" class="btn" data-comprobar style="align-self:flex-start">Comprobar ahora</button>`}
      <h3>${e === 'libre' ? 'Activar la licencia' : 'Cambiar de licencia'}</h3>
      <div class="form"><div class="field"><label for="lic-cod">Código de licencia</label><input id="lic-cod" placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="30"></div></div>
      <p class="muted small" style="margin:0">El código sirve una sola vez. Al activarlo se aplican el plan, los módulos y el número de usuarios de la licencia.</p>
      <button type="button" class="btn pri" data-activar style="align-self:flex-start">Activar</button></section>`;
    T.querySelector('[data-comprobar]')?.addEventListener('click', async (ev) => {
      ev.currentTarget.disabled = true;
      try { await refrescarLicencia(true); toast('Licencia comprobada'); } catch (err) { toast(err.message, true); }
      route2();
    });
    T.querySelector('[data-activar]').addEventListener('click', async (ev) => {
      const cod = T.querySelector('#lic-cod').value.trim();
      if (cod.replace(/[^A-Za-z0-9]/g, '').length < 12) return toast('Escribe el código completo', true);
      const b = ev.currentTarget; b.disabled = true; b.textContent = 'Activando…';
      try { await activarLicencia(cod); toast('Licencia activada'); route2(); } catch (err) { toast(err.message, true); b.disabled = false; b.textContent = 'Activar'; }
    });
    return;
  }

  if (tab === 'roles') {
    const R = ok(await sb.from('roles').select('*').order('nombre'));
    const P = ok(await sb.from('perfiles').select('id, rol'));
    const usan = (c) => P.filter((p) => p.rol === c).length;
    const vent = (r) => (r.nivel === 'admin' ? '<span class="chip ok">Todas</span>' : VENTANAS.filter(([k]) => r.ventanas.includes(k)).map(([, t]) => `<span class="chip">${esc(t)}</span>`).join(' ') || '<span class="muted small">Solo el panel</span>');
    T.innerHTML = `<section class="card"><div class="head" style="margin:0"><div class="t"><h2 style="margin:0">Roles y ventanas</h2></div><div class="actions"><button type="button" class="btn pri" data-nuevo>Nuevo rol</button></div></div>
      <p class="muted small" style="margin:0">Cada rol decide qué ventanas del menú ve su gente. El panel y "Mi perfil" los ven todos. El Administrador lo ve todo siempre y no se puede cambiar, para que nadie se quede fuera. La base de datos también lo comprueba: sin la ventana Facturación no se pueden leer ni hacer facturas aunque se intente por otro camino.</p>
      <div class="tablewrap"><table><thead><tr><th>Rol</th><th>Ventanas</th><th>Permisos</th><th>Cambia precios</th><th>En la agenda</th><th class="right">Usuarios</th><th></th></tr></thead>
      <tbody>${R.map((r) => `<tr><td><b>${esc(r.nombre)}</b>${r.sistema ? ' <span class="muted small">de serie</span>' : ''}</td><td>${vent(r)}</td><td class="small">${esc(NIVELES[r.nivel] || r.nivel)}</td><td>${r.nivel === 'admin' || r.cambia_precios ? '<span class="chip ok">Sí</span>' : 'No'}</td><td>${r.tecnico ? 'Sí' : 'No'}</td><td class="right num">${usan(r.clave)}</td>
        <td class="right" style="white-space:nowrap">${r.nivel === 'admin' ? '' : `<button type="button" class="btn sm" data-e="${attr(r.clave)}">Editar</button>`}${r.sistema || usan(r.clave) ? '' : ` <button type="button" class="btn sm" data-b="${attr(r.clave)}">Borrar</button>`}</td></tr>`).join('')}</tbody></table></div></section>`;
    const editar = (r) => {
      const nuevo = !r; r = r || { nombre: '', nivel: 'taller', ventanas: ['agenda', 'rep'], tecnico: true, cambia_precios: false };
      const m = modal(nuevo ? 'Nuevo rol' : `Rol ${r.nombre}`, `<div class="form">${field('Nombre del rol', 'nombre', r.nombre, 'text', 'maxlength="40" required')}
        <div class="field"><label for="f-nivel">Permisos</label><select id="f-nivel" name="nivel">${['oficina', 'taller'].map((k) => opt(k, NIVELES[k], r.nivel)).join('')}</select></div>
        <fieldset class="full" style="border:1px solid var(--line, #e5e7eb);border-radius:10px;padding:10px 12px;margin:0"><legend class="small" style="padding:0 6px">Ventanas que ve</legend>
          <div style="display:flex;flex-wrap:wrap;gap:6px 18px">${VENTANAS.map(([k, t]) => `<label class="check"><input type="checkbox" name="v_${k}" ${r.ventanas.includes(k) ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</div>
          <p class="muted small" data-avisofact style="margin:6px 0 0">Facturación solo se puede dar con permisos de Oficina, y solo se ve en ordenador.</p></fieldset>
        <label class="check full"><input type="checkbox" name="cambia_precios" ${r.cambia_precios ? 'checked' : ''}> Puede cambiar el precio y el descuento de las líneas en las órdenes (piezas, artículos y horas)</label>
        <label class="check full"><input type="checkbox" name="tecnico" ${r.tecnico ? 'checked' : ''}> Sale en la lista de mecánicos para asignar citas y horas</label></div>`, {
        onOk: async (root) => {
          const o = formData(root);
          if (!o.nombre || o.nombre.length < 2) throw new Error('Escribe el nombre del rol');
          const fila = { nombre: o.nombre, nivel: o.nivel === 'oficina' ? 'oficina' : 'taller', ventanas: VENTANAS.map(([k]) => k).filter((k) => o['v_' + k]), tecnico: !!o.tecnico, cambia_precios: !!o.cambia_precios };
          if (nuevo) {
            const base = o.nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'rol';
            let clave = base.length < 2 ? 'rol_' + base : base; let n = 2;
            while (R.some((x) => x.clave === clave)) clave = `${base.slice(0, 24)}_${n++}`;
            ok(await sb.from('roles').insert({ clave, ...fila }));
          } else ok(await sb.from('roles').update(fila).eq('clave', r.clave));
          toast('Rol guardado'); recargar();
        },
      });
      const niv = m.querySelector('[name=nivel]'); const fac = m.querySelector('[name=v_fact]');
      const sync = () => { const t = niv.value === 'taller'; fac.disabled = t; if (t) fac.checked = false; };
      niv.addEventListener('change', sync); sync();
    };
    T.querySelector('[data-nuevo]').addEventListener('click', () => editar(null));
    T.querySelectorAll('[data-e]').forEach((b) => b.addEventListener('click', () => editar(R.find((x) => x.clave === b.dataset.e))));
    T.querySelectorAll('[data-b]').forEach((b) => b.addEventListener('click', async () => {
      const r = R.find((x) => x.clave === b.dataset.b);
      if (!(await confirmar(`¿Borrar el rol ${r.nombre}?`, 'Borrar'))) return;
      try { ok(await sb.from('roles').delete().eq('clave', r.clave)); toast('Rol borrado'); recargar(); } catch (e) { fail(e); }
    }));
    return;
  }

  if (tab === 'usuarios') {
    const P = ok(await sb.from('perfiles').select('*').order('nombre'));
    const correos = Object.fromEntries(ok(await sb.from('usuarios_correo').select('user_id, correo')).map((c) => [c.user_id, c.correo]));
    const ses = Object.fromEntries(ok(await sb.rpc('sesiones_abiertas')).map((x) => [x.user_id, x]));
    const conectado = (p) => {
      const x = ses[p.id];
      if (!x || !x.activa) return '<span class="muted small">No</span>';
      return `<span class="chip ok">${esc(x.dispositivo || 'Conectado')}</span><div class="muted small">desde ${esc(fdt(x.desde))}</div>`
        + (p.id === state.perfil.id ? '' : `<button type="button" class="btn sm" data-cerrar="${attr(p.id)}" style="margin-top:4px">Cerrar sesión</button>`);
    };
    const dispTxt = (p) => {
      const si = DISPOSITIVOS.filter(([k]) => p[k] !== false);
      if (si.length === DISPOSITIVOS.length) return '<span class="muted small">Todos</span>';
      if (!si.length) return '<span class="chip bad">Ninguno</span>';
      return si.map(([, t]) => `<span class="chip">${esc(t)}</span>`).join(' ');
    };
    T.innerHTML = `<section class="card"><h2>Usuarios del taller</h2>
      <p class="muted small" style="margin:0">Cada usuario solo puede estar abierto en un dispositivo a la vez. Si un equipo se queda con la sesión abierta, puedes cerrarla aquí (o se libera sola tras 10 minutos sin uso).</p>
      <p class="muted small" style="margin:0">Cada persona entra con su usuario y contraseña. Lo que ve cada uno lo decide su rol (pestaña <a href="#/config?t=roles">Roles y ventanas</a>). En "Dispositivos" eliges desde qué equipos puede entrar: si le quitas uno mientras está conectado desde él, se queda fuera al momento.</p>
      <div class="tablewrap"><table><thead><tr><th>Nombre</th><th>Usuario</th><th>Correo</th><th>Rol</th><th>Dispositivos</th><th class="right">€/hora</th><th>Color</th><th>Estado</th><th>Conectado</th><th></th></tr></thead>
      <tbody>${P.map((p) => `<tr><td><b>${esc(p.nombre)}</b></td><td>${esc(p.usuario)}</td><td>${correos[p.id] ? esc(correos[p.id]) : '<span class="muted small">Sin correo</span>'}</td><td>${esc(nombreRol(p.rol))}</td><td>${dispTxt(p)}</td><td class="right num">${money(p.precio_hora)}</td><td><span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:${attr(hex(p.color, '#1F3A6E'))}"></span></td><td>${p.activo ? '<span class="chip ok">Activo</span>' : '<span class="chip bad">Sin acceso</span>'}</td><td>${conectado(p)}</td><td class="right"><button type="button" class="btn sm" data-e="${p.id}">Editar</button></td></tr>`).join('')}</tbody></table></div></section>`;
    T.querySelectorAll('[data-cerrar]').forEach((b) => b.addEventListener('click', () => {
      const p = P.find((x) => x.id === b.dataset.cerrar);
      modal('Cerrar sesión', `<p style="margin:0">¿Cerrar la sesión de <b>${esc(p.nombre)}</b> en <b>${esc(ses[p.id]?.dispositivo || 'su dispositivo')}</b>? Si está trabajando en ese momento, perderá lo que no haya guardado.</p>`, {
        okText: 'Cerrar su sesión',
        onOk: async () => { ok(await sb.rpc('cerrar_sesion_de', { p_user: p.id })); toast('Sesión cerrada'); recargar(); },
      });
    }));
    T.querySelectorAll('[data-e]').forEach((b) => b.addEventListener('click', () => {
      const p = P.find((x) => x.id === b.dataset.e); const yo = p.id === state.perfil.id;
      modal(`Editar ${p.nombre}`, `<div class="form">${field('Nombre', 'nombre', p.nombre, 'text', 'maxlength="80"')}
        <div class="field"><label for="f-rol">Rol</label><select id="f-rol" name="rol" ${yo ? 'disabled' : ''}>${state.roles.map((r) => opt(r.clave, r.nombre, p.rol)).join('')}</select></div>
        ${field('Correo (para recuperar la contraseña)', 'correo', correos[p.id] || '', 'email', 'maxlength="120" autocomplete="off"')}
        ${field('Precio por hora (€)', 'precio_hora', p.precio_hora, 'number', 'min="0" step="0.5"')}
        <div class="field"><label for="f-color">Color en la agenda</label><input id="f-color" type="color" name="color" value="${attr(hex(p.color, '#1F3A6E'))}" style="padding:4px"></div>
        <label class="check full"><input type="checkbox" name="activo" ${p.activo ? 'checked' : ''} ${yo ? 'disabled' : ''}> Puede entrar en la aplicación</label>
        <fieldset class="full" style="border:1px solid var(--line, #e5e7eb);border-radius:10px;padding:10px 12px;margin:0"><legend class="small" style="padding:0 6px">Puede entrar desde</legend>
          <div style="display:flex;flex-wrap:wrap;gap:6px 18px">${DISPOSITIVOS.map(([k, t]) => `<label class="check"><input type="checkbox" name="${k}" ${p[k] !== false ? 'checked' : ''} ${yo ? 'disabled' : ''}> ${esc(t)}</label>`).join('')}</div>
          ${yo ? '<p class="muted small" style="margin:6px 0 0">Tu propio rol, acceso y dispositivos los cambia otro administrador (así nadie se queda fuera por error).</p>' : ''}
        </fieldset></div>`, {
        onOk: async (root) => {
          const o = formData(root);
          const upd = { nombre: o.nombre || p.nombre, precio_hora: Number(o.precio_hora) || 0, color: hex(o.color, '#1F3A6E') };
          if (!yo) {
            upd.rol = o.rol; upd.activo = o.activo;
            DISPOSITIVOS.forEach(([k]) => { upd[k] = !!o[k]; });
            if (upd.activo && !DISPOSITIVOS.some(([k]) => upd[k])) throw new Error('Marca al menos un dispositivo, o quita "Puede entrar en la aplicación"');
          }
          ok(await sb.from('perfiles').update(upd).eq('id', p.id));
          if ((o.correo || '') !== (correos[p.id] || '')) await guardarCorreo(p.id, o.correo);
          toast('Usuario guardado'); recargar();
        },
      });
    }));
  }
}

// Correo real de la persona (para "He olvidado mi contraseña"). Vacío = se quita.
async function guardarCorreo(id, correo) {
  const c = (correo || '').trim().toLowerCase();
  if (!c) { if (esAdmin()) ok(await sb.from('usuarios_correo').delete().eq('user_id', id)); return; }
  if (c.length > 120 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c)) throw new Error('El correo no es válido');
  ok(await sb.from('usuarios_correo').upsert({ user_id: id, correo: c }));
}

// Vuelve a pintar la pantalla entera (menú y avisos cambian con la licencia)
function route2() { window.dispatchEvent(new HashChangeEvent('hashchange')); }
