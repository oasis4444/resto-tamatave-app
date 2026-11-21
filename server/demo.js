// Données fictives pour l'environnement de DÉMONSTRATION uniquement (base séparée).
import { st, uid, nowIso, jourLocal, addDays, first } from './lib/core.js';
import { hacherMdp } from './lib/auth.js';

export const MDP_DEMO = 'Demo-2026';
const VIDER = ['rendez_vous', 'depenses', 'paiements', 'ventes_lignes', 'documents', 'commande_lignes', 'commandes', 'sessions_caisse', 'mouvements_stock', 'stocks',
  'recettes', 'produits', 'articles', 'categories', 'tables_resto', 'evenement_creneaux', 'evenements', 'salles', 'reservation_nuits', 'reservations', 'folio_lignes', 'folios',
  'jours_feries', 'bungalows', 'fournisseurs', 'clients', 'sequences', 'idempotence'];

export async function chargerDemo(db, reinitialiser = false) {
  if (!reinitialiser && (await first(db, 'SELECT 1 FROM bungalows LIMIT 1'))) return false;
  const s = [st(db, 'PRAGMA defer_foreign_keys = true')];
  if (reinitialiser) {
    for (const t of VIDER) s.push(st(db, `DELETE FROM ${t}`));
    s.push(st(db, "DELETE FROM sessions WHERE utilisateur_id IN (SELECT id FROM utilisateurs WHERE identifiant LIKE 'demo-%')"));
    s.push(st(db, "DELETE FROM utilisateurs WHERE identifiant LIKE 'demo-%'"));
  }
  const now = nowIso(); const auj = jourLocal();
  const ins = (table, obj) => { const c = Object.keys(obj); s.push(st(db, `INSERT INTO ${table}(${c.join(',')}) VALUES (${c.map(() => '?').join(',')})`, ...c.map((k) => obj[k]))); return obj.id; };

  // Comptes de test (un par rôle), mot de passe commun affiché sur l'écran de connexion de la démo
  const hash = await hacherMdp(MDP_DEMO);
  for (const [code, nom] of [['admin', 'Admin Démo'], ['gerant', 'Rakoto Gérant'], ['receptionniste', 'Voahangy Réception'], ['caissier', 'Hery Caisse'], ['serveur', 'Fidy Serveur'],
    ['cuisinier', 'Lalao Cuisine'], ['magasinier', 'Tojo Magasin'], ['resp_be', 'Mialy Bien-être'], ['comptable', 'Nirina Compta']]) {
    ins('utilisateurs', { id: uid(), identifiant: 'demo-' + code, nom, role_id: 'ROLE-' + code, mdp_hash: hash, doit_changer_mdp: 0, cree_le: now, activites: '*' });
  }

  const clients = ['Rasoa Hanitra', 'Jean Dupont', 'Société Ravinala SARL', 'Andry Rakotomalala', 'Marie Laurent', 'Fanja Randria'].map((nom, i) => ins('clients', {
    id: uid(), nom, telephone: '034 1' + String(1000000 + i * 1371).slice(0, 6), type: nom.includes('SARL') ? 'professionnel' : 'particulier', cree_le: now }));

  const bung = [['Bungalow Ravinala', 'Standard', 2, 80000], ['Bungalow Vanille', 'Standard', 2, 80000], ['Bungalow Girofle', 'Familial', 4, 120000],
    ['Bungalow Litchi', 'Familial', 4, 120000], ['Bungalow Océan', 'Vue mer', 2, 150000], ['Bungalow Corail', 'Vue mer', 3, 170000]].map(([nom, type, cap, prix]) =>
    ins('bungalows', { id: uid(), nom, type, capacite: cap, prix_nuit: prix, prix_weekend: Math.round(prix * 1.2), prix_ferie: Math.round(prix * 1.3), etat: 'propre', cree_le: now }));
  ins('jours_feries', { date: auj.slice(0, 4) + '-12-25', libelle: 'Noël' });
  ins('jours_feries', { date: auj.slice(0, 4) + '-06-26', libelle: 'Fête de l’Indépendance' });

  ins('salles', { id: uid(), nom: 'Grande salle Tamatave', capacite: 200, prix_heure: 60000, prix_demi: 250000, prix_jour: 450000, cree_le: now });
  ins('salles', { id: uid(), nom: 'Salle Séminaire', capacite: 40, prix_heure: 30000, prix_demi: 110000, prix_jour: 200000, cree_le: now });

  // Articles de stock
  const art = {};
  for (const [k, nom, unite, cout, seuil] of [['riz', 'Riz', 'kg', 3500, 20], ['poulet', 'Poulet', 'kg', 16000, 5], ['zebu', 'Viande de zébu', 'kg', 22000, 5], ['brede', 'Brèdes', 'botte', 800, 10],
    ['pain', 'Pain burger', 'pièce', 600, 30], ['steak', 'Steak haché', 'pièce', 2500, 20], ['frites', 'Pommes de terre', 'kg', 3000, 10], ['huile', 'Huile', 'litre', 9000, 5],
    ['thb', 'THB 65 cl', 'bouteille', 3200, 24], ['coca', 'Coca-Cola 50 cl', 'bouteille', 2200, 24], ['eau', 'Eau Vitale 1,5 L', 'bouteille', 1800, 24], ['huilemassage', 'Huile de massage', 'litre', 45000, 1],
    ['nouilles', 'Nouilles chinoises', 'kg', 7000, 5], ['savon', 'Savon artisanal', 'pièce', 4000, 10]]) {
    art[k] = ins('articles', { id: uid(), nom, unite, cout_defaut: cout, seuil_alerte: seuil, cree_le: now });
  }
  const stock = (depot, k, q) => {
    s.push(st(db, 'INSERT INTO stocks(depot_id, article_id, quantite, cmup) VALUES (?,?,?,?) ON CONFLICT(depot_id, article_id) DO UPDATE SET quantite = stocks.quantite + excluded.quantite', depot, art[k], q, 0));
    s.push(st(db, "UPDATE stocks SET cmup = (SELECT cout_defaut FROM articles WHERE id = ?) WHERE depot_id = ? AND article_id = ?", art[k], depot, art[k]));
    ins('mouvements_stock', { id: uid(), quand: now, jour: auj, depot_id: depot, article_id: art[k], type: 'entree', quantite: q, cout_unitaire: 0, motif: 'Stock initial démo' });
  };
  for (const [d, k, q] of [['DEP-REST', 'riz', 50], ['DEP-REST', 'poulet', 15], ['DEP-REST', 'zebu', 12], ['DEP-REST', 'thb', 48], ['DEP-REST', 'coca', 36], ['DEP-REST', 'eau', 40],
    ['DEP-MALG', 'riz', 40], ['DEP-MALG', 'zebu', 10], ['DEP-MALG', 'brede', 30], ['DEP-FAST', 'pain', 60], ['DEP-FAST', 'steak', 50], ['DEP-FAST', 'frites', 25], ['DEP-FAST', 'huile', 8],
    ['DEP-FAST', 'coca', 30], ['DEP-BUFF', 'nouilles', 10], ['DEP-BUFF', 'riz', 30], ['DEP-BUFF', 'poulet', 8], ['DEP-BE', 'huilemassage', 3], ['DEP-SHOP', 'thb', 72], ['DEP-SHOP', 'coca', 48],
    ['DEP-SHOP', 'eau', 60], ['DEP-SHOP', 'savon', 25], ['DEP-CENTRAL', 'riz', 200], ['DEP-CENTRAL', 'huile', 20]]) stock(d, k, q);

  // Catalogue par activité
  const cat = (a, nom, o) => ins('categories', { id: uid(), activite_id: a, nom, ordre: o, cree_le: now });
  const prod = (a, c, nom, prix, type, recette = [], extra = {}) => {
    const id = ins('produits', { id: uid(), activite_id: a, categorie_id: c, nom, prix, type, envoi_cuisine: type === 'boisson' || type === 'article' || type === 'prestation' ? 0 : 1, cree_le: now, ...extra });
    for (const [k, q] of recette) ins('recettes', { produit_id: id, article_id: art[k], quantite: q });
    return id;
  };
  let c = cat('REST', 'Plats', 1); prod('REST', c, 'Poulet coco', 18000, 'plat', [['poulet', 0.3], ['riz', 0.2]]); prod('REST', c, 'Zébu sauce poivre', 25000, 'plat', [['zebu', 0.25], ['riz', 0.2]]); prod('REST', c, 'Poisson grillé', 22000, 'plat');
  c = cat('REST', 'Boissons', 2); prod('REST', c, 'THB 65 cl', 6000, 'boisson', [], { article_id: art.thb }); prod('REST', c, 'Coca-Cola', 4000, 'boisson', [], { article_id: art.coca }); prod('REST', c, 'Eau Vitale', 3000, 'boisson', [], { article_id: art.eau });
  c = cat('FAST', 'Burgers', 1); prod('FAST', c, 'Burger classique', 9000, 'plat', [['pain', 1], ['steak', 1]]); prod('FAST', c, 'Menu burger + frites + Coca', 15000, 'menu', [['pain', 1], ['steak', 1], ['frites', 0.25], ['coca', 1]]);
  c = cat('FAST', 'Accompagnements', 2); prod('FAST', c, 'Frites', 4000, 'plat', [['frites', 0.25], ['huile', 0.02]]); prod('FAST', c, 'Coca-Cola', 4000, 'boisson', [], { article_id: art.coca });
  c = cat('MALG', 'Plats du jour', 1); prod('MALG', c, 'Romazava', 12000, 'plat', [['zebu', 0.2], ['brede', 1], ['riz', 0.25]]); prod('MALG', c, 'Ravitoto sy henakisoa', 13000, 'plat', [['riz', 0.25]]); prod('MALG', c, 'Henomby ritra', 15000, 'plat', [['zebu', 0.25], ['riz', 0.25]]);
  c = cat('BUFF', 'Formules', 1); prod('BUFF', c, 'Buffet adulte', 35000, 'formule', [['nouilles', 0.15], ['riz', 0.2], ['poulet', 0.15]]); prod('BUFF', c, 'Buffet enfant', 20000, 'formule', [['nouilles', 0.08], ['riz', 0.1]]);
  c = cat('BE', 'Massages', 1); prod('BE', c, 'Massage relaxant 60 min', 60000, 'prestation', [['huilemassage', 0.05]], { duree_min: 60 }); prod('BE', c, 'Massage aux pierres chaudes 90 min', 90000, 'prestation', [['huilemassage', 0.08]], { duree_min: 90 });
  c = cat('BE', 'Soins', 2); prod('BE', c, 'Soin du visage', 45000, 'prestation', [], { duree_min: 45 }); prod('BE', c, 'Sauna 30 min', 20000, 'prestation', [], { duree_min: 30 });
  c = cat('SHOP', 'Boissons', 1); prod('SHOP', c, 'THB 65 cl', 5000, 'article', [], { article_id: art.thb, code_barre: '6201234500011' }); prod('SHOP', c, 'Coca-Cola 50 cl', 3500, 'article', [], { article_id: art.coca, code_barre: '5449000000996' }); prod('SHOP', c, 'Eau Vitale 1,5 L', 2500, 'article', [], { article_id: art.eau, code_barre: '6201234500028' });
  c = cat('SHOP', 'Souvenirs', 2); prod('SHOP', c, 'Savon artisanal vanille', 8000, 'article', [], { article_id: art.savon, code_barre: '6201234500035' });

  for (const [a, n] of [['REST', 8], ['MALG', 5], ['BUFF', 6], ['FAST', 4]]) for (let i = 1; i <= n; i++) ins('tables_resto', { id: uid(), activite_id: a, nom: 'Table ' + i, places: i % 3 === 0 ? 6 : 4, cree_le: now });
  ins('fournisseurs', { id: uid(), nom: 'Grossiste Bazary Be', telephone: '032 05 123 45', cree_le: now });
  ins('fournisseurs', { id: uid(), nom: 'STAR Brasseries', telephone: '020 53 000 00', cree_le: now });

  // Réservations à venir et en cours (les nuits sont posées par le code métier lors du check-in)
  const resa = (b, cl, arr, dep, statut) => {
    const fid = uid(); const rid = uid();
    ins('folios', { id: fid, numero: 'FOL-DEMO-' + rid.slice(0, 4).toUpperCase(), client_id: cl, libelle: 'Séjour démo', cree_le: now });
    ins('reservations', { id: rid, numero: 'RES-DEMO-' + rid.slice(0, 4).toUpperCase(), bungalow_id: b, client_id: cl, arrivee: arr, depart: dep, adultes: 2, statut, folio_id: fid, cree_le: now });
    for (let d = arr; d < dep; d = addDays(d, 1)) ins('reservation_nuits', { bungalow_id: b, date: d, reservation_id: rid });
  };
  resa(bung[0], clients[1], auj, addDays(auj, 3), 'reservee');
  resa(bung[2], clients[3], addDays(auj, 2), addDays(auj, 5), 'reservee');
  resa(bung[4], clients[4], addDays(auj, 5), addDays(auj, 9), 'reservee');
  s.push(st(db, "UPDATE parametres SET valeur = 'RESTO TAMATAVE (démo)' WHERE cle = 'nom_etablissement'"), st(db, "UPDATE parametres SET valeur = 'Toamasina – Madagascar' WHERE cle = 'adresse'"));
  await db.batch(s);
  return true;
}
