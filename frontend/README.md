# Frontend — Raphaël Montico Portfolio

MVP frontend du portfolio AI-native. Next.js (App Router) + Tailwind CSS, contenu MDX statique, i18n FR/EN.

Build en **export statique** (`output: "export"`) pour être servi par l'infra S3 + CloudFront existante (pas de serveur Node en prod).

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS v4
- [next-intl](https://next-intl.dev) — routing i18n par préfixe de locale (`/fr`, `/en`)
- `gray-matter` + `next-mdx-remote` — contenu MDX (frontmatter + rendu RSC)

## Démarrer

```bash
npm install
npm run dev
```

Ouvrir [http://localhost:3000](http://localhost:3000) (redirige vers `/fr`).

Variables d'environnement (voir `.env.example`) : `NEXT_PUBLIC_API_URL` (URL du backend FastAPI, `http://localhost:8080/api` par défaut). Injectées au build (export statique), pas au runtime.

## Structure du contenu

Le contenu éditorial vit dans `content/<locale>/...` (fichiers `.mdx` avec frontmatter) :

```text
content/
  fr/ en/
    proxp/*.mdx
    perxp/*.mdx
    schoolprojects/*.mdx
```

Pour ajouter du contenu réel, remplacer les fichiers placeholder existants par les vrais textes, en conservant le même frontmatter (`title`, `slug`, `date`, `tags`).

## Pages

- `/` (`/[locale]`) — Home
- `/proxp` — Expériences professionnelles
- `/perxp` — Expériences personnelles
- `/schoolprojects`, `/schoolprojects/[slug]` — Projets scolaires
- `/chat` — Assistant IA (shell "bientôt disponible", pas encore connecté au backend)

## Déploiement

- `npm run build` génère un export statique dans `frontend/out/` (un fichier `<route>/index.html` par page, `trailingSlash: true`).
- `.github/workflows/deploy-frontend.yml` build puis synchronise `out/` vers le bucket S3 existant (assets `_next/*` en cache long/immutable, le reste en `must-revalidate`), puis invalide CloudFront.
- L'export statique ne supporte pas le middleware/proxy Next.js : il n'y a donc pas de négociation de langue côté serveur. La racine `/` est une page statique avec un `<meta http-equiv="refresh">` vers `/fr/`.
- Comme chaque route produit son propre `index.html` dans un "dossier" (et non un unique `index.html` de SPA), la distribution CloudFront a besoin d'une CloudFront Function qui ajoute `index.html` aux URI de type dossier — ajoutée dans le module Terraform `cloudfront-spa` (`enable_directory_index_function`), activée uniquement pour ce stack (`infra/envs/prod/raphael-montico` dans `TneVa-Prod`).

## Hors scope (phases futures)

Le pipeline RAG (embeddings OpenAI, pgvector, retrieval), le chatbot fonctionnel côté frontend ne sont pas encore implémentés.
