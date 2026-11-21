// Installation, connexion, utilisateurs, rôles, paramètres, audit, sauvegardes, démo.
import { route, config } from '../router.js';
import { all, first, run, st, valider, uid, nowIso, fail, audit, batch, lireParametres, json, jourLocal } from '../lib/core.js';
import {
  connexion, cookieSession, hacherMdp, verifierMdp, politiqueMdp, genererMdp, exiger, sha256,
  installerReferentiel, creerSuperAdmin, MODULES,
} from '../lib/auth.js';

// ── État public (page de connexion) ──
route('GET', '/api/etat', async (ctx) => {
  const p = await lireParametres(ctx.db).catch(() => ({}));
  const installe = !!(await first(ctx.db, 'SELECT 1 FROM utilisateurs LIMIT 1').catch(() => null));
  return { installe, nom: p.nom_etablissement || 'RESTO TAMATAVE', mode: ctx.env.MODE || 'production', demo: ctx.demo, version: ctx.env.VERSION || '1.0.0' };
}, { public: true, toujours: true });

// ── Installation initiale : crée le référentiel et le compte super-adm (mot de passe affiché une seule fois) ──
route('POST', '/api/installation', async (ctx) => {
  const cleInstall = ctx.env.SETUP_KEY || (await first(ctx.db, "SELECT valeur FROM config_systeme WHERE cle = 'setup_key'").catch(() => null))?.valeur;
  if (!cleInstall) fail(403, 'Installation désactivée : aucune clé d’installation n’est configurée.', 'INSTALL');
  if (String(ctx.body.cle || '') !== cleInstall) fail(403, 'Clé d’installation incorrecte.', 'INSTALL');
  await installerReferentiel(ctx.db);
  const mdp = await creerSuperAdmin(ctx.db);
  if (!mdp) fail(409, 'Le logiciel est déjà installé.', 'DEJA_INSTALLE');
  await run(ctx.db, 'INSERT INTO audit(quand, identifiant, action, entite, ip) VALUES (?,?,?,?,?)', nowIso(), 'systeme', 'installation', 'systeme', ctx.ip);
  return { identifiant: 'super-adm', mot_de_passe: mdp, message: 'Notez ce mot de passe : il ne sera plus jamais affiché. Il devra être changé à la première connexion.' };
}, { public: true });

// ── Connexion / session ──
route('POST', '/api/auth/connexion', async (ctx) => {
  const r = await connexion(ctx, ctx.body.identifiant, ctx.body.mot_de_passe);
  return json({ ok: true, jeton: r.jeton, expire_dans: r.maxAge, doit_changer_mdp: !!r.utilisateur.doit_changer_mdp, nouvel_appareil: r.nouvelAppareil }, 200,
    { 'set-cookie': cookieSession(r.jeton, r.maxAge, ctx.url.protocol === 'https:') });
}, { public: true });

route('POST', '/api/auth/deconnexion', async (ctx) => {
  await batch(ctx, [st(ctx.db, 'UPDATE sessions SET revoque = 1 WHERE id = ?', ctx.user.sid), audit(ctx, 'deconnexion', 'utilisateur', ctx.user.id)]);
  return json({ ok: true }, 200, { 'set-cookie': cookieSession('x', 0, ctx.url.protocol === 'https:') });
}, { mdp: true });

route('GET', '/api/auth/moi', async (ctx) => {
  const u = ctx.user;
  const acts = await all(ctx.db, 'SELECT * FROM activites WHERE actif = 1 ORDER BY ordre');
  const p = await lireParametres(ctx.db);
  return {
    id: u.id, identifiant: u.identifiant, nom: u.nom, role: u.role_code, role_nom: u.role_nom,
    doit_changer_mdp: !!u.doit_changer_mdp, activites: u.activites, perms: u.role_code === 'super_adm' ? Object.fromEntries(MODULES.map((m) => [m, 'CSVE'])) : u.perms,
    liste_activites: acts, parametres: p, demo: ctx.demo, mode: ctx.env.MODE || 'production',
  };
}, { mdp: true });

route('POST', '/api/auth/mot-de-passe', async (ctx) => {
  const { ancien, nouveau } = ctx.body;
  const u = await first(ctx.db, 'SELECT mdp_hash FROM utilisateurs WHERE id = ?', ctx.user.id);
  if (!(await verifierMdp(String(ancien || ''), u.mdp_hash))) fail(400, 'L’ancien mot de passe est incorrect.', 'MDP');
  politiqueMdp(nouveau);
  if (nouveau === ancien) fail(400, 'Le nouveau mot de passe doit être différent de l’ancien.', 'MDP');
  if (nouveau.toLowerCase().includes(ctx.user.identifiant.toLowerCase())) fail(400, 'Le mot de passe ne doit pas contenir votre identifiant.', 'MDP');
  await batch(ctx, [
    st(ctx.db, 'UPDATE utilisateurs SET mdp_hash = ?, doit_changer_mdp = 0 WHERE id = ?', await hacherMdp(nouveau), ctx.user.id),
    st(ctx.db, 'UPDATE sessions SET revoque = 1 WHERE utilisateur_id = ? AND id <> ?', ctx.user.id, ctx.user.sid),
    audit(ctx, 'changement_mot_de_passe', 'utilisateur', ctx.user.id),
  ]);
  return { ok: true };
}, { mdp: true });

route('GET', '/api/auth/sessions', async (ctx) => all(ctx.db,
  `SELECT substr(id,1,10) ref, cree_le, vu_le, expire_le, ip, appareil, nouvel_appareil, (id = ?) actuelle FROM sessions
    WHERE utilisateur_id = ? AND revoque = 0 AND expire_le > ? ORDER BY vu_le DESC`, ctx.user.sid, ctx.user.id, nowIso()));

route('POST', '/api/auth/sessions/revoquer', async (ctx) => {
  const ref = String(ctx.body.ref || '');
  if (ref === 'toutes') await run(ctx.db, 'UPDATE sessions SET revoque = 1 WHERE utilisateur_id = ? AND id <> ?', ctx.user.id, ctx.user.sid);
  else await run(ctx.db, 'UPDATE sessions SET revoque = 1 WHERE utilisateur_id = ? AND substr(id,1,10) = ?', ctx.user.id, ref);
  await run(ctx.db, 'INSERT INTO audit(quand, utilisateur_id, identifiant, action, entite, ip) VALUES (?,?,?,?,?,?)', nowIso(), ctx.user.id, ctx.user.identifiant, 'deconnexion_a_distance', 'session', ctx.ip);
  return { ok: true };
});

// ── Utilisateurs ──
const estSuper = (u) => u.role_code === 'super_adm';
route('GET', '/api/utilisateurs', async (ctx) => {
  exiger(ctx, 'utilisateurs', 'C');
  return all(ctx.db, `SELECT u.id, u.identifiant, u.nom, u.email, u.telephone, u.role_id, r.nom role_nom, r.code role_code, u.statut, u.activites,
    u.derniere_connexion, u.doit_changer_mdp, u.version, (u.bloque_jusqua > ?) bloque FROM utilisateurs u JOIN roles r ON r.id = u.role_id ORDER BY u.nom`, nowIso());
});
const champsUser = {
  identifiant: { t: 'str', req: true, min: 3, max: 40, label: 'Identifiant' }, nom: { t: 'str', req: true, max: 100, label: 'Nom complet' },
  email: { t: 'email', label: 'Email' }, telephone: { t: 'str', max: 30, label: 'Téléphone' },
  role_id: { t: 'id', req: true, label: 'Rôle' }, activites: { t: 'str', def: '*', max: 200, label: 'Activités' },
};
async function verifierRole(ctx, roleId) {
  const r = await first(ctx.db, 'SELECT code FROM roles WHERE id = ?', roleId);
  if (!r) fail(400, 'Rôle inconnu.', 'VALIDATION');
  if (r.code === 'super_adm' && !estSuper(ctx.user)) fail(403, 'Seul le super administrateur peut attribuer ce rôle.', 'INTERDIT');
}
route('POST', '/api/utilisateurs', async (ctx) => {
  exiger(ctx, 'utilisateurs', 'S');
  const d = valider(ctx.body, champsUser);
  if (!/^[a-z0-9._-]+$/i.test(d.identifiant)) fail(400, 'L’identifiant ne doit contenir que des lettres, chiffres, points ou tirets.', 'VALIDATION');
  await verifierRole(ctx, d.role_id);
  if (await first(ctx.db, 'SELECT 1 FROM utilisateurs WHERE lower(identifiant) = lower(?)', d.identifiant)) fail(409, 'Cet identifiant existe déjà.', 'DOUBLON');
  const id = uid(); const mdp = genererMdp(12);
  await batch(ctx, [
    st(ctx.db, 'INSERT INTO utilisateurs(id, identifiant, nom, email, telephone, role_id, activites, mdp_hash, doit_changer_mdp, cree_le) VALUES (?,?,?,?,?,?,?,?,1,?)',
      id, d.identifiant, d.nom, d.email, d.telephone, d.role_id, d.activites, await hacherMdp(mdp), nowIso()),
    audit(ctx, 'creation_compte', 'utilisateur', id, null, d),
  ]);
  return { id, identifiant: d.identifiant, mot_de_passe_temporaire: mdp };
});
route('PUT', '/api/utilisateurs/:id', async (ctx) => {
  exiger(ctx, 'utilisateurs', 'S');
  const avant = await first(ctx.db, 'SELECT u.*, r.code role_code FROM utilisateurs u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', ctx.params.id);
  if (!avant) fail(404, 'Utilisateur introuvable.', 'INTROUVABLE');
  if (estSuper(avant) && !estSuper(ctx.user)) fail(403, 'Le compte super administrateur ne peut être modifié que par lui-même.', 'INTERDIT');
  const d = valider(ctx.body, { ...champsUser, identifiant: { t: 'str' }, statut: { t: 'enum', vals: ['actif', 'suspendu', 'desactive'] } }, true);
  delete d.identifiant;
  if (d.role_id) await verifierRole(ctx, d.role_id);
  if (avant.id === ctx.user.id && (d.statut && d.statut !== 'actif')) fail(400, 'Vous ne pouvez pas suspendre votre propre compte.', 'VALIDATION');
  if (estSuper(avant) && d.role_id && d.role_id !== avant.role_id) fail(400, 'Le rôle du super administrateur ne peut pas être changé.', 'VALIDATION');
  const c = Object.keys(d);
  const s = [st(ctx.db, `UPDATE utilisateurs SET ${c.map((k) => k + ' = ?').join(', ')}, version = version + 1 WHERE id = ?`, ...c.map((k) => d[k]), avant.id),
    audit(ctx, 'modification_compte', 'utilisateur', avant.id, Object.fromEntries(c.map((k) => [k, avant[k]])), d)];
  if (d.statut && d.statut !== 'actif') s.push(st(ctx.db, 'UPDATE sessions SET revoque = 1 WHERE utilisateur_id = ?', avant.id));
  await batch(ctx, s);
  return { ok: true };
});
route('POST', '/api/utilisateurs/:id/reinitialiser', async (ctx) => {
  exiger(ctx, 'utilisateurs', 'V');
  const u = await first(ctx.db, 'SELECT u.id, r.code role_code FROM utilisateurs u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', ctx.params.id);
  if (!u) fail(404, 'Utilisateur introuvable.', 'INTROUVABLE');
  if (estSuper(u) && !estSuper(ctx.user)) fail(403, 'Interdit.', 'INTERDIT');
  const mdp = genererMdp(12);
  await batch(ctx, [
    st(ctx.db, 'UPDATE utilisateurs SET mdp_hash = ?, doit_changer_mdp = 1, echecs = 0, bloque_jusqua = NULL WHERE id = ?', await hacherMdp(mdp), u.id),
    st(ctx.db, 'UPDATE sessions SET revoque = 1 WHERE utilisateur_id = ?', u.id),
    audit(ctx, 'reinitialisation_mot_de_passe', 'utilisateur', u.id),
  ]);
  return { mot_de_passe_temporaire: mdp };
});

// ── Rôles et permissions ──
route('GET', '/api/roles', async (ctx) => {
  exiger(ctx, 'utilisateurs', 'C');
  const roles = await all(ctx.db, 'SELECT * FROM roles ORDER BY systeme DESC, nom');
  const perms = await all(ctx.db, 'SELECT * FROM role_permissions');
  return { modules: MODULES, roles: roles.map((r) => ({ ...r, perms: Object.fromEntries(perms.filter((p) => p.role_id === r.id).map((p) => [p.module, p.actions])) })) };
});
route('POST', '/api/roles', async (ctx) => {
  exiger(ctx, 'utilisateurs', 'V');
  const d = valider(ctx.body, { nom: { t: 'str', req: true, max: 60, label: 'Nom du rôle' }, modele: { t: 'id' } });
  const id = 'ROLE-' + uid().slice(0, 8);
  const src = d.modele ? await all(ctx.db, 'SELECT module, actions FROM role_permissions WHERE role_id = ?', d.modele) : [];
  await batch(ctx, [
    st(ctx.db, 'INSERT INTO roles(id, code, nom, systeme) VALUES (?,?,?,0)', id, id.toLowerCase(), d.nom),
    ...MODULES.map((m) => st(ctx.db, 'INSERT INTO role_permissions(role_id, module, actions) VALUES (?,?,?)', id, m, src.find((x) => x.module === m)?.actions || '')),
    audit(ctx, 'creation_role', 'role', id, null, d),
  ]);
  return { id };
});
route('PUT', '/api/roles/:id', async (ctx) => {
  exiger(ctx, 'utilisateurs', 'V');
  const r = await first(ctx.db, 'SELECT * FROM roles WHERE id = ?', ctx.params.id);
  if (!r) fail(404, 'Rôle introuvable.', 'INTROUVABLE');
  if (r.code === 'super_adm') fail(400, 'Les droits du super administrateur ne sont pas modifiables.', 'VALIDATION');
  const perms = ctx.body.perms || {};
  const avant = await all(ctx.db, 'SELECT module, actions FROM role_permissions WHERE role_id = ?', r.id);
  const s = [];
  for (const m of MODULES) {
    if (!(m in perms)) continue;
    const a = String(perms[m]).toUpperCase().split('').filter((c) => 'CSVE'.includes(c)).filter((c, i, arr) => arr.indexOf(c) === i).join('');
    s.push(st(ctx.db, 'INSERT INTO role_permissions(role_id, module, actions) VALUES (?,?,?) ON CONFLICT(role_id, module) DO UPDATE SET actions = excluded.actions', r.id, m, a));
  }
  s.push(audit(ctx, 'modification_permissions', 'role', r.id, Object.fromEntries(avant.map((p) => [p.module, p.actions])), perms));
  await batch(ctx, s);
  return { ok: true };
});

// ── Paramètres de l'entreprise ──
const PARAMS_AUTORISES = ['nom_etablissement', 'adresse', 'telephone', 'email', 'nif', 'stat', 'devise', 'pied_ticket', 'repartition_charges', 'couleur_principale', 'logo'];
route('GET', '/api/parametres', async (ctx) => lireParametres(ctx.db));
route('PUT', '/api/parametres', async (ctx) => {
  exiger(ctx, 'parametres', 'S');
  const s = [];
  for (const k of PARAMS_AUTORISES) if (k in ctx.body) {
    const v = String(ctx.body[k] ?? '');
    if (k === 'logo' && v && (!v.startsWith('data:image/') || v.length > 300000)) fail(400, 'Logo invalide ou trop lourd (max 200 Ko après compression).', 'VALIDATION');
    if (k !== 'logo' && v.length > 300) fail(400, `Valeur trop longue pour ${k}.`, 'VALIDATION');
    s.push(st(ctx.db, 'INSERT INTO parametres(cle, valeur) VALUES (?,?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur', k, v));
  }
  s.push(audit(ctx, 'modification_parametres', 'parametres', null, null, Object.fromEntries(Object.entries(ctx.body).filter(([k]) => k !== 'logo'))));
  await batch(ctx, s);
  return lireParametres(ctx.db);
});

// ── Journal d'audit ──
route('GET', '/api/audit', async (ctx) => {
  exiger(ctx, 'audit', 'C');
  const w = ['1=1']; const p = [];
  if (ctx.query.utilisateur) { w.push('identifiant = ?'); p.push(ctx.query.utilisateur); }
  if (ctx.query.du) { w.push('quand >= ?'); p.push(ctx.query.du); }
  if (ctx.query.au) { w.push('quand < ?'); p.push(ctx.query.au + 'T23:59:59Z'); }
  if (ctx.query.q) { w.push('(action LIKE ? OR entite LIKE ?)'); p.push(`%${ctx.query.q}%`, `%${ctx.query.q}%`); }
  return all(ctx.db, `SELECT * FROM audit WHERE ${w.join(' AND ')} ORDER BY id DESC LIMIT 500`, ...p);
});

// ── Sauvegardes ──
export const TABLES_SAUVEGARDE = ['parametres', 'sequences', 'activites', 'roles', 'role_permissions', 'utilisateurs', 'clients', 'fournisseurs',
  'bungalows', 'jours_feries', 'folios', 'folio_lignes', 'reservations', 'reservation_nuits', 'salles', 'evenements', 'evenement_creneaux',
  'categories', 'articles', 'produits', 'recettes', 'depots', 'stocks', 'mouvements_stock', 'caisses', 'sessions_caisse', 'tables_resto',
  'commandes', 'commande_lignes', 'documents', 'ventes_lignes', 'paiements', 'depenses', 'rendez_vous'];

export async function exporterBase(db) {
  const donnees = {};
  let lignes = 0;
  for (const t of TABLES_SAUVEGARDE) { donnees[t] = await all(db, `SELECT * FROM ${t}`); lignes += donnees[t].length; }
  const corps = JSON.stringify({ format: 'resto-tamatave', version: 1, quand: nowIso(), donnees });
  return { corps, lignes, sha: await sha256(corps) };
}
export async function sauvegarder(env, type, ctx = null) {
  const id = uid();
  const { corps, lignes, sha } = await exporterBase(env.DB);
  const cle = `sauvegardes/${jourLocal()}/${type}-${id.slice(0, 8)}.json`;
  let statut = 'ok';
  if (env.BACKUPS) await env.BACKUPS.put(cle, corps, { customMetadata: { sha256: sha, lignes: String(lignes) } });
  else statut = 'sans_stockage';
  await env.DB.batch([
    st(env.DB, 'INSERT INTO sauvegardes(id, quand, type, cle_r2, taille, sha256, lignes, statut, utilisateur_id) VALUES (?,?,?,?,?,?,?,?,?)',
      id, nowIso(), type, env.BACKUPS ? cle : null, corps.length, sha, lignes, statut, ctx?.user?.id),
    st(env.DB, 'INSERT INTO audit(quand, utilisateur_id, identifiant, action, entite, entite_id) VALUES (?,?,?,?,?,?)', nowIso(), ctx?.user?.id, ctx?.user?.identifiant || 'systeme', 'sauvegarde_' + type, 'sauvegarde', id),
  ]);
  return { id, cle, lignes, taille: corps.length, sha256: sha, statut, corps };
}
// Conservation : 30 sauvegardes quotidiennes + la première de chaque mois pendant 1 an.
export async function nettoyerSauvegardes(env) {
  if (!env.BACKUPS) return;
  const rows = await all(env.DB, "SELECT id, quand, cle_r2 FROM sauvegardes WHERE type = 'auto' AND cle_r2 IS NOT NULL ORDER BY quand DESC");
  const garder = new Set(rows.slice(0, 30).map((r) => r.id));
  const mois = new Set();
  for (const r of [...rows].reverse()) { const m = r.quand.slice(0, 7); if (!mois.has(m)) { mois.add(m); if (Date.now() - new Date(r.quand) < 366 * 86400000) garder.add(r.id); } }
  for (const r of rows) if (!garder.has(r.id)) {
    await env.BACKUPS.delete(r.cle_r2);
    await run(env.DB, "UPDATE sauvegardes SET statut = 'expiree', cle_r2 = NULL WHERE id = ?", r.id);
  }
}

route('GET', '/api/sauvegardes', async (ctx) => {
  exiger(ctx, 'sauvegardes', 'C');
  return all(ctx.db, 'SELECT * FROM sauvegardes ORDER BY quand DESC LIMIT 200');
});
route('POST', '/api/sauvegardes', async (ctx) => {
  exiger(ctx, 'sauvegardes', 'S');
  const r = await sauvegarder(ctx.env, 'manuelle', ctx);
  delete r.corps;
  return r;
});
route('GET', '/api/sauvegardes/telecharger', async (ctx) => {
  exiger(ctx, 'sauvegardes', 'E');
  const { corps } = ctx.query.id ? await (async () => {
    const s = await first(ctx.db, 'SELECT cle_r2 FROM sauvegardes WHERE id = ?', ctx.query.id);
    if (!s?.cle_r2 || !ctx.env.BACKUPS) fail(404, 'Fichier de sauvegarde indisponible.', 'INTROUVABLE');
    const o = await ctx.env.BACKUPS.get(s.cle_r2);
    if (!o) fail(404, 'Fichier de sauvegarde introuvable dans le stockage.', 'INTROUVABLE');
    return { corps: await o.text() };
  })() : await exporterBase(ctx.db);
  await run(ctx.db, 'INSERT INTO audit(quand, utilisateur_id, identifiant, action, entite, ip) VALUES (?,?,?,?,?,?)', nowIso(), ctx.user.id, ctx.user.identifiant, 'telechargement_sauvegarde', 'sauvegarde', ctx.ip);
  return new Response(corps, { headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="sauvegarde-${jourLocal()}.json"`, 'cache-control': 'no-store' } });
});
route('POST', '/api/sauvegardes/verifier', async (ctx) => {
  exiger(ctx, 'sauvegardes', 'C');
  const s = await first(ctx.db, 'SELECT * FROM sauvegardes WHERE id = ?', ctx.body.id);
  if (!s?.cle_r2 || !ctx.env.BACKUPS) fail(404, 'Sauvegarde non disponible dans le stockage.', 'INTROUVABLE');
  const o = await ctx.env.BACKUPS.get(s.cle_r2);
  if (!o) return { integre: false, message: 'Fichier absent du stockage.' };
  const sha = await sha256(await o.text());
  return { integre: sha === s.sha256, message: sha === s.sha256 ? 'Sauvegarde intacte.' : 'ATTENTION : le fichier ne correspond plus à l’empreinte enregistrée.' };
});

// Restauration complète : sauvegarde automatique préalable + double confirmation.
route('POST', '/api/sauvegardes/restaurer', async (ctx) => {
  exiger(ctx, 'sauvegardes', 'V');
  if (ctx.body.confirmation !== 'RESTAURER') fail(400, 'Tapez RESTAURER pour confirmer.', 'CONFIRMATION');
  let corps;
  if (ctx.body.id) {
    const s = await first(ctx.db, 'SELECT * FROM sauvegardes WHERE id = ?', ctx.body.id);
    if (!s?.cle_r2 || !ctx.env.BACKUPS) fail(404, 'Sauvegarde non disponible.', 'INTROUVABLE');
    corps = await (await ctx.env.BACKUPS.get(s.cle_r2)).text();
    if ((await sha256(corps)) !== s.sha256) fail(400, 'Sauvegarde corrompue : restauration annulée.', 'CORROMPUE');
  } else corps = JSON.stringify(ctx.body.fichier || {});
  let data;
  try { data = JSON.parse(corps); } catch { fail(400, 'Fichier illisible.', 'FICHIER'); }
  if (data.format !== 'resto-tamatave' || !data.donnees) fail(400, 'Ce fichier n’est pas une sauvegarde de ce logiciel.', 'FICHIER');
  const avant = await sauvegarder(ctx.env, 'avant_restauration', ctx);
  const s = [st(ctx.db, 'PRAGMA defer_foreign_keys = true'), st(ctx.db, 'DELETE FROM sessions')];
  for (const t of [...TABLES_SAUVEGARDE].reverse()) s.push(st(ctx.db, `DELETE FROM ${t}`));
  for (const t of TABLES_SAUVEGARDE) for (const row of data.donnees[t] || []) {
    const c = Object.keys(row);
    if (c.some((k) => !/^[a-z_0-9]+$/.test(k))) fail(400, 'Fichier invalide.', 'FICHIER');
    s.push(st(ctx.db, `INSERT INTO ${t}(${c.join(',')}) VALUES (${c.map(() => '?').join(',')})`, ...c.map((k) => row[k])));
  }
  s.push(audit(ctx, 'restauration', 'sauvegarde', ctx.body.id || 'fichier', null, { sauvegarde_prealable: avant.id }));
  await ctx.db.batch(s);
  return { ok: true, sauvegarde_prealable: avant.id, message: 'Restauration terminée. Tout le monde doit se reconnecter.' };
});

// ── Démonstration ──
route('POST', '/api/demo/reinitialiser', async (ctx) => {
  if (ctx.env.MODE !== 'demo') fail(403, 'Disponible uniquement dans l’environnement de démonstration.', 'INTERDIT');
  exiger(ctx, 'parametres', 'V');
  const { chargerDemo } = await import('../demo.js');
  await chargerDemo(ctx.db, true);
  return { ok: true };
});

// ── Tâche planifiée (pg_cron → sauvegarde quotidienne), protégée par une clé ──
route('POST', '/api/taches/sauvegarde', async (ctx) => {
  const cle = ctx.env.CRON_SECRET || (await config(ctx)).cron_key;
  if (!cle || ctx.req.headers.get('x-cron-key') !== cle) fail(403, 'Interdit.', 'INTERDIT');
  const r = await sauvegarder(ctx.env, 'auto');
  await nettoyerSauvegardes(ctx.env);
  delete r.corps;
  return r;
}, { public: true });
