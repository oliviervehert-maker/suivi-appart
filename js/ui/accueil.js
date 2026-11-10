/* Premier lancement : trois étapes courtes, puis la première recherche part toute seule. */
import { S, sauverCriteresMaintenant, sauverReglages } from '../etat.js';
import { esc, num, uid } from '../core/util.js';
import { libelleTypeLieu } from '../core/bienici.js';
import { nettoyerDestination } from '../core/criteres.js';
import { brancherLieux } from './criteres-ui.js';
import { brancherAdresse } from './adresse.js';
import { APP_NOM } from '../config.js';

let etape = 1, fin = null;

function pas() { return '<div class="steps">' + [1, 2, 3].map((i) => '<i class="' + (i <= etape ? 'on' : '') + '"></i>').join('') + '</div>'; }

function rendre() {
  const el = document.getElementById('onb');
  const C = S.C;
  let h = '<div class="wrap">' + pas();
  if (etape === 1) {
    h += '<p class="meta">' + esc(APP_NOM) + ' · étape 1 sur 3</p><h2 id="onb-t">Où chercher ?</h2>' +
      '<p class="meta">Communes, arrondissements ou départements, partout en France.</p>' +
      '<div class="panel"><input id="o-lieu" class="txt" type="search" placeholder="Nom ou code postal" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search"><div class="sugg" id="o-sugg"></div>' +
      '<div class="tags" id="o-lieux">' + C.lieux.map((l, i) => '<span class="tag">' + esc(l.nom) + '<button class="x" type="button" data-o-lx="' + i + '" aria-label="Retirer ' + esc(l.nom) + '">✕</button></span>').join('') + '</div></div>' +
      '<div class="row"><div class="grow"><p class="meta">Un profil de critères déjà prêt ?</p></div><span style="display:inline-flex;flex-direction:column;gap:6px;flex:none"><button class="btn quiet" type="button" id="o-coller">Coller un lien reçu</button><button class="btn quiet" type="button" data-o-import="1">Importer un fichier</button></span></div>' +
      '<div class="nav"><span></span><button class="btn primary" type="button" data-o-next="1"' + (C.lieux.length ? '' : ' disabled') + '>Suivant</button></div>';
  } else if (etape === 2) {
    const ty = C.types.length === 2 ? 'both' : C.types[0];
    h += '<p class="meta">Étape 2 sur 3</p><h2 id="onb-t">Budget et surface</h2>' +
      '<div class="panel">' +
      '<div class="field"><div class="lbl">Loyer maximum<em>charges comprises, en €</em></div><input class="txt" style="width:130px;text-align:right" id="o-loyer" type="number" inputmode="numeric" value="' + (C.loyerMax ?? '') + '" placeholder="—"></div>' +
      '<div class="field"><div class="lbl">Surface minimum<em>en m²</em></div><input class="txt" style="width:130px;text-align:right" id="o-surf" type="number" inputmode="numeric" value="' + (C.surfMin ?? '') + '" placeholder="—"></div>' +
      '<div class="field"><div class="lbl">Pièces minimum<em>3 = T3</em></div><input class="txt" style="width:130px;text-align:right" id="o-pieces" type="number" inputmode="numeric" value="' + C.piecesMin + '"></div>' +
      '<div class="field"><div class="lbl">Type de bien</div><span class="seg" role="group">' + [['flat', 'Appartement'], ['house', 'Maison'], ['both', 'Les deux']].map((o) => '<button type="button" data-o-type="' + o[0] + '" aria-pressed="' + (ty === o[0]) + '">' + o[1] + '</button>').join('') + '</span></div>' +
      '</div><p class="meta">Tout se règle plus finement ensuite, dans Critères.</p>' +
      '<div class="nav"><button class="btn" type="button" data-o-prev="1">Retour</button><button class="btn primary" type="button" data-o-next="1">Suivant</button></div>';
  } else {
    const d = C.destinations[0] || {};
    h += '<p class="meta">Étape 3 sur 3 · facultative</p><h2 id="onb-t">Un premier trajet</h2>' +
      '<p class="meta">Travail, école… Le temps de trajet en transports s’affiche sur chaque annonce.</p>' +
      '<div class="panel">' +
      '<div class="fl"><span class="lbl">Nom</span><input class="txt" id="o-dnom" maxlength="60" placeholder="Ex. Travail" value="' + esc(d.nom || '') + '"></div>' +
      '<div class="fl"><span class="lbl">Adresse</span><input class="txt" id="o-dadr" type="search" autocomplete="off" placeholder="Numéro, rue, commune" value="' + esc(d.adresse || '') + '" data-lat="' + (d.lat ?? '') + '" data-lon="' + (d.lon ?? '') + '"><div class="sugg" id="o-dsugg"></div></div>' +
      '<div class="field"><div class="lbl">Arrivée à</div><input class="txt" style="width:130px" id="o-dheure" type="time" value="' + esc(d.heure || '08:30') + '"></div>' +
      '<div class="field"><div class="lbl">Durée maximale<em>en minutes, transports en commun</em></div><input class="txt" style="width:130px;text-align:right" id="o-dmax" type="number" inputmode="numeric" value="' + (d.dureeMax || 45) + '"></div>' +
      '<p class="err" id="o-err"></p></div>' +
      '<div class="nav"><button class="btn" type="button" data-o-prev="1">Retour</button><span class="row" style="gap:8px"><button class="btn" type="button" data-o-fin="passer">Passer</button><button class="btn primary" type="button" data-o-fin="ok">Lancer la recherche</button></span></div>';
  }
  h += '</div>';
  el.innerHTML = h;
  if (etape === 1) {
    const inp = document.getElementById('o-lieu');
    brancherLieux(inp, document.getElementById('o-sugg'), (l) => {
      if (!C.lieux.some((x) => x.zoneIds.join(',') === l.zoneIds.join(','))) C.lieux.push({ nom: l.nom, type: l.type, cp: l.cp, zoneIds: l.zoneIds, etat: 'oui' });
      sauverCriteresMaintenant(); rendre(); setTimeout(() => { const i = document.getElementById('o-lieu'); if (i) i.focus(); }, 0);
    });
  }
  if (etape === 3) brancherAdresse(document.getElementById('o-dadr'), document.getElementById('o-dsugg'));
}

function lireEtape2() {
  const C = S.C;
  const l = num(document.getElementById('o-loyer').value), s = num(document.getElementById('o-surf').value), p = num(document.getElementById('o-pieces').value);
  C.loyerMax = l != null && l > 0 ? Math.round(l) : null;
  C.surfMin = s != null && s > 0 ? Math.round(s) : null;
  C.piecesMin = p != null && p >= 1 ? Math.min(10, Math.round(p)) : 1;
  sauverCriteresMaintenant();
}

export function ouvrirAccueil(onFin) {
  fin = onFin; etape = 1;
  document.getElementById('onb').hidden = false;
  rendre();
}
export function fermerAccueil() { document.getElementById('onb').hidden = true; }

export function clicAccueil(t) {
  const d = t.dataset, C = S.C;
  if (d.oLx !== undefined) { C.lieux.splice(Number(d.oLx), 1); sauverCriteresMaintenant(); rendre(); return true; }
  if (d.oType) { C.types = d.oType === 'both' ? ['flat', 'house'] : [d.oType]; t.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === t))); sauverCriteresMaintenant(); return true; }
  if (d.oNext) { if (etape === 2) lireEtape2(); etape++; rendre(); window.scrollTo(0, 0); return true; }
  if (d.oPrev) { if (etape === 2) lireEtape2(); etape--; rendre(); return true; }
  if (d.oImport) { document.getElementById('file-import').click(); return true; }
  if (d.oFin) {
    if (d.oFin === 'ok') {
      const nom = document.getElementById('o-dnom').value.trim(), adr = document.getElementById('o-dadr');
      const lat = num(adr.dataset.lat), lon = num(adr.dataset.lon);
      if (nom || adr.value.trim()) {
        if (!nom) { document.getElementById('o-err').textContent = 'Nom à renseigner, ou « Passer ».'; return true; }
        if (lat == null) { document.getElementById('o-err').textContent = 'Adresse à choisir dans la liste proposée, ou « Passer ».'; return true; }
        const nd = nettoyerDestination({ id: (C.destinations[0] && C.destinations[0].id) || uid('d'), nom, adresse: adr.value, lat, lon, heure: document.getElementById('o-dheure').value, dureeMax: document.getElementById('o-dmax').value, mode: 'transit', importance: 'important' });
        if (C.destinations.length) C.destinations[0] = nd; else C.destinations.push(nd);
      }
    }
    sauverCriteresMaintenant();
    S.reglages.accueilFait = true; sauverReglages();
    fermerAccueil();
    fin && fin();
    return true;
  }
  return false;
}
export { libelleTypeLieu };
