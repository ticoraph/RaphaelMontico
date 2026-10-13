"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import ReactMarkdown, { type Components } from "react-markdown";
import { Link } from "@/i18n/navigation";
import {
  boundHistory,
  ChatRequestError,
  type ChatHistoryMessage,
  type ChatMetrics,
  type ChatSource,
  getIndexStatus,
  MAX_MESSAGE_CHARS,
  sourceHref,
  streamChat,
} from "@/lib/chat";

type Message = {
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[];
  metrics?: ChatMetrics;
};

type Status = "idle" | "streaming" | "error";

// Kept in sync with backend/app/rag/prompt.py (_SYSTEM_PROMPT) — shown as-is
// (French, as in the backend source) to demonstrate how answers are built.
const SYSTEM_PROMPT_TEXT = `Tu es l'assistant IA du portfolio de Raphaël Montico. Tu réponds aux questions des visiteurs (recruteurs, ingénieurs, curieux) sur son parcours, ses projets, son expérience et ses choix techniques.

Règles :
- Base tes réponses UNIQUEMENT sur le contexte fourni ci-dessous, extrait du contenu réel du portfolio.
- Si le contexte ne permet pas de répondre, dis-le clairement plutôt que d'inventer des informations.
- Ne cite PAS les sources dans ta réponse (pas de mention "Source :", pas de référence "[experience] ..." ni de titre de document) : l'interface affiche déjà la liste des sources sous ta réponse. Contente-toi de répondre.
- Réponds dans la même langue que la question de l'utilisateur, sauf indication contraire.
- Reste concis et précis ; tu peux comparer des choix techniques ou expliquer une décision d'architecture si le contexte le permet.

Contexte (extraits du portfolio, du plus pertinent au moins pertinent) :
{context}`;

// A realistic example matching backend/app/schemas.py::SearchResultItem — the
// shape of one retrieved chunk before it's flattened into the prompt context above.
const EXAMPLE_CHUNK_TEXT = `{
  "id": "5f2b0c9a-6e0e-4b53-9b2a-2b7e6a2d5f39",
  "type": "project",
  "title": "RaphaelMontico.fr",
  "slug": "raphaelmontico",
  "section": "Architecture & technologies",
  "language": "fr",
  "tags": ["Next.js", "FastAPI", "PostgreSQL", "pgvector", "RAG", "OpenAI"],
  "content": "- Frontend : Next.js (App Router), TypeScript, Tailwind CSS 4, next-intl (i18n)\\n- Backend : FastAPI, SQLAlchemy async + asyncpg, Alembic\\n- Base de données : PostgreSQL + pgvector pour le stockage des embeddings\\n- IA : embeddings OpenAI, LLM OpenAI, réponses en streaming (SSE)",
  "score": 0.82
}`;

function IndexStatusLine() {
  const t = useTranslations("chat");
  const locale = useLocale();
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    getIndexStatus()
      .then((status) => setLastUpdated(status.last_updated))
      .catch(() => {});
  }, []);

  if (!lastUpdated) return null;

  const formatted = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(lastUpdated));

  return (
    <p className="text-center text-xs opacity-50">
      {t("indexLastUpdated", { date: formatted })}
    </p>
  );
}

function SystemPromptDetails() {
  const t = useTranslations("chat");
  return (
    <details className="group mt-2 text-xs opacity-70">
      <summary className="cursor-pointer select-none list-none underline decoration-dotted underline-offset-2 group-open:opacity-100">
        {t("systemPromptSummary")}
      </summary>
      <p className="mt-2 opacity-70">{t("systemPromptNote")}</p>
      <pre className="mt-2 overflow-x-auto rounded-lg bg-black/5 p-3 font-mono text-[0.8em] leading-relaxed whitespace-pre-wrap">
        {SYSTEM_PROMPT_TEXT}
      </pre>
    </details>
  );
}

function ExampleChunkDetails() {
  const t = useTranslations("chat");
  return (
    <details className="group mt-2 text-xs opacity-70">
      <summary className="cursor-pointer select-none list-none underline decoration-dotted underline-offset-2 group-open:opacity-100">
        {t("exampleChunkSummary")}
      </summary>
      <p className="mt-2 opacity-70">{t("exampleChunkNote")}</p>
      <pre className="mt-2 overflow-x-auto rounded-lg bg-black/5 p-3 font-mono text-[0.8em] leading-relaxed whitespace-pre-wrap">
        {EXAMPLE_CHUNK_TEXT}
      </pre>
    </details>
  );
}

// Compact chat-sized equivalents of the site's MDX styles (mdx-components.tsx
// targets long-form pages: 20px serif — too heavy for chat bubbles).
const markdownComponents: Components = {
  p: (props) => <p className="mb-2 last:mb-0" {...props} />,
  ul: (props) => <ul className="mb-2 list-disc pl-5 last:mb-0" {...props} />,
  ol: (props) => <ol className="mb-2 list-decimal pl-5 last:mb-0" {...props} />,
  li: (props) => <li className="mb-1" {...props} />,
  strong: (props) => <strong className="font-semibold" {...props} />,
  a: (props) => (
    <a
      className="text-[rgba(88,125,177,1)] underline hover:text-gray-500"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    />
  ),
  code: (props) => (
    <code className="rounded bg-black/5 px-1 py-0.5 font-mono text-[0.85em]" {...props} />
  ),
  h1: (props) => <p className="mb-2 font-semibold" {...props} />,
  h2: (props) => <p className="mb-2 font-semibold" {...props} />,
  h3: (props) => <p className="mb-2 font-semibold" {...props} />,
};

function MetricsLine({ metrics }: { metrics: ChatMetrics }) {
  const t = useTranslations("chat");
  const locale = useLocale();
  const ms = (value: number) =>
    value < 1000
      ? `${value} ms`
      : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1000)} s`;

  const parts = [
    metrics.model,
    metrics.input_tokens != null && metrics.output_tokens != null
      ? `${metrics.input_tokens} → ${metrics.output_tokens} tokens`
      : null,
    `${t("metricRetrieval")} ${ms(metrics.retrieval_ms)}`,
    `${t("metricGeneration")} ${ms(metrics.generation_ms)}`,
  ].filter(Boolean);

  return (
    <p className="mt-2 font-mono text-[11px] opacity-40">{parts.join(" · ")}</p>
  );
}

function SourceList({ sources }: { sources: ChatSource[] }) {
  const t = useTranslations("chat");
  // The same document appears once per retrieved section — dedupe by page,
  // keeping the first occurrence (chunks arrive sorted by descending score).
  const byPage = new Map<string, ChatSource>();
  for (const s of sources) {
    const key = s.source_path ?? s.id;
    if (!byPage.has(key)) byPage.set(key, s);
  }
  const unique = [...byPage.values()];
  if (unique.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-black/10 pt-3 text-xs">
      <span className="opacity-50">{t("sources")}</span>
      {unique.map((source) => {
        const href = sourceHref(source);
        const label =
          source.score != null
            ? `${source.title} · ${Math.round(source.score * 100)}%`
            : source.title;
        return href ? (
          <Link
            key={source.source_path ?? source.id}
            href={href}
            className="rounded-full border border-black/15 px-2.5 py-0.5 text-[rgba(88,125,177,1)] transition-colors hover:text-gray-500 hover:underline"
          >
            {label}
          </Link>
        ) : (
          <span
            key={source.source_path ?? source.id}
            className="rounded-full border border-black/15 px-2.5 py-0.5 opacity-70"
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

export function Chat() {
  const t = useTranslations("chat");
  const locale = useLocale();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || status === "streaming") return;

    const history: ChatHistoryMessage[] = boundHistory(
      messages.filter((m) => m.content).map(({ role, content }) => ({ role, content })),
    );

    setInput("");
    setStatus("streaming");
    setMessages((prev) => [
      ...prev,
      { role: "user", content: message },
      { role: "assistant", content: "" },
    ]);

    const patchAssistant = (patch: (m: Message) => Message) =>
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = patch(next[next.length - 1]);
        return next;
      });

    try {
      await streamChat(
        { message, history, language: locale },
        {
          onSources: (sources) => patchAssistant((m) => ({ ...m, sources })),
          onToken: (token) =>
            patchAssistant((m) => ({ ...m, content: m.content + token })),
          onMetrics: (metrics) => patchAssistant((m) => ({ ...m, metrics })),
        },
      );
      setStatus("idle");
    } catch (error) {
      setStatus("error");
      const rateLimited = error instanceof ChatRequestError && error.status === 429;
      patchAssistant((m) =>
        m.content ? m : { ...m, content: t(rateLimited ? "rateLimited" : "errorMessage") },
      );
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void send(input);
  };

  const suggestions = [
    t("suggestion1"),
    t("suggestion2"),
    t("suggestion3"),
    t("suggestion4"),
    t("suggestion5"),
  ];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      {messages.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex flex-wrap justify-center gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => void send(suggestion)}
                className="rounded-full border border-black/15 px-3 py-1.5 text-sm opacity-70 transition-opacity hover:opacity-100"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {messages.map((message, index) => (
            <div
              key={index}
              className={
                message.role === "user"
                  ? "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-black/5 px-4 py-2.5"
                  : "max-w-full"
              }
            >
              {message.role === "assistant" ? (
                <div className="text-sm leading-relaxed">
                  {message.content ? (
                    <ReactMarkdown components={markdownComponents}>
                      {message.content}
                    </ReactMarkdown>
                  ) : status === "streaming" && index === messages.length - 1 ? (
                    "…"
                  ) : null}
                </div>
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-relaxed">
                  {message.content}
                </p>
              )}
              {message.role === "assistant" && message.metrics && (
                <MetricsLine metrics={message.metrics} />
              )}
              {message.role === "assistant" && message.sources && (
                <SourceList sources={message.sources} />
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      <form onSubmit={handleSubmit} className="sticky bottom-4 flex gap-2 sm:bottom-6">
        <input
          type="text"
          value={input}
          maxLength={MAX_MESSAGE_CHARS}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(input);
            }
          }}
          placeholder={t("placeholder")}
          aria-label={t("placeholder")}
          className="min-w-0 flex-1 rounded-full border border-black/15 bg-white px-4 py-2.5 text-base sm:text-sm text-neutral-900 outline-none [color-scheme:light] placeholder:text-neutral-400 focus:border-black/40"
        />
        <button
          type="submit"
          disabled={status === "streaming" || !input.trim()}
          className="shrink-0 rounded-full bg-black px-4 py-2.5 text-sm text-white sm:px-5 transition-opacity disabled:opacity-40"
        >
          {status === "streaming" ? t("thinking") : t("send")}
        </button>
      </form>

      <p className="text-center text-xs opacity-50">{t("disclaimer")}</p>
      <IndexStatusLine />
      <SystemPromptDetails />
      <ExampleChunkDetails />
    </div>
  );
}
