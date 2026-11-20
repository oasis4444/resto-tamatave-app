// Finances : caisses (ouverture / clôture), dépenses, rapports.
import { S, get, post, esc, ar, nb, dateFr, heureFr, dateHeureFr, aujourdhui, MODES, tete, bouton, sur, modal, toast, erreur, demander, tableau, statutTag, peut, qs, $, $$, uuid, actNom, mesActivites, formulaire, lireFormulaire, telecharger } from '../core.js';
import { icon } from '../icons.js';
import { imprimerHtml } from '../print.js';

export async function caisses(el) {
  let jour = aujourdhui();
  const rendre = async () => {
    const [cs, hist] = await Promise.all([get('/api/caisses'), get('/api/caisses/sessions' + qs({ du: jour, au: jour }))]);
    el.innerHTML = tete('Caisses', 'Une caisse par activité : ouverture avec fonds, clôture avec montant compté et écart.') + `<div class="grid g4">${cs.map((c) => `<div class="card">
      <div class="row"><span class="ico" style="--c:${c.session_id ? '#16a34a' : '#64748b'}">${icon('cash')}</span><div><b>${esc(c.nom)}</b><br>${c.session_id ? `<small class="muted">ouverte ${heureFr(c.ouvert_le)} · ${esc(c.ouvert_par_nom)}</small>` : '<small class="muted">fermée</small>'}</div></div>
      ${c.session_id ? `<div style="margin:12px 0" class="mono">Fonds : ${ar(c.fonds)}<br>Espèces encaissées : <b>${ar(c.especes)}</b><br>Total encaissé : ${ar(c.encaisse)}</div>
        ${peut('caisses', 'S') ? `<button class="btn primary" style="width:100%" data-fermer="${c.session_id}" data-nom="${esc(c.nom)}">Clôturer la caisse</button>` : ''}`
      : peut('caisses', 'S') ? `<button class="btn" style="width:100%;margin-top:12px" data-ouvrir="${c.id}" data-nom="${esc(c.nom)}">Ouvrir</button>` : ''}</div>`).join('')}</div>
      <div class="page-head" style="margin-top:26px"><div><h1 style="font-size:18px">Clôtures</h1></div><div class="actions"><input type="date" id="j" value="${jour}" style="width:auto"></div></div><div id="h"></div>`;
    tableau(el.querySelector('#h'), [{ k: 'caisse_nom', label: 'Caisse' }, { k: 'ouvert_le', label: 'Ouverture', f: (s) => `${heureFr(s.ouvert_le)} · ${esc(s.ouvert_par_nom)}` }, { k: 'ferme_le', label: 'Clôture', f: (s) => (s.ferme_le ? `${heureFr(s.ferme_le)} · ${esc(s.ferme_par_nom)}` : '—') },
      { k: 'attendu', label: 'Attendu', num: true, f: (s) => (s.attendu === null ? '—' : ar(s.attendu)) }, { k: 'compte', label: 'Compté', num: true, f: (s) => (s.compte === null ? '—' : ar(s.compte)) },
      { k: 'ecart', label: 'Écart', num: true, f: (s) => (s.ecart === null ? '—' : `<b class="${s.ecart ? 'late' : ''}">${ar(s.ecart)}</b>`) }, { k: 'statut', label: 'Statut', f: (s) => statutTag(s.statut) + (s.commentaire ? `<br><small class="muted">${esc(s.commentaire)}</small>` : '') }],
    hist, { recherche: false, vide: 'Aucune session ce jour-là.', actions: (s) => `<button class="btn sm" data-detail="${s.id}">Détail</button>${s.statut === 'fermee' && peut('caisses', 'V') ? `<button class="btn sm primary" data-valider="${s.id}">Valider</button>` : ''}` });
  };
  sur(el, 'change', '#j', (e, i) => { jour = i.value; rendre().catch(erreur); });
  sur(el, 'click', '[data-ouvrir]', async (e, b) => {
    try { const f = await demander(`Ouvrir ${b.dataset.nom}`, 'Fonds de caisse (Ar)', { type: 'number', def: '0', bouton: 'Ouvrir' }); if (f === null) return; await post(`/api/caisses/${b.dataset.ouvrir}/ouvrir`, { fonds: Number(f) || 0 }, { idem: uuid() }); toast('Caisse ouverte.', 'ok'); await rendre(); } catch (err) { erreur(err); }
  });
  sur(el, 'click', '[data-fermer]', async (e, b) => {
    try {
      const t = await get('/api/caisses/sessions/' + b.dataset.fermer);
      await modal({ titre: `Clôture — ${b.dataset.nom}`, corps: `<table class="t">${t.modes.map((m) => `<tr><td>${esc(MODES[m.mode] || m.mode)} (${m.nb})</td><td class="num">${ar(m.total)}</td></tr>`).join('')}
        <tr><td>Fonds de caisse</td><td class="num">${ar(t.session.fonds)}</td></tr><tr><td>Dépenses payées en espèces</td><td class="num">− ${ar(t.depenses_especes)}</td></tr>
        <tr><td><b>Espèces attendues dans le tiroir</b></td><td class="num"><b>${ar(t.attendu)}</b></td></tr></table>
        <div class="form" style="margin-top:14px"><div class="field"><label>Espèces comptées (Ar) <span class="req">*</span></label><input type="number" id="c-m" min="0" inputmode="numeric"></div><div class="field"><label>Écart</label><div id="c-e" class="mono" style="padding:10px 0">—</div></div>
        <div class="field full"><label>Commentaire (obligatoire s’il y a un écart)</label><textarea id="c-c"></textarea></div></div>`,
      onOpen: (m) => $('#c-m', m).addEventListener('input', () => { const v = Number($('#c-m', m).value); const d = v - t.attendu; $('#c-e', m).innerHTML = $('#c-m', m).value === '' ? '—' : `<b class="${d ? 'late' : ''}">${d > 0 ? '+' : ''}${ar(d)}</b>`; }),
      actions: [{ label: 'Annuler' }, { label: 'Clôturer', cls: 'primary', act: async (m) => {
        if ($('#c-m', m).value === '') throw new Error('Saisissez le montant compté.');
        const r = await post(`/api/caisses/sessions/${b.dataset.fermer}/fermer`, { compte: Number($('#c-m', m).value), commentaire: $('#c-c', m).value }); toast(`Caisse clôturée. Écart : ${ar(r.ecart)}`, r.ecart ? 'err' : 'ok');
      } }] });
      await rendre();
    } catch (err) { erreur(err); }
  });
  sur(el, 'click', '[data-valider]', async (e, b) => { try { await post(`/api/caisses/sessions/${b.dataset.valider}/valider`); toast('Clôture validée.', 'ok'); await rendre(); } catch (err) { erreur(err); } });
  sur(el, 'click', '[data-detail]', async (e, b) => {
    try { const t = await get('/api/caisses/sessions/' + b.dataset.detail); await modal({ titre: 'Détail de la session', corps: `<table class="t">${t.modes.map((m) => `<tr><td>${esc(MODES[m.mode] || m.mode)}</td><td class="num">${m.nb} opération(s)</td><td class="num">${ar(m.total)}</td></tr>`).join('') || '<tr><td>Aucun encaissement</td></tr>'}</table><p>Fonds : ${ar(t.session.fonds)} · Dépenses espèces : ${ar(t.depenses_especes)} · <b>Attendu : ${ar(t.attendu)}</b></p>` }); } catch (err) { erreur(err); }
  });
  await rendre();
}

export async function depenses(el) {
  const cats = await get('/api/depenses/categories');
  let du = aujourdhui().slice(0, 8) + '01', au = aujourdhui();
  const rendre = async () => {
    const rows = await get('/api/depenses' + qs({ du, au }));
    el.innerHTML = tete('Dépenses', 'Affectées à une activité ou aux charges communes (réparties au prorata du chiffre d’affaires).', `<input type="date" id="d-du" value="${du}" style="width:auto"><input type="date" id="d-au" value="${au}" style="width:auto">${peut('depenses', 'S') ? bouton('Nouvelle dépense', 'nouv', 'plus', 'primary') : ''}`) + '<div id="l"></div>';
    const ok = rows.filter((r) => r.statut === 'validee');
    tableau(el.querySelector('#l'), [{ k: 'jour', label: 'Date', f: (r) => dateFr(r.jour) }, { k: 'numero', label: 'N°' }, { k: 'activite_nom', label: 'Activité', f: (r) => esc(r.activite_nom || 'Charges communes') }, { k: 'categorie', label: 'Catégorie' },
      { k: 'libelle', label: 'Libellé', f: (r) => `${esc(r.libelle)}${r.fournisseur ? `<br><small class="muted">${esc(r.fournisseur)}</small>` : ''}` }, { k: 'mode', label: 'Mode', f: (r) => esc(MODES[r.mode]) },
      { k: 'montant', label: 'Montant', num: true, f: (r) => (r.statut === 'annulee' ? `<s>${ar(r.montant)}</s>` : ar(r.montant)) }, { k: 'statut', label: '', f: (r) => (r.statut === 'annulee' ? statutTag('annulee') : '') }],
    rows, { actions: (r) => (r.statut === 'validee' && peut('depenses', 'V') ? `<button class="btn sm danger" data-ann="${r.id}">Annuler</button>` : ''), pied: () => `<td colspan="6"><b>Total (${ok.length})</b></td><td class="num">${ar(ok.reduce((s, r) => s + r.montant, 0))}</td><td></td><td></td>` });
  };
  sur(el, 'change', '#d-du, #d-au', () => { du = $('#d-du', el).value; au = $('#d-au', el).value; rendre().catch(erreur); });
  sur(el, 'click', '[data-act=nouv]', async () => {
    try {
      const [fours, cs] = await Promise.all([get('/api/fournisseurs').catch(() => []), get('/api/caisses').catch(() => [])]);
      const ch = [{ k: 'jour', label: 'Date', type: 'date', def: aujourdhui(), req: true }, { k: 'activite_id', label: 'Activité', type: 'select', vide: 'Charges communes', opts: S.activites.map((a) => [a.id, a.nom]) },
        { k: 'categorie', label: 'Catégorie', type: 'select', req: true, opts: cats.map((c) => [c, c]) }, { k: 'montant', label: 'Montant (Ar)', type: 'number', req: true, min: 1 },
        { k: 'libelle', label: 'Libellé', req: true, full: true }, { k: 'mode', label: 'Payé par', type: 'select', vide: false, opts: Object.entries(MODES) },
        { k: 'caisse_id', label: 'Sortie de la caisse (si espèces)', type: 'select', opts: cs.filter((c) => c.session_id).map((c) => [c.id, c.nom]), hint: 'Laisser vide si l’argent ne sort pas d’une caisse ouverte.' },
        { k: 'fournisseur_id', label: 'Fournisseur', type: 'select', opts: fours.map((f) => [f.id, f.nom]) }];
      await modal({ titre: 'Nouvelle dépense', corps: formulaire(ch), actions: [{ label: 'Annuler' }, { label: 'Enregistrer', cls: 'primary', act: async (m) => { await post('/api/depenses', lireFormulaire(m, ch), { idem: uuid() }); toast('Dépense enregistrée.', 'ok'); } }] });
      await rendre();
    } catch (err) { erreur(err); }
  });
  sur(el, 'click', '[data-ann]', async (e, b) => { try { const m = await demander('Annuler la dépense', 'Motif'); if (m) { await post(`/api/depenses/${b.dataset.ann}/annuler`, { motif: m }); await rendre(); } } catch (err) { erreur(err); } });
  await rendre();
}

export async function rapports(el) {
  let du = aujourdhui().slice(0, 8) + '01', au = aujourdhui(), act = '', onglet = 'synthese';
  const ONGLETS = [['synthese', 'Bénéfices par activité'], ['produit', 'Ventes par produit'], ['jour', 'Ventes par jour'], ['employe', 'Ventes par employé'], ['paiements', 'Encaissements'], ['depenses', 'Dépenses']];
  const url = (csv) => {
    const base = onglet === 'synthese' ? '/api/rapports/synthese' : onglet === 'paiements' ? '/api/rapports/paiements' : onglet === 'depenses' ? '/api/rapports/depenses' : '/api/rapports/ventes';
    return base + qs({ du, au, activite: act, groupe: ['produit', 'jour', 'employe'].includes(onglet) ? onglet : '', format: csv ? 'csv' : '' });
  };
  const rendre = async () => {
    const d = await get(url(false));
    el.innerHTML = tete('Rapports', 'Chiffres calculés automatiquement à partir des opérations enregistrées.', `<input type="date" id="r-du" value="${du}" style="width:auto"><input type="date" id="r-au" value="${au}" style="width:auto">
      <select id="r-act" style="width:auto"><option value="">Toutes les activités</option>${mesActivites().map((a) => `<option value="${a.id}" ${a.id === act ? 'selected' : ''}>${esc(a.nom)}</option>`).join('')}</select>
      ${peut('rapports', 'E') ? `${bouton('Excel (CSV)', 'csv', 'download')}${bouton('Imprimer / PDF', 'imp', 'print')}` : ''}`)
      + `<div class="seg" style="margin-bottom:14px">${ONGLETS.map(([k, l]) => `<button data-o="${k}" class="${k === onglet ? 'on' : ''}">${l}</button>`).join('')}</div><div id="l"></div>`;
    const L = el.querySelector('#l');
    if (onglet === 'synthese') {
      tableau(L, [{ k: 'nom', label: 'Activité', f: (r) => `<b>${esc(r.nom)}</b>` }, { k: 'ca', label: 'Chiffre d’affaires', num: true, f: (r) => ar(r.ca) }, { k: 'cout', label: 'Coût matière', num: true, f: (r) => ar(r.cout) },
        { k: 'marge', label: 'Marge brute', num: true, f: (r) => `${ar(r.marge)}<br><small class="muted">${nb(r.taux_marge, 1)} %</small>` }, { k: 'depenses', label: 'Dépenses directes', num: true, f: (r) => ar(r.depenses) },
        { k: 'charges_communes', label: 'Part charges communes', num: true, f: (r) => ar(r.charges_communes) }, { k: 'resultat', label: 'Résultat estimé', num: true, f: (r) => `<b class="${r.resultat < 0 ? 'late' : ''}">${ar(r.resultat)}</b>` }],
      d.lignes, { recherche: false, pied: () => `<td>Total</td><td class="num">${ar(d.totaux.ca)}</td><td class="num">${ar(d.totaux.cout)}</td><td class="num">${ar(d.totaux.marge)}</td><td class="num">${ar(d.totaux.depenses)}</td><td class="num">${ar(d.totaux.charges_communes)}</td><td class="num">${ar(d.totaux.resultat)}</td>` });
      L.insertAdjacentHTML('beforeend', `<div class="grid g2" style="margin-top:16px"><div class="card"><h3>Encaissements par mode</h3>${d.encaissements.map((e) => `<div class="row" style="padding:4px 0"><span>${esc(MODES[e.mode] || e.mode)}</span><span class="spacer"></span><b class="mono">${ar(e.total)}</b></div>`).join('') || '<p class="muted">Aucun</p>'}</div>
        <div class="card"><h3>À surveiller</h3><p>Impayés sur comptes ouverts : <b>${ar(d.impayes.total)}</b> (${d.impayes.n})</p><p>Écarts de caisse : <b>${ar(d.ecarts_caisse.total)}</b> (${d.ecarts_caisse.n} clôture(s))</p><p class="hint">Le résultat est estimé : il ne remplace pas une comptabilité certifiée.</p></div></div>`);
    } else if (onglet === 'paiements') {
      tableau(L, [{ k: 'jour', label: 'Date', f: (r) => dateFr(r.jour) }, { k: 'activite', label: 'Activité' }, { k: 'mode', label: 'Mode', f: (r) => esc(MODES[r.mode]) }, { k: 'nature', label: 'Nature' }, { k: 'montant', label: 'Montant', num: true, f: (r) => ar(r.montant) },
        { k: 'document', label: 'Pièce', f: (r) => esc(r.document || r.folio || '') }, { k: 'par', label: 'Par' }], d, { pied: (r) => `<td colspan="4">Total</td><td class="num">${ar(r.reduce((s, x) => s + x.montant, 0))}</td><td></td><td></td>` });
    } else if (onglet === 'depenses') {
      tableau(L, [{ k: 'jour', label: 'Date', f: (r) => dateFr(r.jour) }, { k: 'activite', label: 'Activité' }, { k: 'categorie', label: 'Catégorie' }, { k: 'libelle', label: 'Libellé' }, { k: 'montant', label: 'Montant', num: true, f: (r) => ar(r.montant) }, { k: 'statut', label: 'Statut' }],
        d, { pied: (r) => `<td colspan="4">Total validé</td><td class="num">${ar(r.filter((x) => x.statut === 'validee').reduce((s, x) => s + x.montant, 0))}</td><td></td>` });
    } else {
      tableau(L, [{ k: 'cle', label: { produit: 'Produit', jour: 'Jour', employe: 'Employé' }[onglet], f: (r) => esc(onglet === 'jour' ? dateFr(r.cle) : r.cle) }, { k: 'quantite', label: 'Quantité', num: true, f: (r) => nb(r.quantite) },
        { k: 'ca', label: 'CA', num: true, f: (r) => ar(r.ca) }, { k: 'cout', label: 'Coût', num: true, f: (r) => ar(r.cout) }, { k: 'marge', label: 'Marge', num: true, f: (r) => ar(r.marge) }],
      d, { pied: (r) => `<td>Total</td><td></td><td class="num">${ar(r.reduce((s, x) => s + x.ca, 0))}</td><td class="num">${ar(r.reduce((s, x) => s + x.cout, 0))}</td><td class="num">${ar(r.reduce((s, x) => s + x.marge, 0))}</td>` });
    }
  };
  sur(el, 'change', '#r-du, #r-au, #r-act', () => { du = $('#r-du', el).value; au = $('#r-au', el).value; act = $('#r-act', el).value; rendre().catch(erreur); });
  sur(el, 'click', '[data-o]', (e, b) => { onglet = b.dataset.o; rendre().catch(erreur); });
  sur(el, 'click', '[data-act=csv]', () => telecharger(url(true)));
  sur(el, 'click', '[data-act=imp]', () => { const t = el.querySelector('#l table'); imprimerHtml(`${ONGLETS.find((o) => o[0] === onglet)[1]} — du ${dateFr(du)} au ${dateFr(au)}${act ? ' — ' + actNom(act) : ''}`, t ? t.outerHTML : ''); });
  await rendre();
}
