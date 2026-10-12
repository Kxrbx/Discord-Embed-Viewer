import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { extractEmbed, assertSafeUrl, isPrivateHost, BOT_UA } from './embed.js';

const PORT = process.env.PORT || 8787;
const CORS = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };

const json = (res, body, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...CORS });
  res.end(JSON.stringify(body));
};

// ponytail: un Worker ne peut pas résoudre le DNS → sa garde reste sur IP littérale.
// Ici (Node) on résout en plus le hostname pour bloquer un domaine pointant vers du local.
async function guardedUrl(rawUrl) {
  const u = assertSafeUrl(rawUrl);
  try {
    const { address } = await lookup(u.hostname);
    if (address && isPrivateHost(address)) throw new Error('Hôte interne bloqué (DNS)');
  } catch (e) {
    if (/interne/.test(e.message)) throw e;
  }
  return u;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = await readFile(new URL('./index.html', import.meta.url));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    if (url.pathname === '/api/embed') {
      const target = url.searchParams.get('url');
      if (!target) return json(res, { error: 'Paramètre url manquant' }, 400);
      try {
        return json(res, await extractEmbed(target));
      } catch (e) {
        return json(res, { error: e.message || String(e) }, 502);
      }
    }

    if (url.pathname === '/api/image') {
      const target = url.searchParams.get('url');
      if (!target) return json(res, { error: 'Paramètre url manquant' }, 400);
      const u = await guardedUrl(target);
      const up = await fetch(u.href, { redirect: 'follow', headers: { 'user-agent': BOT_UA } });
      const ct = up.headers.get('content-type') || '';
      if (!ct.startsWith('image/')) return json(res, { error: 'Pas une image' }, 415);
      res.writeHead(200, {
        'content-type': ct,
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=3600',
      });
      return Readable.fromWeb(up.body).pipe(res);
    }

    if (url.pathname === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }

    return json(res, { error: 'Not found' }, 404);
  } catch (e) {
    return json(res, { error: e.message || String(e) }, 500);
  }
});

server.listen(PORT, () => console.log(`Discord Embed Viewer → http://localhost:${PORT}`));