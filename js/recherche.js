/* Recherche Bien'ici en direct depuis l'appareil. Sans document ni stockage (testable sous Node). */
import { getJSON, getJSONok } from './net.js';
import { construireFiltres, urlRecherche, urlFiche, normaliserAnnonce, verdictFiche, PAGE, BORNE, urlSuggest, lireSuggestions } from './core/bienici.js';

/**
 * Interroge chaque lieu retenu (une recherche par lieu : on sait ainsi quel lieu a trouvé quelle annonce),
 * pagine jusqu'à tout avoir, dans la limite de BORNE annonces au total.
 * @returns {{annonces, parLieu:[{nom,total,lus,echec}], borneAtteinte, complet}}
 */
export async function rechercher(C, o = {}) {
  const parId = new Map();
  const parLieu = [];
  let borneAtteinte = false, echecs = 0;
  const lieux = C.lieux || [];
  const progres = o.progres || (() => {});
  const taille = o.taille || PAGE;
  for (let i = 0; i < lieux.length; i++) {
    const l = lieux[i];
    const r = { nom: l.nom, total: null, lus: 0, echec: false };
    parLieu.push(r);
    let page = 1;
    try {
      for (;;) {
        progres({ lieu: l.nom, index: i, nbLieux: lieux.length, page, annonces: parId.size });
        const corps = await getJSONok(urlRecherche(construireFiltres(C, l.zoneIds, page, taille)), {
          suivi: {
            libelle: l.nom + ', page ' + page,
            etape: { type: 'recherche', lieu: i, page },
            recu: (c) => {
              if (!c) return null;
              const n = Array.isArray(c.realEstateAds) ? c.realEstateAds.length : 0, tot = Number(c.total) || 0;
              return { n, unite: 'annonce', total: tot, pages: Math.max(1, Math.ceil(tot / taille)) };
            }
          }
        });
        const liste = Array.isArray(corps.realEstateAds) ? corps.realEstateAds : [];
        if (r.total == null) r.total = Number(corps.total) || 0;
        for (const a of liste) {
          r.lus++;
          const n = normaliserAnnonce(a);
          if (!n) continue;
          const ex = parId.get(n.id);
          if (ex) { for (const z of l.zoneIds) if (ex.lieux.indexOf(z) < 0) ex.lieux.push(z); continue; }
          if (parId.size >= BORNE) { borneAtteinte = true; continue; }
          n.lieux = l.zoneIds.slice();
          parId.set(n.id, n);
        }
        if (borneAtteinte || liste.length < taille || r.lus >= r.total) break;
        page++;
        if (page > Math.ceil(BORNE / taille) + 2) break;
      }
    } catch (e) {
      r.echec = true; echecs++;
      if (o.lieuFini) o.lieuFini({ index: i, echec: true, lus: r.lus, pages: r.total == null ? null : Math.max(1, Math.ceil(r.total / taille)) });
      if (o.arretSurEchec) throw e;
    }
    if (!r.echec && o.lieuFini) o.lieuFini({ index: i, echec: false, lus: r.lus, pages: Math.max(1, Math.ceil((r.total || 0) / taille)) });
    if (borneAtteinte) break;
  }
  return { annonces: [...parId.values()], parLieu, borneAtteinte, complet: !borneAtteinte && echecs === 0 && lieux.length > 0, echecs };
}

export async function verifierFiche(bid, libelle) {
  const r = await getJSON(urlFiche(bid), {
    suivi: {
      libelle: 'Fiche suivie' + (libelle ? ' · ' + libelle : ''),
      etape: { type: 'fiche' },
      recu: (c, statut) => {
        const v = verdictFiche(statut, c).dispo;
        if (v === 'en_ligne') return { texte: 'annonce en ligne' };
        if (v === 'retiree') return { texte: 'annonce retirée' + (statut === 200 ? '' : ' (réponse ' + statut + ')') };
        return null;
      }
    }
  });
  return verdictFiche(r.statut, r.corps);
}

export async function suggestions(q) {
  if (String(q || '').trim().length < 2) return [];
  const corps = await getJSONok(urlSuggest(q.trim()), {
    delai: 8000,
    suivi: { libelle: 'Suggestions de lieux', recu: (c) => (c ? { n: lireSuggestions(c).length, unite: 'proposition' } : null) }
  });
  return lireSuggestions(corps);
}
