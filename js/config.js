/* Nom de l'application : une seule constante (avec manifest.webmanifest et <title>). */
export const APP_NOM = 'Suivi appart';
/* Doit rester égal à VERSION dans sw.js. */
export const APP_VERSION = '1.3.1';

/* Serveur d'alertes par notification (facultatif, voir serveur/LISEZMOI.md), sans barre finale.
   Chaîne vide : la fonction est entièrement masquée et aucun code d'alerte ne s'exécute.
   À la mise en service, ajouter aussi son origine à connect-src dans index.html (un test le vérifie). */
export const ALERTES_URL = '';

/* Seuls hôtes contactés par l'application (en plus d'elle-même). */
export const HOTES_AUTORISES = [
  'www.bienici.com', 'res.bienici.com', 'file.bienici.com',
  'api.transitous.org', 'api-adresse.data.gouv.fr', 'data.iledefrance-mobilites.fr'
];

/* Service de chaque hôte (écran « Relève en direct » : une ligne par service). */
export const SERVICES_HOTES = {
  'www.bienici.com': 'bienici', 'res.bienici.com': 'bienici', 'file.bienici.com': 'bienici',
  'api.transitous.org': 'transitous', 'api-adresse.data.gouv.fr': 'adresse', 'data.iledefrance-mobilites.fr': 'idfm'
};

/* Délai minimal entre deux requêtes vers un même hôte (politesse envers les services publics). */
export const INTERVALLES_MS = {
  'api.transitous.org': 1000,
  'data.iledefrance-mobilites.fr': 1000,
  'www.bienici.com': 600,
  'res.bienici.com': 250,
  'api-adresse.data.gouv.fr': 250
};

/* Transitous demande d'identifier l'application : dans un navigateur, l'en-tête Referer (origine du site)
   remplace le User-Agent ; le site qui héberge l'appli doit alors afficher un contact. Hors navigateur
   (tests Node), un User-Agent nommé est envoyé. Contact à renseigner avant publication. */
export const CONTACT_APP = 'https://github.com/oliviervehert-maker/suivi-appart/issues';
export const REFERER_ORIGINE = ['api.transitous.org'];

export const RECHERCHE_AUTO_MIN = 30;
export const CACHE_TRAJET_JOURS = 14;
export const CACHE_ARRETS_JOURS = 60;
