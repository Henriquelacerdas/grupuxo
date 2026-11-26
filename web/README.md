# Reveza Web

Versão web do Reveza para quem não tem iPhone: mesma conta (Cognito), mesma casa e mesma `api` do app iOS. Next.js 16 (App Router) + React 19 + TypeScript `strict` + Tailwind 4, hospedado na Vercel. Decisões em [docs/web/DECISIONS.md](../docs/web/DECISIONS.md); paridade com o app, item a item, em [docs/web/PARITY.md](../docs/web/PARITY.md).

```
navegador ──(cookies httpOnly, mesma origem)──► Next.js (Vercel)
                                                ├─ /api/auth/*  → Cognito (API JSON, SRP feito no servidor)
                                                ├─ /api/v1/*    → `api` (Bearer do cookie, refresh transparente)
                                                └─ /api/photo   → foto: recebe o JPEG e faz o PUT no S3 pré-assinado
```

- Nenhuma regra de distribuição, saldo ou elegibilidade roda aqui: o web só apresenta o que a `api` devolve (rótulos e agrupamentos espelham `Presentation/` do app, em `src/lib/format` e `src/lib/rules`).
- Tokens nunca chegam ao JavaScript: `rvz_at` (access), `rvz_rt` (refresh cifrado com AES-256-GCM) e `rvz_me` (perfil cifrado), todos `HttpOnly; SameSite=Lax; Secure` em https.
- Mutações exigem a mesma origem e o cabeçalho `X-Reveza: 1` (CSRF). CSP com nonce por requisição (`src/proxy.ts`).
- Contrato tipado: decodificadores escritos à mão em `src/lib/api/types.ts`, testados contra todos os `backend/test/fixtures/api/*.json`.
- Textos: importados de `grupuxo/grupuxo/Localizable.xcstrings` (`npm run i18n:import`); os só do web ficam em `src/i18n/web/*.ts`. Idioma do navegador (pt-BR ou en; outros caem no inglês, como o app).

## Rodar localmente

Precisa de Node 22.18+ e das dependências do backend (`cd backend && npm install`).

```bash
cd backend && npm run local-api
```

```bash
cd web && cp .env.example .env.local && npm install && npm run dev
```

Abra http://localhost:3000. O `local-api` é a mesma `createApiHandler` da Lambda, em memória, com Cognito emulado: crie uma conta com qualquer e-mail e confirme com o código **123456**. Nada toca a AWS. Rotas de teste (só locais): `POST /__test/clock {"advanceMs"}`, `POST /__test/scheduled`, `POST /__test/reset`.

Para apontar para o `dev` real, troque `REVEZA_API_BASE_URL` pela Function URL da `api` e deixe `COGNITO_ENDPOINT` vazio.

## Scripts

| Comando | O quê |
| --- | --- |
| `npm run dev` | Next em modo dev (porta 3000) |
| `npm run build` / `npm start` | build de produção (gera `public/sw.js` antes) |
| `npm run lint` · `npm run typecheck` | ESLint · `tsc --noEmit` |
| `npm test` | Vitest: contrato da `api`, SRP contra um servidor independente, sessão, CSRF, service worker, i18n, regras de apresentação |
| `npm run e2e` | Playwright contra `local-api` + `next start` (porta 3100); `npx playwright install chromium webkit` na primeira vez |
| `npm run i18n:import` | regera `src/i18n/catalog.*.json` do String Catalog do app |
| `npm run shared:sync` | regera `src/lib/shared/task-suggestions.json` do domínio TypeScript |
| `npm run icons` | regera os ícones do PWA a partir do glifo do ícone do app |

## Variáveis de ambiente

Todas em [.env.example](.env.example). Só `SESSION_SECRET` é segredo (32+ bytes aleatórios); os IDs do Cognito são os mesmos públicos do app.

| Variável | Para quê |
| --- | --- |
| `REVEZA_API_BASE_URL` | Function URL da `api` (sem barra no fim) |
| `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID` | user pool e app client do app (o web usa o mesmo client) |
| `COGNITO_ENDPOINT` | só dev/e2e (emulador); vazio em produção |
| `SESSION_SECRET` | cifra o refresh token e o perfil |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | chave pública do Web Push; vazia, o push some da interface |
| `NEXT_PUBLIC_APP_STORE_URL` | botão da App Store na página inicial; vazio, some |
| `NEXT_PUBLIC_PRIVACY_POLICY_URL`, `NEXT_PUBLIC_TERMS_URL`, `NEXT_PUBLIC_FEEDBACK_EMAIL` | links de Ajustes e da página inicial |

## Deploy (Vercel)

1. Importar o repositório na Vercel com **Root Directory = `web`** (framework Next.js, comandos padrão).
2. Configurar as variáveis acima em Production e Preview (Preview pode apontar para o mesmo `dev`).
3. Domínio próprio em *Settings → Domains*. O CSP e os cookies não dependem do domínio.
4. Opcional: regra de *rate limit* no Vercel Firewall para `/api/auth/*` (o limite do BFF é por instância).

## PWA e notificações

Manifesto em `/manifest.webmanifest` (no idioma do navegador, com atalhos Minhas tarefas, Nova tarefa e Notificações) e service worker `public/sw.js`, gerado por `scripts/build-sw.mjs` com os textos `push.*` do catálogo: o servidor manda só a chave e os argumentos, como no APNs. No iPhone, o Safari só oferece push ao app adicionado à Tela de Início (iOS 16.4+). O push depende da rota `PUT /v1/me/devices` com `kind: "web"` no backend e do segredo VAPID no ambiente.
