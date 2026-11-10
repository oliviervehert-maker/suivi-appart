/* Service worker : met en cache la coquille de l'application (ouverture hors ligne, annonces déjà
   en mémoire sur l'appareil). Ne touche jamais aux requêtes vers les services externes.
   Mise à jour : changer VERSION (égale à APP_VERSION de js/config.js). La nouvelle coquille est
   téléchargée en entier, puis prend la main ; la page déjà ouverte garde ses fichiers, la nouvelle
   version sert au rechargement suivant. */
const VERSION = '1.0.4';
const CACHE = 'suivi-appart-' + VERSION;
const COQUILLE = [
  './', 'index.html', 'app.css', 'manifest.webmanifest',
  'js/app.js', 'js/config.js', 'js/etat.js', 'js/net.js', 'js/recherche.js', 'js/store.js', 'js/enrichissement.js',
  'js/core/bienici.js', 'js/core/criteres.js', 'js/core/fusion.js', 'js/core/score.js', 'js/core/transports.js', 'js/core/util.js',
  'js/ui/accueil.js', 'js/ui/adresse.js', 'js/ui/cartes.js', 'js/ui/criteres-ui.js', 'js/ui/divers.js', 'js/ui/donnees.js',
  'fonts/bricolage-grotesque-latin.woff2', 'fonts/bricolage-grotesque-latin-ext.woff2',
  'fonts/instrument-sans-latin.woff2', 'fonts/instrument-sans-latin-ext.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', (ev) => {
  ev.waitUntil((async () => {
    const c = await caches.open(CACHE);
    /* cache: 'reload' : jamais une copie périmée du cache HTTP dans une nouvelle version. */
    await c.addAll(COQUILLE.map((u) => new Request(u, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    const noms = await caches.keys();
    await Promise.all(noms.filter((n) => n.indexOf('suivi-appart-') === 0 && n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; /* services externes : réseau direct, jamais mis en cache ici */
  if (!url.pathname.startsWith(new URL('./', self.registration.scope).pathname)) return;
  ev.respondWith((async () => {
    const c = await caches.open(CACHE);
    if (req.mode === 'navigate') {
      if (!/\/(index\.html)?$/.test(url.pathname)) return fetch(req);
      const r = await c.match('index.html');
      return r || fetch(req);
    }
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    /* Fichier hors coquille (bibliothèque du tableur) : réseau, puis gardé dans le cache de la version. */
    const rep = await fetch(req);
    if (rep.ok && rep.type === 'basic') c.put(req, rep.clone());
    return rep;
  })());
});
