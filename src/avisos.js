// Avisos al cliente por WhatsApp y correo: se abren con el mensaje ya escrito y la persona solo pulsa Enviar.
// No usa servicios externos ni claves: WhatsApp (wa.me) y el programa de correo del dispositivo.
import { state, esc, attr, fdatel, ftime } from './lib.js';

// Teléfono español a formato internacional para WhatsApp (solo dígitos)
export function telWhatsApp(t) {
  let d = String(t || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (/^[6789]\d{8}$/.test(d)) d = '34' + d;
  return /^\d{8,15}$/.test(d) ? d : null;
}

function datosTaller() {
  const c = state.config || {};
  const extra = [c.direccion, c.telefono ? `Tel. ${c.telefono}` : ''].filter(Boolean).join(' · ');
  return { nombre: c.nombre_taller || 'el taller', extra };
}

export function textoCita(tipo, cita, cliente, moto) {
  const t = datosTaller();
  const nombre = (cliente?.nombre || '').split(' ')[0] || '';
  const cuando = `el ${fdatel(cita.inicio).toLowerCase()} a las ${ftime(cita.inicio)}`;
  const vehiculo = moto ? ` para tu ${[moto.marca, moto.modelo].filter(Boolean).join(' ')}${moto.matricula ? ` (${moto.matricula})` : ''}` : '';
  const cab = tipo === 'recordatorio'
    ? `Hola ${nombre}, te recordamos tu cita en ${t.nombre} ${cuando}${vehiculo}.`
    : tipo === 'cambio'
      ? `Hola ${nombre}, hemos cambiado tu cita en ${t.nombre}: ahora es ${cuando}${vehiculo}.`
      : `Hola ${nombre}, tu cita en ${t.nombre} queda confirmada ${cuando}${vehiculo}.`;
  return [cab, cita.servicio ? `Servicio: ${cita.servicio}.` : '', 'Si no puedes venir, avísanos respondiendo a este mensaje.', t.extra, `Un saludo, ${t.nombre}.`].filter(Boolean).join('\n');
}

export function asuntoCita(tipo) {
  const n = datosTaller().nombre;
  return tipo === 'recordatorio' ? `Recordatorio de tu cita en ${n}` : tipo === 'cambio' ? `Cambio en tu cita en ${n}` : `Cita confirmada en ${n}`;
}

// Botones de aviso (HTML). cliente necesita telefono y email.
export function botonesAviso(tipo, cita, cliente, moto) {
  const texto = textoCita(tipo, cita, cliente, moto);
  const wa = telWhatsApp(cliente?.telefono);
  const mailOk = cliente?.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cliente.email);
  const waUrl = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(texto)}` : null;
  const mailUrl = mailOk ? `mailto:${encodeURIComponent(cliente.email)}?subject=${encodeURIComponent(asuntoCita(tipo))}&body=${encodeURIComponent(texto)}` : null;
  return `<div class="avisos">
    <div class="avisos-t">${tipo === 'recordatorio' ? 'Enviar recordatorio al cliente' : 'Avisar al cliente'}</div>
    <div class="actions">
      ${waUrl ? `<a class="btn wa" href="${attr(waUrl)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : '<span class="muted small">Sin móvil válido para WhatsApp</span>'}
      ${mailUrl ? `<a class="btn" href="${attr(mailUrl)}">Correo</a>` : '<span class="muted small">Sin correo en la ficha</span>'}
    </div>
    <details class="small"><summary class="muted">Ver mensaje</summary><pre class="aviso-txt">${esc(texto)}</pre></details>
  </div>`;
}
