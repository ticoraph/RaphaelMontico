from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from app.db.models import Chunk
from app.db.retriever import ScoredChunk
from app.deps import get_embedding_provider_dep, get_session
from app.main import app


class _FakeEmbeddingProvider:
    async def embed(
        self, texts: list[str], task_type: str = "RETRIEVAL_QUERY"
    ) -> list[list[float]]:
        return [[0.1] * 768 for _ in texts]


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
        tags=["Next.js", "AWS"],
        timestamp=None,
        embedding=[0.1] * 768,
    )

    async def fake_similarity_search(session, query_embedding, top_k=5, type=None, language=None):
        return [ScoredChunk(chunk=fake_chunk, score=0.87)]

    monkeypatch.setattr("app.routers.search.similarity_search", fake_similarity_search)
    app.dependency_overrides[get_embedding_provider_dep] = lambda: _FakeEmbeddingProvider()
    app.dependency_overrides[get_session] = lambda: None

    yield

    app.dependency_overrides.clear()


async def test_search_returns_results_with_scores():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/api/search", json={"query": "Next.js"})

    assert response.status_code == 200
    body = response.json()
    assert len(body["results"]) == 1
    result = body["results"][0]
    assert result["title"] == "Example Project"
    assert result["score"] == pytest.approx(0.87)
    assert result["tags"] == ["Next.js", "AWS"]
