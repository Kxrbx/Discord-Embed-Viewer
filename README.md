# Discord Embed Viewer

**Paste any URL and see the embed Discord would show for it** — title, description, image, thumbnail, video, color bar and site name — without posting it in a server.

> **Try it live:** https://kxrbx.github.io/Discord-Embed-Viewer/

---

## What it does

Discord never renders a link client-side. When you paste a URL in a chat, **Discord's servers** fetch that page, read its `Open Graph` / `Twitter Card` / `oEmbed` metadata, and send the ready-to-display embed back to every client. This tool does the same thing, so you can preview exactly what the embed will look like before sharing it.

Handy for checking that a page's meta tags are set up correctly — for your own site, a blog post, a product page, a YouTube video, etc.

## How to use it

1. Open the [live site](https://kxrbx.github.io/Discord-Embed-Viewer/).
2. Paste a link into the field (the `https://` prefix is optional).
3. Press **Vérifier** (Check) — or just hit Enter.
4. The embed appears below, rendered the way Discord shows it.

**↻** re-fetches the page with the cache bypassed. Useful after you edit a page's metadata and want to see the change immediately without re-pasting the link.

A collapsible **Données brutes** (raw data) panel shows everything that was extracted from the page, so you can debug missing tags.

## What it renders

| Field | Source (in priority order) |
|---|---|
| Title | `og:title` → oEmbed → `twitter:title` → `<title>` |
| Description | `og:description` → oEmbed → `twitter:description` → `<meta name="description">` |
| Image / thumbnail | `og:image`, or `twitter:image` (`twitter:card=summary` becomes a small thumbnail) |
| Video | `og:video` |
| Site name | `og:site_name` → oEmbed provider → domain |
| Accent color | `<meta name="theme-color">` |
| Favicon | `<link rel="icon">` |

oEmbed is discovered automatically from the page's `<head>`, so it works with YouTube, Reddit and many others without a per-site registry.

## Notes & limitations

- Only the first ~200 KB of each page is read (the metadata lives in the `<head>`).
- Some sites block bots or don't publish Open Graph tags — the embed will be sparse, and a warning is shown if the page returned an error status.
- Images load **directly from their source** (with `referrerpolicy="no-referrer"`); the backend only proxies the rare hotlink-protected ones, as a fallback.
- This is a **preview** of Discord's rendering, not a pixel-perfect clone; Discord's own crawler has special-cased providers (Spotify, Twitter/X, …) that aren't replicated here.

## Self-hosting

The project is a static frontend plus a tiny backend. The frontend is pure HTML/CSS/JS (no build step); the backend scrapes pages on the server because browsers can't fetch arbitrary URLs cross-origin.

**Local:**

```bash
node server.js      # → http://localhost:8787
```

**Production:**

1. Deploy the backend as a Cloudflare Worker:
   ```bash
   npx wrangler login
   npx wrangler deploy
   ```
2. In `index.html`, set `API_BASE` to the Worker URL (only used when the page is served from `github.io`).
3. Host `index.html` anywhere static — GitHub Pages works as-is (`.nojekyll` disables Jekyll).

### Backend cost

The Worker is tuned to stay well inside Cloudflare's free tier:

- One check = **one Worker request** (the target page is fetched as a subrequest).
- Images never touch the Worker by default — the browser loads them directly.
- Only the first ~200 KB of a page is streamed, then the connection is cut.
- Successful results are edge-cached for 5 minutes, so re-checking the same URL is free. The **↻** button bypasses the cache. Set `EMBED_TTL = 0` in `worker.js` to disable caching.

### Project layout

| File | Role |
|---|---|
| `index.html` | UI and the Discord-style embed card |
| `embed.js` | Metadata extraction — shared by Node and the Worker |
| `server.js` | Local dev backend (Node, zero dependencies) |
| `worker.js` | Production backend (Cloudflare Worker) |
| `wrangler.toml` | Worker deploy config |
