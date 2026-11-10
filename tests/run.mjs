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
{
  const { encoderLien, decoderLien, codeDansTexte } = await import('../js/core/partage.js');
  const objet = { type: 'suivi-appart-profil', criteres: { lieux: [{ nom: 'Asnières-sur-Seine' }], note: 'é€ — ' + 'x'.repeat(3000) } };
  const code = await encoderLien(objet);
  t('lien de partage : aller-retour exact', await decoderLien(code) === JSON.stringify(objet));
  t('lien de partage : compressé et sans caractère à échapper', code.startsWith('1.') && code.length < 600 && /^[01]\.[A-Za-z0-9_-]+$/.test(code), code.length);
  t('lien de partage : code retrouvé dans une adresse complète', codeDansTexte('https://exemple.test/app/#r=' + code) === code && codeDansTexte(code) === code && codeDansTexte('https://exemple.test/') === null);
  let refus = false; try { await decoderLien('1.AAAA'); } catch (e) { refus = true; }
  t('lien de partage : code abîmé refusé', refus);
}
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
    if (statSync(p).isDirectory()) { if (f !== 'vendor' && f !== 'tests' && f !== 'serveur' && f !== '.git') out.push(...fichiers(p, ext)); }
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
const { ALERTES_URL } = await import('../js/config.js');
/* Le serveur d'alertes (serveur/, programme distinct, jamais chargé par l'appli) a ses propres tests plus bas. */
const autorises = ['www.bienici.com', 'res.bienici.com', 'file.bienici.com', 'api.transitous.org', 'api-adresse.data.gouv.fr', 'data.iledefrance-mobilites.fr'].concat(ALERTES_URL ? [new URL(ALERTES_URL).hostname] : []);
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

/* ---------------- Alertes par notification (hors ligne) ---------------- */
const PUSH = await import('../serveur/src/push.js');
const SA = await import('../serveur/src/alertes.js');
const CA = await import('../js/core/alertes.js');
const ST = globalThis.crypto.subtle;
const TE = new TextEncoder(), TD = new TextDecoder();

/* Déchiffrement côté « navigateur », écrit indépendamment de push.js : en-tête lu selon la RFC 8188,
   dérivations par la primitive HKDF native de WebCrypto (push.js, lui, enchaîne des HMAC à la main). */
async function dechiffrerNavigateur(corps, uaPriveeJwk, uaPublique, authSecret) {
  const sel = corps.slice(0, 16);
  const rs = new DataView(corps.buffer, corps.byteOffset + 16, 4).getUint32(0);
  const idlen = corps[20];
  const asPublique = corps.slice(21, 21 + idlen);
  const chiffre = corps.slice(21 + idlen);
  if (chiffre.length > rs) throw new Error('plus d’un enregistrement');
  const priv = await ST.importKey('jwk', uaPriveeJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const pub = await ST.importKey('raw', asPublique, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await ST.deriveBits({ name: 'ECDH', public: pub }, priv, 256));
  const hkdf = async (salt, ikm, info, n) => new Uint8Array(await ST.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await ST.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));
  const info = new Uint8Array([...TE.encode('WebPush: info'), 0, ...uaPublique, ...asPublique]);
  const ikm = await hkdf(authSecret, secret, info, 32);
  const cek = await hkdf(sel, ikm, new Uint8Array([...TE.encode('Content-Encoding: aes128gcm'), 0]), 16);
  const nonce = await hkdf(sel, ikm, new Uint8Array([...TE.encode('Content-Encoding: nonce'), 0]), 12);
  const clair = new Uint8Array(await ST.decrypt({ name: 'AES-GCM', iv: nonce }, await ST.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), chiffre));
  let i = clair.length - 1;
  while (i >= 0 && clair[i] === 0) i--;
  if (clair[i] !== 2) throw new Error('délimiteur de dernier enregistrement absent');
  return clair.slice(0, i);
}
async function essai(f) { try { return await f(); } catch (e) { return null; } }
async function paireNavigateur() {
  const p = await ST.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = new Uint8Array(await ST.exportKey('raw', p.publicKey));
  const auth = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return { jwk: await ST.exportKey('jwk', p.privateKey), pub, auth, p256dh: PUSH.b64uEnc(pub), authB64: PUSH.b64uEnc(auth) };
}

groupe('Alertes : Web Push (RFC 8291, RFC 8292)');
{
  /* RFC 8291, annexe A. */
  const V = {
    clair: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
    asPub: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    asPriv: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    uaPub: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    uaPriv: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
    sel: 'DGv6ra1nlYgDCS1FRnbzlw', auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    ecdh: 'kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs', prkCle: 'Snr3JMxaHVDXHWJn5wdC52WjpCtd2EIEGBykDcZW32k',
    ikm: 'S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg', prk: '09_eUZGrsvxChDCGRCdkLiDXrReGOEVeSCdCcPBSJSc',
    cek: 'oIhVW04MRdy2XN9CiKLxTg', nonce: '4h_95klXJ5E_qnoN',
    corps: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN'
  };
  const d = PUSH.b64uDec;
  t('RFC 8291 : texte clair du vecteur', TD.decode(d(V.clair)) === 'When I grow up, I want to be a watermelon');
  const r = await PUSH.chiffrer({ p256dh: V.uaPub, auth: V.auth, message: d(V.clair), sel: d(V.sel), ephemere: { publique: d(V.asPub), privee: d(V.asPriv) } });
  for (const k of ['ecdh', 'prkCle', 'ikm', 'prk', 'cek', 'nonce']) t('RFC 8291 : valeur intermédiaire ' + k + ' identique', PUSH.b64uEnc(r.trace[k]) === V[k], PUSH.b64uEnc(r.trace[k]));
  t('RFC 8291 : corps chiffré identique à l’octet près (' + r.corps.length + ' octets)', PUSH.b64uEnc(r.corps) === V.corps);
  const clair = await essai(() => dechiffrerNavigateur(d(V.corps), PUSH.jwkDepuisBrut(d(V.uaPub), d(V.uaPriv)), d(V.uaPub), d(V.auth)));
  t('RFC 8291 : corps de la RFC déchiffré par le côté navigateur indépendant', !!clair && TD.decode(clair) === 'When I grow up, I want to be a watermelon');
  const nav = await paireNavigateur();
  const msg = JSON.stringify({ t: 'Nouvelle annonce · Asnières, Bécon', c: '70 m² · 3 pièces · 1 725 € CC', u: './?b=bi-1', tag: 'sa-bi-1' });
  const r2 = await PUSH.chiffrer({ p256dh: nav.p256dh, auth: nav.authB64, message: msg });
  const ar = await essai(() => dechiffrerNavigateur(r2.corps, nav.jwk, nav.pub, nav.auth));
  t('aller-retour : clés et sel aléatoires, déchiffrement indépendant', !!ar && TD.decode(ar) === msg);
  const r3 = await PUSH.chiffrer({ p256dh: nav.p256dh, auth: nav.authB64, message: msg });
  t('aller-retour : deux envois du même message diffèrent (sel et clé éphémère neufs)', PUSH.b64uEnc(r3.corps) !== PUSH.b64uEnc(r2.corps));

  /* VAPID */
  const pv = await ST.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pubV = new Uint8Array(await ST.exportKey('raw', pv.publicKey));
  const jwkV = await ST.exportKey('jwk', pv.privateKey);
  const T0 = Date.UTC(2026, 10, 18, 10, 0);
  const jeton = await PUSH.jetonVapid({ aud: 'https://fcm.googleapis.com', sub: 'https://exemple.test/contact', priveeJwk: JSON.stringify(jwkV), maintenant: T0 });
  const [h, c, s] = jeton.split('.');
  const entete = JSON.parse(TD.decode(d(h))), claims = JSON.parse(TD.decode(d(c))), sig = d(s);
  t('VAPID : en-tête ES256 / JWT', entete.alg === 'ES256' && entete.typ === 'JWT');
  t('VAPID : aud = origine du service, sub présent', claims.aud === 'https://fcm.googleapis.com' && claims.sub === 'https://exemple.test/contact');
  t('VAPID : expiration ≤ 12 h', claims.exp > T0 / 1000 && claims.exp - T0 / 1000 <= 12 * 3600, claims.exp - T0 / 1000);
  t('VAPID : signature brute r||s de 64 octets', sig.length === 64, sig.length);
  const cleV = await ST.importKey('raw', pubV, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  t('VAPID : signature vérifiée avec la clé publique', await ST.verify({ name: 'ECDSA', hash: 'SHA-256' }, cleV, sig, TE.encode(h + '.' + c)));
  const sigAlteree = sig.slice(); sigAlteree[5] ^= 1;
  t('VAPID : signature altérée refusée', !(await ST.verify({ name: 'ECDSA', hash: 'SHA-256' }, cleV, sigAlteree, TE.encode(h + '.' + c))));
  t('VAPID : en-tête Authorization « vapid t=…, k=… »', PUSH.enteteVapid(jeton, PUSH.b64uEnc(pubV)) === 'vapid t=' + jeton + ', k=' + PUSH.b64uEnc(pubV));

  /* Services de notification acceptés */
  const oui = ['https://fcm.googleapis.com/fcm/send/abc', 'https://web.push.apple.com/QGx', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://db5p.notify.windows.com/w/?token=x'];
  const non = ['http://fcm.googleapis.com/fcm/send/abc', 'https://fcm.googleapis.com.evil.test/x', 'https://evilpush.apple.com/x', 'https://push.apple.com.evil.test/', 'https://exemple.test/push', 'https://fcm.googleapis.com:8443/x', 'https://u:p@fcm.googleapis.com/x', 'https://127.0.0.1/x', 'pas une adresse'];
  t('endpoint : services connus acceptés', oui.every(PUSH.endpointAccepte), oui.filter((x) => !PUSH.endpointAccepte(x)));
  t('endpoint : tout autre hôte, http, port ou identifiants refusés', non.every((x) => !PUSH.endpointAccepte(x)), non.filter(PUSH.endpointAccepte));

  /* Envoi : en-têtes, codes de retour */
  const vu = [];
  const ab = { endpoint: 'https://fcm.googleapis.com/fcm/send/1', keys: { p256dh: nav.p256dh, auth: nav.authB64 } };
  const vapid = { publique: PUSH.b64uEnc(pubV), priveeJwk: JSON.stringify(jwkV), sujet: 'https://exemple.test/contact' };
  const envoi = (statut) => PUSH.envoyerPush({ abonnement: ab, donnees: { t: 'x', c: 'y', u: './', tag: 'z' }, vapid, maintenant: T0, fetch: async (u, o) => { vu.push(o); if (statut === 'reseau') throw new Error('x'); return new Response(null, { status: statut }); } });
  const e201 = await envoi(201);
  const hd = vu[0].headers;
  t('envoi : POST, TTL 43200, Urgency normal, aes128gcm, Authorization vapid', vu[0].method === 'POST' && hd.TTL === '43200' && hd.Urgency === 'normal' && hd['Content-Encoding'] === 'aes128gcm' && /^vapid t=[^,]+, k=/.test(hd.Authorization) && e201.etat === 'ok');
  const lu = await essai(() => dechiffrerNavigateur(vu[0].body, nav.jwk, nav.pub, nav.auth));
  t('envoi : corps déchiffrable par le navigateur', !!lu && JSON.parse(TD.decode(lu)).t === 'x');
  const etats = [];
  for (const st of [404, 410, 429, 500, 503, 400, 'reseau']) etats.push((await envoi(st)).etat);
  t('envoi : 404/410 -> supprimer, 429/5xx/réseau -> réessayer, 400 -> échec', etats.join() === 'supprimer,supprimer,reessayer,reessayer,reessayer,echec,reessayer', etats);
  const refus = await PUSH.envoyerPush({ abonnement: { endpoint: 'https://exemple.test/x', keys: ab.keys }, donnees: {}, vapid, maintenant: T0, fetch: async () => { vu.push('APPEL'); return new Response(null, { status: 201 }); } });
  t('envoi : endpoint hors liste refusé sans aucun appel réseau', refus.etat === 'refuse' && vu[vu.length - 1] !== 'APPEL');
}

/* ---------- monde simulé : KV, Bien'ici, service de notification ---------- */
function fausseKV() {
  const m = new Map(), n = { get: 0, put: 0, delete: 0, list: 0 };
  return {
    m, n,
    async get(k) { n.get++; return m.has(k) ? m.get(k) : null; },
    async put(k, v) { n.put++; m.set(k, String(v)); },
    async delete(k) { n.delete++; m.delete(k); },
    async list(o = {}) { n.list++; return { keys: [...m.keys()].filter((k) => k.startsWith(o.prefix || '')).sort().map((name) => ({ name })), list_complete: true }; }
  };
}
const ORIG = 'https://exemple.github.io';
const pvS = await ST.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const ENV = { ORIGINES: ORIG + ', https://autre-origine-permise.test', VAPID_PUBLIQUE: PUSH.b64uEnc(new Uint8Array(await ST.exportKey('raw', pvS.publicKey))), VAPID_PRIVEE: JSON.stringify(await ST.exportKey('jwk', pvS.privateKey)), VAPID_SUJET: 'https://exemple.test/contact' };
function rep(s, corps) { return new Response(corps == null ? null : JSON.stringify(corps), { status: s, headers: { 'Content-Type': 'application/json' } }); }
function monde(debut) {
  const W = { T: debut, annonces: new Map(), horsRecherche: new Map(), appels: [], pushs: [], statutPush: 201, kv: fausseKV(), navs: new Map() };
  W.fetch = async (url, o = {}) => {
    const u = new URL(url);
    W.appels.push(u.hostname + u.pathname);
    if (u.hostname === 'www.bienici.com' && u.pathname === '/realEstateAds.json') {
      const f = JSON.parse(u.searchParams.get('filters'));
      const z = f.zoneIdsByTypes.zoneIds;
      const liste = [...W.annonces.values()].filter((a) => z.indexOf(a._zone) >= 0 && (f.maxPrice == null || a.price <= f.maxPrice));
      return rep(200, { total: liste.length, realEstateAds: liste.slice(f.from, f.from + f.size) });
    }
    if (u.hostname === 'www.bienici.com' && u.pathname === '/realEstateAd.json') {
      const a = W.annonces.get(u.searchParams.get('id')) || W.horsRecherche.get(u.searchParams.get('id'));
      return a ? rep(200, a) : rep(404, { message: 'introuvable' });
    }
    if (PUSH.endpointAccepte(url)) { W.pushs.push({ url, o }); return rep(typeof W.statutPush === 'function' ? W.statutPush(url) : W.statutPush, null); }
    return rep(404, null);
  };
  W.ctx = { kv: W.kv, fetch: W.fetch, maintenant: () => W.T, env: ENV, attendre: async () => {} };
  W.releve = (o = {}) => SA.releve(W.ctx, Object.assign({ pause: 0 }, o));
  W.req = async (methode, chemin, corps, origine = ORIG) => {
    const h = { 'Content-Type': 'application/json' };
    if (origine) h.Origin = origine;
    const r = await SA.traiterRequete(new Request('https://alertes.test' + chemin, { method: methode, headers: h, body: corps === undefined ? undefined : (typeof corps === 'string' ? corps : JSON.stringify(corps)) }), W.ctx);
    let c = null; try { c = await r.json(); } catch (e) { c = null; }
    return { statut: r.status, corps: c, h: r.headers };
  };
  /* Messages reçus par un endpoint, déchiffrés comme le ferait le téléphone. */
  W.recus = async (endpoint) => {
    const n = W.navs.get(endpoint);
    const out = [];
    for (const p of W.pushs.filter((x) => x.url === endpoint)) {
      const o = await essai(() => dechiffrerNavigateur(p.o.body, n.jwk, n.pub, n.auth));
      out.push(o ? JSON.parse(TD.decode(o)) : { illisible: true });
    }
    return out;
  };
  return W;
}
let numAnnonce = 0;
function annonce(o = {}) {
  numAnnonce++;
  return Object.assign({}, AD, { id: 'x' + numAnnonce, reference: 'R' + numAnnonce, _zone: '-91746', price: 1800, publicationDate: '2026-11-18T08:00:00Z' }, o);
}
const RECH = { v: 1, lieux: [{ nom: 'Bois-Colombes', type: 'city', cp: ['92270'], zoneIds: ['-91746'], etat: 'oui' }], quartiersEcartes: [], types: ['flat', 'house'], loyerMax: 1950, surfMin: 60, piecesMin: 3, chMin: 2, meuble: 'exclu', equip: { ext: 'indifferent', cave: 'indifferent', parking: 'indifferent', ascenseur: 'indifferent' }, dpeMax: '', rdc: 'indifferent', agencesSeulement: true };
let numAb = 0;
async function inscrire(W, o = {}) {
  numAb++;
  const nav = await paireNavigateur();
  const endpoint = 'https://fcm.googleapis.com/fcm/send/abonne-' + numAb;
  W.navs.set(endpoint, nav);
  const corps = Object.assign({
    abonnement: { endpoint, keys: { p256dh: nav.p256dh, auth: nav.authB64 } },
    jeton: PUSH.b64uEnc(globalThis.crypto.getRandomValues(new Uint8Array(32))),
    recherche: RECH, suivis: [], silence: null, declencheurs: { nouvelles: true, retirees: true, baisses: true }
  }, o);
  const r = await W.req('PUT', '/abonnement', corps);
  return { endpoint, corps, r, id: await sha(endpoint) };
}
async function sha(s) { return [...new Uint8Array(await ST.digest('SHA-256', TE.encode(s)))].map((x) => x.toString(16).padStart(2, '0')).join(''); }
const etatDe = (W, id) => JSON.parse(W.kv.m.get('et:' + id) || 'null');
const abDe = (W, id) => JSON.parse(W.kv.m.get('ab:' + id) || 'null');
const HIVER = Date.UTC(2026, 10, 18, 10, 0); /* 11 h 00 à Paris */

groupe('Alertes : routes du serveur');
{
  const W = monde(HIVER);
  const cle = await W.req('GET', '/cle');
  t('GET /cle -> clé publique', cle.statut === 200 && cle.corps.publique === ENV.VAPID_PUBLIQUE && cle.h.get('Access-Control-Allow-Origin') === ORIG);
  const pre = await SA.traiterRequete(new Request('https://alertes.test/abonnement', { method: 'OPTIONS', headers: { Origin: ORIG, 'Access-Control-Request-Method': 'PUT' } }), W.ctx);
  t('CORS : pré-vol accepté pour une origine de la liste', pre.status === 204 && pre.headers.get('Access-Control-Allow-Origin') === ORIG && /PUT/.test(pre.headers.get('Access-Control-Allow-Methods')));
  const a = await inscrire(W);
  t('PUT /abonnement : inscription acceptée (201)', a.r.statut === 201, a.r);
  const ab = abDe(W, a.id);
  t('identifiant = SHA-256 de l’endpoint ; jeton gardé en empreinte seulement', !!ab && ab.id === a.id && ab.jeton === await sha(a.corps.jeton) && W.kv.m.get('ab:' + a.id).indexOf(a.corps.jeton) < 0);
  t('index tenu à jour', JSON.parse(W.kv.m.get('index')).indexOf(a.id) >= 0);
  const autre = await W.req('PUT', '/abonnement', a.corps, 'https://site-tiers.test');
  t('CORS : origine hors liste refusée (403, sans en-tête CORS)', autre.statut === 403 && !autre.h.get('Access-Control-Allow-Origin'));
  const sansOrig = await W.req('PUT', '/abonnement', a.corps, null);
  t('PUT sans origine refusé', sansOrig.statut === 403);
  const dest = await W.req('PUT', '/abonnement', Object.assign({}, a.corps, { recherche: Object.assign({}, RECH, { destinations: [] }) }));
  t('corps contenant « destinations » rejeté, message clair', dest.statut === 400 && /trajets/.test(dest.corps.erreur), dest.corps);
  const adr = await W.req('PUT', '/abonnement', Object.assign({}, a.corps, { adresseActuelle: { label: 'x', lat: 48.9, lon: 2.2 } }));
  t('corps contenant « adresseActuelle » rejeté', adr.statut === 400 && /adresse actuelle/.test(adr.corps.erreur), adr.corps);
  const prof = await W.req('PUT', '/abonnement', Object.assign({}, a.corps, { suivis: [{ id: 'bi-1', loyer: 1, destinations: [{ adresse: 'x' }] }] }));
  t('champ interdit rejeté même enfoui', prof.statut === 400, prof.corps);
  const mal = await W.req('PUT', '/abonnement', Object.assign({}, a.corps, { abonnement: { endpoint: 'https://exemple.test/push', keys: a.corps.abonnement.keys } }));
  t('endpoint hors liste rejeté (400)', mal.statut === 400 && /notification/.test(mal.corps.erreur), mal.corps);
  const vol = await W.req('PUT', '/abonnement', Object.assign({}, a.corps, { jeton: PUSH.b64uEnc(new Uint8Array(32).fill(7)) }));
  t('jeton exigé pour modifier (403)', vol.statut === 403, vol.corps);
  const del1 = await W.req('DELETE', '/abonnement', { endpoint: a.endpoint, jeton: PUSH.b64uEnc(new Uint8Array(32).fill(7)) });
  t('jeton exigé pour supprimer (403)', del1.statut === 403 && !!abDe(W, a.id));
  const meme = await W.req('PUT', '/abonnement', a.corps);
  t('même contenu renvoyé : accepté sans écriture', meme.statut === 200 && meme.corps.inchange === true);
  const vite = await W.req('PUT', '/abonnement', Object.assign({}, a.corps, { silence: { debut: '23:00', fin: '06:00' } }));
  t('au plus une modification par minute (429 + Retry-After)', vite.statut === 429 && Number(vite.h.get('Retry-After')) > 0, vite.statut);
  W.T += 61000;
  const apres = await W.req('PUT', '/abonnement', Object.assign({}, a.corps, { silence: { debut: '23:00', fin: '06:00' } }));
  t('modification acceptée une minute plus tard', apres.statut === 200 && abDe(W, a.id).silence.debut === '23:00');
  const trop = await W.req('PUT', '/abonnement', JSON.stringify(Object.assign({}, a.corps, { bourrage: 'x'.repeat(33 * 1024) })));
  t('corps > 32 Ko refusé (413)', trop.statut === 413);
  const lieux31 = Array.from({ length: 31 }, (_, i) => ({ nom: 'L' + i, zoneIds: ['-' + (1000 + i)], etat: 'oui' }));
  const z31 = await W.req('PUT', '/abonnement', Object.assign({}, a.corps, { recherche: Object.assign({}, RECH, { lieux: lieux31 }) }));
  t('plus de 30 zones refusé', z31.statut === 400 && /30/.test(z31.corps.erreur), z31.corps);
  const s201 = await W.req('PUT', '/abonnement', Object.assign({}, a.corps, { suivis: Array.from({ length: 201 }, (_, i) => ({ id: 'bi-' + i, loyer: 1000 })) }));
  t('plus de 200 annonces suivies refusé', s201.statut === 400);
  const champ = await W.req('PUT', '/abonnement', Object.assign({}, a.corps, { recherche: Object.assign({}, RECH, { lignesPreferees: ['13'] }) }));
  t('champ de critères inattendu refusé', champ.statut === 400);
  t('aucune route ne liste les abonnements', (await W.req('GET', '/abonnement')).statut === 404 && (await W.req('GET', '/index')).statut === 404 && (await W.req('GET', '/')).statut === 404);
  const del2 = await W.req('DELETE', '/abonnement', { endpoint: a.endpoint, jeton: a.corps.jeton });
  t('DELETE avec le bon jeton : abonnement et état effacés', del2.statut === 200 && !W.kv.m.has('ab:' + a.id) && !W.kv.m.has('et:' + a.id) && JSON.parse(W.kv.m.get('index')).indexOf(a.id) < 0);
  W.kv.m.set('index', JSON.stringify(Array.from({ length: 300 }, (_, i) => 'id' + i)));
  const plein = await inscrire(W);
  t('plafond de 300 abonnements : refus poli (503)', plein.r.statut === 503 && /complet/.test(plein.r.corps.erreur), plein.r);
  const PO2 = profilExemple();
  const W2 = monde(HIVER);
  const app = await inscrire(W2, { recherche: CA.rechercheAlerte(PO2), suivis: CA.suivisAlerte([]) });
  t('corps construit par l’appli (profil d’exemple) accepté par le serveur', app.r.statut === 201, app.r.corps);
}

groupe('Alertes : relève simulée');
{
  /* Scénario principal : un téléphone, une recherche. */
  const W = monde(HIVER);
  const base = [annonce(), annonce(), annonce({ price: 1900 })];
  base.forEach((a) => W.annonces.set(a.id, a));
  const suivie = annonce({ price: 1850 });
  W.annonces.set(suivie.id, suivie);
  const a = await inscrire(W, { suivis: [{ id: 'bi-' + suivie.id, loyer: 1850 }] });
  let r = await W.releve();
  t('première relève silencieuse (tout marqué vu, aucune notification)', W.pushs.length === 0 && etatDe(W, a.id).init === true && Object.keys(etatDe(W, a.id).vus).length === 4, r);
  const kvAvant = W.kv.n.put + W.kv.n.delete;
  W.T += 15 * 60000;
  r = await W.releve();
  t('relève sans changement : aucune écriture KV, aucune notification', W.kv.n.put + W.kv.n.delete === kvAvant && W.pushs.length === 0, r);

  const n1 = annonce({ district: { libelle: 'Bécon' }, city: 'Asnières-sur-Seine', surfaceArea: 70, price: 1725 });
  W.annonces.set(n1.id, n1);
  W.T += 15 * 60000;
  r = await W.releve();
  let m = await W.recus(a.endpoint);
  t('annonce nouvelle conforme -> 1 notification', m.length === 1, r);
  t('notification : titre, corps, lien, tag', m[0] && m[0].t === 'Nouvelle annonce · Asnières, Bécon' && m[0].c === '70 m² · 3 pièces · ' + fmt(1725) + ' € CC' && m[0].u === './?b=bi-' + n1.id && m[0].tag === 'sa-bi-' + n1.id, m[0]);

  const cher = annonce({ price: 2000 });
  W.annonces.set(cher.id, cher);
  W.T += 15 * 60000;
  r = await W.releve();
  t('annonce nouvelle exclue (loyer au-dessus du plafond, mais renvoyée par Bien’ici) -> 0', W.pushs.length === 1 && !!etatDe(W, a.id).vus['bi-' + cher.id], r);

  W.annonces.delete(suivie.id);
  W.T += 15 * 60000;
  r = await W.releve();
  m = await W.recus(a.endpoint);
  t('annonce suivie retirée (fiche 404) -> 1 notification', m.length === 2 && /^Annonce retirée · /.test(m[1].t) && r.fiches === 1, [m[1], r]);
  t('annonce retirée enlevée des suivis côté serveur', abDe(W, a.id).suivis.length === 0);
  W.T += 15 * 60000;
  r = await W.releve();
  t('pas de seconde notification pour la même annonce retirée', W.pushs.length === 2 && r.fiches === 0, r);

  base[0].price = 1725;
  W.T += 15 * 60000;
  r = await W.releve();
  m = await W.recus(a.endpoint);
  t('baisse de loyer -> 1 notification', m.length === 3 && /^Loyer en baisse · /.test(m[2].t) && m[2].c === fmt(1725) + ' € (avant ' + fmt(1800) + ' €)', m[2]);

  const lot = [annonce({ surfaceArea: 61 }), annonce({ surfaceArea: 62 }), annonce({ surfaceArea: 63 }), annonce({ surfaceArea: 64 })];
  lot.forEach((x) => W.annonces.set(x.id, x));
  W.T += 15 * 60000;
  r = await W.releve();
  m = await W.recus(a.endpoint);
  t('plusieurs nouveautés -> 1 notification groupée', m.length === 4 && m[3].t === '4 nouvelles annonces' && m[3].u === './' && m[3].c.split('\n').length === 4 && /de plus$/.test(m[3].c), m[3]);
  t('message toujours ≤ 2 Ko', m.every((x) => TE.encode(JSON.stringify(x)).length <= 2048));

  /* 429 : gardé, réessayé ; 410 : abonnement effacé */
  W.statutPush = 429;
  W.annonces.set('z1', annonce({ id: 'z1' }));
  W.T += 15 * 60000;
  r = await W.releve();
  t('429 du service : message gardé pour la relève suivante', etatDe(W, a.id).attente.length === 1 && etatDe(W, a.id).essais === 1 && r.echecsPush === 1, r);
  W.statutPush = 201;
  W.T += 15 * 60000;
  r = await W.releve();
  m = await W.recus(a.endpoint);
  t('… puis envoyé quand le service répond', r.notifications === 1 && etatDe(W, a.id).attente.length === 0 && m[m.length - 1].u === './?b=bi-z1', r);
  W.statutPush = 410;
  W.annonces.set('z2', annonce({ id: 'z2' }));
  W.T += 15 * 60000;
  r = await W.releve();
  t('410 du service : abonnement effacé (abonnement, état, index)', !W.kv.m.has('ab:' + a.id) && !W.kv.m.has('et:' + a.id) && JSON.parse(W.kv.m.get('index')).indexOf(a.id) < 0 && r.supprimes === 1, r);
}
{
  /* Heures de silence, heure de Paris (été/hiver). */
  t('heure de Paris en hiver (UTC+1)', SA.minutesParis(Date.UTC(2026, 0, 15, 20, 30)) === 21 * 60 + 30);
  t('heure de Paris en été (UTC+2)', SA.minutesParis(Date.UTC(2026, 6, 15, 20, 30)) === 22 * 60 + 30);
  t('passage à l’heure d’été (29/03/2026) : 01:30 UTC = 03:30 Paris', SA.minutesParis(Date.UTC(2026, 2, 29, 1, 30)) === 3 * 60 + 30);
  const P = { debut: '22:00', fin: '07:00' };
  t('silence 22:00-07:00 : 20:30 UTC = 22:30 l’été (silence), 21:30 l’hiver (pas de silence)', SA.enSilence(Date.UTC(2026, 6, 15, 20, 30), P) && !SA.enSilence(Date.UTC(2026, 0, 15, 20, 30), P));
  t('silence de jour (12:00-14:00) et plage nulle', SA.enSilence(Date.UTC(2026, 0, 15, 12, 0), { debut: '12:00', fin: '14:00' }) && !SA.enSilence(Date.UTC(2026, 0, 15, 12, 0), { debut: '12:00', fin: '12:00' }) && !SA.enSilence(HIVER, null));
  const W = monde(Date.UTC(2026, 10, 18, 21, 0)); /* 22 h 00 à Paris */
  W.annonces.set('s0', annonce({ id: 's0' }));
  const a = await inscrire(W, { silence: P });
  await W.releve();
  W.annonces.set('s1', annonce({ id: 's1' }));
  W.T = Date.UTC(2026, 10, 18, 22, 30); /* 23 h 30 */
  let r = await W.releve();
  W.annonces.set('s2', annonce({ id: 's2' }));
  W.T = Date.UTC(2026, 10, 19, 3, 0); /* 4 h 00 */
  r = await W.releve();
  t('plage de silence : notifications gardées, rien d’envoyé', W.pushs.length === 0 && etatDe(W, a.id).attente.length === 2, r);
  W.T = Date.UTC(2026, 10, 19, 6, 15); /* 7 h 15 */
  r = await W.releve();
  const m = await W.recus(a.endpoint);
  t('fin de plage : envoyées en une seule notification groupée', m.length === 1 && m[0].t === '2 nouvelles annonces' && etatDe(W, a.id).attente.length === 0, m);
}
{
  /* Budget : 60 abonnements, recherches distinctes. */
  const W = monde(HIVER);
  for (let i = 0; i < 4; i++) W.annonces.set('b' + i, annonce({ id: 'b' + i, price: 1400 }));
  const abs = [];
  for (let i = 0; i < 60; i++) abs.push(await inscrire(W, { recherche: Object.assign({}, RECH, { loyerMax: 1500 + i * 5 }) }));
  t('60 inscriptions acceptées', abs.every((x) => x.r.statut === 201));
  const parReleve = [];
  let initialises = 0, tours = 0;
  while (initialises < 60 && tours < 6) {
    const avant = W.appels.length;
    const r = await W.releve();
    parReleve.push([W.appels.length - avant, r.sousRequetes, r.traites]);
    W.T += 15 * 60000; tours++;
    initialises = abs.filter((x) => (etatDe(W, x.id) || {}).init).length;
  }
  t('budget : au plus 40 sous-requêtes par relève (appels réels comptés)', parReleve.every((x) => x[0] <= 40 && x[1] <= 40), parReleve);
  t('budget : les 60 abonnements traités à tour de rôle en 2 relèves', initialises === 60 && tours === 2, [initialises, tours, parReleve]);
  for (let i = 0; i < 3; i++) W.annonces.set('c' + i, annonce({ id: 'c' + i, price: 1400 }));
  const notifies = new Set();
  const parReleve2 = [];
  for (let k = 0; k < 6 && notifies.size < 60; k++) {
    const avant = W.appels.length;
    await W.releve();
    parReleve2.push(W.appels.length - avant);
    W.pushs.forEach((p) => notifies.add(p.url));
    W.T += 15 * 60000;
  }
  t('budget : recherche + notification pour 60 abonnements, ≤ 40 appels par relève', parReleve2.every((x) => x <= 40) && notifies.size === 60, [parReleve2, notifies.size]);
  t('budget : une seule notification par téléphone et par relève', W.pushs.length === 60);
  /* Plafond facultatif par relève (ABONNEMENTS_PAR_RELEVE) : tour de rôle conservé. */
  const W3 = monde(HIVER);
  W3.annonces.set('t0', annonce({ id: 't0' }));
  const abs3 = [];
  for (let i = 0; i < 12; i++) abs3.push(await inscrire(W3, { recherche: Object.assign({}, RECH, { loyerMax: 1500 + i }) }));
  W3.ctx.env = Object.assign({}, ENV, { ABONNEMENTS_PAR_RELEVE: '5' });
  const traites3 = [];
  for (let k = 0; k < 3; k++) { traites3.push((await W3.releve()).traites); W3.T += 15 * 60000; }
  t('plafond de 5 abonnements par relève : 12 abonnements tous initialisés en 3 relèves (tour de rôle)', traites3.join() === '5,5,5' && abs3.every((x) => (etatDe(W3, x.id) || {}).init), traites3);
  /* Même recherche pour 60 abonnements : une seule requête partagée. */
  const W2 = monde(HIVER);
  W2.annonces.set('p0', annonce({ id: 'p0' }));
  for (let i = 0; i < 60; i++) await inscrire(W2);
  const r2 = await W2.releve();
  t('mêmes filtres : une seule recherche Bien’ici pour 60 abonnements', W2.appels.filter((x) => /realEstateAds/.test(x)).length === 1 && r2.traites === 60, r2);
}
{
  /* Oubli après 45 jours sans nouvelles du téléphone. */
  const W = monde(HIVER);
  W.annonces.set('o0', annonce({ id: 'o0' }));
  const a = await inscrire(W), b = await inscrire(W);
  await W.releve();
  const ab = abDe(W, a.id); ab.contactLe = W.T - 46 * 86400000; W.kv.m.set('ab:' + a.id, JSON.stringify(ab));
  const bb = abDe(W, b.id); bb.contactLe = W.T - 44 * 86400000; W.kv.m.set('ab:' + b.id, JSON.stringify(bb));
  W.T += 15 * 60000;
  const r = await W.releve();
  t('expiration : 46 jours sans contact -> effacé ; 44 jours -> gardé', !W.kv.m.has('ab:' + a.id) && !W.kv.m.has('et:' + a.id) && W.kv.m.has('ab:' + b.id) && JSON.parse(W.kv.m.get('index')).join() === b.id, r);
  /* Changement des filtres : nouvelle base silencieuse, pas de rafale. */
  for (let i = 0; i < 5; i++) W.annonces.set('q' + i, annonce({ id: 'q' + i, _zone: '-91738' }));
  W.T += 61000;
  const maj = await W.req('PUT', '/abonnement', Object.assign({}, b.corps, { recherche: Object.assign({}, RECH, { lieux: RECH.lieux.concat([{ nom: 'Colombes', zoneIds: ['-91738'], etat: 'oui' }]) }) }));
  W.T += 15 * 60000;
  const r2 = await W.releve();
  t('lieu ajouté aux critères : relève suivante silencieuse (pas de rafale)', maj.statut === 200 && W.pushs.length === 0 && Object.keys(etatDe(W, b.id).vus).length === 6, [maj.statut, r2]);
}

groupe('Alertes : application');
{
  const PO3 = profilExemple();
  const env = CA.rechercheAlerte(PO3);
  const txt = JSON.stringify(env);
  t('critères envoyés : ni destinations ni adresse actuelle', !('destinations' in env) && !('adresseActuelle' in env) && !CA.contientChampInterdit(env));
  t('critères envoyés : aucune adresse de trajet ni adresse actuelle dans le texte', PO3.destinations.every((d) => txt.indexOf(d.adresse) < 0 && txt.indexOf(String(d.lat)) < 0) && txt.indexOf(PO3.adresseActuelle.label) < 0);
  t('critères envoyés : ni préférences de transport ni date de sortie', !('lignesPreferees' in env) && !('modes' in env) && !('sortie' in env) && !('marcheMax' in env));
  t('critères envoyés : lieux et fourchettes présents', env.lieux.length === 3 && env.loyerMax === 1950 && env.surfMin === 60 && env.piecesMin === 3);
  t('critères envoyés : l’objet de l’appli n’est pas modifié', Array.isArray(PO3.destinations) && PO3.destinations.length === 2);
  const biens = [
    { id: 'bi-1', src: 'bienici', cote: true, loyer: 1700 },
    { id: 'bi-2', src: 'bienici', status: 'visite', loyer: 1800 },
    { id: 'bi-3', src: 'bienici', status: 'nouveau', loyer: 1600 },
    { id: 'bi-4', src: 'bienici', cote: true, dispo: 'retiree', loyer: 1500 },
    { id: 'm-5', src: 'manuel', cote: true, loyer: 1400, notes: 'note privée' }
  ];
  const sv = CA.suivisAlerte(biens);
  t('suivis envoyés : mis de côté ou suivis, en ligne, Bien’ici, numéro et loyer seulement', JSON.stringify(sv) === JSON.stringify([{ id: 'bi-1', loyer: 1700 }, { id: 'bi-2', loyer: 1800 }]), sv);
  const { ALERTES_URL: AU } = await import('../js/config.js');
  const AL = await import('../js/alertes.js');
  const fetchAvant = globalThis.fetch;
  let appels = 0;
  globalThis.fetch = async () => { appels++; return new Response('{}'); };
  try {
    if (!AU) {
      const a1 = await AL.activer(), s1 = await AL.syncMaintenant(true);
      AL.synchroniser(); AL.modifierReglages({ silenceActif: false });
      const d1 = await AL.desactiver();
      t('ALERTES_URL vide : rien d’actif, aucun appel réseau', !AL.disponible() && AL.capacite() === 'indisponible' && a1 === 'indisponible' && s1 === 'inactif' && d1 === 'indisponible' && appels === 0 && AL.A.actif === false, [a1, s1, d1, appels]);
    } else t('ALERTES_URL renseigné : module disponible', AL.disponible());
  } finally { globalThis.fetch = fetchAvant; }
  const srcApp = readFileSync(join(APP, 'js', 'app.js'), 'utf8');
  t('ALERTES_URL vide : aucun import statique du code d’alerte, chargement sous condition', !/^import[^\n]*alertes/m.test(srcApp) && /if \(ALERTES_URL\) \{\s*try \{ alertesUI = await import\('\.\/ui\/alertes-ui\.js'\)/.test(srcApp));
  const srcCrit = readFileSync(join(APP, 'js', 'ui', 'criteres-ui.js'), 'utf8');
  t('section « Alertes » absente sans le module', /crochets\.alertes \? SECTIONS\.concat/.test(srcCrit) && !/^import[^\n]*alertes/m.test(srcCrit));
  /* Politique de sécurité : l'origine du serveur d'alertes doit figurer dans connect-src. */
  const csp = (readFileSync(join(APP, 'index.html'), 'utf8').match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
  const connect = ((csp.split(';').map((x) => x.trim()).find((x) => x.startsWith('connect-src')) || '').split(/\s+/)).slice(1);
  const couvre = (u) => connect.indexOf(new URL(u).origin) >= 0;
  t('connect-src lu dans index.html', connect.indexOf('https://www.bienici.com') >= 0);
  t('test de cohérence efficace : une origine absente de connect-src est détectée', !couvre('https://suivi-appart-alertes.exemple.workers.dev'));
  t('ALERTES_URL : son origine figure dans connect-src (ou ALERTES_URL vide)', !AU || couvre(AU), AU);
  t('ALERTES_URL : https et sans barre finale (ou vide)', !AU || (/^https:\/\//.test(AU) && !/\/$/.test(AU)));
  const swSrc = readFileSync(join(APP, 'sw.js'), 'utf8');
  t('service worker : push, notificationclick, pushsubscriptionchange', /addEventListener\('push'/.test(swSrc) && /addEventListener\('notificationclick'/.test(swSrc) && /addEventListener\('pushsubscriptionchange'/.test(swSrc) && /showNotification\(/.test(swSrc));
}

groupe('Alertes : cohérence du code');
{
  const { spawnSync } = await import('node:child_process');
  const tous = [join(APP, 'sw.js'), join(APP, 'tests', 'run.mjs')]
    .concat(fichiers(join(APP, 'js'), ['.js']))
    .concat(readdirSync(join(APP, 'serveur', 'src')).map((f) => join(APP, 'serveur', 'src', f)))
    .concat(readdirSync(join(APP, 'serveur', 'outils')).map((f) => join(APP, 'serveur', 'outils', f)));
  const ko2 = tous.filter((f) => spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' }).status !== 0);
  t('node --check : ' + tous.length + ' fichiers JS (appli, service worker, serveur, tests)', ko2.length === 0, ko2);
  const srv = readdirSync(join(APP, 'serveur', 'src')).map((f) => join(APP, 'serveur', 'src', f)).concat(readdirSync(join(APP, 'serveur', 'outils')).map((f) => join(APP, 'serveur', 'outils', f)));
  let kos = [];
  for (const f of srv) {
    const src = readFileSync(f, 'utf8');
    for (const mt of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g)) {
      const cible = resolve(dirname(f), mt[2]);
      let csrc; try { csrc = readFileSync(cible, 'utf8'); } catch (e) { kos.push(f + ' -> ' + mt[2]); continue; }
      for (let nom of mt[1].split(',')) { nom = nom.trim().split(/\s+as\s+/)[0]; if (nom && !new RegExp('export\\s+(async\\s+)?(function|const|let|class)\\s+' + nom + '\\b').test(csrc)) kos.push(f.replace(APP + '/', '') + ' : ' + nom); }
    }
    for (const mt of src.matchAll(/https?:\/\/([a-z0-9.*-]+)/gi)) kos.push(f.replace(APP + '/', '') + ' : adresse en dur ' + mt[1]);
  }
  t('serveur : chaque nom importé est exporté, aucune adresse en dur', kos.length === 0, kos);
  const imports = [...readFileSync(join(APP, 'serveur', 'src', 'alertes.js'), 'utf8').matchAll(/from '(\.\.\/\.\.\/js\/[^']+)'/g)].map((x) => x[1]);
  t('serveur : réutilise le code de l’appli (bienici, criteres, score, util, config, alertes)', ['bienici', 'criteres', 'score', 'util', 'config', 'alertes'].every((m) => imports.some((i) => i.indexOf('/' + m + '.js') >= 0)), imports);
  const wr = readFileSync(join(APP, 'serveur', 'wrangler.toml'), 'utf8');
  t('wrangler.toml : nom, main, cron 15 min, KV ALERTES, variables, aucun secret', /name = "suivi-appart-alertes"/.test(wr) && /main = "src\/worker\.js"/.test(wr) && /crons = \["\*\/15 \* \* \* \*"\]/.test(wr) && /binding = "ALERTES"/.test(wr) && /ORIGINES =/.test(wr) && /VAPID_PUBLIQUE =/.test(wr) && /VAPID_SUJET =/.test(wr) && !/"d"\s*:/.test(wr) && !/^VAPID_PRIVEE\s*=/m.test(wr));
}

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
