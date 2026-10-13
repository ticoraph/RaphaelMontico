from langfuse import get_client, observe
from openai import AsyncOpenAI

from app.config import get_settings
from app.providers.embedding_base import TaskType


class OpenAIEmbeddingProvider:
    def __init__(self) -> None:
        settings = get_settings()
        if not settings.openai_api_key:
            raise ValueError("OPENAI_API_KEY is required for embeddings")
        self._client = AsyncOpenAI(api_key=settings.openai_api_key)
        self._model = settings.embedding_model
        self._dim = settings.embedding_dim

    @observe(as_type="generation")
    async def embed(
        self, texts: list[str], task_type: TaskType = "RETRIEVAL_DOCUMENT"
    ) -> list[list[float]]:
        # task_type is ignored: OpenAI embeddings are symmetric (no query/document mode).
        get_client().update_current_generation(model=self._model, input=texts)
        if not texts:
            return []
        response = await self._client.embeddings.create(
            model=self._model, input=texts, dimensions=self._dim
        )
        usage = response.usage
        if usage is not None:
            get_client().update_current_generation(usage_details={"input": usage.prompt_tokens})
        return [item.embedding for item in sorted(response.data, key=lambda item: item.index)]
