import { extractEmbed, assertSafeUrl } from './embed.js';

const CORS = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };

// Edge cache des résultats de check. Réduit fortement les sous-requêtes quand une même
// URL est revérifiée (itérations sur une page, plusieurs utilisateurs sur le même lien).
// Le bouton ↻ ajoute `&t=` qui contourne le cache. Mettre 0 pour désactiver.
// ponytail: cache frontière de 5 min ; monter si le coût l'emporte sur la fraîcheur.
const EMBED_TTL = 300;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
  });

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    if (url.pathname === '/api/embed') {
      const target = url.searchParams.get('url');
      if (!target) return json({ error: 'Missing url parameter' }, 400);

      const bust = url.searchParams.has('t');
      // Clé de cache insensible au cache-buster.
      const cacheKey = new Request(url.origin + '/api/embed?url=' + encodeURIComponent(target));
      const cache = caches.default;

      if (!bust && EMBED_TTL > 0) {
        const hit = await cache.match(cacheKey);
        if (hit) return hit;
      }

      try {
        const res = new Response(JSON.stringify(await extractEmbed(target)), {
          headers: {
            'content-type': 'application/json; charset=utf-8',
            ...CORS,
            'cache-control': bust || EMBED_TTL === 0 ? 'no-store' : `public, max-age=${EMBED_TTL}`,
          },
        });
        // On ne met en cache que les succès.
        if (!bust && EMBED_TTL > 0) ctx.waitUntil(cache.put(cacheKey, res.clone()));
        return res;
      } catch (e) {
        return json({ error: e.message || String(e) }, 502);
      }
    }

    // Secours pour les images qui bloquent le hotlink : le navigateur les charge en direct
    // d'abord, et n'appelle ce endpoint qu'en cas d'échec.
    if (url.pathname === '/api/image') {
      const target = url.searchParams.get('url');
      if (!target) return json({ error: 'Missing url parameter' }, 400);
      try {
        // ponytail: garde sur IP littérale seulement — un Worker ne résout pas le DNS.
        const u = assertSafeUrl(target);
        const up = await fetch(u.href, { redirect: 'follow' });
        const ct = up.headers.get('content-type') || '';
        if (!ct.startsWith('image/')) return json({ error: 'Not an image' }, 415);
        return new Response(up.body, {
          headers: {
            'content-type': ct,
            'access-control-allow-origin': '*',
            'cache-control': 'public, max-age=86400',
          },
        });
      } catch (e) {
        return json({ error: e.message || String(e) }, 502);
      }
    }

    return new Response('Discord Embed Viewer API — GET /api/embed?url=…', { headers: CORS });
  },
};