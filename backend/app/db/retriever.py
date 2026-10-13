from dataclasses import dataclass
from datetime import datetime

from langfuse import observe
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Chunk
from app.schemas import ChunkType, Language


@dataclass
class ScoredChunk:
    chunk: Chunk
    score: float


@observe(as_type="span")
async def similarity_search(
    session: AsyncSession,
    query_embedding: list[float],
    top_k: int = 5,
    type: ChunkType | None = None,
    language: Language | None = None,
) -> list[ScoredChunk]:
    """Return the top_k chunks closest to query_embedding, most similar first."""
    distance = Chunk.embedding.cosine_distance(query_embedding)
    stmt = select(Chunk, distance.label("distance")).order_by(distance).limit(top_k)

    if type is not None:
        stmt = stmt.where(Chunk.type == type)
    if language is not None:
        stmt = stmt.where(Chunk.language == language)

    result = await session.execute(stmt)
    # pgvector's cosine distance is 1 - cosine_similarity, so similarity = 1 - distance.
    return [ScoredChunk(chunk=chunk, score=1.0 - distance) for chunk, distance in result.all()]


async def get_last_updated(session: AsyncSession) -> datetime | None:
    """Most recent `updated_at` across all chunks, i.e. when the vector DB was
    last (re)ingested. None when the chunks table is empty."""
    result = await session.execute(select(func.max(Chunk.updated_at)))
    return result.scalar_one_or_none()
