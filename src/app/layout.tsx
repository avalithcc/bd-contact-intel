import type { Metadata } from "next";
import { getLocale } from "@/lib/i18n/server";
import { NavigationTracker } from "./NavigationTracker";
import "./globals.css";
import "./design-system.css";
// Self-hosted from @fontsource-variable (OFL-1.1) instead of next/font/google:
// the build previously fetched these files from Google's servers at build
// time, which failed once in production when Google didn't respond.
//
// `next/font/local` isn't used here: it accepts only one `unicode-range` per
// loader call, but Google served (and this app's real contact/company data
// needs — Cyrillic and Latin-Extended letters show up in ~1% of names, e.g.
// "Jagoda Łoś", "Agnieszka Choińska") every subset it ships for these
// families — latin, latin-ext, cyrillic, cyrillic-ext, greek, greek-ext
// (Inter only; not published for JetBrains Mono), vietnamese — each in its
// own `@font-face` with its own `unicode-range`. Importing @fontsource's own
// CSS unmodified restores that: the browser still fetches only the ranges a
// given page actually renders (a latin-only page never downloads the
// cyrillic/greek/vietnamese files).
//
// The *-variable* packages (one `wght.css` per family, weight range 100-900
// in a single file per subset) are used instead of discrete per-weight
// files: Google's own build serves one variable-font file per subset that
// covers every weight the page asks for, and static per-weight files would
// mean re-downloading the same glyphs once per weight actually used on a
// page. A variable font instantiated at a given weight renders identically
// to a static font at that same weight — same source outlines, no visual
// difference — while restoring Google's one-file-per-subset transfer size.
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";

export const metadata: Metadata = {
  title: "avalith. · bd contact intelligence",
  description: "Business Developer contact base with team overlap awareness",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body>
        <NavigationTracker />
        {children}
      </body>
    </html>
  );
}
