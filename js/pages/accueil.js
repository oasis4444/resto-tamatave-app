// Tableau de bord propre à chaque rôle (données calculées par le serveur).
import { S, get, esc, ar, nb, dateFr, heureFr, tete, sur, erreur, mesActivites, MODES, actCouleur, qs, peut } from '../core.js';
import { icon } from '../icons.js';

export async function accueil(el) {
  let periode = sessionStorage.getItem('rt_periode') || 'jour';
  let activite = '';
  let timer;
  const kpi = (ico, c, label, val, sous = '') => `<div class="card kpi"><span class="ico" style="--c:${c}">${icon(ico)}</span><div><small>${label}</small><b class="mono">${val}</b>${sous ? `<small>${sous}</small>` : ''}</div></div>`;
  const rendre = async () => {
    const d = await get('/api/tableau' + qs({ periode, activite }));
    const h = d.hebergement, f = d.totaux;
    const salut = new Date().getHours() < 12 ? 'Bonjour' : 'Bonsoir';
    el.innerHTML = tete(`${salut}, ${S.moi.nom.split(' ')[0]}`, `${S.moi.role_nom} · ${dateFr(d.du)}${d.au !== d.du ? ' → ' + dateFr(d.au) : ''}`,
      `<div class="seg" id="per">${[['jour', 'Aujourd’hui'], ['hier', 'Hier'], ['semaine', 'Semaine'], ['mois', 'Mois'], ['annee', 'Année']].map(([k, l]) => `<button data-p="${k}" class="${k === periode ? 'on' : ''}">${l}</button>`).join('')}</div>
       ${d.finance ? `<select id="act" style="width:auto"><option value="">Toutes les activités</option>${mesActivites().map((a) => `<option value="${a.id}" ${a.id === activite ? 'selected' : ''}>${esc(a.nom)}</option>`).join('')}</select>` : ''}`)
    + `<div class="grid g4" style="margin-bottom:16px">
        ${d.finance ? kpi('coins', '#16a34a', 'Chiffre d’affaires', ar(f.ca)) + kpi('chart', '#0e7490', 'Marge brute', ar(f.marge), f.ca ? nb((f.marge / f.ca) * 100, 1) + ' % du CA' : '') + kpi('receipt', '#d97706', 'Dépenses', ar((f.depenses || 0) + (f.charges_communes || 0))) + kpi('star', f.resultat >= 0 ? '#16a34a' : '#dc2626', 'Résultat estimé', ar(f.resultat)) : ''}
        ${h ? kpi('bed', '#0e7490', 'Taux d’occupation', nb(h.taux_occupation, 1) + ' %', `${h.occupes_aujourdhui} occupé(s) / ${h.bungalows}`) : ''}
        ${d.operations ? kpi('clipboard', '#c2410c', 'Commandes ouvertes', d.operations.commandes_ouvertes, `${d.operations.en_cuisine} plat(s) en cuisine`) : ''}
        ${d.rdv_aujourdhui !== undefined ? kpi('spa', '#db2777', 'Rendez-vous aujourd’hui', d.rdv_aujourdhui) : ''}
        ${d.alertes_stock !== undefined ? kpi('alert', d.alertes_stock ? '#dc2626' : '#16a34a', 'Alertes de stock', d.alertes_stock) : ''}
        ${d.finance && d.impayes ? kpi('wallet', '#9333ea', 'Impayés (comptes ouverts)', ar(d.impayes.total), d.impayes.n + ' compte(s)') : ''}
      </div>
      <div class="grid g2">
        ${d.finance ? `<div class="card"><h3>Résultat par activité</h3><div class="bars">${barres(d.par_activite)}</div></div>
        <div class="card"><h3>Évolution du chiffre d’affaires</h3>${courbe(d.serie)}<div class="row" style="margin-top:10px">${d.encaissements.map((e) => `<span class="tag">${esc(MODES[e.mode] || e.mode)} : ${ar(e.total)}</span>`).join('') || '<span class="muted">Aucun encaissement</span>'}</div></div>
        <div class="card"><h3>Meilleures ventes</h3>${d.top_produits.length ? `<table class="t">${d.top_produits.map((p) => `<tr><td>${esc(p.libelle)}</td><td class="num">${nb(p.qte)}</td><td class="num">${ar(p.ca)}</td></tr>`).join('')}</table>` : '<div class="empty">Aucune vente sur la période.</div>'}</div>` : ''}
        ${h ? `<div class="card"><h3>Accueil du jour</h3><div class="grid g2"><div><b class="muted" style="font-size:12px">ARRIVÉES (${h.arrivees.length})</b>${liste(h.arrivees)}</div><div><b class="muted" style="font-size:12px">DÉPARTS (${h.departs.length})</b>${liste(h.departs)}</div></div>
          ${h.a_nettoyer ? `<div class="banner warn" style="margin:12px 0 0">${icon('broom')} ${h.a_nettoyer} bungalow(s) à nettoyer — <a href="#/menage">voir le ménage</a></div>` : ''}</div>` : ''}
        ${d.evenements?.length ? `<div class="card"><h3>Événements à venir (14 jours)</h3>${d.evenements.map((e) => `<div class="row" style="padding:6px 0;border-bottom:1px dashed var(--border)"><span class="tag info">${dateFr(e.date)}</span><b>${esc(e.type)}</b><span class="muted">${esc(e.salle)} · ${e.heure_debut}h–${e.heure_fin}h</span></div>`).join('')}</div>` : ''}
        ${d.caisses_ouvertes ? `<div class="card"><h3>Caisses ouvertes</h3>${d.caisses_ouvertes.length ? d.caisses_ouvertes.map((c) => `<div class="row" style="padding:5px 0"><span class="dot"></span><b>${esc(c.nom)}</b><span class="muted">depuis ${heureFr(c.ouvert_le)} · ${esc(c.par)}</span></div>`).join('') : '<p class="muted">Aucune caisse ouverte.</p>'}
          ${d.finance && d.ecarts_caisse?.n ? `<div class="banner warn" style="margin:10px 0 0">Écarts de caisse sur la période : ${ar(d.ecarts_caisse.total)} (${d.ecarts_caisse.n} clôture(s))</div>` : ''}</div>` : ''}
      </div>`;
    el.querySelectorAll('.banner svg, .card h3 svg').forEach((s) => s.setAttribute('style', 'width:18px;height:18px'));
  };
  const barres = (rows) => {
    const max = Math.max(1, ...rows.map((r) => Math.abs(r.ca)));
    return rows.map((r) => `<div class="bar-row"><span>${esc(r.nom)}</span><div class="bar" title="CA ${ar(r.ca)} · marge ${ar(r.marge)}"><i style="width:${(Math.abs(r.ca) / max) * 100}%;--c:${r.couleur || actCouleur(r.id)}"></i></div>
      <span class="right mono" title="Résultat estimé"><b>${ar(r.ca)}</b><br><small class="${r.resultat < 0 ? 'late' : 'muted'}">rés. ${ar(r.resultat)}</small></span></div>`).join('');
  };
  const courbe = (serie) => {
    if (serie.length < 2) return `<div class="empty" style="padding:18px">${serie.length ? 'CA du jour : <b>' + ar(serie[0].ca) + '</b>' : 'Pas encore de ventes.'}</div>`;
    const W = 600, H = 120, max = Math.max(1, ...serie.map((s) => s.ca));
    const pts = serie.map((s, i) => [(i / (serie.length - 1)) * W, H - 8 - (s.ca / max) * (H - 20)]);
    const path = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${path} L${W} ${H} L0 ${H}Z" fill="var(--accent-soft)"/><path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>
      <div class="row muted" style="font-size:12px;justify-content:space-between"><span>${dateFr(serie[0].jour)}</span><span>max ${ar(max)}</span><span>${dateFr(serie.at(-1).jour)}</span></div>`;
  };
  const liste = (rows) => rows.length ? rows.map((r) => `<div style="padding:6px 0;border-bottom:1px dashed var(--border)"><b>${esc(r.bungalow)}</b><br><span class="muted">${esc(r.client)}</span></div>`).join('') : '<p class="muted">Aucun</p>';

  sur(el, 'click', '[data-p]', (e, b) => { periode = b.dataset.p; sessionStorage.setItem('rt_periode', periode); rendre().catch(erreur); });
  sur(el, 'change', '#act', (e, s) => { activite = s.value; rendre().catch(erreur); });
  await rendre();
  timer = setInterval(() => { if (document.visibilityState === 'visible') rendre().catch(() => {}); }, 60000);
  return () => clearInterval(timer);
}
