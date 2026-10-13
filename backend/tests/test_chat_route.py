import json
from collections.abc import AsyncIterator
from types import SimpleNamespace
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from app.db.models import Chunk
from app.db.retriever import ScoredChunk
from app.deps import get_embedding_provider_dep, get_llm_provider_factory, get_session
from app.main import app
from app.providers.llm_base import LLMUsage
from app.schemas import ChatMessage


class _FakeEmbeddingProvider:
    async def embed(
        self, texts: list[str], task_type: str = "RETRIEVAL_QUERY"
    ) -> list[list[float]]:
        return [[0.1] * 768 for _ in texts]


class _FakeLLMProvider:
    async def stream(
        self, system_prompt: str, history: list[ChatMessage], user_message: str
    ) -> AsyncIterator[str | LLMUsage]:
        for token in ["Bon", "jour"]:
            yield token
        yield LLMUsage(model="fake-model", input_tokens=100, output_tokens=7)

    async def chat(self, system_prompt: str, history: list[ChatMessage], user_message: str) -> str:
        return "Bonjour"


def _parse_sse(raw: str) -> list[tuple[str, dict]]:
    events = []
    for block in raw.strip().split("\n\n"):
        lines = block.splitlines()
        event = next(line.removeprefix("event: ") for line in lines if line.startswith("event: "))
        data = next(line.removeprefix("data: ") for line in lines if line.startswith("data: "))
        events.append((event, json.loads(data)))
    return events


@pytest.fixture(autouse=True)
def _override_deps(monkeypatch):
    fake_chunk = Chunk(
        id=uuid4(),
        type="project",
        title="Example Project",
        slug="example-project",
        section=None,
        language="en",
        source_path="content/en/projects/example-project.mdx",
        chunk_index=0,
        content="Built with Next.js and AWS.",
        tags=[],
        timestamp=None,
        embedding=[0.1] * 768,
    )

    async def fake_similarity_search(session, query_embedding, top_k=5, language=None, type=None):
        return [ScoredChunk(chunk=fake_chunk, score=0.9)]

    monkeypatch.setattr("app.routers.chat.similarity_search", fake_similarity_search)
    app.dependency_overrides[get_embedding_provider_dep] = lambda: _FakeEmbeddingProvider()
    app.dependency_overrides[get_session] = lambda: None
    app.dependency_overrides[get_llm_provider_factory] = lambda: lambda model: _FakeLLMProvider()

    yield

    app.dependency_overrides.clear()


async def test_chat_streams_sources_then_tokens_then_done():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        async with client.stream(
            "POST", "/api/chat", json={"message": "Salut"}
        ) as response:
            assert response.status_code == 200
            assert response.headers["content-type"].startswith("text/event-stream")
            body = "".join([chunk async for chunk in response.aiter_text()])

    events = _parse_sse(body)
    assert [name for name, _ in events] == ["sources", "token", "token", "done"]
    source = events[0][1]["sources"][0]
    assert source["title"] == "Example Project"
    assert source["score"] == 0.9
    assert events[1][1]["text"] == "Bon"
    assert events[2][1]["text"] == "jour"
    assert events[3][1]["finish_reason"] == "stop"
    metrics = events[3][1]["metrics"]
    assert metrics["model"] == "fake-model"
    assert metrics["input_tokens"] == 100
    assert metrics["output_tokens"] == 7
    assert metrics["retrieval_ms"] >= 0
    assert metrics["generation_ms"] >= 0


async def test_chat_uses_the_provider_from_environment(monkeypatch):
    selected_models = []
    app.dependency_overrides[get_llm_provider_factory] = lambda: (
        lambda model: selected_models.append(model) or _FakeLLMProvider()
    )
    monkeypatch.setattr(
        "app.routers.chat.get_settings",
        lambda: SimpleNamespace(llm_provider="openai"),
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/api/chat", json={"message": "Salut"})

    assert response.status_code == 200
    assert selected_models == ["openai"]


async def test_chat_emits_error_event_when_llm_fails_mid_stream():
    class _FailingLLMProvider:
        async def stream(self, system_prompt, history, user_message):
            yield "partial"
            raise RuntimeError("upstream LLM error")

    app.dependency_overrides[get_llm_provider_factory] = lambda: lambda model: _FailingLLMProvider()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        async with client.stream("POST", "/api/chat", json={"message": "Salut"}) as response:
            body = "".join([chunk async for chunk in response.aiter_text()])

    events = _parse_sse(body)
    assert [name for name, _ in events] == ["sources", "token", "error"]
    # Provider/exception details must stay server-side.
    assert "upstream LLM error" not in body
    assert "RuntimeError" not in body
    assert events[2][1]["message"] == "Une erreur est survenue pendant la génération de la réponse."


async def test_chat_error_event_follows_the_request_language():
    class _FailingLLMProvider:
        async def stream(self, system_prompt, history, user_message):
            raise RuntimeError("secret provider detail")
            yield  # pragma: no cover  (makes this an async generator)

    app.dependency_overrides[get_llm_provider_factory] = lambda: lambda model: _FailingLLMProvider()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        async with client.stream(
            "POST", "/api/chat", json={"message": "Hi", "language": "en"}
        ) as response:
            body = "".join([chunk async for chunk in response.aiter_text()])

    events = _parse_sse(body)
    assert events[-1] == ("error", {"message": "An error occurred while generating the answer."})
    assert "secret provider detail" not in body


async def test_chat_raises_before_streaming_when_embedding_fails():
    # Failures before the stream starts must not be swallowed into a malformed
    # SSE event: they propagate as a normal exception (a real deployment turns
    # this into a plain 500 via Starlette's error middleware; httpx's test
    # transport re-raises instead of converting it, which is what we assert here).
    class _FailingEmbeddingProvider:
        async def embed(self, texts, task_type="RETRIEVAL_QUERY"):
            raise RuntimeError("embedding boom")

    app.dependency_overrides[get_embedding_provider_dep] = lambda: _FailingEmbeddingProvider()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        with pytest.raises(RuntimeError, match="embedding boom"):
            await client.post("/api/chat", json={"message": "Salut"})


async def test_chat_ignores_a_model_chosen_by_the_client(monkeypatch):
    selected_models = []
    app.dependency_overrides[get_llm_provider_factory] = lambda: (
        lambda model: selected_models.append(model) or _FakeLLMProvider()
    )
    monkeypatch.setattr(
        "app.routers.chat.get_settings",
        lambda: SimpleNamespace(llm_provider="openai"),
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        for requested in ("gemini", "openai", "something-else"):
            response = await client.post("/api/chat", json={"message": "Salut", "model": requested})
            assert response.status_code == 200

    assert selected_models == ["openai", "openai", "openai"]
