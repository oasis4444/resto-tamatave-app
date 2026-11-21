// Authentification : mots de passe PBKDF2-SHA256 (WebCrypto natif), sessions par cookie, verrouillage.
import { all, first, run, st, nowIso, uid, fail, audit } from './core.js';

const ITER = 100000; // maximum accepté par Cloudflare Workers
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (buf) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function hacherMdp(mdp, sel = crypto.getRandomValues(new Uint8Array(16)), iter = ITER) {
  const key = await crypto.subtle.importKey('raw', enc.encode(mdp), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sel, iterations: iter }, key, 256);
  return `pbkdf2$${iter}$${b64(sel)}$${b64(bits)}`;
}
export async function verifierMdp(mdp, stocke) {
  const [algo, iter, sel, hash] = String(stocke).split('$');
  if (algo !== 'pbkdf2') return false;
  const calc = (await hacherMdp(mdp, unb64(sel), Number(iter))).split('$')[3];
  if (calc.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < calc.length; i++) diff |= calc.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}
export async function sha256(txt) { return b64url(await crypto.subtle.digest('SHA-256', enc.encode(txt))); }

export function politiqueMdp(mdp) {
  if (typeof mdp !== 'string' || mdp.length < 10) fail(400, 'Le mot de passe doit contenir au moins 10 caractères.', 'MDP_FAIBLE');
  if (!/[a-zA-Z]/.test(mdp) || !/\d/.test(mdp)) fail(400, 'Le mot de passe doit contenir des lettres et des chiffres.', 'MDP_FAIBLE');
  if (mdp.length > 200) fail(400, 'Mot de passe trop long.', 'MDP_FAIBLE');
}
export function genererMdp(n = 14) {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#%*-+';
  const r = crypto.getRandomValues(new Uint32Array(n));
  let s = Array.from(r, (x) => alpha[x % alpha.length]).join('');
  if (!/\d/.test(s)) s = s.slice(0, -1) + '7';
  if (!/[a-z]/i.test(s)) s = 'k' + s.slice(1);
  return s;
}

const DUREE_SESSION_H = 12;
const MAX_ECHECS = 5;
const BLOCAGE_MIN = 15;

export async function connexion(ctx, identifiant, mdp) {
  const { db, ip } = ctx;
  const depuis = new Date(Date.now() - 15 * 60000).toISOString();
  const nbIp = await first(db, 'SELECT COUNT(*) n FROM tentatives_connexion WHERE ip = ? AND succes = 0 AND quand > ?', ip, depuis);
  if (nbIp.n >= 30) fail(429, 'Trop de tentatives depuis cet appareil. Réessayez dans 15 minutes.', 'TROP_DE_TENTATIVES');

  const u = await first(db, 'SELECT * FROM utilisateurs WHERE lower(identifiant) = lower(?)', String(identifiant || '').trim());
  const echec = async (msg = 'Identifiant ou mot de passe incorrect.') => {
    await run(db, 'INSERT INTO tentatives_connexion(quand, ip, identifiant, succes) VALUES (?,?,?,0)', nowIso(), ip, String(identifiant || '').slice(0, 64));
    fail(401, msg, 'CONNEXION_REFUSEE');
  };
  if (!u) {
    await hacherMdp(String(mdp || 'x'), new Uint8Array(16), 1000); // limite les différences de temps
    return echec();
  }
  if (u.bloque_jusqua && u.bloque_jusqua > nowIso()) fail(423, `Compte bloqué temporairement après plusieurs erreurs. Réessayez après ${new Date(u.bloque_jusqua).toLocaleTimeString('fr-FR', { timeZone: 'Indian/Antananarivo', hour: '2-digit', minute: '2-digit' })}.`, 'COMPTE_BLOQUE');
  const ok = await verifierMdp(String(mdp || ''), u.mdp_hash);
  if (!ok) {
    const n = u.echecs + 1;
    const bloque = n >= MAX_ECHECS ? new Date(Date.now() + BLOCAGE_MIN * 60000).toISOString() : null;
    await db.batch([
      st(db, 'UPDATE utilisateurs SET echecs = ?, bloque_jusqua = ? WHERE id = ?', bloque ? 0 : n, bloque, u.id),
      audit({ ...ctx, user: { id: u.id, identifiant: u.identifiant } }, bloque ? 'compte_bloque' : 'connexion_echouee', 'utilisateur', u.id),
    ]);
    return echec(bloque ? `Trop d'erreurs : compte bloqué ${BLOCAGE_MIN} minutes.` : undefined);
  }
  if (u.statut !== 'actif') fail(403, u.statut === 'suspendu' ? 'Ce compte est suspendu. Contactez l’administrateur.' : 'Ce compte est désactivé.', 'COMPTE_INACTIF');

  const jeton = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const sid = await sha256(jeton);
  const appareil = (ctx.req.headers.get('user-agent') || '').slice(0, 200);
  const connu = await first(db, 'SELECT 1 FROM sessions WHERE utilisateur_id = ? AND (ip = ? OR appareil = ?) LIMIT 1', u.id, ip, appareil);
  const premiere = !(await first(db, 'SELECT 1 FROM sessions WHERE utilisateur_id = ? LIMIT 1', u.id));
  const nouveau = !connu && !premiere ? 1 : 0;
  const exp = new Date(Date.now() + DUREE_SESSION_H * 3600000).toISOString();
  await db.batch([
    st(db, 'INSERT INTO sessions(id, utilisateur_id, cree_le, expire_le, vu_le, ip, appareil, nouvel_appareil) VALUES (?,?,?,?,?,?,?,?)', sid, u.id, nowIso(), exp, nowIso(), ip, appareil, nouveau),
    st(db, 'UPDATE utilisateurs SET echecs = 0, bloque_jusqua = NULL, derniere_connexion = ? WHERE id = ?', nowIso(), u.id),
    st(db, 'INSERT INTO tentatives_connexion(quand, ip, identifiant, succes) VALUES (?,?,?,1)', nowIso(), ip, u.identifiant),
    audit({ ...ctx, user: { id: u.id, identifiant: u.identifiant } }, nouveau ? 'connexion_nouvel_appareil' : 'connexion', 'utilisateur', u.id, null, { ip, appareil }),
  ]);
  return { jeton, utilisateur: u, nouvelAppareil: !!nouveau, maxAge: DUREE_SESSION_H * 3600 };
}

export function cookieSession(jeton, maxAge, secure) {
  return `rt_session=${jeton}; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

export async function chargerSession(ctx) {
  // Jeton envoyé dans l'en-tête Authorization (interface et API sur des domaines différents)
  const auth = ctx.req.headers.get('authorization') || '';
  const m = auth.match(/^Bearer ([A-Za-z0-9_-]{20,})$/) || (ctx.req.headers.get('cookie') || '').match(/(?:^|;\s*)rt_session=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  const sid = await sha256(m[1]);
  const s = await first(ctx.db,
    `SELECT s.id sid, s.expire_le, s.vu_le, u.*, r.code role_code, r.nom role_nom
       FROM sessions s JOIN utilisateurs u ON u.id = s.utilisateur_id JOIN roles r ON r.id = u.role_id
      WHERE s.id = ? AND s.revoque = 0`, sid);
  if (!s || s.expire_le < nowIso() || s.statut !== 'actif') return null;
  // Renouvellement glissant (au plus une écriture toutes les 10 minutes)
  if (!s.vu_le || Date.now() - new Date(s.vu_le).getTime() > 600000) {
    const exp = new Date(Date.now() + DUREE_SESSION_H * 3600000).toISOString();
    await run(ctx.db, 'UPDATE sessions SET vu_le = ?, expire_le = ? WHERE id = ?', nowIso(), exp, sid);
  }
  const perms = await all(ctx.db, 'SELECT module, actions FROM role_permissions WHERE role_id = ?', s.role_id);
  s.perms = Object.fromEntries(perms.map((p) => [p.module, p.actions]));
  delete s.mdp_hash;
  return s;
}

/** Vérifie une permission côté serveur. Actions : C consulter, S saisir, V valider/annuler, E exporter/imprimer. */
export function peut(user, module, action) {
  if (!user) return false;
  if (user.role_code === 'super_adm') return true;
  return (user.perms?.[module] || '').includes(action);
}
export function exiger(ctx, module, action) {
  if (!peut(ctx.user, module, action)) fail(403, 'Vous n’avez pas l’autorisation pour cette opération.', 'INTERDIT');
}
export function activitesUser(user) {
  if (!user || user.activites === '*' || user.role_code === 'super_adm') return null; // null = toutes
  return String(user.activites).split(',').filter(Boolean);
}
export function exigerActivite(ctx, activiteId) {
  const a = activitesUser(ctx.user);
  if (a && !a.includes(activiteId)) fail(403, 'Vous n’avez pas accès à cette activité.', 'INTERDIT');
}

// ── Données de référence installées au premier démarrage ──
export const MODULES = ['tableau', 'hebergement', 'reception', 'ventes', 'cuisine', 'bienetre', 'catalogue', 'stocks', 'caisses', 'depenses', 'clients', 'rapports', 'utilisateurs', 'parametres', 'sauvegardes', 'audit'];
export const ROLES_DEFAUT = {
  super_adm: ['Super administrateur', {}],
  admin: ['Administrateur', Object.fromEntries(MODULES.map((m) => [m, m === 'sauvegardes' ? 'C' : 'CSVE']))],
  gerant: ['Gérant', { tableau: 'C', hebergement: 'CSVE', reception: 'CSVE', ventes: 'CSVE', cuisine: 'CS', bienetre: 'CSVE', catalogue: 'CSVE', stocks: 'CVE', caisses: 'CSVE', depenses: 'CSVE', clients: 'CSVE', rapports: 'CE', audit: 'C' }],
  receptionniste: ['Réceptionniste', { tableau: 'C', hebergement: 'CSE', reception: 'CSE', ventes: 'CSE', bienetre: 'CS', clients: 'CS', caisses: 'CS', catalogue: 'C' }],
  caissier: ['Caissier', { tableau: 'C', ventes: 'CSE', caisses: 'CS', clients: 'CS', catalogue: 'C', hebergement: 'C', bienetre: 'CS' }],
  serveur: ['Serveur', { ventes: 'CS', cuisine: 'C', catalogue: 'C', clients: 'C', hebergement: 'C' }],
  cuisinier: ['Cuisinier', { cuisine: 'CS', stocks: 'CS', catalogue: 'C' }],
  magasinier: ['Magasinier', { tableau: 'C', stocks: 'CSE', catalogue: 'C' }],
  resp_be: ['Responsable bien-être', { tableau: 'C', bienetre: 'CSE', clients: 'CS', stocks: 'CS', catalogue: 'C', ventes: 'CS', caisses: 'CS' }],
  comptable: ['Comptable', { tableau: 'C', rapports: 'CE', depenses: 'CSE', caisses: 'CE', hebergement: 'CE', ventes: 'CE', stocks: 'CE', clients: 'CE', reception: 'CE', bienetre: 'CE', catalogue: 'C' }],
};
export const ACTIVITES_DEFAUT = [
  ['BUNG', 'Bungalows', 'home', '#0e7490'], ['REST', 'Restaurant / self', 'utensils', '#c2410c'],
  ['FAST', 'Fast-food', 'burger', '#dc2626'], ['MALG', 'Cuisine malgache', 'bowl', '#65a30d'],
  ['BUFF', 'Buffet chinois', 'buffet', '#b45309'], ['RECEP', 'Salle de réception', 'party', '#7c3aed'],
  ['BE', 'Bien-être', 'spa', '#db2777'], ['SHOP', 'Restoshop', 'shop', '#2563eb'],
];

export async function installerReferentiel(db) {
  if (await first(db, 'SELECT 1 FROM roles LIMIT 1')) return false;
  const s = [];
  ACTIVITES_DEFAUT.forEach(([id, nom, icone, couleur], i) => {
    s.push(st(db, 'INSERT INTO activites(id, nom, icone, couleur, ordre) VALUES (?,?,?,?,?)', id, nom, icone, couleur, i));
    s.push(st(db, 'INSERT INTO depots(id, activite_id, nom) VALUES (?,?,?)', 'DEP-' + id, id, 'Stock ' + nom));
    if (id !== 'BUNG') s.push(st(db, 'INSERT INTO caisses(id, activite_id, nom) VALUES (?,?,?)', 'CAI-' + id, id, 'Caisse ' + nom));
  });
  s.push(st(db, 'INSERT INTO caisses(id, activite_id, nom) VALUES (?,?,?)', 'CAI-BUNG', 'BUNG', 'Caisse réception'));
  s.push(st(db, 'INSERT INTO depots(id, activite_id, nom) VALUES (?,?,?)', 'DEP-CENTRAL', null, 'Magasin central'));
  for (const [code, [nom, perms]] of Object.entries(ROLES_DEFAUT)) {
    const rid = 'ROLE-' + code;
    s.push(st(db, 'INSERT INTO roles(id, code, nom, systeme) VALUES (?,?,?,1)', rid, code, nom));
    for (const m of MODULES) s.push(st(db, 'INSERT INTO role_permissions(role_id, module, actions) VALUES (?,?,?)', rid, m, code === 'super_adm' ? 'CSVE' : perms[m] || ''));
  }
  const params = {
    nom_etablissement: 'Mon établissement', adresse: 'Toamasina, Madagascar', telephone: '', email: '', nif: '', stat: '',
    devise: 'Ar', fuseau: 'Indian/Antananarivo', langue: 'fr', pied_ticket: 'Misaotra tompoko ! Merci de votre visite.',
    repartition_charges: 'ca', couleur_principale: '#0f766e',
  };
  for (const [k, v] of Object.entries(params)) s.push(st(db, 'INSERT INTO parametres(cle, valeur) VALUES (?,?)', k, v));
  await db.batch(s);
  return true;
}

export async function creerSuperAdmin(db) {
  if (await first(db, "SELECT 1 FROM utilisateurs u JOIN roles r ON r.id=u.role_id WHERE r.code='super_adm'")) return null;
  const mdp = genererMdp(16);
  await run(db, 'INSERT INTO utilisateurs(id, identifiant, nom, role_id, mdp_hash, doit_changer_mdp, cree_le) VALUES (?,?,?,?,?,1,?)',
    uid(), 'super-adm', 'Super administrateur', 'ROLE-super_adm', await hacherMdp(mdp), nowIso());
  return mdp;
}
