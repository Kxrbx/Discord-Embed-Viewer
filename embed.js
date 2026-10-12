// embed.js — extraction des métadonnées d'embed (façon Discord).
// ESM pur, zéro dépendance : tourne sous Node (server.js) ET Cloudflare Worker (worker.js).

export const BOT_UA = 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)';
const MAX_BYTES = 200_000; // ponytail: on ne lit que ~200 Ko (les <meta> sont dans le <head>). Monter si un site tronque ses tags.
const TIMEOUT_MS = 8000;
const DEFAULT_ACCEPT = 'text/html,application/xhtml+xml';

// Hôtes internes / métadonnées à ne jamais fetcher (garde anti-SSRF).
const PRIVATE_HOST = [
  /^localhost$/i,
  /\.local$/i,
  /^\[?::1\]?$/,
  /^\[?0:0:0:0:0:0:0:1\]?$/,
  /^127\./,
  /^0\./,
  /^10\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?f[cd][0-9a-f]{2}:/i,
  /^\[?fe80:/i,
];

export function isPrivateHost(hostname) {
  return PRIVATE_HOST.some((re) => re.test(hostname));
}

export function assertSafeUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('URL invalide');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Seuls http:// et https:// sont autorisés');
  if (isPrivateHost(u.hostname)) throw new Error('Hôte interne bloqué');
  return u;
}

async function fetchText(rawUrl, accept = DEFAULT_ACCEPT) {
  const u = assertSafeUrl(rawUrl);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(u.href, {
      redirect: 'follow',
      signal: ctl.signal,
      headers: { 'user-agent': BOT_UA, accept, 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8' },
    });
    const text = (await res.text()).slice(0, MAX_BYTES);
    return {
      ok: res.ok,
      status: res.status,
      finalUrl: res.url || u.href,
      contentType: (res.headers.get('content-type') || '').toLowerCase(),
      text,
    };
  } finally {
    clearTimeout(timer);
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, e) => ENTITIES[e.toLowerCase()] ?? m);
}

function attr(tag, name) {
  const re = new RegExp('\\b' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
  const m = tag.match(re);
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? '') : null;
}

function collectMeta(html) {
  const meta = {};
  for (const { 0: tag } of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = attr(tag, 'property') || attr(tag, 'name') || attr(tag, 'itemprop');
    const content = attr(tag, 'content');
    if (key && content != null) {
      const k = key.toLowerCase();
      if (meta[k] === undefined) meta[k] = content;
    }
  }
  const links = [];
  for (const { 0: tag } of html.matchAll(/<link\b[^>]*>/gi)) {
    links.push({
      rel: (attr(tag, 'rel') || '').toLowerCase(),
      type: (attr(tag, 'type') || '').toLowerCase(),
      href: attr(tag, 'href') || '',
    });
  }
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return { meta, links, title: t ? decode(t[1]).trim() : '' };
}

export async function extractEmbed(rawUrl) {
  const page = await fetchText(rawUrl);
  const base = page.finalUrl;

  // Réponse non-HTML = fichier direct (image/vidéo/audio/pdf) façon "pièce jointe".
  const ct = page.contentType;
  if (/^image\//.test(ct)) return fileEmbed(base, 'image');
  if (/^video\//.test(ct)) return fileEmbed(base, 'video');
  if (/^audio\//.test(ct)) return fileEmbed(base, 'audio');
  if (ct && !/html|xml|text/.test(ct)) return fileEmbed(base, 'file');

  if (!page.text.trim()) throw new Error(`La page a répondu ${page.status} sans contenu`);

  const { meta, links, title: docTitle } = collectMeta(page.text);
  const abs = (v) => {
    try {
      return v ? new URL(v, base).href : null;
    } catch {
      return null;
    }
  };
  const pick = (...keys) => {
    for (const k of keys) if (meta[k]) return meta[k];
  };

  // 1) oEmbed découvert dans <head> — couvre YouTube/Reddit/etc. sans registre de providers.
  const oeLink = links.find((l) => l.type.includes('json') && l.href);
  let oembed = null;
  if (oeLink) {
    try {
      const r = await fetchText(abs(oeLink.href), 'application/json');
      if (r.text.trim()) oembed = JSON.parse(r.text);
    } catch {
      /* oEmbed optionnel */
    }
  }

  const ogImage = pick('og:image:secure_url', 'og:image:url', 'og:image');
  const twImage = pick('twitter:image', 'twitter:image:src');
  const twCard = (meta['twitter:card'] || '').toLowerCase();
  const mk = (src, w, h) =>
    src ? { url: abs(src), width: w ? Number(w) : null, height: h ? Number(h) : null } : null;

  // Discord : grand visuel par défaut ; twitter:card=summary => petite vignette à droite.
  let image = null;
  let thumbnail = null;
  if (ogImage) {
    image = mk(ogImage, meta['og:image:width'], meta['og:image:height']);
  } else if (twImage) {
    const t = mk(twImage, meta['twitter:image:width'], meta['twitter:image:height']);
    if (twCard === 'summary') thumbnail = t;
    else image = t;
  } else if (oembed?.thumbnail_url) {
    thumbnail = mk(oembed.thumbnail_url, oembed.thumbnail_width, oembed.thumbnail_height);
  }

  const videoUrl = pick('og:video:secure_url', 'og:video:url', 'og:video');
  const video = videoUrl
    ? {
        url: abs(videoUrl),
        type: meta['og:video:type'] || '',
        width: meta['og:video:width'] ? Number(meta['og:video:width']) : null,
        height: meta['og:video:height'] ? Number(meta['og:video:height']) : null,
      }
    : null;

  const theme = (meta['theme-color'] || '').trim();
  const color = /^#?[0-9a-f]{3,8}$/i.test(theme) ? (theme[0] === '#' ? theme : '#' + theme) : null;

  const iconLink = links.find((l) => /icon/.test(l.rel) && l.href);
  const authorName = oembed?.author_name || meta['article:author'] || meta['twitter:creator'] || null;

  return {
    kind: 'link',
    status: page.status,
    url: abs(meta['og:url']) || base,
    siteName: meta['og:site_name'] || oembed?.provider_name || new URL(base).hostname,
    author: authorName ? { name: authorName, url: abs(oembed?.author_url), icon: null } : null,
    title: pick('og:title') || oembed?.title || meta['twitter:title'] || docTitle || '',
    description:
      pick('og:description') || oembed?.description || meta['twitter:description'] || meta['description'] || '',
    color,
    image,
    thumbnail,
    video,
    favicon: iconLink ? abs(iconLink.href) : null,
    provider: oembed?.provider_name
      ? { name: oembed.provider_name, url: abs(oembed.provider_url) }
      : null,
    raw: {
      og: pickAll(meta, 'og:'),
      twitter: pickAll(meta, 'twitter:'),
      oembed,
    },
  };
}

function pickAll(meta, prefix) {
  return Object.fromEntries(Object.entries(meta).filter(([k]) => k.startsWith(prefix)));
}

function fileEmbed(url, kind) {
  let host = '';
  let name = url;
  try {
    const u = new URL(url);
    host = u.hostname;
    name = decodeURIComponent(u.pathname.split('/').pop()) || url;
  } catch {
    /* garde url brute */
  }
  return {
    kind,
    status: 200,
    url,
    siteName: host,
    author: null,
    title: name,
    description: '',
    color: null,
    image: kind === 'image' ? { url, width: null, height: null } : null,
    thumbnail: null,
    video: kind === 'video' ? { url, type: '', width: null, height: null } : null,
    favicon: null,
    provider: null,
    raw: {},
  };
}