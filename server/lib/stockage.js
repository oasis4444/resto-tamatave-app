// Stockage des sauvegardes dans Supabase Storage (bucket privé), avec la même interface que R2 : put / get / delete.
export function stockageSupabase(url, cleService, bucket = 'sauvegardes') {
  const base = `${url}/storage/v1/object/${bucket}/`;
  const h = { authorization: `Bearer ${cleService}`, apikey: cleService };
  const chemin = (k) => k.split('/').map(encodeURIComponent).join('/');
  return {
    async put(cle, corps) {
      const r = await fetch(base + chemin(cle), { method: 'POST', headers: { ...h, 'content-type': 'application/json', 'x-upsert': 'true' }, body: corps });
      if (!r.ok) throw new Error('Stockage des sauvegardes : ' + r.status + ' ' + (await r.text()).slice(0, 200));
    },
    async get(cle) {
      const r = await fetch(base + chemin(cle), { headers: h });
      if (r.status === 404 || r.status === 400) return null;
      if (!r.ok) throw new Error('Stockage des sauvegardes : ' + r.status);
      const t = await r.text();
      return { text: async () => t };
    },
    async delete(cle) { await fetch(`${url}/storage/v1/object/${bucket}`, { method: 'DELETE', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: [cle] }) }); },
  };
}
