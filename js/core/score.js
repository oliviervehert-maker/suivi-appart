/* Score d'une annonce : exclusions nettes (chacune dit pourquoi) + points + raisons en pastilles. Pur. */
import { norm, fmt } from './util.js';
import { choisirItineraire, resumeParMode, arretsDansRayon, ligneDans, NOMS_MODES } from './transports.js';
import { EQUIPEMENTS } from './criteres.js';

const DPE = 'ABCDEFG';

export function lieuDe(b, C) {
  const L = C.lieux || [];
  if (!L.length) return { etat: 'libre', lieu: null };
  let best = null;
  const ids = Array.isArray(b.lieux) ? b.lieux : [];
  const nc = norm(b.commune), cp = String(b.cp || '');
  for (const l of L) {
    let ok = l.zoneIds.some((z) => ids.indexOf(z) >= 0);
    if (!ok && b.src !== 'bienici') ok = (nc && norm(l.nom) === nc) || (cp && l.cp.indexOf(cp) >= 0);
    if (ok && (!best || (best.etat !== 'oui' && l.etat === 'oui'))) best = l;
  }
  if (best) return { etat: best.etat, lieu: best };
  return { etat: b.src !== 'bienici' ? 'inconnu' : 'hors', lieu: null };
}

export function quartierEcarte(b, C) {
  if (!b.quartier) return false;
  const q = norm(b.quartier), c = norm(b.commune);
  return (C.quartiersEcartes || []).some((x) => norm(x.quartier) === q && (!x.commune || norm(x.commune) === c));
}

export function trajetRetenu(t, dest) {
  if (!t || t.etat !== 'ok') return null;
  return choisirItineraire(t.opts, dest.corrMax);
}

/**
 * @param b    bien normalisé (+ champs utilisateur)
 * @param C    critères nettoyés
 * @param enr  { arrets: objet|null|undefined, trajets: { [destId]: {etat, opts} } }
 * @param o    { sansEnrichissement: bool } : ignore trajets et transports (tri de la file d'attente)
 */
export function evaluer(b, C, enr = {}, o = {}) {
  const why = [];
  let s = 0, exclu = false, attente = false;
  const ko = (t) => { exclu = true; why.push(['ko', t]); };

  if (b.dispo === 'retiree') ko('Annonce retirée');
  if (b.status === 'ecarte' || b.status === 'refuse') { exclu = true; why.push(['ko', b.status === 'ecarte' ? 'Écarté' : 'Refusé']); }
  if (C.agencesSeulement && b.pro === false) ko('Particulier');

  const ld = lieuDe(b, C);
  if (ld.etat === 'hors') ko('Hors des lieux retenus');
  else if (ld.etat === 'voir') { s += 10; why.push(['mid', ld.lieu.nom + ' à voir']); }
  else if (ld.etat === 'oui') { s += 20; why.push(['ok', ld.lieu.nom]); }
  else if (ld.etat === 'inconnu') { s += 10; why.push(['mid', 'Lieu à vérifier']); }
  else s += 20;
  if (quartierEcarte(b, C)) ko('Quartier écarté : ' + b.quartier);

  if (C.types && C.types.length && b.type && C.types.indexOf(b.type) < 0) ko(b.type === 'house' ? 'Maison' : 'Appartement');

  if (b.loyer == null) why.push(['mid', 'Loyer inconnu']);
  else if (C.loyerMax != null && b.loyer > C.loyerMax) ko('Loyer > ' + fmt(C.loyerMax) + ' €');
  else if (C.loyerIdeal != null && b.loyer > C.loyerIdeal) { s += 12; why.push(['mid', 'Loyer au-dessus de l’idéal']); }
  else { s += 30; why.push(['ok', 'Loyer']); }
  if (b.loyer != null && b.cc === 'inconnu') why.push(['mid', 'Charges non indiquées']);

  if (b.surf == null) why.push(['mid', 'Surface non indiquée']);
  else if (C.surfMin != null && b.surf < C.surfMin) ko('Moins de ' + C.surfMin + ' m²');
  else if (C.surfCible != null && b.surf < C.surfCible) { s += 10; why.push(['mid', 'Surface juste']); }
  else if (C.surfMax != null && b.surf > C.surfMax) { s += 12; why.push(['mid', 'Plus de ' + C.surfMax + ' m²']); }
  else { s += 20; why.push(['ok', 'Surface']); }

  if (b.pieces != null && b.pieces < (C.piecesMin || 1)) ko('Moins de ' + C.piecesMin + ' pièces');
  if (C.chMin > 0) {
    if (b.ch == null) { s += 2; why.push(['mid', 'Chambres à vérifier']); }
    else if (b.ch < C.chMin) ko('Moins de ' + C.chMin + ' chambre' + (C.chMin > 1 ? 's' : ''));
    else s += 5;
  } else s += 5;

  if (C.meuble === 'exclu' && b.meuble === true) ko('Meublé');
  if (C.meuble === 'seulement' && b.meuble === false) ko('Non meublé');

  for (const [k, nom] of EQUIPEMENTS) {
    const niv = C.equip[k], v = b[k];
    if (niv === 'indifferent') continue;
    const nomv = k === 'ext' ? (b.extLabel || 'Extérieur') : nom;
    if (niv === 'indispensable') {
      if (v === false) ko('Sans ' + nom.toLowerCase());
      else if (v == null) why.push(['mid', nom + ' à vérifier']);
      else { s += 5; why.push(['ok', nomv]); }
    } else if (niv === 'bonus') {
      if (v === true) { s += k === 'ext' ? 8 : 5; why.push(['ok', nomv]); }
      else why.push(['mid', v == null ? nom + ' non précisé' : 'Sans ' + nom.toLowerCase()]);
    }
  }

  if (C.dpeMax) {
    if (!b.dpe) why.push(['mid', 'DPE non indiqué']);
    else if (DPE.indexOf(b.dpe) > DPE.indexOf(C.dpeMax)) ko('DPE ' + b.dpe);
  }
  if (b.etage === 0 && C.rdc === 'exclu') ko('Rez-de-chaussée');
  else if (b.etage === 0 && C.rdc === 'eviter') { s -= 8; why.push(['mid', 'Rez-de-chaussée']); }

  if (!o.sansEnrichissement) {
    const r = transportsScore(b, C, enr.arrets);
    s += r.points; r.why.forEach((w) => { why.push(w); if (w[0] === 'ko') exclu = true; });
    if (r.attente) attente = true;
    const t = trajetsScore(b, C, enr.trajets || {});
    s += t.points; t.why.forEach((w) => { why.push(w); if (w[0] === 'ko') exclu = true; });
    if (t.attente) attente = true;
  }

  const score = exclu ? Math.max(0, Math.min(s, 35)) : Math.max(0, Math.min(100, Math.round(s)));
  return { score, exclu, why, attente };
}

function posImprecise(b) { return b.precision === 'commune' || b.precision === 'inconnue' || (typeof b.precision === 'number' && b.precision > 500); }
function railDans(liste) { return liste.filter((l) => !/^bus\b/i.test(l)); }

export function transportsScore(b, C, arrets) {
  const why = []; let points = 0, attente = false;
  const besoin = Object.keys(C.modes).filter((m) => C.modes[m] !== 'indifferent');
  const lignesOn = C.lignesPreferees.length || C.lignesEvitees.length;
  if (!besoin.length && !lignesOn) return { why, points: 10, attente };
  if (b.lat == null) { why.push(['mid', 'Position inconnue : transports non vérifiés']); return { why, points: 0, attente }; }
  if (arrets === undefined) { attente = true; why.push(['mid', 'Transports en cours de calcul']); return { why, points: 0, attente }; }
  if (arrets === null) { why.push(['mid', 'Transports non calculés']); return { why, points: 0, attente }; }
  if (posImprecise(b)) { why.push(['mid', 'Position approchée à la commune']); return { why, points: 0, attente }; }

  const res = resumeParMode(arrets, C.marcheMax);
  const parMode = {}; res.forEach((r) => { parMode[r.mode] = r; });
  let bonus = 0;
  /* Les modes « indispensables » sont des alternatives : au moins l'un d'eux à distance de marche. */
  const indisp = besoin.filter((m) => C.modes[m] === 'indispensable');
  if (indisp.length) {
    const presents = indisp.filter((m) => parMode[m]).sort((a, c) => parMode[a].plusProche.min - parMode[c].plusProche.min);
    if (!presents.length) why.push(['ko', 'Pas de ' + indisp.map((m) => NOMS_MODES[m].toLowerCase()).join(' ni de ') + ' à ≤ ' + C.marcheMax + ' min']);
    else { bonus += 6; const m = presents[0]; why.push(['ok', NOMS_MODES[m] + ' à ≈ ' + parMode[m].plusProche.min + ' min']); }
  }
  for (const m of besoin) {
    if (C.modes[m] === 'bonus' && parMode[m]) { bonus += 4; why.push(['ok', NOMS_MODES[m] + ' à ≈ ' + parMode[m].plusProche.min + ' min']); }
  }
  if (besoin.length) points += Math.min(10, bonus);
  else points += 10;

  const dans = arretsDansRayon(arrets, C.marcheMax);
  const lignesProches = []; const lignesFer = [];
  dans.forEach((g) => g.lignes.forEach((l) => {
    const lab = g.mode === 'bus' ? 'Bus ' + l : l;
    if (lignesProches.indexOf(lab) < 0) lignesProches.push(lab);
    if (g.mode !== 'bus' && lignesFer.indexOf(l) < 0) lignesFer.push(l);
  }));
  const pref = C.lignesPreferees.filter((p) => (/^bus\b/i.test(p) ? lignesProches.some((l) => /^Bus /.test(l) && ligneDans([p], l)) : lignesFer.some((l) => ligneDans([p], l))));
  if (pref.length) { points += Math.min(10, 5 * pref.length); why.push(['ok', 'Ligne' + (pref.length > 1 ? 's ' : ' ') + pref.join(', ')]); }
  const evit = railDans(C.lignesEvitees);
  if (evit.length && lignesFer.length && lignesFer.every((l) => ligneDans(evit, l))) { points -= 6; why.push(['mid', 'Seulement ' + lignesFer.join(', ') + ' (à éviter)']); }
  return { why, points, attente };
}

export function trajetsScore(b, C, trajets) {
  const why = []; let points = 0, attente = false;
  for (const d of C.destinations) {
    if (d.lat == null) continue;
    const t = trajets[d.id];
    if (b.lat == null) { why.push(['mid', d.nom + ' : position inconnue']); continue; }
    if (!t || t.etat === 'attente') { attente = true; if (d.importance !== 'info') why.push(['mid', d.nom + ' : calcul…']); continue; }
    if (t.etat !== 'ok') { why.push(['mid', d.nom + ' : non calculé']); continue; }
    const c = choisirItineraire(t.opts, d.corrMax);
    if (!c) { why.push(['mid', d.nom + ' : aucun itinéraire']); continue; }
    const trop = c.min > d.dureeMax, tropCorr = d.corrMax != null && c.corresp > d.corrMax;
    const txt = d.nom + ' ≈ ' + c.min + ' min';
    if (trop || tropCorr) {
      const pq = trop ? ' (> ' + d.dureeMax + ')' : ' (' + c.corresp + ' corresp.)';
      if (d.importance === 'indispensable') why.push(['ko', txt + pq]);
      else if (d.importance === 'important') { points -= 10; why.push(['mid', txt + pq]); }
      else why.push(['mid', txt + pq]);
    } else {
      if (d.importance !== 'info') points += 5;
      why.push(['ok', txt]);
    }
    const evit = C.lignesEvitees.filter((x) => (c.lignes || []).some((l) => ligneDans([x], l)));
    if (evit.length) { points -= 3; why.push(['mid', d.nom + ' par ' + evit.join(', ')]); }
  }
  return { why, points, attente };
}

export function couleurScore(v, exclu) {
  if (exclu) return 'var(--muted)';
  return v >= 80 ? 'var(--good)' : v >= 60 ? 'var(--warn)' : 'var(--bad)';
}
