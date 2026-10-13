from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Protocol

from app.schemas import ChatMessage


@dataclass
class LLMUsage:
    """Token accounting for one completed generation, yielded as the final item
    of stream() when the backend reports it."""

    model: str
    input_tokens: int | None = None
    output_tokens: int | None = None


class LLMProvider(Protocol):
    """Chat-capable LLM backend. Embeddings are deliberately not part of this
    interface, since not every LLM backend exposes an embeddings API — forcing
    an embed() method here would be artificial. See EmbeddingProvider instead."""

    async def stream(
        self, system_prompt: str, history: list[ChatMessage], user_message: str
    ) -> AsyncIterator[str | LLMUsage]: ...

    async def chat(
        self, system_prompt: str, history: list[ChatMessage], user_message: str
    ) -> str: ...
