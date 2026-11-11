/* Réseau : un seul point de sortie, liste blanche d'hôtes, cadence par hôte, délai maximal.
   Sans document ni stockage : utilisable aussi par les tests Node. */
import { HOTES_AUTORISES, INTERVALLES_MS, REFERER_ORIGINE, APP_NOM, APP_VERSION, CONTACT_APP, ALERTES_URL, SERVICES_HOTES } from './config.js';

const NAVIGATEUR = typeof window !== 'undefined' && typeof document !== 'undefined';

/* Le serveur d'alertes, s'il est renseigné, rejoint la liste blanche. */
export function hoteAlertes(url = ALERTES_URL) {
  if (!url) return '';
  try { const u = new URL(url); return u.protocol === 'https:' ? u.hostname : ''; } catch (e) { return ''; }
}
const HOTES = HOTES_AUTORISES.concat(hoteAlertes() ? [hoteAlertes()] : []);

/* ---------- Observation des requêtes (écran « Relève en direct ») ----------
   Chaque requête émet un événement au DÉPART RÉEL (après l'attente de cadence) puis un autre à la
   réponse ou à l'échec, avec la durée mesurée ; même id. Aucun observateur : rien n'est construit.
   Un observateur qui lève ne casse jamais une requête. */
const observateurs = new Set();
let numeroRequete = 0;
export function observer(fn) {
  if (typeof fn !== 'function') return () => {};
  observateurs.add(fn);
  return () => { observateurs.delete(fn); };
}
function emettre(e) {
  for (const fn of [...observateurs]) { try { fn(e); } catch (x) { /* l'observateur est ignoré */ } }
}
function chrono() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
export function serviceDe(hote) { return SERVICES_HOTES[hote] || (hote && hote === hoteAlertes() ? 'alertes' : String(hote || '')); }
function libelleParDefaut(u) {
  const morceaux = u.pathname.split('/').filter(Boolean);
  let fin = morceaux.length ? morceaux[morceaux.length - 1] : u.hostname;
  try { fin = decodeURIComponent(fin); } catch (e) { /* tel quel */ }
  return 'Requête ' + fin;
}
/* Rend null sans observateur ; sinon un suivi dont fin(statut, corps, erreur) émet la réponse. */
function suivre(u, o) {
  if (!observateurs.size) return null;
  const s = (o && o.suivi) || {};
  const base = { id: 'q' + (++numeroRequete), hote: serviceDe(u.hostname), domaine: u.hostname, libelle: s.libelle || libelleParDefaut(u) };
  if (s.etape) base.etape = s.etape;
  emettre(Object.assign({ t: Date.now() }, base));
  const t0 = chrono();
  return {
    fin(statut, corps, erreur) {
      const e = Object.assign({ t: Date.now(), duree: Math.max(0, Math.round(chrono() - t0)) }, base);
      if (erreur) e.echec = String(erreur.message || 'échec').toLowerCase();
      else {
        let recu = null;
        if (typeof s.recu === 'function') { try { recu = s.recu(corps, statut) || null; } catch (x) { recu = null; } }
        const ok = statut >= 200 && statut < 300;
        if (recu) e.recu = recu;
        else if (!ok) e.echec = 'réponse ' + statut;
        else if (corps == null && s.json !== false) e.echec = 'réponse illisible';
        else e.recu = { texte: 'réponse ' + statut };
      }
      emettre(e);
    }
  };
}

const files = new Map();   /* hôte -> promesse de la dernière requête planifiée */
const derniers = new Map(); /* hôte -> horodatage du dernier départ */

function attendre(ms) { return new Promise((r) => setTimeout(r, ms)); }

export class ErreurReseau extends Error {
  constructor(msg, code, statut) { super(msg); this.code = code; this.statut = statut; }
}

/* Planifie la requête après la précédente du même hôte, en respectant l'intervalle minimal. */
function planifier(hote, tache) {
  const prec = files.get(hote) || Promise.resolve();
  const p = prec.catch(() => {}).then(async () => {
    const iv = INTERVALLES_MS[hote] || 0;
    const ecart = Date.now() - (derniers.get(hote) || 0);
    if (ecart < iv) await attendre(iv - ecart);
    derniers.set(hote, Date.now());
    return tache();
  });
  files.set(hote, p);
  return p;
}

/**
 * GET JSON. Rend { statut, corps } ; corps = null si non JSON ou erreur HTTP.
 * Lève ErreurReseau('hors ligne' | 'délai' | 'refusé') pour les échecs de transport.
 */
export function getJSON(url, o = {}) {
  let u;
  try { u = new URL(url); } catch (e) { return Promise.reject(new ErreurReseau('Adresse invalide', 'refuse')); }
  if (u.protocol !== 'https:' || HOTES.indexOf(u.hostname) < 0) {
    return Promise.reject(new ErreurReseau('Hôte non autorisé : ' + u.hostname, 'refuse'));
  }
  return planifier(u.hostname, async () => {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = setTimeout(() => { if (ctl) ctl.abort(); }, o.delai || 20000);
    const suivi = suivre(u, o);
    try {
      const headers = { Accept: 'application/json' };
      if (!NAVIGATEUR) headers['User-Agent'] = APP_NOM.replace(/\s+/g, '') + '/' + APP_VERSION + ' (tests' + (CONTACT_APP ? '; ' + CONTACT_APP : '') + ')';
      const rep = await fetch(u.toString(), {
        method: 'GET', signal: ctl ? ctl.signal : undefined, credentials: 'omit', cache: 'no-store', headers,
        /* Seule l'origine du site part vers Transitous (identification demandée par son règlement), rien ailleurs. */
        referrerPolicy: REFERER_ORIGINE.indexOf(u.hostname) >= 0 ? 'strict-origin' : 'no-referrer'
      });
      let corps = null;
      if (rep.ok) { try { corps = await rep.json(); } catch (e) { corps = null; } }
      if (suivi) suivi.fin(rep.status, corps, null);
      return { statut: rep.status, corps };
    } catch (e) {
      const err = e && e.name === 'AbortError' ? new ErreurReseau('Délai dépassé', 'delai') : new ErreurReseau('Réseau indisponible', 'hors_ligne');
      if (suivi) suivi.fin(0, null, err);
      throw err;
    } finally { clearTimeout(t); }
  });
}

export async function getJSONok(url, o) {
  const r = await getJSON(url, o);
  if (r.statut !== 200 || r.corps == null) throw new ErreurReseau('Réponse ' + r.statut, 'http', r.statut);
  return r.corps;
}

/**
 * Requête JSON avec méthode et corps (serveur d'alertes). Rend { statut, corps, reessayerDans } ;
 * mêmes règles que getJSON : liste blanche, https, aucun cookie, aucun référent.
 */
export function envoyerJSON(url, methode, corpsEnvoye, o = {}) {
  let u;
  try { u = new URL(url); } catch (e) { return Promise.reject(new ErreurReseau('Adresse invalide', 'refuse')); }
  if (u.protocol !== 'https:' || HOTES.indexOf(u.hostname) < 0) return Promise.reject(new ErreurReseau('Hôte non autorisé : ' + u.hostname, 'refuse'));
  return planifier(u.hostname, async () => {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = setTimeout(() => { if (ctl) ctl.abort(); }, o.delai || 20000);
    const suivi = suivre(u, o);
    try {
      const init = { method: methode, signal: ctl ? ctl.signal : undefined, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { Accept: 'application/json' } };
      if (corpsEnvoye !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(corpsEnvoye); }
      const rep = await fetch(u.toString(), init);
      let corps = null;
      try { corps = await rep.json(); } catch (e) { corps = null; }
      if (suivi) suivi.fin(rep.status, corps, null);
      return { statut: rep.status, corps, reessayerDans: Number(rep.headers.get('Retry-After')) || null };
    } catch (e) {
      const err = e && e.name === 'AbortError' ? new ErreurReseau('Délai dépassé', 'delai') : new ErreurReseau('Réseau indisponible', 'hors_ligne');
      if (suivi) suivi.fin(0, null, err);
      throw err;
    } finally { clearTimeout(t); }
  });
}
