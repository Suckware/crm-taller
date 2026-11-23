// Autocompleta población y provincia a partir del código postal (España).
// Datos: códigos postales del CNIG (dominio público), en public/cp.json; se cargan solo al usarlos.
const PROVINCIAS = {
  '01': 'Álava', '02': 'Albacete', '03': 'Alicante', '04': 'Almería', '05': 'Ávila', '06': 'Badajoz', '07': 'Illes Balears', '08': 'Barcelona',
  '09': 'Burgos', '10': 'Cáceres', '11': 'Cádiz', '12': 'Castellón', '13': 'Ciudad Real', '14': 'Córdoba', '15': 'A Coruña', '16': 'Cuenca',
  '17': 'Girona', '18': 'Granada', '19': 'Guadalajara', '20': 'Gipuzkoa', '21': 'Huelva', '22': 'Huesca', '23': 'Jaén', '24': 'León',
  '25': 'Lleida', '26': 'La Rioja', '27': 'Lugo', '28': 'Madrid', '29': 'Málaga', '30': 'Murcia', '31': 'Navarra', '32': 'Ourense',
  '33': 'Asturias', '34': 'Palencia', '35': 'Las Palmas', '36': 'Pontevedra', '37': 'Salamanca', '38': 'Santa Cruz de Tenerife', '39': 'Cantabria',
  '40': 'Segovia', '41': 'Sevilla', '42': 'Soria', '43': 'Tarragona', '44': 'Teruel', '45': 'Toledo', '46': 'Valencia', '47': 'Valladolid',
  '48': 'Bizkaia', '49': 'Zamora', '50': 'Zaragoza', '51': 'Ceuta', '52': 'Melilla',
};
let datos = null;
function cargar() {
  if (!datos) datos = fetch('./cp.json').then((r) => (r.ok ? r.json() : {})).catch(() => { datos = null; return {}; });
  return datos;
}

async function rellenar(inp) {
  const cp = inp.value.trim();
  const caja = inp.closest('.form, form, .modal, section') || document;
  const pob = caja.querySelector('input[name="poblacion"]');
  const prov = caja.querySelector('input[name="provincia"]');
  if (!/^\d{5}$/.test(cp)) return;
  // solo se sobrescribe si el campo está vacío o lo rellenamos nosotros antes
  const libre = (el) => el && (!el.value.trim() || el.dataset.auto === '1');
  const poner = (el, v) => { if (libre(el) && v) { el.value = v; el.dataset.auto = '1'; } };
  poner(prov, PROVINCIAS[cp.slice(0, 2)]);
  const tabla = await cargar();
  if (inp.value.trim() !== cp) return; // ha seguido escribiendo
  let pobs = tabla[cp] || [];
  if (typeof pobs === 'string') pobs = [pobs];
  if (pob) {
    // si el CP tiene varias poblaciones, se ofrecen como sugerencias
    let dl = document.getElementById('dl-poblaciones');
    if (!dl) { dl = document.createElement('datalist'); dl.id = 'dl-poblaciones'; document.body.appendChild(dl); }
    dl.replaceChildren(...pobs.map((n) => { const o = document.createElement('option'); o.value = n; return o; }));
    pob.setAttribute('list', 'dl-poblaciones');
    poner(pob, pobs[0]);
  }
}

export function activarCodigoPostal() {
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.name === 'codigo_postal') {
      t.value = t.value.replace(/\D/g, '').slice(0, 5);
      rellenar(t);
    } else if (t instanceof HTMLInputElement && (t.name === 'poblacion' || t.name === 'provincia')) {
      delete t.dataset.auto; // lo ha escrito la persona: no se toca
    }
  });
}
