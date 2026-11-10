/* Onglet Critères : sections repliables, mises à jour en place (aucun champ en cours de saisie n'est recréé). */
import { S, sauverCriteres, sauverReglages, ui } from '../etat.js';
import { esc, fmt, num, clamp, uid, dureeTxt } from '../core/util.js';
import { EQUIPEMENTS, MODES_ARRET, nettoyerDestination, ligneNorm } from '../core/criteres.js';
import { suggestions } from '../recherche.js';
import { libelleTypeLieu } from '../core/bienici.js';
import { NOMS_MODES } from '../core/transports.js';
import { brancherAdresse } from './adresse.js';
import { arretsPour } from '../enrichissement.js';

const NIV = [['indifferent', 'Indifférent'], ['bonus', 'Bonus'], ['indispensable', 'Indispensable']];
const IMP = [['indispensable', 'Indispensable'], ['important', 'Important'], ['info', 'Pour information']];
const MODE_TXT = { transit: 'transports', walk: 'à pied', bike: 'à vélo' };

function seg(attr, val, opts, cur, cls) {
  return '<span class="seg" role="group">' + opts.map((o) => '<button type="button" class="' + (cls ? o[0] : '') + '" ' + attr + '="' + esc(val) + '" data-e="' + o[0] + '" aria-pressed="' + (cur === o[0]) + '">' + o[1] + '</button>').join('') + '</span>';
}
function stepper(k, step, ph) {
  const v = S.C[k];
  return '<span class="stepper"><button type="button" data-step="' + k + '" data-d="-' + step + '" aria-label="Diminuer">−</button>' +
    '<input id="c-' + k + '" data-num="' + k + '" type="number" inputmode="numeric" placeholder="' + (ph || '—') + '" value="' + (v == null ? '' : v) + '">' +
    '<button type="button" data-step="' + k + '" data-d="' + step + '" aria-label="Augmenter">+</button></span>';
}
function champ(label, em, ctrl) { return '<div class="field"><div class="lbl">' + label + (em ? '<em>' + em + '</em>' : '') + '</div>' + ctrl + '</div>'; }

const SECTIONS = [
  ['ou', 'Où'], ['budget', 'Budget'], ['surface', 'Surface et pièces'], ['logement', 'Logement'],
  ['trajets', 'Trajets du quotidien'], ['transports', 'Transports à proximité'], ['annonceurs', 'Annonceurs'], ['calendrier', 'Calendrier']
];
/* Section « Alertes » : n'existe que si app.js a chargé son module (ALERTES_URL renseigné). */
export const crochets = { alertes: null };
function sections() { return crochets.alertes ? SECTIONS.concat([['alertes', 'Alertes']]) : SECTIONS; }

export function resumeSection(id) {
  const C = S.C;
  if (id === 'ou') return C.lieux.length ? C.lieux.map((l) => l.nom).join(', ') : 'à choisir';
  if (id === 'budget') return C.loyerMax != null ? '≤ ' + fmt(C.loyerMax) + ' €' + (C.loyerIdeal != null ? ', idéal ' + fmt(C.loyerIdeal) + ' €' : '') : 'sans plafond';
  if (id === 'surface') return [C.surfMin != null ? C.surfMin + ' m² min.' : null, C.piecesMin > 1 ? C.piecesMin + ' pièces' : null, C.chMin ? C.chMin + ' ch.' : null].filter(Boolean).join(', ') || 'sans minimum';
  if (id === 'logement') return [C.types.length === 2 ? 'appartement ou maison' : C.types[0] === 'house' ? 'maison' : 'appartement', C.meuble === 'exclu' ? 'non meublé' : C.meuble === 'seulement' ? 'meublé' : null].filter(Boolean).join(', ');
  if (id === 'trajets') return C.destinations.length ? C.destinations.map((d) => d.nom).join(', ') : 'aucun';
  if (id === 'transports') { const m = MODES_ARRET.filter((x) => C.modes[x] === 'indispensable').map((x) => NOMS_MODES[x].toLowerCase()); return (m.length ? m.join(' ou ') + ' indispensable, ' : '') + '≤ ' + C.marcheMax + ' min à pied'; }
  if (id === 'annonceurs') return C.agencesSeulement ? 'professionnels seulement' : 'tous';
  if (id === 'calendrier') return C.sortie ? 'sortie le ' + C.sortie.split('-').reverse().join('/') : 'aucune date';
  if (id === 'alertes' && crochets.alertes) return crochets.alertes.resume();
  return '';
}
export function majResumes() {
  for (const [id] of sections()) { const el = document.querySelector('[data-rs="' + id + '"]'); if (el) el.textContent = resumeSection(id); }
}

function corps(id) {
  const C = S.C;
  if (id === 'ou') return '<div class="field col"><label for="lieu-q" class="lbl">Ajouter une commune<em>Par nom ou code postal, toute la France : commune, arrondissement ou département</em></label>' +
    '<input id="lieu-q" class="txt" type="search" placeholder="Ex. Colombes ou 92700" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search"><div class="sugg" id="lieu-sugg"></div></div>' +
    '<div id="lieux"></div><div class="field col"><div class="lbl">Quartiers écartés<em>Depuis une annonce : « Écarter ce quartier »</em></div><div id="quartiers"></div></div>';
  if (id === 'budget') return champ('Loyer idéal', 'charges comprises, en €', stepper('loyerIdeal', 25)) + champ('Loyer plafond', 'au-delà : annonce écartée', stepper('loyerMax', 25));
  if (id === 'surface') return champ('Surface minimum', 'en m², en dessous : écartée', stepper('surfMin', 1)) + champ('Surface visée', 'en m², à partir de', stepper('surfCible', 1)) +
    champ('Surface maximum', 'en m², au-delà : moins de points', stepper('surfMax', 1)) + champ('Pièces minimum', '3 = T3', stepper('piecesMin', 1, '1')) + champ('Chambres minimum', '', stepper('chMin', 1, '0'));
  if (id === 'logement') {
    const ty = C.types.length === 2 ? 'both' : C.types[0];
    return champ('Type de bien', '', seg('data-types', 'x', [['flat', 'Appartement'], ['house', 'Maison'], ['both', 'Les deux']], ty)) +
      champ('Meublé', '', seg('data-meuble', 'x', [['exclu', 'Exclu'], ['accepte', 'Accepté'], ['seulement', 'Seulement']], C.meuble)) +
      EQUIPEMENTS.map(([k, nom, em]) => champ(nom, em, seg('data-equip', k, NIV, C.equip[k]))).join('') +
      champ('Diagnostic énergie', 'classe la plus basse acceptée', '<select class="status" data-dpe="1" aria-label="Diagnostic énergie">' + [['', 'Indifférent'], ['C', 'C ou mieux'], ['D', 'D ou mieux'], ['E', 'E ou mieux'], ['F', 'F ou mieux']].map((o) => '<option value="' + o[0] + '"' + (C.dpeMax === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>') +
      champ('Rez-de-chaussée', '', seg('data-rdc', 'x', [['indifferent', 'Indifférent'], ['eviter', 'À éviter'], ['exclu', 'Exclu']], C.rdc));
  }
  if (id === 'trajets') return '<div id="dests"></div><div class="field"><button class="btn" type="button" data-dest-add="1">Ajouter une destination</button></div>' +
    '<div class="field col"><label class="lbl" for="actuelle-q">Adresse actuelle<em>Facultatif : chaque trajet affiche l’écart avec aujourd’hui</em></label>' +
    '<div class="addrow"><input id="actuelle-q" class="txt" type="search" autocomplete="off" placeholder="Rue, commune" value="' + esc(C.adresseActuelle ? C.adresseActuelle.label : '') + '">' +
    '<button class="btn" type="button" data-actuelle-x="1"' + (C.adresseActuelle ? '' : ' hidden') + '>Retirer</button></div><div class="sugg" id="actuelle-sugg"></div></div>' +
    '<p class="meta">Horaires réels des transports (Transitous, toute la France), un mardi, arrivée à l’heure indiquée. Durées sans l’attente au départ. « ≈ » : la position d’une annonce est floutée par le portail.</p>';
  if (id === 'transports') return champ('Rayon de marche', 'minutes à pied jusqu’à l’arrêt, 5 à 20', stepper('marcheMax', 1)) +
    MODES_ARRET.map((m) => champ(m === 'train' ? 'RER et train' : NOMS_MODES[m], '', seg('data-mode', m, NIV, C.modes[m]))).join('') +
    '<p class="meta" style="padding:6px 0">Plusieurs modes « Indispensable » : l’un d’eux suffit (ex. métro ou train).</p>' +
    '<div class="field col"><div class="lbl">Lignes préférées<em>Bonus quand l’une d’elles passe à proximité</em></div><div class="tags" id="l-pref"></div>' +
    '<div class="addrow"><input class="txt" id="l-pref-in" type="text" placeholder="Ex. 13, L, RER A" autocomplete="off" enterkeyhint="done"><button class="btn" type="button" data-ligne-add="pref">Ajouter</button></div></div>' +
    '<div class="field col"><div class="lbl">Lignes à éviter<em>Moins de points si elles sont la seule desserte ou si un trajet les emprunte</em></div><div class="tags" id="l-evit"></div>' +
    '<div class="addrow"><input class="txt" id="l-evit-in" type="text" placeholder="Ex. 13" autocomplete="off" enterkeyhint="done"><button class="btn" type="button" data-ligne-add="evit">Ajouter</button></div></div>' +
    '<div class="field col"><div class="lbl">Lignes trouvées autour des annonces<em>Toucher pour ajouter aux préférées</em></div><div class="tags" id="l-sugg"></div></div>' +
    '<p class="meta">Arrêts : Île-de-France Mobilités en Île-de-France, Transitous ailleurs. Minutes à pied estimées : distance à vol d’oiseau × 1,25, à 75 m par minute.</p>';
  if (id === 'annonceurs') return champ('Agences et professionnels seulement', 'annonces de particuliers écartées', '<button class="toggle" type="button" data-bool="agencesSeulement" aria-pressed="' + C.agencesSeulement + '" aria-label="Agences et professionnels seulement"></button>');
  if (id === 'alertes' && crochets.alertes) return crochets.alertes.corps();
  if (id === 'calendrier') return champ('Date de sortie du logement', 'facultatif, compte à rebours en haut', '<span class="row" style="gap:6px"><input type="date" class="visite-in" id="c-sortie" value="' + esc(C.sortie) + '"><button class="x" type="button" data-sortie-x="1">Effacer</button></span>');
  return '';
}

export function rendreCriteres() {
  const ouv = S.reglages.sectionsOuvertes || [];
  document.getElementById('criteres').innerHTML = sections().map(([id, t]) =>
    '<details class="sect" data-sect="' + id + '"' + (ouv.indexOf(id) >= 0 ? ' open' : '') + '><summary><span class="tt">' + t + '</span><span class="rs" data-rs="' + id + '">' + esc(resumeSection(id)) + '</span></summary><div class="body">' + corps(id) + '</div></details>'
  ).join('');
  rendreLieux(); rendreQuartiers(); rendreDestinations(); rendreLignes();
  if (crochets.alertes) crochets.alertes.maj();
  brancherLieux(document.getElementById('lieu-q'), document.getElementById('lieu-sugg'), (l) => { ajouterLieu(l); document.getElementById('lieu-q').value = ''; document.getElementById('lieu-sugg').innerHTML = ''; });
  brancherAdresse(document.getElementById('actuelle-q'), document.getElementById('actuelle-sugg'), (a) => {
    S.C.adresseActuelle = { label: a.label, lat: a.lat, lon: a.lon };
    document.querySelector('[data-actuelle-x]').hidden = false;
    changeCrit('trajets');
  });
  document.querySelectorAll('#criteres details.sect').forEach((d) => d.addEventListener('toggle', () => {
    const o = new Set(S.reglages.sectionsOuvertes || []);
    if (d.open) o.add(d.dataset.sect); else o.delete(d.dataset.sect);
    S.reglages.sectionsOuvertes = [...o]; sauverReglages();
  }));
}

/* Recherche de commune : partagée avec l'accueil. */
export function brancherLieux(input, liste, onChoix) {
  let t = null, n = 0, res = [];
  input.addEventListener('input', () => {
    clearTimeout(t);
    const q = input.value.trim();
    if (q.length < 2) { liste.innerHTML = ''; return; }
    t = setTimeout(async () => {
      const k = ++n;
      try {
        const r = await suggestions(q);
        if (k !== n) return;
        const deja = new Set(S.C.lieux.map((l) => l.zoneIds.join(',')));
        res = r.filter((l) => !deja.has(l.zoneIds.join(','))).slice(0, 8);
        liste.style.width = input.offsetWidth + 'px'; liste.style.left = input.offsetLeft + 'px'; liste.style.top = (input.offsetTop + input.offsetHeight) + 'px';
        liste.innerHTML = res.length ? res.map((l, i) => '<button type="button" data-lieu="' + i + '">' + esc(l.nom) + '<span>' + esc(libelleTypeLieu(l.type) + (l.cp.length ? ' · ' + (l.cp.length > 2 ? l.cp[0] + '…' : l.cp.join(', ')) : '')) + '</span></button>').join('') : '<div class="msg">Aucun lieu trouvé</div>';
      } catch (e) { if (k === n) liste.innerHTML = '<div class="msg">Recherche indisponible (réseau)</div>'; }
    }, 300);
  });
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); if (res[0]) { onChoix(res[0]); res = []; } } });
  liste.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-lieu]'); if (!b) return;
    const l = res[Number(b.dataset.lieu)]; if (l) { onChoix(l); res = []; }
  });
}

export function ajouterLieu(l) {
  if (S.C.lieux.some((x) => x.zoneIds.join(',') === l.zoneIds.join(','))) return;
  S.C.lieux.push({ nom: l.nom, type: l.type, cp: l.cp || [], zoneIds: l.zoneIds, etat: 'oui' });
  rendreLieux(); changeCrit('ou', { recherche: true });
}

export function rendreLieux() {
  const el = document.getElementById('lieux'); if (!el) return;
  el.innerHTML = S.C.lieux.length ? S.C.lieux.map((l, i) =>
    '<div class="lieu-row"><div class="grow">' + esc(l.nom) + '<em>' + esc(libelleTypeLieu(l.type) + (l.cp.length ? ' · ' + (l.cp.length > 3 ? l.cp.slice(0, 3).join(', ') + '…' : l.cp.join(', ')) : '')) + '</em></div>' +
    seg('data-lieu-e', String(i), [['oui', 'Oui'], ['voir', 'À voir']], l.etat, true) + '<button class="x" type="button" data-lieu-x="' + i + '">Retirer</button></div>'
  ).join('') : '<p class="meta" style="padding:8px 0">Aucun lieu choisi.</p>';
}
export function rendreQuartiers() {
  const el = document.getElementById('quartiers'); if (!el) return;
  el.innerHTML = S.C.quartiersEcartes.length ? '<div class="tags">' + S.C.quartiersEcartes.map((q, i) => '<span class="tag">' + esc(q.quartier + (q.commune ? ' · ' + q.commune : '')) + '<button class="x" type="button" data-q-x="' + i + '" aria-label="Rétablir ' + esc(q.quartier) + '">Rétablir</button></span>').join('') + '</div>' : '<p class="meta">Aucun.</p>';
}
export function rendreDestinations() {
  const el = document.getElementById('dests'); if (!el) return;
  el.innerHTML = S.C.destinations.length ? S.C.destinations.map((d) =>
    '<div class="dest"><div class="grow"><b>' + esc(d.nom) + '</b><span>' + esc([d.adresse || 'adresse à préciser', 'arrivée ' + d.heure.replace(':', ' h '), MODE_TXT[d.mode], '≤ ' + dureeTxt(d.dureeMax), d.corrMax != null ? '≤ ' + d.corrMax + ' corresp.' : null, IMP.find((x) => x[0] === d.importance)[1]].filter(Boolean).join(' · ')) + '</span></div>' +
    '<button class="btn" type="button" data-dest-edit="' + esc(d.id) + '">Modifier</button></div>'
  ).join('') : '<p class="meta" style="padding:8px 0">Aucune destination.</p>';
}
function lignesAutour() {
  const n = new Map();
  for (const b of S.biens) {
    const a = arretsPour(b); if (!a) continue;
    for (const g of a.groupes) if (g.mode !== 'bus' && g.min <= S.C.marcheMax) g.lignes.forEach((l) => n.set(l, (n.get(l) || 0) + 1));
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
}
export function rendreLignes() {
  const tag = (l, k, i) => '<span class="tag">' + esc(l) + '<button class="x" type="button" data-ligne-x="' + k + '" data-i="' + i + '" aria-label="Retirer ' + esc(l) + '">✕</button></span>';
  const p = document.getElementById('l-pref'), e = document.getElementById('l-evit'), s = document.getElementById('l-sugg');
  if (p) p.innerHTML = S.C.lignesPreferees.map((l, i) => tag(l, 'pref', i)).join('') || '<span class="meta">Aucune.</span>';
  if (e) e.innerHTML = S.C.lignesEvitees.map((l, i) => tag(l, 'evit', i)).join('') || '<span class="meta">Aucune.</span>';
  if (s) {
    const deja = new Set(S.C.lignesPreferees.concat(S.C.lignesEvitees).map(ligneNorm));
    const l = lignesAutour().filter((x) => !deja.has(ligneNorm(x))).slice(0, 16);
    s.innerHTML = l.length ? l.map((x) => '<button class="tag add" type="button" data-ligne-sugg="' + esc(x) + '">+ ' + esc(x) + '</button>').join('') : '<span class="meta">Apparaissent après le calcul des arrêts.</span>';
  }
}

/* Après chaque modification. o.recherche : les filtres envoyés à Bien'ici changent. */
function changeCrit(section, o = {}) {
  sauverCriteres();
  majResumes();
  ui.critereModifie(o);
}

function ajouterLigne(k, v) {
  const l = ligneNorm(v); if (!l) return;
  const key = k === 'pref' ? 'lignesPreferees' : 'lignesEvitees';
  if (S.C[key].map(ligneNorm).indexOf(l) < 0) S.C[key].push(l);
  rendreLignes(); changeCrit('transports');
}

/* ---------- événements (délégués depuis app.js) ---------- */
export function clic(t) {
  const C = S.C, d = t.dataset;
  if (d.step) {
    const k = d.step, pas = Number(d.d);
    let v = C[k] == null ? (k === 'loyerMax' ? 1500 : k === 'loyerIdeal' ? 1400 : k === 'surfMin' ? 40 : k === 'surfCible' ? 50 : k === 'surfMax' ? 80 : 0) : Number(C[k]) + pas;
    v = borner(k, v);
    C[k] = v; const inp = document.getElementById('c-' + k); if (inp) inp.value = v == null ? '' : v;
    changeCrit(k, { recherche: ['loyerMax', 'surfMin', 'piecesMin'].indexOf(k) >= 0 }); return true;
  }
  if (d.lieuE !== undefined) { const l = C.lieux[Number(d.lieuE)]; if (l) { l.etat = d.e; rendreLieux(); changeCrit('ou'); } return true; }
  if (d.lieuX !== undefined) { C.lieux.splice(Number(d.lieuX), 1); rendreLieux(); changeCrit('ou'); return true; }
  if (d.qX !== undefined) { C.quartiersEcartes.splice(Number(d.qX), 1); rendreQuartiers(); changeCrit('ou'); return true; }
  if (d.types) { C.types = d.e === 'both' ? ['flat', 'house'] : [d.e]; majSeg(t); changeCrit('logement', { recherche: true }); return true; }
  if (d.meuble) { C.meuble = d.e; majSeg(t); changeCrit('logement'); return true; }
  if (d.equip) { C.equip[d.equip] = d.e; majSeg(t); changeCrit('logement'); return true; }
  if (d.rdc) { C.rdc = d.e; majSeg(t); changeCrit('logement'); return true; }
  if (d.mode) { C.modes[d.mode] = d.e; majSeg(t); changeCrit('transports'); return true; }
  if (d.bool) { C[d.bool] = !C[d.bool]; t.setAttribute('aria-pressed', String(C[d.bool])); changeCrit('annonceurs'); return true; }
  if (d.ligneAdd) { const inp = document.getElementById('l-' + d.ligneAdd + '-in'); ajouterLigne(d.ligneAdd, inp.value); inp.value = ''; return true; }
  if (d.ligneSugg) { ajouterLigne('pref', d.ligneSugg); return true; }
  if (d.ligneX) { const key = d.ligneX === 'pref' ? 'lignesPreferees' : 'lignesEvitees'; C[key].splice(Number(d.i), 1); rendreLignes(); changeCrit('transports'); return true; }
  if (d.actuelleX) { C.adresseActuelle = null; document.getElementById('actuelle-q').value = ''; t.hidden = true; changeCrit('trajets'); return true; }
  if (d.sortieX) { C.sortie = ''; document.getElementById('c-sortie').value = ''; changeCrit('calendrier'); return true; }
  if (d.destAdd) { ouvrirDestination(null); return true; }
  if (d.destEdit) { ouvrirDestination(d.destEdit); return true; }
  return false;
}
function majSeg(t) { t.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === t))); }

const BORNES = { loyerIdeal: [0, 100000], loyerMax: [0, 100000], surfMin: [0, 1000], surfCible: [0, 1000], surfMax: [0, 1000], piecesMin: [1, 10], chMin: [0, 8], marcheMax: [5, 20] };
function borner(k, v) {
  if (v == null || isNaN(v)) return ['piecesMin', 'chMin', 'marcheMax'].indexOf(k) >= 0 ? S.C[k] : null;
  const b = BORNES[k] || [0, 1e9];
  return clamp(Math.round(v), b[0], b[1]);
}

export function change(t) {
  if (t.dataset.num) {
    const k = t.dataset.num, v = t.value.trim() === '' ? null : num(t.value);
    S.C[k] = borner(k, v); t.value = S.C[k] == null ? '' : S.C[k];
    changeCrit(k, { recherche: ['loyerMax', 'surfMin', 'piecesMin'].indexOf(k) >= 0 }); return true;
  }
  if (t.dataset.dpe) { S.C.dpeMax = t.value; changeCrit('logement'); return true; }
  if (t.id === 'c-sortie') { S.C.sortie = t.value; changeCrit('calendrier'); return true; }
  return false;
}
export function touche(ev) {
  const t = ev.target;
  if (ev.key === 'Enter' && (t.id === 'l-pref-in' || t.id === 'l-evit-in')) { ev.preventDefault(); ajouterLigne(t.id === 'l-pref-in' ? 'pref' : 'evit', t.value); t.value = ''; return true; }
  return false;
}

/* ---------- feuille « destination » ---------- */
export function ouvrirDestination(id) {
  const d = id ? S.C.destinations.find((x) => x.id === id) : nettoyerDestination({ id: uid('d'), nom: '', dureeMax: 45, heure: '08:30', importance: 'important' });
  if (!d) return;
  const v = Object.assign({}, d);
  document.getElementById('sheet-t').textContent = id ? 'Modifier la destination' : 'Ajouter une destination';
  const corr = [['', 'Indifférent'], ['0', 'Aucune'], ['1', '1 au plus'], ['2', '2 au plus'], ['3', '3 au plus']];
  document.getElementById('sheet-body').innerHTML =
    '<div class="fl"><span>Nom</span><input class="txt" id="d-nom" maxlength="60" placeholder="Ex. Travail, École" value="' + esc(v.nom) + '"></div>' +
    '<div class="fl"><span>Adresse</span><input class="txt" id="d-adr" type="search" autocomplete="off" placeholder="Numéro, rue, commune" value="' + esc(v.adresse) + '" data-lat="' + (v.lat ?? '') + '" data-lon="' + (v.lon ?? '') + '"><div class="sugg" id="d-sugg"></div></div>' +
    '<div class="two"><div class="fl"><span>Arrivée à</span><input class="txt" id="d-heure" type="time" value="' + esc(v.heure) + '"></div>' +
    '<div class="fl"><span>Durée maximale (min)</span><input class="txt" id="d-max" type="number" inputmode="numeric" min="5" max="240" value="' + v.dureeMax + '"></div></div>' +
    '<div class="fl"><span>Mode</span>' + seg('data-dmode', 'x', [['transit', 'Transports en commun'], ['walk', 'À pied'], ['bike', 'À vélo']], v.mode) + '</div>' +
    '<div class="fl"><span>Correspondances</span><select class="txt" id="d-corr">' + corr.map((o) => '<option value="' + o[0] + '"' + (String(v.corrMax ?? '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div>' +
    '<div class="fl"><span>Importance</span>' + seg('data-dimp', 'x', IMP, v.importance) + '<em>Indispensable : au-delà, annonce écartée · Important : moins de points · Pour information : affiché seulement</em></div>' +
    '<p class="err" id="d-err"></p>' +
    '<div class="actions">' + (id ? '<button class="btn danger" type="button" id="d-suppr">Retirer</button><span style="flex:1"></span>' : '') + '<button class="btn" type="button" data-close="sheet">Annuler</button><button class="btn primary" type="button" id="d-ok">Enregistrer</button></div>';
  const adr = document.getElementById('d-adr');
  brancherAdresse(adr, document.getElementById('d-sugg'));
  const sheet = document.getElementById('sheet');
  sheet.hidden = false;
  const body = document.getElementById('sheet-body');
  body.onclick = (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.dmode) { v.mode = b.dataset.e; majSeg(b); }
    else if (b.dataset.dimp) { v.importance = b.dataset.e; majSeg(b); }
    else if (b.id === 'd-suppr') { S.C.destinations = S.C.destinations.filter((x) => x.id !== id); sheet.hidden = true; rendreDestinations(); changeCrit('trajets', { structure: true }); }
    else if (b.id === 'd-ok') {
      const lat = num(adr.dataset.lat), lon = num(adr.dataset.lon);
      const nom = document.getElementById('d-nom').value.trim();
      const err = document.getElementById('d-err');
      if (!nom) { err.textContent = 'Nom à renseigner.'; return; }
      if (lat == null || lon == null) { err.textContent = 'Adresse à choisir dans la liste proposée.'; return; }
      const nd = nettoyerDestination({ id: v.id, nom, adresse: adr.value, lat, lon, heure: document.getElementById('d-heure').value, mode: v.mode,
        dureeMax: document.getElementById('d-max').value, corrMax: document.getElementById('d-corr').value, importance: v.importance });
      const i = S.C.destinations.findIndex((x) => x.id === v.id);
      if (i >= 0) S.C.destinations[i] = nd; else S.C.destinations.push(nd);
      sheet.hidden = true; body.onclick = null;
      rendreDestinations(); changeCrit('trajets', { structure: true });
    }
  };
}
