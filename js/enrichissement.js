/* File d'attente des trajets et des arrêts : une requête par seconde et par service, les annonces
   mises de côté d'abord, puis celles qui passent les autres critères. Résultats mis en cache. */
import { getJSONok } from './net.js';
import * as store from './store.js';
import { CACHE_TRAJET_JOURS, CACHE_ARRETS_JOURS } from './config.js';
import {
  urlTrajet, optionsDepuisPlan, optionsViaGare, cleTrajet, cleArrets, estIDF, urlsArretsIDFM, arretsDepuisIDFM,
  urlArretsTransitous, arretsDepuisTransitous, urlPassages, lignesDepuisPassages, arretsAInterroger, gareLaPlusProche, varianteGareUtile
} from './core/transports.js';
import { evaluer } from './core/score.js';
import { estSuivi } from './core/fusion.js';

const JOUR = 86400000;
const arretsMem = new Map();   /* cleArrets -> {source, groupes} | null (échec) */
const trajetsMem = new Map();  /* cleTrajet -> {etat:'ok', opts} | {etat:'echec'} */
const enCours = new Set();

let fileArrets = [], fileTrajets = [];
let actif = { a: false, t: false };
let reveil = null;
let ctx = null;
let total = 0, faits = 0;

function dansIDF(lat, lon) { return lat > 48.11 && lat < 49.25 && lon > 1.44 && lon < 3.56; }
function idfPour(p) { return p.dept || p.cp ? estIDF(p.dept, p.cp) : dansIDF(p.lat, p.lon); }

export async function chargerCaches() {
  const tous = await store.cacheTout();
  const now = Date.now();
  for (const x of tous) {
    if (!x || !x.k) continue;
    if (x.k.indexOf('ar|') === 0 && now - x.le < CACHE_ARRETS_JOURS * JOUR) arretsMem.set(x.k, x.v);
    if (x.k.indexOf('tr|') === 0 && now - x.le < CACHE_TRAJET_JOURS * JOUR) trajetsMem.set(x.k, x.v);
  }
  store.cachePurger(now - CACHE_ARRETS_JOURS * JOUR);
}

export function viderMemoire() { arretsMem.clear(); trajetsMem.clear(); fileArrets = []; fileTrajets = []; total = faits = 0; }

/* État des enrichissements d'une annonce, pour le score et l'affichage. undefined = en attente. */
export function enrPour(b, C) {
  const out = { arrets: null, trajets: {} };
  if (b.lat == null) return out;
  const ka = cleArrets(b.lat, b.lon);
  out.arrets = arretsMem.has(ka) ? arretsMem.get(ka) : undefined;
  for (const d of C.destinations) {
    if (d.lat == null) continue;
    const v = trajetsMem.get(cleTrajet(b.lat, b.lon, d));
    out.trajets[d.id] = v || { etat: 'attente' };
  }
  return out;
}
export function refPour(C) {
  const a = C.adresseActuelle, out = {};
  if (!a) return out;
  for (const d of C.destinations) if (d.lat != null) out[d.id] = trajetsMem.get(cleTrajet(a.lat, a.lon, d)) || { etat: 'attente' };
  return out;
}
export function arretsPour(b) { return b.lat == null ? null : arretsMem.get(cleArrets(b.lat, b.lon)); }

export function progres() { return { total, faits, actif: actif.a || actif.t || fileArrets.length + fileTrajets.length > 0 }; }

/**
 * Recalcule la file. ctx = { biens, C, majBien(ids), majProgres(), majRef() }
 */
export function planifier(c) {
  ctx = c;
  if (c.reessayer) {
    for (const [k, v] of arretsMem) if (v == null) arretsMem.delete(k);
    for (const [k, v] of trajetsMem) if (!v || v.etat !== 'ok') trajetsMem.delete(k);
  }
  const { biens, C } = c;
  const cand = biens.filter((b) => b.lat != null && b.dispo !== 'retiree' && b.status !== 'ecarte' && b.status !== 'refuse');
  const avec = cand.map((b) => ({ b, e: evaluer(b, C, {}, { sansEnrichissement: true }) }))
    .filter((x) => x.b.cote || estSuivi(x.b) || !x.e.exclu)
    .sort((x, y) => (y.b.cote ? 2 : estSuivi(y.b) ? 1 : 0) - (x.b.cote ? 2 : estSuivi(x.b) ? 1 : 0) || y.e.score - x.e.score);

  const fa = [], ft = [], vuA = new Set(), vuT = new Set();
  const origines = [];
  if (C.adresseActuelle) origines.push({ id: '__actuelle', lat: C.adresseActuelle.lat, lon: C.adresseActuelle.lon, ref: true });
  avec.forEach((x) => origines.push(x.b));

  for (const o of origines) {
    const ka = cleArrets(o.lat, o.lon);
    if (!arretsMem.has(ka) && !vuA.has(ka) && !enCours.has(ka)) { vuA.add(ka); fa.push({ k: ka, lat: o.lat, lon: o.lon, idf: idfPour(o), ids: [o.id] }); }
    else if (vuA.has(ka)) { const t = fa.find((x) => x.k === ka); if (t) t.ids.push(o.id); }
    for (const d of C.destinations) {
      if (d.lat == null) continue;
      const kt = cleTrajet(o.lat, o.lon, d);
      const v = trajetsMem.get(kt);
      if ((v && v.etat === 'ok') || vuT.has(kt) || enCours.has(kt)) continue;
      vuT.add(kt);
      ft.push({ k: kt, ka, de: { lat: o.lat, lon: o.lon }, dest: d, id: o.id, ref: !!o.ref });
    }
  }
  fileArrets = fa; fileTrajets = ft;
  total = fa.length + ft.length; faits = 0;
  c.majProgres && c.majProgres();
  if (reveil) { reveil(); reveil = null; }
  if (!actif.a) boucleArrets();
  if (!actif.t) boucleTrajets();
}

function signaler(ids, ref) {
  faits++;
  if (!ctx) return;
  if (ids && ids.length) ctx.majBien && ctx.majBien(ids.filter((i) => i !== '__actuelle'));
  if (ref || (ids && ids.indexOf('__actuelle') >= 0)) ctx.majRef && ctx.majRef();
  ctx.majProgres && ctx.majProgres();
}

async function boucleArrets() {
  actif.a = true;
  try {
    while (fileArrets.length) {
      const t = fileArrets.shift();
      if (arretsMem.has(t.k)) { signaler(t.ids); continue; }
      enCours.add(t.k);
      let v = null, aCacher = false;
      try {
        if (t.idf) {
          const [u1, u2] = urlsArretsIDFM(t.lat, t.lon);
          const r1 = await getJSONok(u1), r2 = await getJSONok(u2);
          v = arretsDepuisIDFM(t.lat, t.lon, [r1, r2]); aCacher = true;
        } else {
          const r = await getJSONok(urlArretsTransitous(t.lat, t.lon));
          v = arretsDepuisTransitous(t.lat, t.lon, r);
          for (const g of arretsAInterroger(v.groupes)) {
            try { g.lignes = lignesDepuisPassages(await getJSONok(urlPassages(g.stopId))); g.lignesLues = true; } catch (e) { g.lignesLues = false; }
          }
          aCacher = true;
        }
      } catch (e) { v = null; }
      enCours.delete(t.k);
      arretsMem.set(t.k, v);
      if (aCacher && v) store.cacheEcrire(t.k, v);
      if (reveil) { reveil(); reveil = null; }
      signaler(t.ids);
    }
  } finally { actif.a = false; if (reveil) { reveil(); reveil = null; } ctx && ctx.majProgres && ctx.majProgres(); }
}

async function boucleTrajets() {
  actif.t = true;
  try {
    for (;;) {
      if (!fileTrajets.length) break;
      /* La variante « depuis la gare » a besoin des arrêts : on prend d'abord les trajets prêts. */
      let i = fileTrajets.findIndex((t) => arretsMem.has(t.ka));
      if (i < 0) {
        if (actif.a || fileArrets.length) { await new Promise((r) => { reveil = r; setTimeout(r, 3000); }); continue; }
        i = 0;
      }
      const t = fileTrajets.splice(i, 1)[0];
      const v0 = trajetsMem.get(t.k);
      if (v0 && v0.etat === 'ok') { signaler([t.id], t.ref); continue; }
      enCours.add(t.k);
      let v;
      try {
        const rep = await getJSONok(urlTrajet({ de: t.de, vers: t.dest, heure: t.dest.heure, mode: t.dest.mode }), { delai: 30000 });
        let opts = optionsDepuisPlan(rep, t.dest.mode);
        if (t.dest.mode === 'transit') {
          const gare = gareLaPlusProche(arretsMem.get(t.ka));
          if (varianteGareUtile(opts, gare)) {
            try {
              const rep2 = await getJSONok(urlTrajet({ de: { lat: gare.lat, lon: gare.lon }, vers: t.dest, heure: t.dest.heure, mode: 'transit' }), { delai: 30000 });
              opts = opts.concat(optionsViaGare(rep2, gare));
            } catch (e) { /* la variante est facultative */ }
          }
        }
        v = { etat: 'ok', opts };
        store.cacheEcrire(t.k, v);
      } catch (e) { v = { etat: 'echec' }; }
      enCours.delete(t.k);
      trajetsMem.set(t.k, v);
      signaler([t.id], t.ref);
    }
  } finally { actif.t = false; ctx && ctx.majProgres && ctx.majProgres(); }
}

/* Pour les tests et l'export : lecture brute. */
export function _memoire() { return { arretsMem, trajetsMem }; }
