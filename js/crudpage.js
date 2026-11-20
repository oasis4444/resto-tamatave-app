// Page standard « liste + ajout + modification + archivage » pour les fiches simples.
import { get, post, put, del, peut, modal, formulaire, lireFormulaire, tableau, tete, bouton, sur, toast, erreur, confirmer, qs } from './core.js';

export async function pageCrud(el, cfg) {
  const { titre, sous = '', chemin, module, champs, cols, query = {}, actionsLigne, apres, valeursDefaut = {} } = cfg;
  let archives = false;
  const charger = async () => {
    const rows = await get(`/api/${chemin}${qs({ ...query, archives: archives ? '1' : '' })}`);
    el.innerHTML = tete(titre, sous, `${peut(module, 'V') ? `<label class="inline muted" style="font-size:13px"><input type="checkbox" id="arch" ${archives ? 'checked' : ''}> Voir les archives</label>` : ''}${peut(module, 'S') ? bouton('Ajouter', 'ajouter', 'plus', 'primary') : ''}`) + '<div id="liste"></div>';
    tableau(el.querySelector('#liste'), cols, rows, {
      actions: (r) => `${actionsLigne ? actionsLigne(r) : ''}${peut(module, 'S') && !r.archive ? `<button class="btn sm" data-act="modifier" data-id="${r.id}">Modifier</button>` : ''}
        ${peut(module, 'V') ? `<button class="btn sm ${r.archive ? '' : 'danger'}" data-act="archiver" data-id="${r.id}" data-r="${r.archive ? 1 : 0}">${r.archive ? 'Restaurer' : 'Archiver'}</button>` : ''}`,
    });
    el.querySelector('#arch')?.addEventListener('change', (e) => { archives = e.target.checked; charger().catch(erreur); });
    el._rows = rows;
    if (apres) apres(el, rows);
  };
  const editer = async (ligne) => {
    const ch = typeof champs === 'function' ? await champs(ligne) : champs;
    await modal({ titre: ligne ? `Modifier — ${ligne.nom || ''}` : `Ajouter — ${titre}`, corps: formulaire(ch, ligne || { ...valeursDefaut, ...query }), large: ch.length > 8,
      actions: [{ label: 'Annuler' }, { label: 'Enregistrer', cls: 'primary', act: async (m) => {
        const d = lireFormulaire(m, ch);
        if (ligne) await put(`/api/${chemin}/${ligne.id}`, { ...d, version: ligne.version }); else await post(`/api/${chemin}`, d);
        toast('Enregistré.', 'ok'); await charger();
      } }] });
  };
  sur(el, 'click', '[data-act]', async (e, b) => {
    try {
      const r = el._rows?.find((x) => x.id === b.dataset.id);
      if (b.dataset.act === 'ajouter') await editer(null);
      else if (b.dataset.act === 'modifier') await editer(r);
      else if (b.dataset.act === 'archiver') {
        const rest = b.dataset.r === '1';
        if (!rest && !(await confirmer('Archiver', `Archiver « ${r.nom} » ? Il ne sera plus proposé mais son historique est conservé.`, 'Archiver', 'danger'))) return;
        await del(`/api/${chemin}/${r.id}${rest ? '?restaurer=1' : ''}`); toast(rest ? 'Restauré.' : 'Archivé.', 'ok'); await charger();
      } else if (cfg.surAction) await cfg.surAction(b.dataset.act, r, charger);
    } catch (err) { erreur(err); }
  });
  await charger();
}
