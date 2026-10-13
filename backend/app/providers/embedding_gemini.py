from google import genai
from google.genai import types
from langfuse import get_client, observe

from app.config import get_settings
from app.providers.embedding_base import TaskType


class GeminiEmbeddingProvider:
    def __init__(self) -> None:
        settings = get_settings()
        self._client = genai.Client(api_key=settings.gemini_api_key)
        self._model = settings.embedding_model
        self._dim = settings.embedding_dim

    @observe(as_type="generation")
    async def embed(
        self, texts: list[str], task_type: TaskType = "RETRIEVAL_DOCUMENT"
    ) -> list[list[float]]:
        get_client().update_current_generation(model=self._model, input=texts)
        if not texts:
            return []
        response = await self._client.aio.models.embed_content(
            model=self._model,
            contents=texts,
            config=types.EmbedContentConfig(output_dimensionality=self._dim, task_type=task_type),
        )
        return [embedding.values for embedding in response.embeddings]
