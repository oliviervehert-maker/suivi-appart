/* État de l'application en mémoire et sa sauvegarde sur l'appareil. */
import * as store from './store.js';
import { nettoyerCriteres, criteresNeutres } from './core/criteres.js';
import { patchUtilisateur } from './core/fusion.js';

export const S = {
  C: criteresNeutres(),
  biens: [],
  parId: new Map(),
  reglages: { filtre: 'pistes', tri: 'score', onglet: 'biens', dossier: [], sectionsOuvertes: ['ou'], accueilFait: false },
  run: { derniere: null, enCours: false, erreur: null, texte: '', parLieu: [], borneAtteinte: false, nb: 0 },
  memoireSeule: false
};

/* Points d'accroche remplis par app.js (évite les imports circulaires). */
export const ui = { toutRendre() {}, critereModifie() {}, biensModifies() {} };

export async function charger() {
  const e = await store.ouvrir();
  S.memoireSeule = !e.idb;
  S.C = nettoyerCriteres(store.lire('criteres', null));
  S.reglages = Object.assign({}, S.reglages, store.lire('reglages', {}));
  S.run.derniere = store.lire('derniere', null);
  S.run.parLieu = store.lire('parLieu', []);
  S.run.borneAtteinte = !!store.lire('borne', false);
  definirBiens(await store.tousLesBiens());
  return e;
}

export function definirBiens(liste) {
  S.biens = liste;
  S.parId = new Map(liste.map((b) => [b.id, b]));
}
export function bien(id) { return S.parId.get(id) || null; }

let tCrit = null;
export function sauverCriteres() {
  clearTimeout(tCrit);
  tCrit = setTimeout(() => { store.ecrire('criteres', S.C); }, 250);
}
export function sauverCriteresMaintenant() { clearTimeout(tCrit); store.ecrire('criteres', S.C); }
export function definirCriteres(C) { S.C = nettoyerCriteres(C); sauverCriteresMaintenant(); }

export function sauverReglages() { store.ecrire('reglages', S.reglages); }

/* Modification d'un bien par l'utilisateur (statut, note, mis de côté, visite, vu). */
export async function modifierBien(id, patch) {
  const b = bien(id); if (!b) return null;
  const m = patchUtilisateur(b, patch);
  remplacerBien(m);
  await store.enregistrerBiens([m]);
  return m;
}
export function remplacerBien(m) {
  S.parId.set(m.id, m);
  const i = S.biens.findIndex((x) => x.id === m.id);
  if (i >= 0) S.biens[i] = m; else S.biens.push(m);
}
export async function ajouterBien(b) { remplacerBien(b); await store.enregistrerBiens([b]); }
export async function retirerBien(id) {
  S.parId.delete(id); S.biens = S.biens.filter((x) => x.id !== id);
  await store.supprimerBiens([id]);
}
