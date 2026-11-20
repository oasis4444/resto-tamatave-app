// Administration : utilisateurs, rôles, paramètres, jours fériés, audit, sauvegardes, appareils.
import { S, get, post, put, esc, dateFr, dateHeureFr, aujourdhui, plusJours, tete, bouton, sur, modal, toast, erreur, confirmer, demander, tableau, statutTag, peut, qs, $, $$, formulaire, lireFormulaire, compresserImage, telecharger } from '../core.js';
import { icon } from '../icons.js';

const MODULES_NOMS = { tableau: 'Tableau de bord', hebergement: 'Hébergement', reception: 'Salle de réception', ventes: 'Ventes / caisse', cuisine: 'Cuisine', bienetre: 'Bien-être', catalogue: 'Catalogue',
  stocks: 'Stocks', caisses: 'Caisses', depenses: 'Dépenses', clients: 'Clients', rapports: 'Rapports financiers', utilisateurs: 'Utilisateurs', parametres: 'Paramètres', sauvegardes: 'Sauvegardes', audit: 'Journal d’audit' };

const montrerMdp = (titre, id, mdp) => modal({ titre, corps: `<p>Identifiant : <b>${esc(id)}</b></p><p>Mot de passe temporaire :</p><p class="mono" style="font-size:22px;font-weight:800;user-select:all;background:var(--surface-2);padding:12px;border-radius:10px;text-align:center">${esc(mdp)}</p>
  <div class="banner warn">Notez-le et remettez-le en main propre. Il ne sera plus affiché. L’utilisateur devra le changer à sa première connexion.</div>` });

export async function utilisateurs(el) {
  const { roles } = await get('/api/roles');
  const champs = (u) => [{ k: 'identifiant', label: 'Identifiant de connexion', req: !u, ph: 'ex. hery.caisse' }, { k: 'nom', label: 'Nom complet', req: true },
    { k: 'role_id', label: 'Rôle', type: 'select', req: true, opts: roles.filter((r) => r.code !== 'super_adm' || S.moi.role === 'super_adm').map((r) => [r.id, r.nom]) },
    { k: 'telephone', label: 'Téléphone' }, { k: 'email', label: 'Email', type: 'email' },
    ...(u ? [{ k: 'statut', label: 'Statut', type: 'select', vide: false, opts: [['actif', 'Actif'], ['suspendu', 'Suspendu'], ['desactive', 'Désactivé']] }] : [])];
  const actsHtml = (val = '*') => `<div class="field full"><label>Activités accessibles</label><label class="inline"><input type="checkbox" id="u-all" ${val === '*' ? 'checked' : ''}> Toutes</label>
    <div class="row" id="u-acts" style="margin-top:6px">${S.activites.map((a) => `<label class="inline tag"><input type="checkbox" value="${a.id}" ${val === '*' || val.split(',').includes(a.id) ? 'checked' : ''}> ${esc(a.nom)}</label>`).join('')}</div></div>`;
  const lireActs = (m) => ($('#u-all', m).checked ? '*' : $$('#u-acts input:checked', m).map((i) => i.value).join(','));
  const rendre = async () => {
    const rows = await get('/api/utilisateurs');
    el.innerHTML = tete('Utilisateurs', 'Seuls les administrateurs créent les comptes. Le mot de passe temporaire doit être changé à la première connexion.', peut('utilisateurs', 'S') ? bouton('Nouvel utilisateur', 'nouv', 'plus', 'primary') : '') + '<div id="l"></div>';
    tableau(el.querySelector('#l'), [{ k: 'nom', label: 'Nom', f: (u) => `<b>${esc(u.nom)}</b><br><small class="muted">${esc(u.identifiant)}</small>` }, { k: 'role_nom', label: 'Rôle' },
      { k: 'activites', label: 'Activités', f: (u) => (u.activites === '*' ? 'Toutes' : esc(u.activites)) }, { k: 'statut', label: 'Statut', f: (u) => statutTag(u.statut) + (u.bloque ? ' <span class="tag danger">bloqué</span>' : '') + (u.doit_changer_mdp ? ' <span class="tag warn">mdp à changer</span>' : '') },
      { k: 'derniere_connexion', label: 'Dernière connexion', f: (u) => dateHeureFr(u.derniere_connexion) || 'jamais' }],
    rows, { actions: (u) => (u.role_code === 'super_adm' && S.moi.role !== 'super_adm' ? '' : `${peut('utilisateurs', 'S') ? `<button class="btn sm" data-mod="${u.id}">Modifier</button>` : ''}${peut('utilisateurs', 'V') ? `<button class="btn sm" data-reset="${u.id}" data-ident="${esc(u.identifiant)}">${icon('key')} Mot de passe</button>` : ''}`) });
    $$('.btn.sm svg', el).forEach((s) => s.setAttribute('style', 'width:14px;height:14px'));
    el._rows = rows;
  };
  sur(el, 'click', '[data-act=nouv]', async () => {
    try {
      const ch = champs(null);
      await modal({ titre: 'Nouvel utilisateur', large: true, corps: formulaire(ch) + `<div class="form" style="margin-top:12px">${actsHtml()}</div>`, actions: [{ label: 'Annuler' }, { label: 'Créer', cls: 'primary', act: async (m) => {
        const r = await post('/api/utilisateurs', { ...lireFormulaire(m, ch), activites: lireActs(m) }); setTimeout(() => montrerMdp('Compte créé', r.identifiant, r.mot_de_passe_temporaire), 50);
      } }] });
      await rendre();
    } catch (err) { erreur(err); }
  });
  sur(el, 'click', '[data-mod]', async (e, b) => {
    try {
      const u = el._rows.find((x) => x.id === b.dataset.mod); const ch = champs(u).filter((c) => c.k !== 'identifiant');
      await modal({ titre: `Modifier — ${u.nom}`, large: true, corps: formulaire(ch, u) + `<div class="form" style="margin-top:12px">${actsHtml(u.activites)}</div><p class="hint">Suspendre un compte le déconnecte immédiatement de tous ses appareils.</p>`,
        actions: [{ label: 'Annuler' }, { label: 'Enregistrer', cls: 'primary', act: async (m) => { await put('/api/utilisateurs/' + u.id, { ...lireFormulaire(m, ch), activites: lireActs(m) }); toast('Enregistré.', 'ok'); } }] });
      await rendre();
    } catch (err) { erreur(err); }
  });
  sur(el, 'click', '[data-reset]', async (e, b) => {
    try {
      if (!(await confirmer('Réinitialiser le mot de passe', `Générer un nouveau mot de passe temporaire pour « ${b.dataset.ident} » ? Ses sessions seront fermées.`, 'Réinitialiser', 'danger'))) return;
      const r = await post(`/api/utilisateurs/${b.dataset.reset}/reinitialiser`); await montrerMdp('Mot de passe réinitialisé', b.dataset.ident, r.mot_de_passe_temporaire); await rendre();
    } catch (err) { erreur(err); }
  });
  await rendre();
}

export async function roles(el) {
  const rendre = async () => {
    const { modules, roles: rs } = await get('/api/roles');
    el.innerHTML = tete('Rôles et permissions', 'C = consulter · S = saisir / modifier · V = valider / annuler · E = exporter / imprimer. Vérifiées par le serveur à chaque opération.', peut('utilisateurs', 'V') ? bouton('Nouveau rôle', 'nouv', 'plus') : '')
      + `<div class="row" style="margin-bottom:12px"><label>Rôle :</label><select id="role" style="width:auto">${rs.map((r) => `<option value="${r.id}">${esc(r.nom)}</option>`).join('')}</select></div><div id="mx"></div>`;
    const dessiner = () => {
      const r = rs.find((x) => x.id === $('#role', el).value);
      const fixe = r.code === 'super_adm' || !peut('utilisateurs', 'V');
      $('#mx', el).innerHTML = `<div class="table-wrap"><table class="t perm"><thead><tr><th>Module</th><th>Consulter</th><th>Saisir</th><th>Valider / annuler</th><th>Exporter / imprimer</th></tr></thead><tbody>
        ${modules.map((m) => `<tr><td>${esc(MODULES_NOMS[m] || m)}</td>${'CSVE'.split('').map((a) => `<td><input type="checkbox" data-m="${m}" data-a="${a}" ${(r.code === 'super_adm' || (r.perms[m] || '').includes(a)) ? 'checked' : ''} ${fixe ? 'disabled' : ''}></td>`).join('')}</tr>`).join('')}</tbody></table></div>
        ${fixe ? (r.code === 'super_adm' ? '<p class="hint">Le super administrateur a tous les droits.</p>' : '') : `<div class="row" style="margin-top:12px"><span class="spacer"></span>${bouton('Enregistrer les permissions', 'save', 'check', 'primary')}</div>`}`;
      el._role = r;
    };
    $('#role', el).addEventListener('change', dessiner); dessiner();
  };
  sur(el, 'click', '[data-act=save]', async () => {
    try { const perms = {}; $$('[data-m]', el).forEach((i) => { perms[i.dataset.m] = (perms[i.dataset.m] || '') + (i.checked ? i.dataset.a : ''); }); await put('/api/roles/' + el._role.id, { perms }); toast('Permissions enregistrées. Elles s’appliquent immédiatement.', 'ok'); } catch (err) { erreur(err); }
  });
  sur(el, 'click', '[data-act=nouv]', async () => {
    try { const n = await demander('Nouveau rôle', 'Nom du rôle', { aide: 'Il reprend les droits du rôle sélectionné ; vous pourrez les ajuster.' }); if (!n) return; await post('/api/roles', { nom: n, modele: $('#role', el).value }); toast('Rôle créé.', 'ok'); await rendre(); } catch (err) { erreur(err); }
  });
  await rendre();
}

export async function parametres(el) {
  const p = await get('/api/parametres');
  const ch = [{ k: 'nom_etablissement', label: 'Nom de l’établissement', req: true }, { k: 'telephone', label: 'Téléphone' }, { k: 'adresse', label: 'Adresse', full: true }, { k: 'email', label: 'Email' },
    { k: 'nif', label: 'NIF' }, { k: 'stat', label: 'STAT' }, { k: 'devise', label: 'Devise', def: 'Ar' }, { k: 'pied_ticket', label: 'Message en bas des tickets', full: true },
    { k: 'repartition_charges', label: 'Charges communes', type: 'select', vide: false, opts: [['ca', 'Réparties au prorata du chiffre d’affaires'], ['aucune', 'Non réparties (affichées à part)']] },
    { k: 'couleur_principale', label: 'Couleur principale', type: 'color', def: '#0f766e' }];
  el.innerHTML = tete('Paramètres de l’établissement', 'Apparaissent sur les tickets, factures et contrats.') + `<div class="grid g2"><div class="card">${formulaire(ch, p)}<div class="row" style="margin-top:14px"><span class="spacer"></span>${peut('parametres', 'S') ? bouton('Enregistrer', 'save', 'check', 'primary') : ''}</div></div>
    <div class="card"><h3>Logo</h3><div id="logo-prev" style="margin-bottom:12px">${p.logo ? `<img src="${esc(p.logo)}" style="max-height:90px;border-radius:12px">` : '<p class="muted">Aucun logo</p>'}</div>
      ${peut('parametres', 'S') ? `<input type="file" id="logo" accept="image/*"><p class="hint">L’image est automatiquement redimensionnée et compressée (WebP).</p>${p.logo ? bouton('Retirer le logo', 'nologo', 'trash', 'danger sm') : ''}` : ''}
      <h3 style="margin-top:20px">Affichage sur cet appareil</h3><div class="seg" id="th">${[['auto', 'Automatique'], ['light', 'Clair'], ['dark', 'Sombre']].map(([k, l]) => `<button data-t="${k}" class="${(localStorage.getItem('rt_theme') || 'auto') === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <p class="hint">Largeur des tickets : réglable dans « Tickets du jour ».</p></div></div>`;
  let logo = p.logo || '';
  sur(el, 'change', '#logo', async (e, i) => { try { const f = i.files[0]; if (!f) return; logo = await compresserImage(f); $('#logo-prev', el).innerHTML = `<img src="${logo}" style="max-height:90px;border-radius:12px"><p class="hint">${Math.round(logo.length / 1.37 / 1024)} Ko — pensez à enregistrer.</p>`; } catch { erreur(new Error('Image illisible.')); } });
  sur(el, 'click', '[data-act=nologo]', () => { logo = ''; $('#logo-prev', el).innerHTML = '<p class="muted">Logo retiré — pensez à enregistrer.</p>'; });
  sur(el, 'click', '[data-t]', (e, b) => { localStorage.setItem('rt_theme', b.dataset.t); document.documentElement.dataset.theme = b.dataset.t; $$('#th button', el).forEach((x) => x.classList.toggle('on', x === b)); });
  sur(el, 'click', '[data-act=save]', async () => {
    try { const d = lireFormulaire(el, ch); S.params = await put('/api/parametres', { ...d, logo }); document.documentElement.style.setProperty('--accent', S.params.couleur_principale); toast('Paramètres enregistrés.', 'ok'); } catch (err) { erreur(err); }
  });
}

export async function feries(el) {
  let jours = await get('/api/jours-feries');
  const an = aujourdhui().slice(0, 4);
  const DEFAUT = [['01-01', 'Jour de l’An'], ['03-08', 'Journée de la femme'], ['03-29', 'Commémoration 1947'], ['05-01', 'Fête du Travail'], ['06-26', 'Fête de l’Indépendance'], ['08-15', 'Assomption'], ['11-01', 'Toussaint'], ['12-25', 'Noël']];
  const rendre = () => {
    el.innerHTML = tete('Jours fériés', 'Les nuits de ces dates utilisent le tarif « férié » des bungalows. Pensez à ajouter les fêtes mobiles (Pâques, Ascension, Pentecôte).',
      `${bouton(`Ajouter les fêtes fixes ${an}`, 'defaut', 'flag')}${bouton('Ajouter', 'add', 'plus')}${bouton('Enregistrer', 'save', 'check', 'primary')}`)
      + `<div class="table-wrap"><table class="t"><thead><tr><th>Date</th><th>Libellé</th><th></th></tr></thead><tbody>${jours.map((j, i) => `<tr><td><input type="date" data-i="${i}" data-k="date" value="${j.date}"></td><td><input data-i="${i}" data-k="libelle" value="${esc(j.libelle)}"></td><td><button class="btn sm danger" data-del="${i}">×</button></td></tr>`).join('') || '<tr><td colspan="3" class="empty">Aucun jour férié</td></tr>'}</tbody></table></div>`;
  };
  sur(el, 'input', '[data-k]', (e, i) => { jours[i.dataset.i][i.dataset.k] = i.value; });
  sur(el, 'click', '[data-del]', (e, b) => { jours.splice(b.dataset.del, 1); rendre(); });
  sur(el, 'click', '[data-act]', async (e, b) => {
    const a = b.dataset.act;
    if (a === 'add') { jours.push({ date: aujourdhui(), libelle: '' }); rendre(); }
    if (a === 'defaut') { for (const [md, l] of DEFAUT) if (!jours.some((j) => j.date === `${an}-${md}`)) jours.push({ date: `${an}-${md}`, libelle: l }); jours.sort((x, y) => x.date.localeCompare(y.date)); rendre(); }
    if (a === 'save') { try { await put('/api/jours-feries', { jours: jours.filter((j) => j.date && j.libelle) }); toast('Jours fériés enregistrés.', 'ok'); jours = await get('/api/jours-feries'); rendre(); } catch (err) { erreur(err); } }
  });
  rendre();
}

const ACTIONS = { connexion: 'Connexion', connexion_echouee: 'Connexion échouée', connexion_nouvel_appareil: 'Connexion — nouvel appareil', compte_bloque: 'Compte bloqué', deconnexion: 'Déconnexion' };
export async function audit(el) {
  let du = plusJours(aujourdhui(), -7), au = aujourdhui(), q = '';
  const rendre = async () => {
    const rows = await get('/api/audit' + qs({ du, au, q }));
    el.innerHTML = tete('Journal d’audit', 'Qui a fait quoi, quand, depuis où, avec les valeurs avant / après. Ce journal ne peut être ni modifié ni effacé.', `<input type="date" id="a-du" value="${du}" style="width:auto"><input type="date" id="a-au" value="${au}" style="width:auto"><input type="search" id="a-q" value="${esc(q)}" placeholder="Action…" style="width:auto">`) + '<div id="l"></div>';
    tableau(el.querySelector('#l'), [{ k: 'quand', label: 'Quand', f: (r) => dateHeureFr(r.quand) }, { k: 'identifiant', label: 'Utilisateur' }, { k: 'action', label: 'Action', f: (r) => `<b>${esc(ACTIONS[r.action] || r.action.replace(/_/g, ' '))}</b>` },
      { k: 'entite', label: 'Élément', f: (r) => esc(r.entite || '') }, { k: 'ip', label: 'Adresse IP' }],
    rows, { actions: (r) => (r.avant || r.apres ? `<button class="btn sm" data-v="${r.id}">Détail</button>` : '') });
    el._rows = rows;
  };
  sur(el, 'change', '#a-du, #a-au, #a-q', () => { du = $('#a-du', el).value; au = $('#a-au', el).value; q = $('#a-q', el).value; rendre().catch(erreur); });
  sur(el, 'click', '[data-v]', (e, b) => { const r = el._rows.find((x) => String(x.id) === b.dataset.v); const f = (j) => { try { return esc(JSON.stringify(JSON.parse(j), null, 2)); } catch { return esc(j); } };
    modal({ titre: 'Détail', large: true, corps: `<div class="grid g2"><div><b>Avant</b><pre style="white-space:pre-wrap;font-size:12px">${r.avant ? f(r.avant) : '—'}</pre></div><div><b>Après</b><pre style="white-space:pre-wrap;font-size:12px">${r.apres ? f(r.apres) : '—'}</pre></div></div>` }); });
  await rendre();
}

export async function sauvegardes(el) {
  const rendre = async () => {
    const rows = await get('/api/sauvegardes');
    el.innerHTML = tete('Sauvegardes', 'Automatique chaque nuit (conservées 30 jours + 1 par mois pendant 1 an) dans un stockage séparé. Une sauvegarde est aussi faite avant chaque restauration.',
      `${peut('sauvegardes', 'S') ? bouton('Sauvegarder maintenant', 'now', 'database', 'primary') : ''}${peut('sauvegardes', 'E') ? bouton('Télécharger une copie', 'dl', 'download') : ''}${peut('sauvegardes', 'V') ? bouton('Restaurer depuis un fichier', 'file', 'upload', 'danger') : ''}`)
      + '<div id="l"></div><input type="file" id="f" accept="application/json" hidden>';
    tableau(el.querySelector('#l'), [{ k: 'quand', label: 'Date', f: (s) => dateHeureFr(s.quand) }, { k: 'type', label: 'Type', f: (s) => `<span class="tag">${esc(s.type.replace(/_/g, ' '))}</span>` }, { k: 'lignes', label: 'Lignes', num: true },
      { k: 'taille', label: 'Taille', num: true, f: (s) => `${Math.round((s.taille || 0) / 1024)} Ko` }, { k: 'statut', label: 'Statut', f: (s) => `<span class="tag ${s.statut === 'ok' ? 'ok' : 'warn'}">${esc(s.statut === 'sans_stockage' ? 'stockage non configuré' : s.statut)}</span>` }],
    rows, { vide: 'Aucune sauvegarde pour l’instant.', actions: (s) => (s.cle_r2 ? `<button class="btn sm" data-ver="${s.id}">Vérifier</button>${peut('sauvegardes', 'E') ? `<button class="btn sm" data-dl="${s.id}">${icon('download')}</button>` : ''}${peut('sauvegardes', 'V') ? `<button class="btn sm danger" data-rest="${s.id}" data-q="${esc(dateHeureFr(s.quand))}">Restaurer</button>` : ''}` : '') });
    $$('.btn.sm svg', el).forEach((s) => s.setAttribute('style', 'width:14px;height:14px'));
  };
  const restaurer = async (corps) => {
    const ok = await demander('Restauration — action irréversible', 'Tapez RESTAURER pour confirmer', { bouton: 'Restaurer', cls: 'danger', aide: 'Toutes les données actuelles seront remplacées par celles de la sauvegarde. Une sauvegarde de l’état actuel est faite automatiquement juste avant. Tout le monde sera déconnecté.' });
    if (ok !== 'RESTAURER') { if (ok !== null) toast('Confirmation incorrecte : rien n’a été modifié.', 'err'); return; }
    const r = await post('/api/sauvegardes/restaurer', { ...corps, confirmation: 'RESTAURER' });
    toast(r.message, 'ok', 8000); setTimeout(() => location.reload(), 1500);
  };
  sur(el, 'click', '[data-act=now]', async (e, b) => { try { b.disabled = true; const r = await post('/api/sauvegardes'); toast(`Sauvegarde faite (${r.lignes} lignes).`, 'ok'); await rendre(); } catch (err) { erreur(err); b.disabled = false; } });
  sur(el, 'click', '[data-act=dl]', () => telecharger('/api/sauvegardes/telecharger'));
  sur(el, 'click', '[data-dl]', (e, b) => telecharger('/api/sauvegardes/telecharger?id=' + b.dataset.dl));
  sur(el, 'click', '[data-ver]', async (e, b) => { try { const r = await post('/api/sauvegardes/verifier', { id: b.dataset.ver }); toast(r.message, r.integre ? 'ok' : 'err', 7000); } catch (err) { erreur(err); } });
  sur(el, 'click', '[data-rest]', async (e, b) => { try { await restaurer({ id: b.dataset.rest }); } catch (err) { erreur(err); } });
  sur(el, 'click', '[data-act=file]', () => $('#f', el).click());
  sur(el, 'change', '#f', async (e, i) => { try { const t = await i.files[0].text(); await restaurer({ fichier: JSON.parse(t) }); } catch (err) { erreur(err.code ? err : new Error('Fichier illisible.')); } i.value = ''; });
  await rendre();
}

export async function sessions(el) {
  const rendre = async () => {
    const rows = await get('/api/auth/sessions');
    el.innerHTML = tete('Mes appareils connectés', 'Déconnectez à distance un appareil perdu ou que vous ne reconnaissez pas.', rows.length > 1 ? bouton('Déconnecter tous les autres', 'tous', 'logout', 'danger') : '') + '<div id="l"></div>';
    tableau(el.querySelector('#l'), [{ k: 'appareil', label: 'Appareil', f: (s) => `${esc((s.appareil || '').slice(0, 90))}${s.actuelle ? ' <span class="tag ok">cet appareil</span>' : ''}${s.nouvel_appareil ? ' <span class="tag warn">nouvel appareil</span>' : ''}` },
      { k: 'ip', label: 'Adresse IP' }, { k: 'cree_le', label: 'Connecté le', f: (s) => dateHeureFr(s.cree_le) }, { k: 'vu_le', label: 'Dernière activité', f: (s) => dateHeureFr(s.vu_le) }],
    rows, { recherche: false, actions: (s) => (s.actuelle ? '' : `<button class="btn sm danger" data-rev="${s.ref}">Déconnecter</button>`) });
  };
  sur(el, 'click', '[data-rev]', async (e, b) => { try { await post('/api/auth/sessions/revoquer', { ref: b.dataset.rev }); toast('Appareil déconnecté.', 'ok'); await rendre(); } catch (err) { erreur(err); } });
  sur(el, 'click', '[data-act=tous]', async () => { try { await post('/api/auth/sessions/revoquer', { ref: 'toutes' }); toast('Autres appareils déconnectés.', 'ok'); await rendre(); } catch (err) { erreur(err); } });
  await rendre();
}
