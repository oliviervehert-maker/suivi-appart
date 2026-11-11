/* Relève en direct : état accumulé à partir des VRAIES requêtes (événements de net.js) et des
   étapes signalées par l'actualisation. Sans document ni stockage (testable sous Node) ; rien n'est
   enregistré ni envoyé : tout vit en mémoire et disparaît à la fermeture de l'application.

   Événement de net.js : { t, id, hote, domaine, libelle, duree, recu, echec, etape }
     t       horodatage (ms, Date.now()) de l'envoi ou de la réponse
     id      relie l'envoi et la réponse d'une même requête
     hote    service : 'bienici' | 'transitous' | 'adresse' | 'idfm' | 'alertes'
     duree   absente à l'envoi ; durée mesurée (ms) à la réponse ou à l'échec
     recu    { n, unite, total?, pages?, n2?, unite2?, texte? } à la réponse
     echec   texte de l'échec, sinon absent
     etape   { type: 'recherche' | 'fiche' | 'arrets' | 'trajets', ... } ou absent (hors relève) */

export const SERVICES = ['bienici', 'transitous', 'adresse', 'idfm'];
export const NOMS_SERVICES = {
  bienici: 'Bien’ici', transitous: 'Transitous', adresse: 'Adresse', idfm: 'Île-de-France Mobilités', alertes: 'Serveur d’alertes'
};
/* Requêtes qui font partie d'une relève (les suggestions et la recherche d'adresse n'en font pas partie). */
const TYPES_RELEVE = { recherche: true, fiche: true, arrets: true, trajets: true };
export const JOURNAL_MAX = 5;

/* ---------- textes ---------- */
const NBSP = ' ', FINE = ' ';
export function nb(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, FINE); }
const PLURIELS = { lieu: 'lieux', min: 'min', 'au total': 'au total' };
export function pluriel(unite, n) {
  if (!(n > 1)) return unite;
  if (PLURIELS[unite]) return PLURIELS[unite];
  return /[sxz]$/.test(unite) ? unite : unite + 's';
}
export function quantite(n, unite) { return nb(n) + NBSP + pluriel(unite, n); }
export function enMs(n) { return nb(n) + NBSP + 'ms'; }
export function texteRecu(r) {
  if (!r) return '';
  if (r.texte) return String(r.texte);
  if (r.n == null || !r.unite) return '';
  let s = quantite(r.n, r.unite);
  if (r.total != null) s += ' sur ' + nb(r.total);
  if (r.n2 != null && r.unite2) s += ' · ' + quantite(r.n2, r.unite2);
  return s;
}
function deux(n) { return (n < 10 ? '0' : '') + n; }
export function heure(ms) { const d = new Date(ms); return deux(d.getHours()) + ':' + deux(d.getMinutes()) + ':' + deux(d.getSeconds()); }
function secondes(ms) { return Math.max(0, Math.round(ms / 1000)); }

function serviceVierge() { return { envois: 0, enVol: 0, dernierMs: null, recu: null, echec: '', aRepondu: false, tReponse: null }; }

/** Fabrique un état indépendant. o.maintenant : horloge (tests). */
export function creerDirect(o = {}) {
  const maintenant = o.maintenant || (() => Date.now());
  const abonnes = new Set();
  const E = { services: {}, vols: new Map(), journal: [], releve: null };
  for (const s of SERVICES) E.services[s] = serviceVierge();
  let numero = 0;

  function notifier(quoi, e) {
    for (const f of [...abonnes]) { try { f(quoi, e); } catch (x) { /* un abonné ne casse jamais l'état */ } }
  }
  function journaliser(j) {
    E.journal.unshift(j);
    if (E.journal.length > JOURNAL_MAX) E.journal.length = JOURNAL_MAX;
  }
  function relEnCours() { return E.releve && E.releve.statut === 'cours' ? E.releve : null; }

  function verifierFin() {
    const R = relEnCours();
    if (!R || !R.rechercheFinie || !R.fileVue || R.fileActive) return;
    R.statut = 'terminee';
    R.fin = maintenant();
    journaliser({
      t: R.fin, service: '', libelle: 'Relève terminée',
      detail: (R.nouvelles == null ? '–' : nb(R.nouvelles)) + ' ' + pluriel('nouvelle', R.nouvelles || 0) + ' · ' + nb(R.lues) + ' ' + pluriel('lue', R.lues),
      duree: null, secondes: secondes(R.fin - R.debut), err: false
    });
    notifier('fin', R);
  }

  function evenement(e) {
    if (!e || e.id == null) return;
    const svc = E.services[e.hote] || null;
    if (e.duree === undefined || e.duree === null) {
      const R = relEnCours();
      const dansReleve = !!(R && e.etape && TYPES_RELEVE[e.etape.type]);
      E.vols.set(e.id, { id: e.id, service: e.hote, libelle: e.libelle || '', depart: e.t, releve: dansReleve ? R.id : 0, etape: e.etape || null });
      if (svc) { svc.envois++; svc.enVol++; }
      if (dansReleve) {
        R.envois++;
        if (e.etape.type === 'recherche') {
          const l = R.lieux[e.etape.lieu];
          if (l && l.statut !== 'erreur') { l.statut = 'cours'; l.page = e.etape.page || l.page; }
        }
        if (e.etape.type === 'arrets') R.arretsPar[e.hote] = (R.arretsPar[e.hote] || 0) + 1;
      }
      notifier('envoi', e);
      return;
    }
    const v = E.vols.get(e.id) || null;
    E.vols.delete(e.id);
    if (svc) {
      if (v) svc.enVol = Math.max(0, svc.enVol - 1);
      svc.dernierMs = e.duree;
      if (e.echec) svc.echec = String(e.echec);
      else { svc.echec = ''; svc.aRepondu = true; svc.recu = e.recu || null; svc.tReponse = e.t; }
    }
    const R = relEnCours();
    if (R && v && v.releve === R.id && v.etape) {
      const et = v.etape;
      if (et.type === 'recherche') {
        const l = R.lieux[et.lieu];
        if (l) {
          if (e.echec) l.statut = 'erreur';
          else if (e.recu) {
            const n = Number(e.recu.n) || 0;
            l.lues += n; R.lues += n;
            if (e.recu.pages != null) l.pages = e.recu.pages;
            l.page = et.page || l.page;
          }
        }
      } else if (et.type === 'fiche') R.suivis.fait++;
    }
    journaliser({ t: e.t, service: e.hote, libelle: e.libelle || '', detail: e.echec ? String(e.echec) : texteRecu(e.recu), duree: e.duree, secondes: null, err: !!e.echec });
    notifier('reponse', e);
  }

  /* Début d'une relève : les lieux sont connus avant le premier envoi. */
  function debutReleve(x = {}) {
    const lieux = (x.lieux || []).map((nom) => ({ nom: String(nom), statut: 'attente', page: 0, pages: null, lues: 0 }));
    numero++;
    /* Seuls le nombre d'envois et le reçu repartent : un service qui a déjà répondu pendant la
       session (test de liaison, suggestion...) reste « joignable », avec sa dernière durée mesurée. */
    for (const s of SERVICES) {
      const p = E.services[s];
      E.services[s] = Object.assign(serviceVierge(), { enVol: p.enVol, dernierMs: p.dernierMs, echec: p.echec, aRepondu: p.aRepondu, tReponse: p.tReponse });
    }
    E.releve = {
      id: numero, debut: maintenant(), fin: null, statut: 'cours', motif: '',
      lieux, destinations: Number(x.destinations) || 0,
      suivis: { fait: 0, total: null }, arrets: { fait: 0, total: null }, trajets: { fait: 0, total: null },
      calcules: 0, lues: 0, nouvelles: null, envois: 0, arretsPar: {},
      rechercheFinie: false, fileVue: false, fileActive: false
    };
    journaliser({ t: E.releve.debut, service: '', libelle: 'Relève démarrée', detail: quantite(lieux.length, 'lieu') + ' · ' + quantite(E.releve.destinations, 'destination'), duree: null, secondes: null, err: false });
    notifier('debut', E.releve);
  }
  /* Fin de l'interrogation d'un lieu (toutes ses pages lues, borne atteinte ou échec). */
  function lieuFini(x = {}) {
    const R = relEnCours(); if (!R) return;
    const l = R.lieux[x.index]; if (!l) return;
    l.statut = x.echec ? 'erreur' : 'ok';
    if (x.lus != null) {
      R.lues += Number(x.lus) - l.lues;
      l.lues = Number(x.lus);
    }
    if (x.pages != null) l.pages = x.pages;
    notifier('etape', R);
  }
  /* Résultat de la fusion : nouvelles annonces, fiches suivies à revérifier. */
  function resultatRecherche(x = {}) {
    const R = relEnCours(); if (!R) return;
    if (x.nouvelles != null) R.nouvelles = Number(x.nouvelles) || 0;
    if (x.aVerifier != null) R.suivis.total = Number(x.aVerifier) || 0;
    notifier('etape', R);
  }
  /* Recherche (et vérification des fiches) finie ; x.echec : relève interrompue. */
  function finRecherche(x = {}) {
    const R = relEnCours(); if (!R) return;
    if (x.echec) {
      R.statut = 'interrompue';
      R.motif = String(x.echec);
      R.fin = maintenant();
      journaliser({ t: R.fin, service: '', libelle: 'Relève interrompue', detail: R.motif, duree: null, secondes: secondes(R.fin - R.debut), err: true });
      notifier('fin', R);
      return;
    }
    R.rechercheFinie = true;
    for (const l of R.lieux) if (l.statut === 'attente') l.statut = 'non';
    notifier('etape', R);
    verifierFin();
  }
  /* État de la file des arrêts et trajets (enrichissement.progres()). Compté seulement après la
     recherche : la file est alors celle de cette relève. */
  function file(p) {
    const R = relEnCours();
    if (!R || !R.rechercheFinie || !p) return;
    R.fileVue = true;
    R.fileActive = !!p.actif;
    if (p.arrets) R.arrets = { fait: Math.min(p.arrets.faits, p.arrets.total), total: p.arrets.total };
    if (p.trajets) { R.trajets = { fait: Math.min(p.trajets.faits, p.trajets.total), total: p.trajets.total }; R.calcules = p.trajets.calcules || 0; }
    notifier('etape', R);
    verifierFin();
  }
  function abonner(f) { abonnes.add(f); return () => { abonnes.delete(f); }; }

  return { etat: () => E, evenement, debutReleve, lieuFini, resultatRecherche, finRecherche, file, abonner };
}

/* ---------- lectures pour l'affichage (pures) ---------- */
export function etatService(s) {
  if (!s) return 'attente';
  if (s.enVol > 0) return 'cours';
  if (s.envois === 0 && !s.aRepondu && !s.echec) return 'attente';
  return s.echec ? 'erreur' : 'ok';
}
export function volsEnCours(E) { return E.vols.size; }

/* Titre d'état : { txt, sec } ; sec change chaque seconde (non annoncé aux lecteurs d'écran). */
export function titreEtat(E, now, derniere, ilYA) {
  const R = E.releve;
  if (R && R.statut === 'cours') return { txt: 'En cours', sec: ' · ' + nb(secondes(now - R.debut)) + NBSP + 's' };
  if (R && R.statut === 'terminee') return { txt: 'Terminée en ' + nb(secondes(R.fin - R.debut)) + NBSP + 's' + (now - R.fin >= 60000 && ilYA ? ' · ' + ilYA(R.fin, now) : ''), sec: '' };
  if (R && R.statut === 'interrompue') return { txt: 'Interrompue' + NBSP + ': ' + R.motif, sec: '' };
  if (derniere && ilYA) return { txt: 'Au repos · dernière relève ' + ilYA(derniere, now), sec: '' };
  return { txt: 'Au repos · aucune relève', sec: '' };
}

export function bilan(E) {
  const R = E.releve;
  if (!R || R.statut === 'cours') return { texte: 'Bilan à la fin de la relève.', fin: false };
  const lues = quantite(R.lues, 'annonce') + ' ' + pluriel('lue', R.lues);
  const echecs = R.lieux.filter((l) => l.statut === 'erreur').length;
  const echecTxt = echecs ? ' · ' + quantite(echecs, 'lieu') + ' en échec' : '';
  if (R.statut === 'interrompue') return { texte: 'Relève interrompue' + NBSP + ': ' + R.motif + '\n' + lues, fin: true, err: true };
  const nouv = R.nouvelles == null ? '–' : nb(R.nouvelles);
  return { texte: 'Relève terminée en ' + nb(secondes(R.fin - R.debut)) + NBSP + 's\n' + nouv + ' ' + pluriel('nouvelle', R.nouvelles || 0) + ' ' + pluriel('annonce', R.nouvelles || 0) + ' · ' + lues + echecTxt, fin: true };
}

/* Rangées d'étapes. lieuxCriteres : noms des lieux des critères (affichés au repos sans relève). */
export function etapes(E, lieuxCriteres = []) {
  const R = E.releve;
  const lignes = [];
  const lieux = R ? R.lieux : lieuxCriteres.map((nom) => ({ nom, statut: 'attente', page: 0, pages: null, lues: 0 }));
  for (const l of lieux) {
    let haut, bas, icone = l.statut;
    if (l.statut === 'attente') { haut = '—'; bas = 'en attente'; }
    else if (l.statut === 'non') { haut = '—'; bas = 'non interrogé'; icone = 'attente'; }
    else {
      haut = 'page ' + nb(l.page || 0) + '/' + (l.pages == null ? '–' : nb(l.pages));
      bas = l.statut === 'erreur' ? 'échec' : (l.lues ? quantite(l.lues, 'annonce') : (l.statut === 'ok' ? quantite(0, 'annonce') : '—'));
    }
    lignes.push({ genre: 'lieu', nom: l.nom, haut, bas, icone });
  }
  const arretsSvc = R && (R.arretsPar.transitous || 0) > (R.arretsPar.idfm || 0) ? 'transitous' : 'idfm';
  const prog = [
    { cle: 'suivis', nom: 'Biens suivis revérifiés', service: 'bienici' },
    { cle: 'arrets', nom: 'Arrêts et lignes', service: arretsSvc },
    { cle: 'trajets', nom: 'Trajets', service: 'transitous' }
  ];
  for (const p of prog) {
    if (!R) { lignes.push({ genre: 'prog', nom: p.nom, service: p.service, n: '–', part: 0, icone: 'attente' }); continue; }
    const s = R[p.cle];
    const fini = s.total !== null && s.fait >= s.total;
    lignes.push({
      genre: 'prog', nom: p.nom, service: p.service,
      n: nb(s.fait) + '/' + (s.total === null ? '–' : nb(s.total)),
      part: s.total ? Math.min(1, s.fait / s.total) : 0,
      icone: fini ? 'ok' : (R.statut === 'cours' && s.total !== null ? 'cours' : 'attente')
    });
  }
  return lignes;
}

export function compteurs(E) {
  const R = E.releve;
  if (!R) return { lues: '–', nouvelles: '–', trajets: '–', envois: '–' };
  return { lues: nb(R.lues), nouvelles: R.nouvelles == null ? '–' : nb(R.nouvelles), trajets: nb(R.calcules), envois: nb(R.envois) };
}

/* Instance de l'application (les tests créent les leurs avec creerDirect). */
export const direct = creerDirect();
