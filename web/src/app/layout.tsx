import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import "./globals.css";
import { messagesFor } from "@/i18n/load";
import { format, pickLocale } from "@/i18n/messages";
import { Providers } from "./providers";

async function locale() {
  return pickLocale((await headers()).get("accept-language"));
}

export async function generateMetadata(): Promise<Metadata> {
  const current = await locale();
  const messages = messagesFor(current);
  return {
    title: { default: "Reveza", template: "%s · Reveza" },
    description: format(current, messages, "Cada cômodo da casa passa para uma pessoa diferente a cada ciclo, e as tarefas dele vão junto.", []),
    applicationName: "Reveza",
    manifest: "/manifest.webmanifest",
    icons: { icon: [{ url: "/icons/icon-192.png", sizes: "192x192" }, { url: "/icons/icon.svg", type: "image/svg+xml" }], apple: "/icons/apple-touch-icon.png" },
    appleWebApp: { capable: true, title: "Reveza", statusBarStyle: "default" },
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const current = await locale();
  return (
    <html lang={current}>
      <body>
        <Providers locale={current} messages={messagesFor(current)}>{children}</Providers>
      </body>
    </html>
  );
}
