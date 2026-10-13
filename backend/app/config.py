import os
from functools import lru_cache
from typing import Annotated, Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str
    gemini_api_key: str
    openai_api_key: str = ""

    # Fournisseur de génération uniquement. Les embeddings restent sur Gemini.
    llm_provider: Literal["gemini", "openai"] = "openai"

    langfuse_secret_key: str = ""
    langfuse_public_key: str = ""
    langfuse_base_url: str = "https://cloud.langfuse.com"

    # NoDecode: pydantic-settings would otherwise try to JSON-decode a list-typed
    # env var, which breaks the plain comma-separated form set in .env/App Runner.
    allowed_origins: Annotated[list[str], NoDecode] = []

    embedding_model: str = "gemini-embedding-001"
    embedding_dim: int = 768

    gemini_chat_model: str = "gemini-3.5-flash-lite"
    openai_chat_model: str = "gpt-6-luna"

    log_level: str = "INFO"

    # Public API hardening. Rate limits are per client IP (in-memory, per instance);
    # the global chat cap bounds LLM spend however many IPs a caller rotates through.
    chat_rate_limit_per_minute: int = 8
    chat_rate_limit_per_hour: int = 60
    chat_global_limit_per_hour: int = 500
    search_rate_limit_per_minute: int = 20
    search_rate_limit_per_hour: int = 200
    index_status_rate_limit_per_minute: int = 30
    # How many reverse proxies sit in front of the API and append to X-Forwarded-For
    # (App Runner alone = 1; API Gateway in front of it = 2; direct exposure = 0).
    trusted_proxy_hops: int = 1
    max_request_body_bytes: int = 512 * 1024
    # Swagger UI / ReDoc / openapi.json: off unless explicitly enabled (local dev).
    enable_docs: bool = False

    # extra="ignore": a stale .env (e.g. the removed CONTACT_* keys) must not crash startup.
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("database_url")
    @classmethod
    def _use_asyncpg_driver(cls, value: str) -> str:
        # Accept the conventional "postgresql://" / "postgres://" form (AWS, Heroku-style)
        # and normalize it to the asyncpg driver SQLAlchemy's async engine requires.
        if value.startswith("postgres://"):
            return "postgresql+asyncpg://" + value[len("postgres://") :]
        if value.startswith("postgresql://"):
            return "postgresql+asyncpg://" + value[len("postgresql://") :]
        return value


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if settings.langfuse_public_key:
        os.environ["LANGFUSE_PUBLIC_KEY"] = settings.langfuse_public_key
    if settings.langfuse_secret_key:
        os.environ["LANGFUSE_SECRET_KEY"] = settings.langfuse_secret_key
    if settings.langfuse_base_url:
        os.environ["LANGFUSE_BASE_URL"] = settings.langfuse_base_url
    return settings
