# Serveur d'alertes de Suivi appart

Petit serveur facultatif qui interroge Bien'ici toutes les 15 minutes à la place du téléphone et le réveille par une notification (Web Push), même application fermée. Sans lui, l'application fonctionne comme avant : il faut l'ouvrir pour voir une nouveauté.

Tant que `ALERTES_URL` est vide dans `js/config.js` (état livré), la fonction est entièrement masquée dans l'application et aucun code d'alerte ne s'exécute.

## Ce que le serveur reçoit et garde

Principe : le serveur ne reçoit que ce que Bien'ici reçoit déjà, plus les numéros des annonces suivies et l'adresse technique de notification du téléphone.

| Reçu du téléphone | Détail |
|---|---|
| Critères de recherche | lieux (zones Bien'ici), type de bien, loyer plafond, surface et pièces minimum ; plus, pour écarter exactement les mêmes annonces que l'application : chambres minimum, meublé, équipements indispensables, diagnostic énergie, rez-de-chaussée, agences seulement, quartiers écartés |
| Annonces suivies | numéro de l'annonce et dernier loyer connu, 200 au plus |
| Adresse de notification | endpoint du service du fabricant (Apple, Google, Mozilla, Microsoft) et clés publiques de chiffrement |
| Réglages d'alerte | déclencheurs, plage de silence |
| Jeton | secret aléatoire créé par le téléphone ; le serveur n'en garde que l'empreinte SHA-256 |

Jamais : les adresses des trajets (`destinations`, toute requête qui en contient est rejetée), l'adresse actuelle (`adresseActuelle`, idem), les notes, les statuts, un nom, un e-mail. Les préférences de transport et la date de sortie ne sont pas envoyées non plus.

Gardé dans le stockage clé-valeur :

| Clé | Contenu |
|---|---|
| `ab:<sha256 de l'endpoint>` | l'inscription ci-dessus, dates de création, de modification, de dernier contact |
| `et:<même id>` | annonces déjà vues (numéro, loyer, commune et quartier, surface, pièces), annonces retirées déjà signalées, notifications en attente |
| `index`, `curseur`, `menage` | liste des identifiants, position du tour de rôle, date du dernier ménage |

Effacement : tout disparaît quand les alertes sont coupées (ou par « Tout effacer » dans l'application), quand le service de notification répond 404 ou 410, et après 45 jours sans nouvelles du téléphone. Aucune route ne liste les abonnements.

## Mise en service, pas à pas

Prérequis : Node 18 ou plus récent. Aucune installation globale : `npx wrangler` télécharge l'outil de Cloudflare à la demande.

1. **Clés VAPID.** Depuis le dossier de l'application :
   `node serveur/outils/generer-cles.mjs`
   Le script affiche les deux clés et n'écrit rien sur le disque. Copier la clé publique dans `serveur/wrangler.toml` (`VAPID_PUBLIQUE`). Garder la ligne JSON de la clé privée pour l'étape 4, sans jamais l'enregistrer dans le dépôt.
2. **Compte.** Créer un compte Cloudflare (offre gratuite), puis : `cd serveur && npx wrangler login`.
3. **Stockage.** `npx wrangler kv namespace create ALERTES` ; coller l'`id` rendu à la place de `A_REMPLIR` dans `wrangler.toml`.
4. **Secret.** `npx wrangler secret put VAPID_PRIVEE`, puis coller la ligne JSON de la clé privée.
5. **Origines.** Vérifier `ORIGINES` dans `wrangler.toml` : l'origine exacte du site qui sert l'application (`https://oliviervehert-maker.github.io` pour GitHub Pages, sans chemin ni barre finale).
6. **Déploiement.** `npx wrangler deploy`. L'adresse rendue ressemble à `https://suivi-appart-alertes.<compte>.workers.dev`.
7. **Contrôle.** `curl https://suivi-appart-alertes.<compte>.workers.dev/cle` doit rendre `{"publique":"…"}` (la clé de l'étape 1).
8. **Application.**
   - `js/config.js` : `ALERTES_URL = 'https://suivi-appart-alertes.<compte>.workers.dev'` (https, sans barre finale).
   - `index.html` : ajouter cette même origine à la directive `connect-src` de la politique de sécurité (sans quoi le navigateur bloque les appels).
   - Monter la version (`APP_VERSION` dans `js/config.js` et `VERSION` dans `sw.js`, identiques).
   - `node tests/run.mjs` : un test vérifie que l'origine de `ALERTES_URL` figure dans `connect-src` et qu'elle est en https sans barre finale.
   - Publier (commit, push : GitHub Pages).
9. **Téléphone.** Critères, section « Alertes », interrupteur « Alertes sur cet appareil ». Sur iPhone et iPad (iOS 16.4 ou plus récent), l'application doit d'abord être posée sur l'écran d'accueil et ouverte depuis son icône : Safari n'autorise pas les notifications d'un site ouvert dans un onglet.

Les journaux de chaque relève (compteurs seulement, aucune donnée d'abonnement) : `npx wrangler tail`.

## Fonctionnement

- **Relève** toutes les 15 minutes (cron `*/15 * * * *`). Une recherche Bien'ici par abonnement, toutes zones réunies en une requête (mêmes filtres larges que l'application, mêmes marges : plafond + 100 €, surface − 5 m², pièces − 1), 5 pages de 100 au plus. Les abonnements aux mêmes filtres partagent une seule recherche.
- **Verdict** : le serveur importe le code de l'application (`js/core/bienici.js`, `criteres.js`, `score.js`, `util.js`, `alertes.js`, `config.js`) ; une annonce « passe les critères » exactement comme dans l'application, trajets et arrêts exceptés.
- **Première relève** d'un abonnement, et première relève après un changement des filtres de recherche : tout est marqué « vu », aucune notification.
- **Déclencheurs** : annonce nouvelle qui passe les critères ; annonce suivie absente de la recherche dont la fiche répond 404 (5 fiches au plus par relève, à tour de rôle), retirée ensuite des suivis côté serveur ; loyer en baisse sur une annonce suivie ou déjà vue qui passe les critères.
- **Regroupement** : une seule notification par relève et par téléphone ; message `{t, c, u, tag}` chiffré (RFC 8291), jamais plus de 2 Ko.
- **Heures de silence** (heure de Paris, été comme hiver) : les notifications attendent et partent regroupées à la première relève qui traite l'abonnement après la fin de la plage.
- **Échecs d'envoi** : 404 ou 410 : abonnement effacé ; 429 ou 5xx : message gardé, nouvel essai aux relèves suivantes, 3 fois au plus.
- **Écritures** : seulement quand l'état change ; une relève sans nouveauté n'écrit rien. Le contact du téléphone est noté au plus deux fois par jour.

## Limites (offre gratuite de Cloudflare)

- **Sous-requêtes** : 50 par exécution ; le serveur s'en accorde 40 (Bien'ici et services de notification), réparties à tour de rôle entre les abonnements à partir d'un curseur. Avec beaucoup d'abonnements aux filtres différents, chacun est traité moins souvent que toutes les 15 minutes (mesuré en simulation : 60 abonnements traités en 2 relèves).
- **Temps de calcul** : 10 ms de CPU par exécution sur l'offre gratuite. Mesuré sous Node (avec le faux service compris) : environ 3 ms pour une relève sans nouveauté, 6 à 13 ms pour un téléphone avec une notification (40 à 300 annonces), environ 50 ms pour 10 à 30 abonnements. Non mesuré chez Cloudflare. Si le tableau de bord signale des dépassements, renseigner `ABONNEMENTS_PAR_RELEVE` (par exemple `"1"` ou `"2"`) dans `wrangler.toml` : moins d'abonnements par exécution, tous servis à tour de rôle. Au-delà de quelques téléphones, l'offre payante (30 s de CPU) s'impose.
- **Stockage clé-valeur** : environ 1 000 écritures et 100 000 lectures par jour ; cohérence à terme (une modification peut mettre jusqu'à une minute à être vue partout). L'index des abonnements est complété une fois par jour par la liste réelle des clés.
- **Capacité** : 300 abonnements au plus (refus poli au-delà), une modification par abonnement et par minute, 30 zones et 200 annonces suivies au plus, corps de 32 Ko au plus.
- **Services de notification acceptés** : `fcm.googleapis.com`, `*.push.apple.com`, `updates.push.services.mozilla.com`, `*.notify.windows.com`, en https. Tout autre hôte est refusé : le serveur ne sert pas de relais.

## Non vérifié à ce jour

- Accès à Bien'ici depuis les adresses de Cloudflare (le service peut filtrer ces adresses) : à contrôler au premier déploiement, dans `npx wrangler tail` (compteur `recherches` et absence de notifications attendues).
- Réception réelle d'une notification sur un téléphone, comportement sur iPhone, réinscription automatique (`pushsubscriptionchange`) : vérifiés seulement par simulation, aucun envoi à un vrai service de notification.
- Temps de calcul réel chez Cloudflare (voir plus haut).

## Autre hébergeur

`src/alertes.js` ne dépend que de ce qu'on lui injecte : `{ kv, fetch, maintenant, env }` avec `kv.get/put/delete/list` (textes) et `fetch` standard. `src/worker.js` n'est qu'un adaptateur d'une vingtaine de lignes : tout hébergeur offrant requêtes HTTP, tâche périodique et stockage clé-valeur peut appeler `traiterRequete(requete, ctx)` et `releve(ctx)` de la même façon.

## Tests

`node tests/run.mjs` (hors ligne) couvre le serveur : vecteur de l'annexe A de la RFC 8291 reproduit à l'octet près, jeton VAPID vérifié, routes, validations, relèves simulées avec faux Bien'ici, fausse KV et faux service de notification (messages déchiffrés comme par le téléphone).
