import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LifeVU — AI Engine para avatares",
  description: "Engine de identidade visual para transformar avatares com direção por referência.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
