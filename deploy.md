# MemeForge - 熊猫头表情包工坊

## What's Included

This repo contains both **source code** and **pre-built files**.

```
├── dist/              ← Pre-built website (deploy this)
│   ├── index.html     ← Entry point
│   ├── _redirects     ← SPA routing fallback
│   ├── netlify.toml   ← Netlify config
│   ├── vercel.json    ← Vercel config
│   ├── _routes.json   ← Cloudflare config
│   ├── assets/        ← 91 template images + JS/CSS
│   └── museum/        ← 99 gallery images
│
├── src/               ← Source code
├── public/            ← Static assets
├── package.json
└── vite.config.ts
```

---

## Deploy to Netlify (2 Ways)

### Way 1: Drag & Drop (Fastest)

1. Go to https://app.netlify.com/drop
2. Drag the `dist/` folder onto the page
3. Wait 10 seconds, get your URL

### Way 2: Git Auto-Build

1. Push this repo to GitHub
2. Go to https://app.netlify.com → Add new site → Import from Git
3. Build settings:
   - Build command: `npm run build`
   - Publish directory: `dist`
4. Deploy

---

## Deploy to Vercel

1. Push this repo to GitHub
2. Go to https://vercel.com/new → Import
3. Framework: **Vite**
4. Build output: `dist`
5. Deploy

---

## Deploy to Cloudflare Pages

1. Push this repo to GitHub
2. Go to https://dash.cloudflare.com → Pages → Create project
3. Build command: `npm run build`
4. Build output: `dist`
5. Save and deploy

---

## Build From Source (Optional)

If you modified source code, rebuild:

```bash
npm install
npm run build
```

Output goes to `dist/`.

---

## Verify

| Check | Expected |
|-------|----------|
| Homepage loads | Editor page with dark background |
| Refresh (F5) | No 404 |
| Click panda + face | Face auto-aligns to panda eyes |
| "Random Combo" | Generates random meme |
| "Download" | PNG downloads |
| Museum page | 99 images load, none broken |
| Mobile | 🐼 and ⬆ floating buttons work |

---

## Fix 404

If refresh gives 404, check `dist/_redirects` exists:
```
/* /index.html 200
```

This file is already in `dist/`. If missing, copy from `public/_redirects`.
