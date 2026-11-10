/* Alertes par notification : inscription de cet appareil auprès du serveur d'alertes (facultatif).
   Rien ne s'exécute tant que ALERTES_URL est vide : chaque fonction publique s'arrête d'abord.
   Ce qui part vers le serveur est construit par rechercheAlerte / suivisAlerte (core/alertes.js, testées). */
import { ALERTES_URL } from './config.js';
import * as store from './store.js';
import { S } from './etat.js';
import { envoyerJSON, ErreurReseau } from './net.js';
import { rechercheAlerte, suivisAlerte, zonesDe, heureValide, SILENCE_DEFAUT, DECLENCHEURS_DEFAUT, MAX_ZONES } from './core/alertes.js';

const CLE = 'alertes';
const BASE_SW = 'suivi-appart-alertes';
const ANTI_REBOND = 5000;

/* État local : réglages gardés sur l'appareil, erreurs en mémoire seulement. */
export const A = {
  actif: false, jeton: null, endpoint: null, cle: null,
  silenceActif: true, silence: Object.assign({}, SILENCE_DEFAUT), declencheurs: Object.assign({}, DECLENCHEURS_DEFAUT),
  derniereSync: null, signature: null,
  erreur: null, message: '', enCours: false
};

let ecouteur = () => {};
export function surChangement(f) { ecouteur = typeof f === 'function' ? f : () => {}; }
function notifier() { try { ecouteur(A); } catch (e) { /* affichage seulement */ } }

export function disponible() { return !!ALERTES_URL; }

export function charger() {
  if (!ALERTES_URL) return A;
  const s = store.lire(CLE, null);
  if (s && typeof s === 'object') {
    A.actif = s.actif === true;
    A.jeton = typeof s.jeton === 'string' ? s.jeton : null;
    A.endpoint = typeof s.endpoint === 'string' ? s.endpoint : null;
    A.cle = typeof s.cle === 'string' ? s.cle : null;
    A.silenceActif = s.silenceActif !== false;
    if (s.silence && heureValide(s.silence.debut) && heureValide(s.silence.fin)) A.silence = { debut: s.silence.debut, fin: s.silence.fin };
    if (s.declencheurs) for (const k of Object.keys(DECLENCHEURS_DEFAUT)) if (typeof s.declencheurs[k] === 'boolean') A.declencheurs[k] = s.declencheurs[k];
    A.derniereSync = typeof s.derniereSync === 'number' ? s.derniereSync : null;
    A.signature = typeof s.signature === 'string' ? s.signature : null;
  }
  return A;
}
function sauver() {
  store.ecrire(CLE, { actif: A.actif, jeton: A.jeton, endpoint: A.endpoint, cle: A.cle, silenceActif: A.silenceActif, silence: A.silence, declencheurs: A.declencheurs, derniereSync: A.derniereSync, signature: A.signature });
}

/* ---------- capacités de l'appareil ---------- */
export function estIOS() {
  const n = typeof navigator !== 'undefined' ? navigator : {};
  return /iPad|iPhone|iPod/.test(n.userAgent || '') || (n.platform === 'MacIntel' && n.maxTouchPoints > 1);
}
function ecranAccueil() {
  try { return navigator.standalone === true || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches); } catch (e) { return false; }
}
/** 'indisponible' | 'non_supporte' | 'ios_hors_ecran' | 'refuse' | 'ok' */
export function capacite() {
  if (!ALERTES_URL) return 'indisponible';
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'non_supporte';
  if (estIOS() && !ecranAccueil()) return 'ios_hors_ecran';
  const ok = window.isSecureContext !== false && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!ok) return 'non_supporte';
  if (Notification.permission === 'denied') return 'refuse';
  return 'ok';
}

/* ---------- outils ---------- */
function b64uEnc(o) {
  let s = '';
  for (let i = 0; i < o.length; i++) s += String.fromCharCode(o[i]);
  return btoa(s).split('+').join('-').split('/').join('_').replace(/=+$/, '');
}
function b64uDec(t) {
  const s = String(t).split('-').join('+').split('_').join('/');
  const b = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const o = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i);
  return o;
}
function jetonAleatoire() { return b64uEnc(crypto.getRandomValues(new Uint8Array(32))); }
function memeCle(sub, cle) {
  const k = sub && sub.options && sub.options.applicationServerKey;
  if (!k) return true;
  const a = new Uint8Array(k);
  return a.length === cle.length && a.every((x, i) => x === cle[i]);
}

/* Corps envoyé au serveur : uniquement ces six champs. */
export function corpsAbonnement(sub) {
  const j = sub && typeof sub.toJSON === 'function' ? sub.toJSON() : sub;
  return {
    abonnement: { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } },
    jeton: A.jeton,
    recherche: rechercheAlerte(S.C),
    suivis: suivisAlerte(S.biens),
    silence: A.silenceActif ? { debut: A.silence.debut, fin: A.silence.fin } : null,
    declencheurs: Object.assign({}, A.declencheurs)
  };
}
function signer(c) { return JSON.stringify([c.abonnement.endpoint, c.recherche, c.suivis, c.silence, c.declencheurs]); }

/* Copie pour le service worker (réinscription si le navigateur change l'adresse de notification). */
function base() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open(BASE_SW, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv'); };
    r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
  });
}
async function ecrireCopie(valeur) {
  try {
    if (typeof indexedDB === 'undefined') return;
    const db = await base();
    await new Promise((ok) => { const t = db.transaction('kv', 'readwrite'); if (valeur) t.objectStore('kv').put(valeur, 'envoi'); else t.objectStore('kv').delete('envoi'); t.oncomplete = ok; t.onerror = ok; t.onabort = ok; });
    db.close();
  } catch (e) { /* facultatif */ }
}

/* ---------- échanges avec le serveur ---------- */
async function cleServeur() {
  const r = await envoyerJSON(ALERTES_URL + '/cle', 'GET');
  if (r.statut !== 200 || !r.corps || typeof r.corps.publique !== 'string') throw new ErreurReseau('Clé indisponible', 'http', r.statut);
  A.cle = r.corps.publique;
  return b64uDec(A.cle);
}

let tRelance = null;
async function envoyer(sub, force) {
  const c = corpsAbonnement(sub);
  const zones = zonesDe(c.recherche);
  if (!zones.length) { A.erreur = 'sans_lieu'; return A.erreur; }
  if (zones.length > MAX_ZONES) { A.erreur = 'trop_de_zones'; return A.erreur; }
  const sig = signer(c);
  if (!force && sig === A.signature && !A.erreur) return 'ok';
  const r = await envoyerJSON(ALERTES_URL + '/abonnement', 'PUT', c);
  if (r.statut === 200 || r.statut === 201) {
    A.derniereSync = Date.now(); A.signature = sig; A.endpoint = c.abonnement.endpoint; A.erreur = null; A.message = '';
    sauver();
    await ecrireCopie({ url: ALERTES_URL, cle: A.cle, endpoint: A.endpoint, corps: { jeton: c.jeton, recherche: c.recherche, suivis: c.suivis, silence: c.silence, declencheurs: c.declencheurs } });
    return 'ok';
  }
  const msg = r.corps && typeof r.corps.erreur === 'string' ? r.corps.erreur.slice(0, 200) : '';
  if (r.statut === 429) {
    clearTimeout(tRelance);
    tRelance = setTimeout(() => { syncMaintenant(false); }, ((r.reessayerDans || 60) + 1) * 1000);
    return 'attente';
  }
  if (r.statut === 403) { A.erreur = 'jeton'; A.message = msg; return A.erreur; }
  if (r.statut === 503) { A.erreur = 'complet'; A.message = msg; return A.erreur; }
  if (r.statut === 400 || r.statut === 413) { A.erreur = 'refus'; A.message = msg; return A.erreur; }
  A.erreur = 'injoignable'; return A.erreur;
}

/* Activation : à appeler depuis un geste (la demande d'autorisation doit être la première attente). */
export async function activer() {
  if (!ALERTES_URL) return 'indisponible';
  const cap = capacite();
  if (cap !== 'ok') { A.erreur = cap; notifier(); return cap; }
  const permission = Notification.requestPermission();
  A.enCours = true; A.erreur = null; A.message = ''; notifier();
  try {
    const p = await permission;
    if (p !== 'granted') { A.erreur = p === 'denied' ? 'refuse' : 'pas_de_permission'; return A.erreur; }
    const reg = await navigator.serviceWorker.ready;
    const cle = await cleServeur();
    let sub = await reg.pushManager.getSubscription();
    if (sub && (!A.jeton || !memeCle(sub, cle))) { try { await sub.unsubscribe(); } catch (e) { /* rien */ } sub = null; }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cle });
    if (!A.jeton) A.jeton = jetonAleatoire();
    A.actif = true; A.signature = null; sauver();
    return await envoyer(sub, true);
  } catch (e) {
    A.erreur = e instanceof ErreurReseau ? 'injoignable' : 'echec';
    A.message = e && e.message ? String(e.message).slice(0, 160) : '';
    return A.erreur;
  } finally { A.enCours = false; notifier(); }
}

/* Coupure : effacement sur le serveur, puis désabonnement du navigateur. */
export async function desactiver() {
  if (!ALERTES_URL) return 'indisponible';
  A.enCours = true; notifier();
  let sub = null;
  try { if ('serviceWorker' in navigator) { const reg = await navigator.serviceWorker.ready; sub = await reg.pushManager.getSubscription(); } } catch (e) { sub = null; }
  const endpoint = (sub && sub.endpoint) || A.endpoint;
  let serveurOk = true;
  if (endpoint && A.jeton) {
    try { const r = await envoyerJSON(ALERTES_URL + '/abonnement', 'DELETE', { endpoint, jeton: A.jeton }); serveurOk = r.statut === 200 || r.statut === 404; }
    catch (e) { serveurOk = false; }
  }
  if (sub) { try { await sub.unsubscribe(); } catch (e) { /* rien */ } }
  clearTimeout(tSync); clearTimeout(tRelance);
  A.actif = false; A.jeton = null; A.endpoint = null; A.signature = null; A.derniereSync = null;
  A.erreur = serveurOk ? null : 'effacement_differe'; A.message = '';
  sauver(); await ecrireCopie(null);
  A.enCours = false; notifier();
  return serveurOk ? 'ok' : 'effacement_differe';
}

/* Synchronisation : critères, mises de côté ou statuts modifiés (anti-rebond de 5 s), démarrage (forcée). */
let tSync = null, enVol = null, encore = false;
export function synchroniser() {
  if (!ALERTES_URL || !A.actif) return;
  clearTimeout(tSync);
  tSync = setTimeout(() => { syncMaintenant(false); }, ANTI_REBOND);
}
export async function syncMaintenant(force) {
  if (!ALERTES_URL || !A.actif) return 'inactif';
  if (enVol) { encore = true; return enVol; }
  enVol = (async () => {
    try {
      if (capacite() === 'refuse') { A.erreur = 'refuse'; return A.erreur; }
      if (capacite() !== 'ok' || Notification.permission !== 'granted') { A.erreur = 'pas_de_permission'; return A.erreur; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const cle = A.cle ? b64uDec(A.cle) : await cleServeur();
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cle });
        A.signature = null;
      }
      if (A.endpoint && sub.endpoint !== A.endpoint && A.jeton) {
        try { await envoyerJSON(ALERTES_URL + '/abonnement', 'DELETE', { endpoint: A.endpoint, jeton: A.jeton }); } catch (e) { /* l'ancienne inscription expirera */ }
        A.signature = null;
      }
      return await envoyer(sub, !!force);
    } catch (e) {
      A.erreur = e instanceof ErreurReseau ? 'injoignable' : 'echec';
      return A.erreur;
    }
  })();
  notifier();
  try { return await enVol; }
  finally {
    enVol = null; notifier();
    if (encore) { encore = false; synchroniser(); }
  }
}

/* Réglages (déclencheurs, plage de silence) : gardés même alertes coupées. */
export function modifierReglages(patch) {
  if (!ALERTES_URL) return;
  if (patch.declencheurs) for (const k of Object.keys(DECLENCHEURS_DEFAUT)) if (typeof patch.declencheurs[k] === 'boolean') A.declencheurs[k] = patch.declencheurs[k];
  if (typeof patch.silenceActif === 'boolean') A.silenceActif = patch.silenceActif;
  if (patch.silence && heureValide(patch.silence.debut) && heureValide(patch.silence.fin)) A.silence = { debut: patch.silence.debut, fin: patch.silence.fin };
  sauver();
  synchroniser();
  notifier();
}
