from collections.abc import AsyncIterator, Callable
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import session_scope
from app.providers.embedding_base import EmbeddingProvider
from app.providers.llm_base import LLMProvider
from app.providers.registry import get_embedding_provider, get_llm_provider
from app.schemas import ModelName


async def get_session() -> AsyncIterator[AsyncSession]:
    async with session_scope() as session:
        yield session


def get_embedding_provider_dep() -> EmbeddingProvider:
    return get_embedding_provider()


def get_llm_provider_factory() -> Callable[[ModelName], LLMProvider]:
    """Returns a factory rather than a provider instance directly, since the
    chat route only knows which model to use once it has parsed the request
    body. Tests override this dependency with a fake factory."""
    return get_llm_provider


SessionDep = Annotated[AsyncSession, Depends(get_session)]
EmbeddingProviderDep = Annotated[EmbeddingProvider, Depends(get_embedding_provider_dep)]
LLMProviderFactoryDep = Annotated[
    Callable[[ModelName], LLMProvider], Depends(get_llm_provider_factory)
]
