// Organisation du menu : modules → sous-rubriques (icône, couleur, droit requis).
export const MENU = [
  { id: 'accueil', label: 'Tableau de bord', icon: 'dashboard', c: '#0f766e', route: 'accueil', perm: 'tableau' },
  { id: 'heb', label: 'Hébergement', icon: 'bed', c: '#0e7490', act: 'BUNG', items: [
    { label: 'Planning', route: 'planning', icon: 'calendar', perm: 'hebergement' },
    { label: 'Réservations', route: 'reservations', icon: 'list', perm: 'hebergement' },
    { label: 'Comptes séjour', route: 'folios', icon: 'wallet', perm: 'hebergement' },
    { label: 'Ménage & état', route: 'menage', icon: 'broom', perm: 'hebergement' },
    { label: 'Bungalows', route: 'bungalows', icon: 'home', perm: 'hebergement' },
  ] },
  { id: 'resto', label: 'Restauration', icon: 'utensils', c: '#c2410c', items: [
    { label: 'Caisse restaurant', route: 'caisse/REST', icon: 'cash', perm: 'ventes', act: 'REST', c: '#c2410c' },
    { label: 'Caisse fast-food', route: 'caisse/FAST', icon: 'burger', perm: 'ventes', act: 'FAST', c: '#dc2626' },
    { label: 'Caisse cuisine malgache', route: 'caisse/MALG', icon: 'bowl', perm: 'ventes', act: 'MALG', c: '#65a30d' },
    { label: 'Caisse buffet chinois', route: 'caisse/BUFF', icon: 'buffet', perm: 'ventes', act: 'BUFF', c: '#b45309' },
    { label: 'Commandes en cours', route: 'commandes', icon: 'clipboard', perm: 'ventes' },
    { label: 'Écran cuisine', route: 'cuisine', icon: 'chef', perm: 'cuisine' },
    { label: 'Tickets du jour', route: 'tickets', icon: 'receipt', perm: 'ventes' },
  ] },
  { id: 'recep', label: 'Salle de réception', icon: 'party', c: '#7c3aed', act: 'RECEP', items: [
    { label: 'Événements', route: 'evenements', icon: 'calendar', perm: 'reception' },
    { label: 'Salles', route: 'salles', icon: 'door', perm: 'reception' },
  ] },
  { id: 'be', label: 'Bien-être', icon: 'spa', c: '#db2777', act: 'BE', items: [
    { label: 'Rendez-vous', route: 'rdv', icon: 'clock', perm: 'bienetre' },
    { label: 'Caisse bien-être', route: 'caisse/BE', icon: 'cash', perm: 'ventes', act: 'BE' },
    { label: 'Prestations', route: 'produits?activite=BE', icon: 'heart', perm: 'catalogue' },
  ] },
  { id: 'shop', label: 'Restoshop', icon: 'shop', c: '#2563eb', act: 'SHOP', items: [
    { label: 'Caisse boutique', route: 'caisse/SHOP', icon: 'barcode', perm: 'ventes', act: 'SHOP' },
    { label: 'Articles en vente', route: 'produits?activite=SHOP', icon: 'tag', perm: 'catalogue' },
    { label: 'Stock boutique', route: 'stocks?depot=DEP-SHOP', icon: 'box', perm: 'stocks' },
  ] },
  { id: 'stocks', label: 'Stocks', icon: 'box', c: '#0891b2', items: [
    { label: 'État des stocks', route: 'stocks', icon: 'layers', perm: 'stocks' },
    { label: 'Réception / achat', route: 'entree', icon: 'truck', perm: 'stocks', action: 'S' },
    { label: 'Transfert', route: 'transfert', icon: 'swap', perm: 'stocks', action: 'S' },
    { label: 'Pertes & casses', route: 'sorties', icon: 'trash', perm: 'stocks', action: 'S' },
    { label: 'Inventaire', route: 'inventaire', icon: 'clipboard', perm: 'stocks', action: 'S' },
    { label: 'Mouvements', route: 'mouvements', icon: 'history', perm: 'stocks' },
    { label: 'Alertes', route: 'alertes', icon: 'alert', perm: 'stocks' },
    { label: 'Articles', route: 'articles', icon: 'tag', perm: 'stocks' },
    { label: 'Fournisseurs', route: 'fournisseurs', icon: 'truck', perm: 'stocks' },
  ] },
  { id: 'catalogue', label: 'Catalogue', icon: 'tag', c: '#ca8a04', items: [
    { label: 'Produits & recettes', route: 'produits', icon: 'utensils', perm: 'catalogue' },
    { label: 'Catégories', route: 'categories', icon: 'layers', perm: 'catalogue' },
    { label: 'Tables', route: 'tables', icon: 'table', perm: 'catalogue' },
  ] },
  { id: 'fin', label: 'Finances', icon: 'coins', c: '#16a34a', items: [
    { label: 'Caisses', route: 'caisses', icon: 'cash', perm: 'caisses' },
    { label: 'Dépenses', route: 'depenses', icon: 'receipt', perm: 'depenses' },
    { label: 'Rapports', route: 'rapports', icon: 'chart', perm: 'rapports' },
  ] },
  { id: 'clients', label: 'Clients', icon: 'users', c: '#9333ea', route: 'clients', perm: 'clients' },
  { id: 'admin', label: 'Administration', icon: 'shield', c: '#475569', items: [
    { label: 'Utilisateurs', route: 'utilisateurs', icon: 'users', perm: 'utilisateurs' },
    { label: 'Rôles & permissions', route: 'roles', icon: 'key', perm: 'utilisateurs' },
    { label: 'Paramètres', route: 'parametres', icon: 'settings', perm: 'parametres' },
    { label: 'Jours fériés', route: 'feries', icon: 'flag', perm: 'parametres' },
    { label: 'Journal d’audit', route: 'audit', icon: 'scroll', perm: 'audit' },
    { label: 'Sauvegardes', route: 'sauvegardes', icon: 'database', perm: 'sauvegardes' },
    { label: 'Mes appareils', route: 'sessions', icon: 'devices' },
  ] },
];

// Route → [fichier de page, fonction]
export const PAGES = {
  accueil: ['accueil', 'accueil'],
  planning: ['hebergement', 'planning'], reservations: ['hebergement', 'reservations'], folios: ['hebergement', 'folios'], folio: ['hebergement', 'folio'],
  menage: ['hebergement', 'menage'], bungalows: ['hebergement', 'bungalows'],
  caisse: ['ventes', 'caisse'], commandes: ['ventes', 'commandes'], cuisine: ['ventes', 'cuisine'], tickets: ['ventes', 'tickets'],
  evenements: ['autres', 'evenements'], salles: ['autres', 'salles'], rdv: ['autres', 'rdv'],
  stocks: ['stocks', 'etat'], entree: ['stocks', 'entree'], transfert: ['stocks', 'transfert'], sorties: ['stocks', 'sorties'], inventaire: ['stocks', 'inventaire'],
  mouvements: ['stocks', 'mouvements'], alertes: ['stocks', 'alertes'], articles: ['stocks', 'articles'], fournisseurs: ['stocks', 'fournisseurs'],
  produits: ['catalogue', 'produits'], categories: ['catalogue', 'categories'], tables: ['catalogue', 'tables'],
  caisses: ['finances', 'caisses'], depenses: ['finances', 'depenses'], rapports: ['finances', 'rapports'],
  clients: ['autres', 'clients'],
  utilisateurs: ['admin', 'utilisateurs'], roles: ['admin', 'roles'], parametres: ['admin', 'parametres'], feries: ['admin', 'feries'],
  audit: ['admin', 'audit'], sauvegardes: ['admin', 'sauvegardes'], sessions: ['admin', 'sessions'],
};
