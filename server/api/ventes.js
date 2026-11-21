// Catalogue, caisse (POS), commandes, cuisine, tickets, sessions de caisse.
import { route } from '../router.js';
import { crud } from '../lib/crud.js';
import { all, first, st, valider, uid, nowIso, jourLocal, fail, audit, batch, numeroter, lireParametres, verrou } from '../lib/core.js';
import { exiger, exigerActivite, activitesUser, peut } from '../lib/auth.js';
import { preparerLignes, construireVente, construireAnnulation, sessionOuverte } from '../lib/vente.js';

const ACT = { t: 'enum', req: true, vals: ['BUNG', 'REST', 'FAST', 'MALG', 'BUFF', 'RECEP', 'BE', 'SHOP'], label: 'Activité' };

// ── Catalogue ──
crud({ chemin: 'categories', table: 'categories', module: 'catalogue', filtres: ['activite_id'], ordre: 't.activite_id, t.ordre, t.nom',
  champs: { activite_id: ACT, nom: { t: 'str', req: true, max: 60, label: 'Nom' }, ordre: { t: 'int', def: 0 } } });

crud({ chemin: 'produits', table: 'produits', module: 'catalogue', filtres: ['activite_id', 'categorie_id', 'type'], recherche: ['nom', 'code_barre'],
  ordre: 't.activite_id, t.nom',
  select: 't.*, (SELECT nom FROM categories c WHERE c.id = t.categorie_id) categorie_nom, (SELECT COUNT(*) FROM recettes r WHERE r.produit_id = t.id) nb_ingredients',
  champs: {
    activite_id: ACT, categorie_id: { t: 'id', label: 'Catégorie' }, nom: { t: 'str', req: true, max: 80, label: 'Nom' },
    prix: { t: 'int', req: true, min: 0, max: 100000000, label: 'Prix' },
    type: { t: 'enum', vals: ['plat', 'boisson', 'menu', 'article', 'prestation', 'formule'], def: 'plat', label: 'Type' },
    code_barre: { t: 'str', max: 40, label: 'Code-barres' }, duree_min: { t: 'int', min: 0, max: 600, label: 'Durée (min)' },
    article_id: { t: 'id', label: 'Article de stock lié' }, envoi_cuisine: { t: 'bool', def: 1 },
  },
  avantEcriture: async (ctx, d) => {
    if (d.code_barre) {
      const dbl = await first(ctx.db, 'SELECT id FROM produits WHERE code_barre = ? AND archive = 0 AND id <> ?', d.code_barre, ctx.params.id || '');
      if (dbl) fail(409, 'Ce code-barres est déjà utilisé par un autre produit.', 'DOUBLON');
    }
  },
});

route('GET', '/api/produits/:id/recette', async (ctx) => {
  exiger(ctx, 'catalogue', 'C');
  return all(ctx.db, 'SELECT r.article_id, r.quantite, a.nom, a.unite FROM recettes r JOIN articles a ON a.id = r.article_id WHERE r.produit_id = ? ORDER BY a.nom', ctx.params.id);
});
route('PUT', '/api/produits/:id/recette', async (ctx) => {
  exiger(ctx, 'catalogue', 'S');
  const p = await first(ctx.db, 'SELECT id FROM produits WHERE id = ?', ctx.params.id);
  if (!p) fail(404, 'Produit introuvable.', 'INTROUVABLE');
  const lignes = (ctx.body.lignes || []).map((l) => valider(l, { article_id: { t: 'id', req: true, label: 'Ingrédient' }, quantite: { t: 'num', req: true, min: 0.0001, label: 'Quantité' } }));
  if (new Set(lignes.map((l) => l.article_id)).size !== lignes.length) fail(400, 'Un ingrédient apparaît deux fois.', 'DOUBLON');
  const avant = await all(ctx.db, 'SELECT article_id, quantite FROM recettes WHERE produit_id = ?', p.id);
  await batch(ctx, [
    st(ctx.db, 'DELETE FROM recettes WHERE produit_id = ?', p.id),
    ...lignes.map((l) => st(ctx.db, 'INSERT INTO recettes(produit_id, article_id, quantite) VALUES (?,?,?)', p.id, l.article_id, l.quantite)),
    audit(ctx, 'modification_recette', 'produit', p.id, avant, lignes),
  ]);
  return { ok: true };
});

crud({ chemin: 'tables', table: 'tables_resto', module: 'catalogue', filtres: ['activite_id'], ordre: 't.activite_id, t.nom',
  champs: { activite_id: ACT, nom: { t: 'str', req: true, max: 30, label: 'Nom' }, places: { t: 'int', def: 4, min: 1, max: 200 } } });

// ── Données de la caisse tactile ──
route('GET', '/api/pos/:activite', async (ctx) => {
  exiger(ctx, 'ventes', 'C');
  const a = ctx.params.activite;
  exigerActivite(ctx, a);
  const [categories, produits, tables, caisses] = await Promise.all([
    all(ctx.db, 'SELECT id, nom FROM categories WHERE activite_id = ? AND archive = 0 ORDER BY ordre, nom', a),
    all(ctx.db, 'SELECT id, nom, prix, categorie_id, type, code_barre, envoi_cuisine FROM produits WHERE activite_id = ? AND archive = 0 ORDER BY nom', a),
    all(ctx.db, `SELECT t.id, t.nom, t.places, (SELECT c.id FROM commandes c WHERE c.table_id = t.id AND c.statut = 'ouverte' LIMIT 1) commande_id
      FROM tables_resto t WHERE t.activite_id = ? AND t.archive = 0 ORDER BY t.nom`, a),
    all(ctx.db, `SELECT c.id, c.nom, s.id session_id, s.ouvert_le FROM caisses c LEFT JOIN sessions_caisse s ON s.caisse_id = c.id AND s.statut = 'ouverte' WHERE c.activite_id = ?`, a),
  ]);
  const folios = await all(ctx.db, `SELECT f.id, f.numero, f.libelle, cl.nom client FROM folios f LEFT JOIN clients cl ON cl.id = f.client_id WHERE f.statut = 'ouvert' ORDER BY f.libelle`);
  return { categories, produits, tables, caisses, folios };
});

// ── Vente directe (comptoir / à emporter / boutique) ──
route('POST', '/api/ventes', async (ctx) => {
  exiger(ctx, 'ventes', 'S');
  const a = ctx.body.activite_id;
  exigerActivite(ctx, a);
  const prep = await preparerLignes(ctx, a, ctx.body.lignes);
  const folioId = ctx.body.folio_id || null;
  const sess = folioId ? null : await sessionOuverte(ctx, ctx.body.caisse_id || 'CAI-' + a);
  if (ctx.body.remise && !peut(ctx.user, 'ventes', 'V') && Number(ctx.body.remise) > prep.total * 0.1) fail(403, 'Une remise de plus de 10 % doit être faite par un responsable.', 'INTERDIT');
  const v = await construireVente(ctx, { activiteId: a, prep, paiements: ctx.body.paiements, sessionCaisse: sess, folioId, clientId: ctx.body.client_id || null, remise: ctx.body.remise, source: 'caisse' });
  await batch(ctx, v.stmts);
  return { document_id: v.docId, total: v.total, rendu: v.rendu };
});

// ── Commandes (tables, cuisine) ──
route('GET', '/api/commandes', async (ctx) => {
  exiger(ctx, 'ventes', 'C');
  const acts = activitesUser(ctx.user);
  const w = ["c.statut = 'ouverte'"]; const p = [];
  if (ctx.query.activite) { w.push('c.activite_id = ?'); p.push(ctx.query.activite); }
  const rows = await all(ctx.db, `SELECT c.*, t.nom table_nom, u.nom serveur_nom, f.libelle folio_libelle,
      (SELECT COALESCE(SUM(l.quantite * l.prix_unitaire),0) FROM commande_lignes l WHERE l.commande_id = c.id AND l.statut_cuisine <> 'annule') total
    FROM commandes c LEFT JOIN tables_resto t ON t.id = c.table_id LEFT JOIN utilisateurs u ON u.id = c.serveur_id LEFT JOIN folios f ON f.id = c.folio_id
    WHERE ${w.join(' AND ')} ORDER BY c.cree_le`, ...p);
  return acts ? rows.filter((r) => acts.includes(r.activite_id)) : rows;
});
route('GET', '/api/commandes/:id', async (ctx) => {
  exiger(ctx, 'ventes', 'C');
  const c = await first(ctx.db, 'SELECT c.*, t.nom table_nom FROM commandes c LEFT JOIN tables_resto t ON t.id = c.table_id WHERE c.id = ?', ctx.params.id);
  if (!c) fail(404, 'Commande introuvable.', 'INTROUVABLE');
  c.lignes = await all(ctx.db, 'SELECT * FROM commande_lignes WHERE commande_id = ? ORDER BY cree_le', c.id);
  return c;
});
route('POST', '/api/commandes', async (ctx) => {
  exiger(ctx, 'ventes', 'S');
  const d = valider(ctx.body, { activite_id: ACT, type: { t: 'enum', vals: ['sur_place', 'emporter', 'bungalow', 'comptoir'], def: 'sur_place' },
    table_id: { t: 'id' }, folio_id: { t: 'id' }, client_id: { t: 'id' }, couverts: { t: 'int', min: 0, max: 500 } });
  exigerActivite(ctx, d.activite_id);
  if (d.table_id && await first(ctx.db, "SELECT 1 FROM commandes WHERE table_id = ? AND statut = 'ouverte'", d.table_id)) fail(409, 'Cette table a déjà une commande en cours.', 'TABLE_OCCUPEE');
  const id = uid();
  await batch(ctx, [
    st(ctx.db, 'INSERT INTO commandes(id, activite_id, type, table_id, folio_id, client_id, couverts, serveur_id, cree_le) VALUES (?,?,?,?,?,?,?,?,?)',
      id, d.activite_id, d.type, d.table_id, d.folio_id, d.client_id, d.couverts, ctx.user.id, nowIso()),
    ...numeroter(ctx.db, 'CMD', 'commandes', id),
    audit(ctx, 'ouverture_commande', 'commande', id, null, d),
  ]);
  return { id };
});
route('POST', '/api/commandes/:id/lignes', async (ctx) => {
  exiger(ctx, 'ventes', 'S');
  const c = await first(ctx.db, 'SELECT * FROM commandes WHERE id = ?', ctx.params.id);
  if (!c || c.statut !== 'ouverte') fail(409, 'Cette commande n’est plus modifiable.', 'COMMANDE_CLOSE');
  const prep = await preparerLignes(ctx, c.activite_id, ctx.body.lignes);
  const q = nowIso();
  await batch(ctx, [
    ...prep.lignes.map((l) => st(ctx.db, 'INSERT INTO commande_lignes(id, commande_id, produit_id, libelle, quantite, prix_unitaire, note, statut_cuisine, cree_le) VALUES (?,?,?,?,?,?,?,?,?)',
      uid(), c.id, l.produit.id, l.produit.nom, l.quantite, l.pu, l.note, l.produit.envoi_cuisine ? 'en_attente' : 'sans', q)),
    st(ctx.db, 'UPDATE commandes SET version = version + 1 WHERE id = ?', c.id),
    audit(ctx, 'ajout_commande', 'commande', c.id, null, prep.lignes.map((l) => ({ produit: l.produit.nom, q: l.quantite }))),
  ]);
  return { ok: true };
});
route('POST', '/api/commandes/lignes/:id/annuler', async (ctx) => {
  const l = await first(ctx.db, 'SELECT l.*, c.statut cmd_statut FROM commande_lignes l JOIN commandes c ON c.id = l.commande_id WHERE l.id = ?', ctx.params.id);
  if (!l || l.cmd_statut !== 'ouverte') fail(409, 'Ligne non modifiable.', 'COMMANDE_CLOSE');
  // Une ligne déjà en préparation ne peut être annulée que par un responsable.
  exiger(ctx, 'ventes', ['en_attente', 'sans'].includes(l.statut_cuisine) ? 'S' : 'V');
  await batch(ctx, [
    st(ctx.db, "UPDATE commande_lignes SET statut_cuisine = 'annule', maj_le = ? WHERE id = ?", nowIso(), l.id),
    audit(ctx, 'annulation_ligne_commande', 'commande', l.commande_id, { libelle: l.libelle, statut: l.statut_cuisine }, { statut: 'annule' }),
  ]);
  return { ok: true };
});
route('POST', '/api/commandes/:id/encaisser', async (ctx) => {
  exiger(ctx, 'ventes', 'S');
  const c = await first(ctx.db, 'SELECT * FROM commandes WHERE id = ?', ctx.params.id);
  if (!c || c.statut !== 'ouverte') fail(409, 'Cette commande est déjà réglée ou annulée.', 'COMMANDE_CLOSE');
  exigerActivite(ctx, c.activite_id);
  const lignes = await all(ctx.db, "SELECT produit_id, quantite FROM commande_lignes WHERE commande_id = ? AND statut_cuisine <> 'annule'", c.id);
  const prep = await preparerLignes(ctx, c.activite_id, lignes);
  const folioId = ctx.body.au_folio ? (ctx.body.folio_id || c.folio_id) : null;
  if (ctx.body.au_folio && !folioId) fail(400, 'Choisissez le compte séjour à débiter.', 'VALIDATION');
  const sess = folioId ? null : await sessionOuverte(ctx, ctx.body.caisse_id || 'CAI-' + c.activite_id);
  const v = await construireVente(ctx, { activiteId: c.activite_id, prep, paiements: ctx.body.paiements, sessionCaisse: sess, folioId, clientId: c.client_id, commandeId: c.id, remise: ctx.body.remise, source: 'commande' });
  await batch(ctx, [
    verrou(ctx, 'encaisser-commande-' + c.id),
    st(ctx.db, "UPDATE commandes SET statut = ?, document_id = ?, version = version + 1 WHERE id = ? AND statut = 'ouverte'", folioId ? 'au_folio' : 'payee', v.docId, c.id),
    ...v.stmts,
  ]);
  return { document_id: v.docId, total: v.total, rendu: v.rendu };
});
route('POST', '/api/commandes/:id/annuler', async (ctx) => {
  exiger(ctx, 'ventes', 'V');
  const c = await first(ctx.db, 'SELECT * FROM commandes WHERE id = ?', ctx.params.id);
  if (!c || c.statut !== 'ouverte') fail(409, 'Commande non annulable.', 'COMMANDE_CLOSE');
  await batch(ctx, [
    st(ctx.db, "UPDATE commandes SET statut = 'annulee', version = version + 1 WHERE id = ?", c.id),
    st(ctx.db, "UPDATE commande_lignes SET statut_cuisine = 'annule' WHERE commande_id = ?", c.id),
    audit(ctx, 'annulation_commande', 'commande', c.id, null, { motif: ctx.body.motif }),
  ]);
  return { ok: true };
});

// ── Écran cuisine ──
route('GET', '/api/cuisine', async (ctx) => {
  exiger(ctx, 'cuisine', 'C');
  const w = ["l.statut_cuisine IN ('en_attente','en_preparation','pret')", "c.statut <> 'annulee'"]; const p = [];
  if (ctx.query.activite) { w.push('c.activite_id = ?'); p.push(ctx.query.activite); }
  return all(ctx.db, `SELECT l.id, l.libelle, l.quantite, l.note, l.statut_cuisine, l.cree_le, c.numero, c.type, c.activite_id, t.nom table_nom
    FROM commande_lignes l JOIN commandes c ON c.id = l.commande_id LEFT JOIN tables_resto t ON t.id = c.table_id
    WHERE ${w.join(' AND ')} ORDER BY l.cree_le LIMIT 300`, ...p);
});
route('PUT', '/api/cuisine/:id', async (ctx) => {
  const statut = ctx.body.statut;
  if (!['en_preparation', 'pret', 'servi'].includes(statut)) fail(400, 'Statut invalide.', 'VALIDATION');
  exiger(ctx, statut === 'servi' ? 'ventes' : 'cuisine', 'S');
  await run2(ctx, 'UPDATE commande_lignes SET statut_cuisine = ?, maj_le = ? WHERE id = ?', statut, nowIso(), ctx.params.id);
  return { ok: true };
});
const run2 = (ctx, sql, ...p) => st(ctx.db, sql, ...p).run();

// ── Tickets et documents ──
route('GET', '/api/documents', async (ctx) => {
  exiger(ctx, 'ventes', 'C');
  const w = ['d.jour BETWEEN ? AND ?']; const p = [ctx.query.du || jourLocal(), ctx.query.au || jourLocal()];
  if (ctx.query.activite) { w.push('d.activite_id = ?'); p.push(ctx.query.activite); }
  if (ctx.query.q) { w.push('d.numero LIKE ?'); p.push(`%${ctx.query.q}%`); }
  const acts = activitesUser(ctx.user);
  const rows = await all(ctx.db, `SELECT d.*, u.nom vendeur, cl.nom client_nom FROM documents d LEFT JOIN utilisateurs u ON u.id = d.cree_par LEFT JOIN clients cl ON cl.id = d.client_id
    WHERE ${w.join(' AND ')} ORDER BY d.cree_le DESC LIMIT 1000`, ...p);
  return acts ? rows.filter((r) => !r.activite_id || acts.includes(r.activite_id)) : rows;
});
route('GET', '/api/documents/:id', async (ctx) => {
  exiger(ctx, 'ventes', 'C');
  const d = await first(ctx.db, `SELECT d.*, u.nom vendeur, cl.nom client_nom, a.nom activite_nom, f.numero folio_numero, f.libelle folio_libelle
    FROM documents d LEFT JOIN utilisateurs u ON u.id = d.cree_par LEFT JOIN clients cl ON cl.id = d.client_id
    LEFT JOIN activites a ON a.id = d.activite_id LEFT JOIN folios f ON f.id = d.folio_id WHERE d.id = ?`, ctx.params.id);
  if (!d) fail(404, 'Document introuvable.', 'INTROUVABLE');
  d.lignes = await all(ctx.db, 'SELECT libelle, quantite, prix_unitaire, montant FROM ventes_lignes WHERE document_id = ? ORDER BY quand, (montant < 0), libelle', d.id);
  d.paiements = await all(ctx.db, 'SELECT mode, montant, reference FROM paiements WHERE document_id = ?', d.id);
  d.parametres = await lireParametres(ctx.db);
  return d;
});
route('POST', '/api/documents/:id/annuler', async (ctx) => {
  exiger(ctx, 'ventes', 'V');
  const motif = String(ctx.body.motif || '').trim();
  if (motif.length < 3) fail(400, 'Indiquez le motif de l’annulation.', 'VALIDATION');
  const d = await first(ctx.db, 'SELECT activite_id FROM documents WHERE id = ?', ctx.params.id);
  const a = await construireAnnulation(ctx, ctx.params.id, motif, ctx.body.caisse_id || 'CAI-' + d?.activite_id);
  await batch(ctx, a.stmts);
  return { avoir_id: a.avoirId };
});

// ── Caisses ──
route('GET', '/api/caisses', async (ctx) => {
  exiger(ctx, 'caisses', 'C');
  const acts = activitesUser(ctx.user);
  const rows = await all(ctx.db, `SELECT c.*, a.nom activite_nom, s.id session_id, s.ouvert_le, s.fonds, u.nom ouvert_par_nom,
      (SELECT COALESCE(SUM(montant),0) FROM paiements p WHERE p.session_caisse_id = s.id AND p.mode = 'especes') especes,
      (SELECT COALESCE(SUM(montant),0) FROM paiements p WHERE p.session_caisse_id = s.id) encaisse
    FROM caisses c JOIN activites a ON a.id = c.activite_id
    LEFT JOIN sessions_caisse s ON s.caisse_id = c.id AND s.statut = 'ouverte' LEFT JOIN utilisateurs u ON u.id = s.ouvert_par ORDER BY a.ordre`);
  return acts ? rows.filter((r) => acts.includes(r.activite_id)) : rows;
});
route('POST', '/api/caisses/:id/ouvrir', async (ctx) => {
  exiger(ctx, 'caisses', 'S');
  const c = await first(ctx.db, 'SELECT * FROM caisses WHERE id = ?', ctx.params.id);
  if (!c) fail(404, 'Caisse introuvable.', 'INTROUVABLE');
  exigerActivite(ctx, c.activite_id);
  const d = valider(ctx.body, { fonds: { t: 'int', min: 0, def: 0, label: 'Fonds de caisse' } });
  const id = uid();
  try {
    await batch(ctx, [
      st(ctx.db, 'INSERT INTO sessions_caisse(id, caisse_id, jour, ouvert_par, ouvert_le, fonds) VALUES (?,?,?,?,?,?)', id, c.id, jourLocal(), ctx.user.id, nowIso(), d.fonds),
      audit(ctx, 'ouverture_caisse', 'caisse', c.id, null, d),
    ]);
  } catch (e) { if (/UNIQUE/i.test(e.message) && !/idempotence/.test(e.message)) fail(409, 'Cette caisse est déjà ouverte.', 'DEJA_OUVERTE'); throw e; }
  return { session_id: id };
});
async function totauxSession(ctx, sid) {
  const s = await first(ctx.db, 'SELECT * FROM sessions_caisse WHERE id = ?', sid);
  if (!s) fail(404, 'Session de caisse introuvable.', 'INTROUVABLE');
  const modes = await all(ctx.db, 'SELECT mode, SUM(montant) total, COUNT(*) nb FROM paiements WHERE session_caisse_id = ? GROUP BY mode', sid);
  const dep = await first(ctx.db, "SELECT COALESCE(SUM(montant),0) t FROM depenses WHERE session_caisse_id = ? AND statut = 'validee'", sid);
  const esp = modes.find((m) => m.mode === 'especes')?.total || 0;
  return { session: s, modes, depenses_especes: dep.t, attendu: s.fonds + esp - dep.t };
}
route('GET', '/api/caisses/sessions/:id', async (ctx) => { exiger(ctx, 'caisses', 'C'); return totauxSession(ctx, ctx.params.id); });
route('GET', '/api/caisses/sessions', async (ctx) => {
  exiger(ctx, 'caisses', 'C');
  return all(ctx.db, `SELECT s.*, c.nom caisse_nom, uo.nom ouvert_par_nom, uf.nom ferme_par_nom FROM sessions_caisse s JOIN caisses c ON c.id = s.caisse_id
    LEFT JOIN utilisateurs uo ON uo.id = s.ouvert_par LEFT JOIN utilisateurs uf ON uf.id = s.ferme_par
    WHERE s.jour BETWEEN ? AND ? ORDER BY s.ouvert_le DESC LIMIT 300`, ctx.query.du || jourLocal(), ctx.query.au || jourLocal());
});
route('POST', '/api/caisses/sessions/:id/fermer', async (ctx) => {
  exiger(ctx, 'caisses', 'S');
  const t = await totauxSession(ctx, ctx.params.id);
  if (t.session.statut !== 'ouverte') fail(409, 'Cette caisse est déjà fermée.', 'DEJA_FERMEE');
  if (t.session.ouvert_par !== ctx.user.id && !peut(ctx.user, 'caisses', 'V')) fail(403, 'Seul le caissier qui a ouvert la caisse, ou un responsable, peut la fermer.', 'INTERDIT');
  const d = valider(ctx.body, { compte: { t: 'int', req: true, min: 0, label: 'Montant compté' }, commentaire: { t: 'str', max: 300 } });
  const ecart = d.compte - t.attendu;
  if (ecart !== 0 && !d.commentaire) fail(400, `Écart de ${ecart.toLocaleString('fr-FR')} Ar : expliquez l’écart dans le commentaire.`, 'ECART');
  await batch(ctx, [
    st(ctx.db, "UPDATE sessions_caisse SET statut = 'fermee', ferme_par = ?, ferme_le = ?, attendu = ?, compte = ?, ecart = ?, commentaire = ? WHERE id = ? AND statut = 'ouverte'",
      ctx.user.id, nowIso(), t.attendu, d.compte, ecart, d.commentaire, t.session.id),
    audit(ctx, 'cloture_caisse', 'caisse', t.session.caisse_id, null, { attendu: t.attendu, compte: d.compte, ecart }),
  ]);
  return { attendu: t.attendu, compte: d.compte, ecart };
});
route('POST', '/api/caisses/sessions/:id/valider', async (ctx) => {
  exiger(ctx, 'caisses', 'V');
  await batch(ctx, [
    st(ctx.db, "UPDATE sessions_caisse SET statut = 'validee', valide_par = ? WHERE id = ? AND statut = 'fermee'", ctx.user.id, ctx.params.id),
    audit(ctx, 'validation_cloture', 'session_caisse', ctx.params.id),
  ]);
  return { ok: true };
});
