from typing import Literal, Protocol

TaskType = Literal["RETRIEVAL_DOCUMENT", "RETRIEVAL_QUERY"]


class EmbeddingProvider(Protocol):
    """Separate from LLMProvider on purpose (see llm_base.py) — keeps the door
    open for other embedding backends (OpenAI, Titan, Voyage...) without any
    of them needing to also be a chat LLM."""

    async def embed(
        self, texts: list[str], task_type: TaskType = "RETRIEVAL_DOCUMENT"
    ) -> list[list[float]]: ...
