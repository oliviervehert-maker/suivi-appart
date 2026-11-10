/* Bien'ici : construction des filtres, normalisation d'une annonce. Pur (aucun appel réseau ici). */
import { stripHtml, num } from './util.js';

export const BIENICI_RECHERCHE = 'https://www.bienici.com/realEstateAds.json';
export const BIENICI_FICHE = 'https://www.bienici.com/realEstateAd.json';
export const BIENICI_SUGGEST = 'https://res.bienici.com/suggest.json';
export const BIENICI_ANNONCE = 'https://www.bienici.com/annonce/';
export const PAGE = 100;          /* taille de page acceptée par le service (mesuré : 100) */
export const BORNE = 300;         /* nombre maximal d'annonces lues par actualisation */

/* Filtres serveur LARGES : les critères fins sont appliqués sur l'appareil. */
export function construireFiltres(C, zoneIds, page = 1, taille = PAGE) {
  const f = {
    size: taille,
    from: (page - 1) * taille,
    filterType: 'rent',
    propertyType: (C.types && C.types.length ? C.types : ['flat', 'house']).slice(),
    page,
    sortBy: 'publicationDate',
    sortOrder: 'desc',
    onTheMarket: [true],
    zoneIdsByTypes: { zoneIds: zoneIds.map(String) }
  };
  if (C.piecesMin > 1) f.minRooms = C.piecesMin - 1;
  if (C.loyerMax != null) f.maxPrice = Math.round(C.loyerMax + 100);
  if (C.surfMin != null && C.surfMin - 5 > 0) f.minArea = Math.round(C.surfMin - 5);
  return f;
}

export function urlRecherche(filtres) {
  return BIENICI_RECHERCHE + '?filters=' + encodeURIComponent(JSON.stringify(filtres));
}
export function urlFiche(id) { return BIENICI_FICHE + '?id=' + encodeURIComponent(id); }
export function urlSuggest(q) { return BIENICI_SUGGEST + '?q=' + encodeURIComponent(q); }
export function urlAnnonce(id) { return BIENICI_ANNONCE + encodeURIComponent(id); }

const TYPES_LIEU = { city: 'Commune', arrondissement: 'Arrondissement', department: 'Département', 'delegated-city': 'Commune déléguée', 'alias-city': 'Commune', 'alias-department': 'Secteur' };
export function libelleTypeLieu(t) { return TYPES_LIEU[t] || 'Secteur'; }

/* Réponse de suggest.json -> lieux utilisables (avec zoneIds). */
export function lireSuggestions(rep) {
  if (!Array.isArray(rep)) return [];
  return rep.filter((x) => x && x.name && Array.isArray(x.zoneIds) && x.zoneIds.length)
    .map((x) => ({ nom: x.name, type: x.type || 'city', cp: Array.isArray(x.postalCodes) ? x.postalCodes : [], zoneIds: x.zoneIds.map(String), dept: x.type === 'department' ? (x.ref || x.insee_code || '') : '' }));
}

/* Professionnel ou particulier, d'après les champs réels : accountType (agency, network, mandatary…)
   et adCreatedByPro. Aucun particulier n'a été vu sur 324 annonces mesurées le 10/11/2026. */
const COMPTES_PRO = ['agency', 'network', 'mandatary', 'developer', 'pro', 'professional', 'builder', 'institutional'];
export function estPro(a) {
  if (a.adCreatedByPro === false) return false;
  const t = String(a.accountType || '').toLowerCase();
  if (t && /particulier|private|owner|individual|user/.test(t)) return false;
  if (a.adCreatedByPro === true || COMPTES_PRO.indexOf(t) >= 0) return true;
  if (a.contactRelativeData && typeof a.contactRelativeData.contactIsPro === 'boolean') return a.contactRelativeData.contactIsPro;
  return null;
}

/* Loyer : sur les annonces mesurées, price = loyer hors charges + charges (+ complément de loyer).
   « cc » quand les charges sont indiquées ; « inconnu » quand l'annonce ne les donne pas. */
export function loyerInfo(a) {
  const price = num(a.price), charges = num(a.charges), hc = num(a.rentWithoutCharges), extra = num(a.rentExtra);
  let cc = 'cc';
  if (charges == null) cc = 'inconnu';
  return { loyer: price, charges, loyerHC: hc, complement: extra && extra > 0 ? extra : null, cc, forfait: a.chargesMethod === 'flat-rate' ? true : a.chargesMethod === 'advance' ? false : null };
}

function vraiOuFaux(...vals) {
  let vu = false;
  for (const v of vals) { if (v === true || (typeof v === 'number' && v > 0)) return true; if (v === false || v === 0) vu = true; }
  return vu ? false : null;
}

export function precisionPosition(bi) {
  if (!bi) return null;
  if (bi.type === 'exact') return 0;
  if (bi.type === 'disk') return num(bi.radius) || 50;
  if (bi.type === 'cityOrArrondissement') return 'commune';
  return 'inconnue';
}

/* Annonce brute Bien'ici -> fiche normalisée (champs d'annonce seulement, jamais de champ utilisateur). */
export function normaliserAnnonce(a) {
  if (!a || !a.id) return null;
  const pos = (a.blurInfo && (a.blurInfo.position || a.blurInfo.centroid)) || null;
  const dist = a.district || {};
  const li = loyerInfo(a);
  const photos = (Array.isArray(a.photos) ? a.photos : []).map((p) => p && (p.url || null)).filter((u) => typeof u === 'string' && /^https:\/\/file\.bienici\.com\//.test(u)).slice(0, 12);
  const ext = vraiOuFaux(a.hasBalcony, a.balconyQuantity, a.hasTerrace, a.terracesQuantity, a.hasGarden);
  const extLabel = [vraiOuFaux(a.hasBalcony, a.balconyQuantity) ? 'Balcon' : null, vraiOuFaux(a.hasTerrace, a.terracesQuantity) ? 'Terrasse' : null, a.hasGarden ? 'Jardin' : null].filter(Boolean).join(' · ');
  return {
    id: 'bi-' + a.id,
    src: 'bienici',
    bid: String(a.id),
    url: urlAnnonce(a.id),
    titre: a.title || a.generatedTitle || '',
    type: a.propertyType === 'house' ? 'house' : 'flat',
    commune: a.city || '',
    cp: a.postalCode || '',
    dept: a.departmentCode || String(a.postalCode || '').slice(0, 2),
    quartier: dist.libelle || '',
    loyer: li.loyer,
    charges: li.charges,
    loyerHC: li.loyerHC,
    complement: li.complement,
    cc: li.cc,
    surf: num(a.surfaceArea),
    pieces: num(a.roomsQuantity),
    ch: num(a.bedroomsQuantity),
    sdb: num(a.bathroomsQuantity) != null || num(a.showerRoomsQuantity) != null ? (num(a.bathroomsQuantity) || 0) + (num(a.showerRoomsQuantity) || 0) : null,
    etage: num(a.floor),
    ascenseur: typeof a.hasElevator === 'boolean' ? a.hasElevator : null,
    ext,
    extLabel,
    jardin: a.hasGarden === true,
    cave: vraiOuFaux(a.hasCellar, a.cellarsOrUndergroundsQuantity),
    parking: vraiOuFaux(a.parkingPlacesQuantity, a.enclosedParkingQuantity),
    meuble: typeof a.isFurnished === 'boolean' ? a.isFurnished : null,
    dpe: /^[A-G]$/.test(a.energyClassification || '') ? a.energyClassification : null,
    pro: estPro(a),
    compte: a.accountType || '',
    annonceur: a.accountDisplayName || (a.contactRelativeData && (a.contactRelativeData.agencyNameToDisplay || a.contactRelativeData.contactNameToDisplay)) || '',
    honoraires: num(a.agencyRentalFee),
    depot: num(a.safetyDeposit),
    description: stripHtml(a.description).slice(0, 1500),
    photos,
    lat: pos ? num(pos.lat) : null,
    lon: pos ? num(pos.lon) : null,
    precision: precisionPosition(a.blurInfo),
    publieLe: a.publicationDate || null,
    majLe: a.modificationDate || null,
    dispoLe: a.availableDate || null,
    baisseSignalee: !!a.priceHasDecreased,
    ref: a.reference || '',
    enLigneSelonFiche: !(a.status && (a.status.onTheMarket === false || a.status.closedByUser === true))
  };
}

/* Fiche : code HTTP + corps -> verdict de disponibilité. 404/410 = retirée ; autre échec = inconnu. */
export function verdictFiche(code, corps) {
  if (code === 404 || code === 410) return { dispo: 'retiree' };
  if (code !== 200 || !corps) return { dispo: 'inconnu' };
  const n = normaliserAnnonce(corps);
  if (!n) return { dispo: 'inconnu' };
  return { dispo: n.enLigneSelonFiche ? 'en_ligne' : 'retiree', annonce: n };
}
