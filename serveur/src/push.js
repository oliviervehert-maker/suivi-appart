/* Web Push sans dépendance : chiffrement du message (RFC 8291, codage aes128gcm de la RFC 8188),
   jeton VAPID (RFC 8292), envoi au service de notification du téléphone. WebCrypto seulement :
   fonctionne tel quel dans Cloudflare Workers, Node 18+ et tout environnement à fetch + crypto.subtle. */

const enc = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;

/* ---------- base64url ---------- */
export function b64uEnc(octets) {
  const o = octets instanceof Uint8Array ? octets : new Uint8Array(octets);
  let s = '';
  for (let i = 0; i < o.length; i += 0x8000) s += String.fromCharCode.apply(null, o.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64uDec(txt) {
  const s = String(txt || '').replace(/-/g, '+').replace(/_/g, '/');
  if (/[^A-Za-z0-9+/]/.test(s)) throw new Error('base64url invalide');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const o = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i);
  return o;
}
export function concat(...morceaux) {
  const n = morceaux.reduce((s, m) => s + m.length, 0);
  const o = new Uint8Array(n);
  let p = 0;
  for (const m of morceaux) { o.set(m, p); p += m.length; }
  return o;
}

async function hmac(cle, donnees) {
  const k = await subtle().importKey('raw', cle, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle().sign('HMAC', k, donnees));
}

/* Clé privée P-256 brute (d, 32 octets) + clé publique non compressée (65 octets) -> JWK. */
export function jwkDepuisBrut(publique, d) {
  if (publique.length !== 65 || publique[0] !== 4) throw new Error('clé publique P-256 attendue (65 octets)');
  const j = { kty: 'EC', crv: 'P-256', x: b64uEnc(publique.subarray(1, 33)), y: b64uEnc(publique.subarray(33, 65)), ext: true };
  if (d) j.d = b64uEnc(d);
  return j;
}

/**
 * Chiffre un message pour un abonnement (RFC 8291 §3.4, un seul enregistrement, délimiteur 0x02).
 * @param o.p256dh   clé publique du navigateur (base64url, 65 octets)
 * @param o.auth     secret d'authentification du navigateur (base64url, 16 octets)
 * @param o.message  Uint8Array ou texte
 * @param o.sel      (tests) sel de 16 octets imposé
 * @param o.ephemere (tests) paire éphémère imposée { publique: Uint8Array(65), privee: Uint8Array(32) }
 * @param o.rs       taille d'enregistrement annoncée (4096 par défaut, valeur des exemples de la RFC)
 * @returns {{corps: Uint8Array, trace: object}}
 */
export async function chiffrer(o) {
  const uaPublique = b64uDec(o.p256dh);
  const authSecret = b64uDec(o.auth);
  if (uaPublique.length !== 65 || uaPublique[0] !== 4) throw new Error('p256dh invalide');
  if (authSecret.length !== 16) throw new Error('auth invalide');
  const message = typeof o.message === 'string' ? enc.encode(o.message) : o.message;
  const rs = o.rs || 4096;
  const sel = o.sel || globalThis.crypto.getRandomValues(new Uint8Array(16));
  if (sel.length !== 16) throw new Error('sel de 16 octets attendu');

  let asPrivee, asPublique;
  if (o.ephemere) {
    asPublique = o.ephemere.publique;
    asPrivee = await subtle().importKey('jwk', jwkDepuisBrut(asPublique, o.ephemere.privee), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  } else {
    const paire = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    asPrivee = paire.privateKey;
    asPublique = new Uint8Array(await subtle().exportKey('raw', paire.publicKey));
  }
  const uaCle = await subtle().importKey('raw', uaPublique, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: uaCle }, asPrivee, 256));

  /* RFC 8291 §3.3-3.4 : combinaison des clés, puis RFC 8188 §2.2-2.3 : clé et nonce de contenu. */
  const prkCle = await hmac(authSecret, ecdh);
  const infoCle = concat(enc.encode('WebPush: info'), new Uint8Array([0]), uaPublique, asPublique);
  const ikm = await hmac(prkCle, concat(infoCle, new Uint8Array([1])));
  const prk = await hmac(sel, ikm);
  const infoCek = concat(enc.encode('Content-Encoding: aes128gcm'), new Uint8Array([0]));
  const cek = (await hmac(prk, concat(infoCek, new Uint8Array([1])))).slice(0, 16);
  const infoNonce = concat(enc.encode('Content-Encoding: nonce'), new Uint8Array([0]));
  const nonce = (await hmac(prk, concat(infoNonce, new Uint8Array([1])))).slice(0, 12);

  const clair = concat(message, new Uint8Array([2]));
  if (clair.length + 16 > rs) throw new Error('message trop long pour un enregistrement');
  const cleAes = await subtle().importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const chiffre = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, cleAes, clair));

  const entete = new Uint8Array(16 + 4 + 1 + 65);
  entete.set(sel, 0);
  new DataView(entete.buffer).setUint32(16, rs);
  entete[20] = 65;
  entete.set(asPublique, 21);
  return { corps: concat(entete, chiffre), trace: { ecdh, prkCle, infoCle, ikm, prk, cek, nonce, entete, chiffre } };
}

/* ---------- VAPID (RFC 8292) ---------- */
export const VAPID_DUREE_MAX = 12 * 3600;

/**
 * Jeton ES256 : { typ, alg } . { aud, exp, sub }, signature brute r||s (64 octets).
 * @param o.aud        origine du service de notification (schéma https, hôte, sans chemin)
 * @param o.sub        contact de l'exploitant (mailto: ou https:)
 * @param o.priveeJwk  clé privée P-256 au format JWK (objet ou texte JSON)
 * @param o.maintenant horodatage en ms
 */
export async function jetonVapid(o) {
  const jwk = typeof o.priveeJwk === 'string' ? JSON.parse(o.priveeJwk) : o.priveeJwk;
  const cle = await subtle().importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const exp = Math.floor(o.maintenant / 1000) + Math.min(o.duree || VAPID_DUREE_MAX, VAPID_DUREE_MAX);
  const t = b64uEnc(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))) + '.' + b64uEnc(enc.encode(JSON.stringify({ aud: o.aud, exp, sub: o.sub })));
  const sig = new Uint8Array(await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, cle, enc.encode(t)));
  return t + '.' + b64uEnc(sig);
}
export function enteteVapid(jeton, publiqueB64u) { return 'vapid t=' + jeton + ', k=' + publiqueB64u; }

/* ---------- services de notification acceptés ---------- */
/* Le serveur ne doit jamais servir de relais : seuls ces services, en https, port standard. */
export function endpointAccepte(e) {
  if (typeof e !== 'string' || e.length > 1024) return false;
  let u;
  try { u = new URL(e); } catch (x) { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const h = u.hostname.toLowerCase();
  if (h === 'fcm.googleapis.com' || h === 'updates.push.services.mozilla.com') return true;
  if (/^([a-z0-9-]+\.)+push\.apple\.com$/.test(h)) return true;
  if (/^([a-z0-9-]+\.)+notify\.windows\.com$/.test(h)) return true;
  return false;
}

/**
 * Envoie un message chiffré. Ne lève jamais : rend { etat, statut }.
 * etat : 'ok' | 'supprimer' (404, 410 : abonnement mort) | 'reessayer' (429, 5xx, réseau) | 'echec' (autre refus) | 'refuse' (endpoint hors liste)
 */
export async function envoyerPush(o) {
  const ab = o.abonnement;
  if (!ab || !endpointAccepte(ab.endpoint)) return { etat: 'refuse', statut: 0 };
  let corps;
  try {
    const message = enc.encode(typeof o.donnees === 'string' ? o.donnees : JSON.stringify(o.donnees));
    if (message.length > 2048) return { etat: 'echec', statut: 0, erreur: 'message trop long' };
    corps = (await chiffrer({ p256dh: ab.keys.p256dh, auth: ab.keys.auth, message })).corps;
  } catch (e) { return { etat: 'echec', statut: 0, erreur: 'chiffrement : ' + (e && e.message) }; }
  const aud = new URL(ab.endpoint).origin;
  let jeton;
  try { jeton = await jetonVapid({ aud, sub: o.vapid.sujet, priveeJwk: o.vapid.priveeJwk, maintenant: o.maintenant }); }
  catch (e) { return { etat: 'echec', statut: 0, erreur: 'VAPID : ' + (e && e.message) }; }
  const entetes = {
    TTL: String(o.ttl || 43200),
    Urgency: 'normal',
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    Authorization: enteteVapid(jeton, o.vapid.publique)
  };
  if (o.topic && /^[A-Za-z0-9_-]{1,32}$/.test(o.topic)) entetes.Topic = o.topic;
  let statut = 0;
  try {
    const rep = await o.fetch(ab.endpoint, { method: 'POST', headers: entetes, body: corps });
    statut = rep.status;
  } catch (e) { return { etat: 'reessayer', statut: 0 }; }
  if (statut >= 200 && statut < 300) return { etat: 'ok', statut };
  if (statut === 404 || statut === 410) return { etat: 'supprimer', statut };
  if (statut === 429 || statut >= 500) return { etat: 'reessayer', statut };
  return { etat: 'echec', statut };
}
