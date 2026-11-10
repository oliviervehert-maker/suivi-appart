/* Trajets (Transitous) et arrêts à proximité (IDFM en Île-de-France, Transitous ailleurs). Pur. */
import { distM, minutesAPied, rayonPourMinutes, mardiProchain, isoParis, norm } from './util.js';

export const TRANSITOUS = 'https://api.transitous.org/api/v1/';
export const IDFM_ARRETS = 'https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/arrets-lignes/records';
export const DEPTS_IDF = ['75', '77', '78', '91', '92', '93', '94', '95'];
export const RAYON_ARRETS_MIN = 20;                 /* on lit les arrêts jusqu'à 20 min, le filtre se fait sur l'appareil */
export const PENALITE_CORRESP_MIN = 5;               /* une correspondance « coûte » 5 min au choix d'itinéraire */
export const MARCHE_MAX_VERS_GARE = 15;              /* variante « à pied jusqu'à la gare » si gare à ≤ 15 min */

export function estIDF(dept, cp) {
  const d = String(dept || cp || '').slice(0, 2);
  return DEPTS_IDF.indexOf(d) >= 0;
}

/* ---------- Trajets ---------- */

export function urlTrajet(o) {
  const jour = o.jour || mardiProchain(o.maintenant ? new Date(o.maintenant) : new Date());
  const p = new URLSearchParams();
  p.set('fromPlace', o.de.lat.toFixed(6) + ',' + o.de.lon.toFixed(6));
  p.set('toPlace', o.vers.lat.toFixed(6) + ',' + o.vers.lon.toFixed(6));
  p.set('time', isoParis(jour, o.heure));
  p.set('arriveBy', 'true');
  if (o.mode === 'walk' || o.mode === 'bike') {
    p.set('directModes', o.mode === 'walk' ? 'WALK' : 'BIKE');
    p.set('transitModes', '');
    p.set('maxDirectTime', '10800');
  }
  return TRANSITOUS + 'plan?' + p.toString();
}

export function libelleLigne(leg) {
  const m = String(leg.mode || ''), n = String(leg.routeShortName || '').trim();
  if (m === 'SUBWAY' || m === 'METRO') return 'M' + n;
  if (/RAIL|SUBURBAN/.test(m)) return /^[A-E]$/.test(n) ? 'RER ' + n : (n || 'Train');
  if (m === 'TRAM') return /^T/i.test(n) ? n : 'T' + n;
  if (m === 'BUS' || m === 'COACH') return 'Bus ' + n;
  if (m === 'FERRY') return 'Bateau ' + n;
  return n || m.toLowerCase();
}

/* Réponse /plan -> options résumées (une par itinéraire, plus le trajet direct à pied ou à vélo). */
export function optionsDepuisPlan(rep, mode) {
  const out = [];
  if (!rep || typeof rep !== 'object') return out;
  if (mode === 'walk' || mode === 'bike') {
    for (const d of rep.direct || []) {
      if (!d || !d.duration) continue;
      out.push({ min: Math.round(d.duration / 60), corresp: 0, via: mode === 'walk' ? 'à pied' : 'à vélo', lignes: [] });
    }
    return out;
  }
  for (const it of rep.itineraries || []) {
    if (!it || !it.duration) continue;
    const legs = (it.legs || []).filter((l) => l.mode && l.mode !== 'WALK' && l.mode !== 'BIKE');
    const lignes = legs.map(libelleLigne);
    const l0 = (it.legs || [])[0];
    out.push({
      min: Math.round(it.duration / 60),
      corresp: typeof it.transfers === 'number' ? it.transfers : Math.max(0, legs.length - 1),
      via: lignes.join(' → ') || 'à pied',
      lignes,
      marcheDepart: l0 && l0.mode === 'WALK' ? Math.round((l0.duration || 0) / 60) : 0
    });
  }
  /* Le trajet direct à pied peut être le meilleur pour une destination proche. */
  for (const d of rep.direct || []) {
    if (d && d.duration && (d.legs || []).every((l) => l.mode === 'WALK')) out.push({ min: Math.round(d.duration / 60), corresp: 0, via: 'à pied', lignes: [] });
  }
  return out;
}

/* Même méthode que l'agent d'origine : min(durée + 5 min x correspondances), dans la limite de
   correspondances demandée si un itinéraire la respecte. */
export function choisirItineraire(options, corrMax) {
  const ok = (options || []).filter((o) => o && o.min > 0);
  if (!ok.length) return null;
  const cout = (o) => o.min + PENALITE_CORRESP_MIN * (o.corresp || 0);
  let pool = ok;
  if (corrMax != null) {
    const dans = ok.filter((o) => (o.corresp || 0) <= corrMax);
    if (dans.length) pool = dans;
  }
  return pool.reduce((a, b) => (cout(b) < cout(a) ? b : a));
}

/* Variante « à pied jusqu'à la gare puis depuis la gare » : ajoute la marche estimée. */
export function optionsViaGare(rep, gare) {
  return optionsDepuisPlan(rep, 'transit').map((o) => Object.assign({}, o, {
    min: o.min + gare.min,
    via: 'à pied ' + gare.min + ' min → ' + o.via,
    viaGare: gare.nom
  }));
}

/* La variante « depuis la gare » ne vaut une requête de plus que si le calculateur fait marcher
   nettement plus longtemps que l'estimation jusqu'à la gare la plus proche (accès piéton manqué),
   ou s'il n'a rien trouvé. Économise les requêtes /plan (règlement de Transitous). */
export function varianteGareUtile(options, gare) {
  if (!gare || gare.min < 2) return false;
  const c = choisirItineraire(options);
  if (!c) return true;
  return c.via !== 'à pied' && (c.marcheDepart || 0) > gare.min + 4;
}

export function cleTrajet(lat, lon, dest) {
  return 'tr|' + lat.toFixed(4) + ',' + lon.toFixed(4) + '|' + Number(dest.lat).toFixed(5) + ',' + Number(dest.lon).toFixed(5) + '|' + dest.heure + '|' + dest.mode;
}

/* ---------- Arrêts à proximité ---------- */

const MODE_IDFM = { Metro: 'metro', Funicular: 'metro', RapidTransit: 'train', LocalTrain: 'train', regionalRail: 'train', RailShuttle: 'train', Tramway: 'tram', CableWay: 'tram', Bus: 'bus' };
const MODE_TRANSITOUS = { SUBWAY: 'metro', METRO: 'metro', FUNICULAR: 'metro', TRAM: 'tram', AERIAL_LIFT: 'tram', BUS: 'bus', REGIONAL_RAIL: 'train', REGIONAL_FAST_RAIL: 'train', SUBURBAN: 'train', RAIL: 'train', HIGHSPEED_RAIL: 'train', LONG_DISTANCE: 'train', NIGHT_RAIL: 'train' };
export const NOMS_MODES = { metro: 'Métro', train: 'Train', tram: 'Tram', bus: 'Bus' };
export const ORDRE_MODES = ['metro', 'train', 'tram', 'bus'];

export function urlsArretsIDFM(lat, lon, rayonM = rayonPourMinutes(RAYON_ARRETS_MIN)) {
  const pt = "geom'POINT(" + lon.toFixed(6) + ' ' + lat.toFixed(6) + ")'";
  const base = 'within_distance(pointgeo, ' + pt + ', ' + rayonM + 'm)';
  const mk = (filtre) => {
    const p = new URLSearchParams();
    p.set('where', base + ' and ' + filtre);
    p.set('select', 'shortname,route_long_name,stop_name,mode,stop_lat,stop_lon');
    p.set('order_by', 'distance(pointgeo, ' + pt + ')');
    p.set('limit', '100');
    return IDFM_ARRETS + '?' + p.toString();
  };
  return [mk("mode != 'Bus'"), mk("mode = 'Bus'")];
}

/* Nom de ligne lisible, à la manière des plans du réseau. */
export function nomLigneIDFM(mode, short) {
  const s = String(short || '').trim();
  if (mode === 'RapidTransit' || (/train|rail/i.test(mode) && /^[A-E]$/.test(s))) return 'RER ' + s;
  if (mode === 'Metro') return 'M' + s;
  return s;
}

function grouper(lat, lon, recs) {
  const g = new Map();
  for (const r of recs) {
    if (!r.mode || r.lat == null || r.lon == null) continue;
    const k = r.mode + '|' + norm(r.nom);
    const d = distM(lat, lon, r.lat, r.lon);
    let x = g.get(k);
    if (!x) { x = { mode: r.mode, nom: r.nom, dist: d, lat: r.lat, lon: r.lon, lignes: [], stopId: r.stopId || null }; g.set(k, x); }
    if (d < x.dist) { x.dist = d; x.lat = r.lat; x.lon = r.lon; if (r.stopId) x.stopId = r.stopId; }
    for (const l of r.lignes || []) if (l && x.lignes.indexOf(l) < 0) x.lignes.push(l);
  }
  const out = [...g.values()].map((x) => Object.assign(x, { dist: Math.round(x.dist), min: minutesAPied(x.dist) }));
  out.sort((a, b) => a.dist - b.dist);
  out.forEach((x) => x.lignes.sort((a, b) => a.localeCompare(b, 'fr', { numeric: true })));
  return out;
}

/* Deux réponses IDFM (ferré + bus) -> groupes { mode, nom, lignes[], dist, min }. */
export function arretsDepuisIDFM(lat, lon, reponses) {
  const recs = [];
  for (const rep of reponses) {
    for (const r of (rep && rep.results) || []) {
      const mode = MODE_IDFM[r.mode];
      if (!mode) continue;
      const la = Number(r.stop_lat), lo = Number(r.stop_lon);
      if (!isFinite(la) || !isFinite(lo)) continue;
      const nom = String(r.shortname || '').trim();
      recs.push({ mode, nom: r.stop_name, lat: la, lon: lo, lignes: nom ? [nomLigneIDFM(r.mode, nom)] : [] });
    }
  }
  return { source: 'idfm', groupes: grouper(lat, lon, recs), lignesConnues: true };
}

export function urlArretsTransitous(lat, lon, rayonM = rayonPourMinutes(RAYON_ARRETS_MIN)) {
  const dLat = rayonM / 111320, dLon = rayonM / (111320 * Math.cos(lat * Math.PI / 180));
  return TRANSITOUS + 'map/stops?min=' + (lat - dLat).toFixed(5) + ',' + (lon - dLon).toFixed(5) + '&max=' + (lat + dLat).toFixed(5) + ',' + (lon + dLon).toFixed(5);
}

export function arretsDepuisTransitous(lat, lon, rep, rayonM = rayonPourMinutes(RAYON_ARRETS_MIN)) {
  const recs = [];
  for (const s of Array.isArray(rep) ? rep : []) {
    const modes = (s.modes || []).map((m) => MODE_TRANSITOUS[m]).filter(Boolean);
    if (!modes.length || s.lat == null) continue;
    if (distM(lat, lon, s.lat, s.lon) > rayonM) continue;
    for (const mode of [...new Set(modes)]) recs.push({ mode, nom: s.name, lat: s.lat, lon: s.lon, lignes: [], stopId: s.parentId || s.stopId });
  }
  return { source: 'transitous', groupes: grouper(lat, lon, recs), lignesConnues: false };
}

/* Hors Île-de-France : lignes d'un arrêt d'après les prochains passages (un mardi matin). */
export function urlPassages(stopId, maintenant) {
  const jour = mardiProchain(maintenant ? new Date(maintenant) : new Date());
  return TRANSITOUS + 'stoptimes?stopId=' + encodeURIComponent(stopId) + '&n=40&time=' + encodeURIComponent(isoParis(jour, '08:00'));
}
export function lignesDepuisPassages(rep) {
  const s = new Set();
  for (const t of (rep && rep.stopTimes) || []) {
    const l = libelleLigne(t).replace(/^Bus /, '');
    if (l) s.add(l);
  }
  return [...s];
}
/* Arrêts dont on demandera les lignes (borne : 5 requêtes par annonce). */
export function arretsAInterroger(groupes) {
  const pris = [], parMode = {};
  for (const g of groupes) {
    if (!g.stopId) continue;
    const n = parMode[g.mode] || 0;
    if ((g.mode === 'bus' && n < 2) || (g.mode !== 'bus' && n < 1)) { pris.push(g); parMode[g.mode] = n + 1; }
  }
  return pris.slice(0, 5);
}

export function cleArrets(lat, lon) { return 'ar|' + lat.toFixed(3) + ',' + lon.toFixed(3); }

/* Arrêts à distance réglée, groupés par mode : le plus proche de chaque mode en tête. */
export function arretsDansRayon(arrets, marcheMax) {
  if (!arrets) return [];
  return arrets.groupes.filter((g) => g.min <= marcheMax);
}
export function resumeParMode(arrets, marcheMax) {
  const dans = arretsDansRayon(arrets, marcheMax);
  const out = [];
  for (const mode of ORDRE_MODES) {
    const gs = dans.filter((g) => g.mode === mode);
    if (!gs.length) continue;
    const lignes = [];
    gs.forEach((g) => g.lignes.forEach((l) => { if (lignes.indexOf(l) < 0) lignes.push(l); }));
    out.push({ mode, plusProche: gs[0], groupes: gs, lignes });
  }
  return out;
}

/* Gare (métro, train, tram) la plus proche, pour la variante de trajet. */
export function gareLaPlusProche(arrets) {
  if (!arrets) return null;
  const g = arrets.groupes.filter((x) => x.mode !== 'bus' && x.min <= MARCHE_MAX_VERS_GARE && x.lat != null)[0];
  return g || null;
}

/* Lignes comparées sans tenir compte de « M », « RER », « Bus », de la casse. */
export function cleLigne(l) { return String(l || '').toUpperCase().replace(/^(M|RER|BUS|LIGNE|TRAIN)\s*/, '').replace(/\s+/g, ''); }
export function ligneDans(liste, l) { const k = cleLigne(l); return liste.some((x) => cleLigne(x) === k); }
