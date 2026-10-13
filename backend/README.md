# Backend — API RAG du portfolio

API FastAPI qui expose un chatbot RAG et une recherche sémantique sur le contenu
du site (`frontend/content/`). Les documents MDX sont découpés en chunks,
vectorisés avec les embeddings Gemini, et stockés dans PostgreSQL + pgvector.

## Architecture

- **FastAPI** — API framework
- **SQLAlchemy + asyncpg** — async PostgreSQL access
- **pgvector** — HNSW index for cosine distance similarity search
- **openai** — OpenAI client (Responses API) for the chat LLM
- **google-genai** — Gemini API client (embeddings, optional chat provider)
- **Langfuse (v4)** — LLM observability and tracing
- **pytest** — integration and unit testing

```
frontend/content/**.mdx ──(ingestion CI)──▶ PostgreSQL + pgvector (table `chunks`)
                                                    │
POST /api/chat ── embed query (Gemini) ── similarity_search (cosine, top_k=5)
                                                    │
                              prompt système + chunks ──▶ LLM (OpenAI)
                                                    │
                                          streaming SSE vers le client
```

| Composant | Fichier(s) | Rôle |
|---|---|---|
| Providers | `app/providers/` | Interfaces `EmbeddingProvider` / `LLMProvider` + implémentations OpenAI (chat par défaut) et Gemini. `registry.py` fait la sélection (`get_llm_provider("openai")`, pilotée par `LLM_PROVIDER`). |
| Embeddings | `app/providers/embedding_gemini.py` | `gemini-embedding-001`, 768 dimensions (fixé par la migration — voir `EMBEDDING_DIM` dans `app/db/models.py`). |
| Retriever | `app/db/retriever.py` | Recherche par distance cosinus pgvector, filtres optionnels `type` / `language`, score = `1 - distance`. |
| Prompt RAG | `app/rag/prompt.py` | Injecte les chunks récupérés dans un prompt système en français (réponses ancrées dans les sources uniquement) et construit les objets de citation. |
| Modèle de données | `app/db/models.py` | Table `chunks` : `type`, `title`, `slug`, `section`, `language`, `source_path`, `chunk_index`, `content`, `tags`, `timestamp`, `embedding Vector(768)`. Index HNSW cosinus. |
| Ingestion | `ingest/` | Parse les MDX, découpe, vectorise, upsert en base. Voir ci-dessous. |

## Endpoints

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/health` | Healthcheck. |
| `POST` | `/api/search` | Recherche sémantique. Body : `{query, top_k?, type?, language?}`. Réponse JSON avec scores. |
| `POST` | `/api/chat` | Chat RAG en **SSE**. Body : `{message, history?, language?}` (le fournisseur est `LLM_PROVIDER`, non modifiable par le client). Événements : `sources` (citations), `token` (texte incrémental), `error`, `done`. |

## Pipeline d'ingestion

Point d'entrée : `python -m ingest` (depuis `backend/`). Étapes :

1. **Parsing** (`ingest/parser.py`) — lit tous les MDX de `frontend/content/{en,fr}/`
   avec `python-frontmatter`. Mapping collection → type de chunk :

   | Source | Type de chunk |
   |---|---|
   | `proxp/`, `perxp/` | `experience` |
   | `schoolprojects/` | `project` |
   | `diplomas/` | `diploma` |
   | `home.mdx` | `page_section` |

   Le frontmatter fournit `title`, `slug` (fallback : nom de fichier), `date`
   (formats acceptés : `YYYY-MM-DD`, `YYYY-MM`, `YYYY`, `MM/YYYY` et plages
   `MM/YYYY-MM/YYYY` — indexées par la date de début ; une date illisible donne
   `timestamp NULL` sans faire échouer l'ingestion) et `tags`.

   ⚠️ Si une collection est ajoutée/renommée dans `frontend/content/`, il faut
   mettre à jour `_COLLECTIONS_TO_TYPE` / `_SINGLE_PAGES_TO_TYPE` dans
   `ingest/parser.py` — sinon elle est silencieusement ignorée.

2. **Chunking** (`ingest/chunker.py`) — découpage par titres Markdown
   (`#` à `######`), un chunk par section ; document entier si aucun titre.

3. **Embedding + upsert** (`ingest/pipeline.py`) — vectorisation par lot
   (`task_type=RETRIEVAL_DOCUMENT`), upsert Postgres sur
   `(source_path, chunk_index)`, suppression des chunks des fichiers disparus
   et des chunks excédentaires en fin de document.

**Déclenchement CI** : `.github/workflows/ingest.yml` relance l'ingestion à
chaque push sur `main` touchant `frontend/content/**` ou `backend/ingest/**`
(secrets `DATABASE_URL` + `GEMINI_API_KEY`). Le `Dockerfile` ne copie
volontairement pas `ingest/` : l'ingestion ne tourne jamais dans le conteneur
déployé.

## Variables d'environnement

Copiez `.env.example` vers `.env`. Les variables :

| Variable | Requis | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | `postgresql://...` (normalisé automatiquement en `postgresql+asyncpg://`). |
| `OPENAI_API_KEY` | ✅ | Chat OpenAI (fournisseur par défaut). |
| `GEMINI_API_KEY` | ✅ | Embeddings Gemini (et chat si `LLM_PROVIDER=gemini`). |
| `LLM_PROVIDER` | — | `openai` (défaut) ou `gemini`. N'affecte que le chat, pas les embeddings. |
| `ALLOWED_ORIGINS` | — | Origines CORS, séparées par des virgules. |
| `EMBEDDING_MODEL` / `EMBEDDING_DIM` | — | Défauts : `gemini-embedding-001` / `768`. Changer la dimension implique migration + ré-ingestion complète. |
| `OPENAI_CHAT_MODEL` | — | Défaut : `gpt-6-luna`. |
| `GEMINI_CHAT_MODEL` | — | Défaut : `gemini-3.5-flash-lite` (si `LLM_PROVIDER=gemini`). |
| `TRUSTED_PROXY_HOPS` | — | Nombre de reverse proxies devant l'API qui ajoutent leur entrée à `X-Forwarded-For` (défaut `1` = App Runner seul ; `2` avec API Gateway devant ; `0` = ignorer l'en-tête). Sert à identifier l'IP appelante pour le rate limiting. **À vérifier après un déploiement.** |
| `CHAT_RATE_LIMIT_PER_MINUTE` / `_PER_HOUR` | — | Limites par IP sur `/api/chat` (défauts `8` / `60`). |
| `CHAT_GLOBAL_LIMIT_PER_HOUR` | — | Plafond toutes IP confondues sur `/api/chat` (défaut `500`) : borne le coût LLM, au prix d'un déni de service possible si quelqu'un l'épuise. |
| `SEARCH_RATE_LIMIT_PER_MINUTE` / `_PER_HOUR` | — | Limites par IP sur `/api/search` (défauts `20` / `200`). |
| `INDEX_STATUS_RATE_LIMIT_PER_MINUTE` | — | Limite par IP sur `/api/index-status` (défaut `30`). |
| `MAX_REQUEST_BODY_BYTES` | — | Taille maximale d'un corps de requête, rejeté en `413` (défaut `524288`). |
| `ENABLE_DOCS` | — | `true` pour exposer `/docs`, `/redoc` et `/openapi.json` (désactivés par défaut ; à réserver au développement local). |

### Protection contre les abus

L'API est publique (appelée depuis le navigateur), donc chaque appel à `/api/chat` ou `/api/search`
coûte des tokens LLM / embeddings :

- **Rate limiting** par IP, en mémoire (`app/rate_limit.py`), réponse `429` + `Retry-After`. Chaque
  instance applique ses propres compteurs : avec N instances App Runner, le plafond effectif est N fois plus haut.
- **Bornes d'entrée** (`app/schemas.py`, dupliquées dans `frontend/lib/chat.ts`) : message 2000
  caractères, historique 20 messages de 8000 caractères, requête de recherche 500 caractères, `top_k` ≤ 20.
- **Corps de requête plafonné** (`app/body_limit.py`) avant même la validation.
- Les erreurs du LLM ne sont **jamais** renvoyées au client (message générique, détail dans les logs).
- Des plafonds de dépense côté OpenAI / Google restent recommandés : ce sont les seuls vrais garde-fous financiers.

## Développement et tests en local

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env          # renseigner OPENAI_API_KEY et GEMINI_API_KEY

docker compose up -d postgres # PostgreSQL 16 + pgvector
alembic upgrade head          # crée/synchronise la table chunks
python -m ingest              # indexe frontend/content (≈70 docs, quelques minutes)

uvicorn app.main:app --reload --port 8080
```

Vérifications rapides :

```bash
# La base est peuplée ?
docker compose exec postgres psql -U backend -d backend \
  -c "SELECT type, language, count(*) FROM chunks GROUP BY 1,2 ORDER BY 1,2;"

# Recherche sémantique
curl -s -X POST localhost:8080/api/search \
  -H 'content-type: application/json' \
  -d '{"query":"expérience Citrix chez Geodis","language":"fr","top_k":3}'

# Chat RAG (SSE — le flag -N désactive le buffering de curl)
curl -sN -X POST localhost:8080/api/chat \
  -H 'content-type: application/json' \
  -d '{"message":"Quelle est ton expérience chez Geodis ?","language":"fr"}'
```

Tests et lint :

```bash
ruff check .
pytest          # les tests marqués "integration" (retriever) exigent Postgres démarré
```

⚠️ Les tests d'intégration font un `TRUNCATE chunks` après chaque test : lancer
`pytest` contre la base de dev **efface les données ingérées**. Relancez
`python -m ingest` ensuite si vous utilisez le chat en local.

## Déploiement

- **API** : image Docker (`Dockerfile`, uvicorn port 8080) déployée via
  `.github/workflows/deploy-backend.yml` (AWS App Runner / API Gateway).
- **Migrations** : `alembic upgrade head` à exécuter contre la base cible ;
  la migration `0002` ajoute le type `diploma` à la contrainte `ck_chunks_type`.
- **Ingestion** : uniquement via le workflow CI (voir ci-dessus), jamais dans
  le conteneur.
