from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from langfuse import get_client

from app.body_limit import BodySizeLimitMiddleware
from app.config import get_settings
from app.db.base import dispose_engine
from app.routers import chat, health, index_status, search


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize Langfuse env vars early
    get_settings()
    get_client().auth_check()
    yield
    await dispose_engine()
    get_client().flush()


settings = get_settings()
app = FastAPI(
    title="raphael-montico-api",
    lifespan=lifespan,
    # The interactive docs and the schema describe every route to anyone who asks:
    # keep them off in production (ENABLE_DOCS=true for local development).
    docs_url="/docs" if settings.enable_docs else None,
    redoc_url="/redoc" if settings.enable_docs else None,
    openapi_url="/openapi.json" if settings.enable_docs else None,
)

app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_request_body_bytes)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(chat.router)
app.include_router(search.router)
app.include_router(index_status.router)
