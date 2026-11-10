/* Critères de recherche : valeurs neutres d'un nouvel utilisateur, nettoyage d'un import. Pur. */
import { num, clamp, uid, deepCopy } from './util.js';

export const VERSION_CRITERES = 1;

export const NIVEAUX = ['indifferent', 'bonus', 'indispensable'];
export const IMPORTANCES = ['indispensable', 'important', 'info'];
export const MODES_TRAJET = ['transit', 'walk', 'bike'];
export const MODES_ARRET = ['metro', 'train', 'tram', 'bus'];
export const EQUIPEMENTS = [
  ['ext', 'Extérieur', 'balcon, terrasse ou jardin'],
  ['cave', 'Cave', ''],
  ['parking', 'Parking', 'place ou box'],
  ['ascenseur', 'Ascenseur', '']
];

export function criteresNeutres() {
  return {
    v: VERSION_CRITERES,
    lieux: [],
    quartiersEcartes: [],
    types: ['flat', 'house'],
    loyerIdeal: null,
    loyerMax: null,
    surfMin: null,
    surfCible: null,
    surfMax: null,
    piecesMin: 1,
    chMin: 0,
    meuble: 'accepte',
    equip: { ext: 'indifferent', cave: 'indifferent', parking: 'indifferent', ascenseur: 'indifferent' },
    dpeMax: '',
    rdc: 'indifferent',
    agencesSeulement: true,
    sortie: '',
    marcheMax: 10,
    modes: { metro: 'indifferent', train: 'indifferent', tram: 'indifferent', bus: 'indifferent' },
    lignesPreferees: [],
    lignesEvitees: [],
    destinations: [],
    adresseActuelle: null
  };
}

function choix(v, liste, def) { return liste.indexOf(v) >= 0 ? v : def; }
function pos(v) { const n = num(v); return n == null || n < 0 ? null : n; }
function ligneNorm(l) { return String(l || '').trim().toUpperCase().replace(/^LIGNE\s+/, '').replace(/^M[ÉE]TRO\s+/, '').replace(/\s+/g, ' ').slice(0, 20); }
function point(p) {
  if (!p || typeof p !== 'object') return null;
  const lat = num(p.lat), lon = num(p.lon);
  if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { label: String(p.label || p.adresse || '').slice(0, 200), lat, lon };
}

export function nettoyerDestination(d) {
  if (!d || typeof d !== 'object') return null;
  const p = point({ label: d.adresse, lat: d.lat, lon: d.lon });
  return {
    id: String(d.id || uid('d')),
    nom: String(d.nom || 'Destination').slice(0, 60),
    adresse: p ? p.label : String(d.adresse || '').slice(0, 200),
    lat: p ? p.lat : null,
    lon: p ? p.lon : null,
    heure: /^\d{1,2}:\d\d$/.test(d.heure || '') ? d.heure.padStart(5, '0') : '08:30',
    mode: choix(d.mode, MODES_TRAJET, 'transit'),
    dureeMax: clamp(pos(d.dureeMax) ?? 45, 5, 240),
    corrMax: d.corrMax == null || d.corrMax === '' ? null : clamp(Math.round(num(d.corrMax) || 0), 0, 5),
    importance: choix(d.importance, IMPORTANCES, 'important')
  };
}

export function nettoyerLieu(l) {
  if (!l || typeof l !== 'object' || !l.nom) return null;
  const zoneIds = (Array.isArray(l.zoneIds) ? l.zoneIds : []).map(String).filter(Boolean).slice(0, 5);
  return {
    nom: String(l.nom).slice(0, 80),
    type: String(l.type || 'city').slice(0, 30),
    cp: (Array.isArray(l.cp) ? l.cp : []).map(String).slice(0, 10),
    zoneIds,
    etat: choix(l.etat, ['oui', 'voir'], 'oui')
  };
}

/* Accepte un objet partiel ou ancien et rend des critères complets et sûrs. */
export function nettoyerCriteres(src) {
  const C = criteresNeutres();
  if (!src || typeof src !== 'object') return C;
  const s = src;
  C.lieux = (Array.isArray(s.lieux) ? s.lieux : []).map(nettoyerLieu).filter((l) => l && (l.zoneIds.length || l.cp.length)).slice(0, 40);
  C.quartiersEcartes = (Array.isArray(s.quartiersEcartes) ? s.quartiersEcartes : [])
    .filter((q) => q && q.quartier).map((q) => ({ commune: String(q.commune || '').slice(0, 80), quartier: String(q.quartier).slice(0, 80) })).slice(0, 100);
  const types = (Array.isArray(s.types) ? s.types : []).filter((t) => t === 'flat' || t === 'house');
  C.types = types.length ? types : ['flat', 'house'];
  for (const k of ['loyerIdeal', 'loyerMax', 'surfMin', 'surfCible', 'surfMax']) C[k] = pos(s[k]);
  C.piecesMin = clamp(Math.round(pos(s.piecesMin) ?? 1), 1, 10);
  C.chMin = clamp(Math.round(pos(s.chMin) ?? 0), 0, 8);
  C.meuble = choix(s.meuble, ['exclu', 'accepte', 'seulement'], 'accepte');
  for (const [k] of EQUIPEMENTS) C.equip[k] = choix(s.equip && s.equip[k], NIVEAUX, 'indifferent');
  C.dpeMax = /^[A-G]$/.test(s.dpeMax || '') ? s.dpeMax : '';
  C.rdc = choix(s.rdc, ['indifferent', 'eviter', 'exclu'], 'indifferent');
  C.agencesSeulement = s.agencesSeulement !== false;
  C.sortie = /^\d{4}-\d\d-\d\d$/.test(s.sortie || '') ? s.sortie : '';
  C.marcheMax = clamp(Math.round(pos(s.marcheMax) ?? 10), 5, 20);
  for (const m of MODES_ARRET) C.modes[m] = choix(s.modes && s.modes[m], NIVEAUX, 'indifferent');
  C.lignesPreferees = [...new Set((Array.isArray(s.lignesPreferees) ? s.lignesPreferees : []).map(ligneNorm).filter(Boolean))].slice(0, 30);
  C.lignesEvitees = [...new Set((Array.isArray(s.lignesEvitees) ? s.lignesEvitees : []).map(ligneNorm).filter(Boolean))].slice(0, 30);
  C.destinations = (Array.isArray(s.destinations) ? s.destinations : []).map(nettoyerDestination).filter(Boolean).slice(0, 8);
  C.adresseActuelle = point(s.adresseActuelle);
  return C;
}

export { ligneNorm };

/* Profil importable (fichier JSON) : { type:'suivi-appart-profil', criteres:{...}, geocoder:[...] }.
   Les adresses sans coordonnées sont rendues à part pour être géocodées par l'appli. */
export function lireProfil(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Fichier illisible');
  const brut = obj.criteres || obj;
  const C = nettoyerCriteres(brut);
  const aGeocoder = [];
  C.destinations.forEach((d) => { if (d.lat == null && d.adresse) aGeocoder.push({ cible: 'destination', id: d.id, q: d.adresse }); });
  if (!C.adresseActuelle && brut.adresseActuelle && (brut.adresseActuelle.label || brut.adresseActuelle.adresse)) {
    aGeocoder.push({ cible: 'actuelle', q: brut.adresseActuelle.label || brut.adresseActuelle.adresse });
  }
  const lieuxAChercher = [];
  (Array.isArray(brut.lieux) ? brut.lieux : []).forEach((l) => {
    if (l && l.nom && !(Array.isArray(l.zoneIds) && l.zoneIds.length)) lieuxAChercher.push({ nom: String(l.nom), etat: l.etat === 'voir' ? 'voir' : 'oui' });
  });
  return { criteres: C, aGeocoder, lieuxAChercher, copie: deepCopy(brut) };
}

export function resumeCriteres(C) {
  const p = [];
  if (C.piecesMin > 1) p.push(C.piecesMin + ' pièces et +');
  if (C.chMin > 0) p.push(C.chMin + ' ch.');
  if (C.surfMin != null) p.push(C.surfMin + (C.surfMax != null ? '–' + C.surfMax : ' et +') + ' m²');
  if (C.loyerMax != null) p.push('≤ ' + Number(C.loyerMax).toLocaleString('fr-FR') + ' €');
  return p;
}
