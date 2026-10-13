import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Chat } from "@/components/chat";
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
  const t = await getTranslations({ locale, namespace: "chat" });

  return {
    title: t("title"),
    description: t("intro"),
    alternates: pageAlternates(locale, "chat"),
  };
}

export default async function ChatPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("chat");

  return (
    <div className="flex flex-col gap-8 py-6">
      <h1 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
        {t("title")}
      </h1>
      <Chat />
    </div>
  );
}
