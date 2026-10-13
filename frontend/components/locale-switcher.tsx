"use client";

import { useLocale, useTranslations } from "next-intl";
import { routing } from "@/i18n/routing";
import { Link, usePathname } from "@/i18n/navigation";

export function LocaleSwitcher() {
  const t = useTranslations("locale");
  const locale = useLocale();
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-1 text-sm" aria-label={t("switch")}>
      {routing.locales.map((loc) => (
        <Link
          key={loc}
          href={pathname}
          locale={loc}
          className={`rounded-full px-2 py-1 uppercase transition-colors ${
            loc === locale
              ? "font-semibold underline"
              : "opacity-60 hover:opacity-100"
          }`}
        >
          {loc}
        </Link>
      ))}
    </div>
  );
}
