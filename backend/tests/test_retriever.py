import pytest

from app.db.models import Chunk
from app.db.retriever import similarity_search

pytestmark = pytest.mark.integration


def _unit_vector(index: int, dim: int = 768) -> list[float]:
    vector = [0.0] * dim
    vector[index] = 1.0
    return vector


def _make_chunk(source_path: str, embedding: list[float], **overrides: object) -> Chunk:
    defaults: dict[str, object] = dict(
        type="project",
        title="Title",
        slug="slug",
        section=None,
        language="en",
        source_path=source_path,
        chunk_index=0,
        content="content",
        tags=[],
        timestamp=None,
    )
    defaults.update(overrides)
    return Chunk(embedding=embedding, **defaults)


async def test_similarity_search_orders_most_similar_first(db_session):
    db_session.add_all(
        [
            _make_chunk("a.mdx", _unit_vector(0)),
            _make_chunk("b.mdx", _unit_vector(1)),
        ]
    )
    await db_session.commit()

    results = await similarity_search(db_session, _unit_vector(0), top_k=2)

    assert [r.chunk.source_path for r in results] == ["a.mdx", "b.mdx"]
    assert results[0].score > results[1].score
    assert results[0].score == pytest.approx(1.0)


async def test_similarity_search_filters_by_type_and_language(db_session):
    db_session.add_all(
        [
            _make_chunk("a.mdx", _unit_vector(0), type="project", language="en"),
            _make_chunk("b.mdx", _unit_vector(0), type="blog_post", language="en"),
            _make_chunk("c.mdx", _unit_vector(0), type="project", language="fr"),
        ]
    )
    await db_session.commit()

    results = await similarity_search(
        db_session, _unit_vector(0), top_k=10, type="project", language="en"
    )

    assert [r.chunk.source_path for r in results] == ["a.mdx"]


async def test_similarity_search_respects_top_k(db_session):
    db_session.add_all([_make_chunk(f"{i}.mdx", _unit_vector(0)) for i in range(5)])
    await db_session.commit()

    results = await similarity_search(db_session, _unit_vector(0), top_k=3)

    assert len(results) == 3
