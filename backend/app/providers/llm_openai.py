from collections.abc import AsyncIterator
from typing import Any

from langfuse import get_client, observe
from openai import AsyncOpenAI

from app.config import get_settings
from app.providers.llm_base import LLMUsage
from app.schemas import ChatMessage

_MAX_OUTPUT_TOKENS = 2048


class OpenAILLMProvider:
    """OpenAI Responses API provider for the portfolio chat."""

    def __init__(self) -> None:
        settings = get_settings()
        if not settings.openai_api_key:
            raise ValueError("OPENAI_API_KEY is required when LLM_PROVIDER=openai")
        self._client = AsyncOpenAI(api_key=settings.openai_api_key)
        self._model = settings.openai_chat_model

    @staticmethod
    def _build_input(
        history: list[ChatMessage], user_message: str
    ) -> list[dict[str, str]]:
        messages = [
            {"role": message.role, "content": message.content} for message in history
        ]
        messages.append({"role": "user", "content": user_message})
        return messages

    @staticmethod
    def _usage_details(usage: Any) -> dict[str, int] | None:
        if usage is None:
            return None
        return {"input": usage.input_tokens, "output": usage.output_tokens}

    @observe(as_type="generation")
    async def stream(
        self, system_prompt: str, history: list[ChatMessage], user_message: str
    ) -> AsyncIterator[str | LLMUsage]:
        input_messages = self._build_input(history, user_message)
        get_client().update_current_generation(model=self._model, input=input_messages)
        stream = await self._client.responses.create(
            model=self._model,
            instructions=system_prompt,
            input=input_messages,
            max_output_tokens=_MAX_OUTPUT_TOKENS,
            reasoning={"effort": "none"},
            stream=True,
        )

        usage = None
        async for event in stream:
            if event.type == "response.output_text.delta":
                yield event.delta
            elif event.type == "response.completed":
                usage = event.response.usage
            elif event.type == "response.failed":
                error = event.response.error
                raise RuntimeError(error.message if error is not None else "OpenAI response failed")
            elif event.type == "error":
                raise RuntimeError(event.message)

        usage_details = self._usage_details(usage)
        if usage_details is not None:
            get_client().update_current_generation(usage_details=usage_details)
            yield LLMUsage(
                model=self._model,
                input_tokens=usage.input_tokens,
                output_tokens=usage.output_tokens,
            )

    @observe(as_type="generation")
    async def chat(
        self, system_prompt: str, history: list[ChatMessage], user_message: str
    ) -> str:
        input_messages = self._build_input(history, user_message)
        get_client().update_current_generation(model=self._model, input=input_messages)
        response = await self._client.responses.create(
            model=self._model,
            instructions=system_prompt,
            input=input_messages,
            max_output_tokens=_MAX_OUTPUT_TOKENS,
            reasoning={"effort": "none"},
        )
        usage_details = self._usage_details(response.usage)
        if usage_details is not None:
            get_client().update_current_generation(usage_details=usage_details)
        return response.output_text or ""
