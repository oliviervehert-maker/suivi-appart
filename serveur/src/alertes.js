/* Serveur d'alertes : routes (inscription du téléphone) et relève périodique (Bien'ici -> notification).
   Logique pure et portable : tout l'extérieur est injecté dans ctx = { kv, fetch, maintenant, env, attendre? }.
     kv         : get(clé) -> texte|null, put(clé, texte), delete(clé), list({prefix, cursor}) -> {keys:[{name}], list_complete, cursor}
     fetch      : fetch standard
     maintenant : () -> horodatage en ms
     env        : { ORIGINES, VAPID_PUBLIQUE, VAPID_PRIVEE, VAPID_SUJET }
   Le serveur réutilise le code de l'application : mêmes filtres Bien'ici, même normalisation, même verdict. */
import { construireFiltres, urlRecherche, urlFiche, normaliserAnnonce, verdictFiche, PAGE } from '../../js/core/bienici.js';
import { nettoyerCriteres } from '../../js/core/criteres.js';
import { evaluer } from '../../js/core/score.js';
import { fmt } from '../../js/core/util.js';
import { APP_VERSION, INTERVALLES_MS, CONTACT_APP } from '../../js/config.js';
import { CHAMPS_RECHERCHE_ALERTE, MAX_SUIVIS, MAX_ZONES, MAX_CORPS, contientChampInterdit, zonesDe, heureValide } from '../../js/core/alertes.js';
import { endpointAccepte, envoyerPush, b64uDec } from './push.js';

export const MAX_ABONNEMENTS = 300;
export const BUDGET_SOUS_REQUETES = 40;
export const BUDGET_KV = 900;
export const PAGES_MAX = 5;
export const FICHES_MAX = 5;
export const ESSAIS_MAX = 3;
export const JOUR = 86400000;
export const OUBLI_JOURS = 45;
export const ABSENCE_JOURS = 30;
const UA = 'SuiviAppartAlertes/' + APP_VERSION + (CONTACT_APP ? ' (+' + CONTACT_APP + ')' : '');

const enc = new TextEncoder();
async function sha256hex(txt) {
  const h = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', enc.encode(txt)));
  return [...h].map((x) => x.toString(16).padStart(2, '0')).join('');
}
async function lireJSON(kv, cle) {
  const t = await kv.get(cle);
  if (t == null) return null;
  try { return JSON.parse(t); } catch (e) { return null; }
}

/* ======================================================================
   Validation de l'inscription
   ====================================================================== */
function erreur(msg) { return { ok: false, erreur: msg }; }
function estObjet(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }

export function validerAbonnement(c) {
  if (!estObjet(c)) return erreur('Corps JSON attendu.');
  if (contientChampInterdit(c)) return erreur('Refusé : les trajets (destinations) et l’adresse actuelle ne doivent jamais être envoyés au serveur d’alertes.');
  const a = c.abonnement;
  if (!estObjet(a) || typeof a.endpoint !== 'string' || !estObjet(a.keys)) return erreur('Abonnement de notification manquant.');
  if (!endpointAccepte(a.endpoint)) return erreur('Service de notification non reconnu.');
  let p, au;
  try { p = b64uDec(a.keys.p256dh); au = b64uDec(a.keys.auth); } catch (e) { return erreur('Clés de notification illisibles.'); }
  if (p.length !== 65 || p[0] !== 4 || au.length !== 16) return erreur('Clés de notification invalides.');
  if (typeof c.jeton !== 'string' || !/^[A-Za-z0-9_-]{22,128}$/.test(c.jeton)) return erreur('Jeton invalide.');

  const r = c.recherche;
  if (!estObjet(r)) return erreur('Critères de recherche manquants.');
  for (const k of Object.keys(r)) if (CHAMPS_RECHERCHE_ALERTE.indexOf(k) < 0) return erreur('Champ de critères inattendu : ' + k.slice(0, 40));
  if (!Array.isArray(r.lieux) || !r.lieux.length) return erreur('Aucun lieu de recherche.');
  for (const l of r.lieux) {
    if (!estObjet(l) || typeof l.nom !== 'string' || l.nom.length > 80 || !Array.isArray(l.zoneIds) || l.zoneIds.length > 5) return erreur('Lieu invalide.');
    if (!l.zoneIds.every((z) => typeof z === 'string' && /^-?[A-Za-z0-9_]{1,40}$/.test(z))) return erreur('Zone invalide.');
    if (l.cp != null && (!Array.isArray(l.cp) || l.cp.length > 10 || !l.cp.every((x) => typeof x === 'string' && x.length <= 10))) return erreur('Codes postaux invalides.');
  }
  if (r.quartiersEcartes != null && (!Array.isArray(r.quartiersEcartes) || r.quartiersEcartes.length > 100)) return erreur('Quartiers écartés invalides.');
  for (const k of ['loyerMax', 'surfMin', 'piecesMin', 'chMin']) if (r[k] != null && (typeof r[k] !== 'number' || !isFinite(r[k]) || r[k] < 0 || r[k] > 1e6)) return erreur('Valeur invalide : ' + k);
  const C = nettoyerCriteres(r);
  const recherche = {};
  for (const k of CHAMPS_RECHERCHE_ALERTE) recherche[k] = C[k];
  const zones = zonesDe(recherche);
  if (!zones.length) return erreur('Aucune zone de recherche.');
  if (zones.length > MAX_ZONES) return erreur('Trop de zones de recherche : ' + MAX_ZONES + ' au plus.');

  if (!Array.isArray(c.suivis) || c.suivis.length > MAX_SUIVIS) return erreur('Liste des annonces suivies invalide (' + MAX_SUIVIS + ' au plus).');
  const suivis = [];
  for (const s of c.suivis) {
    if (!estObjet(s) || typeof s.id !== 'string' || !/^bi-[A-Za-z0-9_.-]{1,100}$/.test(s.id)) return erreur('Annonce suivie invalide.');
    if (s.loyer != null && (typeof s.loyer !== 'number' || !isFinite(s.loyer) || s.loyer < 0)) return erreur('Loyer suivi invalide.');
    suivis.push({ id: s.id, loyer: s.loyer == null ? null : s.loyer });
  }
  let silence = null;
  if (c.silence != null) {
    if (!estObjet(c.silence) || !heureValide(c.silence.debut) || !heureValide(c.silence.fin)) return erreur('Heures de silence invalides (HH:MM).');
    silence = { debut: c.silence.debut, fin: c.silence.fin };
  }
  const d = c.declencheurs;
  if (!estObjet(d) || ['nouvelles', 'retirees', 'baisses'].some((k) => typeof d[k] !== 'boolean')) return erreur('Déclencheurs invalides.');
  return {
    ok: true,
    abonnement: { endpoint: a.endpoint, keys: { p256dh: a.keys.p256dh, auth: a.keys.auth } },
    jeton: c.jeton, recherche, zones, suivis, silence,
    declencheurs: { nouvelles: d.nouvelles, retirees: d.retirees, baisses: d.baisses }
  };
}

/* Clé d'une recherche : abonnements aux mêmes filtres = une seule requête partagée par relève. */
export async function cleRecherche(recherche, zones) {
  return sha256hex(JSON.stringify(construireFiltres(nettoyerCriteres(recherche), zones, 1, PAGE)));
}

/* ======================================================================
   Routes
   ====================================================================== */
export function listeOrigines(env) {
  return String((env && env.ORIGINES) || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
}
function repondre(statut, corps, entetes = {}) {
  return new Response(corps == null ? null : JSON.stringify(corps), {
    status: statut,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' }, entetes)
  });
}

async function lireCorps(req) {
  const lg = Number(req.headers.get('Content-Length') || 0);
  if (lg > MAX_CORPS) return { trop: true };
  const t = await req.text();
  if (enc.encode(t).length > MAX_CORPS) return { trop: true };
  try { return { json: JSON.parse(t) }; } catch (e) { return { json: null }; }
}

async function lireIndex(kv) { const i = await lireJSON(kv, 'index'); return Array.isArray(i) ? i : []; }

export async function traiterRequete(req, ctx) {
  const url = new URL(req.url);
  const origine = req.headers.get('Origin');
  const permise = !!origine && listeOrigines(ctx.env).indexOf(origine) >= 0;
  const cors = permise ? { 'Access-Control-Allow-Origin': origine } : {};
  const route = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS') {
    if (!permise || (route !== '/cle' && route !== '/abonnement')) return repondre(403, null);
    return new Response(null, { status: 204, headers: Object.assign({ 'Access-Control-Allow-Methods': 'GET, PUT, DELETE', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }, cors) });
  }
  if (route === '/cle' && req.method === 'GET') {
    if (origine && !permise) return repondre(403, { erreur: 'Origine non autorisée.' });
    if (!ctx.env || !ctx.env.VAPID_PUBLIQUE) return repondre(503, { erreur: 'Serveur d’alertes non configuré.' }, cors);
    return repondre(200, { publique: ctx.env.VAPID_PUBLIQUE }, cors);
  }
  if (route === '/abonnement' && (req.method === 'PUT' || req.method === 'DELETE')) {
    if (!permise) return repondre(403, { erreur: 'Origine non autorisée.' });
    const lu = await lireCorps(req);
    if (lu.trop) return repondre(413, { erreur: 'Corps trop volumineux (32 Ko au plus).' }, cors);
    if (!lu.json) return repondre(400, { erreur: 'Corps JSON attendu.' }, cors);
    return req.method === 'PUT' ? inscrire(lu.json, ctx, cors) : desinscrire(lu.json, ctx, cors);
  }
  return repondre(404, { erreur: 'Introuvable.' }, cors);
}

function signatureContenu(a) {
  return JSON.stringify([a.endpoint, a.cles, a.recherche, a.suivis, a.silence, a.declencheurs]);
}

async function inscrire(corps, ctx, cors) {
  const v = validerAbonnement(corps);
  if (!v.ok) return repondre(400, { erreur: v.erreur }, cors);
  const kv = ctx.kv, now = ctx.maintenant();
  const id = await sha256hex(v.abonnement.endpoint);
  const empreinte = await sha256hex(v.jeton);
  const ex = await lireJSON(kv, 'ab:' + id);
  if (ex && ex.jeton !== empreinte) return repondre(403, { erreur: 'Jeton différent de celui de l’inscription.' }, cors);
  const nouveau = {
    v: 1, id, endpoint: v.abonnement.endpoint, cles: v.abonnement.keys, jeton: empreinte,
    recherche: v.recherche, zones: v.zones, cle: await cleRecherche(v.recherche, v.zones),
    suivis: v.suivis, silence: v.silence, declencheurs: v.declencheurs,
    creeLe: ex ? ex.creeLe : now, majLe: now, contactLe: now
  };
  let index = await lireIndex(kv);
  const absent = index.indexOf(id) < 0;
  if (!ex && absent && index.length >= MAX_ABONNEMENTS) return repondre(503, { erreur: 'Serveur d’alertes complet : aucune nouvelle inscription pour l’instant.' }, cors);
  if (absent) { index = index.concat([id]); await kv.put('index', JSON.stringify(index)); }
  if (ex && signatureContenu(ex) === signatureContenu(nouveau)) {
    /* Rien de changé : seul le contact du téléphone est noté, au plus deux fois par jour. */
    if (now - (ex.contactLe || 0) > JOUR / 2) { ex.contactLe = now; await kv.put('ab:' + id, JSON.stringify(ex)); }
    return repondre(200, { ok: true, inchange: true }, cors);
  }
  if (ex && now - (ex.majLe || 0) < 60000) {
    const s = Math.max(1, Math.ceil((60000 - (now - ex.majLe)) / 1000));
    return repondre(429, { erreur: 'Une modification par minute au plus.', reessayerDans: s }, Object.assign({ 'Retry-After': String(s) }, cors));
  }
  await kv.put('ab:' + id, JSON.stringify(nouveau));
  return repondre(ex ? 200 : 201, { ok: true }, cors);
}

async function desinscrire(corps, ctx, cors) {
  if (!estObjet(corps) || typeof corps.endpoint !== 'string' || typeof corps.jeton !== 'string' || corps.endpoint.length > 1024) return repondre(400, { erreur: 'endpoint et jeton attendus.' }, cors);
  const kv = ctx.kv;
  const id = await sha256hex(corps.endpoint);
  const ex = await lireJSON(kv, 'ab:' + id);
  if (!ex) return repondre(404, { erreur: 'Abonnement inconnu.' }, cors);
  if (ex.jeton !== await sha256hex(corps.jeton)) return repondre(403, { erreur: 'Jeton différent de celui de l’inscription.' }, cors);
  await effacerAbonnement(kv, id);
  const index = await lireIndex(kv);
  if (index.indexOf(id) >= 0) await kv.put('index', JSON.stringify(index.filter((x) => x !== id)));
  return repondre(200, { ok: true, efface: true }, cors);
}

async function effacerAbonnement(kv, id) {
  await kv.delete('ab:' + id);
  await kv.delete('et:' + id);
}

/* ======================================================================
   Heure de Paris, plage de silence
   ====================================================================== */
const FMT_PARIS = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function minutesParis(ms) {
  const p = FMT_PARIS.formatToParts(new Date(ms));
  const h = Number((p.find((x) => x.type === 'hour') || {}).value), m = Number((p.find((x) => x.type === 'minute') || {}).value);
  return (h % 24) * 60 + m;
}
function minutes(hhmm) { return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)); }
export function enSilence(ms, silence) {
  if (!silence) return false;
  const d = minutes(silence.debut), f = minutes(silence.fin), m = minutesParis(ms);
  if (d === f) return false;
  return d < f ? (m >= d && m < f) : (m >= d || m < f);
}

/* ======================================================================
   Message de notification
   ====================================================================== */
function lieuTexte(a) {
  const c = String(a.commune || '').replace(/-sur-Seine$/, '');
  return c + (a.quartier ? (c ? ', ' : '') + a.quartier : '');
}
/* Description courte d'une annonce gardée dans l'état : [lieu, surface, pièces, charges comprises]. */
function descr(a) { return [lieuTexte(a), a.surf == null ? null : a.surf, a.pieces == null ? null : a.pieces, a.cc === 'cc' ? 1 : 0]; }
function item(k, id, d, loyer, avant) { return { k, id, d, l: loyer == null ? null : loyer, av: avant == null ? null : avant }; }

function prix(l, cc) { return fmt(l) + ' €' + (cc ? ' CC' : ''); }
function ligneBien(it) {
  const d = it.d || [];
  return [d[1] != null ? fmt(d[1]) + ' m²' : null, d[2] ? d[2] + ' pièce' + (d[2] > 1 ? 's' : '') : null, it.l != null ? prix(it.l, d[3]) : null].filter(Boolean).join(' · ');
}
function baisseTexte(it) { return fmt(it.l) + ' € (avant ' + fmt(it.av) + ' €)'; }
function ligneGroupe(it, mixte) {
  const lieu = (it.d && it.d[0]) || 'Annonce';
  if (it.k === 'b') return (mixte ? 'Baisse · ' : '') + lieu + ' · ' + baisseTexte(it);
  const b = ligneBien(it);
  return (it.k === 'r' ? 'Retirée · ' : mixte ? 'Nouvelle · ' : '') + lieu + (b ? ' · ' + b : '');
}
function pluriel(n, un, plusieurs) { return n + ' ' + (n > 1 ? plusieurs : un); }

/* Une seule notification par relève : { t, c, u, tag }, jamais plus de 2 Ko. */
export function composerMessage(items, maintenant = 0) {
  if (items.length === 1) {
    const it = items[0], lieu = (it.d && it.d[0]) || '';
    const suffixe = lieu ? ' · ' + lieu : '';
    const u = './?b=' + encodeURIComponent(it.id), tag = 'sa-' + it.id;
    if (it.k === 'n') return borner({ t: 'Nouvelle annonce' + suffixe, c: ligneBien(it), u, tag });
    if (it.k === 'b') return borner({ t: 'Loyer en baisse' + suffixe, c: baisseTexte(it), u, tag });
    return borner({ t: 'Annonce retirée' + suffixe, c: ligneBien(it) || (it.l != null ? 'Dernier loyer connu : ' + fmt(it.l) + ' €' : 'Annonce suivie'), u, tag });
  }
  const n = items.filter((x) => x.k === 'n').length, r = items.filter((x) => x.k === 'r').length, b = items.filter((x) => x.k === 'b').length;
  const parts = [];
  if (n) parts.push(pluriel(n, 'nouvelle annonce', 'nouvelles annonces'));
  if (r) parts.push(pluriel(r, 'annonce retirée', 'annonces retirées'));
  if (b) parts.push(pluriel(b, 'loyer en baisse', 'loyers en baisse'));
  const mixte = parts.length > 1;
  const lignes = items.slice(0, 3).map((x) => ligneGroupe(x, mixte));
  if (items.length > 3) lignes.push('et ' + (items.length - 3) + ' de plus');
  return borner({ t: parts.join(' · '), c: lignes.join('\n'), u: './', tag: 'sa-g' + Math.floor(maintenant / 1000).toString(36) });
}
function borner(m) {
  const taille = () => enc.encode(JSON.stringify(m)).length;
  if (m.t.length > 120) m.t = m.t.slice(0, 119) + '…';
  while (taille() > 2048 && m.c.length > 20) m.c = m.c.slice(0, Math.floor(m.c.length * 0.8)) + '…';
  return m;
}

/* Fusion des notifications en attente : une seule entrée par annonce, la plus parlante. */
export function fusionnerAttente(attente, items) {
  const parId = new Map();
  for (const x of attente.concat(items)) {
    const p = parId.get(x.id);
    if (!p) { parId.set(x.id, x); continue; }
    if (x.k === 'r') parId.set(x.id, x);
    else if (p.k === 'n' && x.k === 'b') parId.set(x.id, Object.assign({}, p, { l: x.l, d: x.d || p.d }));
    else if (p.k === 'b' && x.k === 'b') parId.set(x.id, Object.assign({}, x, { av: Math.max(p.av || 0, x.av || 0) }));
    else if (p.k !== 'r') parId.set(x.id, x);
  }
  return [...parId.values()].slice(-50);
}

/* ======================================================================
   Relève
   ====================================================================== */
function etatInitial() { return { v: 1, init: false, cle: null, initLe: 0, vus: {}, retirees: {}, attente: [], essais: 0 }; }
function jourDe(ms) { return Math.floor(ms / JOUR); }
function exclue(a, C) { return evaluer(a, C, {}, { sansEnrichissement: true }).exclu; }
function hachNum(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }

/**
 * Une relève : au plus BUDGET_SOUS_REQUETES appels sortants (Bien'ici + services de notification),
 * abonnements traités à tour de rôle à partir d'un curseur gardé en KV.
 * @returns rapport chiffré de la relève
 */
export async function releve(ctx, o = {}) {
  const now = ctx.maintenant();
  const R = { traites: 0, recherches: 0, fiches: 0, notifications: 0, echecsPush: 0, supprimes: 0, sousRequetes: 0, lecturesKv: 0, ecrituresKv: 0, arret: '' };
  const budget = o.budget || BUDGET_SOUS_REQUETES, budgetKv = o.budgetKv || BUDGET_KV;
  /* Plafond facultatif d'abonnements traités par relève (variable ABONNEMENTS_PAR_RELEVE) : limite le temps
     de calcul d'une exécution (offre gratuite : 10 ms de CPU) ; le tour de rôle sert tout le monde, plus lentement. */
  const maxTraites = o.maxTraites || Number(ctx.env && ctx.env.ABONNEMENTS_PAR_RELEVE) || Infinity;
  const kvBrut = ctx.kv;
  const kv = {
    get: (k) => { R.lecturesKv++; return kvBrut.get(k); },
    put: (k, v) => { R.ecrituresKv++; return kvBrut.put(k, v); },
    delete: (k) => { R.ecrituresKv++; return kvBrut.delete(k); },
    list: (x) => { R.lecturesKv++; return kvBrut.list(x); }
  };
  const restant = () => budget - R.sousRequetes;
  const kvRestant = () => budgetKv - R.lecturesKv - R.ecrituresKv;
  const pause = o.pause != null ? o.pause : (INTERVALLES_MS['www.bienici.com'] || 600);
  const attendre = ctx.attendre || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let dernierBienici = 0;

  async function getBienici(url) {
    const ecart = Date.now() - dernierBienici;
    if (dernierBienici && pause > 0 && ecart < pause) await attendre(pause - ecart);
    dernierBienici = Date.now();
    R.sousRequetes++;
    try {
      const rep = await ctx.fetch(url, { method: 'GET', headers: { Accept: 'application/json', 'User-Agent': UA } });
      let corps = null;
      if (rep.ok) { try { corps = await rep.json(); } catch (e) { corps = null; } }
      return { statut: rep.status, corps };
    } catch (e) { return { statut: 0, corps: null }; }
  }

  /* Recherche Bien'ici : toutes les zones de l'abonnement en une requête, 5 pages au plus.
     Un appel est toujours gardé en réserve pour la notification. */
  async function chercher(C, zones) {
    const annonces = [], vus = new Set();
    let total = null, lus = 0, page = 1;
    const res = { annonces, total: 0, complet: false, coupe: false, echec: false, tronque: false };
    R.recherches++;
    while (page <= PAGES_MAX) {
      if (restant() < 2) { res.coupe = true; break; }
      const r = await getBienici(urlRecherche(construireFiltres(C, zones, page, PAGE)));
      if (r.statut !== 200 || !r.corps) { if (page === 1) res.echec = true; break; }
      const liste = Array.isArray(r.corps.realEstateAds) ? r.corps.realEstateAds : [];
      if (total == null) total = Number(r.corps.total) || 0;
      for (const a of liste) {
        lus++;
        const n = normaliserAnnonce(a);
        if (!n || vus.has(n.id)) continue;
        vus.add(n.id); n.lieux = zones.slice(); annonces.push(n);
      }
      if (liste.length < PAGE || lus >= total) { res.complet = true; break; }
      if (page === PAGES_MAX) { res.complet = true; res.tronque = true; break; }
      page++;
    }
    res.total = total || 0;
    return res;
  }

  let index = await lireIndex(kv);
  /* Une fois par jour : l'index est complété par la liste réelle des abonnements (écritures concurrentes). */
  if (Number(await kv.get('menage')) !== jourDe(now) && kvBrut.list) {
    const noms = new Set();
    let cursor;
    for (let tour = 0; tour < 10; tour++) {
      const l = await kv.list({ prefix: 'ab:', cursor });
      (l.keys || []).forEach((k) => noms.add(k.name.slice(3)));
      if (l.list_complete !== false || !l.cursor) break;
      cursor = l.cursor;
    }
    const manquants = [...noms].filter((id) => index.indexOf(id) < 0);
    if (manquants.length) { index = index.concat(manquants); await kv.put('index', JSON.stringify(index)); }
    await kv.put('menage', String(jourDe(now)));
  }
  if (!index.length) { R.arret = 'aucun abonnement'; return R; }

  const vapid = { publique: ctx.env.VAPID_PUBLIQUE, priveeJwk: ctx.env.VAPID_PRIVEE, sujet: ctx.env.VAPID_SUJET || CONTACT_APP };
  let curseur = Number(await kv.get('curseur')) || 0;
  if (curseur < 0 || curseur >= index.length) curseur = 0;
  const recherches = new Map();
  const supprimes = new Set();
  let n = 0;

  for (; n < index.length; n++) {
    const id = index[(curseur + n) % index.length];
    if (R.traites >= maxTraites) { R.arret = 'plafond par relève'; break; }
    if (kvRestant() < 10) { R.arret = 'budget KV'; break; }
    const ab = await lireJSON(kv, 'ab:' + id);
    if (!ab) { supprimes.add(id); continue; }
    if (now - (ab.contactLe || 0) > OUBLI_JOURS * JOUR) { await effacerAbonnement(kv, id); supprimes.add(id); R.supprimes++; continue; }
    if (!recherches.has(ab.cle) && restant() < 2) { R.arret = 'budget'; break; }
    const etTexte = await kv.get('et:' + id);
    let et = etatInitial();
    if (etTexte) { try { et = Object.assign(etatInitial(), JSON.parse(etTexte)); } catch (e) { et = etatInitial(); } }
    const avant = JSON.stringify(et);
    let abModifie = false;

    const C = nettoyerCriteres(ab.recherche);
    let res = recherches.get(ab.cle);
    if (!res) { res = await chercher(C, ab.zones); recherches.set(ab.cle, res); }
    const baseline = !et.init || et.cle !== ab.cle;
    const D = ab.declencheurs || {};
    const suivis = new Map((ab.suivis || []).map((s) => [s.id, s]));
    const items = [];
    const presents = new Set();

    if (!res.echec) {
      for (const a of res.annonces) {
        presents.add(a.id);
        const v = et.vus[a.id];
        const d = descr(a);
        if (!v) {
          et.vus[a.id] = { l: a.loyer, d, a: 0 };
          if (baseline) continue;
          const s = suivis.get(a.id);
          const recente = !res.tronque || !a.publieLe || Date.parse(a.publieLe) >= (et.initLe || 0) - 2 * JOUR;
          if (s && s.loyer != null && a.loyer != null && a.loyer < s.loyer - 0.5) { if (D.baisses) items.push(item('b', a.id, d, a.loyer, s.loyer)); }
          else if (!s && D.nouvelles && recente && !exclue(a, C)) items.push(item('n', a.id, d, a.loyer));
          continue;
        }
        if (v.a) v.a = 0;
        if (!baseline && D.baisses && a.loyer != null && v.l != null && a.loyer < v.l - 0.5 && (suivis.has(a.id) || !exclue(a, C))) items.push(item('b', a.id, d, a.loyer, v.l));
        if (a.loyer !== v.l) v.l = a.loyer;
        if (JSON.stringify(v.d) !== JSON.stringify(d)) v.d = d;
      }
      if (baseline && res.complet) { et.init = true; et.cle = ab.cle; et.initLe = now; }
      if (res.complet) {
        const j = jourDe(now);
        for (const k of Object.keys(et.vus)) {
          if (presents.has(k) || suivis.has(k)) continue;
          const v = et.vus[k];
          if (!v.a) v.a = j; else if (j - v.a > ABSENCE_JOURS) delete et.vus[k];
        }
      }

      /* Annonces suivies absentes de la recherche : fiche interrogée, 5 au plus, à tour de rôle. */
      if (!baseline && (D.retirees || D.baisses)) {
        const absents = (ab.suivis || []).filter((s) => !presents.has(s.id) && !et.retirees[s.id]);
        const depart = absents.length ? (Math.floor(now / 900000) * FICHES_MAX + hachNum(id)) % absents.length : 0;
        const choisis = absents.slice(depart).concat(absents.slice(0, depart)).slice(0, FICHES_MAX);
        for (const s of choisis) {
          if (restant() < 2) break;
          R.fiches++;
          const r = await getBienici(urlFiche(s.id.slice(3)));
          const verdict = verdictFiche(r.statut, r.corps);
          const v = et.vus[s.id];
          if (verdict.dispo === 'retiree') {
            et.retirees[s.id] = now;
            ab.suivis = ab.suivis.filter((x) => x.id !== s.id); abModifie = true;
            if (D.retirees) items.push(item('r', s.id, v ? v.d : null, v && v.l != null ? v.l : s.loyer));
          } else if (verdict.dispo === 'en_ligne' && verdict.annonce) {
            const f = verdict.annonce, ref = v && v.l != null ? v.l : s.loyer;
            if (D.baisses && f.loyer != null && ref != null && f.loyer < ref - 0.5) items.push(item('b', s.id, descr(f), f.loyer, ref));
            const nv = { l: f.loyer, d: descr(f), a: v ? v.a : 0 };
            if (!v || JSON.stringify(v) !== JSON.stringify(nv)) et.vus[s.id] = nv;
          }
        }
      }
    }
    for (const k of Object.keys(et.retirees)) if (now - et.retirees[k] > OUBLI_JOURS * JOUR) delete et.retirees[k];

    if (items.length) et.attente = fusionnerAttente(et.attente || [], items);
    let efface = false;
    if (et.attente.length && !enSilence(now, ab.silence) && restant() >= 1) {
      R.sousRequetes++;
      const r = await envoyerPush({ abonnement: { endpoint: ab.endpoint, keys: ab.cles }, donnees: composerMessage(et.attente, now), vapid, fetch: ctx.fetch, maintenant: now });
      if (r.etat === 'ok') { R.notifications++; et.attente = []; et.essais = 0; }
      else if (r.etat === 'supprimer' || r.etat === 'refuse') { await effacerAbonnement(kv, id); supprimes.add(id); R.supprimes++; efface = true; }
      else if (r.etat === 'reessayer') { R.echecsPush++; et.essais = (et.essais || 0) + 1; if (et.essais > ESSAIS_MAX) { et.attente = []; et.essais = 0; } }
      else { R.echecsPush++; et.attente = []; et.essais = 0; }
    }
    if (!efface) {
      if (JSON.stringify(et) !== avant) await kv.put('et:' + id, JSON.stringify(et));
      if (abModifie) await kv.put('ab:' + id, JSON.stringify(ab));
    }
    R.traites++;
    if (res.coupe) { R.arret = 'budget'; break; }
  }

  /* Curseur : la relève suivante reprend au premier abonnement non traité. */
  const ordre = index;
  const restants = supprimes.size ? ordre.filter((x) => !supprimes.has(x)) : ordre;
  if (supprimes.size) await kv.put('index', JSON.stringify(restants));
  let nc = 0;
  for (let k = 0; k < ordre.length && restants.length; k++) {
    const p = restants.indexOf(ordre[(curseur + n + k) % ordre.length]);
    if (p >= 0) { nc = p; break; }
  }
  if (nc !== curseur) await kv.put('curseur', String(nc));
  return R;
}
