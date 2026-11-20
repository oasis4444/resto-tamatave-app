// Hébergement : planning, réservations, comptes séjour, ménage, bungalows.
import { S, get, post, put, esc, ar, dateFr, dateHeureFr, aujourdhui, plusJours, JOURS, MODES, tete, bouton, sur, modal, toast, erreur, confirmer, demander, tableau, statutTag, peut, qs, $, formulaire, lireFormulaire } from '../core.js';
import { icon } from '../icons.js';
import { pageCrud } from '../crudpage.js';
import { imprimerFolio } from '../print.js';

const optModes = (sel = 'especes') => Object.entries(MODES).map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${l}</option>`).join('');
async function optCaisses(defaut) {
  try {
    const c = (await get('/api/caisses')).filter((x) => x.session_id);
    if (!c.length) return '<option value="">Aucune caisse ouverte</option>';
    return c.map((x) => `<option value="${x.id}" ${x.id === defaut ? 'selected' : ''}>${esc(x.nom)}</option>`).join('');
  } catch { return `<option value="${defaut}">Caisse par défaut</option>`; }
}

// ── Nouvelle réservation ──
export async function nouvelleReservation(pre = {}, apres) {
  const clients = await get('/api/clients?limite=2000').catch(() => []);
  const caisses = await optCaisses('CAI-BUNG');
  await modal({ titre: 'Nouvelle réservation', large: true, corps: `
    <div class="form">
      <div class="field"><label>Arrivée <span class="req">*</span></label><input type="date" id="r-a" value="${pre.arrivee || aujourdhui()}" min="${plusJours(aujourdhui(), -1)}"></div>
      <div class="field"><label>Départ <span class="req">*</span></label><input type="date" id="r-d" value="${pre.depart || plusJours(pre.arrivee || aujourdhui(), 1)}"></div>
      <div class="field full"><label>Bungalow disponible <span class="req">*</span></label><div id="r-dispo" class="muted">Choisissez les dates…</div></div>
      <div class="field"><label>Adultes</label><input type="number" id="r-ad" value="2" min="1"></div><div class="field"><label>Enfants</label><input type="number" id="r-en" value="0" min="0"></div>
      <div class="field"><label>Client <span class="req">*</span></label><input id="r-cl" list="r-cls" placeholder="Nom (ou choisir un client existant)"><datalist id="r-cls">${clients.map((c) => `<option value="${esc(c.nom)}${c.telephone ? ' — ' + esc(c.telephone) : ''}">`).join('')}</datalist></div>
      <div class="field"><label>Téléphone</label><input id="r-tel" placeholder="034 00 000 00" inputmode="tel"></div>
      <div class="field"><label>Acompte (Ar)</label><input type="number" id="r-ac" min="0" placeholder="0"></div>
      <div class="field"><label>Mode de l’acompte</label><select id="r-mode">${optModes()}</select></div>
      <div class="field"><label>Référence (MVola…)</label><input id="r-ref"></div><div class="field"><label>Caisse</label><select id="r-caisse">${caisses}</select></div>
      <div class="field full"><label>Notes</label><textarea id="r-notes" placeholder="Heure d’arrivée, demandes particulières…"></textarea></div>
    </div>`,
  onOpen: (m) => {
    const dispo = async () => {
      const a = $('#r-a', m).value, d = $('#r-d', m).value;
      if (!a || !d || d <= a) { $('#r-dispo', m).innerHTML = '<span class="late">Le départ doit être après l’arrivée.</span>'; return; }
      try {
        const l = await get('/api/disponibilites' + qs({ arrivee: a, depart: d }));
        $('#r-dispo', m).innerHTML = l.length ? `<div class="grid g3">${l.map((b) => `<label class="card" style="padding:10px;cursor:pointer;display:flex;gap:8px"><input type="radio" name="r-b" value="${b.id}" ${b.id === pre.bungalow_id ? 'checked' : ''}>
          <span><b>${esc(b.nom)}</b><br><small class="muted">${esc(b.type || '')} · ${b.capacite} pers.</small><br><b class="mono">${ar(b.total)}</b> <small class="muted">${b.nuits} nuit(s)</small></span></label>`).join('')}</div>`
          : '<span class="late">Aucun bungalow libre sur ces dates.</span>';
      } catch (e) { $('#r-dispo', m).textContent = e.message; }
    };
    $('#r-a', m).addEventListener('change', () => { if ($('#r-d', m).value <= $('#r-a', m).value) $('#r-d', m).value = plusJours($('#r-a', m).value, 1); dispo(); });
    $('#r-d', m).addEventListener('change', dispo);
    $('#r-cl', m).addEventListener('change', () => { const c = clients.find((x) => `${x.nom}${x.telephone ? ' — ' + x.telephone : ''}` === $('#r-cl', m).value); if (c) $('#r-tel', m).value = c.telephone || ''; });
    dispo();
  },
  actions: [{ label: 'Annuler' }, { label: 'Réserver', cls: 'primary', act: async (m) => {
    const b = m.querySelector('input[name=r-b]:checked');
    if (!b) throw new Error('Choisissez un bungalow disponible.');
    const v = $('#r-cl', m).value.trim();
    if (!v) throw new Error('Indiquez le client.');
    const ex = clients.find((x) => `${x.nom}${x.telephone ? ' — ' + x.telephone : ''}` === v);
    const ac = Number($('#r-ac', m).value) || 0;
    const r = await post('/api/reservations', {
      bungalow_id: b.value, arrivee: $('#r-a', m).value, depart: $('#r-d', m).value, adultes: $('#r-ad', m).value, enfants: $('#r-en', m).value, notes: $('#r-notes', m).value,
      ...(ex ? { client_id: ex.id } : { client_nom: v, client_telephone: $('#r-tel', m).value }),
      ...(ac > 0 ? { acompte: { mode: $('#r-mode', m).value, montant: ac, reference: $('#r-ref', m).value }, caisse_id: $('#r-caisse', m).value } : {}),
    });
    toast(`Réservation enregistrée — total prévu ${ar(r.total_prevu)}.`, 'ok');
    if (apres) await apres();
  } }] });
}

// ── Fiche réservation (actions) ──
export async function ficheReservation(id, apres) {
  const r = await get('/api/reservations/' + id);
  const ac = [];
  ac.push({ label: 'Fermer' });
  if (r.folio_id) ac.push({ label: `${icon('wallet')} Compte séjour`, act: () => { location.hash = '#/folio/' + r.folio_id; } });
  if (peut('hebergement', 'S')) {
    if (r.statut === 'reservee') {
      ac.push({ label: 'Annuler la réservation', cls: 'danger', act: async () => {
        const motif = await demander('Annuler la réservation', 'Motif de l’annulation'); if (!motif) return false;
        const f = await get('/api/folios/' + r.folio_id);
        let choix;
        if (f.paye > 0) {
          choix = await modal({ titre: 'Acompte versé', corps: `<p>Un acompte de <b>${ar(f.paye)}</b> a été versé. Que faire ?</p>`, actions: [{ label: 'Retour', value: null }, { label: 'Conserver (frais d’annulation)', value: 'conserver' }, { label: 'Rembourser le client', cls: 'primary', value: 'rembourser' }] });
          if (!choix) return false;
        }
        await post(`/api/reservations/${r.id}/annuler`, { motif, acompte: choix }); toast('Réservation annulée.', 'ok'); if (apres) await apres();
      } });
      ac.push({ label: 'Modifier', act: async () => { await modifierResa(r, apres); } });
      ac.push({ label: `${icon('check')} Check-in`, cls: 'primary', act: async () => { await post(`/api/reservations/${r.id}/checkin`); toast('Client installé : les nuits sont portées sur son compte.', 'ok'); if (apres) await apres(); } });
    }
    if (r.statut === 'en_cours') {
      ac.push({ label: 'Prolonger', act: async () => {
        const d = await demander('Prolonger le séjour', 'Nouvelle date de départ', { type: 'date', def: plusJours(r.depart, 1) }); if (!d) return false;
        const x = await post(`/api/reservations/${r.id}/prolonger`, { depart: d }); toast(`Séjour prolongé (+${ar(x.supplement)}).`, 'ok'); if (apres) await apres();
      } });
      ac.push({ label: `${icon('door')} Check-out`, cls: 'primary', act: async () => checkout(r, apres) });
    }
  }
  await modal({ titre: `Réservation ${r.numero || ''}`, corps: `<div class="grid g2">
    <div><small class="muted">Client</small><br><b>${esc(r.client)}</b><br>${esc(r.telephone || '')}</div><div><small class="muted">Bungalow</small><br><b>${esc(r.bungalow)}</b></div>
    <div><small class="muted">Séjour</small><br><b>${dateFr(r.arrivee)} → ${dateFr(r.depart)}</b></div><div><small class="muted">Statut</small><br>${statutTag(r.statut)}</div>
    <div><small class="muted">Personnes</small><br>${r.adultes} adulte(s), ${r.enfants} enfant(s)</div><div><small class="muted">Créée le</small><br>${dateHeureFr(r.cree_le)}</div>
    ${r.notes ? `<div class="full" style="grid-column:1/-1"><small class="muted">Notes</small><br>${esc(r.notes).replace(/\n/g, '<br>')}</div>` : ''}</div>`, actions: ac });
}
async function checkout(r, apres) {
  try { await post(`/api/reservations/${r.id}/checkout`); toast('Départ enregistré, facture numérotée. Bungalow envoyé au ménage.', 'ok'); if (await confirmer('Facture', 'Imprimer la facture du séjour ?', 'Imprimer')) imprimerFolio(r.folio_id); if (apres) await apres(); }
  catch (e) {
    if (['SOLDE_DU', 'TROP_PERCU'].includes(e.code)) { toast(e.message, 'err', 8000); location.hash = '#/folio/' + r.folio_id; return; }
    throw e;
  }
}
async function modifierResa(r, apres) {
  const bs = await get('/api/bungalows');
  const ch = [{ k: 'bungalow_id', label: 'Bungalow', type: 'select', req: true, vide: false, opts: bs.map((b) => [b.id, `${b.nom} (${b.capacite} pers.)`]) },
    { k: 'arrivee', label: 'Arrivée', type: 'date', req: true }, { k: 'depart', label: 'Départ', type: 'date', req: true },
    { k: 'adultes', label: 'Adultes', type: 'number', min: 1 }, { k: 'enfants', label: 'Enfants', type: 'number', min: 0 }, { k: 'notes', label: 'Notes', type: 'textarea', full: true }];
  await modal({ titre: 'Modifier la réservation', corps: formulaire(ch, r), actions: [{ label: 'Annuler' }, { label: 'Enregistrer', cls: 'primary', act: async (m) => {
    await put('/api/reservations/' + r.id, { ...lireFormulaire(m, ch), version: r.version }); toast('Réservation modifiée.', 'ok'); if (apres) await apres();
  } }] });
}

// ── Planning ──
export async function planning(el) {
  let du = sessionStorage.getItem('rt_plan_du') || plusJours(aujourdhui(), -1);
  const n = window.innerWidth < 860 ? 7 : 14;
  const rendre = async () => {
    const p = await get('/api/planning' + qs({ du, jours: n }));
    const jours = Array.from({ length: n }, (_, i) => plusJours(p.du, i));
    el.innerHTML = tete('Planning des bungalows', 'Cliquez sur une case libre pour réserver, sur une réservation pour l’ouvrir.',
      `${bouton('', 'prec', 'back', '', 'title="Période précédente"')}${bouton('Aujourd’hui', 'auj')}${bouton('', 'suiv', 'chevron', '', 'title="Période suivante"')}<input type="date" id="pl-du" value="${p.du}" style="width:auto">${peut('hebergement', 'S') ? bouton('Réserver', 'nouv', 'plus', 'primary') : ''}`)
    + `<div class="legend" style="margin-bottom:10px"><span><i style="background:var(--info)"></i>Réservé</span><span><i style="background:var(--ok)"></i>Client présent</span><span><i style="background:var(--warn)"></i>À nettoyer</span><span><i style="background:var(--danger)"></i>Maintenance / hors service</span></div>
      <div class="table-wrap"><table class="planning"><thead><tr><th style="text-align:left;padding-left:12px">Bungalow</th>${jours.map((j) => `<th class="${j === p.aujourdhui ? 'today' : ''}">${JOURS[new Date(j + 'T00:00:00Z').getUTCDay()]}<br>${j.slice(8)}/${j.slice(5, 7)}</th>`).join('')}</tr></thead>
      <tbody>${p.bungalows.map((b) => {
        let cells = ''; let i = 0;
        while (i < n) {
          const j = jours[i];
          const r = p.reservations.find((x) => x.bungalow_id === b.id && x.arrivee <= j && x.depart > j);
          if (r) {
            let span = 0; while (i + span < n && r.depart > jours[i + span]) span++;
            cells += `<td colspan="${span}"><div class="resa ${r.statut}" data-resa="${r.id}" title="${esc(r.client)} · ${dateFr(r.arrivee)} → ${dateFr(r.depart)}">${esc(r.client)}</div></td>`;
            i += span;
          } else {
            const we = [5, 6].includes(new Date(j + 'T00:00:00Z').getUTCDay());
            cells += `<td class="libre ${we ? 'we' : ''}" data-b="${b.id}" data-j="${j}" title="Libre — cliquer pour réserver"></td>`; i++;
          }
        }
        const etat = b.etat !== 'propre' ? ` <span class="tag ${b.etat === 'nettoyage' ? 'warn' : 'danger'}">${{ nettoyage: 'à nettoyer', maintenance: 'maintenance', hors_service: 'hors service' }[b.etat]}</span>` : '';
        return `<tr><td class="b"><b>${esc(b.nom)}</b>${etat}<br><small class="muted">${esc(b.type || '')} · ${b.capacite} pers. · ${ar(b.prix_nuit)}</small></td>${cells}</tr>`;
      }).join('') || `<tr><td class="b" colspan="${n + 1}"><div class="empty">Aucun bungalow. <a href="#/bungalows">Ajouter des bungalows</a></div></td></tr>`}</tbody></table></div>`;
  };
  sur(el, 'click', '[data-act]', async (e, b) => {
    const a = b.dataset.act;
    if (a === 'prec') du = plusJours(du, -n + 1); else if (a === 'suiv') du = plusJours(du, n - 1); else if (a === 'auj') du = plusJours(aujourdhui(), -1);
    else if (a === 'nouv') return nouvelleReservation({}, rendre).catch(erreur);
    sessionStorage.setItem('rt_plan_du', du); rendre().catch(erreur);
  });
  sur(el, 'change', '#pl-du', (e, i) => { du = i.value; sessionStorage.setItem('rt_plan_du', du); rendre().catch(erreur); });
  sur(el, 'click', '[data-resa]', (e, d) => ficheReservation(d.dataset.resa, rendre).catch(erreur));
  sur(el, 'click', 'td.libre', (e, td) => { if (peut('hebergement', 'S')) nouvelleReservation({ bungalow_id: td.dataset.b, arrivee: td.dataset.j, depart: plusJours(td.dataset.j, 1) }, rendre).catch(erreur); });
  await rendre();
  const t = setInterval(() => { if (!document.querySelector('.modal-bg') && document.visibilityState === 'visible') rendre().catch(() => {}); }, 60000);
  return () => clearInterval(t);
}

// ── Liste des réservations ──
export async function reservations(el) {
  let statut = 'actives';
  const rendre = async () => {
    const rows = await get('/api/reservations' + qs(statut === 'actives' ? { du: aujourdhui() } : { statut }));
    const liste = statut === 'actives' ? rows.filter((r) => ['reservee', 'en_cours'].includes(r.statut)) : rows;
    el.innerHTML = tete('Réservations', '', `<div class="seg">${[['actives', 'À venir / en cours'], ['terminee', 'Terminées'], ['annulee', 'Annulées']].map(([k, l]) => `<button data-s="${k}" class="${k === statut ? 'on' : ''}">${l}</button>`).join('')}</div>${peut('hebergement', 'S') ? bouton('Réserver', 'nouv', 'plus', 'primary') : ''}`) + '<div id="l"></div>';
    tableau(el.querySelector('#l'), [
      { k: 'numero', label: 'N°' }, { k: 'client', label: 'Client', f: (r) => `<b>${esc(r.client)}</b><br><small class="muted">${esc(r.telephone || '')}</small>` }, { k: 'bungalow', label: 'Bungalow' },
      { k: 'arrivee', label: 'Arrivée', f: (r) => dateFr(r.arrivee) }, { k: 'depart', label: 'Départ', f: (r) => dateFr(r.depart) }, { k: 'statut', label: 'Statut', f: (r) => statutTag(r.statut) },
    ], liste, { actions: (r) => `<button class="btn sm" data-ouv="${r.id}">Ouvrir</button>` });
  };
  sur(el, 'click', '[data-s]', (e, b) => { statut = b.dataset.s; rendre().catch(erreur); });
  sur(el, 'click', '[data-act=nouv]', () => nouvelleReservation({}, rendre).catch(erreur));
  sur(el, 'click', '[data-ouv]', (e, b) => ficheReservation(b.dataset.ouv, rendre).catch(erreur));
  await rendre();
}

// ── Comptes séjour ──
export async function folios(el) {
  let statut = 'ouvert';
  const rendre = async () => {
    const rows = await get('/api/folios?statut=' + statut);
    el.innerHTML = tete('Comptes séjour et comptes clients', 'Consommations (restaurant, bien-être, boutique…) regroupées sur une seule facture.',
      `<div class="seg">${[['ouvert', 'Ouverts'], ['clos', 'Clôturés'], ['annule', 'Annulés']].map(([k, l]) => `<button data-s="${k}" class="${k === statut ? 'on' : ''}">${l}</button>`).join('')}</div>${peut('hebergement', 'S') ? bouton('Ouvrir un compte client', 'nouv', 'plus') : ''}`) + '<div id="l"></div>';
    tableau(el.querySelector('#l'), [
      { k: 'numero', label: 'N°', f: (r) => esc(r.facture_numero || r.numero) }, { k: 'libelle', label: 'Compte' }, { k: 'client', label: 'Client' },
      { k: 'du', label: 'Total', num: true, f: (r) => ar(r.du) }, { k: 'paye', label: 'Payé', num: true, f: (r) => ar(r.paye) },
      { k: 'solde', label: 'Reste', num: true, tri: (r) => r.du - r.paye, f: (r) => `<b class="${r.du - r.paye > 0 ? 'late' : ''}">${ar(r.du - r.paye)}</b>` },
    ], rows, { actions: (r) => `<a class="btn sm" href="#/folio/${r.id}">Ouvrir</a>` });
  };
  sur(el, 'click', '[data-s]', (e, b) => { statut = b.dataset.s; rendre().catch(erreur); });
  sur(el, 'click', '[data-act=nouv]', async () => {
    try {
      const ch = [{ k: 'client_nom', label: 'Nom du client', req: true }, { k: 'client_telephone', label: 'Téléphone' }, { k: 'libelle', label: 'Libellé du compte', full: true, ph: 'Ex. : Société X – séminaire' }];
      const r = await modal({ titre: 'Ouvrir un compte client', corps: formulaire(ch), actions: [{ label: 'Annuler' }, { label: 'Ouvrir', cls: 'primary', act: async (m) => post('/api/folios', lireFormulaire(m, ch)) }] });
      if (r) location.hash = '#/folio/' + r.id;
    } catch (e) { erreur(e); }
  });
  await rendre();
}

export async function folio(el, route) {
  const id = route.params[0];
  const rendre = async () => {
    const f = await get('/api/folios/' + id);
    const r = f.reservation;
    el.innerHTML = tete(`${f.facture_numero ? 'Facture ' + f.facture_numero : 'Compte ' + f.numero}`, `${esc(f.libelle || '')} · ${esc(f.client || '')} ${statutTag(f.statut)}`,
      `${bouton('Imprimer', 'imp', 'print')}${f.statut === 'ouvert' && peut('hebergement', 'S') ? bouton('Encaisser', 'pay', 'cash', 'primary') : ''}
       ${f.statut === 'ouvert' && f.solde < 0 && peut('hebergement', 'V') ? bouton('Rembourser', 'remb', 'back', 'danger') : ''}
       ${r && r.statut === 'en_cours' && peut('hebergement', 'S') ? bouton('Check-out', 'co', 'door') : ''}
       ${!r && f.statut === 'ouvert' && peut('hebergement', 'S') ? bouton('Clôturer', 'clos', 'check') : ''}`)
    + `${r ? `<div class="banner info">${icon('bed')} ${esc(r.bungalow)} · du ${dateFr(r.arrivee)} au ${dateFr(r.depart)} · ${statutTag(r.statut)}</div>` : ''}
      <div class="grid g3" style="margin-bottom:16px"><div class="card kpi"><span class="ico" style="--c:#0e7490">${icon('receipt')}</span><div><small>Total consommé</small><b class="mono">${ar(f.du)}</b></div></div>
      <div class="card kpi"><span class="ico" style="--c:#16a34a">${icon('cash')}</span><div><small>Déjà payé</small><b class="mono">${ar(f.paye)}</b></div></div>
      <div class="card kpi"><span class="ico" style="--c:${f.solde > 0 ? '#dc2626' : '#16a34a'}">${icon('wallet')}</span><div><small>${f.solde < 0 ? 'Trop-perçu à rembourser' : 'Reste à payer'}</small><b class="mono">${ar(Math.abs(f.solde))}</b></div></div></div>
      <div class="grid g2"><div class="card"><h3>Consommations</h3><div id="lg"></div></div><div class="card"><h3>Paiements</h3><div id="pm"></div></div></div>`;
    el.querySelectorAll('.banner svg').forEach((s) => s.setAttribute('style', 'width:18px;height:18px'));
    tableau(el.querySelector('#lg'), [{ k: 'jour', label: 'Date', f: (l) => dateFr(l.jour) }, { k: 'libelle', label: 'Désignation', f: (l) => `${l.annule ? '<s>' : ''}${esc(l.libelle)}${l.annule ? '</s> <span class="tag">annulé</span>' : ''}<br><small class="muted">${esc(l.activite_nom || '')}</small>` },
      { k: 'montant', label: 'Montant', num: true, f: (l) => ar(l.montant) }], f.lignes, { recherche: false, vide: 'Aucune consommation.' });
    tableau(el.querySelector('#pm'), [{ k: 'quand', label: 'Date', f: (p) => dateHeureFr(p.quand) }, { k: 'mode', label: 'Mode', f: (p) => `${esc(MODES[p.mode])}<br><small class="muted">${esc(p.nature)} ${esc(p.reference || '')}</small>` },
      { k: 'montant', label: 'Montant', num: true, f: (p) => ar(p.montant) }], f.paiements, { recherche: false, vide: 'Aucun paiement.' });
    el._f = f;
  };
  sur(el, 'click', '[data-act]', async (e, b) => {
    const f = el._f;
    try {
      if (b.dataset.act === 'imp') return imprimerFolio(id);
      if (b.dataset.act === 'pay' || b.dataset.act === 'remb') {
        const remb = b.dataset.act === 'remb';
        const caisses = await optCaisses(f.reservation ? 'CAI-BUNG' : '');
        await modal({ titre: remb ? 'Rembourser le client' : 'Encaisser', corps: `<div class="form"><div class="field"><label>Montant (Ar)</label><input type="number" id="p-m" value="${Math.abs(f.solde) || ''}" min="1"></div>
          <div class="field"><label>Mode</label><select id="p-mode">${optModes()}</select></div><div class="field"><label>Référence (MVola, carte…)</label><input id="p-ref"></div><div class="field"><label>Caisse</label><select id="p-c">${caisses}</select></div></div>`,
        actions: [{ label: 'Annuler' }, { label: remb ? 'Rembourser' : 'Encaisser', cls: 'primary', act: async (m) => {
          if (!$('#p-c', m).value) throw new Error('Aucune caisse ouverte : ouvrez une caisse dans Finances › Caisses.');
          await post(`/api/folios/${id}/paiements`, { montant: $('#p-m', m).value, mode: $('#p-mode', m).value, reference: $('#p-ref', m).value, caisse_id: $('#p-c', m).value, nature: remb ? 'remboursement' : undefined }, { idem: crypto.randomUUID() });
          toast('Paiement enregistré.', 'ok');
        } }] });
      } else if (b.dataset.act === 'co') await checkout({ id: f.reservation.id, folio_id: id });
      else if (b.dataset.act === 'clos') { if (await confirmer('Clôturer', 'Clôturer ce compte et numéroter la facture ?')) { await post(`/api/folios/${id}/cloturer`); toast('Compte clôturé.', 'ok'); } }
      await rendre();
    } catch (err) { erreur(err); }
  });
  await rendre();
}

// ── Ménage et état ──
export async function menage(el) {
  const rendre = async () => {
    const bs = await get('/api/bungalows');
    const p = await get('/api/planning?jours=1');
    el.innerHTML = tete('Ménage et état des bungalows', 'Un bungalow libéré passe automatiquement « à nettoyer ».') + `<div class="grid g3">${bs.map((b) => {
      const r = p.reservations.find((x) => x.bungalow_id === b.id);
      return `<div class="card"><div class="row"><span class="ico" style="--c:${b.etat === 'propre' ? '#16a34a' : b.etat === 'nettoyage' ? '#d97706' : '#dc2626'}">${icon(b.etat === 'nettoyage' ? 'broom' : b.etat === 'propre' ? 'check' : 'alert')}</span><div><b>${esc(b.nom)}</b><br>${statutTag(b.etat)} ${r ? statutTag(r.statut === 'en_cours' ? 'en_cours' : 'reservee') : '<span class="tag">Libre</span>'}</div></div>
        ${peut('hebergement', 'S') ? `<div class="row" style="margin-top:12px">${b.etat !== 'propre' ? `<button class="btn sm ok" data-e="propre" data-id="${b.id}">${icon('check')} Propre</button>` : ''}${b.etat === 'propre' ? `<button class="btn sm" data-e="nettoyage" data-id="${b.id}">À nettoyer</button>` : ''}
        ${b.etat !== 'maintenance' ? `<button class="btn sm danger" data-e="maintenance" data-id="${b.id}">Panne / maintenance</button>` : ''}</div>` : ''}</div>`;
    }).join('') || '<div class="empty">Aucun bungalow.</div>'}</div>`;
  };
  sur(el, 'click', '[data-e]', async (e, b) => {
    try {
      let note = null;
      if (b.dataset.e === 'maintenance') { note = await demander('Signaler une panne', 'Description du problème'); if (!note) return; }
      await put(`/api/bungalows/${b.dataset.id}/etat`, { etat: b.dataset.e, note }); toast('État mis à jour.', 'ok'); await rendre();
    } catch (err) { erreur(err); }
  });
  await rendre();
  const t = setInterval(() => { if (document.visibilityState === 'visible') rendre().catch(() => {}); }, 60000);
  return () => clearInterval(t);
}

export async function bungalows(el) {
  await pageCrud(el, { titre: 'Bungalows', sous: 'Fiches, capacité et tarifs (nuit, week-end, jours fériés).', chemin: 'bungalows', module: 'hebergement',
    champs: [{ k: 'nom', label: 'Nom', req: true }, { k: 'type', label: 'Type', ph: 'Standard, familial, vue mer…' }, { k: 'capacite', label: 'Capacité (personnes)', type: 'number', min: 1, def: 2 },
      { k: 'prix_nuit', label: 'Prix par nuit (Ar)', type: 'number', req: true, min: 0 }, { k: 'prix_weekend', label: 'Prix nuit week-end (Ar)', type: 'number', min: 0, hint: 'Nuits de vendredi et samedi' },
      { k: 'prix_ferie', label: 'Prix nuit fériée (Ar)', type: 'number', min: 0 }, { k: 'prix_journee', label: 'Prix journée (Ar)', type: 'number', min: 0 },
      { k: 'etat', label: 'État', type: 'select', vide: false, opts: [['propre', 'Propre'], ['nettoyage', 'À nettoyer'], ['maintenance', 'Maintenance'], ['hors_service', 'Hors service']] },
      { k: 'description', label: 'Description', type: 'textarea', full: true }],
    cols: [{ k: 'nom', label: 'Nom', f: (r) => `<b>${esc(r.nom)}</b>` }, { k: 'type', label: 'Type' }, { k: 'capacite', label: 'Pers.', num: true }, { k: 'prix_nuit', label: 'Nuit', num: true, f: (r) => ar(r.prix_nuit) },
      { k: 'prix_weekend', label: 'Week-end', num: true, f: (r) => (r.prix_weekend ? ar(r.prix_weekend) : '—') }, { k: 'etat', label: 'État', f: (r) => statutTag(r.etat) }] });
}
