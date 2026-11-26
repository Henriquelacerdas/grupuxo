// Proteção contra CSRF nas rotas `/api/*` que mudam estado: o pedido tem de vir da própria origem e trazer o
// cabeçalho `X-Reveza: 1` (um formulário ou `<img>` de outro site não consegue mandar cabeçalho próprio, e um
// `fetch` de outra origem com esse cabeçalho dispara preflight, que o BFF não autoriza).

export const CSRF_HEADER = "x-reveza";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function sameOriginRequest(method: string, url: URL, headers: Headers): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;
  if (headers.get(CSRF_HEADER) !== "1") return false;
  const fetchSite = headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") return false;
  const origin = headers.get("origin");
  if (origin === null) return fetchSite === "same-origin";
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? url.host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
