// Lectura de archivos exportados por otros programas de gestión: CSV / TXT y Excel (.xlsx).
// Todo se lee en el navegador: el archivo no sale del ordenador hasta que se confirma la importación.
import { unzipSync, strFromU8 } from 'fflate';

export const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_FILAS = 50000;

export async function leerArchivo(file) {
  if (file.size > MAX_BYTES) throw new Error('El archivo es demasiado grande (máximo 15 MB). Divídelo en varios.');
  const buf = new Uint8Array(await file.arrayBuffer());
  const nombre = (file.name || '').toLowerCase();
  let filas;
  if (nombre.endsWith('.xlsx') || (buf[0] === 0x50 && buf[1] === 0x4b)) filas = leerXlsx(buf);
  else if (nombre.endsWith('.xls') || (buf[0] === 0xd0 && buf[1] === 0xcf)) throw new Error('Los .xls antiguos no se pueden leer. Ábrelo en Excel y guárdalo como "Libro de Excel (.xlsx)" o como CSV.');
  else if (/\.(mdb|accdb|sql|bak|dbf)$/.test(nombre)) throw new Error('Esto es una copia de la base de datos. Expórtalo a Excel o CSV desde el programa antiguo, o pásanoslo y lo convertimos.');
  else filas = leerCsv(decodificar(buf));
  return tabla(filas);
}

// Convierte filas crudas en { columnas, filas: [{col: valor}] }, buscando la fila de cabecera
function tabla(filas) {
  filas = filas.map((f) => f.map((v) => (v == null ? '' : typeof v === 'number' ? v : String(v).trim())));
  // Algunos programas ponen títulos o líneas vacías antes de la cabecera: se toma la primera fila con 2+ celdas
  let h = filas.findIndex((f) => f.filter((v) => v !== '').length >= 2);
  if (h < 0) throw new Error('No se han encontrado columnas en el archivo.');
  const cab = filas[h].map(String);
  const vistos = {};
  const columnas = cab.map((c, i) => {
    let n = c || `Columna ${i + 1}`;
    if (vistos[n]) n = `${n} (${++vistos[n]})`; else vistos[n] = 1;
    return n;
  });
  const datos = [];
  for (const f of filas.slice(h + 1)) {
    if (!f.some((v) => v !== '')) continue;
    const o = {};
    columnas.forEach((c, i) => { o[c] = f[i] ?? ''; });
    datos.push(o);
    if (datos.length > MAX_FILAS) throw new Error(`El archivo tiene más de ${MAX_FILAS} filas. Divídelo en varios.`);
  }
  if (!datos.length) throw new Error('El archivo no tiene filas con datos debajo de la cabecera.');
  return { columnas, filas: datos };
}

// Muchos programas antiguos exportan en Windows-1252 (ANSI) y no en UTF-8
function decodificar(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return new TextDecoder('utf-8').decode(buf.subarray(3));
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); }
}

export function leerCsv(txt) {
  const primera = txt.split(/\r?\n/).find((l) => l.trim()) || '';
  const cuenta = (ch) => primera.split(ch).length - 1;
  const sep = [';', '\t', ',', '|'].sort((a, b) => cuenta(b) - cuenta(a))[0];
  const filas = []; let fila = []; let celda = ''; let q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) {
      if (c === '"') { if (txt[i + 1] === '"') { celda += '"'; i++; } else q = false; } else celda += c;
    } else if (c === '"' && celda === '') q = true;
    else if (c === sep) { fila.push(celda); celda = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && txt[i + 1] === '\n') i++;
      fila.push(celda); filas.push(fila); fila = []; celda = '';
    } else celda += c;
  }
  if (celda !== '' || fila.length) { fila.push(celda); filas.push(fila); }
  return filas;
}

// Lector mínimo de .xlsx: primera hoja, valores (no fórmulas). Sin librerías de terceros con historial de fallos.
function leerXlsx(buf) {
  let zip;
  try { zip = unzipSync(buf, { filter: (f) => /^xl\/(workbook\.xml|sharedStrings\.xml|styles\.xml|worksheets\/sheet\d+\.xml|_rels\/workbook\.xml\.rels)$/.test(f.name) && f.originalSize < 200 * 1024 * 1024 }); } catch { throw new Error('No se ha podido abrir el Excel. Guárdalo de nuevo como .xlsx o CSV.'); }
  const xml = (n) => (zip[n] ? new DOMParser().parseFromString(strFromU8(zip[n]), 'application/xml') : null);
  const tags = (doc, t) => (doc ? Array.from(doc.getElementsByTagNameNS('*', t)) : []);
  // Primera hoja del libro
  let ruta = 'xl/worksheets/sheet1.xml';
  const wb = xml('xl/workbook.xml'); const rels = xml('xl/_rels/workbook.xml.rels');
  const hoja = tags(wb, 'sheet')[0];
  if (hoja && rels) {
    const rid = hoja.getAttribute('r:id') || hoja.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const rel = tags(rels, 'Relationship').find((r) => r.getAttribute('Id') === rid);
    if (rel) ruta = 'xl/' + rel.getAttribute('Target').replace(/^\/?xl\//, '').replace(/^\//, '');
  }
  const sh = xml(ruta);
  if (!sh) throw new Error('El Excel no tiene hojas con datos.');
  const ss = tags(xml('xl/sharedStrings.xml'), 'si').map((si) => tags(si, 't').map((t) => t.textContent).join(''));
  // Formatos de fecha (para convertir el número de serie de Excel en fecha)
  const st = xml('xl/styles.xml');
  const fmtFecha = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
  tags(st, 'numFmt').forEach((n) => { if (/[dmy]/i.test(n.getAttribute('formatCode').replace(/"[^"]*"|\[[^\]]*\]/g, ''))) fmtFecha.add(Number(n.getAttribute('numFmtId'))); });
  const xfs = tags(tags(st, 'cellXfs')[0], 'xf').map((x) => fmtFecha.has(Number(x.getAttribute('numFmtId'))));
  const col = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const filas = [];
  for (const r of tags(sh, 'row')) {
    const f = [];
    for (const c of tags(r, 'c')) {
      const t = c.getAttribute('t'); const v = tags(c, 'v')[0]?.textContent ?? '';
      let val;
      if (t === 's') val = ss[Number(v)] ?? '';
      else if (t === 'inlineStr') val = tags(c, 't').map((x) => x.textContent).join('');
      else if (t === 'b') val = v === '1' ? 'Sí' : 'No';
      else if (t === 'str' || t === 'e') val = v;
      else if (v !== '' && xfs[Number(c.getAttribute('s') || 0)]) val = serialAFecha(Number(v));
      else val = v === '' ? '' : Number(v); // número: se guarda como número para no confundir 1.234 (decimal) con 1.234 (miles)
      const i = c.getAttribute('r') ? col(c.getAttribute('r')) : f.length;
      f[i] = val;
    }
    if (filas.length > MAX_FILAS + 20) throw new Error(`El archivo tiene más de ${MAX_FILAS} filas. Divídelo en varios.`);
    filas.push(Array.from(f, (x) => x ?? ''));
  }
  return filas;
}
function serialAFecha(n) {
  if (!isFinite(n)) return '';
  const d = new Date(Math.round((n - 25569) * 86400000));
  return d.toISOString().slice(0, 10);
}

// ---------- Conversión de valores en formato español ----------
export function aNumero(v) {
  if (v == null) return null;
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  let s = String(v).trim().replace(/[€%\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!s) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); // 1.234,56
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, ''); // 1,234.56
  else s = s.replace(',', '.');
  const n = Number(s);
  return isFinite(n) ? n : NaN;
}
export function aFecha(v) {
  if (v == null) return null;
  const s = String(v).trim(); if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valida(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) { let y = +m[3]; if (y < 100) y += y < 50 ? 2000 : 1900; return valida(y, +m[2], +m[1]); }
  if (/^\d{5}(\.\d+)?$/.test(s)) return serialAFecha(Number(s)); // número de serie de Excel en un CSV
  return NaN;
}
function valida(y, mo, d) {
  const x = new Date(Date.UTC(y, mo - 1, d));
  if (x.getUTCFullYear() !== y || x.getUTCMonth() !== mo - 1 || x.getUTCDate() !== d || y < 1950 || y > 2100) return NaN;
  return x.toISOString().slice(0, 10);
}
export function aSiNo(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/^(s|si|sí|x|1|true|verdadero|yes|y|activo)$/.test(s)) return true;
  if (/^(n|no|0|false|falso|inactivo)$/.test(s)) return false;
  return null;
}
// Para comparar cabeceras: minúsculas, sin acentos ni signos
export const normal = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const nifNormal = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const matNormal = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Genera un CSV (separado por ; y con BOM, para que Excel en español lo abra bien)
export function aCsv(columnas, filas) {
  const q = (v) => { let s = v == null ? '' : String(v); if (/^[=+@\t\r]|^-(?![\d.,]+$)/.test(s)) s = "'" + s; return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [columnas.map(q).join(';'), ...filas.map((f) => f.map(q).join(';'))].join('\r\n');
}
export function descargar(nombre, texto) {
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
