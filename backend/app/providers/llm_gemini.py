from collections.abc import AsyncIterator

from google import genai
from google.genai import types
from langfuse import get_client, observe

from app.config import get_settings
from app.providers.llm_base import LLMUsage
from app.schemas import ChatMessage

_MAX_OUTPUT_TOKENS = 2048


def _to_gemini_role(role: str) -> str:
    return "model" if role == "assistant" else "user"


class GeminiLLMProvider:
    def __init__(self) -> None:
        settings = get_settings()
        self._client = genai.Client(api_key=settings.gemini_api_key)
        self._model = settings.gemini_chat_model

    def _build_contents(self, history: list[ChatMessage], user_message: str) -> list[types.Content]:
        contents = [
            types.Content(
                role=_to_gemini_role(message.role), parts=[types.Part(text=message.content)]
            )
            for message in history
        ]
        contents.append(types.Content(role="user", parts=[types.Part(text=user_message)]))
        return contents

    @observe(as_type="generation")
    async def stream(
        self, system_prompt: str, history: list[ChatMessage], user_message: str
    ) -> AsyncIterator[str | LLMUsage]:
        get_client().update_current_generation(
            model=self._model,
            input=self._build_contents(history, user_message),
        )
        response = await self._client.aio.models.generate_content_stream(
            model=self._model,
            contents=self._build_contents(history, user_message),
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                max_output_tokens=_MAX_OUTPUT_TOKENS,
            ),
        )
        usage_metadata = None
        async for chunk in response:
            if chunk.usage_metadata is not None:
                usage_metadata = chunk.usage_metadata
            if chunk.text:
                yield chunk.text
        if usage_metadata is not None:
            get_client().update_current_generation(
                usage_details={
                    "input": usage_metadata.prompt_token_count,
                    "output": usage_metadata.candidates_token_count,
                }
            )
            yield LLMUsage(
                model=self._model,
                input_tokens=usage_metadata.prompt_token_count,
                output_tokens=usage_metadata.candidates_token_count,
            )

    @observe(as_type="generation")
    async def chat(self, system_prompt: str, history: list[ChatMessage], user_message: str) -> str:
        get_client().update_current_generation(
            model=self._model,
            input=self._build_contents(history, user_message),
        )
        response = await self._client.aio.models.generate_content(
            model=self._model,
            contents=self._build_contents(history, user_message),
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                max_output_tokens=_MAX_OUTPUT_TOKENS,
            ),
        )
        if response.usage_metadata is not None:
            get_client().update_current_generation(
                usage_details={
                    "input": response.usage_metadata.prompt_token_count,
                    "output": response.usage_metadata.candidates_token_count,
                }
            )
        return response.text or ""
