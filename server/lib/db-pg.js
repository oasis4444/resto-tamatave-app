// Façade compatible D1 (prepare/bind/first/all/run/batch) au-dessus de PostgreSQL (Supabase).
// pilote : { query(texte, params) -> { rows, count }, transaction(async (tx) => …) }

/** Adapte les quelques tournures SQLite du code au dialecte PostgreSQL et numérote les paramètres. */
export function pgSql(sql) {
  let s = sql;
  let ignore = false;
  if (/^\s*INSERT OR IGNORE INTO/i.test(s)) { s = s.replace(/INSERT OR IGNORE INTO/i, 'INSERT INTO'); ignore = true; }
  s = s.replace(/printf\('%s-%05d', cle, val\)/g, "(cle || '-' || lpad(val::text, 5, '0'))");
  s = s.replace(/\bMAX\(([\w.]+),\s*0\)/g, 'GREATEST($1, 0)');
  s = s.replace(/\bLIKE\b/g, 'ILIKE');
  s = s.replace(/PRAGMA defer_foreign_keys = true/i, 'SET CONSTRAINTS ALL DEFERRED');
  if (ignore) s += ' ON CONFLICT DO NOTHING';
  // ? → $1, $2… (hors chaînes entre apostrophes)
  let n = 0, out = '', dansChaine = false;
  for (const c of s) {
    if (c === "'") dansChaine = !dansChaine;
    out += c === '?' && !dansChaine ? '$' + ++n : c;
  }
  return out;
}

const norm = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

class Stmt {
  constructor(drv, sql, params = []) { this.drv = drv; this.sql = sql; this.params = params; }
  bind(...p) { return new Stmt(this.drv, this.sql, norm(p)); }
  async _exec(q = this.drv) {
    const r = await q.query(pgSql(this.sql), this.params);
    return { success: true, results: r.rows || [], meta: { changes: r.count ?? 0 } };
  }
  all() { return this._exec(); }
  run() { return this._exec(); }
  async first(col) { const r = (await this._exec()).results[0] ?? null; return r && col ? r[col] : r; }
}

export function creerDb(pilote) {
  return {
    prepare: (sql) => new Stmt(pilote, sql),
    /** Toutes les requêtes dans une seule transaction : tout ou rien. */
    batch: (stmts) => pilote.transaction(async (tx) => {
      const out = [];
      for (const s of stmts) out.push(await s._exec(tx));
      return out;
    }),
  };
}
