import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { getLocale } from "@/lib/i18n/server";
import { getTheme } from "@/lib/theme/server";
import { NavigationTracker } from "./NavigationTracker";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["400", "500", "600", "700", "800"],
});

// Named --font-jetbrains (not --font-mono) because the CSS token layer's
// `--font-mono` in globals.css consumes this variable as its source
// (`--font-mono: var(--font-jetbrains), ...`) — reusing the same name here
// would make that declaration self-referential and invalid.
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  weight: ["400", "700"],
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
  const theme = await getTheme();
  // "system" omits data-theme entirely: globals.css then falls back to the
  // `@media (prefers-color-scheme: light)` rule scoped to
  // `:root:not([data-theme])`, so the OS/browser preference decides.
  // color-scheme mirrors the same resolution so native controls/scrollbars
  // (and the browser's own dark-mode UI) match what's rendered.
  const colorScheme = theme === "system" ? "light dark" : theme;
  return (
    <html
      lang={locale}
      data-theme={theme === "system" ? undefined : theme}
      style={{ colorScheme }}
      className={`${inter.variable} ${jetbrains.variable}`}
    >
      <body>
        <NavigationTracker />
        {children}
      </body>
    </html>
  );
}
