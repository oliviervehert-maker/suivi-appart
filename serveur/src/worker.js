/* Adaptateur Cloudflare Workers : relie la logique portable (alertes.js) à l'hébergeur.
   Autre hébergeur : fournir les mêmes { kv, fetch, maintenant, env } et appeler les deux mêmes fonctions. */
import { traiterRequete, releve } from './alertes.js';

function contexte(env) {
  return {
    kv: env.ALERTES,
    fetch: (url, o) => fetch(url, o),
    maintenant: () => Date.now(),
    env
  };
}

export default {
  async fetch(request, env) {
    try { return await traiterRequete(request, contexte(env)); }
    catch (e) { return new Response(JSON.stringify({ erreur: 'Erreur interne.' }), { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }); }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(releve(contexte(env)).then((r) => { console.log(JSON.stringify(r)); }));
  }
};
