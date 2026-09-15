import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BD Contact Intelligence",
  description: "Business Developer contact base with team overlap awareness",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
