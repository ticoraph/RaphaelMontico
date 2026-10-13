"""Abuse protection of the public API: rate limits, input bounds, body cap, docs off."""

import pytest
from httpx import ASGITransport, AsyncClient

from app import rate_limit
from app.config import Settings
from app.db.models import Chunk
from app.db.retriever import ScoredChunk
from app.deps import get_embedding_provider_dep, get_llm_provider_factory, get_session
from app.main import app
from app.schemas import (
    MAX_HISTORY_CONTENT_CHARS,
    MAX_HISTORY_MESSAGES,
    MAX_MESSAGE_CHARS,
    MAX_QUERY_CHARS,
    MAX_TOP_K,
)


class _FakeEmbeddingProvider:
    async def embed(self, texts, task_type="RETRIEVAL_QUERY"):
        return [[0.1] * 768 for _ in texts]


class _FakeLLMProvider:
    async def stream(self, system_prompt, history, user_message):
        yield "ok"


@pytest.fixture(autouse=True)
def _override_deps(monkeypatch):
    chunk = Chunk(
        id="00000000-0000-0000-0000-000000000001",
        type="project",
        title="T",
        slug="t",
        section=None,
        language="en",
        source_path="content/en/projects/t.mdx",
        chunk_index=0,
        content="c",
        tags=[],
        timestamp=None,
        embedding=[0.1] * 768,
    )

    async def fake_search(session, query_embedding, **kwargs):
        return [ScoredChunk(chunk=chunk, score=0.9)]

    monkeypatch.setattr("app.routers.chat.similarity_search", fake_search)
    monkeypatch.setattr("app.routers.search.similarity_search", fake_search)
    app.dependency_overrides[get_embedding_provider_dep] = lambda: _FakeEmbeddingProvider()
    app.dependency_overrides[get_session] = lambda: None
    app.dependency_overrides[get_llm_provider_factory] = lambda: lambda model: _FakeLLMProvider()
    yield
    app.dependency_overrides.clear()


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _limits(monkeypatch, **overrides):
    """Settings used by the limiter, with overrides (the real ones need no env here)."""
    base = {
        "chat_rate_limit_per_minute": 8,
        "chat_rate_limit_per_hour": 60,
        "chat_global_limit_per_hour": 500,
        "search_rate_limit_per_minute": 20,
        "search_rate_limit_per_hour": 200,
        "index_status_rate_limit_per_minute": 30,
        "trusted_proxy_hops": 1,
    }
    base.update(overrides)
    settings = Settings.model_construct(**base)
    monkeypatch.setattr(rate_limit, "get_settings", lambda: settings)


# --- rate limiting -------------------------------------------------------------------


async def test_chat_is_limited_per_minute_with_retry_after(client, monkeypatch):
    _limits(monkeypatch, chat_rate_limit_per_minute=3)
    for _ in range(3):
        assert (await client.post("/api/chat", json={"message": "hi"})).status_code == 200

    blocked = await client.post("/api/chat", json={"message": "hi"})

    assert blocked.status_code == 429
    assert 1 <= int(blocked.headers["retry-after"]) <= 60


async def test_search_is_limited_per_minute(client, monkeypatch):
    _limits(monkeypatch, search_rate_limit_per_minute=2)
    for _ in range(2):
        assert (await client.post("/api/search", json={"query": "rag"})).status_code == 200

    assert (await client.post("/api/search", json={"query": "rag"})).status_code == 429


async def test_limits_are_tracked_per_ip(client, monkeypatch):
    _limits(monkeypatch, chat_rate_limit_per_minute=1)
    first = {"x-forwarded-for": "203.0.113.1"}
    other = {"x-forwarded-for": "203.0.113.2"}

    assert (await client.post("/api/chat", json={"message": "a"}, headers=first)).status_code == 200
    assert (await client.post("/api/chat", json={"message": "a"}, headers=first)).status_code == 429
    assert (await client.post("/api/chat", json={"message": "a"}, headers=other)).status_code == 200


async def test_spoofed_leading_forwarded_for_entries_do_not_dodge_the_limit(client, monkeypatch):
    # One trusted proxy appends the real IP on the right; a client can only forge the left.
    _limits(monkeypatch, chat_rate_limit_per_minute=1)

    def headers(forged):
        return {"x-forwarded-for": f"{forged}, 198.51.100.9"}

    assert (
        await client.post("/api/chat", json={"message": "a"}, headers=headers("1.1.1.1"))
    ).status_code == 200
    assert (
        await client.post("/api/chat", json={"message": "a"}, headers=headers("2.2.2.2"))
    ).status_code == 429


async def test_global_chat_cap_applies_across_ips(client, monkeypatch):
    _limits(monkeypatch, chat_global_limit_per_hour=2)

    for i in range(2):
        resp = await client.post(
            "/api/chat", json={"message": "a"}, headers={"x-forwarded-for": f"203.0.113.{i}"}
        )
        assert resp.status_code == 200

    resp = await client.post(
        "/api/chat", json={"message": "a"}, headers={"x-forwarded-for": "203.0.113.99"}
    )
    assert resp.status_code == 429


async def test_zero_trusted_hops_ignores_forwarded_for(client, monkeypatch):
    _limits(monkeypatch, chat_rate_limit_per_minute=1, trusted_proxy_hops=0)

    assert (
        await client.post(
            "/api/chat", json={"message": "a"}, headers={"x-forwarded-for": "1.1.1.1"}
        )
    ).status_code == 200
    assert (
        await client.post(
            "/api/chat", json={"message": "a"}, headers={"x-forwarded-for": "2.2.2.2"}
        )
    ).status_code == 429


def test_window_slides_so_old_requests_stop_counting():
    windows = [(2, 60)]
    assert rate_limit._hit("k", windows, now=0.0) is None
    assert rate_limit._hit("k", windows, now=10.0) is None
    assert rate_limit._hit("k", windows, now=20.0) == 40  # must wait for the first hit to expire
    assert rate_limit._hit("k", windows, now=61.0) is None


def test_purge_drops_idle_keys_only():
    rate_limit._hit("idle", [(5, 60)], now=0.0)
    rate_limit._hit("active", [(5, 60)], now=5000.0)

    rate_limit._purge(now=5001.0)

    assert "idle" not in rate_limit._hits
    assert "active" in rate_limit._hits


# --- input bounds --------------------------------------------------------------------


@pytest.mark.parametrize(
    "payload",
    [
        {"message": ""},
        {"message": "   "},
        {"message": "x" * (MAX_MESSAGE_CHARS + 1)},
        {
            "message": "hi",
            "history": [{"role": "user", "content": "x"}] * (MAX_HISTORY_MESSAGES + 1),
        },
        {
            "message": "hi",
            "history": [{"role": "user", "content": "x" * (MAX_HISTORY_CONTENT_CHARS + 1)}],
        },
    ],
)
async def test_chat_rejects_oversized_or_empty_input(client, payload):
    assert (await client.post("/api/chat", json=payload)).status_code == 422


async def test_chat_accepts_input_at_the_limits(client):
    payload = {
        "message": "x" * MAX_MESSAGE_CHARS,
        "history": [{"role": "assistant", "content": "y" * MAX_HISTORY_CONTENT_CHARS}]
        * MAX_HISTORY_MESSAGES,
    }
    assert (await client.post("/api/chat", json=payload)).status_code == 200


@pytest.mark.parametrize(
    "payload",
    [
        {"query": ""},
        {"query": "x" * (MAX_QUERY_CHARS + 1)},
        {"query": "rag", "top_k": 0},
        {"query": "rag", "top_k": MAX_TOP_K + 1},
        {"query": "rag", "top_k": -3},
    ],
)
async def test_search_rejects_out_of_bounds_input(client, payload):
    assert (await client.post("/api/search", json=payload)).status_code == 422


async def test_search_accepts_max_top_k(client):
    resp = await client.post("/api/search", json={"query": "rag", "top_k": MAX_TOP_K})
    assert resp.status_code == 200


# --- body size cap -------------------------------------------------------------------


async def test_oversized_body_is_rejected_with_413_before_validation(client):
    huge = {"message": "x" * (600 * 1024)}  # > MAX_REQUEST_BODY_BYTES (512 KiB)
    resp = await client.post("/api/chat", json=huge)
    assert resp.status_code == 413


async def test_oversized_chunked_body_without_content_length_is_rejected(client):
    async def body():
        for _ in range(10):
            yield b"x" * (100 * 1024)

    resp = await client.post(
        "/api/chat", content=body(), headers={"content-type": "application/json"}
    )
    assert resp.status_code == 413


# --- docs ----------------------------------------------------------------------------


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
async def test_interactive_docs_and_schema_are_disabled_by_default(client, path):
    assert (await client.get(path)).status_code == 404
