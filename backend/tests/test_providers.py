from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.config import get_settings
from app.providers.embedding_openai import OpenAIEmbeddingProvider
from app.providers.llm_base import LLMUsage
from app.providers.llm_openai import OpenAILLMProvider
from app.schemas import ChatMessage


async def _fake_openai_stream():
    yield SimpleNamespace(type="response.output_text.delta", delta="Bon")
    yield SimpleNamespace(type="response.output_text.delta", delta="jour")
    yield SimpleNamespace(
        type="response.completed",
        response=SimpleNamespace(
            usage=SimpleNamespace(input_tokens=120, output_tokens=8)
        ),
    )


async def test_openai_stream_yields_tokens_then_usage(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-openai")
    get_settings.cache_clear()
    provider = OpenAILLMProvider()
    fake_client = MagicMock()
    fake_client.responses.create = AsyncMock(return_value=_fake_openai_stream())
    provider._client = fake_client

    items = [item async for item in provider.stream("system", [], "salut")]

    assert items[:2] == ["Bon", "jour"]
    assert items[2] == LLMUsage(model="gpt-6-luna", input_tokens=120, output_tokens=8)
    call = fake_client.responses.create.await_args.kwargs
    assert call["model"] == "gpt-6-luna"
    assert call["instructions"] == "system"
    assert call["input"] == [{"role": "user", "content": "salut"}]
    assert call["reasoning"] == {"effort": "none"}
    assert call["stream"] is True
    get_settings.cache_clear()


async def test_openai_chat_returns_full_text(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-openai")
    get_settings.cache_clear()
    provider = OpenAILLMProvider()
    fake_client = MagicMock()
    fake_client.responses.create = AsyncMock(
        return_value=SimpleNamespace(
            output_text="Bonjour",
            usage=SimpleNamespace(input_tokens=50, output_tokens=3),
        )
    )
    provider._client = fake_client

    result = await provider.chat(
        "system", [ChatMessage(role="assistant", content="Bienvenue")], "salut"
    )

    assert result == "Bonjour"
    call = fake_client.responses.create.await_args.kwargs
    assert call["input"] == [
        {"role": "assistant", "content": "Bienvenue"},
        {"role": "user", "content": "salut"},
    ]
    assert "stream" not in call
    get_settings.cache_clear()


async def test_openai_embedding_returns_vectors_in_input_order(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-openai")
    get_settings.cache_clear()
    provider = OpenAIEmbeddingProvider()
    fake_response = SimpleNamespace(
        data=[
            SimpleNamespace(index=1, embedding=[0.3, 0.4]),
            SimpleNamespace(index=0, embedding=[0.1, 0.2]),
        ],
        usage=SimpleNamespace(prompt_tokens=4),
    )
    fake_client = MagicMock()
    fake_client.embeddings.create = AsyncMock(return_value=fake_response)
    provider._client = fake_client

    vectors = await provider.embed(["a", "b"])

    assert vectors == [[0.1, 0.2], [0.3, 0.4]]
    call = fake_client.embeddings.create.await_args.kwargs
    assert call["model"] == "text-embedding-3-small"
    assert call["input"] == ["a", "b"]
    assert call["dimensions"] == 768
    get_settings.cache_clear()


async def test_openai_embedding_empty_input_short_circuits(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-openai")
    get_settings.cache_clear()
    provider = OpenAIEmbeddingProvider()
    provider._client = MagicMock()  # would error if actually called

    assert await provider.embed([]) == []
    get_settings.cache_clear()
