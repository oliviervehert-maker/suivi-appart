/* Service worker : met en cache la coquille de l'application (ouverture hors ligne, annonces déjà
   en mémoire sur l'appareil). Ne touche jamais aux requêtes vers les services externes.
   Mise à jour : changer VERSION (égale à APP_VERSION de js/config.js). La nouvelle coquille est
   téléchargée en entier, puis prend la main ; la page déjà ouverte garde ses fichiers, la nouvelle
   version sert au rechargement suivant. */
const VERSION = '1.2.0';
const CACHE = 'suivi-appart-' + VERSION;
const COQUILLE = [
  './', 'index.html', 'app.css', 'manifest.webmanifest',
  'js/app.js', 'js/config.js', 'js/etat.js', 'js/net.js', 'js/recherche.js', 'js/store.js', 'js/enrichissement.js', 'js/alertes.js',
  'js/core/bienici.js', 'js/core/criteres.js', 'js/core/partage.js', 'js/core/fusion.js', 'js/core/score.js', 'js/core/transports.js', 'js/core/util.js', 'js/core/alertes.js',
  'js/ui/accueil.js', 'js/ui/adresse.js', 'js/ui/alertes-ui.js', 'js/ui/cartes.js', 'js/ui/criteres-ui.js', 'js/ui/divers.js', 'js/ui/donnees.js',
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

/* ---------- alertes par notification (actives seulement si l'appli s'est inscrite) ---------- */
/* Toujours une notification, même si le message est illisible (exigence des navigateurs : userVisibleOnly). */
self.addEventListener('push', (ev) => {
  let d = null;
  try { d = ev.data ? ev.data.json() : null; } catch (e) { d = null; }
  const ok = d && typeof d === 'object';
  const titre = ok && typeof d.t === 'string' && d.t ? d.t.slice(0, 120) : 'Suivi appart';
  const corps = ok && typeof d.c === 'string' ? d.c.slice(0, 600) : 'Du nouveau dans la recherche : ouvrir l’application.';
  const u = ok && typeof d.u === 'string' && /^\.\/(\?b=[A-Za-z0-9_.%-]{1,160})?$/.test(d.u) ? d.u : './';
  const tag = ok && typeof d.tag === 'string' && d.tag ? d.tag.slice(0, 64) : 'suivi-appart';
  ev.waitUntil(self.registration.showNotification(titre, { body: corps, tag, data: { u }, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' }));
});

/* Toucher la notification : fenêtre de l'appli au premier plan et prévenue, sinon ouverture sur l'annonce. */
self.addEventListener('notificationclick', (ev) => {
  ev.notification.close();
  const u = (ev.notification.data && typeof ev.notification.data.u === 'string') ? ev.notification.data.u : './';
  const portee = self.registration.scope;
  ev.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = fenetres.find((c) => c.url.indexOf(portee) === 0);
    if (app) {
      try { await app.focus(); } catch (e) { /* le navigateur peut refuser */ }
      app.postMessage({ type: 'ouvrir', u });
      return;
    }
    await self.clients.openWindow(new URL(u, portee).href);
  })());
});

/* Adresse de notification changée par le navigateur : réinscription au mieux, avec la dernière copie
   des réglages laissée par l'appli (base « suivi-appart-alertes »). */
function lireCopieAlertes() {
  return new Promise((ok) => {
    try {
      const r = indexedDB.open('suivi-appart-alertes', 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv'); };
      r.onerror = () => ok(null);
      r.onsuccess = () => {
        const db = r.result;
        try {
          const g = db.transaction('kv', 'readonly').objectStore('kv').get('envoi');
          g.onsuccess = () => { db.close(); ok(g.result || null); };
          g.onerror = () => { db.close(); ok(null); };
        } catch (e) { db.close(); ok(null); }
      };
    } catch (e) { ok(null); }
  });
}
function cleOctets(t) {
  const s = String(t).replace(/-/g, '+').replace(/_/g, '/');
  const b = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const o = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i);
  return o;
}
self.addEventListener('pushsubscriptionchange', (ev) => {
  ev.waitUntil((async () => {
    const copie = await lireCopieAlertes();
    if (!copie || typeof copie.url !== 'string' || !copie.corps) return;
    const ancien = ev.oldSubscription || null;
    let neuf = ev.newSubscription || null;
    if (!neuf) {
      const cle = (ancien && ancien.options && ancien.options.applicationServerKey) || (copie.cle ? cleOctets(copie.cle) : null);
      if (!cle) return;
      neuf = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cle });
    }
    const j = neuf.toJSON();
    const init = (m, corps) => ({ method: m, headers: { 'Content-Type': 'application/json' }, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', body: JSON.stringify(corps) });
    await fetch(copie.url + '/abonnement', init('PUT', Object.assign({}, copie.corps, { abonnement: { endpoint: j.endpoint, keys: j.keys } })));
    const vieux = (ancien && ancien.endpoint) || copie.endpoint;
    if (vieux && vieux !== j.endpoint) { try { await fetch(copie.url + '/abonnement', init('DELETE', { endpoint: vieux, jeton: copie.corps.jeton })); } catch (e) { /* expirera */ } }
    const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    fenetres.forEach((c) => c.postMessage({ type: 'abonnement-change' }));
  })().catch(() => {}));
});
