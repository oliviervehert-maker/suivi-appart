/* Test de liaison : à l'ouverture de l'écran « Relève en direct », UNE requête légère et réelle vers
   chacun des quatre services, par net.js (cadence, liste blanche, événements habituels). Hors relève :
   aucune étape, aucun compteur de relève. Aucune donnée de l'utilisateur dans ces requêtes (requêtes
   fixes : « Paris », centre de Paris). Horodatages en mémoire seulement, rien n'est stocké.
   Sans document ni stockage : testable sous Node. */
import { getJSON } from './net.js';
import { urlSuggest } from './core/bienici.js';
import { IDFM_ARRETS, urlArretsTransitous } from './core/transports.js';
import { urlAdresses } from './ui/adresse.js';

export const LIAISON_SERVICES = ['bienici', 'adresse', 'idfm', 'transitous'];
export const LIAISON_INTERVALLE_MS = 10 * 60 * 1000;
export const LIAISON_DELAI_MS = 8000;
/* Point fixe (centre de Paris) et petit rayon : quelques arrêts, jamais un calcul d'itinéraire. */
const CENTRE = { lat: 48.8566, lon: 2.3522 };
const RAYON_M = 150;

/* Les quatre requêtes, les plus légères possibles, construites comme celles de l'appli. */
export function urlsLiaison() {
  const p = new URLSearchParams();
  p.set('select', 'stop_name');
  p.set('limit', '1');
  return {
    bienici: urlSuggest('Paris'),
    adresse: urlAdresses('Paris', { limit: 1, autocomplete: false }),
    idfm: IDFM_ARRETS + '?' + p.toString(),
    transitous: urlArretsTransitous(CENTRE.lat, CENTRE.lon, RAYON_M)
  };
}

/**
 * Services à tester maintenant. derniersTests / dernieresReponses : { service: horodatage ms }.
 * Aucun test pendant une relève ni hors ligne ; un service testé, ou qui a répondu, dans les
 * 10 dernières minutes n'est pas retesté.
 */
export function servicesATester({ maintenant, derniersTests = {}, dernieresReponses = {}, releveEnCours = false, enLigne = true } = {}) {
  if (releveEnCours || enLigne === false) return [];
  const t = Number(maintenant);
  if (!isFinite(t)) return [];
  const recent = (x) => x != null && isFinite(Number(x)) && t - Number(x) < LIAISON_INTERVALLE_MS;
  return LIAISON_SERVICES.filter((s) => !recent(derniersTests[s]) && !recent(dernieresReponses[s]));
}

const derniersTests = {};

/**
 * Lance le test. o = { direct (état de js/direct.js), releveEnCours, maintenant?, enLigne? }.
 * Rend la liste des services testés ; les échecs s'affichent comme les autres, rien n'est levé.
 */
export function testerLiaison(o = {}) {
  const E = o.direct && o.direct.etat ? o.direct.etat() : { services: {} };
  const maintenant = o.maintenant != null ? o.maintenant : Date.now();
  const enLigne = o.enLigne != null ? o.enLigne : !(typeof navigator !== 'undefined' && navigator.onLine === false);
  const dernieresReponses = {};
  for (const s of LIAISON_SERVICES) { const x = E.services[s]; if (x && x.tReponse != null) dernieresReponses[s] = x.tReponse; }
  const liste = servicesATester({ maintenant, derniersTests, dernieresReponses, releveEnCours: !!o.releveEnCours, enLigne })
    .filter((s) => !(E.services[s] && E.services[s].enVol > 0));
  const urls = urlsLiaison();
  for (const s of liste) {
    derniersTests[s] = maintenant;
    getJSON(urls[s], {
      delai: LIAISON_DELAI_MS,
      suivi: { libelle: 'Test de liaison', recu: (c, statut) => (statut >= 200 && statut < 300 && c != null ? { texte: 'réponse reçue' } : null) }
    }).catch(() => {});
  }
  return liste;
}
/* Pour les tests : oublie les horodatages. */
export function _oublierTests() { for (const k of Object.keys(derniersTests)) delete derniersTests[k]; }
