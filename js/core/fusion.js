/* Fusion d'une actualisation avec ce qui est en mémoire. Règle absolue : aucun champ de
   l'utilisateur n'est jamais écrasé par une donnée du portail. Pur. */

export const CHAMPS_UTILISATEUR = ['status', 'statusLe', 'notes', 'cote', 'visite', 'vu', 'vus'];
/* Champs tenus par l'appli (historique), jamais pris tels quels dans une annonce fraîche. */
export const CHAMPS_SUIVI = ['premierVuLe', 'dernierVuLe', 'nouveau', 'ancienLoyer', 'baisseLe', 'dispo', 'retireeLe', 'verifLe', 'lieux', 'horsRecherche'];

export const STATUTS = [
  ['nouveau', 'Nouveau'], ['a_contacter', 'À contacter'], ['contacte', 'Contacté'], ['visite', 'Visite'],
  ['dossier', 'Dossier déposé'], ['accepte', 'Accepté'], ['refuse', 'Refusé'], ['ecarte', 'Écarté']
];
export const STATUTS_SUIVIS = ['a_contacter', 'contacte', 'visite', 'dossier', 'accepte'];

export function aDesDonneesUtilisateur(b) {
  return !!(b.cote || b.notes || (b.status && b.status !== 'nouveau') || (b.visite && b.visite.le));
}
export function estSuivi(b) { return !!(b.cote || STATUTS_SUIVIS.indexOf(b.status) >= 0); }

const JOUR = 86400000;

/**
 * @param {Array} anciens   biens en mémoire
 * @param {Array} frais     annonces normalisées de la recherche, chacune avec .lieux (zoneIds qui l'ont trouvée)
 * @param {Object} o        { maintenant (ms), premiere (bool : aucune actualisation avant), complet (bool : recherche
 *                            complète, sans borne atteinte ni échec), purgeJours }
 * @returns {{biens, nouveaux, baisses, aVerifier, purges}}
 */
export function fusionner(anciens, frais, o = {}) {
  const now = o.maintenant || Date.now();
  const iso = new Date(now).toISOString();
  const purgeMs = (o.purgeJours || 21) * JOUR;
  const parId = new Map();
  for (const b of anciens) parId.set(b.id, b);
  const vus = new Set();
  const nouveaux = [], baisses = [];

  for (const f of frais) {
    if (!f || !f.id || vus.has(f.id)) continue;
    vus.add(f.id);
    const a = parId.get(f.id);
    if (!a) {
      const n = Object.assign({}, f, {
        premierVuLe: iso, dernierVuLe: iso, nouveau: !o.premiere, dispo: 'en_ligne', verifLe: iso,
        status: 'nouveau', horsRecherche: false
      });
      delete n.enLigneSelonFiche;
      parId.set(f.id, n);
      if (!o.premiere) nouveaux.push(f.id);
      continue;
    }
    const m = Object.assign({}, a);
    for (const k in f) {
      if (k === 'enLigneSelonFiche') continue;
      if (CHAMPS_UTILISATEUR.indexOf(k) >= 0 || CHAMPS_SUIVI.indexOf(k) >= 0) continue;
      m[k] = f[k];
    }
    if (Array.isArray(f.lieux)) m.lieux = f.lieux.slice();
    if (a.loyer != null && f.loyer != null) {
      if (f.loyer < a.loyer - 0.5) {
        m.ancienLoyer = Math.max(a.ancienLoyer || 0, a.loyer);
        m.baisseLe = iso;
        baisses.push(f.id);
      } else if (a.ancienLoyer && f.loyer >= a.ancienLoyer) {
        m.ancienLoyer = null; m.baisseLe = null;
      }
    }
    m.nouveau = false;
    m.dernierVuLe = iso;
    m.verifLe = iso;
    m.dispo = 'en_ligne';
    m.retireeLe = null;
    m.horsRecherche = false;
    parId.set(f.id, m);
  }

  const aVerifier = [], purges = [], biens = [];
  for (const [id, b] of parId) {
    if (vus.has(id)) { biens.push(b); continue; }
    if (b.src !== 'bienici') { biens.push(b); continue; }
    const m = Object.assign({}, b, { nouveau: false });
    if (o.complet) m.horsRecherche = true;
    if (estSuivi(m) && m.dispo !== 'retiree') aVerifier.push(id);
    const vu = Date.parse(m.dernierVuLe || m.premierVuLe || 0) || 0;
    if (o.complet && !aDesDonneesUtilisateur(m) && now - vu > purgeMs) { purges.push(id); continue; }
    /* Lieu retiré des critères : l'annonce non suivie disparaît tout de suite. */
    if (o.complet && o.zonesActives && !aDesDonneesUtilisateur(m) && !(m.lieux || []).some((z) => o.zonesActives.indexOf(z) >= 0)) { purges.push(id); continue; }
    biens.push(m);
  }
  return { biens, nouveaux, baisses, aVerifier, purges };
}

/* Résultat d'une vérification de fiche appliqué à un bien, sans toucher aux champs utilisateur. */
export function appliquerVerif(b, verdict, maintenant = Date.now()) {
  const iso = new Date(maintenant).toISOString();
  const m = Object.assign({}, b);
  if (verdict.dispo === 'retiree') {
    if (m.dispo !== 'retiree') { m.dispo = 'retiree'; m.retireeLe = iso; }
    m.verifLe = iso;
  } else if (verdict.dispo === 'en_ligne') {
    m.dispo = 'en_ligne'; m.retireeLe = null; m.verifLe = iso;
    const f = verdict.annonce;
    if (f) {
      if (m.loyer != null && f.loyer != null && f.loyer < m.loyer - 0.5) { m.ancienLoyer = Math.max(m.ancienLoyer || 0, m.loyer); m.baisseLe = iso; }
      for (const k in f) {
        if (k === 'enLigneSelonFiche' || k === 'lieux' || CHAMPS_UTILISATEUR.indexOf(k) >= 0 || CHAMPS_SUIVI.indexOf(k) >= 0) continue;
        m[k] = f[k];
      }
    }
  } else {
    m.verifEchecLe = iso;
  }
  return m;
}

/* Modification par l'utilisateur : seuls les champs utilisateur passent. */
export function patchUtilisateur(b, patch) {
  const m = Object.assign({}, b);
  for (const k in patch) if (CHAMPS_UTILISATEUR.indexOf(k) >= 0) m[k] = patch[k];
  return m;
}
