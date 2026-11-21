// Fabrique de services CRUD standards : liste/recherche, détail, ajout, modification (contrôle de version), archivage.
import { route } from '../router.js';
import { all, first, st, valider, uid, nowIso, fail, audit, batch } from './core.js';
import { exiger } from './auth.js';

export function crud({ chemin, table, module, champs, recherche = ['nom'], ordre = 'nom', select = null, filtres = [], avantEcriture = null }) {
  const cols = Object.keys(champs);

  route('GET', `/api/${chemin}`, async (ctx) => {
    exiger(ctx, module, 'C');
    const w = [ctx.query.archives === '1' ? '1=1' : 't.archive = 0'];
    const p = [];
    if (ctx.query.q) {
      w.push('(' + recherche.map((c) => `t.${c} LIKE ?`).join(' OR ') + ')');
      recherche.forEach(() => p.push(`%${ctx.query.q}%`));
    }
    for (const f of filtres) if (ctx.query[f]) { w.push(`t.${f} = ?`); p.push(ctx.query[f]); }
    const lim = Math.min(Number(ctx.query.limite) || 500, 2000);
    return all(ctx.db, `SELECT ${select || 't.*'} FROM ${table} t WHERE ${w.join(' AND ')} ORDER BY ${ordre} LIMIT ${lim}`, ...p);
  });

  route('GET', `/api/${chemin}/:id`, async (ctx) => {
    exiger(ctx, module, 'C');
    const row = await first(ctx.db, `SELECT * FROM ${table} WHERE id = ?`, ctx.params.id);
    if (!row) fail(404, 'Élément introuvable.', 'INTROUVABLE');
    return row;
  });

  route('POST', `/api/${chemin}`, async (ctx) => {
    exiger(ctx, module, 'S');
    const d = valider(ctx.body, champs);
    if (avantEcriture) await avantEcriture(ctx, d, null);
    const id = uid();
    const c = Object.keys(d);
    await batch(ctx, [
      st(ctx.db, `INSERT INTO ${table}(id, ${c.join(',')}, cree_le) VALUES (?, ${c.map(() => '?').join(',')}, ?)`, id, ...c.map((k) => d[k]), nowIso()),
      audit(ctx, 'ajout', table, id, null, d),
    ]);
    return first(ctx.db, `SELECT * FROM ${table} WHERE id = ?`, id);
  });

  route('PUT', `/api/${chemin}/:id`, async (ctx) => {
    exiger(ctx, module, 'S');
    const avant = await first(ctx.db, `SELECT * FROM ${table} WHERE id = ?`, ctx.params.id);
    if (!avant) fail(404, 'Élément introuvable.', 'INTROUVABLE');
    const d = valider(ctx.body, champs, true);
    if (avantEcriture) await avantEcriture(ctx, d, avant);
    const c = Object.keys(d).filter((k) => cols.includes(k));
    if (!c.length) return avant;
    const version = Number(ctx.body.version);
    const [res] = await batch(ctx, [
      st(ctx.db, `UPDATE ${table} SET ${c.map((k) => `${k} = ?`).join(', ')}, version = version + 1 WHERE id = ? AND version = ?`, ...c.map((k) => d[k]), avant.id, version),
      audit(ctx, 'modification', table, avant.id, Object.fromEntries(c.map((k) => [k, avant[k]])), d),
    ]);
    if (!res.meta.changes) fail(409, 'Cet élément a été modifié par quelqu’un d’autre entre-temps. Rechargez la page puis recommencez.', 'VERSION');
    return first(ctx.db, `SELECT * FROM ${table} WHERE id = ?`, avant.id);
  });

  route('DELETE', `/api/${chemin}/:id`, async (ctx) => {
    exiger(ctx, module, 'V');
    const avant = await first(ctx.db, `SELECT * FROM ${table} WHERE id = ?`, ctx.params.id);
    if (!avant) fail(404, 'Élément introuvable.', 'INTROUVABLE');
    const restaurer = ctx.query.restaurer === '1';
    await batch(ctx, [
      st(ctx.db, `UPDATE ${table} SET archive = ?, version = version + 1 WHERE id = ?`, restaurer ? 0 : 1, avant.id),
      audit(ctx, restaurer ? 'desarchivage' : 'archivage', table, avant.id),
    ]);
    return { ok: true };
  });
}
