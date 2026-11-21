// Clients, salle de réception (événements), bien-être (rendez-vous), dépenses.
import { route } from '../router.js';
import { crud } from '../lib/crud.js';
import { all, first, st, valider, uid, nowIso, jourLocal, fail, audit, batch, numeroter, verrou, MODES_PAIEMENT } from '../lib/core.js';
import { exiger, exigerActivite } from '../lib/auth.js';
import { sessionOuverte, lirePaiements, preparerLignes, construireVente } from '../lib/vente.js';
import { clientOuNouveau, soldeFolio } from './hebergement.js';

// ── Clients ──
crud({ chemin: 'clients', table: 'clients', module: 'clients', recherche: ['nom', 'telephone', 'email', 'entreprise'],
  champs: {
    nom: { t: 'str', req: true, max: 100, label: 'Nom' }, telephone: { t: 'str', max: 30, label: 'Téléphone' }, email: { t: 'email', label: 'Email' },
    type: { t: 'enum', vals: ['particulier', 'professionnel'], def: 'particulier' }, entreprise: { t: 'str', max: 100 }, nif: { t: 'str', max: 30 }, stat: { t: 'str', max: 30 },
    adresse: { t: 'str', max: 200 }, notes: { t: 'str', max: 1000, label: 'Préférences / notes' },
  },
  avantEcriture: async (ctx, d) => {
    if (d.telephone) {
      const dbl = await first(ctx.db, 'SELECT nom FROM clients WHERE telephone = ? AND archive = 0 AND id <> ?', d.telephone, ctx.params.id || '');
      if (dbl) fail(409, `Ce numéro est déjà enregistré pour le client « ${dbl.nom} ».`, 'DOUBLON');
    }
  },
});
route('GET', '/api/clients/:id/historique', async (ctx) => {
  exiger(ctx, 'clients', 'C');
  const id = ctx.params.id;
  const [sejours, achats, rdv, evenements, folios] = await Promise.all([
    all(ctx.db, 'SELECT r.numero, r.arrivee, r.depart, r.statut, b.nom bungalow FROM reservations r JOIN bungalows b ON b.id = r.bungalow_id WHERE r.client_id = ? ORDER BY r.arrivee DESC LIMIT 50', id),
    all(ctx.db, "SELECT d.numero, d.jour, d.total, d.statut, a.nom activite FROM documents d LEFT JOIN activites a ON a.id = d.activite_id WHERE d.client_id = ? AND d.type = 'ticket' ORDER BY d.cree_le DESC LIMIT 50", id),
    all(ctx.db, 'SELECT r.numero, r.date, r.debut, r.statut, p.nom prestation FROM rendez_vous r JOIN produits p ON p.id = r.produit_id WHERE r.client_id = ? ORDER BY r.date DESC LIMIT 50', id),
    all(ctx.db, 'SELECT e.numero, e.date, e.type, e.statut, s.nom salle FROM evenements e JOIN salles s ON s.id = e.salle_id WHERE e.client_id = ? ORDER BY e.date DESC LIMIT 50', id),
    all(ctx.db, `SELECT f.id, f.numero, f.libelle, f.statut, (SELECT COALESCE(SUM(montant),0) FROM folio_lignes WHERE folio_id = f.id AND annule = 0) - (SELECT COALESCE(SUM(montant),0) FROM paiements WHERE folio_id = f.id) solde
      FROM folios f WHERE f.client_id = ? ORDER BY f.cree_le DESC LIMIT 50`, id),
  ]);
  return { sejours, achats, rdv, evenements, folios };
});

// ── Salle de réception ──
crud({ chemin: 'salles', table: 'salles', module: 'reception',
  champs: { nom: { t: 'str', req: true, max: 60 }, capacite: { t: 'int', def: 50, min: 1 }, prix_heure: { t: 'int', def: 0, min: 0 }, prix_demi: { t: 'int', def: 0, min: 0 }, prix_jour: { t: 'int', def: 0, min: 0 }, description: { t: 'str', max: 500 } } });

const TYPES_EVT = ['mariage', 'anniversaire', 'seminaire', 'conference', 'bapteme', 'communion', 'reunion', 'autre'];
route('GET', '/api/evenements', async (ctx) => {
  exiger(ctx, 'reception', 'C');
  const w = ['e.date BETWEEN ? AND ?']; const p = [ctx.query.du || jourLocal(), ctx.query.au || '9999-12-31'];
  if (ctx.query.statut) { w.push('e.statut = ?'); p.push(ctx.query.statut); }
  return all(ctx.db, `SELECT e.*, s.nom salle, c.nom client, c.telephone FROM evenements e JOIN salles s ON s.id = e.salle_id JOIN clients c ON c.id = e.client_id
    WHERE ${w.join(' AND ')} ORDER BY e.date, e.heure_debut LIMIT 500`, ...p);
});
route('GET', '/api/evenements/:id', async (ctx) => {
  exiger(ctx, 'reception', 'C');
  const e = await first(ctx.db, `SELECT e.*, s.nom salle, s.capacite, c.nom client, c.telephone, c.email, c.adresse FROM evenements e JOIN salles s ON s.id = e.salle_id JOIN clients c ON c.id = e.client_id WHERE e.id = ?`, ctx.params.id);
  if (!e) fail(404, 'Événement introuvable.', 'INTROUVABLE');
  e.options = JSON.parse(e.options || '[]');
  if (e.folio_id) Object.assign(e, await soldeFolio(ctx.db, e.folio_id));
  return e;
});
route('POST', '/api/evenements', async (ctx) => {
  exiger(ctx, 'reception', 'S');
  const d = valider(ctx.body, {
    salle_id: { t: 'id', req: true, label: 'Salle' }, type: { t: 'enum', req: true, vals: TYPES_EVT, label: 'Type d’événement' }, titre: { t: 'str', max: 100 },
    date: { t: 'date', req: true, label: 'Date' }, heure_debut: { t: 'int', req: true, min: 0, max: 23, label: 'Heure de début' }, heure_fin: { t: 'int', req: true, min: 1, max: 24, label: 'Heure de fin' },
    formule: { t: 'enum', vals: ['heure', 'demi', 'jour'], def: 'heure' }, invites: { t: 'int', def: 0, min: 0 }, notes: { t: 'str', max: 1000 },
    statut: { t: 'enum', vals: ['devis', 'confirme'], def: 'confirme' },
  });
  if (d.heure_fin <= d.heure_debut) fail(400, 'L’heure de fin doit être après l’heure de début.', 'VALIDATION');
  if (d.date < jourLocal()) fail(400, 'La date est déjà passée.', 'VALIDATION');
  const salle = await first(ctx.db, 'SELECT * FROM salles WHERE id = ? AND archive = 0', d.salle_id);
  if (!salle) fail(400, 'Salle introuvable.', 'VALIDATION');
  if (d.invites > salle.capacite) fail(400, `Capacité de la salle dépassée (${salle.capacite} personnes).`, 'VALIDATION');
  const options = (Array.isArray(ctx.body.options) ? ctx.body.options : []).map((o) => valider(o, { libelle: { t: 'str', req: true, max: 80, label: 'Option' }, montant: { t: 'int', req: true, min: 0, label: 'Montant option' } }));
  const heures = d.heure_fin - d.heure_debut;
  const montantSalle = d.formule === 'jour' ? salle.prix_jour : d.formule === 'demi' ? salle.prix_demi : salle.prix_heure * heures;
  const montantOptions = options.reduce((s, o) => s + o.montant, 0);
  const s = [];
  const clientId = await clientOuNouveau(ctx, ctx.body, s);
  const id = uid(); const folioId = uid();
  const pai = lirePaiements(ctx.body.acompte ? [ctx.body.acompte] : []);
  const sess = pai.length ? await sessionOuverte(ctx, ctx.body.caisse_id || 'CAI-RECEP') : null;
  s.push(
    st(ctx.db, 'INSERT INTO folios(id, client_id, libelle, cree_le) VALUES (?,?,?,?)', folioId, clientId, `Événement ${d.type} ${d.date.split('-').reverse().join('/')}`, nowIso()),
    ...numeroter(ctx.db, 'FOL', 'folios', folioId),
    st(ctx.db, `INSERT INTO evenements(id, salle_id, client_id, type, titre, date, heure_debut, heure_fin, invites, montant_salle, options, montant_options, statut, folio_id, notes, cree_par, cree_le)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, salle.id, clientId, d.type, d.titre, d.date, d.heure_debut, d.heure_fin, d.invites, montantSalle, JSON.stringify(options), montantOptions, d.statut, folioId, d.notes, ctx.user.id, nowIso()),
    ...numeroter(ctx.db, 'EVT', 'evenements', id),
  );
  if (d.statut === 'confirme') for (let h = d.heure_debut; h < d.heure_fin; h++) s.push(st(ctx.db, 'INSERT INTO evenement_creneaux(salle_id, date, heure, evenement_id) VALUES (?,?,?,?)', salle.id, d.date, h, id));
  for (const p of pai) s.push(st(ctx.db, "INSERT INTO paiements(id, quand, jour, session_caisse_id, activite_id, folio_id, mode, montant, reference, nature, utilisateur_id) VALUES (?,?,?,?,'RECEP',?,?,?,?,'acompte',?)",
    uid(), nowIso(), jourLocal(), sess.id, folioId, p.mode, p.montant, p.reference, ctx.user.id));
  s.push(audit(ctx, 'creation_evenement', 'evenement', id, null, { ...d, options, montantSalle }));
  try { await batch(ctx, s); } catch (e) {
    if (/UNIQUE/i.test(e.message) && /evenement_creneaux/i.test(e.message)) fail(409, 'La salle est déjà occupée sur une partie de ce créneau. Choisissez un autre horaire ou une autre salle.', 'CONFLIT_SALLE');
    throw e;
  }
  return { id, total: montantSalle + montantOptions };
});
route('POST', '/api/evenements/:id/confirmer', async (ctx) => {
  exiger(ctx, 'reception', 'S');
  const e = await first(ctx.db, 'SELECT * FROM evenements WHERE id = ?', ctx.params.id);
  if (!e || e.statut !== 'devis') fail(409, 'Seul un devis peut être confirmé.', 'STATUT');
  const s = [st(ctx.db, "UPDATE evenements SET statut = 'confirme', version = version + 1 WHERE id = ?", e.id)];
  for (let h = e.heure_debut; h < e.heure_fin; h++) s.push(st(ctx.db, 'INSERT INTO evenement_creneaux(salle_id, date, heure, evenement_id) VALUES (?,?,?,?)', e.salle_id, e.date, h, e.id));
  s.push(audit(ctx, 'confirmation_evenement', 'evenement', e.id));
  try { await batch(ctx, s); } catch (x) { if (/evenement_creneaux/.test(x.message)) fail(409, 'La salle a été réservée entre-temps sur ce créneau.', 'CONFLIT_SALLE'); throw x; }
  return { ok: true };
});
// L'événement réalisé est facturé sur son compte (chiffre d'affaires à la date de l'événement).
route('POST', '/api/evenements/:id/terminer', async (ctx) => {
  exiger(ctx, 'reception', 'S');
  const e = await first(ctx.db, 'SELECT e.*, s.nom salle FROM evenements e JOIN salles s ON s.id = e.salle_id WHERE e.id = ?', ctx.params.id);
  if (!e || e.statut !== 'confirme') fail(409, 'Seul un événement confirmé peut être clôturé.', 'STATUT');
  const q = nowIso();
  const lignes = [{ libelle: `Location ${e.salle} – ${e.type} (${e.heure_debut}h-${e.heure_fin}h)`, montant: e.montant_salle }, ...JSON.parse(e.options || '[]')];
  const s = [verrou(ctx, 'terminer-evt-' + e.id), st(ctx.db, "UPDATE evenements SET statut = 'termine', version = version + 1 WHERE id = ?", e.id)];
  for (const l of lignes) if (l.montant) s.push(
    st(ctx.db, "INSERT INTO folio_lignes(id, folio_id, jour, activite_id, libelle, quantite, prix_unitaire, montant, source_type, source_id, cree_le) VALUES (?,?,?,'RECEP',?,1,?,?,'evenement',?,?)", uid(), e.folio_id, e.date, l.libelle, l.montant, l.montant, e.id, q),
    st(ctx.db, "INSERT INTO ventes_lignes(id, quand, jour, activite_id, libelle, quantite, prix_unitaire, montant, cout, folio_id, source, utilisateur_id) VALUES (?,?,?,'RECEP',?,1,?,?,0,?,'evenement',?)", uid(), q, e.date, l.libelle, l.montant, l.montant, e.folio_id, ctx.user.id));
  s.push(audit(ctx, 'evenement_termine', 'evenement', e.id));
  await batch(ctx, s);
  return { ok: true, folio_id: e.folio_id };
});
route('POST', '/api/evenements/:id/annuler', async (ctx) => {
  exiger(ctx, 'reception', 'S');
  const e = await first(ctx.db, 'SELECT * FROM evenements WHERE id = ?', ctx.params.id);
  if (!e || !['devis', 'confirme'].includes(e.statut)) fail(409, 'Événement non annulable.', 'STATUT');
  const motif = String(ctx.body.motif || '').trim();
  if (motif.length < 3) fail(400, 'Indiquez le motif de l’annulation.', 'VALIDATION');
  const solde = await soldeFolio(ctx.db, e.folio_id);
  const s = [verrou(ctx, 'annuler-evt-' + e.id), st(ctx.db, "UPDATE evenements SET statut = 'annule', notes = COALESCE(notes,'') || ?, version = version + 1 WHERE id = ?", `\nAnnulé : ${motif}`, e.id),
    st(ctx.db, 'DELETE FROM evenement_creneaux WHERE evenement_id = ?', e.id)];
  if (solde.paye > 0) {
    if (ctx.body.acompte === 'rembourser') {
      exiger(ctx, 'reception', 'V');
      const sess = await sessionOuverte(ctx, ctx.body.caisse_id || 'CAI-RECEP');
      const modes = await all(ctx.db, 'SELECT mode, SUM(montant) m FROM paiements WHERE folio_id = ? GROUP BY mode HAVING SUM(montant) > 0', e.folio_id);
      for (const m of modes) s.push(st(ctx.db, "INSERT INTO paiements(id, quand, jour, session_caisse_id, activite_id, folio_id, mode, montant, nature, utilisateur_id) VALUES (?,?,?,?,'RECEP',?,?,?,'remboursement',?)", uid(), nowIso(), jourLocal(), sess.id, e.folio_id, m.mode, -m.m, ctx.user.id));
    } else if (ctx.body.acompte === 'conserver') {
      const q = nowIso();
      s.push(st(ctx.db, "INSERT INTO folio_lignes(id, folio_id, jour, activite_id, libelle, quantite, prix_unitaire, montant, source_type, source_id, cree_le) VALUES (?,?,?,'RECEP','Frais d''annulation',1,?,?,'annulation',?,?)", uid(), e.folio_id, jourLocal(), solde.paye, solde.paye, e.id, q),
        st(ctx.db, "INSERT INTO ventes_lignes(id, quand, jour, activite_id, libelle, quantite, prix_unitaire, montant, cout, folio_id, source, utilisateur_id) VALUES (?,?,?,'RECEP','Frais d''annulation',1,?,?,0,?,'annulation',?)", uid(), q, jourLocal(), solde.paye, solde.paye, e.folio_id, ctx.user.id));
    } else fail(400, `Un acompte de ${solde.paye.toLocaleString('fr-FR')} Ar a été versé : choisissez « rembourser » ou « conserver ».`, 'ACOMPTE');
  }
  s.push(st(ctx.db, "UPDATE folios SET statut = 'annule', clos_le = ? WHERE id = ?", nowIso(), e.folio_id), audit(ctx, 'annulation_evenement', 'evenement', e.id, null, { motif }));
  await batch(ctx, s);
  return { ok: true };
});

// ── Bien-être : rendez-vous ──
const minutes = (h) => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
route('GET', '/api/rendez-vous', async (ctx) => {
  exiger(ctx, 'bienetre', 'C');
  return all(ctx.db, `SELECT r.*, p.nom prestation, c.nom client, c.telephone, u.nom praticien FROM rendez_vous r JOIN produits p ON p.id = r.produit_id JOIN clients c ON c.id = r.client_id
    LEFT JOIN utilisateurs u ON u.id = r.praticien_id WHERE r.date BETWEEN ? AND ? ORDER BY r.date, r.debut`, ctx.query.du || jourLocal(), ctx.query.au || ctx.query.du || jourLocal());
});
route('GET', '/api/praticiens', async (ctx) => {
  exiger(ctx, 'bienetre', 'C');
  return all(ctx.db, "SELECT u.id, u.nom FROM utilisateurs u JOIN roles r ON r.id = u.role_id WHERE u.statut = 'actif' AND (r.code = 'resp_be' OR u.activites LIKE '%BE%') ORDER BY u.nom");
});
route('POST', '/api/rendez-vous', async (ctx) => {
  exiger(ctx, 'bienetre', 'S');
  const d = valider(ctx.body, { produit_id: { t: 'id', req: true, label: 'Prestation' }, date: { t: 'date', req: true, label: 'Date' }, debut: { t: 'heure', req: true, label: 'Heure' },
    praticien_id: { t: 'id' }, ressource: { t: 'str', max: 40, label: 'Cabine / salle' }, notes: { t: 'str', max: 500 } });
  const p = await first(ctx.db, "SELECT * FROM produits WHERE id = ? AND activite_id = 'BE' AND archive = 0", d.produit_id);
  if (!p) fail(400, 'Prestation introuvable.', 'VALIDATION');
  const fin = hhmm(Math.min(minutes(d.debut) + (p.duree_min || 60), 24 * 60 - 1));
  const crit = []; const pc = [];
  if (d.praticien_id) { crit.push('r.praticien_id = ?'); pc.push(d.praticien_id); }
  if (d.ressource) { crit.push('r.ressource = ?'); pc.push(d.ressource); }
  const conflit = crit.length ? await first(ctx.db, `SELECT r.numero, r.debut, r.fin FROM rendez_vous r WHERE r.date = ? AND r.statut = 'prevu' AND r.debut < ? AND r.fin > ?
    AND (${crit.join(' OR ')}) LIMIT 1`, d.date, fin, d.debut, ...pc) : null;
  if (conflit) fail(409, `Conflit avec le rendez-vous ${conflit.numero} (${conflit.debut}–${conflit.fin}) : même praticien ou même cabine.`, 'CONFLIT_RDV');
  const s = [];
  const clientId = await clientOuNouveau(ctx, ctx.body, s);
  const id = uid();
  s.push(st(ctx.db, 'INSERT INTO rendez_vous(id, produit_id, client_id, praticien_id, ressource, date, debut, fin, prix, notes, folio_id, cree_par, cree_le) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id, p.id, clientId, d.praticien_id, d.ressource, d.date, d.debut, fin, p.prix, d.notes, ctx.body.folio_id || null, ctx.user.id, nowIso()),
  ...numeroter(ctx.db, 'RDV', 'rendez_vous', id), audit(ctx, 'creation_rdv', 'rendez_vous', id, null, d));
  await batch(ctx, s);
  return { id, fin };
});
route('POST', '/api/rendez-vous/:id/realiser', async (ctx) => {
  exiger(ctx, 'bienetre', 'S');
  const r = await first(ctx.db, 'SELECT * FROM rendez_vous WHERE id = ?', ctx.params.id);
  if (!r || r.statut !== 'prevu') fail(409, 'Rendez-vous déjà traité.', 'STATUT');
  exigerActivite(ctx, 'BE');
  const prep = await preparerLignes(ctx, 'BE', [{ produit_id: r.produit_id, quantite: 1 }]);
  const folioId = ctx.body.au_folio ? (ctx.body.folio_id || r.folio_id) : null;
  if (ctx.body.au_folio && !folioId) fail(400, 'Choisissez le compte séjour à débiter.', 'VALIDATION');
  const sess = folioId ? null : await sessionOuverte(ctx, ctx.body.caisse_id || 'CAI-BE');
  const v = await construireVente(ctx, { activiteId: 'BE', prep, paiements: ctx.body.paiements, sessionCaisse: sess, folioId, clientId: r.client_id, source: 'rendez_vous' });
  await batch(ctx, [verrou(ctx, 'rdv-' + r.id), st(ctx.db, "UPDATE rendez_vous SET statut = 'fait', document_id = ?, version = version + 1 WHERE id = ?", v.docId, r.id), ...v.stmts]);
  return { document_id: v.docId, rendu: v.rendu };
});
route('POST', '/api/rendez-vous/:id/statut', async (ctx) => {
  exiger(ctx, 'bienetre', 'S');
  const { statut } = valider(ctx.body, { statut: { t: 'enum', req: true, vals: ['annule', 'absent'] } });
  const r = await first(ctx.db, 'SELECT statut FROM rendez_vous WHERE id = ?', ctx.params.id);
  if (!r || r.statut !== 'prevu') fail(409, 'Rendez-vous déjà traité.', 'STATUT');
  await batch(ctx, [st(ctx.db, 'UPDATE rendez_vous SET statut = ?, version = version + 1 WHERE id = ?', statut, ctx.params.id), audit(ctx, 'rdv_' + statut, 'rendez_vous', ctx.params.id)]);
  return { ok: true };
});

// ── Dépenses ──
const CATEGORIES_DEPENSES = ['Achats marchandises', 'Achats cuisine', 'Salaires', 'Électricité / eau (JIRAMA)', 'Carburant / groupe', 'Entretien / réparations', 'Transport', 'Communication / internet', 'Loyer', 'Impôts et taxes', 'Fournitures', 'Publicité', 'Autres'];
route('GET', '/api/depenses/categories', async () => CATEGORIES_DEPENSES);
route('GET', '/api/depenses', async (ctx) => {
  exiger(ctx, 'depenses', 'C');
  const w = ['d.jour BETWEEN ? AND ?']; const p = [ctx.query.du || jourLocal().slice(0, 8) + '01', ctx.query.au || jourLocal()];
  if (ctx.query.activite) { if (ctx.query.activite === 'COMMUN') w.push('d.activite_id IS NULL'); else { w.push('d.activite_id = ?'); p.push(ctx.query.activite); } }
  return all(ctx.db, `SELECT d.*, a.nom activite_nom, f.nom fournisseur, u.nom par FROM depenses d LEFT JOIN activites a ON a.id = d.activite_id LEFT JOIN fournisseurs f ON f.id = d.fournisseur_id
    LEFT JOIN utilisateurs u ON u.id = d.cree_par WHERE ${w.join(' AND ')} ORDER BY d.jour DESC, d.cree_le DESC LIMIT 1000`, ...p);
});
route('POST', '/api/depenses', async (ctx) => {
  exiger(ctx, 'depenses', 'S');
  const d = valider(ctx.body, {
    jour: { t: 'date', def: jourLocal(), label: 'Date' }, activite_id: { t: 'enum', vals: ['BUNG', 'REST', 'FAST', 'MALG', 'BUFF', 'RECEP', 'BE', 'SHOP'], label: 'Activité' },
    categorie: { t: 'enum', req: true, vals: CATEGORIES_DEPENSES, label: 'Catégorie' }, libelle: { t: 'str', req: true, max: 200, label: 'Libellé' },
    montant: { t: 'int', req: true, min: 1, label: 'Montant' }, mode: { t: 'enum', req: true, vals: MODES_PAIEMENT, label: 'Mode de paiement' },
    fournisseur_id: { t: 'id' }, caisse_id: { t: 'id', label: 'Caisse' },
  });
  if (d.jour > jourLocal()) fail(400, 'Une dépense ne peut pas être datée dans le futur.', 'VALIDATION');
  let sess = null;
  if (d.mode === 'especes' && d.caisse_id) sess = await sessionOuverte(ctx, d.caisse_id);
  const id = uid();
  await batch(ctx, [
    st(ctx.db, 'INSERT INTO depenses(id, jour, activite_id, categorie, libelle, montant, mode, session_caisse_id, fournisseur_id, cree_par, cree_le) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      id, d.jour, d.activite_id, d.categorie, d.libelle, d.montant, d.mode, sess?.id, d.fournisseur_id, ctx.user.id, nowIso()),
    ...numeroter(ctx.db, 'DEP', 'depenses', id), audit(ctx, 'depense', 'depense', id, null, d),
  ]);
  return { id };
});
route('POST', '/api/depenses/:id/annuler', async (ctx) => {
  exiger(ctx, 'depenses', 'V');
  const motif = String(ctx.body.motif || '').trim();
  if (motif.length < 3) fail(400, 'Indiquez le motif.', 'VALIDATION');
  const d = await first(ctx.db, 'SELECT * FROM depenses WHERE id = ?', ctx.params.id);
  if (!d || d.statut !== 'validee') fail(409, 'Dépense déjà annulée.', 'STATUT');
  if (d.session_caisse_id && (await first(ctx.db, 'SELECT statut FROM sessions_caisse WHERE id = ?', d.session_caisse_id)).statut !== 'ouverte') fail(409, 'La caisse concernée est déjà clôturée : enregistrez plutôt une correction.', 'CAISSE_CLOSE');
  await batch(ctx, [st(ctx.db, "UPDATE depenses SET statut = 'annulee', annule_par = ?, motif_annulation = ? WHERE id = ?", ctx.user.id, motif, d.id), audit(ctx, 'annulation_depense', 'depense', d.id, { statut: 'validee' }, { statut: 'annulee', motif })]);
  return { ok: true };
});
