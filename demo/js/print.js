// Impression : tickets thermiques 58/80 mm et documents A4 (facture de séjour, contrat de salle, rapports).
import { S, esc, ar, dateFr, dateHeureFr, MODES, get } from './core.js';

function imprimer(html, format = 'a4') {
  let area = document.getElementById('print-area');
  if (!area) { area = document.createElement('div'); area.id = 'print-area'; document.body.append(area); }
  area.innerHTML = html;
  let st = document.getElementById('page-style');
  if (!st) { st = document.createElement('style'); st.id = 'page-style'; document.head.append(st); }
  st.textContent = format === 'a4' ? '@page { size: A4; margin: 14mm; }' : `@page { size: ${format === '58' ? '58mm' : '80mm'} auto; margin: 3mm; }`;
  setTimeout(() => window.print(), 50);
}
const entete = (p) => `${p.logo ? `<div class="c"><img src="${esc(p.logo)}" style="max-width:120px;max-height:60px"></div>` : ''}
  <h2>${esc(p.nom_etablissement)}</h2><div class="c">${esc(p.adresse || '')}${p.telephone ? '<br>Tél. ' + esc(p.telephone) : ''}${p.nif ? `<br>NIF ${esc(p.nif)}` : ''}${p.stat ? ` · STAT ${esc(p.stat)}` : ''}</div>`;

export async function imprimerTicket(docId, largeur = localStorage.getItem('rt_ticket') || '80') {
  const d = await get('/api/documents/' + docId);
  const p = d.parametres;
  imprimer(`<div class="ticket ${largeur === '58' ? 'w58' : ''}">${entete(p)}<hr>
    <div>${d.type === 'avoir' ? '<b>AVOIR</b> ' : ''}Ticket <b>${esc(d.numero)}</b><br>${dateHeureFr(d.cree_le)} · ${esc(d.activite_nom || '')}<br>Servi par ${esc(d.vendeur || '')}${d.client_nom ? '<br>Client : ' + esc(d.client_nom) : ''}</div><hr>
    <table>${d.lignes.map((l) => `<tr><td colspan="2">${esc(l.libelle)}</td></tr><tr><td>${l.quantite} × ${ar(l.prix_unitaire)}</td><td style="text-align:right">${ar(l.montant)}</td></tr>`).join('')}</table><hr>
    <table><tr><td><b>TOTAL</b></td><td style="text-align:right"><b>${ar(d.total)}</b></td></tr>
    ${d.paiements.map((x) => `<tr><td>${esc(MODES[x.mode] || x.mode)}${x.reference ? ' ' + esc(x.reference) : ''}</td><td style="text-align:right">${ar(x.montant)}</td></tr>`).join('')}</table>
    ${d.folio_id ? `<hr><div class="c">Porté au compte : ${esc(d.folio_libelle || d.folio_numero)}<br><br>Signature client : ______________</div>` : ''}
    ${d.statut === 'annule' ? '<hr><div class="c"><b>*** TICKET ANNULÉ ***</b></div>' : ''}
    <hr><div class="c">${esc(p.pied_ticket || '')}</div>${S.moi?.mode === 'demo' ? '<div class="c">— DÉMONSTRATION —</div>' : ''}</div>`, largeur);
}

export async function imprimerFolio(folioId) {
  const f = await get('/api/folios/' + folioId);
  const p = f.parametres;
  const lignes = f.lignes.filter((l) => !l.annule);
  imprimer(`<div class="a4"><table style="border:0"><tr><td style="border:0;width:60%">${p.logo ? `<img src="${esc(p.logo)}" style="max-height:70px"><br>` : ''}<b style="font-size:16px">${esc(p.nom_etablissement)}</b><br>${esc(p.adresse || '')}<br>${esc(p.telephone || '')} ${esc(p.email || '')}<br>${p.nif ? 'NIF ' + esc(p.nif) : ''} ${p.stat ? '· STAT ' + esc(p.stat) : ''}</td>
    <td style="border:0;text-align:right"><b style="font-size:20px">${f.facture_numero ? 'FACTURE' : 'RELEVÉ DE COMPTE'}</b><br>${esc(f.facture_numero || f.numero)}<br>Date : ${dateFr(new Date(Date.now() + 3 * 3600000).toISOString())}</td></tr></table>
    <p><b>Client :</b> ${esc(f.client || '')}${f.entreprise ? ' — ' + esc(f.entreprise) : ''}${f.client_nif ? ' — NIF ' + esc(f.client_nif) : ''}<br>${esc(f.telephone || '')} ${esc(f.adresse || '')}
    ${f.reservation ? `<br><b>Séjour :</b> ${esc(f.reservation.bungalow)} du ${dateFr(f.reservation.arrivee)} au ${dateFr(f.reservation.depart)} (${esc(f.reservation.numero || '')})` : ''}</p>
    <table><thead><tr><th>Date</th><th>Désignation</th><th>Activité</th><th>Qté</th><th>P.U.</th><th>Montant</th></tr></thead><tbody>
    ${lignes.map((l) => `<tr><td>${dateFr(l.jour)}</td><td>${esc(l.libelle)}</td><td>${esc(l.activite_nom || '')}</td><td style="text-align:right">${l.quantite}</td><td style="text-align:right">${ar(l.prix_unitaire)}</td><td style="text-align:right">${ar(l.montant)}</td></tr>`).join('')}
    </tbody><tfoot><tr><td colspan="5" style="text-align:right"><b>Total</b></td><td style="text-align:right"><b>${ar(f.du)}</b></td></tr>
    ${f.paiements.map((x) => `<tr><td>${dateFr(x.jour)}</td><td colspan="4">${x.montant < 0 ? 'Remboursement' : x.nature === 'acompte' ? 'Acompte' : 'Paiement'} — ${esc(MODES[x.mode] || x.mode)} ${esc(x.reference || '')}</td><td style="text-align:right">${ar(-x.montant)}</td></tr>`).join('')}
    <tr><td colspan="5" style="text-align:right"><b>Reste à payer</b></td><td style="text-align:right"><b>${ar(f.solde)}</b></td></tr></tfoot></table>
    <p style="margin-top:30px">Arrêtée la présente à la somme de <b>${ar(f.du)}</b>.</p>
    <table style="border:0;margin-top:30px"><tr><td style="border:0">Le client</td><td style="border:0;text-align:right">Pour l’établissement</td></tr></table>
    ${S.moi?.mode === 'demo' ? '<p style="text-align:center">— DOCUMENT DE DÉMONSTRATION —</p>' : ''}</div>`, 'a4');
}

export async function imprimerContrat(evtId) {
  const e = await get('/api/evenements/' + evtId);
  const p = S.params;
  const total = e.montant_salle + e.montant_options;
  imprimer(`<div class="a4"><h2 style="text-align:center">CONTRAT DE LOCATION DE SALLE — ${esc(e.numero)}</h2>
    <p><b>Entre :</b> ${esc(p.nom_etablissement)}, ${esc(p.adresse || '')}${p.nif ? ', NIF ' + esc(p.nif) : ''}<br><b>Et :</b> ${esc(e.client)}, ${esc(e.telephone || '')} ${esc(e.adresse || '')}</p>
    <table><tr><th>Salle</th><td>${esc(e.salle)} (capacité ${e.capacite})</td></tr><tr><th>Événement</th><td>${esc(e.type)} ${esc(e.titre || '')}</td></tr>
    <tr><th>Date et horaires</th><td>${dateFr(e.date)} de ${e.heure_debut} h à ${e.heure_fin} h</td></tr><tr><th>Invités prévus</th><td>${e.invites}</td></tr></table>
    <h3>Détail</h3><table><tr><th>Désignation</th><th>Montant</th></tr><tr><td>Location de la salle</td><td style="text-align:right">${ar(e.montant_salle)}</td></tr>
    ${e.options.map((o) => `<tr><td>${esc(o.libelle)}</td><td style="text-align:right">${ar(o.montant)}</td></tr>`).join('')}
    <tr><th>Total</th><th style="text-align:right">${ar(total)}</th></tr><tr><td>Acompte(s) versé(s)</td><td style="text-align:right">${ar(e.paye || 0)}</td></tr>
    <tr><th>Solde à régler avant l’événement</th><th style="text-align:right">${ar(total - (e.paye || 0))}</th></tr></table>
    <p>Le client s’engage à respecter les horaires, la capacité de la salle et à restituer les lieux et le matériel en bon état. Toute annulation peut entraîner la conservation de l’acompte.</p>
    <table style="border:0;margin-top:40px"><tr><td style="border:0">Le client<br><br>(lu et approuvé)</td><td style="border:0;text-align:right">Pour l’établissement</td></tr></table></div>`, 'a4');
}

export function imprimerHtml(titre, html) {
  imprimer(`<div class="a4"><h2>${esc(S.params.nom_etablissement)} — ${esc(titre)}</h2><p>Imprimé le ${dateHeureFr(new Date().toISOString())} par ${esc(S.moi?.nom || '')}</p>${html}</div>`, 'a4');
}
