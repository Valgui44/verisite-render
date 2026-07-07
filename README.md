# VeriSite — Service de rendu headless (V2 du scanner)

Petit service qui charge une page **avec exécution du JavaScript** (Chromium via Playwright) et
renvoie ce que le scanner PHP ne pouvait pas voir en V1 :

- `html` — le DOM final après chargement
- `cookies` — les cookies **réellement déposés**, y compris ceux posés en JavaScript (`_ga`, `_fbp`, `_hjSession`…), **avant tout consentement**
- `requests` — toutes les requêtes réseau émises (pour détecter les traceurs injectés dynamiquement, ex. via Google Tag Manager)

Le service **ne clique pas** sur le bandeau cookies : on veut précisément l'état *avant* consentement, qui est celui qui déclenche les sanctions CNIL.

## API

`GET /health` → `{ "ok": true, ... }`

`POST /render` (header `Authorization: Bearer <RENDER_TOKEN>`)
```json
{ "url": "https://exemple.fr" }
```
Réponse :
```json
{
  "ok": true,
  "finalUrl": "https://exemple.fr/",
  "html": "<!doctype html>…",
  "cookies": [{ "name": "_ga", "domain": ".exemple.fr", "httpOnly": false, "secure": true, "session": false }],
  "requests": [{ "url": "https://www.google-analytics.com/g/collect?…", "type": "xhr" }]
}
```

## Variables d'environnement

| Variable | Rôle | Défaut |
|---|---|---|
| `RENDER_TOKEN` | Bearer token exigé sur `/render`. **À définir en prod.** | (vide = pas d'auth) |
| `PORT` | Port d'écoute | `3000` |
| `NAV_TIMEOUT_MS` | Timeout de navigation | `20000` |
| `SETTLE_MS` | Attente après `networkidle` (scripts différés) | `1500` |

## Tester en local

```bash
cd render-service
npm install
npm run setup            # télécharge Chromium (une seule fois)
RENDER_TOKEN=change-moi npm start
# dans un autre terminal :
curl -s -X POST http://localhost:3000/render \
  -H "Authorization: Bearer change-moi" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.lemonde.fr"}' | head -c 600
```

## Déployer (choisis-en un — le service est identique partout)

Le service tourne **à part** de ton hébergement OVH mutualisé (qui ne peut pas exécuter Chromium).
Ton PHP l'appellera via son URL publique.

**Option A — Render.com (Docker, a un plan gratuit)** *(recommandé pour démarrer)*
1. Pousser `render-service/` sur un repo Git.
2. Render → New → Web Service → sélectionner le repo → runtime **Docker**.
3. Variable d'env : `RENDER_TOKEN` = un secret long (ex. `openssl rand -hex 24`).
4. Déployer → récupérer l'URL (ex. `https://verisite-render.onrender.com`).

**Option B — Fly.io (Docker, quasi gratuit)**
```bash
fly launch --dockerfile Dockerfile --now
fly secrets set RENDER_TOKEN=$(openssl rand -hex 24)
```

**Option C — Railway** : New Project → Deploy from repo → Docker détecté → ajouter `RENDER_TOKEN`.

**Option D — VPS OVH (~4-5€/mois, tu gardes tout chez OVH)**
```bash
# sur le VPS (Docker installé)
docker build -t verisite-render .
docker run -d --restart=always -p 3000:3000 -e RENDER_TOKEN=ton-secret verisite-render
# puis un reverse proxy (Caddy/Nginx) pour le HTTPS
```

## Brancher au scanner

Dans `config.php` (côté site OVH) :
```php
define('RENDER_SERVICE_URL',   'https://TON-SERVICE/render');
define('RENDER_SERVICE_TOKEN', 'le-même-secret-que-RENDER_TOKEN');
```

Tant que ces deux valeurs sont vides, le scanner fonctionne exactement comme avant (V1, HTML serveur).
Dès qu'elles sont remplies, le RGPDChecker bascule sur les cookies et requêtes **réels**.

## Note de coût / perf

Un rendu prend ~2-5 s et consomme de la RAM (Chromium). Pour un usage faible (scans à la demande),
le plan gratuit de Render/Fly suffit. Si le volume monte, augmente la RAM de l'instance ou mets une
petite file d'attente. Le service garde une instance de navigateur chaude entre les requêtes pour la vitesse.
