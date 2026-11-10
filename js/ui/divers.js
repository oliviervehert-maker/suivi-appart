/* Onglets Suivi et Sources, feuilles (mail, ajout à la main), visionneuse, sauvegardes et export tableur. */
import { S, bien, ajouterBien, sauverReglages, ui } from '../etat.js';
import { esc, fmt, dateFr, moisCourt, ilYA, num, uid } from '../core/util.js';
import { evaluer, trajetRetenu } from '../core/score.js';
import { STATUTS, estSuivi } from '../core/fusion.js';
import { APP_NOM, APP_VERSION, CONTACT_APP, ALERTES_URL } from '../config.js';
import { hoteAlertes } from '../net.js';
import { enrPour } from '../enrichissement.js';
import { geocoder } from './adresse.js';
import { LABEL } from './cartes.js';

function nomCommune(b) { return String(b.commune || '').replace(/-sur-Seine$/, ''); }
function lib(b) { return nomCommune(b) + (b.quartier ? ' ' + b.quartier : '') + (b.surf ? ' · ' + fmt(b.surf) + ' m²' : '') + (b.loyer != null ? ' · ' + fmt(b.loyer) + ' €' : ''); }

/* ---------- Suivi ---------- */
export const DOSSIER = [
  ['Pièce d’identité', 'pour chaque locataire et garant'],
  ['3 derniers bulletins de salaire', 'ou justificatifs de revenus'],
  ['Dernier avis d’imposition', ''],
  ['Contrat de travail ou attestation employeur', ''],
  ['3 dernières quittances de loyer', 'ou attestation d’hébergement'],
  ['Justificatif de domicile actuel', ''],
  ['Dossier DossierFacile', 'service de l’État, gratuit : un lien unique, vérifié et filigrané'],
  ['Garantie Visale ou garant', 'Visale : garantie gratuite d’Action Logement'],
  ['RIB', '']
];

export function rendreSuivi() {
  const ev = (b) => evaluer(b, S.C, enrPour(b, S.C));
  const vis = S.biens.filter((b) => b.status === 'visite' && b.visite && b.visite.le).sort((a, c) => String(a.visite.le).localeCompare(String(c.visite.le)));
  document.getElementById('visites').innerHTML = vis.length ? vis.map((b) => {
    const d = new Date(b.visite.le);
    return '<div class="item"><div class="when"><b>' + d.getDate() + '</b><span>' + moisCourt(d.getMonth()) + '</span></div><div class="grow"><div class="t">' + esc(lib(b)) + '</div><div class="s">' + d.getHours() + ' h ' + String(d.getMinutes()).padStart(2, '0') + (b.annonceur ? ' · ' + esc(b.annonceur) : '') + (b.dispo === 'retiree' ? ' · annonce retirée depuis' : '') + '</div></div></div>';
  }).join('') : '<p class="meta">Passer un bien au statut « Visite » puis indiquer la date sur sa carte.</p>';

  const rel = [];
  const now = Date.now();
  for (const b of S.biens) {
    const st = b.status || 'nouveau', h = (now - (Date.parse(b.statusLe || b.premierVuLe || 0) || now)) / 3600000;
    if (b.dispo === 'retiree') { if (estSuivi(b) && st !== 'refuse' && st !== 'ecarte') rel.push([b, 'Annonce retirée : louée ou seulement suspendue ?', 'retirée ' + (b.retireeLe ? 'le ' + dateFr(b.retireeLe) : '')]); continue; }
    if (st === 'a_contacter') rel.push([b, 'Contacter l’annonceur', b.annonceur || 'voir l’annonce']);
    else if (st === 'nouveau' && b.nouveau) { const e = ev(b); if (!e.exclu && e.score >= 70) rel.push([b, 'Bonne piste à contacter vite (' + e.score + '/100)', 'vue ' + ilYA(b.premierVuLe)]); }
    else if (st === 'contacte' && h > 48) rel.push([b, 'Relancer : contacté ' + ilYA(b.statusLe), b.annonceur || '']);
    else if (st === 'dossier' && h > 96) rel.push([b, 'Demander un retour sur le dossier', 'déposé ' + ilYA(b.statusLe)]);
  }
  document.getElementById('relances').innerHTML = rel.length ? rel.map((r) => {
    const st = r[0].status || 'nouveau';
    return '<div class="item"><span class="pill st-' + st + '" style="flex:none;margin-top:2px">' + LABEL[st] + '</span><div class="grow"><div class="t">' + esc(r[1]) + '</div><div class="s">' + esc(lib(r[0])) + (r[2] ? ' · ' + esc(r[2]) : '') + '</div></div></div>';
  }).join('') : '<p class="meta">Rien à relancer pour l’instant.</p>';

  const g = new Map();
  for (const b of S.biens) {
    if (!estSuivi(b) || b.status === 'refuse' || b.status === 'ecarte') continue;
    const k = b.annonceur || (b.src === 'manuel' ? (b.portail || 'Ajout à la main') : 'Annonceur non nommé');
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(b);
  }
  document.getElementById('contacts').innerHTML = g.size ? [...g.entries()].map(([k, l]) =>
    '<div class="item"><div class="grow"><div class="t">' + esc(k) + '</div>' + l.map((b) => '<div class="s">' + esc(lib(b)) + (b.url ? ' · <a href="' + esc(b.url) + '" target="_blank" rel="noopener noreferrer">annonce ↗</a>' : '') + '</div>').join('') + '</div></div>'
  ).join('') : '<p class="meta">Les annonceurs apparaissent avec les biens mis de côté ou suivis.</p>';

  const dos = S.reglages.dossier || [];
  const fait = DOSSIER.filter((d, i) => dos[i]).length;
  document.getElementById('dossier-bar').style.width = (fait / DOSSIER.length * 100) + '%';
  document.getElementById('dossier-n').textContent = fait + ' / ' + DOSSIER.length;
  document.getElementById('dossier').innerHTML = DOSSIER.map((d, i) => '<label class="check"><input type="checkbox" data-dos="' + i + '"' + (dos[i] ? ' checked' : '') + '><span>' + d[0] + (d[1] ? '<em>' + d[1] + '</em>' : '') + '</span></label>').join('');
}
export function cocherDossier(i, v) {
  const d = (S.reglages.dossier || []).slice(); d[i] = v; S.reglages.dossier = d; sauverReglages();
  const fait = DOSSIER.filter((x, k) => d[k]).length;
  document.getElementById('dossier-bar').style.width = (fait / DOSSIER.length * 100) + '%';
  document.getElementById('dossier-n').textContent = fait + ' / ' + DOSSIER.length;
}

/* ---------- Sources, vie privée ---------- */
export function rendreSources() {
  const L = [
    ['Bi', 'Bien’ici', 'Lu en direct par ce téléphone à chaque actualisation : annonces d’agences, de réseaux et de mandataires, toute la France. Les biens suivis qui sortent de la recherche sont vérifiés un par un sur leur fiche.', 'ok', 'En direct'],
    ['SL', 'SeLoger', 'Ne permet pas la lecture automatique. Une annonce vue sur SeLoger s’ajoute à la main pour la suivre ici.', 'manual', 'À la main'],
    ['Lb', 'Leboncoin, PAP', 'Ne permettent pas la lecture automatique. Même chose : ajout à la main.', 'manual', 'À la main']
  ];
  document.getElementById('sources').innerHTML = L.map((s) => '<div class="src"><span class="ico">' + s[0] + '</span><div class="grow"><div style="font-weight:600">' + s[1] + '</div><div class="how">' + s[2] + '</div></div><span class="state ' + s[3] + '">' + s[4] + '</span></div>').join('') +
    '<div class="row" style="border-top:1px solid var(--line);padding-top:12px"><div class="grow"><div style="font-weight:600">Ajouter une annonce à la main</div><p class="meta">Lien, loyer, surface et commune : suivie dans la même liste.</p></div><button class="btn primary" type="button" id="manuel-add">Ajouter</button></div>';
  const r = S.run;
  document.getElementById('journal').innerHTML = r.derniere ? '<div><b>' + esc(dateFr(r.derniere, true)) + '</b> · ' + r.nb + ' annonce' + (r.nb > 1 ? 's' : '') + ' lue' + (r.nb > 1 ? 's' : '') + (r.borneAtteinte ? ' · limite de 300 atteinte : resserrer les critères pour tout voir' : '') + '</div>' +
    (r.parLieu || []).map((l) => '<div>' + esc(l.nom) + ' : ' + (l.echec ? 'échec réseau' : l.total + ' annonce' + (l.total > 1 ? 's' : '') + (l.lus !== l.total ? ', ' + l.lus + ' lues' : '')) + '</div>').join('') : 'Aucune recherche pour l’instant.';
  document.getElementById('vie-privee').innerHTML =
    '<p><b>Sur ce téléphone seulement :</b> critères, annonces vues, statuts, notes, biens mis de côté, visites, calculs de trajets et d’arrêts. ' +
      (ALERTES_URL ? 'Le seul serveur propre à l’application est celui des alertes, facultatif (ci-dessous) : pas de compte, pas de cookie, pas de mesure d’audience.</p>' : 'Il n’existe aucun serveur propre à l’application : pas de compte, pas de cookie, pas de mesure d’audience.</p>') +
    (ALERTES_URL ? '<p><b>Alertes par notification (facultatives, coupées tant qu’elles ne sont pas activées dans Critères) :</b> le serveur d’alertes (' + esc(hoteAlertes()) + ') interroge Bien’ici toutes les 15 minutes à la place du téléphone et le réveille par une notification. Il reçoit uniquement : les critères de recherche (ce que Bien’ici reçoit déjà : lieux, type de bien, plafond et minimums ; plus les exigences sur le logement et les quartiers écartés, nécessaires pour écarter les mêmes annonces que l’application), les numéros des annonces suivies avec leur dernier loyer, et l’adresse technique de notification du téléphone. Il garde la liste des annonces déjà vues et leur loyer. Jamais les adresses des trajets, ni l’adresse actuelle, ni les notes, ni un nom ou un e-mail. Tout est effacé quand les alertes sont coupées (ou par « Tout effacer »), et après 45 jours sans nouvelles du téléphone. La notification passe chiffrée par le service du fabricant du téléphone (Apple, Google, Mozilla ou Microsoft), qui ne peut pas la lire.</p>' : '') +
    '<p><b>Services contactés directement par le téléphone, et ce qu’ils reçoivent :</b></p><ul>' +
    '<li><b>Bien’ici</b> (www.bienici.com, res.bienici.com) : les lieux de recherche et les fourchettes envoyées (type de bien, loyer plafond, surface et pièces minimum) ; le texte tapé dans « Ajouter une commune » ; le numéro des annonces suivies, pour vérifier qu’elles sont en ligne. Les photos viennent de file.bienici.com, qui renvoie vers son stockage d’images.</li>' +
    '<li><b>Transitous</b> (api.transitous.org) : la position approchée de l’annonce, les coordonnées de chaque destination et l’heure d’arrivée ; hors Île-de-France, la position approchée pour lister les arrêts proches. Il reçoit aussi l’adresse du site qui héberge l’application, qu’il demande pour identifier les applications qui l’utilisent.</li>' +
    '<li><b>Base adresse nationale</b> (api-adresse.data.gouv.fr) : le texte tapé dans un champ d’adresse.</li>' +
    '<li><b>Île-de-France Mobilités</b> (data.iledefrance-mobilites.fr) : la position approchée de l’annonce.</li></ul>' +
    '<p>Comme pour toute page web, chacun de ces services voit aussi l’adresse IP du téléphone.</p>' +
    '<p><b>Effacement :</b> « Tout effacer » ci-dessus. Le navigateur peut aussi vider ces données ; Safari le fait après 7 jours sans ouverture, sauf pour une application ajoutée à l’écran d’accueil. Une sauvegarde régulière (« Exporter mes données ») évite toute perte.</p>';
  document.getElementById('attributions').innerHTML =
    '<p>Annonces : Bien’ici. Trajets et arrêts hors Île-de-France : <a href="https://transitous.org/sources/" target="_blank" rel="noopener noreferrer">Transitous et ses sources</a>, service bénévole, usage non commercial ; cartographie piétonne © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">contributeurs OpenStreetMap</a>. Arrêts et lignes d’Île-de-France : Île-de-France Mobilités (données ouvertes). Adresses : Base adresse nationale.</p>' +
    (CONTACT_APP ? '<p>Contact, signalement d’un problème : <a href="' + esc(CONTACT_APP) + '" target="_blank" rel="noopener noreferrer">page du projet</a>.</p>' : '');
  document.getElementById('version').textContent = APP_NOM + ' ' + APP_VERSION + (S.memoireSeule ? ' · stockage indisponible : rien n’est gardé après fermeture' : '');
}

/* ---------- Mail ---------- */
export function ouvrirMail(id) {
  const b = bien(id); if (!b) return;
  const txt = 'Objet : Location ' + nomCommune(b) + (b.quartier ? ' ' + b.quartier : '') + (b.surf ? ' · ' + fmt(b.surf) + ' m²' : '') + (b.loyer != null ? ' · ' + fmt(b.loyer) + ' €' : '') + (b.ref ? ' · réf. ' + b.ref : '') + '\n\n' +
    'Bonjour,\n\n' +
    'Votre annonce' + (b.ref ? ' (réf. ' + b.ref + ')' : '') + ' pour ' + (b.type === 'house' ? 'la maison' : 'l’appartement') + (b.pieces ? ' de ' + b.pieces + ' pièces' : '') + (b.surf ? ', ' + fmt(b.surf) + ' m²,' : '') + ' à ' + nomCommune(b) + ' m’intéresse.\n\n' +
    'Mon dossier est complet et peut vous être transmis dès aujourd’hui.\n\n' +
    'Serait-il possible de le visiter prochainement ?\n\n' +
    'Bien cordialement,\n[Prénom Nom]\n[Téléphone]';
  document.getElementById('sheet-t').textContent = 'Mail prêt à envoyer';
  const body = document.getElementById('sheet-body');
  body.onclick = null;
  body.innerHTML = '<p class="meta">' + esc(b.annonceur ? 'À : ' + b.annonceur : 'À l’annonceur') + (b.url ? ' · <a href="' + esc(b.url) + '" target="_blank" rel="noopener noreferrer">formulaire de l’annonce ↗</a>' : '') + '</p>' +
    '<pre id="mail-txt">' + esc(txt) + '</pre><div class="row"><button class="btn primary" type="button" id="mail-copy">Copier le texte</button><span class="meta" id="mail-msg"></span></div>' +
    '<p class="meta">À compléter, puis coller dans la messagerie ou le formulaire de l’annonce. Rien ne part sans action de l’utilisateur.</p>';
  document.getElementById('sheet').hidden = false;
}
export function copierMail() {
  const el = document.getElementById('mail-txt'), msg = document.getElementById('mail-msg');
  const sel = () => { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); msg.textContent = 'Texte sélectionné.'; };
  try { navigator.clipboard.writeText(el.textContent).then(() => { msg.textContent = 'Copié.'; }, sel); } catch (e) { sel(); }
}

/* ---------- Visionneuse ---------- */
export function ouvrirPhotos(id, i) {
  const b = bien(id); if (!b) return;
  const ph = b.photos || [];
  document.getElementById('viewer-t').textContent = lib(b);
  document.getElementById('vstrip').innerHTML = ph.map((u, k) => '<div><img alt="" referrerpolicy="no-referrer" loading="' + (Math.abs(k - i) < 2 ? 'eager' : 'lazy') + '" src="' + esc(u) + '"><p>' + (k + 1) + ' / ' + ph.length + '</p></div>').join('');
  document.getElementById('viewer-link').innerHTML = b.url ? '<a class="btn" href="' + esc(b.url) + '" target="_blank" rel="noopener noreferrer">Voir l’annonce ↗</a>' : '';
  document.getElementById('viewer').hidden = false;
  requestAnimationFrame(() => { const st = document.getElementById('vstrip'); st.scrollLeft = i * st.clientWidth; });
}

/* ---------- Ajout à la main ---------- */
export function ouvrirManuel() {
  document.getElementById('sheet-t').textContent = 'Ajouter une annonce à la main';
  const body = document.getElementById('sheet-body');
  body.innerHTML =
    '<div class="fl"><span>Lien de l’annonce</span><input class="txt" id="m-url" type="url" inputmode="url" placeholder="https://…" autocomplete="off"></div>' +
    '<div class="two"><div class="fl"><span>Loyer (€)</span><input class="txt" id="m-loyer" type="number" inputmode="numeric"></div><div class="fl"><span>Surface (m²)</span><input class="txt" id="m-surf" type="number" inputmode="decimal"></div></div>' +
    '<div class="two"><div class="fl"><span>Commune</span><input class="txt" id="m-commune" autocomplete="off" placeholder="Ex. Colombes"></div><div class="fl"><span>Pièces</span><input class="txt" id="m-pieces" type="number" inputmode="numeric"></div></div>' +
    '<div class="fl"><span>Loyer</span><span class="seg" role="group"><button type="button" data-mcc="cc" aria-pressed="true">Charges comprises</button><button type="button" data-mcc="inconnu" aria-pressed="false">Hors charges</button></span></div>' +
    '<p class="err" id="m-err"></p>' +
    '<div class="actions"><button class="btn" type="button" data-close="sheet">Annuler</button><button class="btn primary" type="button" id="m-ok">Ajouter</button></div>';
  let cc = 'cc';
  body.onclick = async (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.mcc) { cc = b.dataset.mcc; b.parentElement.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); return; }
    if (b.id !== 'm-ok') return;
    const err = document.getElementById('m-err');
    const url = document.getElementById('m-url').value.trim();
    let host = '';
    try { const u = new URL(url); if (u.protocol !== 'https:' && u.protocol !== 'http:') throw 0; host = u.hostname.replace(/^www\./, ''); } catch (e) { err.textContent = 'Lien à vérifier (il doit commencer par https://).'; return; }
    const loyer = num(document.getElementById('m-loyer').value), surf = num(document.getElementById('m-surf').value);
    const commune = document.getElementById('m-commune').value.trim();
    if (loyer == null || surf == null || !commune) { err.textContent = 'Loyer, surface et commune à renseigner.'; return; }
    b.disabled = true; err.textContent = '';
    let pos = null;
    try { pos = await geocoder(commune, 'municipality'); } catch (e) { pos = null; }
    const now = new Date().toISOString();
    const portail = /seloger/.test(host) ? 'SeLoger' : /leboncoin/.test(host) ? 'Leboncoin' : /pap\.fr/.test(host) ? 'PAP' : host;
    await ajouterBien({
      id: uid('m-'), src: 'manuel', portail, url, titre: '', type: 'flat', commune: pos ? pos.label : commune, cp: pos ? pos.cp : '', dept: pos ? String(pos.cp).slice(0, 2) : '',
      quartier: '', loyer, charges: null, cc, surf, pieces: num(document.getElementById('m-pieces').value), ch: null, etage: null, ascenseur: null,
      ext: null, cave: null, parking: null, meuble: null, dpe: null, pro: null, photos: [], lat: pos ? pos.lat : null, lon: pos ? pos.lon : null,
      precision: 'commune', premierVuLe: now, dernierVuLe: now, nouveau: false, dispo: 'inconnu', status: 'nouveau', cote: true
    });
    document.getElementById('sheet').hidden = true; body.onclick = null;
    ui.biensModifies();
  };
  document.getElementById('sheet').hidden = false;
  setTimeout(() => document.getElementById('m-url').focus(), 50);
}

/* ---------- Téléchargement d'un fichier ---------- */
export function telecharger(nom, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nom; a.rel = 'noopener';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
export function dateFichier() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

/* ---------- Export tableur (bibliothèque embarquée, chargée au clic) ---------- */
function chargerXLSX() {
  return new Promise((ok, ko) => {
    if (window.XLSX) return ok(window.XLSX);
    const s = document.createElement('script');
    s.src = 'vendor/xlsx.full.min.js';
    s.onload = () => ok(window.XLSX); s.onerror = ko;
    document.head.appendChild(s);
  });
}
export async function exporterTableur() {
  const msg = document.getElementById('export-msg'); msg.textContent = 'Préparation…';
  try {
    const X = await chargerXLSX();
    const D = S.C.destinations.filter((d) => d.lat != null);
    const rows = S.biens.map((b) => {
      const enr = enrPour(b, S.C), e = evaluer(b, S.C, enr);
      const r = {
        'Statut': LABEL[b.status || 'nouveau'], 'Mis de côté': b.cote ? 'oui' : '', 'Score': e.score, 'Passe les critères': e.exclu ? 'non' : 'oui',
        'Raisons': e.why.map((w) => (w[0] === 'ok' ? '+ ' : w[0] === 'ko' ? 'x ' : '. ') + w[1]).join(' ; '),
        'Commune': b.commune || '', 'Quartier': b.quartier || '', 'Loyer (€)': b.loyer, 'Charges': b.cc === 'cc' ? 'comprises' : 'non indiquées', 'Charges (€)': b.charges,
        'Surface (m²)': b.surf, 'Pièces': b.pieces, 'Chambres': b.ch, 'Étage': b.etage, 'Extérieur': b.extLabel || '', 'Cave': b.cave === true ? 'oui' : b.cave === false ? 'non' : '',
        'DPE': b.dpe || '', 'Meublé': b.meuble === true ? 'oui' : b.meuble === false ? 'non' : '', 'Annonceur': b.annonceur || '', 'Annonce': b.url || '',
        'Source': b.src === 'manuel' ? (b.portail || 'à la main') : 'Bien’ici', 'Référence': b.ref || '', 'Publiée le': b.publieLe ? new Date(b.publieLe) : '',
        'Vue le': b.premierVuLe ? new Date(b.premierVuLe) : '', 'En ligne': b.dispo === 'retiree' ? 'retirée' : b.src === 'manuel' ? 'non vérifiable' : 'oui',
        'Retirée le': b.retireeLe ? new Date(b.retireeLe) : '', 'Honoraires (€)': b.honoraires, 'Dépôt (€)': b.depot,
        'Visite': b.visite && b.visite.le ? new Date(b.visite.le) : '', 'Notes': b.notes || ''
      };
      for (const d of D) { const c = trajetRetenu(enr.trajets[d.id], d); r[d.nom + ' (min)'] = c ? c.min : ''; r[d.nom + ' (trajet)'] = c ? c.via : ''; }
      return r;
    });
    const wb = X.utils.book_new();
    const ws = X.utils.json_to_sheet(rows.length ? rows : [{ 'Statut': '' }], { cellDates: true });
    ws['!cols'] = Object.keys(rows[0] || { a: 1 }).map(() => ({ wch: 16 }));
    X.utils.book_append_sheet(wb, ws, 'Biens');
    const out = X.write(wb, { bookType: 'xlsx', type: 'array' });
    const nom = 'suivi-appart-' + dateFichier() + '.xlsx';
    telecharger(nom, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    msg.textContent = 'Fichier ' + nom + ' prêt.';
  } catch (e) { msg.textContent = 'Export impossible : bibliothèque non chargée.'; }
}

export { STATUTS };
