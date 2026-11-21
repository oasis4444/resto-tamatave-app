// Outils communs : réponses, erreurs, base de données, validation, audit, numérotation.

export class HttpError extends Error {
  constructor(status, message, code = 'ERREUR') { super(message); this.status = status; this.code = code; }
}
export const fail = (status, message, code) => { throw new HttpError(status, message, code); };

export const uid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();
const TZ_MIN = 180; // Madagascar : UTC+3, sans heure d'été
export const jourLocal = (d = new Date()) => new Date(d.getTime() + TZ_MIN * 60000).toISOString().slice(0, 10);
export const anneeLocale = () => jourLocal().slice(0, 4);
export const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

// ── Base de données ──
const norm = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
export const st = (db, sql, ...p) => db.prepare(sql).bind(...norm(p));
export const all = async (db, sql, ...p) => (await st(db, sql, ...p).all()).results || [];
export const first = (db, sql, ...p) => st(db, sql, ...p).first();
export const run = (db, sql, ...p) => st(db, sql, ...p).run();

/** Exécute un lot de requêtes de façon atomique (tout ou rien), avec anti-doublon optionnel. */
export async function batch(ctx, stmts) {
  const list = ctx.idem
    ? [st(ctx.db, 'INSERT INTO idempotence(cle, utilisateur_id, quand) VALUES (?,?,?)', ctx.idem, ctx.user?.id, nowIso()), ...stmts]
    : stmts;
  try {
    const res = await ctx.db.batch(list);
    return ctx.idem ? res.slice(1) : res;
  } catch (e) {
    const m = String(e?.message || e);
    if (/UNIQUE/i.test(m) && /idempotence/i.test(m)) fail(409, 'Cette opération a déjà été enregistrée.', 'DEJA_ENREGISTRE');
    throw e;
  }
}
/** Verrou à usage unique dans un lot : empêche qu'une même action (ex. encaisser la commande X) passe deux fois. */
export const verrou = (ctx, cle) => st(ctx.db, 'INSERT INTO idempotence(cle, utilisateur_id, quand) VALUES (?,?,?)', 'v:' + cle, ctx.user?.id, nowIso());

/** Traduit les erreurs de contrainte SQLite en messages compréhensibles. */
export function contrainte(e, messages) {
  const m = String(e?.message || e);
  for (const [motif, texte] of Object.entries(messages)) if (m.includes(motif)) fail(409, texte, 'CONFLIT');
  throw e;
}

// ── Numérotation automatique (FAC-2026-00001), atomique dans un lot ──
export function numeroter(db, prefixe, table, id) {
  const cle = `${prefixe}-${anneeLocale()}`;
  return [
    st(db, 'INSERT OR IGNORE INTO sequences(cle, val) VALUES (?, 0)', cle),
    st(db, 'UPDATE sequences SET val = val + 1 WHERE cle = ?', cle),
    st(db, `UPDATE ${table} SET numero = (SELECT printf('%s-%05d', cle, val) FROM sequences WHERE cle = ?) WHERE id = ?`, cle, id),
  ];
}

// ── Journal d'audit ──
export function audit(ctx, action, entite, entiteId, avant = null, apres = null) {
  return st(ctx.db,
    'INSERT INTO audit(quand, utilisateur_id, identifiant, action, entite, entite_id, avant, apres, ip) VALUES (?,?,?,?,?,?,?,?,?)',
    nowIso(), ctx.user?.id, ctx.user?.identifiant, action, entite, entiteId,
    avant ? JSON.stringify(avant) : null, apres ? JSON.stringify(apres) : null, ctx.ip);
}

// ── Validation des entrées ──
const RX = {
  date: /^\d{4}-\d{2}-\d{2}$/, heure: /^([01]\d|2[0-3]):[0-5]\d$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, id: /^[A-Za-z0-9_-]{1,64}$/,
};
/**
 * spec : { champ: { t: 'str'|'int'|'num'|'date'|'heure'|'email'|'id'|'bool'|'enum'|'json', req, min, max, vals, label, def } }
 */
export function valider(body, spec, partiel = false) {
  const out = {};
  body = body && typeof body === 'object' ? body : {};
  for (const [k, r] of Object.entries(spec)) {
    const label = r.label || k;
    let v = body[k];
    if (v === undefined || v === null || v === '') {
      if (partiel && !(k in body)) continue;
      if (r.req) fail(400, `Le champ « ${label} » est obligatoire.`, 'VALIDATION');
      out[k] = r.def !== undefined ? r.def : null;
      continue;
    }
    switch (r.t || 'str') {
      case 'str':
        v = String(v).trim();
        if (v.length > (r.max || 500)) fail(400, `« ${label} » est trop long (max ${r.max || 500} caractères).`, 'VALIDATION');
        if (r.min && v.length < r.min) fail(400, `« ${label} » est trop court (min ${r.min} caractères).`, 'VALIDATION');
        break;
      case 'int': case 'num': {
        const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
        if (!Number.isFinite(n)) fail(400, `« ${label} » doit être un nombre.`, 'VALIDATION');
        v = r.t === 'int' ? Math.round(n) : n;
        if (r.min !== undefined && v < r.min) fail(400, `« ${label} » doit être au moins ${r.min}.`, 'VALIDATION');
        if (r.max !== undefined && v > r.max) fail(400, `« ${label} » doit être au plus ${r.max}.`, 'VALIDATION');
        break;
      }
      case 'bool': v = v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0; break;
      case 'enum': if (!r.vals.includes(v)) fail(400, `Valeur invalide pour « ${label} ».`, 'VALIDATION'); break;
      case 'json': if (typeof v !== 'object') fail(400, `Format invalide pour « ${label} ».`, 'VALIDATION'); break;
      default:
        v = String(v).trim();
        if (RX[r.t] && !RX[r.t].test(v)) fail(400, `Format invalide pour « ${label} ».`, 'VALIDATION');
    }
    out[k] = v;
  }
  return out;
}

export const MODES_PAIEMENT = ['especes', 'mvola', 'orange_money', 'airtel_money', 'carte', 'virement', 'cheque'];

export async function lireParametres(db) {
  const rows = await all(db, 'SELECT cle, valeur FROM parametres');
  return Object.fromEntries(rows.map((r) => [r.cle, r.valeur]));
}
