import json
import logging
from collections.abc import AsyncIterator
from time import perf_counter

import opentelemetry.context as otel_context
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from langfuse import get_client, observe
from starlette.background import BackgroundTask

from app.config import get_settings
from app.db.retriever import similarity_search
from app.deps import EmbeddingProviderDep, LLMProviderFactoryDep, SessionDep
from app.providers.llm_base import LLMUsage
from app.rag.prompt import build_system_prompt, to_source_items
from app.rate_limit import limit_chat
from app.schemas import ChatMetrics, ChatRequest

router = APIRouter(prefix="/api", tags=["chat"])
logger = logging.getLogger(__name__)

_TOP_K = 5
# Sent to the client when generation fails: provider/exception details stay in the logs.
_GENERIC_ERROR = {
    "fr": "Une erreur est survenue pendant la génération de la réponse.",
    "en": "An error occurred while generating the answer.",
}


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.post("/chat", dependencies=[Depends(limit_chat)])
@observe(name="chat_api")
async def chat(
    request: ChatRequest,
    session: SessionDep,
    embedding_provider: EmbeddingProviderDep,
    llm_provider_factory: LLMProviderFactoryDep,
) -> StreamingResponse:
    get_client().update_current_span(input=request.message)
    # Embedding + retrieval happen before the stream starts: if they fail, FastAPI
    # returns a normal JSON error response. Once streaming starts, headers are
    # already sent, so LLM failures are instead surfaced as an `error` SSE event.
    retrieval_start = perf_counter()
    [query_embedding] = await embedding_provider.embed(
        [request.message], task_type="RETRIEVAL_QUERY"
    )
    scored_chunks = await similarity_search(
        session, query_embedding, top_k=_TOP_K, language=request.language
    )
    retrieval_ms = round((perf_counter() - retrieval_start) * 1000)
    system_prompt = build_system_prompt(scored_chunks)
    sources = to_source_items(scored_chunks)
    selected_model = get_settings().llm_provider
    llm = llm_provider_factory(selected_model)
    current_context = otel_context.get_current()

    async def event_stream() -> AsyncIterator[str]:
        token = otel_context.attach(current_context)
        try:
            yield _sse("sources", {"sources": [s.model_dump(mode="json") for s in sources]})
            usage: LLMUsage | None = None
            generation_start = perf_counter()
            try:
                async for item in llm.stream(system_prompt, request.history, request.message):
                    if isinstance(item, LLMUsage):
                        usage = item
                    else:
                        yield _sse("token", {"text": item})
            except Exception:
                logger.exception("LLM streaming failed (provider=%s)", selected_model)
                yield _sse("error", {"message": _GENERIC_ERROR[request.language or "fr"]})
                return
        finally:
            otel_context.detach(token)
            
        metrics = ChatMetrics(
            model=usage.model if usage else None,
            input_tokens=usage.input_tokens if usage else None,
            output_tokens=usage.output_tokens if usage else None,
            retrieval_ms=retrieval_ms,
            generation_ms=round((perf_counter() - generation_start) * 1000),
        )
        get_client().update_current_span(
            metadata={"metrics": metrics.model_dump(), "model": selected_model}
        )
        yield _sse("done", {"finish_reason": "stop", "metrics": metrics.model_dump()})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        background=BackgroundTask(get_client().flush),
        headers={"Cache-Control": "no-cache"}
    )
