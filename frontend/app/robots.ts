import type { MetadataRoute } from "next";

export const dynamic = "force-static";

// Crawlers SEO + IA (entraînement, recherche, requêtes utilisateur) nommés explicitement :
// certains ignorent le groupe "*" ou ont leur propre jeton de contrôle.
const BLOCKED_USER_AGENTS = [
  "*",
  // OpenAI
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  // Anthropic
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "Claude-Web",
  "anthropic-ai",
  // Google (Google-Extended = jeton Gemini / Vertex AI)
  "Googlebot",
  "Google-Extended",
  "Google-CloudVertexBot",
  "GoogleOther",
  // Microsoft
  "Bingbot",
  // Perplexity
  "PerplexityBot",
  "Perplexity-User",
  // Apple, Meta, Amazon, ByteDance, Common Crawl, etc.
  "Applebot",
  "Applebot-Extended",
  "meta-externalagent",
  "meta-externalfetcher",
  "FacebookBot",
  "Amazonbot",
  "Bytespider",
  "CCBot",
  "cohere-ai",
  "cohere-training-data-crawler",
  "Diffbot",
  "DuckAssistBot",
  "YouBot",
  "MistralAI-User",
  "PetalBot",
  "Timpibot",
  "ImagesiftBot",
  "Omgilibot",
  "omgili",
  "Kangaroo Bot",
  // Outils SEO
  "AhrefsBot",
  "SemrushBot",
  "MJ12bot",
  "DotBot",
  "BLEXBot",
  "DataForSeoBot",
  "Screaming Frog SEO Spider",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: BLOCKED_USER_AGENTS.map((userAgent) => ({
      userAgent,
      disallow: "/",
    })),
  };
}
