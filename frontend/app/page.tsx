import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function RootRedirectPage() {
  return (
    <>
      <meta httpEquiv="refresh" content="0; url=/fr/" />
      <p className="flex min-h-full flex-1 items-center justify-center p-10 text-sm opacity-70">
        Redirecting to{" "}
        <Link href="/fr/" className="ml-1 underline">
          /fr/
        </Link>
        …
      </p>
    </>
  );
}
