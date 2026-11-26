import { messagesFor } from "@/i18n/load";
import { format, pickLocale } from "@/i18n/messages";

// Manifesto do PWA no idioma do navegador. Os atalhos fazem o papel dos atalhos da Siri do app.
export function GET(request: Request): Response {
  const locale = pickLocale(request.headers.get("accept-language"));
  const messages = messagesFor(locale);
  const t = (key: string) => format(locale, messages, key, []);
  const manifest = {
    name: "Reveza",
    short_name: "Reveza",
    description: t("Cada cômodo da casa passa para uma pessoa diferente a cada ciclo, e as tarefas dele vão junto."),
    lang: locale,
    id: "/app",
    start_url: "/app/tasks",
    scope: "/",
    display: "standalone",
    background_color: "#f2f2f7",
    theme_color: "#f2f2f7",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: t("Minhas tarefas"), url: "/app/tasks", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: t("Nova tarefa"), url: "/app/tasks?new=1", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: t("Notificações"), url: "/app/notifications", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=3600", vary: "accept-language" },
  });
}
