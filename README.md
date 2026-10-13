# raphael-montico

Portfolio AI-native de Raphaël Montico : un site Next.js statique (FR/EN) couplé à un backend FastAPI qui expose un chatbot RAG (recherche sémantique + OpenAI) sur le contenu du site.

## Présentation

[raphaelmontico.fr](https://raphaelmontico.fr) présente le parcours, les expériences professionnelles et les projets professionnels de Raphaël Montico. Au-delà de la vitrine classique, l'ensemble du contenu du site (pages, expériences, projets) est chunké, embeddé et stocké dans pgvector afin d'être interrogeable en langage naturel par un assistant IA — le site sert ainsi à la fois de portfolio et de terrain de démonstration d'une architecture RAG en production.

- **Portfolio** : parcours pro, projets professionnels et scolaires, diplômes — en FR/EN
- **Recherche sémantique** : `POST /api/search` interroge les contenus indexés par similarité vectorielle plutôt que par mot-clé
- **Assistant IA (RAG)** : `POST /api/chat` répond en streaming (SSE) à des questions sur le profil et les projets, via le fournisseur choisi dans `.env` ; l'interface de chat côté frontend est en cours de finalisation
- **Ingestion automatisée** : le contenu MDX est ré-indexé automatiquement (embeddings OpenAI → pgvector) à chaque changement, via GitHub Actions

## Architecture

```text
frontend (Next.js, export statique)  →  S3 + CloudFront
backend  (FastAPI)                   →  API Gateway / App Runner
  ├─ ingest/   pipeline d'ingestion du contenu MDX → chunks → embeddings → pgvector
  └─ app/      API (chat streaming SSE, recherche sémantique, providers OpenAI)
PostgreSQL + pgvector                →  stockage des chunks et de leurs embeddings
```

Le frontend reste 100 % statique ; toute la logique IA (retrieval, appel LLM, embeddings) vit dans le backend, déployé séparément.

## Structure du repo

```text
frontend/   Next.js (App Router) + Tailwind, contenu MDX, i18n FR/EN
backend/    FastAPI + SQLAlchemy async + pgvector, pipeline d'ingestion, tests pytest
scripts/    Traduction FR→EN automatisée (OpenAI) + rapport de parité
data/       Registre des checksums de traduction (translation-checksums.json)
tests/      Vérification de parité de contenu FR/EN (nombre de pages MDX par collection)
.github/    Workflows CI + déploiement (frontend, backend, ingestion)
```

## Stack technique

- **Frontend** : Next.js (App Router), TypeScript, Tailwind CSS v4, [next-intl](https://next-intl.dev) (i18n), MDX (`gray-matter` + `next-mdx-remote`)
- **Backend** : FastAPI, SQLAlchemy (async) + asyncpg, Alembic, PostgreSQL + pgvector
- **IA** : embeddings OpenAI (`text-embedding-3-small`), LLM OpenAI GPT-6 Luna (réponses en streaming SSE)
- **Infra** : AWS (S3 + CloudFront pour le frontend, API Gateway/App Runner + Postgres pour le backend), GitHub Actions pour CI/CD et l'ingestion de contenu

## Démarrer en local

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Ouvrir [http://localhost:3000](http://localhost:3000) (redirige vers `/fr`). Détails : [frontend/README.md](frontend/README.md).

### Backend

```bash
cd backend
cp .env.example .env   # renseigner OPENAI_API_KEY
docker compose up -d postgres
pip install -r requirements-dev.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8080
```

Lancer l'ingestion du contenu MDX (`frontend/content/`) vers pgvector :

```bash
python -m ingest
```

Lancer les tests / lint :

```bash
ruff check .
pytest
```

## Endpoints principaux

- `GET /health` — healthcheck
- `POST /api/search` — recherche sémantique sur les chunks indexés
- `POST /api/chat` — chat RAG en streaming (SSE) via le fournisseur défini par `LLM_PROVIDER`

## Traduction du contenu (FR → EN)

Le FR est la source de vérité. Un registre de checksums (`data/translation-checksums.json`) détecte
les pages FR modifiées, et un script traduit automatiquement via OpenAI.

```bash
node scripts/check-translation-status.js   # rapport de parité FR/EN
node scripts/translate-fr-to-en.js --all-pending
```

## Licence

Tous droits réservés : ce dépôt est publié pour consultation uniquement. Toute reproduction ou réutilisation (code, contenus, images, photographies) nécessite l'accord écrit de l'auteur. Voir [LICENSE](LICENSE).

## CI/CD

- `ci.yml` — lint + tests backend, lint + build frontend, sur chaque PR vers `main`
- `deploy-frontend.yml` / `deploy-backend.yml` — déploiement sur push `main`
- `ingest.yml` — relance le pipeline d'ingestion quand le contenu MDX ou le code d'ingestion change
