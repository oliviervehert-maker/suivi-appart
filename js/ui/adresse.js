/* Autocomplétion d'adresse (Base adresse nationale), avec anti-rebond. */
import { getJSONok } from '../net.js';
import { esc } from '../core/util.js';

const BAN = 'https://api-adresse.data.gouv.fr/search/';

/* Adresse de la recherche (aussi utilisée par le test de liaison de l'écran « Relève en direct »). */
export function urlAdresses(q, o = {}) {
  const p = new URLSearchParams({ q, limit: String(o.limit || 5) });
  if (o.autocomplete !== false) p.set('autocomplete', '1');
  if (o.type) p.set('type', o.type);
  return BAN + '?' + p.toString();
}

export async function chercherAdresses(q, o = {}) {
  const r = await getJSONok(urlAdresses(q, o), {
    delai: 8000,
    suivi: { libelle: o.autocomplete === false ? 'Position d’une adresse' : 'Recherche d’adresse', recu: (c) => (c ? { n: (c.features || []).length, unite: 'adresse' } : null) }
  });
  return (r.features || []).map((f) => ({
    label: f.properties.label,
    contexte: f.properties.context || '',
    type: f.properties.type,
    cp: f.properties.postcode || '',
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0]
  }));
}

export async function geocoder(q, type) {
  const r = await chercherAdresses(q, { limit: 1, autocomplete: false, type });
  return r[0] || null;
}

/* Branche un champ texte sur une liste de propositions. onChoix(adresse) à la sélection. */
const etats = new WeakMap();
export function brancherAdresse(input, liste, onChoix) {
  const st = { t: null, n: 0, res: [] };
  etats.set(input, st);
  input.addEventListener('input', () => {
    clearTimeout(st.t);
    const q = input.value.trim();
    input.dataset.lat = ''; input.dataset.lon = '';
    if (q.length < 3) { liste.innerHTML = ''; return; }
    st.t = setTimeout(async () => {
      const n = ++st.n;
      try {
        const r = await chercherAdresses(q);
        if (n !== st.n) return;
        st.res = r;
        liste.style.width = input.offsetWidth + 'px'; liste.style.left = input.offsetLeft + 'px'; liste.style.top = (input.offsetTop + input.offsetHeight) + 'px';
        liste.innerHTML = r.length ? r.map((a, i) => '<button type="button" data-adr="' + i + '">' + esc(a.label) + '<span>' + esc(a.contexte.split(',').slice(-1)[0] || '') + '</span></button>').join('') : '<div class="msg">Aucune adresse trouvée</div>';
      } catch (e) {
        if (n === st.n) liste.innerHTML = '<div class="msg">Recherche d’adresse indisponible (réseau)</div>';
      }
    }, 320);
  });
  liste.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-adr]'); if (!b) return;
    const a = st.res[Number(b.dataset.adr)]; if (!a) return;
    input.value = a.label; input.dataset.lat = a.lat; input.dataset.lon = a.lon;
    liste.innerHTML = '';
    onChoix && onChoix(a);
  });
}
