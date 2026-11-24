// Remesas de adeudos directos SEPA (sustituye al antiguo Cuaderno 19).
// Genera el fichero XML ISO 20022 pain.008.001.02, el que aceptan todos los bancos españoles
// (guía AEB "Cuaderno 19.14 formato XML"). Sin dependencias: se puede probar con node.

// Comprueba un IBAN (formato y dígitos de control, ISO 13616)
export function ibanValido(iban) {
  const s = String(iban || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  if (s.startsWith('ES') && s.length !== 24) return false;
  return mod97(s.slice(4) + s.slice(0, 4)) === 1;
}
export const bicValido = (bic) => /^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(String(bic || '').toUpperCase());

function mod97(txt) {
  const digits = txt.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let r = 0;
  for (const d of digits) r = (r * 10 + Number(d)) % 97;
  return r;
}

// Identificador de acreedor español (AT-02): ES + control + sufijo (3) + NIF
export function idAcreedor(nif, sufijo = '000') {
  const n = String(nif || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!n) return '';
  return `ES${String(98 - mod97(`${n}ES00`)).padStart(2, '0')}${sufijo || '000'}${n}`;
}

export const ibanOculto = (iban) => { const s = String(iban || ''); return s.length > 8 ? `${s.slice(0, 4)} •••• ${s.slice(-4)}` : s; };

// Juego de caracteres SEPA: letras latinas sin acentos, números y / - ? : ( ) . , ' + espacio
export function textoSepa(v, max) {
  const t = String(v ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[ñÑ]/g, (c) => (c === 'ñ' ? 'n' : 'N')).replace(/[çÇ]/g, (c) => (c === 'ç' ? 'c' : 'C'))
    .replace(/&/g, '+')
    .replace(/[^A-Za-z0-9/\-?:().,'+ ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return max ? t.slice(0, max).trim() : t;
}
// Identificadores (MsgId, EndToEndId…): sin espacios ni barra inicial
const idSepa = (v, max = 35) => textoSepa(v).replace(/\s+/g, '-').replace(/^\/+/, '').slice(0, max) || 'NOTPROVIDED';

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const importe = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2);
const cent = (n) => Math.round(Number(n) * 100);

function agente(bic) {
  return bic ? `<FinInstnId><BIC>${xml(String(bic).toUpperCase())}</BIC></FinInstnId>` : '<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>';
}

// remesa: { numero, creada_en, fecha_cargo, esquema, acreedor_nombre, acreedor_id, acreedor_iban, acreedor_bic }
// recibos: [{ referencia, importe, titular, iban, bic, mandato, fecha_mandato, secuencia, concepto? }]
export function generarPain008(remesa, recibos, ahora = new Date()) {
  const R = recibos.filter((r) => cent(r.importe) > 0);
  if (!R.length) throw new Error('La remesa no tiene recibos');
  for (const r of R) {
    if (!ibanValido(r.iban)) throw new Error(`IBAN no válido en el recibo ${r.referencia}`);
    if (!r.mandato || !r.fecha_mandato) throw new Error(`Falta el mandato en el recibo ${r.referencia}`);
  }
  if (!ibanValido(remesa.acreedor_iban)) throw new Error('El IBAN de cobro del taller no es válido');
  const suma = (a) => (a.reduce((s, r) => s + cent(r.importe), 0) / 100).toFixed(2);
  const p = (n) => String(n).padStart(2, '0');
  const creDtTm = `${ahora.getFullYear()}-${p(ahora.getMonth() + 1)}-${p(ahora.getDate())}T${p(ahora.getHours())}:${p(ahora.getMinutes())}:${p(ahora.getSeconds())}`;
  const msgId = idSepa(`${remesa.numero}-${creDtTm.replace(/\D/g, '')}`);
  const nombre = textoSepa(remesa.acreedor_nombre, 70) || 'ACREEDOR';
  const idAcr = xml(remesa.acreedor_id);

  const lotes = ['FRST', 'RCUR'].map((seq) => [seq, R.filter((r) => (r.secuencia || 'RCUR') === seq)]).filter(([, a]) => a.length);
  const pmtInf = lotes.map(([seq, a]) => `
  <PmtInf>
   <PmtInfId>${xml(idSepa(`${remesa.numero}-${seq}`))}</PmtInfId>
   <PmtMtd>DD</PmtMtd>
   <BtchBookg>true</BtchBookg>
   <NbOfTxs>${a.length}</NbOfTxs>
   <CtrlSum>${suma(a)}</CtrlSum>
   <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl><LclInstrm><Cd>${remesa.esquema === 'B2B' ? 'B2B' : 'CORE'}</Cd></LclInstrm><SeqTp>${seq}</SeqTp></PmtTpInf>
   <ReqdColltnDt>${xml(remesa.fecha_cargo)}</ReqdColltnDt>
   <Cdtr><Nm>${xml(nombre)}</Nm></Cdtr>
   <CdtrAcct><Id><IBAN>${xml(remesa.acreedor_iban)}</IBAN></Id></CdtrAcct>
   <CdtrAgt>${agente(remesa.acreedor_bic)}</CdtrAgt>
   <ChrgBr>SLEV</ChrgBr>
   <CdtrSchmeId><Id><PrvtId><Othr><Id>${idAcr}</Id><SchmeNm><Prtry>SEPA</Prtry></SchmeNm></Othr></PrvtId></Id></CdtrSchmeId>${a.map((r) => `
   <DrctDbtTxInf>
    <PmtId><EndToEndId>${xml(idSepa(r.referencia))}</EndToEndId></PmtId>
    <InstdAmt Ccy="EUR">${importe(r.importe)}</InstdAmt>
    <DrctDbtTx><MndtRltdInf><MndtId>${xml(idSepa(r.mandato))}</MndtId><DtOfSgntr>${xml(r.fecha_mandato)}</DtOfSgntr></MndtRltdInf></DrctDbtTx>
    <DbtrAgt>${agente(r.bic)}</DbtrAgt>
    <Dbtr><Nm>${xml(textoSepa(r.titular, 70) || 'DEUDOR')}</Nm></Dbtr>
    <DbtrAcct><Id><IBAN>${xml(String(r.iban).replace(/\s+/g, '').toUpperCase())}</IBAN></Id></DbtrAcct>
    <RmtInf><Ustrd>${xml(textoSepa(r.concepto || `Factura ${r.referencia} ${remesa.acreedor_nombre}`, 140))}</Ustrd></RmtInf>
   </DrctDbtTxInf>`).join('')}
  </PmtInf>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
 <CstmrDrctDbtInitn>
  <GrpHdr>
   <MsgId>${xml(msgId)}</MsgId>
   <CreDtTm>${creDtTm}</CreDtTm>
   <NbOfTxs>${R.length}</NbOfTxs>
   <CtrlSum>${suma(R)}</CtrlSum>
   <InitgPty><Nm>${xml(nombre)}</Nm><Id><OrgId><Othr><Id>${idAcr}</Id></Othr></OrgId></Id></InitgPty>
  </GrpHdr>${pmtInf}
 </CstmrDrctDbtInitn>
</Document>
`;
}

// Fecha de cargo propuesta: n días hábiles (lunes a viernes) después de hoy
export function diasHabiles(n, desde = new Date()) {
  const d = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate(), 12);
  while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) n -= 1; }
  return d;
}
