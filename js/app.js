/* Point d'entrée : chargement, actualisation, événements. */
import { APP_NOM, APP_VERSION, RECHERCHE_AUTO_MIN, ALERTES_URL } from './config.js';
import * as store from './store.js';
import { S, ui, charger, definirBiens, bien, modifierBien, remplacerBien, retirerBien, sauverReglages, sauverCriteresMaintenant, definirCriteres } from './etat.js';
import { rechercher, verifierFiche } from './recherche.js';
import { fusionner, appliquerVerif } from './core/fusion.js';
import { criteresNeutres, resumeCriteres } from './core/criteres.js';
import { ilYA, esc } from './core/util.js';
import { chargerCaches, planifier, progres } from './enrichissement.js';
import { rendreListe, rendreEntete, majCarte, carteHTML, evalBien, afficherPlus, toutEvaluer, mettreEnTete } from './ui/cartes.js';
import { rendreCriteres, majResumes, rendreLignes, rendreQuartiers, clic as clicCrit, change as changeCrit, touche as toucheCrit, crochets } from './ui/criteres-ui.js';
import { rendreSuivi, rendreSources, ouvrirMail, copierMail, ouvrirPhotos, ouvrirManuel, exporterTableur, cocherDossier } from './ui/divers.js';
import { exporterDonnees, importerFichier, toutEffacer, donneesAPartager } from './ui/donnees.js';
import { encoderLien, decoderLien, codeDansTexte } from './core/partage.js';
import { ouvrirAccueil, clicAccueil } from './ui/accueil.js';

const $ = (id) => document.getElementById(id);
let ongletCourant = 'biens';
let signatureFaite = null;

/* Alertes par notification : module chargé seulement si ALERTES_URL est renseigné ; sinon aucun appel. */
let alertesUI = null;
function syncAlertes() { if (alertesUI) alertesUI.modifie(); }

/* ---------- en-tête et ligne d'état ---------- */
function signature() {
  const C = S.C;
  return JSON.stringify([C.lieux.map((l) => l.zoneIds.join('+')).sort(), C.types.slice().sort(), C.loyerMax, C.surfMin, C.piecesMin]);
}
function majEntete() {
  const C = S.C;
  const lieux = C.lieux.map((l) => l.nom.replace(/-sur-Seine$/, ''));
  $('sous-titre').textContent = (lieux.length ? lieux.slice(0, 3).join(', ') + (lieux.length > 3 ? ' +' + (lieux.length - 3) : '') : 'Aucun lieu choisi') + (resumeCriteres(C).length ? ' · ' + resumeCriteres(C).join(' · ') : '');
  const cd = $('countdown');
  if (C.sortie) {
    const d = new Date(C.sortie + 'T00:00');
    $('jours').textContent = isNaN(d) ? '—' : Math.max(0, Math.round((d - Date.now()) / 86400000));
    cd.hidden = false;
  } else cd.hidden = true;
  const r = resumeCriteres(C);
  $('crit-resume').innerHTML = '<b>' + esc(r.join(' · ') || 'Critères neutres') + '</b><br>' + esc(C.lieux.map((l) => l.nom + (l.etat === 'voir' ? ' (à voir)' : '')).join(' · ') || 'Aucun lieu choisi') +
    (C.destinations.length ? '<br>' + esc(C.destinations.map((d) => d.nom + ' ≤ ' + d.dureeMax + ' min').join(' · ')) : '');
}

function majRun() {
  const el = $('runline'), btn = $('refresh'), r = S.run;
  el.classList.remove('busy', 'stale', 'err');
  let t;
  if (r.enCours) { el.classList.add('busy'); t = r.texte || 'Recherche en cours…'; btn.disabled = true; btn.textContent = 'En cours…'; }
  else {
    btn.disabled = false;
    btn.textContent = r.erreur ? 'Réessayer' : 'Actualiser';
    if (!S.C.lieux.length) { t = 'Aucun lieu de recherche choisi'; el.classList.add('stale'); btn.textContent = 'Choisir'; }
    else if (r.erreur === 'reseau') { el.classList.add('err'); t = 'Échec réseau' + (r.derniere ? ' · dernière recherche ' + ilYA(r.derniere) : ''); }
    else if (r.erreur === 'partiel') { el.classList.add('stale'); t = 'Recherche incomplète (réseau) · ' + ilYA(r.derniere); }
    else if (!r.derniere) t = 'Aucune recherche pour l’instant';
    else {
      const min = (Date.now() - Date.parse(r.derniere)) / 60000;
      if (min > RECHERCHE_AUTO_MIN) el.classList.add('stale');
      t = 'À jour ' + ilYA(r.derniere) + (r.borneAtteinte ? ' · limite de 300 annonces atteinte' : '') + (navigator.onLine === false ? ' · hors ligne' : '');
    }
  }
  $('runtext').textContent = t;
}
function majProgres() {
  const p = progres(), el = $('enrline');
  const actif = p.actif && p.total > 0;
  el.classList.toggle('idle', !actif);
  if (actif) {
    $('enrtext').textContent = 'Trajets et arrêts : ' + Math.min(p.faits, p.total) + ' / ' + p.total;
    $('enrbar').style.width = Math.round(Math.min(1, p.faits / Math.max(1, p.total)) * 100) + '%';
  }
}

/* ---------- rendu ---------- */
let attenteListe = false;
function demanderListe(o) {
  const a = document.activeElement;
  const cards = $('cards');
  if (a && cards.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) {
    if (attenteListe) return;
    attenteListe = true;
    cards.addEventListener('focusout', function f() {
      setTimeout(() => { if (cards.contains(document.activeElement)) return; cards.removeEventListener('focusout', f); attenteListe = false; rendreListe(o); }, 0);
    });
    return;
  }
  rendreListe(o);
}
function toutRendre(o = {}) {
  majEntete(); majRun(); demanderListe(o);
  if (ongletCourant === 'suivi') rendreSuivi();
  if (ongletCourant === 'sources') rendreSources();
}

let tEntete = null;
function majBiensEnrichis(ids) {
  for (const id of ids) majCarte(id);
  clearTimeout(tEntete);
  tEntete = setTimeout(() => rendreEntete(toutEvaluer()), 1200);
}
function majRef() { document.querySelectorAll('#cards article.card').forEach((el) => majCarte(el.dataset.id)); }

let tPlan = null;
function planifierEnr(o = {}) {
  clearTimeout(tPlan);
  tPlan = setTimeout(() => planifier({ biens: S.biens, C: S.C, majBien: majBiensEnrichis, majProgres, majRef, reessayer: !!o.reessayer }), o.delai ?? 600);
}

/* ---------- actualisation ---------- */
/* Une seule actualisation à la fois ; un second appel attend la même. */
let actualisationEnCours = null;
function actualiser() {
  if (!actualisationEnCours) actualisationEnCours = actualiserInterne().finally(() => { actualisationEnCours = null; });
  return actualisationEnCours;
}
async function actualiserInterne() {
  if (S.run.enCours) return;
  if (!S.C.lieux.length) { allerA('criteres'); return; }
  S.run.enCours = true; S.run.erreur = null; S.run.texte = 'Recherche en cours…'; majRun();
  try {
    const r = await rechercher(S.C, { progres: (p) => { S.run.texte = 'Recherche · ' + p.lieu + (p.page > 1 ? ' · page ' + p.page : '') + (p.annonces ? ' · ' + p.annonces + ' annonces' : ''); majRun(); } });
    if (r.echecs && r.echecs >= S.C.lieux.length) throw new Error('reseau');
    const f = fusionner(S.biens, r.annonces, { premiere: !S.run.derniere && !S.biens.length, complet: r.complet, zonesActives: S.C.lieux.flatMap((l) => l.zoneIds) });
    definirBiens(f.biens);
    await store.enregistrerBiens(f.biens);
    if (f.purges.length) await store.supprimerBiens(f.purges);
    let i = 0;
    for (const id of f.aVerifier) {
      i++;
      S.run.texte = 'Vérification des biens suivis · ' + i + ' / ' + f.aVerifier.length; majRun();
      const b = bien(id); if (!b) continue;
      let v;
      try { v = await verifierFiche(b.bid); } catch (e) { v = { dispo: 'inconnu' }; }
      const m = appliquerVerif(b, v); remplacerBien(m); await store.enregistrerBiens([m]);
    }
    S.run.derniere = new Date().toISOString();
    S.run.nb = r.annonces.length; S.run.parLieu = r.parLieu; S.run.borneAtteinte = r.borneAtteinte;
    S.run.erreur = r.echecs ? 'partiel' : null;
    store.ecrire('derniere', S.run.derniere); store.ecrire('parLieu', r.parLieu); store.ecrire('borne', r.borneAtteinte); store.ecrire('nb', r.annonces.length);
    signatureFaite = signature(); store.ecrire('signature', signatureFaite);
  } catch (e) {
    S.run.erreur = 'reseau';
  }
  S.run.enCours = false; S.run.texte = '';
  toutRendre();
  planifierEnr({ reessayer: true, delai: 50 });
  syncAlertes();
}
ui.toutRendre = toutRendre;
ui.biensModifies = () => { toutRendre(); planifierEnr(); };
let tCrit = null;
ui.critereModifie = () => {
  majEntete(); majRun(); syncAlertes();
  clearTimeout(tCrit);
  tCrit = setTimeout(() => { demanderListe({ reinitialiser: true }); planifierEnr(); }, 300);
};

/* ---------- onglets ---------- */
function allerA(v) {
  const avant = ongletCourant;
  ongletCourant = v;
  document.querySelectorAll('nav.tabs button').forEach((x) => { if (x.dataset.v === v) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current'); });
  ['biens', 'suivi', 'criteres', 'sources'].forEach((k) => { $('v-' + k).hidden = k !== v; });
  S.reglages.onglet = v; sauverReglages();
  if (v === 'suivi') rendreSuivi();
  if (v === 'sources') rendreSources();
  if (v === 'criteres') { rendreLignes(); majResumes(); }
  window.scrollTo(0, 0);
  if (avant === 'criteres' && v !== 'criteres' && S.C.lieux.length && signature() !== signatureFaite) actualiser();
}

/* ---------- événements ---------- */
function fermer(id) { $(id).hidden = true; if (id === 'sheet') $('sheet-body').onclick = null; }

document.addEventListener('click', async (ev) => {
  const t = ev.target.closest('button,[data-close]');
  if (!t) { if (ev.target.id === 'sheet') fermer('sheet'); return; }
  const d = t.dataset;
  if (!$('onb').hidden && clicAccueil(t)) return;
  if (d.close) { fermer(d.close); return; }
  if (d.v) { allerA(d.v); return; }
  if (d.goto) { allerA(d.goto); return; }
  if (t.id === 'refresh') { actualiser(); return; }
  if (d.f) { mettreEnTete(null); S.reglages.filtre = d.f; sauverReglages(); rendreListe({ reinitialiser: true }); return; }
  if (t.id === 'more') { afficherPlus(); return; }
  if (d.keep) { const b = bien(d.keep); if (b) { await modifierBien(b.id, { cote: !b.cote }); majCarte(b.id); rendreEntete(toutEvaluer()); planifierEnr(); syncAlertes(); } return; }
  if (d.vu) { const b = bien(d.vu); if (b) { const vus = Object.assign({}, b.vus || {}); vus[d.k] = true; await modifierBien(b.id, { vus }); rendreEntete(toutEvaluer()); } return; }
  if (d.ph) { ouvrirPhotos(d.ph, Number(d.i)); return; }
  if (d.mail) { ouvrirMail(d.mail); return; }
  if (t.id === 'mail-copy') { copierMail(); return; }
  if (d.ecarterQ) {
    const b = bien(d.ecarterQ); if (!b || !b.quartier) return;
    if (!window.confirm('Écarter le quartier « ' + b.quartier + ' » (' + b.commune + ') ? Réversible dans Critères.')) return;
    S.C.quartiersEcartes.push({ commune: b.commune, quartier: b.quartier }); sauverCriteresMaintenant(); rendreQuartiers(); majResumes();
    rendreListe(); return;
  }
  if (d.suppr) { if (window.confirm('Supprimer cette annonce ajoutée à la main ?')) { await retirerBien(d.suppr); toutRendre(); } return; }
  if (t.id === 'manuel-add') { ouvrirManuel(); return; }
  if (t.id === 'export-xlsx') { exporterTableur(); return; }
  if (t.id === 'data-export') { const r = exporterDonnees(); $('data-msg').textContent = 'Fichier ' + r.nom + ' prêt (' + r.nb + ' bien' + (r.nb > 1 ? 's' : '') + ' suivi' + (r.nb > 1 ? 's' : '') + ').'; return; }
  if (t.id === 'data-import') { $('file-import').click(); return; }
  if (t.id === 'data-partager') { partagerReglages(); return; }
  if (t.id === 'data-coller' || t.id === 'o-coller') { collerLien(); return; }
  if (t.id === 'data-clear') {
    if (!window.confirm('Tout effacer sur cet appareil : critères, annonces, notes, calculs ? Action définitive.')) return;
    if (alertesUI) await alertesUI.couper();
    await toutEffacer();
    S.C = criteresNeutres(); S.reglages = { filtre: 'pistes', tri: 'score', onglet: 'biens', dossier: [], sectionsOuvertes: ['ou'], accueilFait: false };
    S.run = { derniere: null, enCours: false, erreur: null, texte: '', parLieu: [], borneAtteinte: false, nb: 0 };
    signatureFaite = null;
    rendreCriteres(); toutRendre(); allerA('biens');
    ouvrirAccueil(() => { rendreCriteres(); toutRendre(); actualiser(); });
    return;
  }
  if (t.id === 'crit-reset') { if (!window.confirm('Remettre tous les critères à neutre ? Les lieux et les trajets seront retirés.')) return; definirCriteres(criteresNeutres()); rendreCriteres(); toutRendre(); return; }
  clicCrit(t);
});

document.addEventListener('change', async (ev) => {
  const t = ev.target;
  if (t.classList.contains('status') && t.dataset.id) {
    const m = await modifierBien(t.dataset.id, { status: t.value, statusLe: new Date().toISOString() });
    const el = t.closest('article.card');
    if (m && el) el.outerHTML = carteHTML(evalBien(m));
    rendreEntete(toutEvaluer());
    syncAlertes();
    return;
  }
  if (t.id === 'sort') { mettreEnTete(null); S.reglages.tri = t.value; sauverReglages(); rendreListe({ reinitialiser: true }); return; }
  if (t.dataset.note !== undefined) { await modifierBien(t.dataset.note, { notes: t.value.slice(0, 500) }); return; }
  if (t.dataset.visite !== undefined) { await modifierBien(t.dataset.visite, { visite: { le: t.value } }); return; }
  if (t.dataset.dos !== undefined) { cocherDossier(Number(t.dataset.dos), t.checked); return; }
  if (t.id === 'file-import') {
    const f = t.files && t.files[0]; t.value = '';
    if (!f) return;
    await importerTexte(await f.text());
    return;
  }
  changeCrit(t);
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') { fermer('viewer'); fermer('sheet'); return; }
  if (ev.key === 'Enter' && ev.target.dataset && ev.target.dataset.note !== undefined) { ev.target.blur(); return; }
  toucheCrit(ev);
});
window.addEventListener('online', majRun);
window.addEventListener('offline', majRun);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  majRun();
  if (S.C.lieux.length && S.run.derniere && (Date.now() - Date.parse(S.run.derniere)) / 60000 > RECHERCHE_AUTO_MIN && navigator.onLine !== false) actualiser();
});

/* ---------- import (fichier ou lien) et partage par lien ---------- */
let importVu = false;
async function importerTexte(texte) {
  importVu = true;
  const msg = $('data-msg');
  try {
    const r = await importerFichier(texte);
    if (r == null) return false;
    msg.textContent = r;
    $('onb').hidden = true;
    rendreCriteres(); toutRendre({ reinitialiser: true });
    if (S.C.lieux.length && signature() !== signatureFaite) actualiser(); else planifierEnr();
    syncAlertes();
    if (ongletCourant !== 'sources') window.alert(r);
    return true;
  } catch (e) { msg.textContent = e.message || 'Import impossible.'; window.alert(e.message || 'Import impossible.'); return false; }
}
async function importerCode(code) {
  let texte;
  try { texte = await decoderLien(code); } catch (e) { window.alert(e.message || 'Lien non reconnu.'); return false; }
  return importerTexte(texte);
}
/* Lien de réglages ouvert dans le navigateur : le fragment est retiré de l'adresse avant tout. */
async function importerDepuisAdresse() {
  const code = codeDansTexte(location.hash);
  if (!code) return false;
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* adresse laissée telle quelle */ }
  return importerCode(code);
}
window.addEventListener('hashchange', () => { importerDepuisAdresse(); });
function collerLien() {
  const t = window.prompt('Coller ici le lien de réglages reçu');
  if (!t) return;
  const c = codeDansTexte(t);
  if (!c) { window.alert('Lien non reconnu.'); return; }
  importerCode(c);
}
async function partagerReglages() {
  const msg = $('data-msg');
  try {
    const url = location.origin + location.pathname + '#r=' + await encoderLien(donneesAPartager());
    if (navigator.share) {
      try { await navigator.share({ title: APP_NOM, url }); msg.textContent = 'Lien partagé.'; return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    await navigator.clipboard.writeText(url);
    msg.textContent = 'Lien copié.';
  } catch (e) { msg.textContent = 'Partage impossible sur cet appareil : passer par « Exporter ».'; }
}

/* ---------- service worker (coquille hors ligne) ---------- */
function enregistrerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  const avait = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
  const debut = Date.now();
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!avait) return;
    /* Nouvelle version arrivée juste après l'ouverture, sans saisie ni import en cours : elle est prise tout de suite. */
    if (Date.now() - debut < 20000 && !importVu && !document.querySelector('input:focus, textarea:focus, select:focus')) { location.reload(); return; }
    $('version').textContent = APP_NOM + ' : nouvelle version installée, active au prochain lancement.';
  });
}

/* ---------- ouverture d'une annonce (lien ./?b=<id> d'une notification) ---------- */
function idDepuisLien(u) {
  try { const b = new URL(u, location.href).searchParams.get('b'); return b && /^[A-Za-z0-9_.-]{1,120}$/.test(b) ? b : null; } catch (e) { return null; }
}
/* Le paramètre est lu puis retiré de l'adresse avant tout. */
function cibleDansAdresse() {
  const id = idDepuisLien(location.href);
  if (!new URLSearchParams(location.search).has('b')) return null;
  const p = new URLSearchParams(location.search); p.delete('b');
  try { history.replaceState(null, '', location.pathname + (p.toString() ? '?' + p.toString() : '') + location.hash); } catch (e) { /* adresse laissée telle quelle */ }
  return id;
}
async function ouvrirAnnonce(id) {
  if (!id) return;
  $('onb').hidden = true; fermer('sheet'); fermer('viewer');
  allerA('biens');
  if (S.C.lieux.length && navigator.onLine !== false) await actualiser();
  if (mettreEnTete(id)) { sauverReglages(); rendreListe({ reinitialiser: true }); window.scrollTo(0, 0); return; }
  const n = $('notice');
  if (n.hidden) { n.textContent = 'Annonce de la notification introuvable sur cet appareil : sans doute retirée ou hors des critères.'; n.hidden = false; }
}

/* ---------- démarrage ---------- */
async function demarrer() {
  const cible = cibleDansAdresse();
  document.title = APP_NOM;
  $('app-nom').textContent = APP_NOM;
  try { await charger(); } catch (e) { S.memoireSeule = true; }
  if (S.memoireSeule) { const n = $('notice'); n.innerHTML = '<strong>Stockage indisponible.</strong> Les annonces et réglages ne seront pas gardés après fermeture.'; n.hidden = false; }
  store.demanderPersistance();
  try { await chargerCaches(); } catch (e) { /* caches facultatifs */ }
  signatureFaite = store.lire('signature', null);
  S.run.nb = store.lire('nb', 0);
  $('sort').value = S.reglages.tri || 'score';
  if (ALERTES_URL) {
    try { alertesUI = await import('./ui/alertes-ui.js'); alertesUI.init(); crochets.alertes = alertesUI; } catch (e) { alertesUI = null; crochets.alertes = null; }
  }
  rendreCriteres();
  toutRendre({ reinitialiser: true });
  allerA(['biens', 'suivi', 'criteres', 'sources'].indexOf(S.reglages.onglet) >= 0 ? S.reglages.onglet : 'biens');
  $('version').textContent = APP_NOM + ' ' + APP_VERSION;
  enregistrerSW();
  setInterval(() => { majRun(); if (alertesUI) alertesUI.maj(); }, 30000);
  if (alertesUI) {
    alertesUI.demarrage();
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (ev) => {
      const d = ev.data || {};
      if (d.type === 'ouvrir') { const id = idDepuisLien(d.u || './'); if (id) ouvrirAnnonce(id); else { allerA('biens'); if (S.C.lieux.length) actualiser(); } }
      if (d.type === 'abonnement-change') alertesUI.syncMaintenant(true);
    });
  }
  if (await importerDepuisAdresse()) return;
  if (cible) { ouvrirAnnonce(cible); return; }
  if (!S.reglages.accueilFait && !S.C.lieux.length && !S.biens.length) {
    ouvrirAccueil(() => { rendreCriteres(); toutRendre({ reinitialiser: true }); actualiser(); });
    return;
  }
  const vieux = !S.run.derniere || (Date.now() - Date.parse(S.run.derniere)) / 60000 > RECHERCHE_AUTO_MIN;
  if (S.C.lieux.length && vieux && navigator.onLine !== false) actualiser();
  else planifierEnr({ delai: 200 });
}
demarrer();
