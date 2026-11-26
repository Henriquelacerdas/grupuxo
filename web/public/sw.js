// Gerado por scripts/build-sw.mjs — não editar à mão.
"use strict";
const STRINGS = {"pt-BR":{"push.cycleTurned":"O ciclo de {0} virou.","push.effortChanged":"{0} mudou o esforço de {1}.","push.effortChanged.anon":"O esforço de {0} mudou.","push.memberJoined":"{0} entrou na casa.","push.memberLeft":"{0} saiu da casa.","push.roomAccessApproved":"Você entrou em {0}.","push.roomAccessDenied":"Seu pedido para entrar em {0} foi recusado.","push.roomAccessRequested":"{0} pediu para entrar em {1}.","push.roomAccessRequested.anon":"Pediram para entrar em {0}.","push.roomDeleted":"{0} excluiu o cômodo {1}.","push.roomDeleted.anon":"O cômodo {0} foi excluído.","push.taskDeleted":"{0} apagou a tarefa {1}.","push.taskDeleted.anon":"A tarefa {0} foi apagada.","push.taskEdited":"{0} editou a tarefa {1}.","push.taskEdited.anon":"A tarefa {0} foi editada.","push.taskSwapAccepted":"Sua solicitação de troca de tarefa foi aceita.","push.taskSwapRejected":"Sua solicitação de troca de tarefa foi recusada.","push.taskSwapRequested":"Você recebeu uma solicitação de troca de tarefa.","push.weeklySummaryReady":"O resumo da semana está pronto.","push.dailyTasks.one":"Você tem 1 tarefa pendente","push.dailyTasks.other":"Você tem {0} tarefas pendentes"},"en":{"push.cycleTurned":"The {0} cycle turned over.","push.effortChanged":"{0} changed the effort of {1}.","push.effortChanged.anon":"The effort of {0} changed.","push.memberJoined":"{0} joined the house.","push.memberLeft":"{0} left the house.","push.roomAccessApproved":"You joined {0}.","push.roomAccessDenied":"Your request to join {0} was declined.","push.roomAccessRequested":"{0} asked to join {1}.","push.roomAccessRequested.anon":"Someone asked to join {0}.","push.roomDeleted":"{0} deleted the room {1}.","push.roomDeleted.anon":"The room {0} was deleted.","push.taskDeleted":"{0} deleted the task {1}.","push.taskDeleted.anon":"The task {0} was deleted.","push.taskEdited":"{0} edited the task {1}.","push.taskEdited.anon":"The task {0} was edited.","push.taskSwapAccepted":"Your task swap request was accepted.","push.taskSwapRejected":"Your task swap request was declined.","push.taskSwapRequested":"You received a task swap request.","push.weeklySummaryReady":"The weekly summary is ready.","push.dailyTasks.one":"You have 1 pending task","push.dailyTasks.other":"You have {0} pending tasks"}};

function locale() {
  const tag = (self.navigator.language || "pt-BR").toLowerCase();
  return tag.startsWith("pt") ? "pt-BR" : "en";
}

function render(key, args) {
  const table = STRINGS[locale()];
  const template = table[key] || STRINGS["pt-BR"][key];
  if (typeof template !== "string") return null;
  return template.replace(/\{(\d+)\}/g, (match, index) => (args[Number(index)] === undefined ? match : String(args[Number(index)])));
}

function text(payload) {
  const args = Array.isArray(payload.args) ? payload.args.filter((a) => typeof a === "string" || typeof a === "number") : [];
  if (payload.kind === "dailyTasks") {
    const count = Number(args[0] || 0);
    return render(count === 1 ? "push.dailyTasks.one" : "push.dailyTasks.other", [count]);
  }
  if (typeof payload.key === "string" && payload.key.startsWith("push.")) return render(payload.key, args);
  // Sem `key`: a mesma regra do APNs (tipos com quem fez e só um argumento vão para a variante .anon).
  if (typeof payload.kind !== "string" || !/^[A-Za-z]+$/.test(payload.kind)) return null;
  const actorKinds = ["taskEdited", "taskDeleted", "effortChanged", "roomDeleted", "roomAccessRequested"];
  const anon = actorKinds.includes(payload.kind) && args.length === 1 ? ".anon" : "";
  return render("push." + payload.kind + anon, args);
}

// Só caminhos do próprio app: nada vindo do payload abre outra origem.
function target(payload) {
  const url = typeof payload.url === "string" ? payload.url : "";
  return /^\/app(\/[A-Za-z0-9-]+)*$/.test(url) ? url : "/app/notifications";
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
