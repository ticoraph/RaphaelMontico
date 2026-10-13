import { API_URL } from "./api";

export type ChatSource = {
  id: string;
  type: "blog_post" | "project" | "experience" | "diploma" | "page_section";
  title: string;
  slug: string;
  section: string | null;
  source_path: string;
  /** Cosine similarity between the question and this chunk, in [0, 1]. */
  score?: number;
};

export type ChatMetrics = {
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  retrieval_ms: number;
  generation_ms: number;
};

export type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

// Mirrors the bounds enforced by the backend (backend/app/schemas.py).
export const MAX_MESSAGE_CHARS = 2000;
export const MAX_HISTORY_MESSAGES = 20;
export const MAX_HISTORY_CONTENT_CHARS = 8000;

/** The most recent turns, each within the backend's size bounds. */
export function boundHistory(history: ChatHistoryMessage[]): ChatHistoryMessage[] {
  return history
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ ...m, content: m.content.slice(0, MAX_HISTORY_CONTENT_CHARS) }));
}

/** A non-2xx answer from the API; `status` 429 means the rate limit was hit. */
export class ChatRequestError extends Error {
  constructor(public readonly status: number) {
    super(`chat request failed (${status})`);
  }
}

/**
 * Derives the site route for a cited chunk from its source path,
 * e.g. "content/en/proxp/geodis.mdx" -> "/proxp/geodis".
 * Returns null when there is no matching page (unknown layout).
 */
export function sourceHref(source: ChatSource): string | null {
  // Defensive: an older backend build doesn't send source_path.
  if (!source.source_path) return null;
  const parts = source.source_path.split("/");
  // content/<locale>/<collection>/<file>.mdx
  if (parts.length === 4) {
    return `/${parts[2]}/${source.slug}`;
  }
  // content/<locale>/<page>.mdx (home.mdx)
  if (parts.length === 3) {
    const page = parts[2].replace(/\.mdx$/, "");
    return page === "home" ? "/" : `/${page}`;
  }
  return null;
}

export type IndexStatus = {
  last_updated: string | null;
};

/** Calls GET /api/index-status — when the vector DB was last (re)ingested. */
export async function getIndexStatus(): Promise<IndexStatus> {
  const response = await fetch(`${API_URL}/index-status`);
  if (!response.ok) {
    throw new Error(`index-status request failed (${response.status})`);
  }
  return response.json();
}

type StreamHandlers = {
  onSources: (sources: ChatSource[]) => void;
  onToken: (text: string) => void;
  onMetrics?: (metrics: ChatMetrics) => void;
};

/**
 * Calls POST /api/chat and consumes its SSE stream (events: sources, token,
 * error, done). Resolves when the stream ends; rejects on network failure,
 * non-2xx response, or an `error` SSE event.
 */
export async function streamChat(
  params: {
    message: string;
    history: ChatHistoryMessage[];
    language: string;
    signal?: AbortSignal;
  },
  handlers: StreamHandlers,
): Promise<void> {
  const response = await fetch(`${API_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: params.message,
      history: params.history,
      language: params.language,
    }),
    signal: params.signal,
  });

  if (!response.ok || !response.body) {
    throw new ChatRequestError(response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleEvent = (block: string) => {
    let event = "";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7).trim();
      else if (line.startsWith("data: ")) data += line.slice(6);
    }
    if (!event || !data) return;
    const payload = JSON.parse(data);
    if (event === "sources") handlers.onSources(payload.sources ?? []);
    else if (event === "token") handlers.onToken(payload.text ?? "");
    else if (event === "error") throw new Error(payload.message ?? "stream error");
    else if (event === "done" && payload.metrics) handlers.onMetrics?.(payload.metrics);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE events are separated by a blank line.
    let separator: number;
    while ((separator = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      handleEvent(block);
    }
  }
}
