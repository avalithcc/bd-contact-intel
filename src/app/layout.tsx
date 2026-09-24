import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { getLocale } from "@/lib/i18n/server";
import { NavigationTracker } from "./NavigationTracker";
import { Sidebar } from "./Sidebar";
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
  return (
    <html
      lang={locale}
      className={`${inter.variable} ${jetbrains.variable}`}
    >
      <body>
        <NavigationTracker />
        <Sidebar />
        <div className="main-layout">
          {children}
        </div>
      </body>
    </html>
  );
}
