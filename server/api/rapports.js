// Tableau de bord et rapports : chiffres calculés par le serveur à partir des opérations réelles.
import { route } from '../router.js';
import { all, first, jourLocal, addDays, daysBetween, fail, lireParametres } from '../lib/core.js';
import { exiger, peut, activitesUser } from '../lib/auth.js';

function periode(ctx) {
  const auj = jourLocal();
  let du = ctx.query.du, au = ctx.query.au;
  const p = ctx.query.periode;
  if (p === 'jour' || (!du && !p)) { du = au = auj; }
  else if (p === 'hier') { du = au = addDays(auj, -1); }
  else if (p === 'semaine') { const j = (new Date(auj + 'T00:00:00Z').getUTCDay() + 6) % 7; du = addDays(auj, -j); au = auj; }
  else if (p === 'mois') { du = auj.slice(0, 8) + '01'; au = auj; }
  else if (p === 'annee') { du = auj.slice(0, 5) + '01-01'; au = auj; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(du || '') || !/^\d{4}-\d{2}-\d{2}$/.test(au || '')) fail(400, 'Période invalide.', 'VALIDATION');
  if (au < du) [du, au] = [au, du];
  if (daysBetween(du, au) > 731) fail(400, 'Période limitée à 2 ans.', 'VALIDATION');
  return { du, au };
}
function filtreActivite(ctx, col = 'activite_id') {
  const acts = activitesUser(ctx.user);
  const choisie = ctx.query.activite;
  if (choisie) { if (acts && !acts.includes(choisie)) fail(403, 'Activité non autorisée.', 'INTERDIT'); return { sql: ` AND ${col} = ?`, p: [choisie] }; }
  if (acts) return { sql: ` AND ${col} IN (${acts.map(() => '?').join(',')})`, p: acts };
  return { sql: '', p: [] };
}

route('GET', '/api/tableau', async (ctx) => {
  exiger(ctx, 'tableau', 'C');
  const { du, au } = periode(ctx);
  const f = filtreActivite(ctx);
  const finance = peut(ctx.user, 'rapports', 'C');
  const auj = jourLocal();
  const out = { du, au, aujourdhui: auj, finance };

  // Hébergement (toujours utile à l'accueil)
  if (peut(ctx.user, 'hebergement', 'C')) {
    const nb = (await first(ctx.db, 'SELECT COUNT(*) n FROM bungalows WHERE archive = 0 AND etat <> ?', 'hors_service')).n;
    const nuits = (await first(ctx.db, `SELECT COUNT(*) n FROM reservation_nuits n JOIN reservations r ON r.id = n.reservation_id WHERE n.date BETWEEN ? AND ?`, du, au)).n;
    const jours = daysBetween(du, au) + 1;
    out.hebergement = {
      bungalows: nb, nuits_vendues: nuits, taux_occupation: nb ? Math.round((nuits / (nb * jours)) * 1000) / 10 : 0,
      occupes_aujourdhui: (await first(ctx.db, "SELECT COUNT(*) n FROM reservations WHERE statut = 'en_cours'")).n,
      arrivees: await all(ctx.db, "SELECT r.id, r.numero, b.nom bungalow, c.nom client FROM reservations r JOIN bungalows b ON b.id = r.bungalow_id JOIN clients c ON c.id = r.client_id WHERE r.statut = 'reservee' AND r.arrivee <= ? ORDER BY r.arrivee", auj),
      departs: await all(ctx.db, "SELECT r.id, r.numero, b.nom bungalow, c.nom client FROM reservations r JOIN bungalows b ON b.id = r.bungalow_id JOIN clients c ON c.id = r.client_id WHERE r.statut = 'en_cours' AND r.depart <= ?", auj),
      a_nettoyer: (await first(ctx.db, "SELECT COUNT(*) n FROM bungalows WHERE etat = 'nettoyage' AND archive = 0")).n,
    };
  }
  if (peut(ctx.user, 'ventes', 'C') || peut(ctx.user, 'cuisine', 'C')) {
    out.operations = {
      commandes_ouvertes: (await first(ctx.db, `SELECT COUNT(*) n FROM commandes WHERE statut = 'ouverte'${f.sql}`, ...f.p)).n,
      en_cuisine: (await first(ctx.db, `SELECT COUNT(*) n FROM commande_lignes l JOIN commandes c ON c.id = l.commande_id WHERE l.statut_cuisine IN ('en_attente','en_preparation')${f.sql.replace('activite_id', 'c.activite_id')}`, ...f.p)).n,
    };
  }
  if (peut(ctx.user, 'bienetre', 'C')) out.rdv_aujourdhui = (await first(ctx.db, "SELECT COUNT(*) n FROM rendez_vous WHERE date = ? AND statut = 'prevu'", auj)).n;
  if (peut(ctx.user, 'reception', 'C')) out.evenements = await all(ctx.db, "SELECT e.numero, e.date, e.type, e.heure_debut, e.heure_fin, s.nom salle FROM evenements e JOIN salles s ON s.id = e.salle_id WHERE e.statut = 'confirme' AND e.date BETWEEN ? AND ? ORDER BY e.date LIMIT 10", auj, addDays(auj, 14));
  if (peut(ctx.user, 'stocks', 'C')) out.alertes_stock = (await first(ctx.db, 'SELECT COUNT(*) n FROM stocks s JOIN articles a ON a.id = s.article_id WHERE a.archive = 0 AND s.quantite <= a.seuil_alerte AND (a.seuil_alerte > 0 OR s.quantite < 0)')).n;
  if (peut(ctx.user, 'caisses', 'C')) out.caisses_ouvertes = await all(ctx.db, `SELECT c.nom, s.ouvert_le, u.nom par FROM sessions_caisse s JOIN caisses c ON c.id = s.caisse_id JOIN utilisateurs u ON u.id = s.ouvert_par WHERE s.statut = 'ouverte'${f.sql.replace('activite_id', 'c.activite_id')}`, ...f.p);

  if (finance) Object.assign(out, await syntheseFinanciere(ctx, du, au, f));
  return out;
});

async function syntheseFinanciere(ctx, du, au, f) {
  const params = await lireParametres(ctx.db);
  const acts = await all(ctx.db, 'SELECT id, nom, couleur FROM activites WHERE actif = 1 ORDER BY ordre');
  const ventes = await all(ctx.db, `SELECT activite_id, SUM(montant) ca, SUM(cout) cout FROM ventes_lignes WHERE jour BETWEEN ? AND ?${f.sql} GROUP BY activite_id`, du, au, ...f.p);
  const dep = await all(ctx.db, `SELECT activite_id, SUM(montant) m FROM depenses WHERE statut = 'validee' AND jour BETWEEN ? AND ? GROUP BY activite_id`, du, au);
  const communes = dep.find((d) => d.activite_id === null)?.m || 0;
  const caTotalGlobal = ventes.reduce((s, v) => s + v.ca, 0);
  const caGlobalToutes = f.p.length ? (await first(ctx.db, 'SELECT COALESCE(SUM(montant),0) ca FROM ventes_lignes WHERE jour BETWEEN ? AND ?', du, au)).ca : caTotalGlobal;
  const parActivite = acts.map((a) => {
    const v = ventes.find((x) => x.activite_id === a.id) || { ca: 0, cout: 0 };
    const directes = dep.find((d) => d.activite_id === a.id)?.m || 0;
    // Répartition des charges communes au prorata du chiffre d'affaires (paramétrable)
    const quote = params.repartition_charges === 'aucune' || !caGlobalToutes ? 0 : Math.round(communes * (v.ca / caGlobalToutes));
    const marge = v.ca - v.cout;
    return { id: a.id, nom: a.nom, couleur: a.couleur, ca: v.ca, cout: v.cout, marge, taux_marge: v.ca ? Math.round((marge / v.ca) * 1000) / 10 : 0, depenses: directes, charges_communes: quote, resultat: marge - directes - quote };
  }).filter((a) => !f.p.length || f.p.includes(a.id));
  const totaux = parActivite.reduce((t, a) => { for (const k of ['ca', 'cout', 'marge', 'depenses', 'charges_communes', 'resultat']) t[k] = (t[k] || 0) + a[k]; return t; }, {});
  if (!f.p.length && params.repartition_charges === 'aucune') { totaux.charges_communes = communes; totaux.resultat -= communes; }
  const encaissements = await all(ctx.db, `SELECT mode, SUM(montant) total FROM paiements WHERE jour BETWEEN ? AND ?${f.sql} GROUP BY mode ORDER BY total DESC`, du, au, ...f.p);
  const serie = await all(ctx.db, `SELECT jour, SUM(montant) ca FROM ventes_lignes WHERE jour BETWEEN ? AND ?${f.sql} GROUP BY jour ORDER BY jour`, du, au, ...f.p);
  const top = await all(ctx.db, `SELECT MAX(libelle) libelle, SUM(quantite) qte, SUM(montant) ca FROM ventes_lignes WHERE jour BETWEEN ? AND ? AND produit_id IS NOT NULL${f.sql} GROUP BY produit_id ORDER BY ca DESC LIMIT 8`, du, au, ...f.p);
  const impayes = await first(ctx.db, `SELECT COUNT(*) n, COALESCE(SUM(s),0) total FROM (SELECT (SELECT COALESCE(SUM(montant),0) FROM folio_lignes WHERE folio_id = f.id AND annule = 0) - (SELECT COALESCE(SUM(montant),0) FROM paiements WHERE folio_id = f.id) s FROM folios f WHERE f.statut = 'ouvert') x WHERE s > 0`);
  const ecarts = await first(ctx.db, "SELECT COALESCE(SUM(ecart),0) total, COUNT(*) n FROM sessions_caisse WHERE jour BETWEEN ? AND ? AND ecart <> 0", du, au);
  return { par_activite: parActivite, totaux, charges_communes: communes, encaissements, serie, top_produits: top, impayes, ecarts_caisse: ecarts };
}

const GROUPES = {
  produit: ['libelle', 'libelle'], jour: ['jour', 'jour'], activite: ['a.nom', 'activite'], employe: ["COALESCE(u.nom,'—')", 'employe'],
};
route('GET', '/api/rapports/ventes', async (ctx) => {
  exiger(ctx, 'rapports', 'C');
  const { du, au } = periode(ctx);
  const f = filtreActivite(ctx, 'v.activite_id');
  const g = GROUPES[ctx.query.groupe] || GROUPES.produit;
  const rows = await all(ctx.db, `SELECT ${g[0]} cle, SUM(v.quantite) quantite, SUM(v.montant) ca, SUM(v.cout) cout, SUM(v.montant) - SUM(v.cout) marge
    FROM ventes_lignes v LEFT JOIN activites a ON a.id = v.activite_id LEFT JOIN utilisateurs u ON u.id = v.utilisateur_id
    WHERE v.jour BETWEEN ? AND ?${f.sql} GROUP BY ${g[0]} ORDER BY ${ctx.query.groupe === 'jour' ? 'cle' : 'ca DESC'} LIMIT 2000`, du, au, ...f.p);
  return sortie(ctx, rows, [[g[1], 'cle'], ['Quantité', 'quantite'], ['CA (Ar)', 'ca'], ['Coût (Ar)', 'cout'], ['Marge (Ar)', 'marge']], `ventes-${du}-${au}`);
});
route('GET', '/api/rapports/paiements', async (ctx) => {
  exiger(ctx, 'rapports', 'C');
  const { du, au } = periode(ctx);
  const f = filtreActivite(ctx, 'p.activite_id');
  const rows = await all(ctx.db, `SELECT p.jour, p.mode, p.nature, p.montant, p.reference, a.nom activite, u.nom par, d.numero document, fo.numero folio FROM paiements p
    LEFT JOIN activites a ON a.id = p.activite_id LEFT JOIN utilisateurs u ON u.id = p.utilisateur_id LEFT JOIN documents d ON d.id = p.document_id LEFT JOIN folios fo ON fo.id = p.folio_id
    WHERE p.jour BETWEEN ? AND ?${f.sql} ORDER BY p.quand DESC LIMIT 5000`, du, au, ...f.p);
  return sortie(ctx, rows, [['Date', 'jour'], ['Activité', 'activite'], ['Mode', 'mode'], ['Nature', 'nature'], ['Montant', 'montant'], ['Référence', 'reference'], ['Pièce', 'document'], ['Compte', 'folio'], ['Par', 'par']], `paiements-${du}-${au}`);
});
route('GET', '/api/rapports/depenses', async (ctx) => {
  exiger(ctx, 'rapports', 'C');
  const { du, au } = periode(ctx);
  const rows = await all(ctx.db, `SELECT d.jour, d.numero, COALESCE(a.nom,'Charges communes') activite, d.categorie, d.libelle, d.montant, d.mode, d.statut FROM depenses d LEFT JOIN activites a ON a.id = d.activite_id
    WHERE d.jour BETWEEN ? AND ? ORDER BY d.jour`, du, au);
  return sortie(ctx, rows, [['Date', 'jour'], ['N°', 'numero'], ['Activité', 'activite'], ['Catégorie', 'categorie'], ['Libellé', 'libelle'], ['Montant', 'montant'], ['Mode', 'mode'], ['Statut', 'statut']], `depenses-${du}-${au}`);
});
route('GET', '/api/rapports/synthese', async (ctx) => {
  exiger(ctx, 'rapports', 'C');
  const { du, au } = periode(ctx);
  const s = await syntheseFinanciere(ctx, du, au, filtreActivite(ctx));
  return sortie(ctx, s.par_activite, [['Activité', 'nom'], ['CA', 'ca'], ['Coût matière', 'cout'], ['Marge brute', 'marge'], ['Taux de marge %', 'taux_marge'], ['Dépenses directes', 'depenses'], ['Quote-part charges communes', 'charges_communes'], ['Résultat estimé', 'resultat']], `synthese-${du}-${au}`, s);
});

function sortie(ctx, rows, cols, nom, extra = null) {
  if (ctx.query.format !== 'csv') return extra ? { ...extra, lignes: rows } : rows;
  exiger(ctx, 'rapports', 'E');
  const esc = (v) => { if (typeof v === 'number') return String(v).replace('.', ','); const s = v === null || v === undefined ? '' : String(v); return /[";\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s; };
  const csv = '﻿' + [cols.map((c) => c[0]).join(';'), ...rows.map((r) => cols.map((c) => esc(r[c[1]])).join(';'))].join('\r\n');
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${nom}.csv"` } });
}
