from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.config import get_settings
from app.providers.embedding_gemini import GeminiEmbeddingProvider
from app.providers.llm_base import LLMUsage
from app.providers.llm_gemini import GeminiLLMProvider
from app.providers.llm_openai import OpenAILLMProvider
from app.schemas import ChatMessage


async def _fake_gemini_stream(texts):
    for index, text in enumerate(texts):
        is_last = index == len(texts) - 1
        usage = (
            MagicMock(prompt_token_count=100, candidates_token_count=7) if is_last else None
        )
        yield MagicMock(text=text, usage_metadata=usage)


async def _fake_openai_stream():
    yield SimpleNamespace(type="response.output_text.delta", delta="Bon")
    yield SimpleNamespace(type="response.output_text.delta", delta="jour")
    yield SimpleNamespace(
        type="response.completed",
        response=SimpleNamespace(
            usage=SimpleNamespace(input_tokens=120, output_tokens=8)
        ),
    )


async def test_gemini_stream_yields_tokens_then_usage():
    provider = GeminiLLMProvider()
    fake_client = MagicMock()
    fake_client.aio.models.generate_content_stream = AsyncMock(
        return_value=_fake_gemini_stream(["Bon", "jour"])
    )
    provider._client = fake_client

    items = [item async for item in provider.stream("system", [], "salut")]

    assert items[:2] == ["Bon", "jour"]
    assert items[2] == LLMUsage(model=provider._model, input_tokens=100, output_tokens=7)


async def test_gemini_build_contents_maps_assistant_role_to_model():
    provider = GeminiLLMProvider()
    history = [
        ChatMessage(role="user", content="hi"),
        ChatMessage(role="assistant", content="hello"),
    ]

    contents = provider._build_contents(history, "how are you")

    assert [content.role for content in contents] == ["user", "model", "user"]
    assert contents[-1].parts[0].text == "how are you"


async def test_gemini_chat_returns_full_text():
    provider = GeminiLLMProvider()
    fake_client = MagicMock()
    fake_client.aio.models.generate_content = AsyncMock(return_value=MagicMock(text="Bonjour"))
    provider._client = fake_client

    result = await provider.chat("system", [], "salut")

    assert result == "Bonjour"


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


async def test_gemini_embedding_returns_one_vector_per_text():
    provider = GeminiEmbeddingProvider()
    fake_response = MagicMock(
        embeddings=[MagicMock(values=[0.1, 0.2]), MagicMock(values=[0.3, 0.4])]
    )
    fake_client = MagicMock()
    fake_client.aio.models.embed_content = AsyncMock(return_value=fake_response)
    provider._client = fake_client

    vectors = await provider.embed(["a", "b"])

    assert vectors == [[0.1, 0.2], [0.3, 0.4]]


async def test_gemini_embedding_empty_input_short_circuits():
    provider = GeminiEmbeddingProvider()
    provider._client = MagicMock()  # would error if actually called

    assert await provider.embed([]) == []
