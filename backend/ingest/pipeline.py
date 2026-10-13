from sqlalchemy import delete, func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Chunk
from app.providers.embedding_base import EmbeddingProvider
from ingest.chunker import chunk_markdown
from ingest.parser import ParsedDocument, parse_all


async def _upsert_document_chunks(
    session: AsyncSession, embedding_provider: EmbeddingProvider, document: ParsedDocument
) -> int:
    text_chunks = chunk_markdown(document.body)
    if not text_chunks:
        return 0

    embeddings = await embedding_provider.embed(
        [chunk.content for chunk in text_chunks], task_type="RETRIEVAL_DOCUMENT"
    )

    for index, (text_chunk, embedding) in enumerate(zip(text_chunks, embeddings, strict=True)):
        stmt = pg_insert(Chunk).values(
            type=document.type,
            title=document.title,
            slug=document.slug,
            section=text_chunk.section,
            language=document.language,
            source_path=document.source_path,
            chunk_index=index,
            content=text_chunk.content,
            tags=document.tags,
            timestamp=document.date,
            embedding=embedding,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["source_path", "chunk_index"],
            set_={
                "type": stmt.excluded.type,
                "title": stmt.excluded.title,
                "slug": stmt.excluded.slug,
                "section": stmt.excluded.section,
                "language": stmt.excluded.language,
                "content": stmt.excluded.content,
                "tags": stmt.excluded.tags,
                "timestamp": stmt.excluded.timestamp,
                "embedding": stmt.excluded.embedding,
                "updated_at": func.now(),
            },
        )
        await session.execute(stmt)

    # The document may have shrunk since the last run — drop now-stale trailing chunks.
    await session.execute(
        delete(Chunk).where(
            Chunk.source_path == document.source_path,
            Chunk.chunk_index >= len(text_chunks),
        )
    )
    return len(text_chunks)


async def run_ingestion(
    session: AsyncSession, embedding_provider: EmbeddingProvider
) -> dict[str, int]:
    documents = parse_all()
    current_source_paths = {document.source_path for document in documents}

    total_chunks = 0
    for document in documents:
        total_chunks += await _upsert_document_chunks(session, embedding_provider, document)

    # A whole source file may have been deleted from the content tree — drop its chunks too.
    if current_source_paths:
        await session.execute(delete(Chunk).where(Chunk.source_path.not_in(current_source_paths)))
    else:
        await session.execute(delete(Chunk))

    await session.commit()
    return {"documents": len(documents), "chunks": total_chunks}
