/* Alertes par notification : ce que le téléphone envoie au serveur d'alertes, et les règles
   partagées avec lui (le serveur importe ce module). Pur : ni document, ni stockage, ni réseau. */
import { estSuivi } from './fusion.js';

/* Seuls champs des critères transmis : filtres de la recherche Bien'ici et exclusions nettes.
   Jamais les trajets (destinations), ni l'adresse actuelle, ni les préférences de transport, ni la date de sortie. */
export const CHAMPS_RECHERCHE_ALERTE = ['v', 'lieux', 'quartiersEcartes', 'types', 'loyerMax', 'surfMin', 'piecesMin', 'chMin', 'meuble', 'equip', 'dpeMax', 'rdc', 'agencesSeulement'];
export const CHAMPS_INTERDITS = ['destinations', 'adresseActuelle'];
export const MAX_SUIVIS = 200;
export const MAX_ZONES = 30;
export const MAX_CORPS = 32 * 1024;
export const SILENCE_DEFAUT = { debut: '22:00', fin: '07:00' };
export const DECLENCHEURS_DEFAUT = { nouvelles: true, retirees: true, baisses: true };

function copie(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

/* Critères -> objet envoyé au serveur. Construit champ par champ : un champ absent de la liste ne part jamais. */
export function rechercheAlerte(C) {
  const r = {};
  if (!C || typeof C !== 'object') return r;
  for (const k of CHAMPS_RECHERCHE_ALERTE) {
    if (C[k] === undefined) continue;
    if (k === 'lieux') r.lieux = (Array.isArray(C.lieux) ? C.lieux : []).map((l) => ({ nom: l.nom, type: l.type, cp: copie(l.cp || []), zoneIds: copie(l.zoneIds || []), etat: l.etat }));
    else r[k] = copie(C[k]);
  }
  return r;
}

/* Zones Bien'ici distinctes de la recherche, triées (clé de recherche partagée côté serveur). */
export function zonesDe(recherche) {
  const z = new Set();
  for (const l of (recherche && Array.isArray(recherche.lieux) ? recherche.lieux : [])) for (const id of (Array.isArray(l.zoneIds) ? l.zoneIds : [])) z.add(String(id));
  return [...z].sort();
}

/* Annonces suivies (mises de côté ou statut de suivi), encore en ligne, lues sur Bien'ici : numéro et dernier loyer. */
export function suivisAlerte(biens) {
  return (Array.isArray(biens) ? biens : [])
    .filter((b) => b && b.src === 'bienici' && typeof b.id === 'string' && b.dispo !== 'retiree' && estSuivi(b))
    .slice(0, MAX_SUIVIS)
    .map((b) => ({ id: b.id, loyer: typeof b.loyer === 'number' && isFinite(b.loyer) ? b.loyer : null }));
}

/* Vrai si l'objet contient, à n'importe quelle profondeur, un champ interdit. */
export function contientChampInterdit(o, prof = 0) {
  if (!o || typeof o !== 'object' || prof > 8) return false;
  if (Array.isArray(o)) return o.some((x) => contientChampInterdit(x, prof + 1));
  for (const k of Object.keys(o)) {
    if (CHAMPS_INTERDITS.indexOf(k) >= 0) return true;
    if (contientChampInterdit(o[k], prof + 1)) return true;
  }
  return false;
}

export function heureValide(h) { return typeof h === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(h); }
