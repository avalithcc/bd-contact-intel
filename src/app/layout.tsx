import type { Metadata } from "next";
import localFont from "next/font/local";
import { getLocale } from "@/lib/i18n/server";
import { NavigationTracker } from "./NavigationTracker";
import "./globals.css";
import "./design-system.css";

// Self-hosted from @fontsource (OFL-1.1) instead of next/font/google: the
// build previously fetched these files from Google's servers at build time,
// which failed once in production when Google didn't respond. Only the
// "latin" subset files are used — the app only renders Spanish/Latin text,
// so the cyrillic/greek/vietnamese variants Google Fonts also ships are
// dropped intentionally to keep the bundle smaller.
const inter = localFont({
  src: [
    {
      path: "../../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource/inter/files/inter-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource/inter/files/inter-latin-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource/inter/files/inter-latin-800-normal.woff2",
      weight: "800",
      style: "normal",
    },
  ],
  variable: "--font-inter",
  display: "swap",
});

// Named --font-jetbrains (not --font-mono) because the CSS token layer's
// `--font-mono` in globals.css consumes this variable as its source
// (`--font-mono: var(--font-jetbrains), ...`) — reusing the same name here
// would make that declaration self-referential and invalid.
const jetbrains = localFont({
  src: [
    {
      path: "../../node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-jetbrains",
  display: "swap",
});

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
    <html
      lang={locale}
      className={`${inter.variable} ${jetbrains.variable}`}
    >
      <body>
        <NavigationTracker />
        {children}
      </body>
    </html>
  );
}
