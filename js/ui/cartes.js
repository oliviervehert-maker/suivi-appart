/* Liste des biens : cartes complètes au rendu de la liste, puis mises à jour CIBLÉES des
   emplacements réservés (score, raisons, transports, trajets) sans toucher aux champs de saisie. */
import { S } from '../etat.js';
import { esc, fmt, MINUS, ilYA, dateFr, dureeTxt } from '../core/util.js';
import { evaluer, couleurScore, lieuDe } from '../core/score.js';
import { STATUTS } from '../core/fusion.js';
import { choisirItineraire, resumeParMode, NOMS_MODES, ligneDans } from '../core/transports.js';
import { enrPour, refPour, arretsPour } from '../enrichissement.js';

export const LABEL = Object.fromEntries(STATUTS);
const PAS = 30;
let limite = PAS;
let dernierEval = new Map();

export function evalBien(b) {
  const enr = enrPour(b, S.C);
  const e = evaluer(b, S.C, enr);
  dernierEval.set(b.id, e);
  return { b, e, enr };
}

function nomCommune(b) { return String(b.commune || '').replace(/-sur-Seine$/, ''); }
function vignette(u) { return u + (u.indexOf('?') < 0 ? '?' : '&') + 'width=600&height=375&fit=cover'; }

function keepBtn(b) {
  return '<button class="keep" type="button" data-keep="' + esc(b.id) + '" aria-pressed="' + !!b.cote + '">' + (b.cote ? '★ Mis de côté' : '☆ Mettre de côté') + '</button>';
}
function photosHTML(b) {
  const ph = b.photos || [];
  if (!ph.length) return '<div class="photos">' + keepBtn(b) + '<span class="count">' + (b.src === 'manuel' ? 'ajout à la main' : 'sans photo') + '</span></div>';
  return '<div class="photos"><div class="strip">' + ph.map((u, i) =>
    '<button class="ph" type="button" data-ph="' + esc(b.id) + '" data-i="' + i + '" aria-label="Agrandir la photo ' + (i + 1) + '"><img loading="lazy" decoding="async" alt="" referrerpolicy="no-referrer" src="' + esc(vignette(u)) + '"></button>'
  ).join('') + '</div>' + keepBtn(b) + '<span class="count">' + ph.length + ' photo' + (ph.length > 1 ? 's' : '') + '</span></div>';
}
function goneHTML(b) {
  return b.dispo === 'retiree' ? '<div class="gone">Annonce retirée' + (b.retireeLe ? ' le ' + dateFr(b.retireeLe) : '') + ', sans doute louée<span>À confirmer auprès de l’annonceur : un bien revient parfois si le candidat retenu se désiste.</span></div>' : '';
}
function dispoHTML(b) {
  if (b.src === 'manuel') return '<div class="dispo unk"><i></i>Disponibilité non vérifiable (ajout à la main)</div>';
  const off = b.dispo === 'retiree';
  const txt = off ? 'Retirée du site' : b.horsRecherche ? 'Absente de la dernière recherche' : 'En ligne';
  return '<div class="dispo' + (off ? ' off' : b.horsRecherche ? ' unk' : '') + '"><i></i>' + txt + (b.verifLe ? ' · vérifiée ' + ilYA(b.verifLe) : '') + '</div>';
}
function prixHTML(b) {
  const baisse = b.ancienLoyer && b.loyer != null && b.ancienLoyer > b.loyer;
  const cc = b.loyer == null ? '' : b.cc === 'cc' ? '<span class="cc">charges comprises</span>' : '<span class="cc hc">charges non indiquées</span>';
  return '<div class="price"><b>' + fmt(b.loyer) + ' €</b>' +
    (baisse ? '<s class="old">' + fmt(b.ancienLoyer) + ' €</s><span class="badge down">' + MINUS + fmt(b.ancienLoyer - b.loyer) + ' €</span>' : '') + cc +
    (b.loyer && b.surf ? '<span class="m2">' + fmt(b.loyer / b.surf, 1) + ' €/m²</span>' : '') + '</div>';
}
function argentHTML(b) {
  const m = [
    b.charges != null ? 'dont ' + fmt(b.charges) + ' € de charges' : null,
    b.complement ? 'complément de loyer ' + fmt(b.complement) + ' €' : null,
    b.honoraires ? 'honoraires ' + fmt(b.honoraires) + ' €' : null,
    b.depot ? 'dépôt ' + fmt(b.depot) + ' €' : null
  ].filter(Boolean).join(' · ');
  return m ? '<div class="money">' + m + '</div>' : '';
}
function specsHTML(b) {
  const etage = b.etage == null ? null : (b.etage === 0 ? 'RDC' : b.etage + (b.etage === 1 ? 'er' : 'e') + ' étage') + (b.ascenseur === true ? ', ascenseur' : b.ascenseur === false ? ', sans ascenseur' : '');
  return [b.type === 'house' ? 'Maison' : null, b.surf != null ? fmt(b.surf) + ' m²' : null, b.pieces ? b.pieces + ' pièce' + (b.pieces > 1 ? 's' : '') : null,
    b.ch != null ? b.ch + ' chambre' + (b.ch > 1 ? 's' : '') : null, etage].filter(Boolean).join(' · ');
}
function badgesHTML(b) {
  return (b.nouveau ? '<span class="badge new">Nouveau</span>' : '') +
    (b.ext ? '<span class="badge plus">' + esc(b.extLabel || 'Extérieur') + '</span>' : '') +
    (b.cave ? '<span class="badge plus">Cave</span>' : '') + (b.parking ? '<span class="badge plus">Parking</span>' : '') +
    (b.dpe ? '<span class="badge dpe dpe-' + esc(b.dpe) + '">DPE ' + esc(b.dpe) + '</span>' : '') +
    (b.meuble ? '<span class="badge">Meublé</span>' : '');
}

/* ---------- emplacements mis à jour au fil des calculs ---------- */

export function scoreHTML(e) {
  const col = couleurScore(e.score, e.exclu);
  return '<div class="score" data-slot="score" style="--v:' + e.score + ';--sc:' + col + '"><i>' + e.score + '<small>/100</small></i></div>';
}
export function whyInner(e) {
  return e.why.map((w) => '<span class="' + w[0] + '">' + (w[0] === 'ok' ? '✓ ' : w[0] === 'ko' ? '✕ ' : '• ') + esc(w[1]) + '</span>').join('');
}
function puce(mode, l) {
  const cls = 'ligne ' + mode + (ligneDans(S.C.lignesPreferees, l) ? ' pref' : '') + (ligneDans(S.C.lignesEvitees, l) ? ' evit' : '');
  return '<span class="' + cls + '">' + esc(String(l).replace(/^RER /, '')) + '</span>';
}
export function transportsInner(b) {
  if (b.lat == null) return '<div class="sum meta">Arrêts à proximité : position de l’annonce inconnue</div>';
  const a = arretsPour(b);
  if (a === undefined) return '<div class="sum meta">Arrêts à proximité : calcul en attente</div>';
  if (a === null) return '<div class="sum meta">Arrêts à proximité : non disponibles pour l’instant</div>';
  const res = resumeParMode(a, S.C.marcheMax);
  if (!res.length) return '<div class="sum meta">Aucun arrêt à ≤ ' + S.C.marcheMax + ' min à pied (estimé)</div>';
  const court = res.map((r) => {
    const g = r.plusProche;
    if (r.mode === 'bus') return NOMS_MODES.bus + ' ' + (r.lignes.length ? r.lignes.slice(0, 4).join(', ') + (r.lignes.length > 4 ? '…' : '') : g.nom) + ' · ' + g.min + ' min';
    return NOMS_MODES[r.mode] + ' ' + (g.lignes.length ? g.lignes.join(', ').replace(/RER /g, '') : '') + ' · ' + g.nom + ' · ' + g.min + ' min';
  }).join(' — ');
  const det = res.map((r) => r.groupes.slice(0, r.mode === 'bus' ? 6 : 4).map((g) =>
    '<div class="row"><b>' + NOMS_MODES[r.mode] + '</b>' + (g.lignes.length ? g.lignes.map((l) => puce(r.mode, l)).join('') : '<span class="est">lignes non lues</span>') +
    '<span>' + esc(g.nom) + '</span><span class="m">≈ ' + g.min + ' min</span></div>').join('')).join('');
  const note = 'Minutes à pied estimées : distance à vol d’oiseau × 1,25, à 75 m par minute' +
    (b.precision === 'commune' ? ' ; position de l’annonce approchée au centre de la commune' : typeof b.precision === 'number' && b.precision > 0 ? ' ; position de l’annonce floutée par le portail (≈ ' + b.precision + ' m)' : '') +
    (a.source === 'transitous' ? ' ; lignes lues sur les prochains passages d’un mardi matin' : '') + '.';
  return '<details><summary><span class="t">' + esc(court) + '</span><span class="more">Détail</span></summary><div class="tr-det">' + det + '<span class="est">' + note + '</span></div></details>';
}
export function trajetsInner(b, enr) {
  const D = S.C.destinations.filter((d) => d.lat != null);
  if (!D.length) return '';
  const ref = refPour(S.C);
  return D.map((d) => {
    const lieu = '<span class="lieu">' + esc(d.nom) + '</span>';
    if (b.lat == null) return '<div class="wait">' + lieu + '<b>—</b><span class="via">position inconnue</span></div>';
    const t = enr.trajets[d.id];
    if (!t || t.etat === 'attente') return '<div class="wait">' + lieu + '<b>…</b><span class="via">calcul en attente</span></div>';
    if (t.etat !== 'ok') return '<div class="wait">' + lieu + '<b>—</b><span class="via">non calculé, nouvel essai à l’actualisation</span></div>';
    const c = choisirItineraire(t.opts, d.corrMax);
    if (!c) return '<div class="wait">' + lieu + '<b>—</b><span class="via">aucun itinéraire trouvé</span></div>';
    const over = c.min > d.dureeMax || (d.corrMax != null && c.corresp > d.corrMax);
    let cmp = '';
    const r = ref[d.id];
    if (r && r.etat === 'ok') {
      const rc = choisirItineraire(r.opts, d.corrMax);
      if (rc) {
        const diff = c.min - rc.min;
        cmp = diff === 0 ? ' · comme aujourd’hui' : ' · ' + Math.abs(diff) + ' min de ' + (diff < 0 ? 'moins' : 'plus') + ' qu’aujourd’hui';
      }
    }
    const better = !over && /^ · ([5-9]|\d\d+) min de moins/.test(cmp);
    const cls = over ? (d.importance === 'indispensable' ? 'ko' : 'over') : better ? 'better' : '';
    const via = d.mode === 'transit' ? c.via + (c.corresp ? ' · ' + c.corresp + ' corresp.' : ' · direct') : c.via;
    return '<div class="' + cls + '" title="' + esc(d.nom + ' : ' + c.min + ' min, ' + via + cmp) + '">' + lieu + '<b>≈ ' + dureeTxt(c.min) + '</b><span class="via">' + esc(via + cmp) + '</span></div>';
  }).join('');
}

/* ---------- carte complète ---------- */

export function carteHTML(x) {
  const { b, e, enr } = x;
  const st = b.status || 'nouveau';
  const opts = STATUTS.map((s) => '<option value="' + s[0] + '"' + (s[0] === st ? ' selected' : '') + '>' + s[1] + '</option>').join('');
  const nD = S.C.destinations.filter((d) => d.lat != null).length;
  const visite = st === 'visite' ? '<label class="meta" style="display:flex;gap:6px;align-items:center;margin:0">Visite le <input class="visite-in" type="datetime-local" data-visite="' + esc(b.id) + '" value="' + esc((b.visite && b.visite.le || '').slice(0, 16)) + '"></label>' : '';
  const source = b.src === 'manuel' ? (b.portail || 'Ajout à la main') : 'Bien’ici';
  const lien = b.url ? '<a class="btn" href="' + esc(b.url) + '" target="_blank" rel="noopener noreferrer">Voir l’annonce ↗</a>' : '';
  const ld = lieuDe(b, S.C);
  return '<article class="card' + (e.exclu ? ' out' : '') + (b.dispo === 'retiree' ? ' gone-card' : '') + '" data-id="' + esc(b.id) + '">' + photosHTML(b) + goneHTML(b) +
    '<div class="card-top"><div class="card-main">' +
      '<div class="place"><span class="plaque">' + esc(nomCommune(b) || (ld.lieu && ld.lieu.nom) || 'Commune ?') + '</span>' + (b.quartier ? '<span class="quartier">' + esc(b.quartier) + '</span>' : '') + '<span class="pill st-' + st + '" data-slot="pill">' + LABEL[st] + '</span></div>' +
      '<div class="meta">' + esc(source) + (ilYA(b.publieLe) ? ' · publiée ' + ilYA(b.publieLe) : '') + (b.premierVuLe ? ' · vue ' + ilYA(b.premierVuLe) : '') + '</div>' + dispoHTML(b) +
      prixHTML(b) + argentHTML(b) +
      '<div class="specs">' + esc(specsHTML(b)) + '</div>' +
      '<div class="badges">' + badgesHTML(b) + '</div>' +
      '<div class="tr-slot" data-slot="tr">' + transportsInner(b) + '</div>' +
      (nD ? '<div class="trajets" data-slot="tj" style="min-height:' + (nD * 22) + 'px">' + trajetsInner(b, enr) + '</div>' : '') +
      (b.annonceur ? '<div class="agence">' + esc(b.annonceur) + '</div>' : '') +
    '</div>' + scoreHTML(e) + '</div>' +
    '<div class="why" data-slot="why">' + whyInner(e) + '</div>' +
    (b.description ? '<details class="desc"><summary>Description de l’annonce</summary><p>' + esc(b.description) + '</p></details>' : '') +
    '<div class="card-foot">' +
      '<select class="status" data-id="' + esc(b.id) + '" aria-label="Statut">' + opts + '</select>' + visite +
      '<span class="grow"></span>' + lien +
      '<button class="btn" type="button" data-mail="' + esc(b.id) + '">Préparer le mail</button>' +
      (b.quartier && b.src === 'bienici' ? '<button class="btn quiet" type="button" data-ecarter-q="' + esc(b.id) + '">Écarter ce quartier</button>' : '') +
      (b.src === 'manuel' ? '<button class="btn quiet" type="button" data-suppr="' + esc(b.id) + '">Supprimer</button>' : '') +
      '<input class="note" data-note="' + esc(b.id) + '" placeholder="Note" maxlength="500" value="' + esc(b.notes || '') + '" enterkeyhint="done">' +
    '</div></article>';
}

/* Mise à jour ciblée d'une carte déjà affichée. */
export function majCarte(id) {
  const el = document.querySelector('article.card[data-id="' + CSS.escape(id) + '"]');
  if (!el) return null;
  const b = S.parId.get(id); if (!b) return null;
  const x = evalBien(b);
  el.classList.toggle('out', x.e.exclu);
  const sc = el.querySelector('[data-slot="score"]'); if (sc) sc.outerHTML = scoreHTML(x.e);
  const w = el.querySelector('[data-slot="why"]'); if (w) w.innerHTML = whyInner(x.e);
  const tr = el.querySelector('[data-slot="tr"]');
  if (tr) {
    const ouvert = !!tr.querySelector('details[open]');
    tr.innerHTML = transportsInner(b);
    if (ouvert) { const d = tr.querySelector('details'); if (d) d.open = true; }
  }
  const tj = el.querySelector('[data-slot="tj"]'); if (tj) tj.innerHTML = trajetsInner(b, x.enr);
  const st = b.status || 'nouveau';
  const p = el.querySelector('[data-slot="pill"]'); if (p) { p.className = 'pill st-' + st; p.textContent = LABEL[st]; }
  const k = el.querySelector('[data-keep]'); if (k) { k.setAttribute('aria-pressed', String(!!b.cote)); k.textContent = b.cote ? '★ Mis de côté' : '☆ Mettre de côté'; }
  return x;
}

/* ---------- liste ---------- */

function filtrer(ev, f) {
  if (f === 'tous') return ev;
  if (f === 'pistes') return ev.filter((x) => !x.e.exclu);
  if (f === 'nouveaux') return ev.filter((x) => x.b.nouveau && !x.e.exclu);
  if (f === 'cote') return ev.filter((x) => x.b.cote);
  return ev.filter((x) => (x.b.status || 'nouveau') === f);
}
function trajetPremier(x) {
  const d = S.C.destinations.find((y) => y.lat != null); if (!d) return 9e9;
  const t = x.enr.trajets[d.id]; const c = t && t.etat === 'ok' ? choisirItineraire(t.opts, d.corrMax) : null;
  return c ? c.min : 9e9;
}
function trier(list, tri) {
  return list.sort((a, c) => {
    if (tri === 'recent') return String(c.b.publieLe || c.b.premierVuLe || '').localeCompare(String(a.b.publieLe || a.b.premierVuLe || ''));
    if (tri === 'prix') return (a.b.loyer ?? 9e9) - (c.b.loyer ?? 9e9);
    if (tri === 'trajet') return trajetPremier(a) - trajetPremier(c) || c.e.score - a.e.score;
    return (a.e.exclu - c.e.exclu) || c.e.score - a.e.score || String(c.b.publieLe || '').localeCompare(String(a.b.publieLe || ''));
  });
}

export function alertes() {
  const a = [];
  for (const b of S.biens) {
    if (!b.cote && ['a_contacter', 'contacte', 'visite', 'dossier'].indexOf(b.status) < 0) continue;
    const vus = b.vus || {};
    if (b.dispo === 'retiree' && !vus.ret) a.push({ id: b.id, k: 'ret', b, cls: 'bad', t: 'Annonce retirée', s: 'Retirée ' + (b.retireeLe ? 'le ' + dateFr(b.retireeLe) + ' ' : '') + 'du site, sans doute louée. À confirmer auprès de l’annonceur.' });
    if (b.ancienLoyer && b.loyer != null && b.ancienLoyer > b.loyer && !vus.px) a.push({ id: b.id, k: 'px', b, cls: 'good', t: 'Loyer en baisse', s: fmt(b.ancienLoyer) + ' → ' + fmt(b.loyer) + ' €' + (b.baisseLe ? ', le ' + dateFr(b.baisseLe) : '') });
  }
  return a;
}

export function rendreEntete(ev) {
  const actifs = ev.filter((x) => !x.e.exclu);
  const k = [
    [actifs.filter((x) => x.b.nouveau).length, 'nouvelles pistes', true],
    [S.biens.filter((b) => b.status === 'a_contacter').length, 'à contacter', false],
    [S.biens.filter((b) => b.status === 'visite').length, 'visite' + (S.biens.filter((b) => b.status === 'visite').length > 1 ? 's' : '') + ' prévue' + (S.biens.filter((b) => b.status === 'visite').length > 1 ? 's' : ''), false],
    [S.biens.filter((b) => b.status === 'dossier').length, 'dossier déposé', false]
  ];
  document.getElementById('kpis').innerHTML = k.map((x) => '<div class="kpi' + (x[2] ? ' hot' : '') + '"><b>' + x[0] + '</b><span>' + x[1] + '</span></div>').join('');
  const al = alertes();
  document.getElementById('alertes').innerHTML = al.length ? '<div class="panel alerts"><h3>Alertes sur les biens suivis</h3><div class="list">' + al.map((x) =>
    '<div class="item"><span class="adot ' + x.cls + '"></span><div class="grow"><div class="t">' + x.t + ' · ' + esc(nomCommune(x.b)) + (x.b.quartier ? ' ' + esc(x.b.quartier) : '') + (x.b.surf ? ', ' + fmt(x.b.surf) + ' m²' : '') + '</div><div class="s">' + esc(x.s) + '</div></div><button class="btn" type="button" data-vu="' + esc(x.id) + '" data-k="' + x.k + '">Vu</button></div>'
  ).join('') + '</div></div>' : '';
  const badge = document.getElementById('badge-new');
  badge.textContent = al.length; badge.hidden = al.length === 0;
  const f = S.reglages.filtre;
  const groupes = [['pistes', 'Pistes', actifs.length], ['nouveaux', 'Nouvelles', actifs.filter((x) => x.b.nouveau).length], ['cote', '★ Mis de côté', S.biens.filter((b) => b.cote).length], ['tous', 'Toutes', ev.length]]
    .concat(STATUTS.filter((s) => s[0] !== 'nouveau').map((s) => [s[0], s[1], S.biens.filter((b) => b.status === s[0]).length]).filter((g) => g[2] > 0 || g[0] === f));
  document.getElementById('chips').innerHTML = groupes.map((g) => '<button class="chip" type="button" data-f="' + g[0] + '" aria-pressed="' + (f === g[0]) + '">' + g[1] + '<span class="n">' + g[2] + '</span></button>').join('');
  document.getElementById('tally').textContent = actifs.length;
  document.getElementById('tally-t').textContent = (actifs.length > 1 ? 'annonces passent' : 'annonce passe') + ' les critères sur ' + S.biens.length;
}

export function toutEvaluer() { return S.biens.map(evalBien); }

/* Annonce à montrer en tête (ouverture depuis une notification) : gardée jusqu'au prochain choix de filtre ou de tri. */
let enTete = null;
export function mettreEnTete(id) {
  enTete = id || null;
  if (!enTete) return false;
  const b = S.parId.get(enTete);
  if (!b) { enTete = null; return false; }
  const x = evalBien(b);
  if (!filtrer([x], S.reglages.filtre).length) S.reglages.filtre = 'tous';
  return true;
}

export function rendreListe(o = {}) {
  if (o.reinitialiser) limite = PAS;
  const ev = toutEvaluer();
  rendreEntete(ev);
  const list = trier(filtrer(ev, S.reglages.filtre), S.reglages.tri);
  if (enTete) { const i = list.findIndex((x) => x.b.id === enTete); if (i > 0) list.unshift(list.splice(i, 1)[0]); }
  const cards = document.getElementById('cards');
  const plus = document.getElementById('more-row');
  if (!S.biens.length) {
    cards.innerHTML = '<div class="panel empty"><b>Aucune annonce pour l’instant</b>' + (S.C.lieux.length ? 'Actualiser pour lancer la recherche.' : 'Choisir d’abord où chercher, dans Critères.') + '</div>';
    plus.hidden = true; return;
  }
  if (!list.length) { cards.innerHTML = '<div class="panel"><p class="meta">Aucune annonce dans ce filtre.</p></div>'; plus.hidden = true; return; }
  cards.innerHTML = list.slice(0, limite).map(carteHTML).join('');
  plus.hidden = list.length <= limite;
  document.getElementById('more').textContent = 'Afficher plus (' + (list.length - limite) + ')';
}
export function afficherPlus() { limite += PAS; rendreListe(); }
