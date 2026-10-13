from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints

ChunkType = Literal["blog_post", "project", "experience", "diploma", "page_section"]
Language = Literal["en", "fr"]
ModelName = Literal["openai"]

# Input bounds for the public endpoints (mirrored in frontend/lib/chat.ts).
MAX_MESSAGE_CHARS = 2000
MAX_HISTORY_MESSAGES = 20
MAX_HISTORY_CONTENT_CHARS = 8000
MAX_QUERY_CHARS = 500
MAX_TOP_K = 20

UserText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=MAX_HISTORY_CONTENT_CHARS)


class ChatRequest(BaseModel):
    message: UserText = Field(max_length=MAX_MESSAGE_CHARS)
    history: list[ChatMessage] = Field(default_factory=list, max_length=MAX_HISTORY_MESSAGES)
    # No `model` field: the provider is chosen by the server (LLM_PROVIDER) only, so a
    # caller can't pick the more expensive one. A `model` sent by a client is ignored.
    language: Language | None = None


class SourceItem(BaseModel):
    id: UUID
    type: ChunkType
    title: str
    slug: str
    section: str | None = None
    # e.g. "content/en/proxp/geodis.mdx" — lets the frontend derive the page URL
    # (the chunk type alone is ambiguous: "experience" covers both proxp and perxp).
    source_path: str
    # Cosine similarity between the question and this chunk, in [0, 1].
    score: float


class ChatMetrics(BaseModel):
    """Sent in the `done` SSE event of /api/chat. Token counts are None when the
    LLM backend didn't report usage."""

    model: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    retrieval_ms: int
    generation_ms: int


class SearchRequest(BaseModel):
    query: UserText = Field(max_length=MAX_QUERY_CHARS)
    top_k: int = Field(default=5, ge=1, le=MAX_TOP_K)
    type: ChunkType | None = None
    language: Language | None = None


class SearchResultItem(BaseModel):
    id: UUID
    type: ChunkType
    title: str
    slug: str
    section: str | None = None
    language: Language
    tags: list[str]
    timestamp: datetime | None = None
    content: str
    score: float


class SearchResponse(BaseModel):
    results: list[SearchResultItem]


class IndexStatusResponse(BaseModel):
    # None when the chunks table is empty (nothing ingested yet).
    last_updated: datetime | None
