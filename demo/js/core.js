// Outils de l'interface : appels serveur, file hors ligne, formats, fenêtres, tableaux, formulaires.
import { icon } from './icons.js';

export const S = { moi: null, params: {}, activites: [], enLigne: navigator.onLine };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2));

// ── Formats (Madagascar) ──
const TZ = 'Indian/Antananarivo';
export const ar = (n) => (Math.round(Number(n) || 0)).toLocaleString('fr-FR').replace(/ /g, ' ') + ' Ar';
export const nb = (n, d = 2) => (Number(n) || 0).toLocaleString('fr-FR', { maximumFractionDigits: d });
export const dateFr = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
export const heureFr = (iso) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '');
export const dateHeureFr = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const aujourdhui = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
export const plusJours = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
export const MODES = { especes: 'Espèces', mvola: 'MVola', orange_money: 'Orange Money', airtel_money: 'Airtel Money', carte: 'Carte bancaire', virement: 'Virement', cheque: 'Chèque' };
export const actNom = (id) => S.activites.find((a) => a.id === id)?.nom || id || 'Charges communes';
export const actCouleur = (id) => S.activites.find((a) => a.id === id)?.couleur || '#64748b';

// ── Permissions (affichage seulement : le serveur vérifie toujours) ──
export const peut = (module, action = 'C') => S.moi?.role === 'super_adm' || (S.moi?.perms?.[module] || '').includes(action);
export const mesActivites = () => (S.moi?.activites === '*' || S.moi?.role === 'super_adm' ? S.activites : S.activites.filter((a) => S.moi.activites.split(',').includes(a.id)));

// ── Appels au serveur ──
export class ErreurApi extends Error { constructor(msg, code, status) { super(msg); this.code = code; this.status = status; } }
// Adresse de l'API (Supabase) : définie dans config.js ; jeton de session gardé sur l'appareil
export const API = () => window.RT_API || '';
export const jeton = { lire: () => { try { return localStorage.getItem('rt_jeton:' + API()) || ''; } catch { return ''; } }, ecrire: (j) => { try { j ? localStorage.setItem('rt_jeton:' + API(), j) : localStorage.removeItem('rt_jeton:' + API()); } catch { /* */ } } };
export async function api(method, path, body, opts = {}) {
  const headers = { 'x-rt': '1' };
  if (jeton.lire()) headers.authorization = 'Bearer ' + jeton.lire();
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (opts.idem) headers['idempotency-key'] = opts.idem;
  let r;
  try {
    r = await fetch(API() + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ErreurApi('Connexion internet indisponible. Vérifiez le réseau puis réessayez.', 'HORS_LIGNE', 0);
  }
  if (opts.brut) return r;
  let data = null;
  try { data = await r.json(); } catch { /* réponse non JSON */ }
  if (!r.ok) {
    const e = new ErreurApi(data?.erreur || 'Erreur du serveur. Réessayez.', data?.code || 'ERREUR', r.status);
    if (r.status === 401 && path !== '/api/auth/connexion') { jeton.ecrire(''); window.dispatchEvent(new CustomEvent('rt:deconnecte')); }
    if (e.code === 'MDP_A_CHANGER') window.dispatchEvent(new CustomEvent('rt:mdp'));
    if (e.code === 'DEMO_EXPIREE') window.dispatchEvent(new CustomEvent('rt:demo-expiree', { detail: e.message }));
    throw e;
  }
  return data;
}
export const get = (p) => api('GET', p);
export const post = (p, b = {}, o) => api('POST', p, b, o);
export const put = (p, b = {}) => api('PUT', p, b);
export const del = (p) => api('DELETE', p);
export const qs = (o) => '?' + new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();

// ── File d'attente hors connexion (ventes de caisse) ──
const FILE = 'rt_file_attente';
export const fileAttente = () => { try { return JSON.parse(localStorage.getItem(FILE) || '[]'); } catch { return []; } };
const ecrireFile = (f) => { try { localStorage.setItem(FILE, JSON.stringify(f)); } catch { /* stockage indisponible */ } window.dispatchEvent(new CustomEvent('rt:file')); };
export function mettreEnFile(op) { const f = fileAttente(); f.push({ ...op, quand: new Date().toISOString() }); ecrireFile(f); }
let syncEnCours = false;
export async function synchroniser() {
  if (syncEnCours || !navigator.onLine) return;
  syncEnCours = true;
  let f = fileAttente();
  const conflits = [];
  for (const op of [...f]) {
    try { await api(op.method, op.path, op.body, { idem: op.idem }); }
    catch (e) {
      if (e.code === 'HORS_LIGNE') break;
      if (e.code !== 'DEJA_ENREGISTRE') conflits.push({ ...op, erreur: e.message });
    }
    f = f.filter((x) => x.idem !== op.idem); ecrireFile(f);
  }
  syncEnCours = false;
  if (conflits.length) {
    try { localStorage.setItem('rt_conflits', JSON.stringify([...JSON.parse(localStorage.getItem('rt_conflits') || '[]'), ...conflits])); } catch { /* */ }
    toast(`${conflits.length} opération(s) hors ligne refusée(s) par le serveur : voir « Synchronisation » en bas de l’écran.`, 'err', 9000);
  } else if (!fileAttente().length) toast('Opérations hors ligne synchronisées.', 'ok');
}

// ── Notifications et fenêtres ──
export function toast(msg, type = '', ms = 4200) {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.append(box); }
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = `${icon(type === 'err' ? 'alert' : type === 'ok' ? 'check' : 'bell')}<span>${esc(msg)}</span>`;
  t.querySelector('svg').style.cssText = 'width:18px;height:18px;flex:none;margin-top:1px';
  box.append(t);
  setTimeout(() => t.remove(), ms);
}
export const erreur = (e) => toast(e?.message || String(e), 'err', 6500);

/** Fenêtre modale. actions : [{ label, cls, value, act: async (modalEl) => valeur | false }] */
export function modal({ titre, corps, actions = [{ label: 'Fermer', value: null }], large = false, onOpen }) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal ${large ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(titre)}">
      <div class="modal-h"><h2>${esc(titre)}</h2><button class="icon-btn" data-x aria-label="Fermer">${icon('x')}</button></div>
      <div class="modal-b">${corps}</div>
      <div class="modal-f">${actions.map((a, i) => `<button class="btn ${a.cls || ''}" data-i="${i}">${a.label}</button>`).join('')}</div></div>`;
    const fermer = (v) => { bg.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') fermer(null); };
    document.addEventListener('keydown', onKey);
    bg.addEventListener('click', async (e) => {
      if (e.target === bg || e.target.closest('[data-x]')) return fermer(null);
      const b = e.target.closest('.modal-f [data-i]');
      if (!b) return;
      const a = actions[Number(b.dataset.i)];
      if (!a.act) return fermer(a.value ?? null);
      b.disabled = true;
      try { const v = await a.act(bg.querySelector('.modal')); if (v !== false) fermer(v); }
      catch (err) { erreur(err); }
      finally { b.disabled = false; }
    });
    document.body.append(bg);
    const f = bg.querySelector('.modal-b input:not([type=hidden]), .modal-b select, .modal-b textarea');
    if (f) setTimeout(() => f.focus(), 50);
    if (onOpen) onOpen(bg.querySelector('.modal'));
  });
}
export const confirmer = (titre, texte, label = 'Confirmer', cls = 'primary') => modal({ titre, corps: `<p>${texte}</p>`, actions: [{ label: 'Annuler', value: false }, { label, cls, value: true }] });
export async function demander(titre, label, opts = {}) {
  return modal({ titre, corps: `<div class="field"><label>${esc(label)}</label><${opts.long ? 'textarea' : 'input'} id="q-val" ${opts.type ? `type="${opts.type}"` : ''} value="${esc(opts.def || '')}">${opts.long ? '</textarea>' : ''}${opts.aide ? `<div class="hint">${opts.aide}</div>` : ''}</div>`,
    actions: [{ label: 'Annuler', value: null }, { label: opts.bouton || 'Valider', cls: opts.cls || 'primary', act: (m) => { const v = $('#q-val', m).value.trim(); if (opts.req !== false && !v) { toast('Ce champ est obligatoire.', 'err'); return false; } return v; } }] });
}

// ── Formulaires générés ──
/** champs : [{ k, label, type: text|number|date|time|select|textarea|checkbox|email|color, opts:[[v,l]], req, full, hint, min, step }] */
export function formulaire(champs, v = {}) {
  return `<div class="form">${champs.map((c) => {
    const val = v[c.k] ?? c.def ?? '';
    const req = c.req ? ' required' : '';
    let input;
    if (c.type === 'select') input = `<select name="${c.k}"${req}>${c.vide !== false ? `<option value="">${esc(c.vide || '—')}</option>` : ''}${(c.opts || []).map(([o, l]) => `<option value="${esc(o)}" ${String(o) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    else if (c.type === 'textarea') input = `<textarea name="${c.k}"${req}>${esc(val)}</textarea>`;
    else if (c.type === 'checkbox') input = `<label class="inline" style="font-weight:500;color:var(--text)"><input type="checkbox" name="${c.k}" ${val && val !== '0' ? 'checked' : ''}> ${esc(c.texte || '')}</label>`;
    else input = `<input name="${c.k}" type="${c.type || 'text'}" value="${esc(val)}"${req}${c.min !== undefined ? ` min="${c.min}"` : ''}${c.step ? ` step="${c.step}"` : ''}${c.ph ? ` placeholder="${esc(c.ph)}"` : ''}${c.list ? ` list="${c.list}"` : ''} ${c.type === 'number' ? 'inputmode="decimal"' : ''}>`;
    return `<div class="field ${c.full ? 'full' : ''}"><label>${esc(c.label)}${c.req ? ' <span class="req">*</span>' : ''}</label>${input}${c.hint ? `<div class="hint">${c.hint}</div>` : ''}</div>`;
  }).join('')}</div>`;
}
export function lireFormulaire(root, champs) {
  const o = {};
  for (const c of champs) {
    const el = root.querySelector(`[name="${c.k}"]`);
    if (!el) continue;
    let v = c.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value.trim();
    if (c.type === 'number' && v !== '') v = Number(String(v).replace(',', '.'));
    if (c.req && (v === '' || v === null)) throw new Error(`Le champ « ${c.label} » est obligatoire.`);
    o[c.k] = v === '' ? null : v;
  }
  return o;
}

// ── Tableaux avec recherche et tri ──
/** cols : [{ k, label, num, f: (row) => html, tri: (row) => valeur }] ; actions : (row) => html */
export function tableau(el, cols, rows, { actions, vide = 'Aucun élément.', recherche = true, pied } = {}) {
  let filtre = ''; let tri = null; let sens = 1;
  const rendu = () => {
    let r = rows;
    if (filtre) { const f = filtre.toLowerCase(); r = r.filter((x) => cols.some((c) => String(x[c.k] ?? '').toLowerCase().includes(f))); }
    if (tri) { const c = cols.find((x) => x.k === tri); const g = c.tri || ((x) => x[c.k]); r = [...r].sort((a, b) => (g(a) > g(b) ? 1 : g(a) < g(b) ? -1 : 0) * sens); }
    $('.tw', el).innerHTML = r.length ? `<table class="t"><thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''}" data-k="${c.k}">${esc(c.label)}${tri === c.k ? (sens > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}${actions ? '<th></th>' : ''}</tr></thead>
      <tbody>${r.map((x, i) => `<tr data-i="${rows.indexOf(x)}">${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.f ? c.f(x) : esc(x[c.k])}</td>`).join('')}${actions ? `<td class="right nowrap">${actions(x, i)}</td>` : ''}</tr>`).join('')}</tbody>
      ${pied ? `<tfoot><tr>${pied(r)}</tr></tfoot>` : ''}</table>` : `<div class="empty">${icon('box')}<p>${esc(vide)}</p></div>`;
  };
  el.innerHTML = `${recherche ? `<div class="toolbar"><input type="search" placeholder="Rechercher…" aria-label="Rechercher"><span class="muted">${rows.length} élément(s)</span></div>` : ''}<div class="table-wrap tw"></div>`;
  if (recherche) $('input', el).addEventListener('input', (e) => { filtre = e.target.value; rendu(); });
  el.addEventListener('click', (e) => { const th = e.target.closest('th[data-k]'); if (!th) return; if (tri === th.dataset.k) sens = -sens; else { tri = th.dataset.k; sens = 1; } rendu(); });
  rendu();
  return { ligne: (tr) => rows[Number(tr.closest('tr').dataset.i)] };
}

// ── Délégation d'événements ──
export function sur(root, type, sel, fn) {
  root.addEventListener(type, (e) => { const t = e.target.closest(sel); if (t && root.contains(t)) fn(e, t); });
}
export const tete = (titre, sous = '', actions = '') => `<div class="page-head"><div><h1>${esc(titre)}</h1>${sous ? `<p>${sous}</p>` : ''}</div><div class="actions">${actions}</div></div>`;
export const bouton = (label, act, ico = '', cls = '', extra = '') => `<button class="btn ${cls}" data-act="${act}" ${extra}>${ico ? icon(ico) : ''}${esc(label)}</button>`;
export const statutTag = (s) => {
  const m = { reservee: ['Réservée', 'info'], en_cours: ['En cours', 'ok'], terminee: ['Terminée', ''], annulee: ['Annulée', 'danger'], ouvert: ['Ouvert', 'info'], clos: ['Clôturé', ''], annule: ['Annulé', 'danger'],
    valide: ['Valide', 'ok'], prevu: ['Prévu', 'info'], fait: ['Réalisé', 'ok'], absent: ['Absent', 'warn'], devis: ['Devis', 'warn'], confirme: ['Confirmé', 'ok'], termine: ['Terminé', ''],
    ouverte: ['Ouverte', 'ok'], fermee: ['Fermée', 'warn'], validee: ['Validée', ''], propre: ['Propre', 'ok'], nettoyage: ['À nettoyer', 'warn'], maintenance: ['Maintenance', 'danger'], hors_service: ['Hors service', 'danger'],
    actif: ['Actif', 'ok'], suspendu: ['Suspendu', 'warn'], desactive: ['Désactivé', 'danger'], payee: ['Payée', 'ok'], au_folio: ['Au compte', 'info'] }[s] || [s, ''];
  return `<span class="tag ${m[1]}">${esc(m[0])}</span>`;
};

// Compression d'image côté navigateur (logo) : redimensionnement + WebP si possible
export async function compresserImage(file, max = 360) {
  const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = URL.createObjectURL(file); });
  const r = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  let d = c.toDataURL('image/webp', 0.85);
  if (!d.startsWith('data:image/webp')) d = c.toDataURL('image/png');
  return d;
}

/** Téléchargement authentifié (CSV, sauvegardes) : le fichier passe par le jeton de session. */
export async function telecharger(path) {
  try {
    const r = await fetch(API() + path, { headers: { authorization: 'Bearer ' + jeton.lire() } });
    if (!r.ok) { let m = 'Téléchargement impossible.'; try { m = (await r.json()).erreur || m; } catch { /* */ } throw new Error(m); }
    const nom = (r.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'export';
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a'); a.href = url; a.download = nom; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) { erreur(e); }
}
