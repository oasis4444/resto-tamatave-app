// Ventes : caisse tactile, commandes à table, écran cuisine, tickets.
import { S, get, post, put, esc, ar, nb, heureFr, dateFr, aujourdhui, MODES, tete, bouton, sur, modal, toast, erreur, confirmer, demander, tableau, statutTag, peut, qs, $, $$, uuid, mettreEnFile, actNom, mesActivites } from '../core.js';
import { icon } from '../icons.js';
import { imprimerTicket } from '../print.js';

// ── Fenêtre de paiement (paiement mixte, rendu de monnaie, remise) ──
export function fenetrePaiement(total, { titre = 'Encaissement', remiseAutorisee = true } = {}) {
  const modes = Object.entries(MODES).filter(([k]) => k !== 'cheque');
  return modal({ titre, corps: `
    <div class="total" style="margin-bottom:6px"><span>À payer</span><span class="mono" id="pa-tot">${ar(total)}</span></div>
    ${remiseAutorisee ? `<div class="field" style="margin-bottom:10px"><label>Remise (Ar)</label><input type="number" id="pa-rem" min="0" value="0" inputmode="numeric"><div class="hint">Au-delà de 10 %, une remise doit être faite par un responsable.</div></div>` : ''}
    <div class="grid g2" id="pa-l">${modes.map(([k, l]) => `<div class="field"><label>${l}</label><div class="inline"><input type="number" min="0" data-m="${k}" inputmode="numeric" placeholder="0" value="${k === 'especes' ? total : ''}">
      ${k !== 'especes' ? `<input data-ref="${k}" placeholder="Réf." style="max-width:110px">` : ''}</div></div>`).join('')}</div>
    <div class="banner info" style="margin-top:12px;justify-content:space-between"><span>Reçu : <b id="pa-recu">${ar(total)}</b></span><span>Rendu (espèces) : <b id="pa-rendu">0 Ar</b></span><span id="pa-reste"></span></div>
    <label class="inline" style="margin-top:8px"><input type="checkbox" id="pa-imp" ${localStorage.getItem('rt_auto_print') === '0' ? '' : 'checked'}> Imprimer le ticket</label>`,
  onOpen: (m) => {
    const calc = () => {
      const rem = Number($('#pa-rem', m)?.value) || 0;
      const du = Math.max(0, total - rem);
      const recu = $$('[data-m]', m).reduce((s, i) => s + (Number(i.value) || 0), 0);
      $('#pa-tot', m).textContent = ar(du); $('#pa-recu', m).textContent = ar(recu);
      $('#pa-rendu', m).textContent = ar(Math.max(0, recu - du));
      $('#pa-reste', m).innerHTML = recu < du ? `<b class="late">Manque ${ar(du - recu)}</b>` : '';
    };
    m.addEventListener('input', calc);
    $('#pa-rem', m)?.addEventListener('change', () => { const e = $('[data-m=especes]', m); const autres = $$('[data-m]', m).filter((x) => x !== e).reduce((s, i) => s + (Number(i.value) || 0), 0); e.value = Math.max(0, total - (Number($('#pa-rem', m).value) || 0) - autres); calc(); });
    const e = $('[data-m=especes]', m); setTimeout(() => e.select(), 60);
  },
  actions: [{ label: 'Annuler' }, { label: `${icon('check')} Valider le paiement`, cls: 'primary lg', act: (m) => {
    const paiements = $$('[data-m]', m).filter((i) => Number(i.value) > 0).map((i) => ({ mode: i.dataset.m, montant: Number(i.value), reference: $(`[data-ref=${i.dataset.m}]`, m)?.value || null }));
    const remise = Number($('#pa-rem', m)?.value) || 0;
    if (!paiements.length) throw new Error('Saisissez le montant reçu.');
    if (paiements.reduce((s, p) => s + p.montant, 0) < total - remise) throw new Error('Le montant reçu est insuffisant.');
    localStorage.setItem('rt_auto_print', $('#pa-imp', m).checked ? '1' : '0');
    return { paiements, remise, imprimer: $('#pa-imp', m).checked };
  } }] });
}

async function ouvrirCaisseModal(caisseId, nom) {
  const f = await demander(`Ouvrir ${nom}`, 'Fonds de caisse (Ar)', { type: 'number', def: '0', bouton: 'Ouvrir la caisse', aide: 'Montant en espèces présent dans le tiroir au début du service.' });
  if (f === null) return false;
  await post(`/api/caisses/${caisseId}/ouvrir`, { fonds: Number(f) || 0 }, { idem: uuid() }); toast('Caisse ouverte.', 'ok'); return true;
}

// ── Caisse tactile ──
export async function caisse(el, route) {
  const act = route.params[0];
  let data, cat = '', panier = [], mode = act === 'SHOP' || act === 'BE' ? 'comptoir' : 'table', tableId = '', folioId = '', commandeId = route.query.commande || '', commande = null, recherche = '';
  const charger = async () => {
    data = await get('/api/pos/' + act);
    if (commandeId) { commande = await get('/api/commandes/' + commandeId); mode = commande.folio_id && !commande.table_id ? 'folio' : 'table'; tableId = commande.table_id || ''; folioId = commande.folio_id || ''; }
  };
  const caisseOuverte = () => data.caisses.find((c) => c.session_id);
  const total = () => panier.reduce((s, l) => s + l.prix * l.q, 0);
  const ajouter = (p) => { const l = panier.find((x) => x.id === p.id && !x.note); if (l) l.q++; else panier.push({ id: p.id, nom: p.nom, prix: p.prix, q: 1 }); rendrePanier(); };

  const rendre = () => {
    const cs = caisseOuverte();
    el.innerHTML = `${tete(`Caisse — ${actNom(act)}`, cs ? `<span class="dot"></span>${esc(cs.nom)} ouverte depuis ${heureFr(cs.ouvert_le)}` : '<span class="dot off"></span>Caisse fermée',
      `${!cs && peut('caisses', 'S') ? bouton('Ouvrir la caisse', 'ouvrir', 'cash', 'primary') : ''}${data.tables.length ? `<a class="btn" href="#/commandes">${icon('clipboard')} Commandes</a>` : ''}`)}
      ${!cs ? `<div class="banner warn">La caisse est fermée : ${data.tables.length ? 'vous pouvez prendre des commandes à table et ' : 'vous pouvez '}porter des consommations au compte séjour, mais pas encaisser.</div>` : ''}
      <div class="pos"><div class="pos-left">
        <div class="row"><div class="seg" id="modes">${[['comptoir', 'Comptoir / à emporter'], ...(data.tables.length ? [['table', 'À table']] : []), ['folio', 'Compte séjour']].map(([k, l]) => `<button data-mode="${k}" class="${mode === k ? 'on' : ''}" ${commande ? 'disabled' : ''}>${l}</button>`).join('')}</div>
          <input type="search" id="pos-q" placeholder="${act === 'SHOP' ? 'Scanner un code-barres ou rechercher…' : 'Rechercher un produit…'}" style="flex:1;min-width:200px" value="${esc(recherche)}" autocomplete="off"></div>
        <div class="chips"><button class="chip ${!cat ? 'on' : ''}" data-cat="">Tout</button>${data.categories.map((c) => `<button class="chip ${cat === c.id ? 'on' : ''}" data-cat="${c.id}">${esc(c.nom)}</button>`).join('')}</div>
        <div class="products" id="prods"></div></div>
        <div class="card cart"><div class="cart-h" id="cart-h"></div><div class="cart-lines" id="lignes"></div><div class="cart-f" id="cart-f"></div></div></div>`;
    rendreProduits(); rendrePanier();
    if (act === 'SHOP') setTimeout(() => $('#pos-q', el)?.focus(), 50);
  };
  const rendreProduits = () => {
    const q = recherche.toLowerCase();
    const l = data.produits.filter((p) => (!cat || p.categorie_id === cat) && (!q || p.nom.toLowerCase().includes(q) || (p.code_barre || '').includes(q)));
    $('#prods', el).innerHTML = l.map((p) => `<button class="prod" data-p="${p.id}"><b>${esc(p.nom)}</b><span class="mono">${ar(p.prix)}</span></button>`).join('') || '<div class="empty">Aucun produit. Ajoutez-en dans Catalogue › Produits.</div>';
  };
  const rendrePanier = () => {
    const tbl = data.tables.find((t) => t.id === tableId);
    $('#cart-h', el).innerHTML = mode === 'table' ? (commande ? `<b>${esc(commande.table_nom || 'Commande')} · ${esc(commande.numero)}</b>` : `<label class="muted" style="font-size:12px">Table</label><select id="sel-table">${'<option value="">— choisir —</option>'}${data.tables.map((t) => `<option value="${t.id}" ${t.id === tableId ? 'selected' : ''}>${esc(t.nom)} (${t.places} pl.)${t.commande_id ? ' • occupée' : ''}</option>`).join('')}</select>`)
      : mode === 'folio' ? `<label class="muted" style="font-size:12px">Compte séjour à débiter</label><select id="sel-folio"><option value="">— choisir —</option>${data.folios.map((f) => `<option value="${f.id}" ${f.id === folioId ? 'selected' : ''}>${esc(f.libelle || f.numero)}${f.client ? ' · ' + esc(f.client) : ''}</option>`).join('')}</select>`
        : '<b>Vente au comptoir</b>';
    const deja = commande ? commande.lignes.filter((l) => l.statut_cuisine !== 'annule') : [];
    $('#lignes', el).innerHTML = (deja.length ? `<div class="muted" style="font-size:12px;padding:6px">Déjà commandé</div>${deja.map((l) => `<div class="cart-line" style="opacity:.65"><span>${esc(l.libelle)}${l.note ? `<br><small>${esc(l.note)}</small>` : ''}</span><span>× ${nb(l.quantite)}</span><span class="mono">${ar(l.quantite * l.prix_unitaire)}</span></div>`).join('')}<div class="muted" style="font-size:12px;padding:6px">Nouveaux articles</div>` : '')
      + (panier.length ? panier.map((l, i) => `<div class="cart-line"><span><b>${esc(l.nom)}</b><br><small class="muted">${ar(l.prix)}${l.note ? ' · ' + esc(l.note) : ''}</small> ${mode !== 'comptoir' || act !== 'SHOP' ? `<button class="btn sm" data-note="${i}" style="padding:2px 6px;font-size:11px">note</button>` : ''}</span>
        <span class="qty"><button data-m="${i}">−</button><b class="mono">${l.q}</b><button data-pl="${i}">+</button></span><span class="mono">${ar(l.prix * l.q)}</span></div>`).join('') : `<div class="empty">${icon('cash')}<p>Touchez un produit pour l’ajouter.</p></div>`);
    const tDeja = deja.reduce((s, l) => s + l.quantite * l.prix_unitaire, 0);
    const cs = caisseOuverte();
    $('#cart-f', el).innerHTML = `<div class="total"><span>Total</span><span class="mono">${ar(total() + tDeja)}</span></div>
      ${mode === 'table' ? `<button class="btn primary lg" data-go="cuisine" ${!panier.length ? 'disabled' : ''}>${icon('chef')} Envoyer la commande</button>
        ${commande ? `<div class="row"><button class="btn ok" style="flex:1" data-go="encaisser" ${!cs || panier.length ? 'disabled' : ''}>${icon('cash')} Encaisser</button><button class="btn" style="flex:1" data-go="aufolio" ${panier.length ? 'disabled' : ''}>Au compte séjour</button></div>` : ''}`
      : mode === 'folio' ? `<button class="btn primary lg" data-go="folio" ${!panier.length || !folioId ? 'disabled' : ''}>${icon('wallet')} Porter au compte</button>`
        : `<button class="btn primary lg" data-go="payer" ${!panier.length || !cs ? 'disabled' : ''}>${icon('cash')} Encaisser ${ar(total())}</button>`}
      ${panier.length ? '<button class="btn sm danger" data-go="vider">Vider le panier</button>' : ''}`;
  };

  const apresVente = async (docId, rendu, imprimer) => {
    toast(rendu ? `Vente enregistrée. Rendu : ${ar(rendu)}` : 'Vente enregistrée.', 'ok', 6000);
    if (imprimer && docId) imprimerTicket(docId).catch(erreur);
    panier = [];
  };
  sur(el, 'click', '[data-p]', (e, b) => ajouter(data.produits.find((p) => p.id === b.dataset.p)));
  sur(el, 'click', '[data-cat]', (e, b) => { cat = b.dataset.cat; $$('.chip', el).forEach((c) => c.classList.toggle('on', c === b)); rendreProduits(); });
  sur(el, 'click', '[data-mode]', (e, b) => { mode = b.dataset.mode; rendre(); });
  sur(el, 'click', '[data-pl]', (e, b) => { panier[b.dataset.pl].q++; rendrePanier(); });
  sur(el, 'click', '[data-m]', (e, b) => { if (b.closest('#pa-l')) return; const l = panier[b.dataset.m]; l.q--; if (l.q <= 0) panier.splice(b.dataset.m, 1); rendrePanier(); });
  sur(el, 'click', '[data-note]', async (e, b) => { const n = await demander('Note pour la cuisine', 'Ex. : sans piment, bien cuit…', { req: false, def: panier[b.dataset.note].note || '' }); if (n !== null) { panier[b.dataset.note].note = n; rendrePanier(); } });
  sur(el, 'change', '#sel-table', async (e, s) => {
    tableId = s.value; const t = data.tables.find((x) => x.id === tableId);
    if (t?.commande_id) { location.hash = `#/caisse/${act}?commande=${t.commande_id}`; return; }
    rendrePanier();
  });
  sur(el, 'change', '#sel-folio', (e, s) => { folioId = s.value; rendrePanier(); });
  sur(el, 'input', '#pos-q', (e, i) => { recherche = i.value; rendreProduits(); });
  sur(el, 'keydown', '#pos-q', (e, i) => {
    if (e.key !== 'Enter') return;
    const p = data.produits.find((x) => x.code_barre && x.code_barre === i.value.trim()) || (data.produits.filter((x) => x.nom.toLowerCase().includes(i.value.toLowerCase())).length === 1 ? data.produits.find((x) => x.nom.toLowerCase().includes(i.value.toLowerCase())) : null);
    if (p) { ajouter(p); i.value = ''; recherche = ''; rendreProduits(); } else toast('Produit introuvable pour ce code.', 'err');
  });
  sur(el, 'click', '[data-act=ouvrir]', async () => { try { const c = data.caisses[0]; if (await ouvrirCaisseModal(c.id, c.nom)) { await charger(); rendre(); } } catch (err) { erreur(err); } });
  sur(el, 'click', '[data-go]', async (e, b) => {
    const go = b.dataset.go;
    const lignes = panier.map((l) => ({ produit_id: l.id, quantite: l.q, note: l.note }));
    const cs = caisseOuverte();
    try {
      if (go === 'vider') { panier = []; rendrePanier(); return; }
      if (go === 'payer') {
        const p = await fenetrePaiement(total(), { remiseAutorisee: true }); if (!p) return;
        const body = { activite_id: act, lignes, paiements: p.paiements, remise: p.remise, caisse_id: cs.id };
        const idem = uuid();
        try { const r = await post('/api/ventes', body, { idem }); await apresVente(r.document_id, r.rendu, p.imprimer); }
        catch (err) {
          if (err.code !== 'HORS_LIGNE') throw err;
          mettreEnFile({ method: 'POST', path: '/api/ventes', body, idem });
          toast('Pas de connexion : vente gardée sur cet appareil, elle sera envoyée automatiquement.', '', 8000); panier = [];
        }
      } else if (go === 'folio') {
        const r = await post('/api/ventes', { activite_id: act, lignes, folio_id: folioId }, { idem: uuid() });
        await apresVente(r.document_id, 0, await confirmer('Bon de consommation', 'Imprimer le bon à faire signer par le client ?', 'Imprimer'));
      } else if (go === 'cuisine') {
        if (!commande) {
          if (!tableId) throw new Error('Choisissez une table.');
          const c = await post('/api/commandes', { activite_id: act, type: 'sur_place', table_id: tableId }, { idem: uuid() });
          commandeId = c.id;
        }
        await post(`/api/commandes/${commandeId}/lignes`, { lignes }, { idem: uuid() });
        toast('Commande envoyée en cuisine.', 'ok'); panier = [];
        location.hash = `#/caisse/${act}?commande=${commandeId}`; return;
      } else if (go === 'encaisser') {
        const tot = commande.lignes.filter((l) => l.statut_cuisine !== 'annule').reduce((s, l) => s + l.quantite * l.prix_unitaire, 0);
        const p = await fenetrePaiement(tot); if (!p) return;
        const r = await post(`/api/commandes/${commandeId}/encaisser`, { paiements: p.paiements, remise: p.remise, caisse_id: cs.id }, { idem: uuid() });
        await apresVente(r.document_id, r.rendu, p.imprimer); location.hash = '#/commandes'; return;
      } else if (go === 'aufolio') {
        const f = await modal({ titre: 'Porter au compte séjour', corps: `<select id="ff">${data.folios.map((x) => `<option value="${x.id}" ${x.id === commande.folio_id ? 'selected' : ''}>${esc(x.libelle || x.numero)}${x.client ? ' · ' + esc(x.client) : ''}</option>`).join('')}</select>`, actions: [{ label: 'Annuler' }, { label: 'Valider', cls: 'primary', act: (m) => $('#ff', m).value || false }] });
        if (!f) return;
        const r = await post(`/api/commandes/${commandeId}/encaisser`, { au_folio: true, folio_id: f }, { idem: uuid() });
        await apresVente(r.document_id, 0, true); location.hash = '#/commandes'; return;
      }
      await charger(); rendre();
    } catch (err) { erreur(err); }
  });
  await charger(); rendre();
}

// ── Commandes en cours ──
export async function commandes(el) {
  let act = '';
  const rendre = async () => {
    const rows = await get('/api/commandes' + qs({ activite: act }));
    const details = await Promise.all(rows.map((c) => get('/api/commandes/' + c.id)));
    el.innerHTML = tete('Commandes en cours', 'Actualisation automatique toutes les 15 secondes.', `<select id="f-act" style="width:auto"><option value="">Toutes les activités</option>${mesActivites().filter((a) => ['REST', 'FAST', 'MALG', 'BUFF'].includes(a.id)).map((a) => `<option value="${a.id}" ${a.id === act ? 'selected' : ''}>${esc(a.nom)}</option>`).join('')}</select>`)
      + `<div class="grid g3">${details.map((c, i) => `<div class="card"><div class="row"><b style="font-size:16px">${esc(c.table_nom || (c.type === 'emporter' ? 'À emporter' : 'Comptoir'))}</b><span class="tag">${esc(actNom(c.activite_id))}</span><span class="spacer"></span><small class="muted">${heureFr(c.cree_le)} · ${esc(rows[i].serveur_nom || '')}</small></div>
        <div style="margin:10px 0">${c.lignes.filter((l) => l.statut_cuisine !== 'annule').map((l) => `<div class="row" style="padding:3px 0"><span>${nb(l.quantite)} × ${esc(l.libelle)}</span><span class="spacer"></span>${l.statut_cuisine === 'sans' ? '' : statutCuisine(l.statut_cuisine)}
          ${l.statut_cuisine !== 'servi' && peut('ventes', 'S') ? `<button class="btn sm" data-annl="${l.id}" title="Retirer">${icon('x')}</button>` : ''}</div>`).join('') || '<p class="muted">Vide</p>'}</div>
        <div class="row"><b class="mono" style="font-size:18px">${ar(rows[i].total)}</b><span class="spacer"></span><a class="btn sm" href="#/caisse/${c.activite_id}?commande=${c.id}">${icon('plus')} Ajouter</a>${peut('ventes', 'S') ? `<a class="btn sm primary" href="#/caisse/${c.activite_id}?commande=${c.id}">Encaisser</a>` : ''}${peut('ventes', 'V') ? `<button class="btn sm danger" data-annc="${c.id}">Annuler</button>` : ''}</div></div>`).join('') || `<div class="empty">${icon('clipboard')}<p>Aucune commande en cours.</p></div>`}</div>`;
    $$('.btn.sm svg', el).forEach((s) => s.setAttribute('style', 'width:14px;height:14px'));
  };
  sur(el, 'change', '#f-act', (e, s) => { act = s.value; rendre().catch(erreur); });
  sur(el, 'click', '[data-annl]', async (e, b) => { try { if (await confirmer('Retirer', 'Retirer cet article de la commande ?', 'Retirer', 'danger')) { await post(`/api/commandes/lignes/${b.dataset.annl}/annuler`); await rendre(); } } catch (err) { erreur(err); } });
  sur(el, 'click', '[data-annc]', async (e, b) => { try { const m = await demander('Annuler la commande', 'Motif'); if (m) { await post(`/api/commandes/${b.dataset.annc}/annuler`, { motif: m }); await rendre(); } } catch (err) { erreur(err); } });
  await rendre();
  const t = setInterval(() => { if (!document.querySelector('.modal-bg') && document.visibilityState === 'visible') rendre().catch(() => {}); }, 15000);
  return () => clearInterval(t);
}
const statutCuisine = (s) => `<span class="tag ${{ en_attente: 'warn', en_preparation: 'info', pret: 'ok', servi: '' }[s]}">${{ en_attente: 'En attente', en_preparation: 'En préparation', pret: 'Prêt', servi: 'Servi' }[s] || s}</span>`;

// ── Écran cuisine ──
export async function cuisine(el) {
  let act = sessionStorage.getItem('rt_cuisine_act') || '';
  const rendre = async () => {
    const rows = await get('/api/cuisine' + qs({ activite: act }));
    const col = (s, titre, c, bouton2) => `<div class="kds-col"><h3><span class="ico sm" style="--c:${c}">${icon(s === 'pret' ? 'check' : s === 'en_attente' ? 'clock' : 'chef')}</span>${titre} (${rows.filter((r) => r.statut_cuisine === s).length})</h3>
      ${rows.filter((r) => r.statut_cuisine === s).map((r) => { const min = Math.round((Date.now() - new Date(r.cree_le)) / 60000); return `<div class="card kds-card ${s}"><div class="row"><b>${nb(r.quantite)} × ${esc(r.libelle)}</b></div>
        ${r.note ? `<div style="margin:6px 0;color:var(--warn);font-weight:600">⚠ ${esc(r.note)}</div>` : ''}<div class="row muted" style="font-size:13px"><span>${esc(r.table_nom || (r.type === 'emporter' ? 'À emporter' : 'Comptoir'))} · ${esc(actNom(r.activite_id))}</span><span class="spacer"></span><span class="${min > 20 ? 'late' : ''}">${min} min</span></div>
        <div class="row" style="margin-top:8px">${bouton2(r)}</div></div>`; }).join('')}</div>`;
    el.innerHTML = tete('Écran cuisine', 'Actualisation toutes les 15 secondes.', `<div class="seg">${[['', 'Toutes'], ['REST', 'Restaurant'], ['FAST', 'Fast-food'], ['MALG', 'Malgache'], ['BUFF', 'Buffet']].map(([k, l]) => `<button data-a="${k}" class="${k === act ? 'on' : ''}">${l}</button>`).join('')}</div>`)
      + `<div class="kds">${col('en_attente', 'En attente', '#d97706', (r) => peut('cuisine', 'S') ? `<button class="btn primary" style="flex:1" data-st="en_preparation" data-id="${r.id}">Commencer</button>` : '')}
        ${col('en_preparation', 'En préparation', '#2563eb', (r) => peut('cuisine', 'S') ? `<button class="btn ok" style="flex:1" data-st="pret" data-id="${r.id}">${icon('check')} Prêt</button>` : '')}
        ${col('pret', 'Prêt à servir', '#16a34a', (r) => peut('ventes', 'S') ? `<button class="btn" style="flex:1" data-st="servi" data-id="${r.id}">Servi</button>` : '<span class="muted">En attente du serveur</span>')}</div>`;
  };
  sur(el, 'click', '[data-a]', (e, b) => { act = b.dataset.a; sessionStorage.setItem('rt_cuisine_act', act); rendre().catch(erreur); });
  sur(el, 'click', '[data-st]', async (e, b) => { try { b.disabled = true; await put('/api/cuisine/' + b.dataset.id, { statut: b.dataset.st }); await rendre(); } catch (err) { erreur(err); } });
  await rendre();
  const t = setInterval(() => { if (document.visibilityState === 'visible') rendre().catch(() => {}); }, 15000);
  return () => clearInterval(t);
}

// ── Tickets ──
export async function tickets(el) {
  let du = aujourdhui(), au = aujourdhui(), act = '';
  const rendre = async () => {
    const rows = await get('/api/documents' + qs({ du, au, activite: act }));
    el.innerHTML = tete('Tickets et avoirs', '', `<input type="date" id="t-du" value="${du}" style="width:auto"><input type="date" id="t-au" value="${au}" style="width:auto"><select id="t-act" style="width:auto"><option value="">Toutes activités</option>${mesActivites().map((a) => `<option value="${a.id}" ${a.id === act ? 'selected' : ''}>${esc(a.nom)}</option>`).join('')}</select>
      <select id="t-larg" style="width:auto" title="Largeur du papier"><option value="80">Ticket 80 mm</option><option value="58" ${localStorage.getItem('rt_ticket') === '58' ? 'selected' : ''}>Ticket 58 mm</option></select>`) + '<div id="l"></div>';
    const valides = rows.filter((r) => r.statut === 'valide');
    tableau(el.querySelector('#l'), [
      { k: 'numero', label: 'N°', f: (r) => `<b>${esc(r.numero)}</b>` }, { k: 'cree_le', label: 'Heure', f: (r) => `${dateFr(r.jour)} ${heureFr(r.cree_le)}` }, { k: 'activite_id', label: 'Activité', f: (r) => esc(actNom(r.activite_id)) },
      { k: 'vendeur', label: 'Par' }, { k: 'client_nom', label: 'Client / compte', f: (r) => esc(r.client_nom || (r.folio_id ? 'Compte séjour' : '')) },
      { k: 'total', label: 'Total', num: true, f: (r) => ar(r.total) }, { k: 'statut', label: '', f: (r) => (r.type === 'avoir' ? '<span class="tag warn">Avoir</span>' : statutTag(r.statut)) },
    ], rows, { actions: (r) => `<button class="btn sm" data-imp="${r.id}">${icon('print')}</button>${r.type === 'ticket' && r.statut === 'valide' && peut('ventes', 'V') ? `<button class="btn sm danger" data-ann="${r.id}">Annuler</button>` : ''}`,
      pied: () => `<td colspan="5"><b>Total des ventes valides (${valides.length})</b></td><td class="num">${ar(valides.filter((r) => r.type === 'ticket').reduce((s, r) => s + r.total, 0))}</td><td></td><td></td>` });
    $$('.btn.sm svg', el).forEach((s) => s.setAttribute('style', 'width:15px;height:15px'));
  };
  sur(el, 'change', '#t-du, #t-au, #t-act', () => { du = $('#t-du', el).value; au = $('#t-au', el).value; act = $('#t-act', el).value; rendre().catch(erreur); });
  sur(el, 'change', '#t-larg', (e, s) => localStorage.setItem('rt_ticket', s.value));
  sur(el, 'click', '[data-imp]', (e, b) => imprimerTicket(b.dataset.imp).catch(erreur));
  sur(el, 'click', '[data-ann]', async (e, b) => {
    try {
      const m = await demander('Annuler le ticket', 'Motif de l’annulation (obligatoire)', { bouton: 'Annuler le ticket', cls: 'danger', aide: 'Un avoir est créé, le stock est remis et le client remboursé dans la caisse ouverte. Rien n’est supprimé.' });
      if (!m) return;
      await post(`/api/documents/${b.dataset.ann}/annuler`, { motif: m }, { idem: uuid() }); toast('Ticket annulé, avoir créé.', 'ok'); await rendre();
    } catch (err) { erreur(err); }
  });
  await rendre();
}
