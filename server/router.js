// Routeur minimal et point d'entrée HTTP de l'API.
import { json, HttpError, fail, first, run, nowIso, uid } from './lib/core.js';
import { chargerSession } from './lib/auth.js';

const routes = [];
export function route(method, path, handler, opts = {}) {
  const keys = [];
  const rx = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, rx, keys, handler, opts });
}

const SECU = {
  'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin',
  'strict-transport-security': 'max-age=31536000',
};

// Configuration système (table config_systeme, mise en cache 60 s) : origines autorisées, clés…
let cacheConfig = null, cacheQuand = 0;
export async function config(ctx) {
  if (!cacheConfig || Date.now() - cacheQuand > 60000) {
    try { cacheConfig = Object.fromEntries((await ctx.db.prepare('SELECT cle, valeur FROM config_systeme').bind().all()).results.map((r) => [r.cle, r.valeur])); }
    catch { cacheConfig = {}; }
    cacheQuand = Date.now();
  }
  return cacheConfig;
}
async function originesAutorisees(ctx) {
  const l = ctx.env.ALLOWED_ORIGINS || (await config(ctx)).origines || '';
  return new Set([ctx.url.origin, ...l.split(',').map((x) => x.trim()).filter(Boolean)]);
}
function cors(res, origin) {
  if (!origin) return res;
  res.headers.set('access-control-allow-origin', origin);
  res.headers.set('access-control-expose-headers', 'content-disposition');
  res.headers.append('vary', 'Origin');
  return res;
}

async function verifierDemo(ctx) {
  if (ctx.env.MODE !== 'demo') return null;
  const duree = Number(ctx.env.DEMO_DUREE_H || 72);
  await run(ctx.db, 'INSERT OR IGNORE INTO parametres(cle, valeur) VALUES (?, ?)', 'demo_debut', nowIso());
  const d = await first(ctx.db, "SELECT valeur FROM parametres WHERE cle = 'demo_debut'");
  const fin = new Date(new Date(d.valeur).getTime() + duree * 3600000);
  return { debut: d.valeur, fin: fin.toISOString(), expiree: Date.now() > fin.getTime() };
}

export async function handle(req, env) {
  const url = new URL(req.url);
  url.pathname = url.pathname.replace(/^\/functions\/v1(?=\/api\/)/, ''); // adresse Supabase
  if (!url.pathname.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(req) : new Response('Not found', { status: 404 });
  const ctx = {
    req, env, url, db: env.DB, query: Object.fromEntries(url.searchParams),
    ip: req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'local',
  };
  let origineOk = null;
  try {
    const origin = req.headers.get('origin');
    if (origin && (await originesAutorisees(ctx)).has(origin)) origineOk = origin;
    if (req.method === 'OPTIONS') {
      return cors(new Response(null, { status: origineOk ? 204 : 403, headers: {
        'access-control-allow-methods': 'GET, POST, PUT, DELETE', 'access-control-max-age': '86400',
        'access-control-allow-headers': 'content-type, x-rt, idempotency-key, authorization, x-cron-key' } }), origineOk);
    }
    const found = routes.find((r) => r.method === req.method && r.rx.test(url.pathname));
    if (!found) fail(404, 'Service introuvable.', 'INTROUVABLE');
    const m = url.pathname.match(found.rx);
    ctx.params = Object.fromEntries(found.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));

    if (req.method !== 'GET') {
      // Protection CSRF : en-tête personnalisé obligatoire + origine identique.
      if (req.headers.get('x-rt') !== '1') fail(403, 'Requête refusée.', 'CSRF');
      if (origin && !origineOk) fail(403, 'Requête refusée (origine non autorisée).', 'CSRF');
      const txt = await req.text();
      if (txt.length > 5_000_000) fail(413, 'Données trop volumineuses.', 'TROP_GROS');
      try { ctx.body = txt ? JSON.parse(txt) : {}; } catch { fail(400, 'Données illisibles.', 'JSON'); }
      const k = req.headers.get('idempotency-key');
      if (k) { if (!/^[A-Za-z0-9-]{8,64}$/.test(k)) fail(400, 'Clé d’opération invalide.', 'IDEM'); ctx.idem = k; }
    }

    ctx.demo = await verifierDemo(ctx);
    if (ctx.demo?.expiree && !found.opts.toujours) fail(403, 'La période de démonstration de 3 jours est terminée. Contactez Ampandrana Création Logiciel pour obtenir la version complète.', 'DEMO_EXPIREE');

    if (!found.opts.public) {
      ctx.user = await chargerSession(ctx);
      if (!ctx.user) fail(401, 'Votre session a expiré. Veuillez vous reconnecter.', 'NON_CONNECTE');
      if (ctx.user.doit_changer_mdp && !found.opts.mdp) fail(403, 'Vous devez changer votre mot de passe avant de continuer.', 'MDP_A_CHANGER');
    }
    const out = await found.handler(ctx);
    const res = out instanceof Response ? out : json(out ?? { ok: true });
    for (const [k, v] of Object.entries(SECU)) res.headers.set(k, v);
    return cors(res, origineOk);
  } catch (e) {
    if (e instanceof HttpError) return cors(json({ erreur: e.message, code: e.code }, e.status, SECU), origineOk);
    const ref = uid().slice(0, 8);
    console.error('ERREUR', ref, e?.stack || e);
    const m = String(e?.message || '');
    if (/limit exceeded|quota/i.test(m)) return cors(json({ erreur: 'Limite journalière de l’hébergement gratuit atteinte. Réessayez plus tard ou passez à l’offre payante.', code: 'QUOTA', ref }, 503, SECU), origineOk);
    return cors(json({ erreur: `Une erreur inattendue est survenue (réf. ${ref}). Réessayez ; si le problème continue, prévenez l’administrateur.`, code: 'INTERNE', ref }, 500, SECU), origineOk);
  }
}
