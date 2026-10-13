from fastapi import APIRouter, Depends

from app.db.retriever import similarity_search
from app.deps import EmbeddingProviderDep, SessionDep
from app.rate_limit import limit_search
from app.schemas import SearchRequest, SearchResponse, SearchResultItem

router = APIRouter(prefix="/api", tags=["search"])


@router.post("/search", response_model=SearchResponse, dependencies=[Depends(limit_search)])
async def search(
    request: SearchRequest,
    session: SessionDep,
    embedding_provider: EmbeddingProviderDep,
) -> SearchResponse:
    [query_embedding] = await embedding_provider.embed([request.query], task_type="RETRIEVAL_QUERY")
    scored_chunks = await similarity_search(
        session,
        query_embedding,
        top_k=request.top_k,
        type=request.type,
        language=request.language,
    )
    return SearchResponse(
        results=[
            SearchResultItem(
                id=scored.chunk.id,
                type=scored.chunk.type,
                title=scored.chunk.title,
                slug=scored.chunk.slug,
                section=scored.chunk.section,
                language=scored.chunk.language,
                tags=scored.chunk.tags,
                timestamp=scored.chunk.timestamp,
                content=scored.chunk.content,
                score=scored.score,
            )
            for scored in scored_chunks
        ]
    )
