/* Réglages transportés dans le fragment d'un lien (#r=…). Le fragment n'est jamais envoyé au serveur
   qui héberge l'appli : il reste entre les deux appareils. Format : « 1.<base64url> » (JSON compressé
   deflate-raw) ou « 0.<base64url> » (JSON brut, navigateur sans compression). */
const TAILLE_MAX = 400000;

function b64u(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(t) {
  const s = atob(t.replace(/-/g, '+').replace(/_/g, '/'));
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}
async function flux(bytes, Transfo) {
  const s = new Blob([bytes]).stream().pipeThrough(new Transfo('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export async function encoderLien(obj) {
  const brut = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'function') {
    try { return '1.' + b64u(await flux(brut, CompressionStream)); } catch (e) { /* repli sur le JSON brut */ }
  }
  return '0.' + b64u(brut);
}

/* Rend le texte JSON contenu dans le code. Lève une erreur lisible sinon. */
export async function decoderLien(code) {
  const m = /^([01])\.([A-Za-z0-9_-]+)$/.exec(String(code || '').trim());
  if (!m || m[2].length > TAILLE_MAX) throw new Error('Lien non reconnu.');
  let bytes;
  try { bytes = unb64u(m[2]); } catch (e) { throw new Error('Lien incomplet ou abîmé.'); }
  if (m[1] === '1') {
    if (typeof DecompressionStream !== 'function') throw new Error('Navigateur trop ancien pour lire ce lien.');
    try { bytes = await flux(bytes, DecompressionStream); } catch (e) { throw new Error('Lien incomplet ou abîmé.'); }
  }
  return new TextDecoder().decode(bytes);
}

/* Trouve le code dans une adresse complète, un fragment ou le code seul. */
export function codeDansTexte(t) {
  const s = String(t || '').trim();
  const m = /#r=([01]\.[A-Za-z0-9_-]+)/.exec(s);
  if (m) return m[1];
  return /^[01]\.[A-Za-z0-9_-]+$/.test(s) ? s : null;
}
