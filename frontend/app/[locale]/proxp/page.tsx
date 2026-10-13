import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCollection } from "@/lib/content";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { pageAlternates } from "@/lib/seo";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "proxp" });

  return {
    title: t("title"),
    alternates: pageAlternates(locale, "proxp"),
  };
}

export default async function ProxpPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("proxp");
  const items = getCollection(locale, "proxp");

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight sm:text-3xl">{t("title")}</h1>
      <div className="flex flex-col gap-10">
        {items.map((item) => (
          <article key={item.slug}>
            <Link href={`/proxp/${item.slug}`} className="hover:underline">
              <h2 className="text-xl font-semibold">{item.title}</h2>
            </Link>
            {item.overview && <p className="mt-1 opacity-80">{item.overview}</p>}
            {item.date && <p className="text-sm opacity-60">{item.date}</p>}
          </article>
        ))}
        {items.length === 0 && <p className="opacity-60">Content coming soon.</p>}
      </div>
    </div>
  );
}
