/* Stockage sur l'appareil : IndexedDB (annonces, caches), localStorage (petits réglages).
   Tout est enveloppé : si le stockage est refusé, l'appli tourne en mémoire pour la session. */

const BASE = 'suivi-appart';
const VERSION_BASE = 1;
const PREFIXE = 'sa.';

let db = null;
let memoire = { biens: new Map(), cache: new Map() };
let lsMem = new Map();
export const etat = { idb: false, ls: false, persistant: null };

function req(r) { return new Promise((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); }); }

export async function ouvrir() {
  try { const k = PREFIXE + 'test'; localStorage.setItem(k, '1'); localStorage.removeItem(k); etat.ls = true; } catch (e) { etat.ls = false; }
  try {
    if (typeof indexedDB === 'undefined') throw new Error('absent');
    db = await new Promise((ok, ko) => {
      const r = indexedDB.open(BASE, VERSION_BASE);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('biens')) d.createObjectStore('biens', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('cache')) d.createObjectStore('cache', { keyPath: 'k' });
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
      r.onblocked = () => ko(new Error('bloqué'));
      setTimeout(() => ko(new Error('délai')), 4000);
    });
    db.onversionchange = () => { try { db.close(); } catch (e) { /* rien */ } };
    etat.idb = true;
  } catch (e) { db = null; etat.idb = false; }
  try { if (navigator.storage && navigator.storage.persisted) etat.persistant = await navigator.storage.persisted(); } catch (e) { /* rien */ }
  return etat;
}

export async function demanderPersistance() {
  try { if (navigator.storage && navigator.storage.persist) etat.persistant = await navigator.storage.persist(); } catch (e) { /* rien */ }
  return etat.persistant;
}

/* ---------- petits réglages ---------- */
export function lire(cle, def) {
  try {
    const v = etat.ls ? localStorage.getItem(PREFIXE + cle) : lsMem.get(cle);
    return v == null ? def : JSON.parse(v);
  } catch (e) { return def; }
}
export function ecrire(cle, val) {
  const s = JSON.stringify(val);
  try { if (etat.ls) { localStorage.setItem(PREFIXE + cle, s); return true; } } catch (e) { /* quota ou refus */ }
  lsMem.set(cle, s); return false;
}
export function effacerReglages() {
  try { if (etat.ls) Object.keys(localStorage).filter((k) => k.indexOf(PREFIXE) === 0).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* rien */ }
  lsMem = new Map();
}

/* ---------- IndexedDB ---------- */
function tx(nom, mode) { return db.transaction(nom, mode).objectStore(nom); }

export async function tousLesBiens() {
  if (!db) return [...memoire.biens.values()];
  try { return await req(tx('biens', 'readonly').getAll()); } catch (e) { return [...memoire.biens.values()]; }
}
export async function enregistrerBiens(liste) {
  liste.forEach((b) => memoire.biens.set(b.id, b));
  if (!db) return false;
  try {
    await new Promise((ok, ko) => {
      const t = db.transaction('biens', 'readwrite'); const s = t.objectStore('biens');
      liste.forEach((b) => s.put(b));
      t.oncomplete = ok; t.onerror = () => ko(t.error); t.onabort = () => ko(t.error);
    });
    return true;
  } catch (e) { return false; }
}
export async function supprimerBiens(ids) {
  ids.forEach((id) => memoire.biens.delete(id));
  if (!db || !ids.length) return;
  try {
    await new Promise((ok, ko) => {
      const t = db.transaction('biens', 'readwrite'); const s = t.objectStore('biens');
      ids.forEach((id) => s.delete(id));
      t.oncomplete = ok; t.onerror = () => ko(t.error);
    });
  } catch (e) { /* rien */ }
}

export async function cacheLire(k) {
  if (memoire.cache.has(k)) return memoire.cache.get(k);
  if (!db) return null;
  try { const v = await req(tx('cache', 'readonly').get(k)); if (v) memoire.cache.set(k, v); return v || null; } catch (e) { return null; }
}
export async function cacheEcrire(k, v) {
  const o = { k, v, le: Date.now() };
  memoire.cache.set(k, o);
  if (!db) return;
  try { await req(tx('cache', 'readwrite').put(o)); } catch (e) { /* rien */ }
}
export async function cacheTout() {
  if (!db) return [...memoire.cache.values()];
  try { return await req(tx('cache', 'readonly').getAll()); } catch (e) { return [...memoire.cache.values()]; }
}
export async function cachePurger(avant) {
  for (const [k, v] of memoire.cache) if (v.le < avant) memoire.cache.delete(k);
  if (!db) return;
  try {
    const tous = await cacheTout();
    await new Promise((ok) => {
      const t = db.transaction('cache', 'readwrite'); const s = t.objectStore('cache');
      tous.filter((x) => x.le < avant).forEach((x) => s.delete(x.k));
      t.oncomplete = ok; t.onerror = ok;
    });
  } catch (e) { /* rien */ }
}

export async function toutEffacer() {
  memoire = { biens: new Map(), cache: new Map() };
  effacerReglages();
  if (db) {
    try {
      await new Promise((ok) => {
        const t = db.transaction(['biens', 'cache'], 'readwrite');
        t.objectStore('biens').clear(); t.objectStore('cache').clear();
        t.oncomplete = ok; t.onerror = ok;
      });
    } catch (e) { /* rien */ }
  }
}
