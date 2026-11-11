/* Écran « Relève en direct » : rendu de la maquette validée, branché sur l'état de js/direct.js.
   Tout ce qui bouge correspond à une requête réelle (départ, réponse, échec, durée mesurée).
   Écran fermé : aucun rendu, aucune animation ; l'état continue de s'accumuler dans js/direct.js. */
import { SERVICES, NOMS_SERVICES, nb, quantite, enMs, texteRecu, heure, etatService, titreEtat, bilan, etapes, compteurs } from '../direct.js';
import { ilYA } from '../core/util.js';

const GEO = {
  bienici: { cote: 'g', haut: true }, transitous: { cote: 'd', haut: true },
  adresse: { cote: 'g', haut: false }, idfm: { cote: 'd', haut: false }
};
const COULEUR = (s) => 'var(--l-' + s + ')';
const LIBELLES_ETAT = { attente: 'en attente', cours: 'en cours', ok: 'joignable', erreur: 'erreur' };
const LIBELLES_ICONE = { attente: 'en attente', cours: 'en cours', ok: 'terminé', erreur: 'échec' };
const T_ALLER = 420, T_RETOUR = 360, H_PLAN = 150, CAP_L = 136, CAP_H = 48, FRAIS_MS = 1600;
const ICONE = '<svg class="d-ico" viewBox="0 0 22 22" aria-hidden="true" data-etat="attente"><circle class="o" cx="11" cy="11" r="9"></circle><circle class="p" cx="11" cy="11" r="3.5"></circle><path class="v" d="M6.6 11.4l3 3 5.9-6.2"></path><path class="x" d="M7.5 7.5l7 7M14.5 7.5l-7 7"></path></svg><span class="d-sr"></span>';

const $ = (id) => document.getElementById(id);
let D = null, opt = {};
let ouvert = false, pousse = false, focusRetour = null;
let desabonner = null, horloge = 0, raf = 0, observateurTaille = null;
const plan = { largeur: 0, chemins: {}, longueurs: {}, lignes: {}, rames: null, capVol: null };
const rames = new Map();   /* id -> { service, t0, tRep, pRep, echec, el } */
const frais = {};          /* service -> minuteur de la mise en couleur du dernier reçu */
let signatureEtapes = '';
const mouvementReduit = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

/**
 * D : état (js/direct.js). o = { lieux() : noms des lieux des critères, derniere() : ISO de la
 * dernière relève enregistrée, pied : texte de la dernière ligne }.
 */
export function initDirect(etatDirect, o = {}) {
  D = etatDirect; opt = o;
  const p = $('direct-pied');
  if (p && o.pied) p.textContent = o.pied;
  window.addEventListener('popstate', () => { if (ouvert) { pousse = false; fermerVraiment(); } });
}
export function estOuvert() { return ouvert; }

/* ---------- ouverture / fermeture ---------- */
function inerte(oui) {
  document.querySelectorAll('body > header.top, body > main, body > nav.tabs').forEach((el) => {
    if (oui) el.setAttribute('inert', ''); else el.removeAttribute('inert');
  });
}
export function ouvrir() {
  if (ouvert || !D) return;
  ouvert = true;
  focusRetour = $('runopen');
  $('direct').hidden = false;
  document.documentElement.classList.add('direct-ouvert');
  inerte(true);
  try { history.pushState({ releveDirect: true }, '', location.href); pousse = true; } catch (e) { pousse = false; }
  $('direct').scrollTop = 0;
  plan.largeur = 0;
  rames.clear();
  /* Requêtes parties avant l'ouverture : dessinées à l'attente au terminus. */
  for (const v of D.etat().vols.values()) if (GEO[v.service]) rames.set(v.id, { service: v.service, t0: -Infinity, tRep: 0, pRep: 0, echec: false, el: null });
  construirePlan();
  signatureEtapes = '';
  rendreTout();
  desabonner = D.abonner(surChangement);
  horloge = setInterval(rendreEtat, 500);
  if (window.ResizeObserver) { observateurTaille = new ResizeObserver(() => construirePlan()); observateurTaille.observe($('direct-plan')); }
  animer();
  const f = $('direct-fermer'); if (f) f.focus();
}
/* Bouton Fermer, Échap : on retire l'entrée d'historique posée à l'ouverture (popstate ferme). */
export function fermer() {
  if (!ouvert) return;
  if (pousse && history.state && history.state.releveDirect) { history.back(); return; }
  fermerVraiment();
}
function fermerVraiment() {
  if (!ouvert) return;
  ouvert = false; pousse = false;
  if (desabonner) { desabonner(); desabonner = null; }
  clearInterval(horloge); horloge = 0;
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  if (observateurTaille) { observateurTaille.disconnect(); observateurTaille = null; }
  for (const k of Object.keys(frais)) { clearTimeout(frais[k]); delete frais[k]; }
  for (const r of rames.values()) retirerRame(r);
  rames.clear();
  $('direct').hidden = true;
  document.documentElement.classList.remove('direct-ouvert');
  inerte(false);
  if (focusRetour && document.contains(focusRetour)) focusRetour.focus();
}

/* ---------- changements d'état (écran ouvert seulement) ---------- */
function surChangement(quoi, e) {
  if (!ouvert) return;
  if (quoi === 'envoi' && GEO[e.hote]) {
    rames.set(e.id, { service: e.hote, t0: performance.now(), tRep: 0, pRep: 0, echec: false, el: null });
  } else if (quoi === 'reponse' && GEO[e.hote]) {
    const r = rames.get(e.id);
    if (r) { const m = performance.now(); r.tRep = m; r.pRep = sortie(m - r.t0); r.echec = !!e.echec; }
    const n = document.querySelector('#direct .d-term[data-hote="' + e.hote + '"] .d-t-recu');
    if (n) {
      clearTimeout(frais[e.hote]);
      if (e.echec) n.classList.remove('frais');
      else { n.classList.add('frais'); frais[e.hote] = setTimeout(() => { n.classList.remove('frais'); delete frais[e.hote]; }, FRAIS_MS); }
    }
  }
  rendreTout();
  animer();
}

/* ---------- plan ---------- */
/* Espace de noms SVG lu sur l'élément du plan (aucune adresse écrite dans le code). */
function noeud(nom, attrs, parent) {
  const n = document.createElementNS($('direct-plan').namespaceURI, nom);
  for (const k of Object.keys(attrs)) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}
function f(v) { return Math.round(v * 100) / 100; }
function cheminArrondi(pts, r) {
  const p = pts.filter((q, i) => i === 0 || q[0] !== pts[i - 1][0] || q[1] !== pts[i - 1][1]);
  let d = 'M' + f(p[0][0]) + ' ' + f(p[0][1]);
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i - 1], b = p[i], c = p[i + 1];
    const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]), l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const x1 = b[0] - (b[0] - a[0]) / l1 * rr, y1 = b[1] - (b[1] - a[1]) / l1 * rr;
    const x2 = b[0] + (c[0] - b[0]) / l2 * rr, y2 = b[1] + (c[1] - b[1]) / l2 * rr;
    d += ' L' + f(x1) + ' ' + f(y1) + ' Q' + f(b[0]) + ' ' + f(b[1]) + ' ' + f(x2) + ' ' + f(y2);
  }
  const z = p[p.length - 1];
  return d + ' L' + f(z[0]) + ' ' + f(z[1]);
}
function construirePlan() {
  const svg = $('direct-plan');
  if (!svg || !ouvert) return;
  const W = Math.round(svg.getBoundingClientRect().width) || 306;
  if (W === plan.largeur) return;
  plan.largeur = W;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H_PLAN);
  const cx = W / 2, cy = H_PLAN / 2;
  const groupe = noeud('g', {}, svg);
  for (const h of SERVICES) {
    const s = GEO[h];
    const g = noeud('g', { class: 'd-ligne-g', style: '--c:' + COULEUR(h) }, groupe);
    const x0 = s.cote === 'g' ? 20 : W - 20, sx = s.cote === 'g' ? 1 : -1;
    const bord = s.cote === 'g' ? cx - CAP_L / 2 + 6 : cx + CAP_L / 2 - 6;
    const yE = s.haut ? cy - 10 : cy + 10, yT = s.haut ? 0 : H_PLAN;
    const g45 = Math.max(0, Math.min(36, Math.abs(bord - x0) - 16, Math.abs(yE - yT) - 12));
    const pts = [[bord, yE], [x0 + sx * g45, yE], [x0, yE + (s.haut ? -g45 : g45)], [x0, yT]];
    const chemin = noeud('path', { class: 'd-ligne', d: cheminArrondi(pts, 10) }, g);
    noeud('circle', { class: 'd-terminus', cx: x0, cy: s.haut ? -2 : H_PLAN + 2, r: 6 }, g);
    plan.chemins[h] = chemin;
    plan.longueurs[h] = chemin.getTotalLength();
    plan.lignes[h] = g;
  }
  plan.rames = noeud('g', {}, svg);
  noeud('rect', { class: 'd-cap', x: f(cx - CAP_L / 2), y: cy - CAP_H / 2, width: CAP_L, height: CAP_H, rx: CAP_H / 2 }, svg);
  const t1 = noeud('text', { class: 'd-cap-nom', x: f(cx), y: cy - 3, 'text-anchor': 'middle' }, svg);
  t1.textContent = 'Ce téléphone';
  plan.capVol = noeud('text', { class: 'd-cap-vol', x: f(cx), y: cy + 14, 'text-anchor': 'middle' }, svg);
  for (const r of rames.values()) r.el = null;
  rendreServices();
  animer();
}

/* ---------- rames : une par requête en vol ---------- */
function sortie(dt) { const x = Math.min(1, Math.max(0, dt) / T_ALLER); return 1 - (1 - x) * (1 - x); }
function retirerRame(r) { if (r.el && r.el.parentNode) r.el.parentNode.removeChild(r.el); r.el = null; }
function animer() {
  if (!ouvert || raf || !rames.size) return;
  if (mouvementReduit.matches) { for (const [id, r] of rames) { retirerRame(r); if (r.tRep) rames.delete(id); } return; }
  raf = requestAnimationFrame(image);
}
/* Une rame arrivée au terminus y reste immobile jusqu'à la réponse : plus aucune image n'est
   demandée tant que rien ne bouge (la réponse relance l'animation). */
function image(m) {
  raf = 0;
  if (!ouvert) return;
  let bouge = false;
  for (const [id, r] of rames) {
    let p;
    if (r.tRep) {
      const q = Math.min(1, (m - r.tRep) / T_RETOUR);
      if (q >= 1) { retirerRame(r); rames.delete(id); continue; }
      p = r.pRep * (1 - q * q);
      bouge = true;
    } else {
      p = sortie(m - r.t0);
      if (p < 1 || !r.el) bouge = true;
    }
    if (!plan.rames || !plan.chemins[r.service]) continue;
    if (!r.el) r.el = noeud('circle', { class: 'd-rame', r: 5.5, style: '--c:' + COULEUR(r.service) }, plan.rames);
    if (r.echec && r.tRep) r.el.classList.add('echec');
    const pt = plan.chemins[r.service].getPointAtLength(p * plan.longueurs[r.service]);
    r.el.setAttribute('cx', pt.x.toFixed(1));
    r.el.setAttribute('cy', pt.y.toFixed(1));
  }
  if (bouge) animer();
}

/* ---------- rendu ---------- */
function rendreServices() {
  const E = D.etat();
  let enVol = 0;
  for (const h of SERVICES) {
    const s = E.services[h];
    enVol += s.enVol;
    const t = document.querySelector('#direct .d-term[data-hote="' + h + '"]');
    if (!t) continue;
    const e = etatService(s);
    t.classList.toggle('on', s.aRepondu);
    const et = t.querySelector('.d-t-etat');
    et.setAttribute('data-etat', e);
    et.querySelector('span').textContent = LIBELLES_ETAT[e];
    t.querySelector('.d-t-mes').textContent = quantite(s.envois, 'envoi') + ' · ' + (s.dernierMs === null ? '—' : enMs(s.dernierMs));
    const r = t.querySelector('.d-t-recu');
    r.textContent = s.echec || texteRecu(s.recu) || '—';
    r.classList.toggle('err', !!s.echec);
    if (plan.lignes[h]) plan.lignes[h].classList.toggle('on', s.aRepondu);
  }
  if (plan.capVol) plan.capVol.textContent = nb(enVol) + (enVol > 1 ? ' requêtes en cours' : ' requête en cours');
}
function rendreEtat() {
  if (!ouvert) return;
  const t = titreEtat(D.etat(), Date.now(), opt.derniere ? opt.derniere() : null, ilYA);
  const a = $('direct-etat-txt'), b = $('direct-etat-sec');
  if (a.textContent !== t.txt) a.textContent = t.txt;
  if (b.textContent !== t.sec) b.textContent = t.sec;
  const R = D.etat().releve;
  $('direct-actualiser').disabled = !!(R && R.statut === 'cours');
}
function poserIcone(r, e) {
  r.querySelector('.d-ico').setAttribute('data-etat', e);
  r.querySelector('.d-sr').textContent = LIBELLES_ICONE[e] || '';
}
function rendreEtapes() {
  const lignes = etapes(D.etat(), opt.lieux ? opt.lieux() : []);
  const boite = $('direct-etapes');
  const sig = lignes.map((l) => l.genre + '|' + l.nom + '|' + (l.service || '')).join('\n');
  if (sig !== signatureEtapes) {
    signatureEtapes = sig;
    boite.textContent = '';
    for (const l of lignes) {
      const r = document.createElement('div');
      if (l.genre === 'lieu') {
        r.className = 'd-etape';
        r.innerHTML = '<span class="plaque"><span></span></span><span class="d-droite"><b></b><span></span></span>' + ICONE;
        r.querySelector('.plaque span').textContent = l.nom;
      } else {
        r.className = 'd-etape prog';
        r.style.setProperty('--c', COULEUR(l.service));
        r.innerHTML = '<span class="d-p-nom"></span><span class="d-p-n"></span>' + ICONE + '<span class="d-barre"><i></i></span>';
        r.querySelector('.d-p-nom').textContent = l.nom;
      }
      boite.appendChild(r);
    }
  }
  lignes.forEach((l, i) => {
    const r = boite.children[i]; if (!r) return;
    if (l.genre === 'lieu') {
      r.querySelector('.d-droite b').textContent = l.haut;
      r.querySelector('.d-droite span').textContent = l.bas;
    } else {
      r.querySelector('.d-p-n').textContent = l.n;
      r.querySelector('.d-barre i').style.transform = 'scaleX(' + l.part + ')';
    }
    poserIcone(r, l.icone);
  });
}
function rendreCompteurs() {
  const k = compteurs(D.etat());
  $('direct-k-lues').textContent = k.lues;
  $('direct-k-nouv').textContent = k.nouvelles;
  $('direct-k-traj').textContent = k.trajets;
  $('direct-k-env').textContent = k.envois;
}
function rendreJournal() {
  const J = D.etat().journal;
  const lis = $('direct-journal').children;
  for (let i = 0; i < lis.length; i++) {
    const j = J[i], li = lis[i];
    li.className = j ? (j.err ? 'err' : '') : 'vide';
    li.style.setProperty('--c', j && GEO[j.service] ? COULEUR(j.service) : 'transparent');
    li.querySelector('.d-j-a b').textContent = j && j.service ? (NOMS_SERVICES[j.service] || j.service) + ' · ' : '';
    li.querySelector('.d-j-a span').textContent = j ? j.libelle : (i === 0 ? 'Aucun événement' : '');
    li.querySelector('.d-j-b').textContent = j ? heure(j.t) + (j.detail ? ' · ' + j.detail : '') : '';
    li.querySelector('.d-j-ms').textContent = j ? (j.duree != null ? enMs(j.duree) : (j.secondes != null ? nb(j.secondes) + ' s' : '')) : '';
  }
}
function rendreBilan() {
  const b = bilan(D.etat()), el = $('direct-bilan');
  el.textContent = b.texte;
  el.classList.toggle('fin', !!b.fin);
  el.classList.toggle('err', !!b.err);
}
function rendreTout() {
  if (!ouvert) return;
  rendreServices();
  rendreEtat();
  rendreEtapes();
  rendreCompteurs();
  rendreJournal();
  rendreBilan();
}
