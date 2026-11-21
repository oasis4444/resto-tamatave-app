// Bungalows, réservations, check-in/out, comptes séjour (folios), ménage.
import { route } from '../router.js';
import { crud } from '../lib/crud.js';
import { all, first, st, valider, uid, nowIso, jourLocal, addDays, daysBetween, fail, audit, batch, numeroter, verrou, lireParametres } from '../lib/core.js';
import { exiger, peut } from '../lib/auth.js';
import { sessionOuverte, lirePaiements } from '../lib/vente.js';

crud({ chemin: 'bungalows', table: 'bungalows', module: 'hebergement', ordre: 't.nom',
  champs: {
    nom: { t: 'str', req: true, max: 40, label: 'Nom' }, type: { t: 'str', max: 40, label: 'Type' }, capacite: { t: 'int', def: 2, min: 1, max: 50, label: 'Capacité' },
    prix_nuit: { t: 'int', req: true, min: 0, label: 'Prix nuit' }, prix_weekend: { t: 'int', min: 0 }, prix_ferie: { t: 'int', min: 0 }, prix_journee: { t: 'int', min: 0 },
    etat: { t: 'enum', vals: ['propre', 'nettoyage', 'maintenance', 'hors_service'], def: 'propre', label: 'État' }, description: { t: 'str', max: 500 },
  } });

route('GET', '/api/jours-feries', async (ctx) => all(ctx.db, 'SELECT * FROM jours_feries ORDER BY date'));
route('PUT', '/api/jours-feries', async (ctx) => {
  exiger(ctx, 'parametres', 'S');
  const l = (ctx.body.jours || []).map((j) => valider(j, { date: { t: 'date', req: true }, libelle: { t: 'str', req: true, max: 60 } }));
  await batch(ctx, [st(ctx.db, 'DELETE FROM jours_feries'), ...l.map((j) => st(ctx.db, 'INSERT INTO jours_feries(date, libelle) VALUES (?,?) ON CONFLICT (date) DO UPDATE SET libelle = excluded.libelle', j.date, j.libelle)), audit(ctx, 'modification_jours_feries', 'parametres', null, null, l)]);
  return { ok: true };
});

/** Prix de chaque nuit : férié > week-end (nuits de vendredi et samedi) > normal. */
async function tarifNuits(ctx, b, arrivee, depart) {
  const feries = new Set((await all(ctx.db, 'SELECT date FROM jours_feries WHERE date >= ? AND date < ?', arrivee, depart)).map((r) => r.date));
  const nuits = [];
  for (let d = arrivee; d < depart; d = addDays(d, 1)) {
    const jour = new Date(d + 'T00:00:00Z').getUTCDay();
    let prix = b.prix_nuit, type = 'Nuit';
    if (feries.has(d) && b.prix_ferie) { prix = b.prix_ferie; type = 'Nuit (férié)'; }
    else if ((jour === 5 || jour === 6) && b.prix_weekend) { prix = b.prix_weekend; type = 'Nuit (week-end)'; }
    nuits.push({ date: d, prix, type });
  }
  return nuits;
}

export async function soldeFolio(db, folioId) {
  const r = await first(db, `SELECT (SELECT COALESCE(SUM(montant),0) FROM folio_lignes WHERE folio_id = ? AND annule = 0) du,
    (SELECT COALESCE(SUM(montant),0) FROM paiements WHERE folio_id = ?) paye`, folioId, folioId);
  return { du: r.du, paye: r.paye, solde: r.du - r.paye };
}

/** Client existant ou création rapide (nom + téléphone) dans le même lot. */
export async function clientOuNouveau(ctx, body, stmts) {
  if (body.client_id) {
    if (!(await first(ctx.db, 'SELECT 1 FROM clients WHERE id = ?', body.client_id))) fail(400, 'Client introuvable.', 'VALIDATION');
    return body.client_id;
  }
  const c = valider(body, { client_nom: { t: 'str', req: true, max: 100, label: 'Nom du client' }, client_telephone: { t: 'str', max: 30, label: 'Téléphone' } });
  if (c.client_telephone) {
    const ex = await first(ctx.db, 'SELECT id FROM clients WHERE telephone = ? AND archive = 0', c.client_telephone);
    if (ex) return ex.id; // évite les doublons de fiche client
  }
  const id = uid();
  stmts.push(st(ctx.db, 'INSERT INTO clients(id, nom, telephone, cree_le) VALUES (?,?,?,?)', id, c.client_nom, c.client_telephone, nowIso()));
  return id;
}

const MSG_CONFLIT = 'Ce bungalow est déjà réservé pour au moins une nuit de cette période. Choisissez d’autres dates ou un autre bungalow.';
const estConflit = (e) => /UNIQUE/i.test(e.message) && /reservation_nuits/i.test(e.message);

route('GET', '/api/planning', async (ctx) => {
  exiger(ctx, 'hebergement', 'C');
  const du = /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.du || '') ? ctx.query.du : jourLocal();
  const n = Math.min(Math.max(Number(ctx.query.jours) || 14, 1), 62);
  const au = addDays(du, n);
  const bungalows = await all(ctx.db, 'SELECT id, nom, type, capacite, etat, prix_nuit FROM bungalows WHERE archive = 0 ORDER BY nom');
  const resas = await all(ctx.db, `SELECT r.id, r.numero, r.bungalow_id, r.arrivee, r.depart, r.statut, r.adultes, r.enfants, c.nom client, c.telephone
    FROM reservations r JOIN clients c ON c.id = r.client_id WHERE r.statut IN ('reservee','en_cours') AND r.arrivee < ? AND r.depart > ? ORDER BY r.arrivee`, au, du);
  return { du, au, jours: n, aujourdhui: jourLocal(), bungalows, reservations: resas };
});

route('GET', '/api/disponibilites', async (ctx) => {
  exiger(ctx, 'hebergement', 'C');
  const { arrivee, depart } = valider(ctx.query, { arrivee: { t: 'date', req: true }, depart: { t: 'date', req: true } });
  if (depart <= arrivee) fail(400, 'La date de départ doit être après la date d’arrivée.', 'VALIDATION');
  const bs = await all(ctx.db, `SELECT * FROM bungalows b WHERE archive = 0 AND etat <> 'hors_service'
    AND NOT EXISTS (SELECT 1 FROM reservation_nuits n WHERE n.bungalow_id = b.id AND n.date >= ? AND n.date < ?) ORDER BY nom`, arrivee, depart);
  for (const b of bs) { const n = await tarifNuits(ctx, b, arrivee, depart); b.total = n.reduce((s, x) => s + x.prix, 0); b.nuits = n.length; }
  return bs;
});

route('GET', '/api/reservations', async (ctx) => {
  exiger(ctx, 'hebergement', 'C');
  const w = ['1=1']; const p = [];
  if (ctx.query.statut) { w.push('r.statut = ?'); p.push(ctx.query.statut); }
  if (ctx.query.du) { w.push('r.depart >= ?'); p.push(ctx.query.du); }
  if (ctx.query.au) { w.push('r.arrivee <= ?'); p.push(ctx.query.au); }
  if (ctx.query.q) { w.push('(c.nom LIKE ? OR c.telephone LIKE ? OR r.numero LIKE ?)'); p.push(...Array(3).fill(`%${ctx.query.q}%`)); }
  return all(ctx.db, `SELECT r.*, b.nom bungalow, c.nom client, c.telephone, f.numero folio_numero FROM reservations r JOIN bungalows b ON b.id = r.bungalow_id
    JOIN clients c ON c.id = r.client_id LEFT JOIN folios f ON f.id = r.folio_id WHERE ${w.join(' AND ')} ORDER BY r.arrivee DESC LIMIT 500`, ...p);
});
route('GET', '/api/reservations/:id', async (ctx) => {
  exiger(ctx, 'hebergement', 'C');
  const r = await first(ctx.db, `SELECT r.*, b.nom bungalow, c.nom client, c.telephone, c.email FROM reservations r JOIN bungalows b ON b.id = r.bungalow_id JOIN clients c ON c.id = r.client_id WHERE r.id = ?`, ctx.params.id);
  if (!r) fail(404, 'Réservation introuvable.', 'INTROUVABLE');
  return r;
});

route('POST', '/api/reservations', async (ctx) => {
  exiger(ctx, 'hebergement', 'S');
  const d = valider(ctx.body, {
    bungalow_id: { t: 'id', req: true, label: 'Bungalow' }, arrivee: { t: 'date', req: true, label: 'Arrivée' }, depart: { t: 'date', req: true, label: 'Départ' },
    adultes: { t: 'int', def: 1, min: 1, max: 50 }, enfants: { t: 'int', def: 0, min: 0, max: 50 }, notes: { t: 'str', max: 500 },
  });
  if (d.depart <= d.arrivee) fail(400, 'La date de départ doit être après la date d’arrivée.', 'VALIDATION');
  if (daysBetween(d.arrivee, d.depart) > 90) fail(400, 'Séjour limité à 90 nuits par réservation.', 'VALIDATION');
  if (d.arrivee < addDays(jourLocal(), -1)) fail(400, 'La date d’arrivée est déjà passée.', 'VALIDATION');
  const b = await first(ctx.db, 'SELECT * FROM bungalows WHERE id = ? AND archive = 0', d.bungalow_id);
  if (!b) fail(400, 'Bungalow introuvable.', 'VALIDATION');
  if (b.etat === 'hors_service') fail(409, 'Ce bungalow est hors service.', 'INDISPONIBLE');
  if (d.adultes + d.enfants > b.capacite) fail(400, `Capacité dépassée : ${b.nom} accueille ${b.capacite} personnes maximum.`, 'VALIDATION');
  const stmts = [];
  const clientId = await clientOuNouveau(ctx, ctx.body, stmts);
  const pai = lirePaiements(ctx.body.acompte ? [ctx.body.acompte] : []);
  const sess = pai.length ? await sessionOuverte(ctx, ctx.body.caisse_id || 'CAI-BUNG') : null;
  const id = uid(); const folioId = uid(); const nuits = await tarifNuits(ctx, b, d.arrivee, d.depart);
  const cl = await first(ctx.db, 'SELECT nom FROM clients WHERE id = ?', clientId);
  stmts.push(
    st(ctx.db, 'INSERT INTO folios(id, client_id, libelle, cree_le) VALUES (?,?,?,?)', folioId, clientId, `${b.nom} – ${cl?.nom || ctx.body.client_nom}`, nowIso()),
    ...numeroter(ctx.db, 'FOL', 'folios', folioId),
    st(ctx.db, 'INSERT INTO reservations(id, bungalow_id, client_id, arrivee, depart, adultes, enfants, folio_id, notes, cree_par, cree_le) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      id, b.id, clientId, d.arrivee, d.depart, d.adultes, d.enfants, folioId, d.notes, ctx.user.id, nowIso()),
    ...numeroter(ctx.db, 'RES', 'reservations', id),
    ...nuits.map((n) => st(ctx.db, 'INSERT INTO reservation_nuits(bungalow_id, date, reservation_id) VALUES (?,?,?)', b.id, n.date, id)),
    ...pai.map((p) => st(ctx.db, "INSERT INTO paiements(id, quand, jour, session_caisse_id, activite_id, folio_id, mode, montant, reference, nature, utilisateur_id) VALUES (?,?,?,?,?,?,?,?,?,'acompte',?)",
      uid(), nowIso(), jourLocal(), sess.id, 'BUNG', folioId, p.mode, p.montant, p.reference, ctx.user.id)),
    audit(ctx, 'creation_reservation', 'reservation', id, null, { ...d, client: clientId, total_prevu: nuits.reduce((s, n) => s + n.prix, 0), acompte: pai[0]?.montant || 0 }),
  );
  try { await batch(ctx, stmts); } catch (e) { if (estConflit(e)) fail(409, MSG_CONFLIT, 'DOUBLE_RESERVATION'); throw e; }
  return { id, folio_id: folioId, total_prevu: nuits.reduce((s, n) => s + n.prix, 0) };
});

async function chargerResa(ctx, id) {
  const r = await first(ctx.db, 'SELECT r.*, b.nom bungalow_nom FROM reservations r JOIN bungalows b ON b.id = r.bungalow_id WHERE r.id = ?', id);
  if (!r) fail(404, 'Réservation introuvable.', 'INTROUVABLE');
  return r;
}
const lignesNuits = (ctx, r, b, nuits) => nuits.flatMap((n) => {
  const q = nowIso();
  return [
    st(ctx.db, "INSERT INTO folio_lignes(id, folio_id, jour, activite_id, libelle, quantite, prix_unitaire, montant, source_type, source_id, cree_le) VALUES (?,?,?,'BUNG',?,1,?,?,'nuitee',?,?)",
      uid(), r.folio_id, n.date, `${n.type} du ${n.date.split('-').reverse().join('/')} – ${b.nom}`, n.prix, n.prix, r.id, q),
    st(ctx.db, "INSERT INTO ventes_lignes(id, quand, jour, activite_id, libelle, quantite, prix_unitaire, montant, cout, folio_id, source, utilisateur_id) VALUES (?,?,?,'BUNG',?,1,?,?,0,?,'nuitee',?)",
      uid(), q, n.date, `${n.type} – ${b.nom}`, n.prix, n.prix, r.folio_id, ctx.user.id),
  ];
});

route('POST', '/api/reservations/:id/checkin', async (ctx) => {
  exiger(ctx, 'hebergement', 'S');
  const r = await chargerResa(ctx, ctx.params.id);
  if (r.statut !== 'reservee') fail(409, 'Check-in impossible : la réservation n’est pas en attente d’arrivée.', 'STATUT');
  if (r.arrivee > jourLocal()) fail(409, `Arrivée prévue le ${r.arrivee.split('-').reverse().join('/')} : check-in anticipé impossible. Modifiez d’abord les dates.`, 'STATUT');
  const b = await first(ctx.db, 'SELECT * FROM bungalows WHERE id = ?', r.bungalow_id);
  if (b.etat !== 'propre') fail(409, `Le bungalow est en état « ${b.etat} ». Il doit être propre avant l’arrivée (menu Ménage).`, 'BUNGALOW_PAS_PRET');
  const nuits = await tarifNuits(ctx, b, r.arrivee, r.depart);
  await batch(ctx, [
    verrou(ctx, 'checkin-' + r.id),
    st(ctx.db, "UPDATE reservations SET statut = 'en_cours', version = version + 1 WHERE id = ?", r.id),
    ...lignesNuits(ctx, r, b, nuits),
    audit(ctx, 'check_in', 'reservation', r.id, { statut: 'reservee' }, { statut: 'en_cours' }),
  ]);
  return { ok: true };
});

route('POST', '/api/reservations/:id/prolonger', async (ctx) => {
  exiger(ctx, 'hebergement', 'S');
  const r = await chargerResa(ctx, ctx.params.id);
  if (!['reservee', 'en_cours'].includes(r.statut)) fail(409, 'Réservation non modifiable.', 'STATUT');
  const { depart } = valider(ctx.body, { depart: { t: 'date', req: true, label: 'Nouveau départ' } });
  if (depart <= r.depart) fail(400, 'Pour une prolongation, la nouvelle date doit être après le départ actuel.', 'VALIDATION');
  const b = await first(ctx.db, 'SELECT * FROM bungalows WHERE id = ?', r.bungalow_id);
  const nuits = await tarifNuits(ctx, b, r.depart, depart);
  const s = [
    st(ctx.db, 'UPDATE reservations SET depart = ?, version = version + 1 WHERE id = ?', depart, r.id),
    ...nuits.map((n) => st(ctx.db, 'INSERT INTO reservation_nuits(bungalow_id, date, reservation_id) VALUES (?,?,?)', b.id, n.date, r.id)),
    ...(r.statut === 'en_cours' ? lignesNuits(ctx, r, b, nuits) : []),
    audit(ctx, 'prolongation', 'reservation', r.id, { depart: r.depart }, { depart }),
  ];
  try { await batch(ctx, s); } catch (e) { if (estConflit(e)) fail(409, MSG_CONFLIT, 'DOUBLE_RESERVATION'); throw e; }
  return { ok: true, supplement: nuits.reduce((t, n) => t + n.prix, 0) };
});

// Modification des dates / du bungalow avant l'arrivée.
route('PUT', '/api/reservations/:id', async (ctx) => {
  exiger(ctx, 'hebergement', 'S');
  const r = await chargerResa(ctx, ctx.params.id);
  if (r.statut !== 'reservee') fail(409, 'Seule une réservation pas encore commencée peut être modifiée. Utilisez « Prolonger » pour un séjour en cours.', 'STATUT');
  const d = valider(ctx.body, { bungalow_id: { t: 'id', req: true }, arrivee: { t: 'date', req: true }, depart: { t: 'date', req: true },
    adultes: { t: 'int', def: r.adultes, min: 1 }, enfants: { t: 'int', def: r.enfants, min: 0 }, notes: { t: 'str', max: 500 }, version: { t: 'int', req: true } });
  if (d.depart <= d.arrivee) fail(400, 'La date de départ doit être après la date d’arrivée.', 'VALIDATION');
  const b = await first(ctx.db, 'SELECT * FROM bungalows WHERE id = ? AND archive = 0', d.bungalow_id);
  if (!b) fail(400, 'Bungalow introuvable.', 'VALIDATION');
  if (d.adultes + d.enfants > b.capacite) fail(400, `Capacité dépassée (${b.capacite} max).`, 'VALIDATION');
  const nuits = await tarifNuits(ctx, b, d.arrivee, d.depart);
  const s = [
    st(ctx.db, 'UPDATE reservations SET bungalow_id = ?, arrivee = ?, depart = ?, adultes = ?, enfants = ?, notes = ?, version = version + 1 WHERE id = ? AND version = ?',
      b.id, d.arrivee, d.depart, d.adultes, d.enfants, d.notes, r.id, d.version),
    st(ctx.db, 'DELETE FROM reservation_nuits WHERE reservation_id = ?', r.id),
    ...nuits.map((n) => st(ctx.db, 'INSERT INTO reservation_nuits(bungalow_id, date, reservation_id) VALUES (?,?,?)', b.id, n.date, r.id)),
    audit(ctx, 'modification_reservation', 'reservation', r.id, { bungalow_id: r.bungalow_id, arrivee: r.arrivee, depart: r.depart }, d),
  ];
  let res;
  try { res = await batch(ctx, s); } catch (e) { if (estConflit(e)) fail(409, MSG_CONFLIT, 'DOUBLE_RESERVATION'); throw e; }
  if (!res[0].meta.changes) fail(409, 'La réservation a été modifiée entre-temps : rechargez la page.', 'VERSION');
  return { ok: true };
});

route('POST', '/api/reservations/:id/annuler', async (ctx) => {
  exiger(ctx, 'hebergement', 'S');
  const r = await chargerResa(ctx, ctx.params.id);
  if (r.statut !== 'reservee') fail(409, 'Seule une réservation pas encore commencée peut être annulée.', 'STATUT');
  const motif = String(ctx.body.motif || '').trim();
  if (motif.length < 3) fail(400, 'Indiquez le motif de l’annulation.', 'VALIDATION');
  const solde = await soldeFolio(ctx.db, r.folio_id);
  const s = [
    verrou(ctx, 'annuler-resa-' + r.id),
    st(ctx.db, "UPDATE reservations SET statut = 'annulee', notes = COALESCE(notes,'') || ? , version = version + 1 WHERE id = ?", `\nAnnulée : ${motif}`, r.id),
    st(ctx.db, 'DELETE FROM reservation_nuits WHERE reservation_id = ?', r.id),
  ];
  if (solde.paye > 0) {
    const choix = ctx.body.acompte;
    if (choix === 'rembourser') {
      exiger(ctx, 'hebergement', 'V');
      const sess = await sessionOuverte(ctx, ctx.body.caisse_id || 'CAI-BUNG');
      const modes = await all(ctx.db, 'SELECT mode, SUM(montant) m FROM paiements WHERE folio_id = ? GROUP BY mode HAVING SUM(montant) > 0', r.folio_id);
      for (const m of modes) s.push(st(ctx.db, "INSERT INTO paiements(id, quand, jour, session_caisse_id, activite_id, folio_id, mode, montant, nature, utilisateur_id) VALUES (?,?,?,?,'BUNG',?,?,?,'remboursement',?)",
        uid(), nowIso(), jourLocal(), sess.id, r.folio_id, m.mode, -m.m, ctx.user.id));
    } else if (choix === 'conserver') {
      const q = nowIso();
      s.push(st(ctx.db, "INSERT INTO folio_lignes(id, folio_id, jour, activite_id, libelle, quantite, prix_unitaire, montant, source_type, source_id, cree_le) VALUES (?,?,?,'BUNG','Frais d''annulation',1,?,?,'annulation',?,?)",
        uid(), r.folio_id, jourLocal(), solde.paye, solde.paye, r.id, q));
      s.push(st(ctx.db, "INSERT INTO ventes_lignes(id, quand, jour, activite_id, libelle, quantite, prix_unitaire, montant, cout, folio_id, source, utilisateur_id) VALUES (?,?,?,'BUNG','Frais d''annulation',1,?,?,0,?,'annulation',?)",
        uid(), q, jourLocal(), solde.paye, solde.paye, r.folio_id, ctx.user.id));
    } else fail(400, `Un acompte de ${solde.paye.toLocaleString('fr-FR')} Ar a été versé : choisissez « rembourser » ou « conserver ».`, 'ACOMPTE');
  }
  s.push(st(ctx.db, "UPDATE folios SET statut = 'annule', clos_le = ? WHERE id = ?", nowIso(), r.folio_id));
  s.push(audit(ctx, 'annulation_reservation', 'reservation', r.id, { statut: r.statut }, { statut: 'annulee', motif, acompte: ctx.body.acompte || null }));
  await batch(ctx, s);
  return { ok: true };
});

route('POST', '/api/reservations/:id/checkout', async (ctx) => {
  exiger(ctx, 'hebergement', 'S');
  const r = await chargerResa(ctx, ctx.params.id);
  if (r.statut !== 'en_cours') fail(409, 'Check-out impossible : le client n’est pas enregistré comme présent.', 'STATUT');
  const auj = jourLocal();
  const s = [verrou(ctx, 'checkout-' + r.id)];
  let credit = 0;
  if (auj < r.depart) { // départ anticipé : on libère et on crédite les nuits non consommées
    const libres = await all(ctx.db, "SELECT id, jour, montant, libelle FROM folio_lignes WHERE folio_id = ? AND source_type = 'nuitee' AND source_id = ? AND jour >= ? AND annule = 0", r.folio_id, r.id, auj);
    const depart = auj > r.arrivee ? auj : addDays(r.arrivee, 1);
    for (const l of libres.filter((x) => x.jour >= depart)) {
      credit += l.montant;
      s.push(st(ctx.db, 'UPDATE folio_lignes SET annule = 1 WHERE id = ?', l.id));
      s.push(st(ctx.db, "INSERT INTO ventes_lignes(id, quand, jour, activite_id, libelle, quantite, prix_unitaire, montant, cout, folio_id, source, utilisateur_id) VALUES (?,?,?,'BUNG',?,-1,?,?,0,?,'annulation',?)",
        uid(), nowIso(), l.jour, 'Nuit non consommée', l.montant, -l.montant, r.folio_id, ctx.user.id));
    }
    s.push(st(ctx.db, 'DELETE FROM reservation_nuits WHERE reservation_id = ? AND date >= ?', r.id, depart));
    s.push(st(ctx.db, 'UPDATE reservations SET depart = ? WHERE id = ?', depart, r.id));
  }
  const solde = await soldeFolio(ctx.db, r.folio_id);
  const reste = solde.solde - credit;
  if (reste > 0) fail(409, `Le client doit encore ${reste.toLocaleString('fr-FR')} Ar. Encaissez le solde avant le départ.`, 'SOLDE_DU');
  if (reste < 0 && !ctx.body.trop_percu_ok) fail(409, `Trop-perçu de ${(-reste).toLocaleString('fr-FR')} Ar : remboursez le client depuis le compte séjour avant le départ.`, 'TROP_PERCU');
  s.push(
    st(ctx.db, "UPDATE reservations SET statut = 'terminee', version = version + 1 WHERE id = ?", r.id),
    st(ctx.db, "UPDATE bungalows SET etat = 'nettoyage', version = version + 1 WHERE id = ?", r.bungalow_id),
    st(ctx.db, "UPDATE folios SET statut = 'clos', clos_le = ? WHERE id = ?", nowIso(), r.folio_id),
    ...numeroterFacture(ctx, r.folio_id),
    audit(ctx, 'check_out', 'reservation', r.id, { statut: 'en_cours' }, { statut: 'terminee', credit }),
  );
  await batch(ctx, s);
  return { ok: true, folio_id: r.folio_id };
});

function numeroterFacture(ctx, folioId) {
  const cle = `FAC-${jourLocal().slice(0, 4)}`;
  return [
    st(ctx.db, 'INSERT OR IGNORE INTO sequences(cle, val) VALUES (?, 0)', cle),
    st(ctx.db, 'UPDATE sequences SET val = val + 1 WHERE cle = ?', cle),
    st(ctx.db, "UPDATE folios SET facture_numero = (SELECT printf('%s-%05d', cle, val) FROM sequences WHERE cle = ?) WHERE id = ?", cle, folioId),
  ];
}

// ── Comptes séjour / clients (folios) ──
route('GET', '/api/folios', async (ctx) => {
  exiger(ctx, 'hebergement', 'C');
  const statut = ['ouvert', 'clos', 'annule'].includes(ctx.query.statut) ? ctx.query.statut : 'ouvert';
  return all(ctx.db, `SELECT f.*, c.nom client, c.telephone,
      (SELECT COALESCE(SUM(montant),0) FROM folio_lignes l WHERE l.folio_id = f.id AND l.annule = 0) du,
      (SELECT COALESCE(SUM(montant),0) FROM paiements p WHERE p.folio_id = f.id) paye
    FROM folios f LEFT JOIN clients c ON c.id = f.client_id WHERE f.statut = ? ORDER BY f.cree_le DESC LIMIT 300`, statut);
});
route('POST', '/api/folios', async (ctx) => {
  exiger(ctx, 'hebergement', 'S');
  const s = [];
  const clientId = await clientOuNouveau(ctx, ctx.body, s);
  const id = uid();
  const lib = String(ctx.body.libelle || 'Compte client').slice(0, 80);
  s.push(st(ctx.db, 'INSERT INTO folios(id, client_id, libelle, cree_le) VALUES (?,?,?,?)', id, clientId, lib, nowIso()), ...numeroter(ctx.db, 'FOL', 'folios', id), audit(ctx, 'ouverture_compte', 'folio', id));
  await batch(ctx, s);
  return { id };
});
route('GET', '/api/folios/:id', async (ctx) => {
  if (!peut(ctx.user, 'hebergement', 'C') && !peut(ctx.user, 'ventes', 'C')) exiger(ctx, 'hebergement', 'C');
  const f = await first(ctx.db, `SELECT f.*, c.nom client, c.telephone, c.email, c.adresse, c.nif client_nif, c.entreprise FROM folios f LEFT JOIN clients c ON c.id = f.client_id WHERE f.id = ?`, ctx.params.id);
  if (!f) fail(404, 'Compte introuvable.', 'INTROUVABLE');
  f.lignes = await all(ctx.db, 'SELECT l.*, a.nom activite_nom FROM folio_lignes l LEFT JOIN activites a ON a.id = l.activite_id WHERE folio_id = ? ORDER BY jour, cree_le', f.id);
  f.paiements = await all(ctx.db, 'SELECT p.*, u.nom par FROM paiements p LEFT JOIN utilisateurs u ON u.id = p.utilisateur_id WHERE folio_id = ? ORDER BY quand', f.id);
  f.reservation = await first(ctx.db, 'SELECT r.*, b.nom bungalow FROM reservations r JOIN bungalows b ON b.id = r.bungalow_id WHERE r.folio_id = ?', f.id);
  Object.assign(f, await soldeFolio(ctx.db, f.id));
  f.parametres = await lireParametres(ctx.db);
  return f;
});
route('POST', '/api/folios/:id/paiements', async (ctx) => {
  exiger(ctx, 'hebergement', 'S');
  const f = await first(ctx.db, 'SELECT * FROM folios WHERE id = ?', ctx.params.id);
  if (!f) fail(404, 'Compte introuvable.', 'INTROUVABLE');
  if (f.statut !== 'ouvert') fail(409, 'Ce compte est clôturé.', 'FOLIO_CLOS');
  const remb = ctx.body.nature === 'remboursement';
  if (remb) exiger(ctx, 'hebergement', 'V');
  const [p] = lirePaiements([ctx.body]);
  if (!p) fail(400, 'Montant invalide.', 'VALIDATION');
  const solde = await soldeFolio(ctx.db, f.id);
  if (remb && p.montant > -solde.solde) fail(400, 'Le remboursement dépasse le trop-perçu.', 'VALIDATION');
  const caisseId = ctx.body.caisse_id || 'CAI-BUNG';
  const sess = await sessionOuverte(ctx, caisseId);
  const nature = remb ? 'remboursement' : solde.du > 0 ? 'reglement' : 'acompte';
  await batch(ctx, [
    st(ctx.db, 'INSERT INTO paiements(id, quand, jour, session_caisse_id, activite_id, folio_id, mode, montant, reference, nature, utilisateur_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      uid(), nowIso(), jourLocal(), sess.id, sess.activite_id, f.id, p.mode, remb ? -p.montant : p.montant, p.reference, nature, ctx.user.id),
    audit(ctx, remb ? 'remboursement_folio' : 'paiement_folio', 'folio', f.id, null, { ...p, nature }),
  ]);
  return soldeFolio(ctx.db, f.id);
});
route('POST', '/api/folios/:id/cloturer', async (ctx) => {
  exiger(ctx, 'hebergement', 'S');
  const f = await first(ctx.db, 'SELECT * FROM folios WHERE id = ?', ctx.params.id);
  if (!f || f.statut !== 'ouvert') fail(409, 'Compte non clôturable.', 'FOLIO_CLOS');
  if (await first(ctx.db, "SELECT 1 FROM reservations WHERE folio_id = ? AND statut IN ('reservee','en_cours')", f.id)) fail(409, 'Ce compte est lié à un séjour : faites le check-out.', 'STATUT');
  const solde = await soldeFolio(ctx.db, f.id);
  if (solde.solde !== 0) fail(409, `Solde non nul (${solde.solde.toLocaleString('fr-FR')} Ar) : réglez ou remboursez d’abord.`, 'SOLDE_DU');
  await batch(ctx, [verrou(ctx, 'cloture-folio-' + f.id), st(ctx.db, "UPDATE folios SET statut = 'clos', clos_le = ? WHERE id = ?", nowIso(), f.id), ...numeroterFacture(ctx, f.id), audit(ctx, 'cloture_compte', 'folio', f.id)]);
  return { ok: true };
});

// ── Ménage / état des bungalows ──
route('PUT', '/api/bungalows/:id/etat', async (ctx) => {
  const { etat } = valider(ctx.body, { etat: { t: 'enum', req: true, vals: ['propre', 'nettoyage', 'maintenance', 'hors_service'] } });
  exiger(ctx, 'hebergement', 'S');
  const b = await first(ctx.db, 'SELECT etat FROM bungalows WHERE id = ?', ctx.params.id);
  if (!b) fail(404, 'Bungalow introuvable.', 'INTROUVABLE');
  await batch(ctx, [st(ctx.db, 'UPDATE bungalows SET etat = ?, version = version + 1 WHERE id = ?', etat, ctx.params.id), audit(ctx, 'etat_bungalow', 'bungalow', ctx.params.id, { etat: b.etat }, { etat, note: ctx.body.note || null })]);
  return { ok: true };
});
