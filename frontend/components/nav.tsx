import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LocaleSwitcher } from "@/components/locale-switcher";

export function Nav() {
  const t = useTranslations("nav");

  const links = [
    { href: "/", label: t("home") },
    { href: "/proxp", label: t("proxp") },
    { href: "/perxp", label: t("perxp") },
    { href: "/schoolprojects", label: t("schoolprojects") },
    { href: "/diplomas", label: t("diplomas") },
  ] as const;

  return (
    <header className="border-b border-current/10">
      <div className="mx-auto flex max-w-[818px] flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6 sm:py-4">
        <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="py-1 hover:underline">
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
          <Link
            href="/chat"
            aria-label={t("chat")}
            title={t("chat")}
            className="rounded-full border border-current/20 p-1.5 transition-colors hover:bg-current/5"
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
              <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
            </svg>
          </Link>
          <LocaleSwitcher />
        </div>
      </div>
    </header>
  );
}
