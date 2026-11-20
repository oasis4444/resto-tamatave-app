// Stocks : état, réceptions, transferts, pertes, inventaire, mouvements, alertes, articles, fournisseurs.
import { get, post, esc, ar, nb, dateFr, dateHeureFr, aujourdhui, plusJours, tete, bouton, sur, toast, erreur, tableau, peut, qs, $, $$, uuid } from '../core.js';
import { icon } from '../icons.js';
import { pageCrud } from '../crudpage.js';

const optDepots = (deps, sel) => deps.map((d) => `<option value="${d.id}" ${d.id === sel ? 'selected' : ''}>${esc(d.nom)}</option>`).join('');

export async function etat(el, route) {
  const deps = await get('/api/depots');
  let depot = route.query.depot || '';
  const rendre = async () => {
    const rows = await get('/api/stocks' + qs({ depot }));
    el.innerHTML = tete('État des stocks', 'Stocks séparés par activité. Valeur au coût moyen pondéré.', `<select id="dep" style="width:auto"><option value="">Tous les dépôts</option>${optDepots(deps, depot)}</select>
      ${peut('stocks', 'S') ? `<a class="btn" href="#/entree">${icon('truck')} Réception</a><a class="btn" href="#/inventaire">${icon('clipboard')} Inventaire</a>` : ''}`) + '<div id="l"></div>';
    tableau(el.querySelector('#l'), [
      { k: 'depot', label: 'Dépôt' }, { k: 'nom', label: 'Article', f: (r) => `<b>${esc(r.nom)}</b>` },
      { k: 'quantite', label: 'Quantité', num: true, f: (r) => `<span class="${r.quantite <= r.seuil_alerte && (r.seuil_alerte > 0 || r.quantite < 0) ? 'late' : ''}">${nb(r.quantite, 3)} ${esc(r.unite)}</span>` },
      { k: 'seuil_alerte', label: 'Seuil', num: true, f: (r) => nb(r.seuil_alerte) }, { k: 'cmup', label: 'Coût moyen', num: true, f: (r) => ar(r.cmup) }, { k: 'valeur', label: 'Valeur', num: true, f: (r) => ar(r.valeur) },
    ], rows, { pied: (r) => `<td colspan="5"><b>Valeur totale</b></td><td class="num">${ar(r.reduce((s, x) => s + (x.valeur || 0), 0))}</td>` });
  };
  sur(el, 'change', '#dep', (e, s) => { depot = s.value; rendre().catch(erreur); });
  await rendre();
}

// Formulaire de lignes d'articles réutilisé (réception, transfert, pertes)
async function formulaireLignes(el, { titre, sous, avecCout, champsHaut, envoyer }) {
  const [deps, arts] = await Promise.all([get('/api/depots'), get('/api/articles')]);
  let lignes = [{}];
  const rendre = () => {
    el.innerHTML = tete(titre, sous) + `<div class="card"><div class="form" style="margin-bottom:14px">${champsHaut(deps)}</div>
      <div class="table-wrap"><table class="t"><thead><tr><th>Article</th><th class="num">Quantité</th>${avecCout ? '<th class="num">Prix d’achat unitaire (Ar)</th><th>Lot</th><th>Péremption</th>' : ''}<th></th></tr></thead><tbody>
      ${lignes.map((l, i) => `<tr><td><select data-k="article_id" data-i="${i}"><option value="">— choisir —</option>${arts.map((a) => `<option value="${a.id}" ${a.id === l.article_id ? 'selected' : ''}>${esc(a.nom)} (${esc(a.unite)})</option>`).join('')}</select></td>
        <td><input type="number" step="any" min="0" data-k="quantite" data-i="${i}" value="${l.quantite ?? ''}" style="max-width:120px;margin-left:auto;display:block"></td>
        ${avecCout ? `<td><input type="number" min="0" data-k="cout_unitaire" data-i="${i}" value="${l.cout_unitaire ?? ''}" style="max-width:150px;margin-left:auto;display:block"></td><td><input data-k="lot" data-i="${i}" value="${esc(l.lot || '')}" style="max-width:110px"></td><td><input type="date" data-k="peremption" data-i="${i}" value="${l.peremption || ''}"></td>` : ''}
        <td><button class="btn sm danger" data-del="${i}">${icon('x')}</button></td></tr>`).join('')}</tbody></table></div>
      <div class="row" style="margin-top:12px">${bouton('Ajouter une ligne', 'add', 'plus')}<span class="spacer"></span>${avecCout ? `<b>Total : <span id="tot" class="mono">${ar(lignes.reduce((s, l) => s + (Number(l.quantite) || 0) * (Number(l.cout_unitaire) || 0), 0))}</span></b>` : ''}${bouton('Valider', 'ok', 'check', 'primary')}</div></div>`;
    $$('.btn.sm svg', el).forEach((s) => s.setAttribute('style', 'width:14px;height:14px'));
  };
  sur(el, 'input', '[data-k]', (e, i) => { lignes[i.dataset.i][i.dataset.k] = i.value; if (avecCout && $('#tot', el)) $('#tot', el).textContent = ar(lignes.reduce((s, l) => s + (Number(l.quantite) || 0) * (Number(l.cout_unitaire) || 0), 0)); });
  sur(el, 'change', 'select[data-k]', (e, i) => { lignes[i.dataset.i][i.dataset.k] = i.value; });
  sur(el, 'click', '[data-del]', (e, b) => { lignes.splice(b.dataset.del, 1); if (!lignes.length) lignes = [{}]; rendre(); });
  sur(el, 'click', '[data-act=add]', () => { lignes.push({}); rendre(); });
  sur(el, 'click', '[data-act=ok]', async (e, b) => {
    try {
      const l = lignes.filter((x) => x.article_id && Number(x.quantite) > 0).map((x) => ({ ...x, quantite: Number(x.quantite), cout_unitaire: Number(x.cout_unitaire) || 0, lot: x.lot || null, peremption: x.peremption || null }));
      if (!l.length) throw new Error('Ajoutez au moins un article avec une quantité.');
      b.disabled = true;
      await envoyer(el, l); toast('Enregistré.', 'ok'); lignes = [{}]; rendre();
    } catch (err) { erreur(err); b.disabled = false; }
  });
  rendre();
}

export async function entree(el) {
  const fours = await get('/api/fournisseurs');
  await formulaireLignes(el, { titre: 'Réception / achat de marchandises', sous: 'Augmente le stock et met à jour le coût moyen pondéré.', avecCout: true,
    champsHaut: (deps) => `<div class="field"><label>Dépôt de destination</label><select id="h-dep">${optDepots(deps, 'DEP-CENTRAL')}</select></div>
      <div class="field"><label>Fournisseur</label><select id="h-four"><option value="">—</option>${fours.map((f) => `<option value="${f.id}">${esc(f.nom)}</option>`).join('')}</select></div>
      <div class="field full"><label>Référence / motif</label><input id="h-motif" placeholder="N° de facture fournisseur…"></div>`,
    envoyer: (el2, lignes) => post('/api/stocks/entree', { depot_id: $('#h-dep', el2).value, fournisseur_id: $('#h-four', el2).value || null, motif: $('#h-motif', el2).value, lignes }, { idem: uuid() }) });
}
export async function transfert(el) {
  await formulaireLignes(el, { titre: 'Transfert entre dépôts', sous: 'Ex. : du magasin central vers la cuisine du restaurant. Chaque transfert est tracé.',
    champsHaut: (deps) => `<div class="field"><label>Depuis</label><select id="h-src">${optDepots(deps, 'DEP-CENTRAL')}</select></div><div class="field"><label>Vers</label><select id="h-dst">${optDepots(deps, 'DEP-REST')}</select></div>`,
    envoyer: (el2, lignes) => post('/api/stocks/transfert', { depot_source: $('#h-src', el2).value, depot_destination: $('#h-dst', el2).value, lignes }, { idem: uuid() }) });
}
export async function sorties(el) {
  await formulaireLignes(el, { titre: 'Pertes, casses et consommations internes', sous: 'Sorties de stock hors vente, avec motif obligatoire.',
    champsHaut: (deps) => `<div class="field"><label>Dépôt</label><select id="h-dep">${optDepots(deps)}</select></div>
      <div class="field"><label>Type</label><select id="h-type"><option value="perte">Perte</option><option value="casse">Casse</option><option value="perime">Périmé</option><option value="conso_interne">Consommation interne (personnel…)</option></select></div>
      <div class="field full"><label>Motif <span class="req">*</span></label><input id="h-motif"></div>`,
    envoyer: (el2, lignes) => post('/api/stocks/sortie', { depot_id: $('#h-dep', el2).value, type: $('#h-type', el2).value, motif: $('#h-motif', el2).value, lignes }, { idem: uuid() }) });
}

export async function inventaire(el) {
  const deps = await get('/api/depots');
  let depot = deps[0]?.id;
  const rendre = async () => {
    const [stocks, arts] = await Promise.all([get('/api/stocks?depot=' + depot), get('/api/articles')]);
    el.innerHTML = tete('Inventaire', 'Saisissez les quantités réellement comptées. Seuls les articles saisis sont modifiés ; les écarts sont enregistrés.', `<select id="dep" style="width:auto">${optDepots(deps, depot)}</select>`)
      + `<div class="table-wrap"><table class="t"><thead><tr><th>Article</th><th class="num">Théorique</th><th class="num">Compté</th></tr></thead><tbody>
        ${arts.map((a) => { const s = stocks.find((x) => x.article_id === a.id); return `<tr><td>${esc(a.nom)} <small class="muted">${esc(a.unite)}</small></td><td class="num">${nb(s?.quantite || 0, 3)}</td><td class="num"><input type="number" step="any" min="0" data-a="${a.id}" style="max-width:120px;margin-left:auto;display:block"></td></tr>`; }).join('')}
      </tbody></table></div><div class="row" style="margin-top:12px"><span class="spacer"></span>${bouton('Valider l’inventaire', 'ok', 'check', 'primary')}</div>`;
  };
  sur(el, 'change', '#dep', (e, s) => { depot = s.value; rendre().catch(erreur); });
  sur(el, 'click', '[data-act=ok]', async () => {
    try {
      const comptes = $$('[data-a]', el).filter((i) => i.value !== '').map((i) => ({ article_id: i.dataset.a, compte: Number(i.value) }));
      if (!comptes.length) throw new Error('Aucune quantité saisie.');
      const r = await post('/api/stocks/inventaire', { depot_id: depot, comptes }, { idem: uuid() });
      toast(r.ecarts.length ? `${r.ecarts.length} écart(s) enregistré(s).` : 'Aucun écart : stock conforme.', 'ok'); await rendre();
    } catch (err) { erreur(err); }
  });
  await rendre();
}

const TYPES = { entree: 'Entrée', sortie_vente: 'Vente', transfert_sortie: 'Transfert (sortie)', transfert_entree: 'Transfert (entrée)', perte: 'Perte', casse: 'Casse', perime: 'Périmé', conso_interne: 'Conso. interne', inventaire: 'Inventaire', annulation: 'Annulation de vente' };
export async function mouvements(el) {
  let du = plusJours(aujourdhui(), -7), au = aujourdhui(), type = '';
  const rendre = async () => {
    const rows = await get('/api/mouvements' + qs({ du, au, type }));
    el.innerHTML = tete('Mouvements de stock', 'Toutes les entrées et sorties, avec leur auteur.', `<input type="date" id="m-du" value="${du}" style="width:auto"><input type="date" id="m-au" value="${au}" style="width:auto">
      <select id="m-t" style="width:auto"><option value="">Tous types</option>${Object.entries(TYPES).map(([k, l]) => `<option value="${k}" ${k === type ? 'selected' : ''}>${l}</option>`).join('')}</select>`) + '<div id="l"></div>';
    tableau(el.querySelector('#l'), [{ k: 'quand', label: 'Date', f: (r) => dateHeureFr(r.quand) }, { k: 'depot', label: 'Dépôt' }, { k: 'article', label: 'Article' }, { k: 'type', label: 'Type', f: (r) => `<span class="tag">${TYPES[r.type] || r.type}</span>` },
      { k: 'quantite', label: 'Quantité', num: true, f: (r) => `<b class="${r.quantite < 0 ? 'late' : ''}">${r.quantite > 0 ? '+' : ''}${nb(r.quantite, 3)}</b> ${esc(r.unite)}` }, { k: 'cout_unitaire', label: 'Coût unit.', num: true, f: (r) => ar(r.cout_unitaire) },
      { k: 'motif', label: 'Motif', f: (r) => esc(r.motif || r.fournisseur || '') }, { k: 'par', label: 'Par' }], rows);
  };
  sur(el, 'change', '#m-du, #m-au, #m-t', () => { du = $('#m-du', el).value; au = $('#m-au', el).value; type = $('#m-t', el).value; rendre().catch(erreur); });
  await rendre();
}

export async function alertes(el) {
  const a = await get('/api/stocks/alertes');
  el.innerHTML = tete('Alertes de stock', 'Ruptures (sous le seuil) et produits proches de la péremption (7 jours).') + `<div class="grid g2"><div class="card"><h3>${icon('alert')} Ruptures et stocks bas</h3><div id="r"></div></div><div class="card"><h3>${icon('clock')} Péremptions proches</h3><div id="p"></div></div></div>`;
  $$('h3 svg', el).forEach((s) => s.setAttribute('style', 'width:18px;height:18px;vertical-align:-3px;color:var(--danger)'));
  tableau(el.querySelector('#r'), [{ k: 'article', label: 'Article' }, { k: 'depot', label: 'Dépôt' }, { k: 'quantite', label: 'Stock', num: true, f: (r) => `<b class="late">${nb(r.quantite, 3)}</b> ${esc(r.unite)}` }, { k: 'seuil_alerte', label: 'Seuil', num: true }], a.ruptures, { recherche: false, vide: 'Aucune rupture.' });
  tableau(el.querySelector('#p'), [{ k: 'article', label: 'Article' }, { k: 'depot', label: 'Dépôt' }, { k: 'lot', label: 'Lot' }, { k: 'peremption', label: 'Péremption', f: (r) => `<b class="late">${dateFr(r.peremption)}</b>` }], a.peremptions, { recherche: false, vide: 'Aucune péremption proche.' });
}

export async function articles(el) {
  await pageCrud(el, { titre: 'Articles de stock', sous: 'Ingrédients et marchandises. Le seuil déclenche une alerte de rupture.', chemin: 'articles', module: 'stocks',
    champs: [{ k: 'nom', label: 'Nom', req: true }, { k: 'unite', label: 'Unité', def: 'pièce', list: 'unites', hint: 'kg, litre, pièce, bouteille, botte…' }, { k: 'famille', label: 'Famille', ph: 'Viandes, boissons…' },
      { k: 'code_barre', label: 'Code-barres' }, { k: 'seuil_alerte', label: 'Seuil d’alerte', type: 'number', min: 0, def: 0 }, { k: 'cout_defaut', label: 'Coût unitaire indicatif (Ar)', type: 'number', min: 0, def: 0 }],
    cols: [{ k: 'nom', label: 'Nom', f: (r) => `<b>${esc(r.nom)}</b>` }, { k: 'unite', label: 'Unité' }, { k: 'famille', label: 'Famille' }, { k: 'seuil_alerte', label: 'Seuil', num: true }, { k: 'cout_defaut', label: 'Coût indicatif', num: true, f: (r) => ar(r.cout_defaut) }] });
  el.insertAdjacentHTML('beforeend', '<datalist id="unites"><option value="kg"><option value="g"><option value="litre"><option value="pièce"><option value="bouteille"><option value="botte"><option value="paquet"><option value="sac"></datalist>');
}
export async function fournisseurs(el) {
  await pageCrud(el, { titre: 'Fournisseurs', chemin: 'fournisseurs', module: 'stocks',
    champs: [{ k: 'nom', label: 'Nom', req: true }, { k: 'telephone', label: 'Téléphone' }, { k: 'email', label: 'Email', type: 'email' }, { k: 'nif', label: 'NIF' }, { k: 'adresse', label: 'Adresse', full: true }, { k: 'notes', label: 'Notes', type: 'textarea', full: true }],
    cols: [{ k: 'nom', label: 'Nom', f: (r) => `<b>${esc(r.nom)}</b>` }, { k: 'telephone', label: 'Téléphone' }, { k: 'email', label: 'Email' }, { k: 'nif', label: 'NIF' }] });
}
