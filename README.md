# Discord Embed Viewer

Colle un lien → vois l'embed tel que **Discord** l'afficherait (titre, description, image, vignette, vidéo, couleur, site).

Discord ne lit jamais la page depuis ton navigateur : **ses serveurs** fetch l'URL, parsent les balises `Open Graph` / `Twitter Card` / `oEmbed`, puis envoient les données prêtes à afficher. Ce projet fait pareil : un petit backend scrape les meta tags, la page se contente de dessiner la carte.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | UI + carte façon Discord (aucun build) |
| `embed.js` | Extraction des meta tags — partagé Node + Worker |
| `server.js` | Backend de **dev local** (Node, zéro dépendance) |
| `worker.js` | Backend de **prod** (Cloudflare Worker) |
| `wrangler.toml` | Config du déploiement Worker |

## Local

```bash
node server.js        # → http://localhost:8787
```

`API_BASE` vaut `''` en local : la page appelle `server.js` sur la même origine.

## Prod

1. **Worker** (backend) :
   ```bash
   npx wrangler login
   npx wrangler deploy
   ```
   Note l'URL renvoyée, ex. `https://discord-embed-viewer.<ton-sous-domaine>.workers.dev`.

2. Dans `index.html`, remplace l'URL placeholder de `API_BASE`.

3. **GitHub Pages** (frontend) : Settings → Pages → Deploy from branch → `main` / `/ (root)`.
   Pas de build, `.nojekyll` désactive Jekyll.

## Notes

- `↻` re-scrape sans cache (`&t=…` + `Cache-Control: no-store`) — pratique quand tu modifies les meta d'une page et veux revoir l'embed.
- Garde anti-SSRF sur le backend (hôtes internes / metadata cloud bloqués).
- Images chargées via `/api/image` pour contourner le blocage du hotlink par referer.
- `ponytail:` seuls les ~200 Ko du `<head>` sont lus (limite CPU du tier gratuit Workers + taille).
