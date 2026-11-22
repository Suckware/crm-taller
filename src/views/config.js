import { sb, state, esc, attr, ok, modal, toast, fail, formData, field, area, opt, esAdmin, aplicarTema, cargarComunes, hex, money } from '../lib.js';
import { CONDICIONES_DEF } from './recepcion.js';

const TEMAS = [
  ['Sergio Moto Sport', '#1F3A6E', '#111827'], ['Azul marino', '#1E3A8A', '#0B1B36'], ['Pizarra', '#334155', '#1E293B'],
  ['Verde inglés', '#1F5140', '#10241D'], ['Burdeos', '#7A1F2B', '#1F1316'], ['Grafito', '#3F3F46', '#18181B'],
];

export async function render(el, params) {
  const adm = esAdmin();
  const tab = params.t || (adm ? 'taller' : 'perfil');
  const tabs = adm ? [['taller', 'Datos del taller'], ['apariencia', 'Logo y colores'], ['impuestos', 'Impuestos'], ['usuarios', 'Usuarios y permisos'], ['perfil', 'Mi perfil']] : [['perfil', 'Mi perfil']];
  el.innerHTML = `<div class="head"><div class="t"><h1>Configuración</h1><div class="muted">${adm ? 'Solo el administrador puede cambiar estos ajustes' : 'Los ajustes del taller los gestiona el administrador'}</div></div></div>
  <nav class="tabs">${tabs.map(([k, t]) => `<a href="#/config?t=${k}" class="${k === tab ? 'on' : ''}">${t}</a>`).join('')}</nav><div data-tab></div>`;
  const T = el.querySelector('[data-tab]');
  const cfg = state.config;
  const recargar = async () => { await cargarComunes(); render(el, params); };

  if (tab === 'perfil') {
    const p = state.perfil;
    T.innerHTML = `<section class="card" style="max-width:640px"><h2>${esc(p.nombre)}</h2>
      <p style="margin:0">Usuario: <b>${esc(p.usuario)}</b> · Rol: <b>${esc({ admin: 'Administrador', recepcion: 'Recepción', mecanico: 'Mecánico' }[p.rol])}</b></p>
      <h3>Cambiar mi contraseña</h3>
      <div class="form"><div class="field"><label for="pw1">Nueva contraseña</label><input id="pw1" type="password" autocomplete="new-password" minlength="10" maxlength="128"></div>
      <div class="field"><label for="pw2">Repetir</label><input id="pw2" type="password" autocomplete="new-password" maxlength="128"></div></div>
      <p class="muted small" style="margin:0">Mínimo 10 caracteres, con mayúsculas, minúsculas y números.</p>
      <button type="button" class="btn pri" data-pw style="align-self:flex-start">Cambiar contraseña</button></section>`;
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
      ${area('Condiciones de la hoja de autorización', 'condiciones_autorizacion', cfg.condiciones_autorizacion || CONDICIONES_DEF, 'maxlength="4000" style="min-height:180px"')}
      ${area('Pie de factura', 'pie_factura', cfg.pie_factura, 'maxlength="600"')}
    </div><button type="button" class="btn pri" data-g style="align-self:flex-start">Guardar</button></section>`;
    T.querySelector('[data-g]').addEventListener('click', async () => {
      try {
        const o = formData(T.querySelector('[data-f]'));
        if (!o.nombre_taller) throw new Error('Falta el nombre');
        if (o.serie_factura && !/^[A-Za-z0-9-]{1,12}$/.test(o.serie_factura)) throw new Error('La serie solo admite letras, números y guiones');
        o.precio_hora = Number(o.precio_hora) || 0; o.siguiente_factura = Math.max(1, Math.floor(Number(o.siguiente_factura) || 1));
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

  if (tab === 'usuarios') {
    const P = ok(await sb.from('perfiles').select('*').order('nombre'));
    const rolT = { admin: 'Administrador', recepcion: 'Recepción', mecanico: 'Mecánico' };
    T.innerHTML = `<section class="card"><h2>Usuarios del taller</h2>
      <p class="muted small" style="margin:0">Cada persona entra con su usuario y contraseña. Administrador: todo. Recepción: agenda, clientes, almacén y facturación. Mecánico: agenda, reparaciones, horas y consulta de almacén (no ve facturación).</p>
      <div class="tablewrap"><table><thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th class="right">€/hora</th><th>Color</th><th>Estado</th><th></th></tr></thead>
      <tbody>${P.map((p) => `<tr><td><b>${esc(p.nombre)}</b></td><td>${esc(p.usuario)}</td><td>${esc(rolT[p.rol])}</td><td class="right num">${money(p.precio_hora)}</td><td><span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:${attr(hex(p.color, '#1F3A6E'))}"></span></td><td>${p.activo ? '<span class="chip ok">Activo</span>' : '<span class="chip bad">Sin acceso</span>'}</td><td class="right"><button type="button" class="btn sm" data-e="${p.id}">Editar</button></td></tr>`).join('')}</tbody></table></div></section>`;
    T.querySelectorAll('[data-e]').forEach((b) => b.addEventListener('click', () => {
      const p = P.find((x) => x.id === b.dataset.e); const yo = p.id === state.perfil.id;
      modal(`Editar ${p.nombre}`, `<div class="form">${field('Nombre', 'nombre', p.nombre, 'text', 'maxlength="80"')}
        <div class="field"><label for="f-rol">Rol</label><select id="f-rol" name="rol" ${yo ? 'disabled' : ''}>${Object.entries(rolT).map(([k, t]) => opt(k, t, p.rol)).join('')}</select></div>
        ${field('Precio por hora (€)', 'precio_hora', p.precio_hora, 'number', 'min="0" step="0.5"')}
        <div class="field"><label for="f-color">Color en la agenda</label><input id="f-color" type="color" name="color" value="${attr(hex(p.color, '#1F3A6E'))}" style="padding:4px"></div>
        <label class="check full"><input type="checkbox" name="activo" ${p.activo ? 'checked' : ''} ${yo ? 'disabled' : ''}> Puede entrar en la aplicación</label></div>`, {
        onOk: async (root) => {
          const o = formData(root);
          const upd = { nombre: o.nombre || p.nombre, precio_hora: Number(o.precio_hora) || 0, color: hex(o.color, '#1F3A6E') };
          if (!yo) { upd.rol = o.rol; upd.activo = o.activo; }
          ok(await sb.from('perfiles').update(upd).eq('id', p.id)); toast('Usuario guardado'); recargar();
        },
      });
    }));
  }
}
