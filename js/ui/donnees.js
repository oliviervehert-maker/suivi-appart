/* Sauvegarde, import (sauvegarde ou profil de critères), effacement complet. */
import { S, definirCriteres, definirBiens, sauverReglages, remplacerBien } from '../etat.js';
import * as store from '../store.js';
import { lireProfil } from '../core/criteres.js';
import { aDesDonneesUtilisateur, patchUtilisateur, CHAMPS_UTILISATEUR } from '../core/fusion.js';
import { norm } from '../core/util.js';
import { APP_VERSION } from '../config.js';
import { suggestions } from '../recherche.js';
import { geocoder } from './adresse.js';
import { telecharger, dateFichier } from './divers.js';
import { viderMemoire } from '../enrichissement.js';

export function exporterDonnees() {
  const biens = S.biens.filter((b) => aDesDonneesUtilisateur(b) || b.src === 'manuel');
  const o = { type: 'suivi-appart-sauvegarde', version: 1, app: APP_VERSION, exporteLe: new Date().toISOString(), criteres: S.C, reglages: { dossier: S.reglages.dossier || [] }, biens };
  const nom = 'suivi-appart-sauvegarde-' + dateFichier() + '.json';
  telecharger(nom, new Blob([JSON.stringify(o, null, 1)], { type: 'application/json' }));
  return { nom, nb: biens.length };
}

function bienSur(b) {
  if (!b || typeof b !== 'object' || typeof b.id !== 'string' || b.id.length > 200) return null;
  if (!/^(bi-|m-)/.test(b.id)) return null;
  const o = JSON.parse(JSON.stringify(b));
  if (o.url && !/^https?:\/\//.test(o.url)) o.url = '';
  o.photos = (Array.isArray(o.photos) ? o.photos : []).filter((u) => typeof u === 'string' && /^https:\/\/file\.bienici\.com\//.test(u));
  return o;
}

/* Biens d'un fichier : ajoutés, ou fusionnés sans écraser autre chose que les champs de l'utilisateur. */
async function importerBiens(liste) {
  let ajout = 0, maj = 0;
  const aEcrire = [];
  for (const raw of Array.isArray(liste) ? liste : []) {
    const b = bienSur(raw); if (!b) continue;
    const ex = S.parId.get(b.id);
    if (ex) {
      const patch = {}; CHAMPS_UTILISATEUR.forEach((k) => { if (b[k] !== undefined) patch[k] = b[k]; });
      const m = patchUtilisateur(ex, patch); remplacerBien(m); aEcrire.push(m); maj++;
    } else { remplacerBien(b); aEcrire.push(b); ajout++; }
  }
  if (aEcrire.length) await store.enregistrerBiens(aEcrire);
  return { ajout, maj };
}

/* Rend un message de compte rendu. Lève une erreur si le fichier n'est pas reconnu. */
export async function importerFichier(texte) {
  let obj;
  try { obj = JSON.parse(texte); } catch (e) { throw new Error('Fichier illisible (JSON attendu).'); }
  if (!obj || typeof obj !== 'object') throw new Error('Fichier non reconnu.');

  if (obj.type === 'suivi-appart-sauvegarde') {
    if (!window.confirm('Remplacer les critères par ceux de la sauvegarde et y ajouter ses biens suivis ?')) return null;
    definirCriteres(obj.criteres);
    if (obj.reglages && Array.isArray(obj.reglages.dossier)) { S.reglages.dossier = obj.reglages.dossier.map(Boolean); }
    const { ajout, maj } = await importerBiens(obj.biens);
    S.reglages.accueilFait = true; sauverReglages();
    return 'Sauvegarde importée : ' + ajout + ' bien' + (ajout > 1 ? 's' : '') + ' ajouté' + (ajout > 1 ? 's' : '') + ', ' + maj + ' mis à jour.';
  }

  if (obj.type === 'suivi-appart-profil' || obj.criteres) {
    const p = lireProfil(obj);
    const C = p.criteres;
    const manques = [];
    for (const g of p.aGeocoder) {
      try {
        const a = await geocoder(g.q);
        if (!a) { manques.push(g.q); continue; }
        if (g.cible === 'actuelle') C.adresseActuelle = { label: a.label, lat: a.lat, lon: a.lon };
        else { const d = C.destinations.find((x) => x.id === g.id); if (d) { d.lat = a.lat; d.lon = a.lon; d.adresse = a.label; } }
      } catch (e) { manques.push(g.q); }
    }
    for (const l of p.lieuxAChercher) {
      try {
        const r = await suggestions(l.nom);
        const x = r.find((s) => norm(s.nom) === norm(l.nom)) || r[0];
        if (x) C.lieux.push({ nom: x.nom, type: x.type, cp: x.cp, zoneIds: x.zoneIds, etat: l.etat });
        else manques.push(l.nom);
      } catch (e) { manques.push(l.nom); }
    }
    if (S.C.lieux.length || S.C.destinations.length) {
      if (!window.confirm('Remplacer les critères actuels par ceux du profil ?')) return null;
    }
    definirCriteres(C);
    S.reglages.accueilFait = true; sauverReglages();
    const rb = await importerBiens(obj.biens);
    return 'Profil importé.' + (rb.ajout + rb.maj ? ' ' + (rb.ajout + rb.maj) + ' annonces reprises.' : '') + (manques.length ? ' À compléter à la main : ' + manques.join(', ') + '.' : '');
  }
  throw new Error('Fichier non reconnu : ni sauvegarde ni profil.');
}

export async function toutEffacer() {
  await store.toutEffacer();
  viderMemoire();
  definirBiens([]);
}
