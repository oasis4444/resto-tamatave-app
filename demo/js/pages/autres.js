// Salle de réception, bien-être, clients.
import { get, post, esc, ar, dateFr, aujourdhui, plusJours, MODES, tete, bouton, sur, modal, toast, erreur, demander, confirmer, tableau, statutTag, peut, qs, $, $$, uuid, formulaire, lireFormulaire } from '../core.js';
import { icon } from '../icons.js';
import { pageCrud } from '../crudpage.js';
import { imprimerContrat } from '../print.js';
import { fenetrePaiement } from './ventes.js';

const TYPES_EVT = [['mariage', 'Mariage'], ['anniversaire', 'Anniversaire'], ['seminaire', 'Séminaire'], ['conference', 'Conférence'], ['bapteme', 'Baptême'], ['communion', 'Communion'], ['reunion', 'Réunion'], ['autre', 'Autre']];
const optModes = () => Object.entries(MODES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
async function champClient(m) {
  const clients = await get('/api/clients?limite=2000').catch(() => []);
  return { html: `<div class="field"><label>Client <span class="req">*</span></label><input id="x-cl" list="x-cls" placeholder="Nom ou client existant"><datalist id="x-cls">${clients.map((c) => `<option value="${esc(c.nom)}${c.telephone ? ' — ' + esc(c.telephone) : ''}">`).join('')}</datalist></div>
    <div class="field"><label>Téléphone</label><input id="x-tel" inputmode="tel"></div>`,
  lire: (mm) => { const v = $('#x-cl', mm).value.trim(); if (!v) throw new Error('Indiquez le client.'); const ex = clients.find((x) => `${x.nom}${x.telephone ? ' — ' + x.telephone : ''}` === v); return ex ? { client_id: ex.id } : { client_nom: v, client_telephone: $('#x-tel', mm).value }; } };
}

// ── Événements ──
export async function evenements(el) {
  let statut = '';
  const rendre = async () => {
    const rows = await get('/api/evenements' + qs({ du: plusJours(aujourdhui(), statut === 'passes' ? -365 : 0), statut: statut === 'passes' ? 'termine' : statut }));
    el.innerHTML = tete('Événements', 'Mariages, séminaires, anniversaires… Une salle ne peut pas être réservée deux fois sur le même créneau.',
      `<div class="seg">${[['', 'À venir'], ['devis', 'Devis'], ['passes', 'Terminés']].map(([k, l]) => `<button data-s="${k}" class="${k === statut ? 'on' : ''}">${l}</button>`).join('')}</div>${peut('reception', 'S') ? bouton('Nouvel événement', 'nouv', 'plus', 'primary') : ''}`) + '<div id="l"></div>';
    tableau(el.querySelector('#l'), [{ k: 'date', label: 'Date', f: (r) => `<b>${dateFr(r.date)}</b><br><small class="muted">${r.heure_debut}h–${r.heure_fin}h</small>` }, { k: 'type', label: 'Événement', f: (r) => `${esc(TYPES_EVT.find((t) => t[0] === r.type)?.[1] || r.type)}<br><small class="muted">${esc(r.titre || '')}</small>` },
      { k: 'salle', label: 'Salle' }, { k: 'client', label: 'Client', f: (r) => `${esc(r.client)}<br><small class="muted">${esc(r.telephone || '')}</small>` }, { k: 'invites', label: 'Invités', num: true },
      { k: 'total', label: 'Montant', num: true, f: (r) => ar(r.montant_salle + r.montant_options) }, { k: 'statut', label: 'Statut', f: (r) => statutTag(r.statut) }],
    rows, { actions: (r) => `<button class="btn sm" data-ouv="${r.id}">Ouvrir</button>` });
  };
  sur(el, 'click', '[data-s]', (e, b) => { statut = b.dataset.s; rendre().catch(erreur); });
  sur(el, 'click', '[data-act=nouv]', () => nouvelEvenement(rendre).catch(erreur));
  sur(el, 'click', '[data-ouv]', (e, b) => ficheEvenement(b.dataset.ouv, rendre).catch(erreur));
  await rendre();
}
async function nouvelEvenement(apres) {
  const salles = await get('/api/salles');
  const cl = await champClient();
  const caisses = (await get('/api/caisses').catch(() => [])).filter((c) => c.session_id);
  let options = [];
  await modal({ titre: 'Nouvel événement', large: true, corps: `<div class="form">
    <div class="field"><label>Salle <span class="req">*</span></label><select id="e-s">${salles.map((s) => `<option value="${s.id}" data-h="${s.prix_heure}" data-d="${s.prix_demi}" data-j="${s.prix_jour}">${esc(s.nom)} (${s.capacite} pers.)</option>`).join('')}</select></div>
    <div class="field"><label>Type <span class="req">*</span></label><select id="e-t">${TYPES_EVT.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
    <div class="field"><label>Date <span class="req">*</span></label><input type="date" id="e-d" value="${plusJours(aujourdhui(), 7)}" min="${aujourdhui()}"></div>
    <div class="field"><label>Horaires</label><div class="inline"><input type="number" id="e-hd" min="0" max="23" value="10"> h à <input type="number" id="e-hf" min="1" max="24" value="18"> h</div></div>
    <div class="field"><label>Formule</label><select id="e-f"><option value="heure">À l’heure</option><option value="demi">Demi-journée</option><option value="jour">Journée</option></select></div>
    <div class="field"><label>Invités</label><input type="number" id="e-i" min="0" value="50"></div>
    <div class="field full"><label>Titre / précisions</label><input id="e-ti" placeholder="Ex. : Mariage Rakoto & Rasoa"></div>
    ${cl.html}
    <div class="field full"><label>Options (matériel, décoration, sono, buffet, personnel…)</label><div id="e-opts"></div><button type="button" class="btn sm" id="e-add">+ Option</button></div>
    <div class="field"><label>Statut</label><select id="e-st"><option value="confirme">Confirmé (bloque la salle)</option><option value="devis">Devis (ne bloque pas)</option></select></div>
    <div class="field"><label>Total estimé</label><div id="e-tot" class="mono" style="font-size:20px;font-weight:800;padding-top:6px">—</div></div>
    <div class="field"><label>Acompte (Ar)</label><input type="number" id="e-ac" min="0"></div><div class="field"><label>Mode / caisse</label><div class="inline"><select id="e-mo">${optModes()}</select><select id="e-c">${caisses.map((c) => `<option value="${c.id}" ${c.id === 'CAI-RECEP' ? 'selected' : ''}>${esc(c.nom)}</option>`).join('') || '<option value="">aucune caisse ouverte</option>'}</select></div></div>
    <div class="field full"><label>Notes</label><textarea id="e-n"></textarea></div></div>`,
  onOpen: (m) => {
    const tot = () => {
      const o = $('#e-s', m).selectedOptions[0]; if (!o) return;
      const h = Math.max(0, Number($('#e-hf', m).value) - Number($('#e-hd', m).value)); const f = $('#e-f', m).value;
      const salle = f === 'jour' ? Number(o.dataset.j) : f === 'demi' ? Number(o.dataset.d) : Number(o.dataset.h) * h;
      $('#e-tot', m).textContent = ar(salle + options.reduce((s, x) => s + (Number(x.montant) || 0), 0));
    };
    const rOpts = () => { $('#e-opts', m).innerHTML = options.map((o, i) => `<div class="inline" style="margin-bottom:6px"><input data-oi="${i}" data-ok="libelle" value="${esc(o.libelle)}" placeholder="Libellé"><input type="number" data-oi="${i}" data-ok="montant" value="${o.montant}" placeholder="Montant" style="max-width:140px"><button type="button" class="btn sm danger" data-od="${i}">×</button></div>`).join(''); tot(); };
    m.addEventListener('input', (e) => { const t = e.target; if (t.dataset.oi !== undefined) options[t.dataset.oi][t.dataset.ok] = t.value; tot(); });
    m.addEventListener('change', tot);
    m.addEventListener('click', (e) => { if (e.target.id === 'e-add') { options.push({ libelle: '', montant: '' }); rOpts(); } const d = e.target.closest('[data-od]'); if (d) { options.splice(d.dataset.od, 1); rOpts(); } });
    rOpts();
  },
  actions: [{ label: 'Annuler' }, { label: 'Enregistrer', cls: 'primary', act: async (m) => {
    const ac = Number($('#e-ac', m).value) || 0;
    const r = await post('/api/evenements', { salle_id: $('#e-s', m).value, type: $('#e-t', m).value, date: $('#e-d', m).value, heure_debut: $('#e-hd', m).value, heure_fin: $('#e-hf', m).value, formule: $('#e-f', m).value,
      invites: $('#e-i', m).value, titre: $('#e-ti', m).value, notes: $('#e-n', m).value, statut: $('#e-st', m).value, ...cl.lire(m),
      options: options.filter((o) => o.libelle && Number(o.montant) >= 0).map((o) => ({ libelle: o.libelle, montant: Number(o.montant) || 0 })),
      ...(ac > 0 ? { acompte: { mode: $('#e-mo', m).value, montant: ac }, caisse_id: $('#e-c', m).value } : {}) }, { idem: uuid() });
    toast(`Événement enregistré — total ${ar(r.total)}.`, 'ok'); if (apres) await apres();
  } }] });
}
async function ficheEvenement(id, apres) {
  const e = await get('/api/evenements/' + id);
  const ac = [{ label: 'Fermer' }, { label: `${icon('print')} Contrat`, act: () => { imprimerContrat(id).catch(erreur); return false; } }];
  if (e.folio_id) ac.push({ label: 'Compte / paiements', act: () => { location.hash = '#/folio/' + e.folio_id; } });
  if (peut('reception', 'S')) {
    if (e.statut === 'devis') ac.push({ label: 'Confirmer', cls: 'primary', act: async () => { await post(`/api/evenements/${id}/confirmer`); toast('Événement confirmé.', 'ok'); if (apres) await apres(); } });
    if (e.statut === 'confirme') ac.push({ label: 'Marquer réalisé (facturer)', cls: 'primary', act: async () => { if (!(await confirmer('Événement réalisé', 'La location et les options vont être facturées sur le compte du client.'))) return false; const r = await post(`/api/evenements/${id}/terminer`); toast('Facturé sur le compte.', 'ok'); location.hash = '#/folio/' + r.folio_id; } });
    if (['devis', 'confirme'].includes(e.statut)) ac.push({ label: 'Annuler', cls: 'danger', act: async () => {
      const motif = await demander('Annuler l’événement', 'Motif'); if (!motif) return false;
      let choix; if (e.paye > 0) { choix = await modal({ titre: 'Acompte versé', corps: `<p>Acompte de <b>${ar(e.paye)}</b>.</p>`, actions: [{ label: 'Retour', value: null }, { label: 'Conserver', value: 'conserver' }, { label: 'Rembourser', cls: 'primary', value: 'rembourser' }] }); if (!choix) return false; }
      await post(`/api/evenements/${id}/annuler`, { motif, acompte: choix }); toast('Événement annulé.', 'ok'); if (apres) await apres();
    } });
  }
  await modal({ titre: `${e.numero} — ${TYPES_EVT.find((t) => t[0] === e.type)?.[1] || e.type}`, actions: ac, corps: `<div class="grid g2">
    <div><small class="muted">Salle</small><br><b>${esc(e.salle)}</b></div><div><small class="muted">Date</small><br><b>${dateFr(e.date)} · ${e.heure_debut}h–${e.heure_fin}h</b></div>
    <div><small class="muted">Client</small><br><b>${esc(e.client)}</b><br>${esc(e.telephone || '')}</div><div><small class="muted">Statut</small><br>${statutTag(e.statut)}</div>
    <div><small class="muted">Location</small><br>${ar(e.montant_salle)}</div><div><small class="muted">Options</small><br>${e.options.map((o) => `${esc(o.libelle)} : ${ar(o.montant)}`).join('<br>') || '—'}</div>
    <div><small class="muted">Total</small><br><b>${ar(e.montant_salle + e.montant_options)}</b></div><div><small class="muted">Déjà payé</small><br><b>${ar(e.paye || 0)}</b></div></div>` });
}
export async function salles(el) {
  await pageCrud(el, { titre: 'Salles', chemin: 'salles', module: 'reception',
    champs: [{ k: 'nom', label: 'Nom', req: true }, { k: 'capacite', label: 'Capacité', type: 'number', min: 1, def: 50 }, { k: 'prix_heure', label: 'Tarif à l’heure (Ar)', type: 'number', min: 0 },
      { k: 'prix_demi', label: 'Tarif demi-journée (Ar)', type: 'number', min: 0 }, { k: 'prix_jour', label: 'Tarif journée (Ar)', type: 'number', min: 0 }, { k: 'description', label: 'Description', type: 'textarea', full: true }],
    cols: [{ k: 'nom', label: 'Salle', f: (r) => `<b>${esc(r.nom)}</b>` }, { k: 'capacite', label: 'Capacité', num: true }, { k: 'prix_heure', label: 'Heure', num: true, f: (r) => ar(r.prix_heure) }, { k: 'prix_demi', label: 'Demi-journée', num: true, f: (r) => ar(r.prix_demi) }, { k: 'prix_jour', label: 'Journée', num: true, f: (r) => ar(r.prix_jour) }] });
}

// ── Bien-être : rendez-vous ──
export async function rdv(el) {
  let jour = aujourdhui();
  const rendre = async () => {
    const rows = await get('/api/rendez-vous' + qs({ du: jour }));
    el.innerHTML = tete('Rendez-vous bien-être', 'Massages, spa, sauna, soins. Conflits de praticien et de cabine bloqués.', `${bouton('', 'prec', 'back')}<input type="date" id="j" value="${jour}" style="width:auto">${bouton('', 'suiv', 'chevron')}${peut('bienetre', 'S') ? bouton('Nouveau rendez-vous', 'nouv', 'plus', 'primary') : ''}`) + '<div id="l"></div>';
    tableau(el.querySelector('#l'), [{ k: 'debut', label: 'Heure', f: (r) => `<b>${r.debut}</b>–${r.fin}` }, { k: 'prestation', label: 'Prestation' }, { k: 'client', label: 'Client', f: (r) => `${esc(r.client)}<br><small class="muted">${esc(r.telephone || '')}</small>` },
      { k: 'praticien', label: 'Praticien', f: (r) => esc(r.praticien || '—') }, { k: 'ressource', label: 'Cabine' }, { k: 'prix', label: 'Prix', num: true, f: (r) => ar(r.prix) }, { k: 'statut', label: 'Statut', f: (r) => statutTag(r.statut) }],
    rows, { recherche: false, vide: 'Aucun rendez-vous ce jour.', actions: (r) => (r.statut === 'prevu' && peut('bienetre', 'S') ? `<button class="btn sm primary" data-fait="${r.id}" data-prix="${r.prix}">Réalisé</button><button class="btn sm" data-abs="${r.id}">Absent</button><button class="btn sm danger" data-ann="${r.id}">Annuler</button>` : '') });
  };
  sur(el, 'change', '#j', (e, i) => { jour = i.value; rendre().catch(erreur); });
  sur(el, 'click', '[data-act=prec],[data-act=suiv]', (e, b) => { jour = plusJours(jour, b.dataset.act === 'prec' ? -1 : 1); rendre().catch(erreur); });
  sur(el, 'click', '[data-act=nouv]', async () => {
    try {
      const [prods, prat] = await Promise.all([get('/api/produits?activite_id=BE'), get('/api/praticiens')]);
      const cl = await champClient();
      await modal({ titre: 'Nouveau rendez-vous', large: true, corps: `<div class="form"><div class="field"><label>Prestation <span class="req">*</span></label><select id="v-p">${prods.map((p) => `<option value="${p.id}">${esc(p.nom)} — ${ar(p.prix)}${p.duree_min ? ` (${p.duree_min} min)` : ''}</option>`).join('')}</select></div>
        <div class="field"><label>Date et heure <span class="req">*</span></label><div class="inline"><input type="date" id="v-d" value="${jour}"><input type="time" id="v-h" value="10:00" step="900"></div></div>
        ${cl.html}<div class="field"><label>Praticien</label><select id="v-pr"><option value="">—</option>${prat.map((p) => `<option value="${p.id}">${esc(p.nom)}</option>`).join('')}</select></div>
        <div class="field"><label>Cabine / salle</label><input id="v-r" placeholder="Cabine 1"></div><div class="field full"><label>Notes</label><textarea id="v-n"></textarea></div></div>`,
      actions: [{ label: 'Annuler' }, { label: 'Enregistrer', cls: 'primary', act: async (m) => {
        await post('/api/rendez-vous', { produit_id: $('#v-p', m).value, date: $('#v-d', m).value, debut: $('#v-h', m).value, praticien_id: $('#v-pr', m).value || null, ressource: $('#v-r', m).value || null, notes: $('#v-n', m).value, ...cl.lire(m) }, { idem: uuid() });
        toast('Rendez-vous enregistré.', 'ok');
      } }] });
      await rendre();
    } catch (err) { erreur(err); }
  });
  sur(el, 'click', '[data-fait]', async (e, b) => {
    try {
      const choix = await modal({ titre: 'Prestation réalisée', corps: '<p>Comment le client règle-t-il ?</p>', actions: [{ label: 'Annuler', value: null }, { label: 'Au compte séjour', value: 'folio' }, { label: 'Encaisser maintenant', cls: 'primary', value: 'payer' }] });
      if (!choix) return;
      if (choix === 'payer') {
        const p = await fenetrePaiement(Number(b.dataset.prix), { remiseAutorisee: false }); if (!p) return;
        const r = await post(`/api/rendez-vous/${b.dataset.fait}/realiser`, { paiements: p.paiements }, { idem: uuid() });
        toast(r.rendu ? `Encaissé. Rendu : ${ar(r.rendu)}` : 'Encaissé.', 'ok');
        if (p.imprimer) (await import('../print.js')).imprimerTicket(r.document_id);
      } else {
        const fs = await get('/api/folios?statut=ouvert');
        const f = await modal({ titre: 'Compte séjour', corps: `<select id="ff">${fs.map((x) => `<option value="${x.id}">${esc(x.libelle || x.numero)} · ${esc(x.client || '')}</option>`).join('')}</select>`, actions: [{ label: 'Annuler' }, { label: 'Valider', cls: 'primary', act: (m) => $('#ff', m).value || false }] });
        if (!f) return;
        await post(`/api/rendez-vous/${b.dataset.fait}/realiser`, { au_folio: true, folio_id: f }, { idem: uuid() }); toast('Porté au compte séjour.', 'ok');
      }
      await rendre();
    } catch (err) { erreur(err); }
  });
  sur(el, 'click', '[data-abs],[data-ann]', async (e, b) => { try { await post(`/api/rendez-vous/${b.dataset.abs || b.dataset.ann}/statut`, { statut: b.dataset.abs ? 'absent' : 'annule' }); await rendre(); } catch (err) { erreur(err); } });
  await rendre();
}

// ── Clients ──
export async function clients(el, route) {
  await pageCrud(el, { titre: 'Clients', sous: 'Une seule fiche par client pour toutes les activités (séjours, repas, soins, événements, boutique).', chemin: 'clients', module: 'clients',
    champs: [{ k: 'nom', label: 'Nom', req: true }, { k: 'telephone', label: 'Téléphone' }, { k: 'email', label: 'Email', type: 'email' }, { k: 'type', label: 'Type', type: 'select', vide: false, opts: [['particulier', 'Particulier'], ['professionnel', 'Professionnel']] },
      { k: 'entreprise', label: 'Entreprise' }, { k: 'nif', label: 'NIF' }, { k: 'stat', label: 'STAT' }, { k: 'adresse', label: 'Adresse' }, { k: 'notes', label: 'Préférences / notes', type: 'textarea', full: true }],
    cols: [{ k: 'nom', label: 'Nom', f: (r) => `<b>${esc(r.nom)}</b>${r.entreprise ? `<br><small class="muted">${esc(r.entreprise)}</small>` : ''}` }, { k: 'telephone', label: 'Téléphone' }, { k: 'email', label: 'Email' },
      { k: 'type', label: 'Type', f: (r) => (r.type === 'professionnel' ? '<span class="tag info">Pro</span>' : '') }, { k: 'points', label: 'Points fidélité', num: true }],
    actionsLigne: (r) => `<button class="btn sm" data-act="histo" data-id="${r.id}">Historique</button>`,
    surAction: async (a, r) => { if (a === 'histo') await historique(r); },
    apres: (e, rows) => { if (route.query.id) { const r = rows.find((x) => x.id === route.query.id); if (r) historique(r).catch(erreur); } } });
}
async function historique(c) {
  const h = await get(`/api/clients/${c.id}/historique`);
  const bloc = (t, rows, f) => `<h3 style="margin:14px 0 6px;font-size:14px">${t} (${rows.length})</h3>${rows.length ? `<table class="t">${rows.map(f).join('')}</table>` : '<p class="muted">—</p>'}`;
  await modal({ titre: `Historique — ${c.nom}`, large: true, corps: `${c.notes ? `<div class="banner info">${esc(c.notes)}</div>` : ''}
    ${bloc('Comptes', h.folios, (f) => `<tr><td><a href="#/folio/${f.id}">${esc(f.numero)}</a></td><td>${esc(f.libelle || '')}</td><td>${statutTag(f.statut)}</td><td class="num"><b class="${f.solde > 0 ? 'late' : ''}">${ar(f.solde)}</b></td></tr>`)}
    ${bloc('Séjours', h.sejours, (s) => `<tr><td>${esc(s.numero || '')}</td><td>${esc(s.bungalow)}</td><td>${dateFr(s.arrivee)} → ${dateFr(s.depart)}</td><td>${statutTag(s.statut)}</td></tr>`)}
    ${bloc('Achats', h.achats, (a) => `<tr><td>${esc(a.numero)}</td><td>${dateFr(a.jour)}</td><td>${esc(a.activite || '')}</td><td class="num">${ar(a.total)}</td></tr>`)}
    ${bloc('Bien-être', h.rdv, (r) => `<tr><td>${dateFr(r.date)} ${r.debut}</td><td>${esc(r.prestation)}</td><td>${statutTag(r.statut)}</td></tr>`)}
    ${bloc('Événements', h.evenements, (e) => `<tr><td>${dateFr(e.date)}</td><td>${esc(e.type)}</td><td>${esc(e.salle)}</td><td>${statutTag(e.statut)}</td></tr>`)}` });
}
