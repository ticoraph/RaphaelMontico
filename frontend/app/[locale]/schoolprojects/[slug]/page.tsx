import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCollection, getCollectionItem } from "@/lib/content";
import { mdxComponents } from "@/components/mdx-components";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { pageAlternates } from "@/lib/seo";

export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    getCollection(locale, "schoolprojects").map((item) => ({ locale, slug: item.slug })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const item = getCollectionItem(locale, "schoolprojects", slug);

  return {
    title: item?.title,
    description: item?.overview,
    alternates: pageAlternates(locale, `schoolprojects/${slug}`),
  };
}

export default async function SchoolProjectPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("schoolprojects");
  const item = getCollectionItem(locale, "schoolprojects", slug);

  if (!item) notFound();

  return (
    <article className="mx-auto max-w-[720px]">
      <Link href="/schoolprojects" className="mb-6 inline-block text-sm opacity-60 hover:underline">
        ← {t("backToList")}
      </Link>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight sm:text-3xl">{item.title}</h1>
      {item.tags && <p className="mb-6 text-sm opacity-60">{item.tags.join(", ")}</p>}
      <MDXRemote source={item.content} components={mdxComponents} />
    </article>
  );
}
