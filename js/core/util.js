/* Outils purs : aucun accès à document, window ni au stockage (importables par Node). */

export const MINUS = '−';

export function norm(t) {
  return String(t == null ? '' : t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[-'’]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* Nombre à la française, vrai signe moins, espace fine insécable des milliers. */
export function fmt(n, dec = 0) {
  if (n == null || n === '' || isNaN(n)) return '—';
  const s = Number(n).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return s.replace('-', MINUS);
}

export function num(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.').replace(/\s/g, ''));
  return isFinite(n) ? n : null;
}

export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

/* Distance à vol d'oiseau, en mètres. */
export function distM(lat1, lon1, lat2, lon2) {
  const r = 6371000, rad = Math.PI / 180;
  const p1 = lat1 * rad, p2 = lat2 * rad, dp = (lat2 - lat1) * rad, dl = (lon2 - lon1) * rad;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/* Marche estimée : vol d'oiseau x 1,25 pour les rues, 75 m par minute. */
export const MARCHE_DETOUR = 1.25;
export const MARCHE_M_MIN = 75;
export function minutesAPied(m) { return Math.max(1, Math.round(m * MARCHE_DETOUR / MARCHE_M_MIN)); }
export function rayonPourMinutes(min) { return Math.round(min * MARCHE_M_MIN / MARCHE_DETOUR); }

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
export function dateFr(iso, heure) {
  const d = new Date(iso); if (isNaN(d)) return '';
  return d.getDate() + ' ' + MOIS[d.getMonth()] + (heure ? ' à ' + d.getHours() + ' h ' + String(d.getMinutes()).padStart(2, '0') : '');
}
export function moisCourt(i) { return MOIS[i]; }

export function ilYA(iso, now = Date.now()) {
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!t || isNaN(t)) return '';
  const min = Math.max(0, (now - t) / 60000);
  if (min < 1) return 'à l’instant';
  if (min < 60) return 'il y a ' + Math.round(min) + ' min';
  const h = min / 60;
  if (h < 24) return 'il y a ' + Math.round(h) + ' h';
  return 'il y a ' + Math.round(h / 24) + ' j';
}

export function dureeTxt(min) {
  if (min == null) return '—';
  if (min < 60) return min + ' min';
  const h = Math.floor(min / 60), m = min % 60;
  return h + ' h' + (m ? ' ' + String(m).padStart(2, '0') : '');
}

export function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function deepCopy(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

/* Décalage horaire de Paris à une date donnée, ex. « +01:00 ». */
export function decalageParis(date) {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', timeZoneName: 'shortOffset' }).formatToParts(date);
    const z = (p.find((x) => x.type === 'timeZoneName') || {}).value || 'GMT+1';
    const m = z.match(/GMT([+-])(\d{1,2})(?::(\d\d))?/);
    if (!m) return '+00:00';
    return m[1] + String(m[2]).padStart(2, '0') + ':' + (m[3] || '00');
  } catch (e) { return '+01:00'; }
}

/* Prochain mardi (jour ouvré type), au moins demain : même méthode que l'agent d'origine. */
export function mardiProchain(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12);
  while (d.getDay() !== 2) d.setDate(d.getDate() + 1);
  return d;
}

/* Heure « 08:30 » un jour donné, heure de Paris, au format ISO avec décalage. */
export function isoParis(jour, heure) {
  const y = jour.getFullYear(), mo = String(jour.getMonth() + 1).padStart(2, '0'), da = String(jour.getDate()).padStart(2, '0');
  const hh = /^\d{1,2}:\d\d$/.test(heure || '') ? heure.padStart(5, '0') : '08:30';
  return y + '-' + mo + '-' + da + 'T' + hh + ':00' + decalageParis(jour);
}

export function stripHtml(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

export function hachage(s) {
  let h = 2166136261;
  const t = String(s);
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
