# Suivi appart

Application web de recherche de location, à ouvrir dans le navigateur du téléphone et à poser sur l'écran d'accueil.

- Recherche directe par commune, sans compte et sans alerte à créer.
- Critères personnalisables : budget, surface, lieux, trajets du quotidien (travail, école…), transports à proximité (modes, lignes préférées ou à éviter).
- Suivi des annonces : statut, notes, mises de côté, visites, export tableur.

## Vie privée

Aucun serveur, aucun compte, aucune mesure d'audience. Les critères, les adresses et les notes restent sur l'appareil.
Le téléphone interroge directement, sans intermédiaire :

| Service | Ce qu'il reçoit |
|---|---|
| Bien'ici | les communes et les fourchettes de la recherche |
| Transitous | la position approchée d'une annonce et les coordonnées d'une destination |
| Base adresse nationale | le texte d'adresse tapé |
| Île-de-France Mobilités | la position approchée d'une annonce |

## Sources et conditions

- Annonces : Bien'ici. L'application lit les annonces publiques et renvoie toujours vers l'annonce d'origine.
- Trajets et arrêts : [Transitous](https://transitous.org/sources/), service bénévole, usage non commercial ; données piétonnes © contributeurs OpenStreetMap.
- Arrêts et lignes d'Île-de-France : Île-de-France Mobilités (données ouvertes).
- Adresses : Base adresse nationale.

Projet personnel, non commercial, sans lien avec ces services.

## Développement

Aucune dépendance, aucune étape de build : servir le dossier avec n'importe quel serveur statique.

    node tests/run.mjs            # tests hors ligne
    node tests/run.mjs --reseau   # tests avec les vrais services (une requête par seconde)
