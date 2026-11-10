/* Génère une paire de clés VAPID (ECDSA P-256) et l'AFFICHE seulement : rien n'est écrit sur le disque.
   Lancer : node serveur/outils/generer-cles.mjs
   - clé publique : base64url du point non compressé (65 octets) -> VAPID_PUBLIQUE (wrangler.toml)
   - clé privée   : JWK sur une ligne -> secret VAPID_PRIVEE (npx wrangler secret put VAPID_PRIVEE) */
import { b64uEnc } from '../src/push.js';

const paire = await globalThis.crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const publique = new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', paire.publicKey));
const jwk = await globalThis.crypto.subtle.exportKey('jwk', paire.privateKey);
const prive = JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d });

if (publique.length !== 65 || publique[0] !== 4) throw new Error('clé publique inattendue');
console.log('VAPID_PUBLIQUE (à mettre dans wrangler.toml, [vars]) :');
console.log(b64uEnc(publique));
console.log('');
console.log('VAPID_PRIVEE (secret : « npx wrangler secret put VAPID_PRIVEE », coller la ligne ci-dessous) :');
console.log(prive);
console.log('');
console.log('Ne jamais enregistrer la clé privée dans le dépôt. Changer de paire oblige chaque téléphone à réactiver les alertes.');
