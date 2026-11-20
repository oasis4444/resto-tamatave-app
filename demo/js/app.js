// Coquille de l'application : démarrage, connexion, menu latéral dynamique, navigation, pied de page.
import { S, esc, $, $$, api, get, post, toast, erreur, peut, fileAttente, synchroniser, sur, modal, dateHeureFr, jeton } from './core.js';
import { icon } from './icons.js';
import { MENU, PAGES } from './menu.js';

const root = document.getElementById('root');
let nettoyage = null;
let moduleOuvert = sessionStorage.getItem('rt_module') || null;

// ── Thème ──
const THEMES = ['auto', 'light', 'dark'];
function appliquerTheme(t = localStorage.getItem('rt_theme') || 'auto') { document.documentElement.dataset.theme = t; }
appliquerTheme();
function appliquerCouleur() { if (S.params.couleur_principale) document.documentElement.style.setProperty('--accent', S.params.couleur_principale); }

// ── Démarrage ──
async function demarrer() {
  let etat;
  try { etat = await get('/api/etat'); } catch (e) { return ecranMessage('Serveur injoignable', e.message, true); }
  if (etat.demo?.expiree) return ecranDemoExpiree();
  if (!etat.installe && etat.mode !== 'demo') return ecranInstallation(etat);
  try {
    const moi = await get('/api/auth/moi');
    S.moi = moi; S.params = moi.parametres; S.activites = moi.liste_activites;
    appliquerCouleur();
    if (moi.doit_changer_mdp) return ecranMotDePasse(true);
    afficherCoquille();
  } catch (e) { if (e.status === 401) jeton.ecrire(''); ecranConnexion(etat); }
}

function ecranMessage(titre, texte, reessayer) {
  root.innerHTML = `<div class="blocked"><div class="card" style="max-width:460px"><h2>${esc(titre)}</h2><p class="muted">${esc(texte)}</p>${reessayer ? '<button class="btn primary" id="re">Réessayer</button>' : ''}</div></div>`;
  $('#re')?.addEventListener('click', demarrer);
}
function ecranDemoExpiree(msg) {
  root.innerHTML = `<div class="blocked"><div class="card" style="max-width:520px">${icon('lock')}<h2>Période de démonstration terminée</h2>
    <p>${esc(msg || 'La version de démonstration (3 jours) a expiré. Toutes les fonctions sont bloquées.')}</p>
    <p class="muted">Contactez <b>Ampandrana Création Logiciel</b> pour obtenir la version complète.</p></div></div>`;
  $('.blocked svg').style.cssText = 'width:44px;height:44px;color:var(--danger)';
}
window.addEventListener('rt:demo-expiree', (e) => ecranDemoExpiree(e.detail));
window.addEventListener('rt:deconnecte', () => { if (S.moi) { S.moi = null; toast('Session expirée : reconnectez-vous.', 'err'); ecranConnexion({}); } });
window.addEventListener('rt:mdp', () => ecranMotDePasse(true));

function ecranInstallation() {
  root.innerHTML = `<div class="login"><div class="login-art"><div><h1>Installation</h1><p>Première mise en service du logiciel.</p></div></div>
    <div class="login-form"><form id="f"><h2>Installer le logiciel</h2><p class="muted">Saisissez la clé d’installation (SETUP_KEY) configurée sur le serveur.</p>
    <div class="field"><label>Clé d’installation</label><input name="cle" type="password" required autocomplete="off"></div>
    <button class="btn primary lg">Installer</button><div id="res"></div></form></div></div>`;
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await post('/api/installation', { cle: e.target.cle.value });
      $('#res').innerHTML = `<div class="banner info" style="display:block"><b>Installation réussie.</b><br>Identifiant : <b>${esc(r.identifiant)}</b><br>Mot de passe : <b class="mono" style="user-select:all">${esc(r.mot_de_passe)}</b><br><small>${esc(r.message)}</small></div><button type="button" class="btn" id="go">Aller à la connexion</button>`;
      $('#go').addEventListener('click', demarrer);
    } catch (err) { erreur(err); }
  });
}

function ecranConnexion(etat) {
  const demo = etat?.mode === 'demo';
  const acts = [['bed', 'Bungalows'], ['utensils', 'Restaurant'], ['burger', 'Fast-food'], ['bowl', 'Malgache'], ['buffet', 'Buffet'], ['party', 'Réception'], ['spa', 'Bien-être'], ['shop', 'Restoshop']];
  root.innerHTML = `<div class="login">
    <div class="login-art"><div><div class="brand" style="padding:0;border:0;height:auto"><div class="logo">${icon('home')}</div><div><b>${esc(etat?.nom || 'RESTO TAMATAVE')}</b><small style="color:#a7c4c9">Gestion multiactivités</small></div></div></div>
      <div><h1>Tout l’établissement<br>dans un seul logiciel.</h1><p style="opacity:.8;max-width:460px">Hébergement, restauration, réception, bien-être et boutique : stocks, caisses et bénéfices séparés, une seule fiche client.</p></div>
      <div class="login-acts">${acts.map(([i, l]) => `<div>${icon(i)}${l}</div>`).join('')}</div></div>
    <div class="login-form"><form id="f" autocomplete="on"><h2>Connexion</h2>
      ${demo ? `<div class="banner warn" style="display:block"><b>Version de démonstration</b> — données fictives.<br>Comptes : <span class="mono">demo-gerant, demo-caissier, demo-serveur, demo-cuisinier, demo-receptionniste, demo-resp_be, demo-magasinier, demo-comptable, demo-admin</span><br>Mot de passe : <b class="mono">Demo-2026</b>${etat.demo ? `<br>Fin de la démo : ${dateHeureFr(etat.demo.fin)}` : ''}</div>` : ''}
      <div class="field"><label>Identifiant</label><input name="identifiant" required autocomplete="username" autocapitalize="none"></div>
      <div class="field"><label>Mot de passe</label><input name="mot_de_passe" type="password" required autocomplete="current-password"></div>
      <button class="btn primary lg">${icon('lock')} Se connecter</button>
      <p class="muted" style="font-size:13px">Mot de passe oublié ? Demandez à votre administrateur de le réinitialiser.</p></form></div></div>`;
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = e.target.querySelector('button'); b.disabled = true;
    try {
      const r = await post('/api/auth/connexion', { identifiant: e.target.identifiant.value, mot_de_passe: e.target.mot_de_passe.value });
      jeton.ecrire(r.jeton);
      if (r.nouvel_appareil) toast('Connexion depuis un nouvel appareil : elle a été enregistrée dans le journal.', '', 7000);
      await demarrer();
    } catch (err) { erreur(err); b.disabled = false; }
  });
}

function ecranMotDePasse(oblige) {
  root.innerHTML = `<div class="blocked"><form class="card" id="f" style="width:min(440px,100%);display:grid;gap:12px;text-align:left">
    <h2 style="margin:0">${oblige ? 'Choisissez votre mot de passe' : 'Changer de mot de passe'}</h2>
    <p class="muted" style="margin:0">Au moins 10 caractères, avec des lettres et des chiffres. Ne le communiquez à personne.</p>
    <div class="field"><label>Mot de passe actuel (ou temporaire)</label><input name="a" type="password" required autocomplete="current-password"></div>
    <div class="field"><label>Nouveau mot de passe</label><input name="n" type="password" required minlength="10" autocomplete="new-password"></div>
    <div class="field"><label>Confirmer</label><input name="c" type="password" required autocomplete="new-password"></div>
    <button class="btn primary">Enregistrer</button></form></div>`;
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.n.value !== f.c.value) return toast('Les deux mots de passe ne correspondent pas.', 'err');
    try { await post('/api/auth/mot-de-passe', { ancien: f.a.value, nouveau: f.n.value }); toast('Mot de passe enregistré.', 'ok'); demarrer(); } catch (err) { erreur(err); }
  });
}

// ── Coquille principale ──
const visible = (it) => (!it.perm || peut(it.perm, it.action || 'C')) && (!it.act || S.moi.activites === '*' || S.moi.role === 'super_adm' || S.moi.activites.split(',').includes(it.act));
const menuVisible = () => MENU.map((m) => (m.items ? { ...m, items: m.items.filter(visible) } : m)).filter((m) => (m.items ? m.items.length : visible(m)) && (!m.act || m.items || visible(m)));

function afficherCoquille() {
  const u = S.moi;
  const initiales = u.nom.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
  root.innerHTML = `<div class="app" id="app">
    <aside class="sidebar" aria-label="Menu principal">
      <div class="brand"><div class="logo">${S.params.logo ? `<img src="${esc(S.params.logo)}" alt="">` : icon('home')}</div><div><b>${esc(S.params.nom_etablissement || 'RESTO TAMATAVE')}</b><small>Gestion multiactivités</small></div></div>
      <nav class="nav-viewport" id="nav"><div class="nav-panel main-panel" id="nav-main"></div><div class="nav-panel sub-panel" id="nav-sub"></div></nav>
      <div class="side-foot"><div class="side-user"><div class="avatar">${esc(initiales)}</div><div style="min-width:0;flex:1"><b>${esc(u.nom)}</b><small>${esc(u.role_nom)}</small></div>
        <button class="icon-btn" id="logout" title="Se déconnecter" style="background:transparent;border-color:rgba(255,255,255,.12);color:#cbd5e1">${icon('logout')}</button></div></div>
    </aside>
    <header class="topbar"><button class="icon-btn burger" id="burger" aria-label="Ouvrir le menu">${icon('menu')}</button>
      <div class="crumb" id="crumb"></div>
      <div class="top-search"><span>${icon('search')}</span><input id="gsearch" placeholder="Rechercher un menu, un client… (Ctrl+K)" autocomplete="off"><div class="search-results" id="gres" hidden></div></div>
      <button class="icon-btn" id="theme" title="Thème clair / sombre / automatique">${icon('sun')}</button>
      <button class="icon-btn" id="pwd" title="Changer mon mot de passe">${icon('key')}</button>
    </header>
    <main class="main" id="main" tabindex="-1"></main>
    <footer class="footer"><span><span class="dot" id="net-dot"></span><span id="net">En ligne</span></span><span id="file" class="hide-m"></span>
      ${S.moi.mode === 'demo' ? `<span class="tag warn">DÉMO${S.moi.demo ? ' · fin ' + dateHeureFr(S.moi.demo.fin) : ''}</span>` : ''}
      <span class="sep"></span><span class="hide-m">${esc(S.params.nom_etablissement || '')}</span><span id="horloge" class="mono"></span><span class="hide-m">v1.0</span></footer>
  </div><div id="print-area"></div>`;
  construireMenu();
  $('#logout').addEventListener('click', async () => { try { await post('/api/auth/deconnexion'); } catch { /* */ } jeton.ecrire(''); S.moi = null; location.hash = ''; demarrer(); });
  $('#burger').addEventListener('click', () => $('#app').classList.toggle('menu-open'));
  $('#app').addEventListener('click', (e) => { if (e.target.id === 'app') $('#app').classList.remove('menu-open'); });
  $('#theme').addEventListener('click', () => { const t = THEMES[(THEMES.indexOf(localStorage.getItem('rt_theme') || 'auto') + 1) % 3]; localStorage.setItem('rt_theme', t); appliquerTheme(t); toast('Thème : ' + { auto: 'automatique', light: 'clair', dark: 'sombre' }[t]); });
  $('#pwd').addEventListener('click', () => changerMdpModal());
  rechercheGlobale();
  majReseau(); majFile();
  const horloge = () => { const h = $('#horloge'); if (h) h.textContent = new Date().toLocaleString('fr-FR', { timeZone: 'Indian/Antananarivo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };
  horloge(); setInterval(horloge, 30000);
  naviguer();
}

function construireMenu() {
  const m = menuVisible();
  $('#nav-main').innerHTML = `<div class="nav-title">Modules</div>${m.map((x) => `<button class="nav-item" data-mod="${x.id}" style="--c:${x.c}">
    <span class="ico" style="--c:${x.c}">${icon(x.icon)}</span><span>${esc(x.label)}</span>${x.items ? `<span class="chev">${icon('chevron')}</span>` : ''}</button>`).join('')}`;
  sur($('#nav'), 'click', '[data-mod]', (e, b) => {
    const mod = menuVisible().find((x) => x.id === b.dataset.mod);
    if (!mod.items) { ouvrirSous(null); location.hash = '#/' + mod.route; return; }
    ouvrirSous(mod.id);
    const courant = routeCourante().brut;
    if (!mod.items.some((i) => i.route === courant)) location.hash = '#/' + mod.items[0].route;
  });
  sur($('#nav'), 'click', '[data-back]', () => ouvrirSous(null, true));
  sur($('#nav'), 'click', '[data-route]', () => $('#app').classList.remove('menu-open'));
}
function ouvrirSous(id, manuel = false) {
  moduleOuvert = id; sessionStorage.setItem('rt_module', id || '');
  const nav = $('#nav');
  if (!id) { nav.classList.remove('sub'); if (manuel) setTimeout(() => $('#nav-main .nav-item.active')?.focus(), 300); return; }
  const mod = menuVisible().find((x) => x.id === id);
  $('#nav-sub').innerHTML = `<button class="nav-back" data-back>${icon('back')} Menu principal</button>
    <div class="nav-head"><span class="ico" style="--c:${mod.c}">${icon(mod.icon)}</span><b>${esc(mod.label)}</b></div>
    ${mod.items.map((i) => `<a class="nav-item" href="#/${i.route}" data-route="${i.route}"><span class="sub-ico" style="--c:${i.c || mod.c}">${icon(i.icon)}</span><span>${esc(i.label)}</span></a>`).join('')}`;
  nav.classList.add('sub');
  marquerActif();
}
function routeCourante() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, '')) || 'accueil';
  const [chemin, q = ''] = h.split('?');
  const [nom, ...params] = chemin.split('/');
  return { brut: h, nom, params, query: Object.fromEntries(new URLSearchParams(q)) };
}
function marquerActif() {
  const r = routeCourante();
  const mod = trouverModule(r);
  const nom = ALIAS[r.nom] || r.nom;
  const item = mod?.items?.find((i) => i.route === r.brut) || mod?.items?.find((i) => i.route.split(/[/?]/)[0] === nom);
  $$('#nav .nav-item').forEach((el) => el.classList.toggle('active', el.dataset.route ? el.dataset.route === item?.route : mod?.id === el.dataset.mod));
}
const ALIAS = { folio: 'folios' };
function trouverModule(r) {
  const m = menuVisible();
  if (ALIAS[r.nom]) r = { ...r, nom: ALIAS[r.nom], brut: ALIAS[r.nom] };
  return m.find((x) => x.items?.some((i) => i.route === r.brut)) || m.find((x) => x.route === r.nom) || m.find((x) => x.items?.some((i) => i.route.split(/[/?]/)[0] === r.nom));
}

async function naviguer() {
  if (!S.moi || !$('#main')) return;
  const r = routeCourante();
  const def = PAGES[r.nom];
  const mod = trouverModule(r);
  if (mod?.items && moduleOuvert !== mod.id) ouvrirSous(mod.id);
  if (!mod?.items && moduleOuvert && mod) ouvrirSous(null);
  marquerActif();
  const item = mod?.items?.find((i) => i.route === r.brut) || mod?.items?.find((i) => i.route.split(/[/?]/)[0] === (ALIAS[r.nom] || r.nom));
  $('#crumb').innerHTML = mod ? `${mod.items ? `<span>${esc(mod.label)}</span>${icon('chevron')}` : ''}<b>${esc(item?.label || mod.label)}</b>` : '<b>Tableau de bord</b>';
  $('#crumb svg')?.setAttribute('style', 'width:14px;height:14px');
  if (typeof nettoyage === 'function') { try { nettoyage(); } catch { /* */ } nettoyage = null; }
  const main = $('#main');
  if (!def) { main.innerHTML = '<div class="empty">Page introuvable.</div>'; return; }
  main.innerHTML = '<div class="empty">Chargement…</div>';
  try {
    const mod = await import(`./pages/${def[0]}.js`);
    const page = document.createElement('div'); page.className = 'page';
    main.innerHTML = ''; main.append(page); main.scrollTop = 0;
    nettoyage = await mod[def[1]](page, r);
  } catch (e) {
    main.innerHTML = `<div class="banner danger">${icon('alert')} ${esc(e.message || 'Erreur de chargement.')}</div>`;
    $('#main .banner svg')?.setAttribute('style', 'width:18px;height:18px');
  }
}
window.addEventListener('hashchange', naviguer);

function changerMdpModal() {
  modal({ titre: 'Changer mon mot de passe', corps: `<div class="form"><div class="field full"><label>Mot de passe actuel</label><input type="password" id="pa" autocomplete="current-password"></div>
    <div class="field"><label>Nouveau (10 caractères min.)</label><input type="password" id="pn" autocomplete="new-password"></div><div class="field"><label>Confirmer</label><input type="password" id="pc" autocomplete="new-password"></div></div>`,
  actions: [{ label: 'Annuler' }, { label: 'Enregistrer', cls: 'primary', act: async (m) => {
    if ($('#pn', m).value !== $('#pc', m).value) throw new Error('Les deux mots de passe ne correspondent pas.');
    await post('/api/auth/mot-de-passe', { ancien: $('#pa', m).value, nouveau: $('#pn', m).value }); toast('Mot de passe modifié. Vos autres appareils ont été déconnectés.', 'ok');
  } }] });
}

// ── Recherche globale (menus + clients + réservations) ──
function rechercheGlobale() {
  const input = $('#gsearch'); const res = $('#gres');
  let t;
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.focus(); } });
  input.addEventListener('input', () => {
    clearTimeout(t);
    const q = input.value.trim().toLowerCase();
    if (!q) { res.hidden = true; return; }
    t = setTimeout(async () => {
      const items = [];
      for (const m of menuVisible()) for (const i of m.items || [m]) if ((i.label + ' ' + m.label).toLowerCase().includes(q)) items.push({ href: '#/' + i.route, ico: i.icon, l: i.label, s: m.label });
      if (q.length >= 2 && peut('clients')) { try { for (const c of (await get('/api/clients?limite=6&q=' + encodeURIComponent(q)))) items.push({ href: '#/clients?id=' + c.id, ico: 'user', l: c.nom, s: c.telephone || 'Client' }); } catch { /* */ } }
      if (q.length >= 2 && peut('hebergement')) { try { for (const r of (await get('/api/reservations?q=' + encodeURIComponent(q))).slice(0, 5)) items.push({ href: '#/folio/' + r.folio_id, ico: 'bed', l: `${r.numero || ''} · ${r.client}`, s: r.bungalow }); } catch { /* */ } }
      res.innerHTML = items.length ? items.slice(0, 14).map((x) => `<a href="${x.href}">${icon(x.ico)}<span>${esc(x.l)}<br><small class="muted">${esc(x.s)}</small></span></a>`).join('') : '<div class="empty" style="padding:14px">Aucun résultat</div>';
      $$('svg', res).forEach((s) => s.setAttribute('style', 'width:18px;height:18px;flex:none;color:var(--muted)'));
      res.hidden = false;
    }, 220);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const a = $('a', res); if (a) { location.hash = a.getAttribute('href'); res.hidden = true; input.value = ''; } } if (e.key === 'Escape') { res.hidden = true; input.blur(); } });
  res.addEventListener('click', () => { res.hidden = true; input.value = ''; });
  document.addEventListener('click', (e) => { if (!e.target.closest('.top-search')) res.hidden = true; });
}

// ── Réseau et file d'attente hors ligne ──
function majReseau() {
  S.enLigne = navigator.onLine;
  const d = $('#net-dot'), n = $('#net');
  if (!d) return;
  d.classList.toggle('off', !S.enLigne); n.textContent = S.enLigne ? 'En ligne' : 'Hors ligne — les ventes seront envoyées au retour du réseau';
}
function majFile() {
  const f = fileAttente(); const el = $('#file');
  if (el) el.innerHTML = f.length ? `<span class="tag warn">${f.length} opération(s) en attente de synchronisation</span>` : '';
}
window.addEventListener('online', () => { majReseau(); synchroniser(); });
window.addEventListener('offline', majReseau);
window.addEventListener('rt:file', majFile);
setInterval(() => { if (navigator.onLine && fileAttente().length) synchroniser(); }, 20000);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
demarrer();
