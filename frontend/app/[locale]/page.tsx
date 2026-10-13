import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSinglePage } from "@/lib/content";
import { splitSkillsSection } from "@/lib/skills";
import { mdxComponents } from "@/components/mdx-components";
import { SkillsMap } from "@/components/skills-map";
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
  const page = getSinglePage(locale, "home");

  return {
    title: page?.title,
    description: page?.subtitle,
    alternates: pageAlternates(locale, ""),
  };
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const page = getSinglePage(locale, "home");

  if (!page) notFound();

  // Falls back to rendering the whole body as Markdown if the skills section
  // doesn't follow the expected shape (see lib/skills.ts).
  const { before, skills } = splitSkillsSection(page.content);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:gap-8 sm:text-left">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/photos/avatar.jpg"
          width={160}
          height={160}
          alt={t("photoAlt")}
          className="h-32 w-32 shrink-0 rounded-full object-cover ring-1 ring-current/15 sm:h-40 sm:w-40"
        />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{page.title}</h1>
          {page.subtitle && <p className="mt-1 text-lg opacity-80">{page.subtitle}</p>}
        </div>
      </div>
      <MDXRemote source={before} components={mdxComponents} />
      {skills && <SkillsMap section={skills} />}
    </div>
  );
}
