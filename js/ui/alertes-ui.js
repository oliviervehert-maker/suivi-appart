/* Section « Alertes » de l'onglet Critères. Chargée par app.js seulement si ALERTES_URL est renseigné.
   Mises à jour en place : la section garde sa hauteur quel que soit l'état (aucun saut de mise en page). */
import { A, charger, capacite, activer, desactiver, syncMaintenant, synchroniser, modifierReglages, surChangement } from '../alertes.js';
import { esc, ilYA } from '../core/util.js';
import { hoteAlertes } from '../net.js';

const DECL = [
  ['nouvelles', 'Nouvelle annonce', 'qui passe les critères (hors trajets et arrêts)'],
  ['retirees', 'Annonce suivie retirée', 'mise de côté ou en cours de suivi'],
  ['baisses', 'Baisse de loyer', 'annonce suivie ou qui passe les critères']
];

export function init() {
  charger();
  surChangement(maj);
  const racine = document.getElementById('criteres');
  racine.addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b || !racine.contains(b)) return;
    if (b.id === 'al-actif') {
      if (A.enCours) return;
      if (A.actif) desactiver(); else activer();
    } else if (b.id === 'al-silence') {
      modifierReglages({ silenceActif: !A.silenceActif });
    } else if (b.id === 'al-reessayer') {
      if (A.actif) syncMaintenant(true); else activer();
    }
  });
  racine.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset && t.dataset.alDecl) { const d = {}; d[t.dataset.alDecl] = t.checked; modifierReglages({ declencheurs: d }); return; }
    if (t.id === 'al-debut' || t.id === 'al-fin') {
      const debut = document.getElementById('al-debut').value, fin = document.getElementById('al-fin').value;
      if (/^\d\d:\d\d$/.test(debut) && /^\d\d:\d\d$/.test(fin)) modifierReglages({ silence: { debut, fin } });
      else maj();
    }
  });
}

export function resume() {
  if (!A.actif) return 'coupées';
  return A.erreur ? 'actives, à vérifier' : 'actives sur cet appareil';
}

/* Libellé d'état et bouton « Réessayer » éventuel. */
export function etat() {
  if (A.enCours) return { t: 'Inscription en cours…', r: false };
  const cap = capacite();
  if (cap === 'non_supporte') return { t: 'Ce navigateur ne permet pas les notifications.', r: false };
  if (cap === 'ios_hors_ecran') return { t: 'Poser d’abord l’app sur l’écran d’accueil : Partager, « Sur l’écran d’accueil », puis l’ouvrir depuis son icône.', r: false };
  if (cap === 'refuse') return { t: 'Notifications refusées pour ce site. À rétablir : iPhone, Réglages, Notifications, Suivi appart ; Android, Chrome, Paramètres des sites, Notifications.', r: false };
  const e = A.erreur;
  if (e === 'injoignable') return { t: 'Serveur d’alertes injoignable.', r: true };
  if (e === 'echec') return { t: 'Inscription impossible sur cet appareil' + (A.message ? ' (' + A.message + ')' : '') + '.', r: true };
  if (e === 'pas_de_permission') return { t: 'Autorisation de notification non accordée.', r: true };
  if (e === 'complet') return { t: 'Serveur d’alertes complet : aucune nouvelle inscription pour l’instant.', r: true };
  if (e === 'jeton') return { t: 'Inscription refusée par le serveur : couper puis réactiver les alertes.', r: false };
  if (e === 'refus') return { t: 'Refus du serveur' + (A.message ? ' : ' + A.message : '.'), r: false };
  if (e === 'sans_lieu') return { t: 'Aucun lieu de recherche : alertes en attente d’un lieu.', r: false };
  if (e === 'trop_de_zones') return { t: 'Plus de 30 zones de recherche : en retirer pour recevoir les alertes.', r: false };
  if (e === 'effacement_differe') return { t: 'Coupées sur cet appareil. Serveur injoignable : l’inscription s’y effacera d’elle-même, en 45 jours au plus.', r: false };
  if (A.actif) return { t: 'Actives · dernière synchronisation ' + (A.derniereSync ? ilYA(A.derniereSync) : 'en attente'), r: false };
  return { t: 'Coupées. Une fois actives, une notification arrive même application fermée.', r: false };
}

export function corps() {
  const hote = hoteAlertes();
  return '<div class="field col"><p class="al-etat" id="al-etat" aria-live="polite">&nbsp;</p>' +
      '<div class="al-actions"><button class="btn" type="button" id="al-reessayer">Réessayer</button></div></div>' +
    '<div class="field"><div class="lbl">Alertes sur cet appareil<em>Relève toutes les 15 minutes par le serveur d’alertes</em></div>' +
      '<button class="toggle" type="button" id="al-actif" aria-pressed="false" aria-label="Alertes sur cet appareil"></button></div>' +
    DECL.map(([k, t, em]) => '<label class="field al-case"><span class="lbl">' + t + '<em>' + em + '</em></span><input type="checkbox" data-al-decl="' + k + '"></label>').join('') +
    '<div class="field"><div class="lbl">Heures de silence<em>Heure de Paris ; les alertes attendent la fin de la plage, regroupées</em></div>' +
      '<button class="toggle" type="button" id="al-silence" aria-pressed="true" aria-label="Heures de silence"></button></div>' +
    '<div class="field"><div class="lbl">Plage</div><span class="al-plage"><input class="visite-in" type="time" id="al-debut" aria-label="Début du silence"><span>à</span><input class="visite-in" type="time" id="al-fin" aria-label="Fin du silence"></span></div>' +
    '<p class="meta">Le serveur d’alertes' + (hote ? ' (' + esc(hote) + ')' : '') + ' reçoit uniquement les critères de recherche (lieux, type de bien, plafond et minimums, exigences sur le logement, quartiers écartés), les numéros des annonces suivies avec leur dernier loyer, et l’adresse technique de notification de cet appareil. Il garde la liste des annonces déjà vues et leur loyer. Jamais les adresses des trajets, ni l’adresse actuelle, ni les notes, ni un nom ou un e-mail. Tout y est effacé quand les alertes sont coupées, et après 45 jours sans nouvelles de cet appareil.</p>';
}

/* Mise à jour en place des contrôles (aucun élément recréé). */
export function maj() {
  const el = document.getElementById('al-etat'); if (!el) return;
  const e = etat();
  el.textContent = e.t;
  const r = document.getElementById('al-reessayer');
  r.style.visibility = e.r && !A.enCours ? 'visible' : 'hidden';
  r.disabled = !e.r || A.enCours;
  const cap = capacite();
  const t = document.getElementById('al-actif');
  t.setAttribute('aria-pressed', String(A.actif));
  t.disabled = A.enCours || (!A.actif && (cap === 'non_supporte' || cap === 'ios_hors_ecran' || cap === 'refuse'));
  document.querySelectorAll('[data-al-decl]').forEach((c) => { c.checked = !!A.declencheurs[c.dataset.alDecl]; });
  document.getElementById('al-silence').setAttribute('aria-pressed', String(A.silenceActif));
  const d = document.getElementById('al-debut'), f = document.getElementById('al-fin');
  if (document.activeElement !== d) d.value = A.silence.debut;
  if (document.activeElement !== f) f.value = A.silence.fin;
  d.disabled = f.disabled = !A.silenceActif;
  const rs = document.querySelector('[data-rs="alertes"]'); if (rs) rs.textContent = resume();
}

/* Au démarrage : contact avec le serveur si les alertes sont actives. */
export function demarrage() { if (A.actif) syncMaintenant(true); }
export function modifie() { synchroniser(); }
export async function couper() { if (A.actif || A.jeton) await desactiver(); }
export { syncMaintenant };
