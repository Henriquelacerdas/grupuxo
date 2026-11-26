"use client";

import { me } from "./endpoints";

// Web Push no navegador: inscrição no service worker (`/sw.js`) com a chave pública VAPID e registro do aparelho
// na `api` (`PUT /v1/me/devices` com `kind: "web"`). Sem a chave configurada, a função some da interface.

export type PushState = "unsupported" | "needsInstall" | "default" | "granted" | "denied";

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || Reflect.get(navigator, "standalone") === true;
}

export function pushState(): PushState {
  if (PUBLIC_KEY === "" || typeof window === "undefined") return "unsupported";
  const capable = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  // No iPhone, o Safari só oferece push ao app adicionado à Tela de Início (iOS 16.4+).
  if (!capable) return isIOS() && !isStandalone() ? "needsInstall" : "unsupported";
  const permission = Notification.permission;
  return permission === "granted" ? "granted" : permission === "denied" ? "denied" : "default";
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

function applicationServerKey(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "===".slice((base64url.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function subscription(): Promise<PushSubscription | null> {
  const registration = (await navigator.serviceWorker.getRegistration("/")) ?? (await registerServiceWorker());
  return registration === null ? null : registration.pushManager.getSubscription();
}

/** Este navegador recebe push desta conta? */
export async function isPushEnabled(): Promise<boolean> {
  if (pushState() !== "granted") return false;
  return (await subscription()) !== null;
}

/** Pede permissão, inscreve e registra na `api`. Devolve o estado final. */
export async function enablePush(): Promise<PushState> {
  if (pushState() === "unsupported" || pushState() === "needsInstall") return pushState();
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return pushState();
  const registration = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
  await navigator.serviceWorker.ready;
  const current = (await registration.pushManager.getSubscription())
    ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(PUBLIC_KEY) }));
  const json = current.toJSON();
  const p256dh = json.keys?.["p256dh"];
  const auth = json.keys?.["auth"];
  if (json.endpoint === undefined || p256dh === undefined || auth === undefined) throw new Error("push_subscription");
  await me.registerWebPush({ endpoint: json.endpoint, keys: { p256dh, auth } });
  return "granted";
}

/** Desliga neste navegador (Ajustes, sair da conta). Falha na `api` não impede cancelar a inscrição local. */
export async function disablePush(): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  const current = await subscription().catch(() => null);
  if (current === null) return;
  await me.removeWebPush(current.endpoint).catch(() => undefined);
  await current.unsubscribe().catch(() => false);
}
