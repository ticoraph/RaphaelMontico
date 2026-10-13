# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Portfolio site for Raphaël Montico: a static Next.js site (FR/EN) paired with a FastAPI backend that
exposes a RAG chatbot (semantic search + OpenAI) over the site's own content. The frontend stays
100% static (S3 + CloudFront); all AI logic (retrieval, LLM calls, embeddings) lives in the backend,
deployed separately (App Runner / API Gateway). Overview: `README.md`. Backend architecture
detail: `backend/README.md`. Translation tooling: `docs/TRANSLATION.md`.

```text
frontend (Next.js, static export)  →  S3 + CloudFront
backend  (FastAPI)                 →  API Gateway / App Runner
  ├─ ingest/   MDX content → chunks → embeddings → pgvector
  └─ app/      API (chat streaming SSE, semantic search, OpenAI/Gemini providers)
PostgreSQL + pgvector              →  chunk + embedding storage
```

## Repo layout

- `frontend/` — Next.js (App Router), TypeScript, Tailwind v4, next-intl (FR/EN), MDX content
- `backend/` — FastAPI, SQLAlchemy async + asyncpg, Alembic, pgvector, ingestion pipeline, pytest, Langfuse observability (v4)
- `docs/` — tooling docs (`TRANSLATION.md`, `LANGFUSE.md`)
- `scripts/` — FR→EN content translation tooling (OpenAI), translation-parity checker
- `.github/workflows/` — CI, deploy-frontend, deploy-backend, ingest

## Commands

### Frontend (`frontend/`)

```bash
npm install
npm run dev      # localhost:3000, redirects to /fr
npm run build
npm run lint
```

### Backend (`backend/`)

```bash
python -m venv .venv && source .venv/bin/activate   # or use existing backend/.venv
pip install -r requirements-dev.txt
cp .env.example .env             # fill in OPENAI_API_KEY, GEMINI_API_KEY (embeddings), LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL
docker compose up -d postgres    # PostgreSQL 16 + pgvector (docker-compose.yml lives in backend/)
alembic upgrade head
python -m ingest                 # indexes frontend/content/ into pgvector — run from backend/
uvicorn app.main:app --reload --port 8080

ruff check .
pytest                           # tests marked "integration" (retriever) require Postgres running
pytest tests/test_retriever.py -k some_test   # single test
```

**Local dev pitfalls** (see also `backend/README.md`):
- Use `backend/.venv/bin/python` / `backend/.venv/bin/pytest` explicitly if invoking outside an
  activated shell — don't pick up an unrelated system/conda Python.
- Integration tests `TRUNCATE chunks` after each run — running `pytest` against your dev DB **wipes
  ingested data**; re-run `python -m ingest` afterwards if you need the chat/search working locally.
- Docker Desktop isn't always running (`open -a Docker` first).

### Content translation (root)

```bash
node scripts/check-translation-status.js [--json] [--fail-on-drift] [--update]
node scripts/translate-fr-to-en.js --file <path> | --all-pending [--dry-run] [--show-prompt]
```

FR is the source of truth; EN is generated via OpenAI and tracked by SHA-256 checksums of the
MDX body (frontmatter excluded) in `data/translation-checksums.json`. See `docs/TRANSLATION.md` for
the full workflow, including how to register a new content collection in both scripts' `COLLECTIONS`
array when adding a content folder under `frontend/content/`.

## Backend architecture

- `app/providers/` — `EmbeddingProvider` / `LLMProvider` interfaces with OpenAI (default chat LLM, `OPENAI_CHAT_MODEL`) and Gemini implementations;
  `registry.py` selects the provider (`get_llm_provider("openai")`, driven by `LLM_PROVIDER`).
  Embeddings are still Gemini only.
- `app/db/retriever.py` — cosine-distance pgvector search, optional `type`/`language` filters,
  `score = 1 - distance`.
- `app/db/models.py` — `chunks` table (`type`, `title`, `slug`, `section`, `language`, `source_path`,
  `chunk_index`, `content`, `tags`, `timestamp`, `embedding Vector(768)`), HNSW cosine index.
- `app/rag/prompt.py` — builds the French RAG system prompt from retrieved chunks (answers must be
  grounded only in retrieved sources) and the citation objects.
- `ingest/` — parses MDX (`ingest/parser.py`), chunks by Markdown heading (`ingest/chunker.py`),
  embeds + upserts to Postgres in batches on `(source_path, chunk_index)` (`ingest/pipeline.py`).
  **If a content collection is added/renamed under `frontend/content/`, update
  `_COLLECTIONS_TO_TYPE` / `_SINGLE_PAGES_TO_TYPE` in `ingest/parser.py`** — otherwise it's silently
  skipped during ingestion.
- The deployed Docker image intentionally excludes `ingest/`; ingestion only ever runs via
  `.github/workflows/ingest.yml`, never inside the deployed container.

### Endpoints

- `GET /health`
- `POST /api/search` — `{query, top_k?, type?, language?}`
- `POST /api/chat` — SSE stream, `{message, history?, language?}` (the provider is `LLM_PROVIDER`, never client-selectable), events:
  `sources`, `token`, `error`, `done`

Changing `EMBEDDING_DIM` requires a migration and a full re-ingestion.

The API is public, so `/api/chat`, `/api/search` and `/api/index-status` are rate-limited per IP
(`app/rate_limit.py`), request bodies are capped (`app/body_limit.py`), input sizes are bounded in
`app/schemas.py` (mirrored in `frontend/lib/chat.ts`), LLM errors are never sent to the client, and
`/docs` / `/openapi.json` are off unless `ENABLE_DOCS=true`. Tunables: see `backend/README.md`.

## Frontend notes

- Content lives in `frontend/content/{en,fr}/` as MDX, organized by collection (`blog/`, `proxp/`,
  `perxp/`, `schoolprojects/`, `diplomas/`, plus the root page `home.mdx`) — this is the same
  content the backend ingests.
- i18n via next-intl; routes are under `frontend/app/[locale]/`.
- `frontend/CLAUDE.md` points to `frontend/AGENTS.md`, which flags that the pinned Next.js version may
  have breaking changes vs. training data — check `node_modules/next/dist/docs/` before relying on
  memorized Next.js APIs/conventions when working in `frontend/`.

## CI/CD

- `ci.yml` — backend lint+test, frontend lint+build, on every PR to `main`
- `deploy-frontend.yml` / `deploy-backend.yml` — deploy on push to `main`
- `ingest.yml` — re-runs the ingestion pipeline when MDX content or `backend/ingest/**` changes
