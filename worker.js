import { extractEmbed, assertSafeUrl } from './embed.js';

const CORS = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
  });

export default {
  async fetch(req) {
    const { pathname, searchParams } = new URL(req.url);

    if (pathname === '/api/embed') {
      const target = searchParams.get('url');
      if (!target) return json({ error: 'Paramètre url manquant' }, 400);
      try {
        return json(await extractEmbed(target));
      } catch (e) {
        return json({ error: e.message || String(e) }, 502);
      }
    }

    if (pathname === '/api/image') {
      const target = searchParams.get('url');
      if (!target) return json({ error: 'Paramètre url manquant' }, 400);
      try {
        // ponytail: garde sur IP littérale seulement — un Worker ne résout pas le DNS (pas de SSRF réseau local possible ici).
        const u = assertSafeUrl(target);
        const up = await fetch(u.href, { redirect: 'follow' });
        const ct = up.headers.get('content-type') || '';
        if (!ct.startsWith('image/')) return json({ error: 'Pas une image' }, 415);
        return new Response(up.body, {
          headers: {
            'content-type': ct,
            'access-control-allow-origin': '*',
            'cache-control': 'public, max-age=3600',
          },
        });
      } catch (e) {
        return json({ error: e.message || String(e) }, 502);
      }
    }

    return new Response('Discord Embed Viewer API — GET /api/embed?url=…', { headers: CORS });
  },
};