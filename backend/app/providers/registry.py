from functools import lru_cache

from app.providers.embedding_base import EmbeddingProvider
from app.providers.embedding_gemini import GeminiEmbeddingProvider
from app.providers.llm_base import LLMProvider
from app.providers.llm_gemini import GeminiLLMProvider
from app.providers.llm_openai import OpenAILLMProvider
from app.schemas import ModelName


@lru_cache
def get_llm_provider(name: ModelName) -> LLMProvider:
    if name == "gemini":
        return GeminiLLMProvider()
    if name == "openai":
        return OpenAILLMProvider()
    raise ValueError(f"Unknown LLM provider: {name}")


@lru_cache
def get_embedding_provider() -> EmbeddingProvider:
    return GeminiEmbeddingProvider()
