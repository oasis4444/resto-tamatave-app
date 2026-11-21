// Moteur de vente commun : lignes, coûts matière (fiches recettes), stocks, paiements, folio, annulation.
import { all, first, st, uid, nowIso, jourLocal, fail, audit, numeroter, verrou, MODES_PAIEMENT } from './core.js';

export const depotDe = (activiteId) => 'DEP-' + activiteId;

export async function sessionOuverte(ctx, caisseId) {
  const s = await first(ctx.db, `SELECT s.*, c.activite_id, c.nom caisse_nom FROM sessions_caisse s JOIN caisses c ON c.id = s.caisse_id
    WHERE s.caisse_id = ? AND s.statut = 'ouverte'`, caisseId);
  if (!s) {
    const c = await first(ctx.db, 'SELECT nom FROM caisses WHERE id = ?', caisseId);
    fail(409, `La caisse « ${c?.nom || caisseId} » n’est pas ouverte. Ouvrez-la d’abord (menu Finances › Caisses).`, 'CAISSE_FERMEE');
  }
  return s;
}

export function lirePaiements(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((p) => Number(p.montant) > 0).map((p) => {
    if (!MODES_PAIEMENT.includes(p.mode)) fail(400, 'Mode de paiement inconnu.', 'VALIDATION');
    const montant = Math.round(Number(p.montant));
    if (!Number.isFinite(montant) || montant <= 0 || montant > 1e10) fail(400, 'Montant de paiement invalide.', 'VALIDATION');
    return { mode: p.mode, montant, reference: p.reference ? String(p.reference).slice(0, 60) : null };
  });
}

/** Charge produits + recettes + coûts, calcule les montants. Les prix viennent toujours du serveur. */
export async function preparerLignes(ctx, activiteId, lignes) {
  if (!Array.isArray(lignes) || !lignes.length) fail(400, 'Le panier est vide.', 'VALIDATION');
  if (lignes.length > 80) fail(400, 'Trop de lignes sur un même ticket (max 80).', 'VALIDATION');
  const ids = [...new Set(lignes.map((l) => String(l.produit_id)))];
  const ph = ids.map(() => '?').join(',');
  const produits = await all(ctx.db, `SELECT * FROM produits WHERE id IN (${ph})`, ...ids);
  const recettes = await all(ctx.db, `SELECT r.*, a.cout_defaut, a.nom article_nom FROM recettes r JOIN articles a ON a.id = r.article_id WHERE r.produit_id IN (${ph})`, ...ids);
  const artIds = [...new Set([...recettes.map((r) => r.article_id), ...produits.filter((p) => p.article_id).map((p) => p.article_id)])];
  const stocks = artIds.length ? await all(ctx.db, `SELECT s.article_id, s.cmup, a.cout_defaut FROM articles a LEFT JOIN stocks s ON s.article_id = a.id AND s.depot_id = ? WHERE a.id IN (${artIds.map(() => '?').join(',')})`, depotDe(activiteId), ...artIds) : [];
  const coutArt = (aid) => { const s = stocks.find((x) => x.article_id === aid); return s ? (s.cmup || s.cout_defaut || 0) : 0; };

  let total = 0;
  const out = lignes.map((l) => {
    const p = produits.find((x) => x.id === String(l.produit_id));
    if (!p || p.archive) fail(400, 'Un produit du panier n’existe plus ou a été archivé.', 'VALIDATION');
    if (p.activite_id !== activiteId) fail(400, `« ${p.nom} » n’appartient pas à cette activité.`, 'VALIDATION');
    const q = Number(l.quantite);
    if (!Number.isFinite(q) || q <= 0 || q > 10000) fail(400, `Quantité invalide pour « ${p.nom} ».`, 'VALIDATION');
    const pu = p.prix;
    const montant = Math.round(pu * q);
    const conso = p.article_id
      ? [{ article_id: p.article_id, qte: q, cmup: coutArt(p.article_id) }]
      : recettes.filter((r) => r.produit_id === p.id).map((r) => ({ article_id: r.article_id, qte: r.quantite * q, cmup: coutArt(r.article_id) }));
    const cout = Math.round(conso.reduce((s, c) => s + c.qte * c.cmup, 0));
    total += montant;
    return { produit: p, quantite: q, pu, montant, cout, conso, note: l.note ? String(l.note).slice(0, 120) : null };
  });
  return { lignes: out, total };
}

/** Mouvements de stock (sens -1 = sortie, +1 = retour). */
export function mouvementsStock(ctx, depotId, consos, type, refType, refId, sens = -1) {
  const s = [];
  const j = jourLocal();
  for (const c of consos) {
    s.push(st(ctx.db, 'INSERT OR IGNORE INTO stocks(depot_id, article_id, quantite, cmup) VALUES (?,?,0,?)', depotId, c.article_id, c.cmup || 0));
    s.push(st(ctx.db, 'UPDATE stocks SET quantite = quantite + ? WHERE depot_id = ? AND article_id = ?', sens * c.qte, depotId, c.article_id));
    s.push(st(ctx.db, 'INSERT INTO mouvements_stock(id, quand, jour, depot_id, article_id, type, quantite, cout_unitaire, ref_type, ref_id, utilisateur_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      uid(), nowIso(), j, depotId, c.article_id, type, sens * c.qte, c.cmup || 0, refType, refId, ctx.user?.id));
  }
  return s;
}

/**
 * Enregistre une vente complète dans un seul lot atomique.
 * opts : { activiteId, prep (de preparerLignes), paiements, sessionCaisse, folioId, clientId, commandeId, remise, source }
 * Retourne { docId, stmts, rendu }.
 */
export async function construireVente(ctx, opts) {
  const { activiteId, prep, folioId = null, clientId = null, commandeId = null, source = 'caisse' } = opts;
  const remise = Math.max(0, Math.round(Number(opts.remise) || 0));
  if (remise > prep.total) fail(400, 'La remise dépasse le total.', 'VALIDATION');
  const total = prep.total - remise;
  const paiements = folioId ? [] : lirePaiements(opts.paiements);
  let rendu = 0;
  if (!folioId) {
    const paye = paiements.reduce((s, p) => s + p.montant, 0);
    if (paye < total) fail(400, `Paiement insuffisant : il manque ${(total - paye).toLocaleString('fr-FR')} Ar.`, 'PAIEMENT');
    rendu = paye - total;
    if (rendu > 0) {
      const esp = paiements.find((p) => p.mode === 'especes');
      if (!esp || esp.montant < rendu) fail(400, 'Le rendu de monnaie n’est possible que sur un paiement en espèces.', 'PAIEMENT');
      esp.montant -= rendu; // on n'enregistre que ce qui reste réellement en caisse
    }
  } else {
    const f = await first(ctx.db, 'SELECT statut FROM folios WHERE id = ?', folioId);
    if (!f) fail(404, 'Compte séjour introuvable.', 'INTROUVABLE');
    if (f.statut !== 'ouvert') fail(409, 'Ce compte séjour est déjà clôturé.', 'FOLIO_CLOS');
  }
  const sess = opts.sessionCaisse;
  if (!folioId && !sess) fail(409, 'Aucune caisse ouverte.', 'CAISSE_FERMEE');

  const docId = uid(); const q = nowIso(); const j = jourLocal();
  const s = [
    st(ctx.db, `INSERT INTO documents(id, type, activite_id, client_id, folio_id, commande_id, session_caisse_id, total, cree_par, cree_le, jour)
      VALUES (?, 'ticket', ?,?,?,?,?,?,?,?,?)`, docId, activiteId, clientId, folioId, commandeId, sess?.id, total, ctx.user.id, q, j),
    ...numeroter(ctx.db, 'TCK', 'documents', docId),
  ];
  for (const l of prep.lignes) {
    s.push(st(ctx.db, 'INSERT INTO ventes_lignes(id, quand, jour, activite_id, produit_id, libelle, quantite, prix_unitaire, montant, cout, document_id, folio_id, source, utilisateur_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      uid(), q, j, activiteId, l.produit.id, l.produit.nom, l.quantite, l.pu, l.montant, l.cout, docId, folioId, source, ctx.user.id));
    if (folioId) s.push(st(ctx.db, 'INSERT INTO folio_lignes(id, folio_id, jour, activite_id, libelle, quantite, prix_unitaire, montant, source_type, source_id, cree_le) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      uid(), folioId, j, activiteId, l.produit.nom, l.quantite, l.pu, l.montant, 'document', docId, q));
    s.push(...mouvementsStock(ctx, depotDe(activiteId), l.conso, 'sortie_vente', 'document', docId));
  }
  if (remise) {
    s.push(st(ctx.db, 'INSERT INTO ventes_lignes(id, quand, jour, activite_id, libelle, quantite, prix_unitaire, montant, cout, document_id, folio_id, source, utilisateur_id) VALUES (?,?,?,?,?,1,?,?,0,?,?,?,?)',
      uid(), q, j, activiteId, 'Remise', -remise, -remise, docId, folioId, source, ctx.user.id));
    if (folioId) s.push(st(ctx.db, 'INSERT INTO folio_lignes(id, folio_id, jour, activite_id, libelle, quantite, prix_unitaire, montant, source_type, source_id, cree_le) VALUES (?,?,?,?,?,1,?,?,?,?,?)',
      uid(), folioId, j, activiteId, 'Remise', -remise, -remise, 'document', docId, q));
  }
  for (const p of paiements) if (p.montant > 0) s.push(st(ctx.db,
    'INSERT INTO paiements(id, quand, jour, session_caisse_id, activite_id, document_id, mode, montant, reference, nature, utilisateur_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    uid(), q, j, sess.id, activiteId, docId, p.mode, p.montant, p.reference, 'reglement', ctx.user.id));
  if (clientId) s.push(st(ctx.db, 'UPDATE clients SET points = points + ? WHERE id = ?', Math.floor(total / 10000), clientId));
  s.push(audit(ctx, folioId ? 'vente_au_folio' : 'vente', 'document', docId, null, { activite: activiteId, total, remise, paiements, folio: folioId }));
  return { docId, stmts: s, rendu, total };
}

/** Annulation d'un ticket : avoir, contre-écritures, remboursement, retour stock. Jamais de suppression. */
export async function construireAnnulation(ctx, docId, motif, caisseRembourse) {
  const d = await first(ctx.db, 'SELECT * FROM documents WHERE id = ?', docId);
  if (!d) fail(404, 'Ticket introuvable.', 'INTROUVABLE');
  if (d.statut === 'annule') fail(409, 'Ce ticket est déjà annulé.', 'DEJA_ANNULE');
  if (d.type !== 'ticket') fail(400, 'Seuls les tickets peuvent être annulés ici.', 'VALIDATION');
  if (d.folio_id) {
    const f = await first(ctx.db, 'SELECT statut FROM folios WHERE id = ?', d.folio_id);
    if (f?.statut !== 'ouvert') fail(409, 'Le compte séjour lié est déjà clôturé : annulation impossible.', 'FOLIO_CLOS');
  }
  const lignes = await all(ctx.db, 'SELECT * FROM ventes_lignes WHERE document_id = ?', docId);
  const mvts = await all(ctx.db, "SELECT * FROM mouvements_stock WHERE ref_type = 'document' AND ref_id = ?", docId);
  const pais = await all(ctx.db, 'SELECT * FROM paiements WHERE document_id = ?', docId);
  const avId = uid(); const q = nowIso(); const j = jourLocal();
  let sess = null;
  if (pais.length) sess = await sessionOuverte(ctx, caisseRembourse);
  const s = [
    verrou(ctx, 'annuler-document-' + docId),
    st(ctx.db, "UPDATE documents SET statut = 'annule', annule_par = ?, motif_annulation = ? WHERE id = ? AND statut = 'valide'", ctx.user.id, motif, docId),
    st(ctx.db, `INSERT INTO documents(id, type, activite_id, client_id, folio_id, session_caisse_id, total, cree_par, cree_le, jour, ref_document_id, motif_annulation)
      VALUES (?, 'avoir', ?,?,?,?,?,?,?,?,?,?)`, avId, d.activite_id, d.client_id, d.folio_id, sess?.id, -d.total, ctx.user.id, q, j, docId, motif),
    ...numeroter(ctx.db, 'AV', 'documents', avId),
  ];
  for (const l of lignes) s.push(st(ctx.db, 'INSERT INTO ventes_lignes(id, quand, jour, activite_id, produit_id, libelle, quantite, prix_unitaire, montant, cout, document_id, folio_id, source, utilisateur_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    uid(), q, j, l.activite_id, l.produit_id, 'Annulation : ' + l.libelle, -l.quantite, l.prix_unitaire, -l.montant, -l.cout, avId, l.folio_id, 'annulation', ctx.user.id));
  if (d.folio_id) s.push(st(ctx.db, "UPDATE folio_lignes SET annule = 1 WHERE source_type = 'document' AND source_id = ?", docId));
  for (const m of mvts) s.push(...mouvementsStock(ctx, m.depot_id, [{ article_id: m.article_id, qte: -m.quantite, cmup: m.cout_unitaire }], 'annulation', 'document', avId, 1));
  for (const p of pais) s.push(st(ctx.db, 'INSERT INTO paiements(id, quand, jour, session_caisse_id, activite_id, document_id, mode, montant, reference, nature, utilisateur_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    uid(), q, j, sess.id, p.activite_id, avId, p.mode, -p.montant, p.reference, 'remboursement', ctx.user.id));
  if (d.commande_id) s.push(st(ctx.db, "UPDATE commandes SET statut = 'annulee', version = version + 1 WHERE id = ?", d.commande_id));
  s.push(audit(ctx, 'annulation_ticket', 'document', docId, { statut: 'valide', total: d.total }, { statut: 'annule', avoir: avId, motif }));
  return { avoirId: avId, stmts: s };
}
