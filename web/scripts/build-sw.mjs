// Gera public/sw.js: o service worker do Reveza Web, com os textos `push.*` do catálogo do app embutidos (o
// servidor manda só a chave e os argumentos, como no APNs; a frase sai no idioma do navegador).
// Roda em `npm run build` (prebuild) e em `npm run i18n:import`.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = (locale) => JSON.parse(readFileSync(join(root, "src", "i18n", `catalog.${locale}.json`), "utf8"));
const DAILY_ONE = "Você tem 1 tarefa pendente";
const DAILY_OTHER = "Você tem {0} tarefas pendentes";

function strings(source) {
  const out = {};
  for (const [key, value] of Object.entries(source)) if (key.startsWith("push.") && typeof value === "string") out[key] = value;
  out["push.dailyTasks.one"] = source[DAILY_ONE] ?? DAILY_ONE; // pt-BR: o catálogo traz a chave
  out["push.dailyTasks.other"] = source[DAILY_OTHER] ?? DAILY_OTHER;
  return out;
}
// Em pt-BR o resumo diário é a própria chave do catálogo (texto-fonte).
const STRINGS = { "pt-BR": strings(catalog("pt-BR")), en: strings(catalog("en")) };

const source = `// Gerado por scripts/build-sw.mjs — não editar à mão.
"use strict";
const STRINGS = ${JSON.stringify(STRINGS)};

function locale() {
  const tag = (self.navigator.language || "pt-BR").toLowerCase();
  return tag.startsWith("pt") ? "pt-BR" : "en";
}

function render(key, args) {
  const table = STRINGS[locale()];
  const template = table[key] || STRINGS["pt-BR"][key];
  if (typeof template !== "string") return null;
  return template.replace(/\\{(\\d+)\\}/g, (match, index) => (args[Number(index)] === undefined ? match : String(args[Number(index)])));
}

function text(payload) {
  const args = Array.isArray(payload.args) ? payload.args.filter((a) => typeof a === "string" || typeof a === "number") : [];
  if (payload.kind === "dailyTasks") {
    const count = Number(args[0] || 0);
    return render(count === 1 ? "push.dailyTasks.one" : "push.dailyTasks.other", [count]);
  }
  if (typeof payload.key === "string" && payload.key.startsWith("push.")) return render(payload.key, args);
  // Sem \`key\`: a mesma regra do APNs (tipos com quem fez e só um argumento vão para a variante .anon).
  if (typeof payload.kind !== "string" || !/^[A-Za-z]+$/.test(payload.kind)) return null;
  const actorKinds = ["taskEdited", "taskDeleted", "effortChanged", "roomDeleted", "roomAccessRequested"];
  const anon = actorKinds.includes(payload.kind) && args.length === 1 ? ".anon" : "";
  return render("push." + payload.kind + anon, args);
}

// Só caminhos do próprio app: nada vindo do payload abre outra origem.
function target(payload) {
  const url = typeof payload.url === "string" ? payload.url : "";
  return /^\\/app(\\/[A-Za-z0-9-]+)*$/.test(url) ? url : "/app/notifications";
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const body = text(payload);
  if (body === null) return;
  const badge = typeof payload.badge === "number" ? payload.badge : undefined;
  event.waitUntil(Promise.all([
    self.registration.showNotification("Reveza", {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: typeof payload.kind === "string" ? payload.kind : "reveza",
      data: { url: target(payload) },
    }),
    badge !== undefined && self.navigator.setAppBadge ? self.navigator.setAppBadge(badge).catch(() => undefined) : Promise.resolve(),
  ]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/app/notifications";
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && "focus" in client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(url).catch(() => undefined);
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
`;
writeFileSync(join(root, "public", "sw.js"), source);
console.log("public/sw.js gerado");
