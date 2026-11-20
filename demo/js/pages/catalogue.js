// Catalogue : produits (avec fiches recettes), catégories, tables.
import { S, get, put, esc, ar, nb, modal, toast, peut, $, $$, actNom, mesActivites } from '../core.js';
import { pageCrud } from '../crudpage.js';

const optActs = () => mesActivites().filter((a) => a.id !== 'BUNG' && a.id !== 'RECEP').map((a) => [a.id, a.nom]);
const TYPES = [['plat', 'Plat'], ['boisson', 'Boisson'], ['menu', 'Menu combiné'], ['formule', 'Formule (buffet…)'], ['article', 'Article boutique'], ['prestation', 'Prestation (bien-être)']];

export async function produits(el, route) {
  const act = route.query.activite || '';
  const [cats, arts] = await Promise.all([get('/api/categories'), get('/api/articles')]);
  const titre = act ? `${act === 'BE' ? 'Prestations' : 'Articles en vente'} — ${actNom(act)}` : 'Produits & recettes';
  await pageCrud(el, { titre, sous: 'Le prix est fixé ici. La fiche recette indique les ingrédients consommés à chaque vente (coût et marge calculés automatiquement).', chemin: 'produits', module: 'catalogue',
    query: act ? { activite_id: act } : {}, valeursDefaut: { type: act === 'BE' ? 'prestation' : act === 'SHOP' ? 'article' : 'plat', envoi_cuisine: act === 'BE' || act === 'SHOP' ? 0 : 1 },
    champs: [{ k: 'activite_id', label: 'Activité', type: 'select', req: true, opts: optActs() }, { k: 'categorie_id', label: 'Catégorie', type: 'select', opts: cats.map((c) => [c.id, `${actNom(c.activite_id)} › ${c.nom}`]) },
      { k: 'nom', label: 'Nom', req: true }, { k: 'prix', label: 'Prix de vente (Ar)', type: 'number', req: true, min: 0 }, { k: 'type', label: 'Type', type: 'select', vide: false, opts: TYPES },
      { k: 'code_barre', label: 'Code-barres' }, { k: 'duree_min', label: 'Durée (min) — bien-être', type: 'number', min: 0 },
      { k: 'article_id', label: 'Article de stock vendu tel quel', type: 'select', opts: arts.map((a) => [a.id, a.nom]), hint: 'Pour les boissons et articles de boutique (1 vendu = 1 sorti du stock).' },
      { k: 'envoi_cuisine', label: 'Cuisine', type: 'checkbox', texte: 'Envoyer à l’écran cuisine' }],
    cols: [{ k: 'nom', label: 'Produit', f: (r) => `<b>${esc(r.nom)}</b><br><small class="muted">${esc(r.categorie_nom || '')}</small>` }, { k: 'activite_id', label: 'Activité', f: (r) => esc(actNom(r.activite_id)) },
      { k: 'type', label: 'Type', f: (r) => esc(TYPES.find((t) => t[0] === r.type)?.[1] || r.type) }, { k: 'prix', label: 'Prix', num: true, f: (r) => ar(r.prix) },
      { k: 'nb_ingredients', label: 'Recette', f: (r) => (r.article_id ? '<span class="tag info">article direct</span>' : r.nb_ingredients ? `<span class="tag ok">${r.nb_ingredients} ingrédient(s)</span>` : '<span class="tag warn">sans recette</span>') }],
    actionsLigne: (r) => (r.archive ? '' : `<button class="btn sm" data-act="recette" data-id="${r.id}">Recette</button>`),
    surAction: async (a, r, recharger) => { if (a === 'recette') { await editerRecette(r, arts); await recharger(); } } });
}

async function editerRecette(p, arts) {
  let lignes = await get(`/api/produits/${p.id}/recette`);
  const rendre = (m) => {
    const cout = lignes.reduce((s, l) => s + (Number(l.quantite) || 0) * (arts.find((a) => a.id === l.article_id)?.cout_defaut || 0), 0);
    $('#rec', m).innerHTML = `<table class="t"><thead><tr><th>Ingrédient</th><th class="num">Quantité pour 1 ${esc(p.nom)}</th><th></th></tr></thead><tbody>
      ${lignes.map((l, i) => `<tr><td><select data-i="${i}" data-k="article_id"><option value="">—</option>${arts.map((a) => `<option value="${a.id}" ${a.id === l.article_id ? 'selected' : ''}>${esc(a.nom)} (${esc(a.unite)})</option>`).join('')}</select></td>
      <td><input type="number" step="any" min="0" data-i="${i}" data-k="quantite" value="${l.quantite ?? ''}" style="max-width:120px;margin-left:auto;display:block"></td><td><button class="btn sm danger" data-del="${i}">×</button></td></tr>`).join('')}</tbody></table>
      <div class="row" style="margin-top:10px"><button class="btn sm" data-add>+ Ingrédient</button><span class="spacer"></span><span>Coût indicatif : <b>${ar(cout)}</b> · Marge : <b>${ar(p.prix - cout)}</b> (${p.prix ? nb(((p.prix - cout) / p.prix) * 100, 1) : 0} %)</span></div>`;
  };
  await modal({ titre: `Fiche recette — ${p.nom}`, large: true, corps: '<div id="rec"></div><p class="hint">Le coût réel est calculé à chaque vente à partir du coût moyen du stock de l’activité.</p>',
    onOpen: (m) => {
      rendre(m);
      m.addEventListener('input', (e) => { const t = e.target; if (t.dataset.i !== undefined) { lignes[t.dataset.i][t.dataset.k] = t.value; if (t.dataset.k === 'quantite') return; rendre(m); } });
      m.addEventListener('change', () => rendre(m));
      m.addEventListener('click', (e) => { if (e.target.closest('[data-add]')) { lignes.push({ article_id: '', quantite: '' }); rendre(m); } const d = e.target.closest('[data-del]'); if (d) { lignes.splice(d.dataset.del, 1); rendre(m); } });
    },
    actions: [{ label: 'Annuler' }, ...(peut('catalogue', 'S') ? [{ label: 'Enregistrer la recette', cls: 'primary', act: async () => {
      await put(`/api/produits/${p.id}/recette`, { lignes: lignes.filter((l) => l.article_id && Number(l.quantite) > 0).map((l) => ({ article_id: l.article_id, quantite: Number(l.quantite) })) });
      toast('Recette enregistrée.', 'ok');
    } }] : [])] });
}

export async function categories(el) {
  await pageCrud(el, { titre: 'Catégories', sous: 'Regroupent les produits sur les écrans de caisse.', chemin: 'categories', module: 'catalogue',
    champs: [{ k: 'activite_id', label: 'Activité', type: 'select', req: true, opts: optActs() }, { k: 'nom', label: 'Nom', req: true }, { k: 'ordre', label: 'Ordre d’affichage', type: 'number', def: 0 }],
    cols: [{ k: 'activite_id', label: 'Activité', f: (r) => esc(actNom(r.activite_id)) }, { k: 'nom', label: 'Nom', f: (r) => `<b>${esc(r.nom)}</b>` }, { k: 'ordre', label: 'Ordre', num: true }] });
}
export async function tables(el) {
  await pageCrud(el, { titre: 'Tables', chemin: 'tables', module: 'catalogue',
    champs: [{ k: 'activite_id', label: 'Activité', type: 'select', req: true, opts: optActs().filter(([k]) => ['REST', 'FAST', 'MALG', 'BUFF'].includes(k)) }, { k: 'nom', label: 'Nom', req: true, ph: 'Table 1, Terrasse 2…' }, { k: 'places', label: 'Places', type: 'number', min: 1, def: 4 }],
    cols: [{ k: 'activite_id', label: 'Activité', f: (r) => esc(actNom(r.activite_id)) }, { k: 'nom', label: 'Table', f: (r) => `<b>${esc(r.nom)}</b>` }, { k: 'places', label: 'Places', num: true }] });
}
