import { routing } from "@/i18n/routing";

export const SITE_URL = "https://raphaelmontico.fr";

/**
 * Self-referencing canonical + hreflang alternates for a given locale/path.
 * `path` has no leading/trailing slash, e.g. "" for the home page, "blog/my-post".
 */
export function pageAlternates(locale: string, path: string = "") {
  const suffix = path ? `${path}/` : "";
  const languages: Record<string, string> = {};
  for (const l of routing.locales) {
    languages[l] = `${SITE_URL}/${l}/${suffix}`;
  }
  languages["x-default"] = `${SITE_URL}/${routing.defaultLocale}/${suffix}`;

  return {
    canonical: `${SITE_URL}/${locale}/${suffix}`,
    languages,
  };
}
