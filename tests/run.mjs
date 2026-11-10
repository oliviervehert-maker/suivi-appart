/* Tests de la logique pure (hors ligne) et, avec --reseau, un petit test réel des services.
   Lancer : node app/tests/run.mjs [--reseau] */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { minutesAPied, isoParis, fmt, distM, stripHtml } from '../js/core/util.js';
import { criteresNeutres, nettoyerCriteres, lireProfil } from '../js/core/criteres.js';
import { construireFiltres, urlRecherche, normaliserAnnonce, estPro, loyerInfo, verdictFiche, PAGE } from '../js/core/bienici.js';
import { fusionner, appliquerVerif, patchUtilisateur, CHAMPS_UTILISATEUR } from '../js/core/fusion.js';
import { evaluer } from '../js/core/score.js';
import {
  choisirItineraire, optionsDepuisPlan, optionsViaGare, libelleLigne, arretsDepuisIDFM, resumeParMode, urlTrajet,
  urlsArretsIDFM, arretsDepuisTransitous, urlArretsTransitous, urlPassages, lignesDepuisPassages, arretsAInterroger, gareLaPlusProche, varianteGareUtile
} from '../js/core/transports.js';

const ICI = dirname(fileURLToPath(import.meta.url));
const APP = resolve(ICI, '..');
const RESEAU = process.argv.includes('--reseau');

let ok = 0, ko = 0;
const echecs = [];
function t(nom, cond, detail) {
  if (cond) ok++; else { ko++; echecs.push(nom + (detail !== undefined ? ' -> ' + JSON.stringify(detail) : '')); }
}
function groupe(nom) { console.log('\n' + nom); }

/* ---------------- Fixtures ---------------- */
const AD = {
  id: 'agence-123', title: 'Appartement 3 pièces', city: 'Bois-Colombes', postalCode: '92270', departmentCode: '92',
  district: { libelle: 'Jean Mermoz' }, price: 1800, charges: 150, rentWithoutCharges: 1650, chargesMethod: 'advance',
  surfaceArea: 66, roomsQuantity: 3, bedroomsQuantity: 2, floor: 2, hasElevator: true, hasBalcony: true, hasCellar: true,
  isFurnished: false, energyClassification: 'D', accountType: 'agency', adCreatedByPro: true, accountDisplayName: 'Agence Test',
  agencyRentalFee: 900, safetyDeposit: 1650, description: 'Bel appartement<br>proche gare &amp; commerces',
  photos: [{ url: 'https://file.bienici.com/photo/a.jpg', url_photo: 'https://img.example.com/a.jpg' }, { url_photo: 'https://img.example.com/b.jpg' }],
  blurInfo: { type: 'disk', radius: 50, position: { lat: 48.9203, lon: 2.2753 } }, publicationDate: '2026-11-01T10:00:00Z',
  status: { onTheMarket: true, closedByUser: false }, propertyType: 'flat', reference: 'R1'
};

function profilExemple() { return lireProfil(JSON.parse(readFileSync(join(APP, 'profils', 'exemple.json'), 'utf8'))).criteres; }

/* ---------------- Hors ligne ---------------- */
groupe('Outils');
t('marche 400 m = 7 min', minutesAPied(400) === 7, minutesAPied(400));
t('marche 10 m = 1 min minimum', minutesAPied(10) === 1);
t('heure de Paris en hiver (+01:00)', isoParis(new Date(2026, 10, 17, 12), '08:30') === '2026-11-17T08:30:00+01:00', isoParis(new Date(2026, 10, 17, 12), '08:30'));
t('heure de Paris en été (+02:00)', isoParis(new Date(2027, 5, 15, 12), '09:30').endsWith('+02:00'));
t('vrai signe moins', fmt(-12) === '−12', fmt(-12));
t('distance Asnières-Paris ≈ 5,5 km', Math.abs(distM(48.9147, 2.2815, 48.8735, 2.3093) - 5050) < 600, Math.round(distM(48.9147, 2.2815, 48.8735, 2.3093)));
t('HTML retiré des descriptions', stripHtml('a<br>b &amp; c') === 'a\nb & c');

groupe('Critères');
const N = criteresNeutres();
t('neutre : aucun lieu, aucune destination', N.lieux.length === 0 && N.destinations.length === 0);
t('neutre : pas de plafond de loyer', N.loyerMax === null && N.surfMin === null);
t('neutre : agences seulement activé par défaut', N.agencesSeulement === true);
t('nettoyage : valeurs absurdes bornées', nettoyerCriteres({ marcheMax: 99, piecesMin: -3, meuble: 'x' }).marcheMax === 20);
const PO = profilExemple();
t('profil d’exemple : 3 communes', PO.lieux.length === 3 && PO.lieux.every((l) => l.zoneIds.length === 1), PO.lieux.map((l) => l.nom));
t('profil d’exemple : budget 1850/1950, surface 60/65/90', PO.loyerIdeal === 1850 && PO.loyerMax === 1950 && PO.surfMin === 60 && PO.surfCible === 65 && PO.surfMax === 90);
t('profil d’exemple : T3, 2 chambres, non meublé, sortie', PO.piecesMin === 3 && PO.chMin === 2 && PO.meuble === 'exclu' && PO.sortie === '2027-06-30');
t('profil d’exemple : 2 destinations géocodées', PO.destinations.length === 2 && PO.destinations.every((d) => d.lat != null && d.importance === 'important'));
t('profil d’exemple : École 8 h 30 ≤ 40, Travail 9 h 30 ≤ 60', PO.destinations[0].heure === '08:30' && PO.destinations[0].dureeMax === 40 && PO.destinations[1].heure === '09:30' && PO.destinations[1].dureeMax === 60);
t('profil d’exemple : train ou métro indispensable à 10 min', PO.modes.train === 'indispensable' && PO.modes.metro === 'indispensable' && PO.marcheMax === 10);
t('profil d’exemple : adresse actuelle', PO.adresseActuelle && /Asnières/.test(PO.adresseActuelle.label));

groupe('Filtres Bien’ici');
const F = construireFiltres(PO, ['-91746'], 2);
t('plafond + 100 €', F.maxPrice === 2050, F.maxPrice);
t('surface min − 5', F.minArea === 55, F.minArea);
t('pièces min − 1', F.minRooms === 2, F.minRooms);
t('type de bien', JSON.stringify(F.propertyType) === '["flat"]');
t('pagination : from = (page − 1) × taille', F.from === PAGE && F.page === 2 && F.size === PAGE);
t('location seulement, en ligne', F.filterType === 'rent' && F.onTheMarket[0] === true);
const FN = construireFiltres(N, ['-1'], 1);
t('critères neutres : aucun filtre de loyer/surface/pièces', FN.maxPrice === undefined && FN.minArea === undefined && FN.minRooms === undefined);
t('URL encodée', urlRecherche(F).startsWith('https://www.bienici.com/realEstateAds.json?filters=%7B'));

groupe('Normalisation d’une annonce');
const n = normaliserAnnonce(AD);
t('identifiant préfixé', n.id === 'bi-agence-123' && n.url === 'https://www.bienici.com/annonce/agence-123');
t('loyer = price, charges comprises', n.loyer === 1800 && n.cc === 'cc' && n.charges === 150);
t('charges absentes -> « inconnu »', loyerInfo({ price: 1500 }).cc === 'inconnu');
t('photos : seulement file.bienici.com', n.photos.length === 1 && n.photos[0] === 'https://file.bienici.com/photo/a.jpg');
t('extérieur, cave, ascenseur', n.ext === true && n.extLabel === 'Balcon' && n.cave === true && n.ascenseur === true);
t('position floutée gardée', n.lat === 48.9203 && n.precision === 50);
t('pro (agency)', n.pro === true);
t('particulier (adCreatedByPro=false)', estPro({ adCreatedByPro: false, accountType: 'agency' }) === false);
t('particulier (accountType)', estPro({ accountType: 'particulier' }) === false);
t('inconnu si aucun indice', estPro({}) === null);
t('description sans HTML', n.description === 'Bel appartement\nproche gare & commerces');
t('fiche 404 -> retirée', verdictFiche(404, null).dispo === 'retiree');
t('fiche 500 -> inconnu (rien conclu)', verdictFiche(500, null).dispo === 'inconnu');
t('fiche hors marché -> retirée', verdictFiche(200, Object.assign({}, AD, { status: { onTheMarket: false } })).dispo === 'retiree');

groupe('Fusion sans écrasement');
const T0 = Date.parse('2026-11-10T08:00:00Z');
const ancien = Object.assign({}, n, { lieux: ['-91746'], premierVuLe: '2026-11-01T08:00:00Z', dernierVuLe: '2026-11-09T08:00:00Z', dispo: 'en_ligne',
  status: 'visite', statusLe: '2026-11-05T08:00:00Z', notes: 'Appeler Mme X', cote: true, visite: { le: '2026-11-12T18:00' }, vus: { px: true } });
const suivi2 = Object.assign({}, normaliserAnnonce(Object.assign({}, AD, { id: 'autre-9' })), { lieux: ['-91746'], status: 'contacte', cote: false, notes: 'n2', dernierVuLe: '2026-11-09T08:00:00Z', dispo: 'en_ligne' });
const oublie = Object.assign({}, normaliserAnnonce(Object.assign({}, AD, { id: 'vieux-1' })), { lieux: ['-91746'], status: 'nouveau', dernierVuLe: '2026-10-01T08:00:00Z', dispo: 'en_ligne' });
const frais = Object.assign({}, n, { loyer: 1750, status: 'nouveau', notes: '', cote: false, visite: null, lieux: ['-91746'] });
const neuf = Object.assign({}, normaliserAnnonce(Object.assign({}, AD, { id: 'neuf-7' })), { lieux: ['-91746'] });
const r = fusionner([ancien, suivi2, oublie], [frais, neuf], { maintenant: T0, complet: true });
const m = r.biens.find((b) => b.id === n.id);
t('statut gardé', m.status === 'visite' && m.statusLe === '2026-11-05T08:00:00Z', m.status);
t('note gardée', m.notes === 'Appeler Mme X');
t('mis de côté gardé', m.cote === true);
t('visite gardée', m.visite && m.visite.le === '2026-11-12T18:00');
t('« vu » gardé', m.vus && m.vus.px === true);
t('loyer mis à jour, ancien loyer gardé', m.loyer === 1750 && m.ancienLoyer === 1800 && r.baisses.indexOf(n.id) >= 0);
t('premier vu conservé', m.premierVuLe === '2026-11-01T08:00:00Z');
t('nouvelle annonce marquée « nouveau »', r.nouveaux.length === 1 && r.biens.find((b) => b.id === 'bi-neuf-7').nouveau === true);
t('annonce suivie absente -> à vérifier', r.aVerifier.length === 1 && r.aVerifier[0] === suivi2.id, r.aVerifier);
t('annonce sans donnée absente depuis 40 j -> purgée', r.purges.indexOf(oublie.id) >= 0 && !r.biens.some((b) => b.id === oublie.id));
t('annonce suivie jamais purgée', r.biens.some((b) => b.id === suivi2.id));
const r1 = fusionner([], [frais], { maintenant: T0, premiere: true });
t('première recherche : rien marqué « nouveau »', r1.nouveaux.length === 0 && r1.biens[0].nouveau === false);
const r2 = fusionner([ancien], [frais], { maintenant: T0, complet: false });
t('recherche incomplète : rien purgé', r2.purges.length === 0);
const remonte = fusionner([m], [Object.assign({}, frais, { loyer: 1900 })], { maintenant: T0 + 1000 }).biens[0];
t('loyer remonté au-dessus de l’ancien : baisse effacée', remonte.ancienLoyer == null && remonte.loyer === 1900);
const v1 = appliquerVerif(suivi2, { dispo: 'retiree' }, T0);
t('fiche 404 -> retirée avec date', v1.dispo === 'retiree' && v1.retireeLe === new Date(T0).toISOString());
t('retirée : note et statut gardés', v1.notes === 'n2' && v1.status === 'contacte');
const v2 = appliquerVerif(v1, { dispo: 'retiree' }, T0 + 86400000);
t('date de retrait inchangée à la vérification suivante', v2.retireeLe === v1.retireeLe);
const v3 = appliquerVerif(v1, { dispo: 'inconnu' }, T0);
t('échec de vérification : rien conclu', v3.dispo === 'retiree');
const v4 = appliquerVerif(suivi2, { dispo: 'en_ligne', annonce: Object.assign({}, suivi2, { loyer: 1700, notes: 'PIRATE', status: 'nouveau' }) }, T0);
t('fiche en ligne : baisse détectée, champs utilisateur protégés', v4.loyer === 1700 && v4.ancienLoyer === 1800 && v4.notes === 'n2' && v4.status === 'contacte');
t('patch utilisateur : seuls les champs utilisateur passent', patchUtilisateur(m, { loyer: 1, notes: 'ok' }).loyer === 1750 && patchUtilisateur(m, { notes: 'ok' }).notes === 'ok');
t('liste des champs utilisateur', ['status', 'notes', 'cote', 'visite'].every((k) => CHAMPS_UTILISATEUR.indexOf(k) >= 0));

groupe('Score et exclusions');
const C = profilExemple();
const base = Object.assign({}, n, { lieux: ['-91746'], dispo: 'en_ligne', status: 'nouveau' });
const arretsGare = { source: 'idfm', groupes: [{ mode: 'train', nom: 'Bois-Colombes', lignes: ['J'], dist: 400, min: 7, lat: 48.914, lon: 2.271 }, { mode: 'bus', nom: 'Gramme', lignes: ['N52'], dist: 100, min: 2 }] };
const arretsBus = { source: 'idfm', groupes: [{ mode: 'bus', nom: 'Gramme', lignes: ['N52'], dist: 100, min: 2 }] };
const tj = (a, b) => ({ 'd-ecole': { etat: 'ok', opts: [{ min: a, corresp: 1, via: 'J → M13', lignes: ['J', 'M13'] }] }, 'd-travail': { etat: 'ok', opts: [{ min: b, corresp: 1, via: 'L → M12', lignes: ['L', 'M12'] }] } });
const e0 = evaluer(base, C, { arrets: arretsGare, trajets: tj(35, 50) });
t('annonce conforme : non écartée, score ≥ 80', !e0.exclu && e0.score >= 80, e0);
t('raison lisible du lieu', e0.why.some((w) => w[0] === 'ok' && w[1] === 'Bois-Colombes'));
const e1 = evaluer(Object.assign({}, base, { loyer: 2000 }), C, { arrets: arretsGare, trajets: tj(35, 50) });
t('loyer > plafond : écartée, raison donnée', e1.exclu && e1.why.some((w) => w[0] === 'ko' && /Loyer > 1\s950/.test(w[1])), e1.why);
const e2 = evaluer(Object.assign({}, base, { pro: false }), C, { arrets: arretsGare, trajets: tj(35, 50) });
t('particulier écarté (agences seulement)', e2.exclu && e2.why.some((w) => w[1] === 'Particulier'));
const e2b = evaluer(Object.assign({}, base, { pro: false }), Object.assign({}, C, { agencesSeulement: false }), { arrets: arretsGare, trajets: tj(35, 50) });
t('particulier gardé si réglage désactivé', !e2b.exclu);
t('meublé écarté', evaluer(Object.assign({}, base, { meuble: true }), C, {}).exclu);
t('hors des lieux retenus', evaluer(Object.assign({}, base, { lieux: ['-1'] }), C, {}).why.some((w) => w[0] === 'ko' && /Hors des lieux/.test(w[1])));
const Cq = Object.assign({}, C, { quartiersEcartes: [{ commune: 'Bois-Colombes', quartier: 'Jean Mermoz' }] });
t('quartier écarté', evaluer(base, Cq, {}).why.some((w) => w[0] === 'ko' && /Jean Mermoz/.test(w[1])));
t('surface < minimum', evaluer(Object.assign({}, base, { surf: 55 }), C, {}).why.some((w) => w[0] === 'ko' && /60 m²/.test(w[1])));
const e3 = evaluer(base, C, { arrets: arretsBus, trajets: tj(35, 50) });
t('ni train ni métro à 10 min : écartée', e3.exclu && e3.why.some((w) => w[0] === 'ko' && /métro ni de train/.test(w[1])), e3.why);
const e4 = evaluer(base, C, { arrets: undefined, trajets: {} });
t('calcul en attente : pas d’exclusion prématurée', !e4.exclu && e4.attente);
const e5 = evaluer(base, C, { arrets: arretsGare, trajets: tj(55, 50) });
t('trajet « Important » trop long : pénalité, pas d’exclusion', !e5.exclu && e5.score < e0.score && e5.why.some((w) => w[0] === 'mid' && /École ≈ 55 min/.test(w[1])), e5.why);
const Ci = JSON.parse(JSON.stringify(C)); Ci.destinations[0].importance = 'indispensable';
const e6 = evaluer(base, Ci, { arrets: arretsGare, trajets: tj(55, 50) });
t('trajet « Indispensable » trop long : écartée', e6.exclu && e6.why.some((w) => w[0] === 'ko' && /École/.test(w[1])));
const Cc = JSON.parse(JSON.stringify(C)); Cc.destinations[0].corrMax = 0;
const e7 = evaluer(base, Cc, { arrets: arretsGare, trajets: tj(35, 50) });
t('correspondances au-delà du maximum : signalé', e7.why.some((w) => /corresp/.test(w[1])));
const Cl = Object.assign({}, C, { lignesEvitees: ['J'] });
t('seule ligne ferrée = ligne évitée : signalé', evaluer(base, Cl, { arrets: arretsGare, trajets: tj(35, 50) }).why.some((w) => /à éviter/.test(w[1])));
const Cp = Object.assign({}, C, { lignesPreferees: ['J'] });
t('ligne préférée à proximité : bonus', evaluer(base, Cp, { arrets: arretsGare, trajets: tj(35, 50) }).score >= e0.score);
t('retirée : écartée', evaluer(Object.assign({}, base, { dispo: 'retiree' }), C, {}).why[0][1] === 'Annonce retirée');
t('statut « Écarté » : écartée', evaluer(Object.assign({}, base, { status: 'ecarte' }), C, {}).exclu);
t('critères neutres : rien d’écarté sur une annonce correcte', !evaluer(base, criteresNeutres(), {}).exclu);
t('score borné 0–100', [e0, e1, e2, e3, e5, e6].every((e) => e.score >= 0 && e.score <= 100));

groupe('Trajets et arrêts (logique)');
t('choix : 35 min/1 corresp. préféré à 34 min/2', choisirItineraire([{ min: 34, corresp: 2 }, { min: 35, corresp: 1 }]).min === 35);
t('choix : 40 min/0 corresp. préféré à 37/1', choisirItineraire([{ min: 37, corresp: 1 }, { min: 40, corresp: 0 }]).min === 40);
t('choix sous contrainte de correspondances', choisirItineraire([{ min: 30, corresp: 2 }, { min: 50, corresp: 0 }], 0).min === 50);
t('libellés de ligne', libelleLigne({ mode: 'SUBWAY', routeShortName: '13' }) === 'M13' && libelleLigne({ mode: 'REGIONAL_RAIL', routeShortName: 'A' }) === 'RER A' && libelleLigne({ mode: 'REGIONAL_RAIL', routeShortName: 'J' }) === 'J' && libelleLigne({ mode: 'TRAM', routeShortName: '2' }) === 'T2');
const PLAN = { direct: [], itineraries: [{ duration: 2100, transfers: 1, legs: [{ mode: 'WALK' }, { mode: 'REGIONAL_RAIL', routeShortName: 'J' }, { mode: 'WALK' }, { mode: 'SUBWAY', routeShortName: '13' }, { mode: 'WALK' }] }] };
const op = optionsDepuisPlan(PLAN, 'transit');
t('plan -> option « J → M13 »', op.length === 1 && op[0].min === 35 && op[0].via === 'J → M13' && op[0].corresp === 1, op);
t('variante depuis la gare : marche ajoutée', optionsViaGare(PLAN, { min: 6, nom: 'G' })[0].min === 41);
t('variante gare : inutile si la marche de départ est cohérente', !varianteGareUtile([{ min: 35, corresp: 1, via: 'J', marcheDepart: 8 }], { min: 6 }));
t('variante gare : utile si le calculateur fait un long détour à pied', varianteGareUtile([{ min: 45, corresp: 1, via: 'J', marcheDepart: 16 }], { min: 6 }));
t('variante gare : utile si aucun itinéraire', varianteGareUtile([], { min: 6 }));
t('vélo : trajet direct', optionsDepuisPlan({ direct: [{ duration: 1613, legs: [{ mode: 'BIKE' }] }] }, 'bike')[0].min === 27);
const u = new URL(urlTrajet({ de: { lat: 48.9, lon: 2.2 }, vers: { lat: 48.8, lon: 2.3 }, heure: '08:30', mode: 'bike', jour: new Date(2026, 10, 17, 12) }));
t('URL vélo : directModes=BIKE, sans transports', u.searchParams.get('directModes') === 'BIKE' && u.searchParams.get('transitModes') === '' && u.searchParams.get('arriveBy') === 'true');
const IDF = { results: [
  { mode: 'LocalTrain', shortname: 'L', stop_name: 'Bécon-les-Bruyères', stop_lat: '48.9056', stop_lon: '2.2688' },
  { mode: 'Bus', shortname: '167', stop_name: 'Gare de Bécon', stop_lat: '48.9050', stop_lon: '2.2700' },
  { mode: 'Bus', shortname: '175', stop_name: 'Gare de Bécon', stop_lat: '48.9051', stop_lon: '2.2701' },
  { mode: 'Metro', shortname: '13', stop_name: 'Gabriel Péri', stop_lat: '48.9164', stop_lon: '2.2947' },
  { mode: 'RapidTransit', shortname: 'A', stop_name: 'La Défense', stop_lat: '48.8922', stop_lon: '2.2369' }
] };
const ar = arretsDepuisIDFM(48.9045, 2.2700, [IDF]);
const rs = resumeParMode(ar, 10);
t('IDFM : groupement par arrêt et mode', ar.groupes.length === 4, ar.groupes.map((g) => g.nom + '/' + g.mode));
t('IDFM : lignes de bus réunies', ar.groupes.find((g) => g.mode === 'bus').lignes.join(',') === '167,175');
t('IDFM : RER nommé « RER A »', ar.groupes.find((g) => g.nom === 'La Défense').lignes[0] === 'RER A');
t('rayon : La Défense (> 10 min) exclue du résumé', !rs.some((x) => x.groupes.some((g) => g.nom === 'La Défense')));
t('gare la plus proche pour la variante', gareLaPlusProche(ar).nom === 'Bécon-les-Bruyères');
t('URL IDFM : ferré et bus séparés, triés par distance', urlsArretsIDFM(48.9, 2.27).length === 2 && new URL(urlsArretsIDFM(48.9, 2.27)[0]).searchParams.get('where').indexOf("mode != 'Bus'") > 0 && /^distance/.test(new URL(urlsArretsIDFM(48.9, 2.27)[0]).searchParams.get('order_by')));
const TS = [{ name: 'Bellecour', stopId: 's1', parentId: 'p1', lat: 45.7576, lon: 4.8330, modes: ['SUBWAY'] }, { name: 'Bellecour', stopId: 's2', parentId: 'p1', lat: 45.7578, lon: 4.8331, modes: ['SUBWAY'] }, { name: 'Loin', stopId: 's3', lat: 45.80, lon: 4.90, modes: ['BUS'] }];
const at = arretsDepuisTransitous(45.7590, 4.8320, TS);
t('Transitous : arrêts groupés, hors rayon exclus', at.groupes.length === 1 && at.groupes[0].mode === 'metro' && at.groupes[0].stopId === 'p1');
t('Transitous : lignes depuis les passages', lignesDepuisPassages({ stopTimes: [{ mode: 'SUBWAY', routeShortName: 'A' }, { mode: 'SUBWAY', routeShortName: 'D' }, { mode: 'BUS', routeShortName: 'C9' }] }).join(',') === 'MA,MD,C9');
t('Transitous : au plus 5 arrêts interrogés', arretsAInterroger(Array.from({ length: 9 }, (_, i) => ({ mode: i % 2 ? 'bus' : 'metro', stopId: 'x' + i }))).length <= 5);

groupe('Cohérence du code');
function fichiers(dir, ext) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== 'vendor' && f !== 'tests') out.push(...fichiers(p, ext)); }
    else if (ext.some((e) => f.endsWith(e))) out.push(p);
  }
  return out;
}
const JS = fichiers(join(APP, 'js'), ['.js']);
let importsKo = [];
for (const f of JS) {
  const src = readFileSync(f, 'utf8');
  for (const mt of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g)) {
    const cible = resolve(dirname(f), mt[2]);
    let csrc; try { csrc = readFileSync(cible, 'utf8'); } catch (e) { importsKo.push(f + ' -> ' + mt[2] + ' introuvable'); continue; }
    for (let nom of mt[1].split(',')) {
      nom = nom.trim().split(/\s+as\s+/)[0]; if (!nom) continue;
      const re = new RegExp('export\\s+(async\\s+)?(function|const|let|class)\\s+' + nom + '\\b|export\\s*\\{[^}]*\\b' + nom + '\\b[^}]*\\}');
      if (!re.test(csrc)) importsKo.push(f.replace(APP + '/', '') + ' : ' + nom + ' absent de ' + mt[2]);
    }
  }
}
t('chaque nom importé est exporté', importsKo.length === 0, importsKo);
const autorises = ['www.bienici.com', 'res.bienici.com', 'file.bienici.com', 'api.transitous.org', 'api-adresse.data.gouv.fr', 'data.iledefrance-mobilites.fr'];
/* Liens d'attribution exigés par le règlement de Transitous : simples liens cliquables, jamais appelés par l'appli. */
/* github.com : lien de contact du projet (CONTACT_APP), cliquable, jamais appelé. */
const liensAttribution = ['transitous.org', 'www.openstreetmap.org', 'github.com'];
const hotes = new Set();
for (const f of fichiers(APP, ['.js', '.html', '.css'])) for (const mt of readFileSync(f, 'utf8').matchAll(/https?:\/\/([a-z0-9.*-]+)/gi)) hotes.add(mt[1]);
const interdits = [...hotes].filter((h) => autorises.indexOf(h) < 0 && liensAttribution.indexOf(h) < 0 && h !== '*.cloud.ovh.net');
const attrHors = fichiers(APP, ['.js', '.html', '.css']).filter((f) => !f.endsWith('divers.js') && /https:\/\/(transitous\.org|www\.openstreetmap\.org)/.test(readFileSync(f, 'utf8')));
t('liens d’attribution seulement dans l’écran Sources', attrHors.length === 0, attrHors);
t('aucun hôte non autorisé dans le code (hors vendor/)', interdits.length === 0, interdits);
const sw = readFileSync(join(APP, 'sw.js'), 'utf8'), cfg = readFileSync(join(APP, 'js', 'config.js'), 'utf8');
t('version du service worker = version de l’appli', sw.match(/VERSION = '([^']+)'/)[1] === cfg.match(/APP_VERSION = '([^']+)'/)[1]);
const coquille = [...sw.matchAll(/'((?:js|fonts|icons)\/[^']+|index\.html|app\.css|manifest\.webmanifest)'/g)].map((x) => x[1]);
const manquants = coquille.filter((p) => { try { statSync(join(APP, p)); return false; } catch (e) { return true; } });
t('fichiers de la coquille présents', manquants.length === 0, manquants);
const jsRel = JS.map((f) => f.replace(APP + '/', ''));
t('tous les modules JS dans la coquille', jsRel.every((f) => coquille.indexOf(f) >= 0), jsRel.filter((f) => coquille.indexOf(f) < 0));
let bt = [];
for (const f of JS) readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (/^\s*(export\s+)?function\b.*\{.*\/\/.*\}\s*$/.test(l)) bt.push(f + ':' + (i + 1)); });
t('aucun « // » dans une fonction écrite sur une ligne', bt.length === 0, bt);

/* ---------------- Réseau ---------------- */
async function reseau() {
  const { rechercher, verifierFiche, suggestions } = await import('../js/recherche.js');
  const { getJSONok } = await import('../js/net.js');
  groupe('Réseau : Bien’ici');
  const sc = await suggestions('Colombes'), sb = await suggestions('Bois-Colombes');
  const col = sc.find((x) => x.nom === 'Colombes'), bc = sb.find((x) => x.nom === 'Bois-Colombes');
  t('suggest : Colombes', col && col.zoneIds[0] === '-91738', col);
  t('suggest : Bois-Colombes', bc && bc.zoneIds[0] === '-91746', bc);
  const Cr = criteresNeutres(); Cr.lieux = [col, bc].map((l) => Object.assign({ etat: 'oui' }, l));
  const t0 = Date.now();
  const r = await rechercher(Cr, { taille: 24 }); /* pages de 24 : la pagination est réellement exercée */
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  for (const l of r.parLieu) {
    console.log('  ' + l.nom + ' : total annoncé ' + l.total + ', lues ' + l.lus + (l.echec ? ' (ÉCHEC)' : ''));
    t('pagination complète : ' + l.nom + ' (total = lues)', !l.echec && l.total === l.lus, l);
  }
  const ids = new Set(r.annonces.map((a) => a.id));
  console.log('  annonces distinctes : ' + r.annonces.length + ' en ' + dt + ' s, borne atteinte : ' + r.borneAtteinte);
  t('aucun doublon', ids.size === r.annonces.length);
  t('pagination réellement exercée (plus d’une page de 24)', r.parLieu.some((l) => l.total > 24), r.parLieu.map((l) => l.total));
  const tot = r.parLieu.reduce((s, l) => s + l.total, 0);
  t('total annoncé (somme des lieux) = annonces récupérées', tot === r.annonces.length, [tot, r.annonces.length]);
  const charges = r.annonces.filter((a) => a.cc === 'cc').length;
  console.log('  charges indiquées (CC) : ' + charges + ' / ' + r.annonces.length + ' ; pro : ' + r.annonces.filter((a) => a.pro === true).length + ', particulier : ' + r.annonces.filter((a) => a.pro === false).length + ', inconnu : ' + r.annonces.filter((a) => a.pro == null).length);
  t('photos toutes sur file.bienici.com', r.annonces.every((a) => a.photos.every((p) => p.startsWith('https://file.bienici.com/'))));
  const avecPos = r.annonces.filter((a) => a.lat != null && a.precision === 50);
  t('positions floutées présentes', avecPos.length > 0);
  const a0 = avecPos[0];
  const f1 = await verifierFiche(a0.bid);
  t('fiche d’une annonce en ligne', f1.dispo === 'en_ligne' && f1.annonce && f1.annonce.id === a0.id, f1.dispo);
  const f2 = await verifierFiche('annonce-inexistante-000000');
  t('fiche inexistante -> retirée (404)', f2.dispo === 'retiree', f2);

  groupe('Réseau : Transitous (1 requête par seconde)');
  const dest = PO.destinations[0];
  const p1 = await getJSONok(urlTrajet({ de: a0, vers: dest, heure: dest.heure, mode: 'transit' }), { delai: 30000 });
  const o1 = optionsDepuisPlan(p1, 'transit'); const c1 = choisirItineraire(o1);
  console.log('  ' + a0.commune + ' ' + (a0.quartier || '') + ' -> ' + dest.nom + ' : ' + (c1 ? c1.min + ' min, ' + c1.via + ', ' + c1.corresp + ' corresp.' : 'aucun'));
  t('trajet en transports trouvé', !!c1 && c1.min > 5 && c1.min < 150, o1.length);
  const p2 = await getJSONok(urlTrajet({ de: a0, vers: dest, heure: dest.heure, mode: 'bike' }), { delai: 30000 });
  const c2 = choisirItineraire(optionsDepuisPlan(p2, 'bike'));
  console.log('  même trajet à vélo : ' + (c2 ? c2.min + ' min' : 'aucun'));
  t('trajet à vélo trouvé', !!c2 && c2.min > 3);

  groupe('Réseau : arrêts IDFM');
  const [u1, u2] = urlsArretsIDFM(a0.lat, a0.lon);
  const ai = arretsDepuisIDFM(a0.lat, a0.lon, [await getJSONok(u1), await getJSONok(u2)]);
  const ri = resumeParMode(ai, 15);
  console.log('  ' + ai.groupes.length + ' arrêts à ≤ 20 min ; à ≤ 15 min : ' + ri.map((x) => x.mode + ' ' + x.plusProche.nom + ' ' + x.plusProche.min + ' min [' + x.lignes.slice(0, 6).join(', ') + ']').join(' | '));
  t('arrêts IDFM trouvés, avec lignes', ai.groupes.length > 0 && ai.groupes.some((g) => g.lignes.length > 0));
  t('au moins une gare à ≤ 20 min', ai.groupes.some((g) => g.mode !== 'bus'));

  groupe('Réseau : arrêts Transitous à Lyon');
  const at2 = arretsDepuisTransitous(45.7590, 4.8320, await getJSONok(urlArretsTransitous(45.7590, 4.8320)));
  const q = arretsAInterroger(at2.groupes);
  for (const g of q.slice(0, 2)) { g.lignes = lignesDepuisPassages(await getJSONok(urlPassages(g.stopId))); }
  console.log('  ' + at2.groupes.length + ' arrêts ; lignes lues : ' + q.slice(0, 2).map((g) => g.mode + ' ' + g.nom + ' [' + g.lignes.join(', ') + ']').join(' | '));
  t('arrêts Transitous trouvés à Lyon', at2.groupes.length > 0);
  t('métro présent près de Bellecour', at2.groupes.some((g) => g.mode === 'metro'));
  t('lignes lues sur les prochains passages', q.slice(0, 2).some((g) => g.lignes.length > 0));
}

if (RESEAU) {
  try { await reseau(); } catch (e) { ko++; echecs.push('réseau : ' + (e && (e.message || e.code) || e)); }
}

console.log('\n' + (ko ? 'ÉCHECS :\n  ' + echecs.join('\n  ') + '\n' : '') + 'Résultat : ' + ok + ' réussis, ' + ko + ' échoués' + (RESEAU ? ' (hors ligne + réseau)' : ' (hors ligne)'));
process.exit(ko ? 1 : 0);
