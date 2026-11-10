/* Nom de l'application : une seule constante (avec manifest.webmanifest et <title>). */
export const APP_NOM = 'Suivi appart';
/* Doit rester égal à VERSION dans sw.js. */
export const APP_VERSION = '1.0.4';

/* Seuls hôtes contactés par l'application (en plus d'elle-même). */
export const HOTES_AUTORISES = [
  'www.bienici.com', 'res.bienici.com', 'file.bienici.com',
  'api.transitous.org', 'api-adresse.data.gouv.fr', 'data.iledefrance-mobilites.fr'
];

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
