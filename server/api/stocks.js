// Articles, fournisseurs, dépôts, mouvements de stock, transferts, pertes, inventaires, alertes.
import { route } from '../router.js';
import { crud } from '../lib/crud.js';
import { all, first, st, valider, uid, nowIso, jourLocal, addDays, fail, audit, batch } from '../lib/core.js';
import { exiger, activitesUser } from '../lib/auth.js';

crud({ chemin: 'articles', table: 'articles', module: 'stocks', recherche: ['nom', 'code_barre', 'famille'], ordre: 't.nom',
  champs: {
    nom: { t: 'str', req: true, max: 80, label: 'Nom' }, unite: { t: 'str', def: 'pièce', max: 20, label: 'Unité' }, famille: { t: 'str', max: 40 },
    code_barre: { t: 'str', max: 40 }, seuil_alerte: { t: 'num', def: 0, min: 0, label: 'Seuil d’alerte' }, cout_defaut: { t: 'int', def: 0, min: 0, label: 'Coût unitaire par défaut' },
  } });
crud({ chemin: 'fournisseurs', table: 'fournisseurs', module: 'stocks', recherche: ['nom', 'telephone'],
  champs: { nom: { t: 'str', req: true, max: 100 }, telephone: { t: 'str', max: 30 }, email: { t: 'email' }, adresse: { t: 'str', max: 200 }, nif: { t: 'str', max: 30 }, notes: { t: 'str', max: 500 } } });

route('GET', '/api/depots', async (ctx) => {
  exiger(ctx, 'stocks', 'C');
  const rows = await all(ctx.db, 'SELECT d.*, a.nom activite_nom FROM depots d LEFT JOIN activites a ON a.id = d.activite_id ORDER BY a.ordre IS NULL, a.ordre');
  const acts = activitesUser(ctx.user);
  return acts ? rows.filter((d) => !d.activite_id || acts.includes(d.activite_id)) : rows;
});

route('GET', '/api/stocks', async (ctx) => {
  exiger(ctx, 'stocks', 'C');
  const w = ['a.archive = 0']; const p = [];
  if (ctx.query.depot) { w.push('s.depot_id = ?'); p.push(ctx.query.depot); }
  if (ctx.query.q) { w.push('a.nom LIKE ?'); p.push(`%${ctx.query.q}%`); }
  if (ctx.query.alerte === '1') w.push('s.quantite <= a.seuil_alerte');
  return all(ctx.db, `SELECT s.depot_id, d.nom depot, s.article_id, a.nom, a.unite, a.famille, a.seuil_alerte, s.quantite, s.cmup,
      ROUND(MAX(s.quantite,0) * COALESCE(NULLIF(s.cmup,0), a.cout_defaut)) valeur
    FROM stocks s JOIN articles a ON a.id = s.article_id JOIN depots d ON d.id = s.depot_id WHERE ${w.join(' AND ')} ORDER BY d.nom, a.nom LIMIT 2000`, ...p);
});

route('GET', '/api/mouvements', async (ctx) => {
  exiger(ctx, 'stocks', 'C');
  const w = ['m.jour BETWEEN ? AND ?']; const p = [ctx.query.du || addDays(jourLocal(), -7), ctx.query.au || jourLocal()];
  if (ctx.query.depot) { w.push('m.depot_id = ?'); p.push(ctx.query.depot); }
  if (ctx.query.article) { w.push('m.article_id = ?'); p.push(ctx.query.article); }
  if (ctx.query.type) { w.push('m.type = ?'); p.push(ctx.query.type); }
  return all(ctx.db, `SELECT m.*, a.nom article, a.unite, d.nom depot, u.nom par, f.nom fournisseur FROM mouvements_stock m JOIN articles a ON a.id = m.article_id JOIN depots d ON d.id = m.depot_id
    LEFT JOIN utilisateurs u ON u.id = m.utilisateur_id LEFT JOIN fournisseurs f ON f.id = m.fournisseur_id WHERE ${w.join(' AND ')} ORDER BY m.quand DESC LIMIT 1500`, ...p);
});

const ligneSpec = { article_id: { t: 'id', req: true, label: 'Article' }, quantite: { t: 'num', req: true, min: 0.0001, max: 1e7, label: 'Quantité' },
  cout_unitaire: { t: 'num', min: 0, def: 0, label: 'Prix d’achat unitaire' }, lot: { t: 'str', max: 40 }, peremption: { t: 'date' } };
const lireLignes = (body) => {
  const l = (Array.isArray(body.lignes) ? body.lignes : []).map((x) => valider(x, ligneSpec));
  if (!l.length) fail(400, 'Ajoutez au moins un article.', 'VALIDATION');
  if (l.length > 90) fail(400, 'Trop de lignes (max 90).', 'VALIDATION');
  return l;
};
async function verifDepot(ctx, id) {
  const d = await first(ctx.db, 'SELECT * FROM depots WHERE id = ?', id);
  if (!d) fail(400, 'Dépôt introuvable.', 'VALIDATION');
  const acts = activitesUser(ctx.user);
  if (acts && d.activite_id && !acts.includes(d.activite_id)) fail(403, 'Vous n’avez pas accès à ce dépôt.', 'INTERDIT');
  return d;
}
const mvt = (ctx, depot, l, type, qte, cout, extra = {}) => st(ctx.db,
  'INSERT INTO mouvements_stock(id, quand, jour, depot_id, article_id, type, quantite, cout_unitaire, ref_type, ref_id, motif, lot, peremption, fournisseur_id, utilisateur_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  uid(), nowIso(), jourLocal(), depot, l.article_id, type, qte, cout, extra.ref_type, extra.ref_id, extra.motif, l.lot, l.peremption, extra.fournisseur_id, ctx.user.id);
const assurer = (ctx, depot, art) => st(ctx.db, 'INSERT OR IGNORE INTO stocks(depot_id, article_id, quantite, cmup) VALUES (?,?,0,0)', depot, art);

// Entrée (réception fournisseur / achat) : met à jour le coût moyen pondéré.
route('POST', '/api/stocks/entree', async (ctx) => {
  exiger(ctx, 'stocks', 'S');
  const d = await verifDepot(ctx, ctx.body.depot_id);
  const lignes = lireLignes(ctx.body);
  const ref = uid();
  const s = [];
  for (const l of lignes) s.push(
    assurer(ctx, d.id, l.article_id),
    st(ctx.db, `UPDATE stocks SET cmup = CASE WHEN MAX(quantite,0) + ? > 0 THEN (MAX(quantite,0) * cmup + ? * ?) / (MAX(quantite,0) + ?) ELSE ? END,
      quantite = quantite + ? WHERE depot_id = ? AND article_id = ?`, l.quantite, l.quantite, l.cout_unitaire, l.quantite, l.cout_unitaire, l.quantite, d.id, l.article_id),
    mvt(ctx, d.id, l, 'entree', l.quantite, l.cout_unitaire, { ref_type: 'reception', ref_id: ref, motif: ctx.body.motif, fournisseur_id: ctx.body.fournisseur_id || null }),
  );
  s.push(audit(ctx, 'entree_stock', 'depot', d.id, null, { lignes, fournisseur: ctx.body.fournisseur_id }));
  await batch(ctx, s);
  return { ok: true, reference: ref };
});

// Transfert tracé entre deux dépôts (valorisé au coût moyen du dépôt d'origine).
route('POST', '/api/stocks/transfert', async (ctx) => {
  exiger(ctx, 'stocks', 'S');
  const src = await verifDepot(ctx, ctx.body.depot_source);
  const dst = await first(ctx.db, 'SELECT * FROM depots WHERE id = ?', ctx.body.depot_destination);
  if (!dst) fail(400, 'Dépôt de destination introuvable.', 'VALIDATION');
  if (src.id === dst.id) fail(400, 'Choisissez deux dépôts différents.', 'VALIDATION');
  const lignes = lireLignes(ctx.body);
  const ref = uid(); const s = [];
  for (const l of lignes) {
    const sx = await first(ctx.db, 'SELECT quantite, cmup FROM stocks WHERE depot_id = ? AND article_id = ?', src.id, l.article_id);
    const art = await first(ctx.db, 'SELECT nom, cout_defaut FROM articles WHERE id = ?', l.article_id);
    if (!art) fail(400, 'Article introuvable.', 'VALIDATION');
    if (!sx || sx.quantite < l.quantite) fail(409, `Stock insuffisant pour « ${art.nom} » dans ${src.nom} (disponible : ${sx?.quantite || 0}).`, 'STOCK_INSUFFISANT');
    const cout = sx.cmup || art.cout_defaut;
    s.push(
      st(ctx.db, 'UPDATE stocks SET quantite = quantite - ? WHERE depot_id = ? AND article_id = ?', l.quantite, src.id, l.article_id),
      mvt(ctx, src.id, l, 'transfert_sortie', -l.quantite, cout, { ref_type: 'transfert', ref_id: ref, motif: 'Vers ' + dst.nom }),
      assurer(ctx, dst.id, l.article_id),
      st(ctx.db, `UPDATE stocks SET cmup = CASE WHEN MAX(quantite,0) + ? > 0 THEN (MAX(quantite,0) * cmup + ? * ?) / (MAX(quantite,0) + ?) ELSE ? END, quantite = quantite + ? WHERE depot_id = ? AND article_id = ?`,
        l.quantite, l.quantite, cout, l.quantite, cout, l.quantite, dst.id, l.article_id),
      mvt(ctx, dst.id, l, 'transfert_entree', l.quantite, cout, { ref_type: 'transfert', ref_id: ref, motif: 'Depuis ' + src.nom }),
    );
  }
  s.push(audit(ctx, 'transfert_stock', 'depot', src.id, null, { vers: dst.id, lignes }));
  await batch(ctx, s);
  return { ok: true, reference: ref };
});

// Sorties hors vente : pertes, casses, consommations internes, périmés.
route('POST', '/api/stocks/sortie', async (ctx) => {
  exiger(ctx, 'stocks', 'S');
  const { type, motif } = valider(ctx.body, { type: { t: 'enum', req: true, vals: ['perte', 'casse', 'conso_interne', 'perime'], label: 'Type de sortie' }, motif: { t: 'str', req: true, min: 3, max: 200, label: 'Motif' } });
  const d = await verifDepot(ctx, ctx.body.depot_id);
  const lignes = lireLignes(ctx.body);
  const ref = uid(); const s = [];
  for (const l of lignes) {
    const sx = await first(ctx.db, 'SELECT s.cmup, a.cout_defaut FROM articles a LEFT JOIN stocks s ON s.article_id = a.id AND s.depot_id = ? WHERE a.id = ?', d.id, l.article_id);
    if (!sx) fail(400, 'Article introuvable.', 'VALIDATION');
    s.push(assurer(ctx, d.id, l.article_id), st(ctx.db, 'UPDATE stocks SET quantite = quantite - ? WHERE depot_id = ? AND article_id = ?', l.quantite, d.id, l.article_id),
      mvt(ctx, d.id, l, type, -l.quantite, sx.cmup || sx.cout_defaut || 0, { ref_type: 'sortie', ref_id: ref, motif }));
  }
  s.push(audit(ctx, 'sortie_stock_' + type, 'depot', d.id, null, { lignes, motif }));
  await batch(ctx, s);
  return { ok: true };
});

// Inventaire : on saisit la quantité comptée, l'écart est enregistré comme mouvement.
route('POST', '/api/stocks/inventaire', async (ctx) => {
  exiger(ctx, 'stocks', 'S');
  const d = await verifDepot(ctx, ctx.body.depot_id);
  const comptes = (ctx.body.comptes || []).map((c) => valider(c, { article_id: { t: 'id', req: true }, compte: { t: 'num', req: true, min: 0, label: 'Quantité comptée' } }));
  if (!comptes.length) fail(400, 'Aucune quantité saisie.', 'VALIDATION');
  const ref = uid(); const s = []; const ecarts = [];
  for (const c of comptes) {
    const sx = await first(ctx.db, 'SELECT s.quantite, s.cmup, a.cout_defaut, a.nom FROM articles a LEFT JOIN stocks s ON s.article_id = a.id AND s.depot_id = ? WHERE a.id = ?', d.id, c.article_id);
    if (!sx) continue;
    const ecart = Math.round((c.compte - (sx.quantite || 0)) * 1000) / 1000;
    if (!ecart) continue;
    ecarts.push({ article: sx.nom, theorique: sx.quantite || 0, compte: c.compte, ecart });
    s.push(assurer(ctx, d.id, c.article_id), st(ctx.db, 'UPDATE stocks SET quantite = ? WHERE depot_id = ? AND article_id = ?', c.compte, d.id, c.article_id),
      mvt(ctx, d.id, c, 'inventaire', ecart, sx.cmup || sx.cout_defaut || 0, { ref_type: 'inventaire', ref_id: ref, motif: 'Écart d’inventaire' }));
  }
  s.push(audit(ctx, 'inventaire', 'depot', d.id, null, { ecarts }));
  await batch(ctx, s);
  return { ok: true, ecarts };
});

route('GET', '/api/stocks/alertes', async (ctx) => {
  exiger(ctx, 'stocks', 'C');
  const ruptures = await all(ctx.db, `SELECT d.nom depot, a.nom article, a.unite, s.quantite, a.seuil_alerte FROM stocks s JOIN articles a ON a.id = s.article_id JOIN depots d ON d.id = s.depot_id
    WHERE a.archive = 0 AND s.quantite <= a.seuil_alerte AND (a.seuil_alerte > 0 OR s.quantite < 0) ORDER BY s.quantite - a.seuil_alerte LIMIT 100`);
  const peremptions = await all(ctx.db, `SELECT d.nom depot, a.nom article, m.lot, m.peremption, m.quantite FROM mouvements_stock m JOIN articles a ON a.id = m.article_id JOIN depots d ON d.id = m.depot_id
    WHERE m.type = 'entree' AND m.peremption IS NOT NULL AND m.peremption <= ? AND m.peremption >= ? ORDER BY m.peremption LIMIT 100`, addDays(jourLocal(), 7), addDays(jourLocal(), -30));
  return { ruptures, peremptions };
});
