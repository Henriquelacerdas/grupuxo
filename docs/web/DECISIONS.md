# Reveza Web: decisões

Registro curto das decisões da versão web (`web/`). Data: 26/11/2026. Matriz de paridade em [PARITY.md](PARITY.md).

## D1. Monorepo, pasta `web/`
Mesmo repositório do app e do backend. O contrato da `api` muda junto com o web no mesmo PR, e o teste do web decodifica os mesmos exemplos (`backend/test/fixtures/api/*.json`) que o backend gera e o Swift (`RemoteAPITests`) lê. Não há razão de segurança ou de deploy para separar: a Vercel compila só `web/` (Root Directory).

## D2. Stack: Next.js (App Router) + TypeScript + Tailwind
Next.js porque o web precisa de uma parte de servidor (D4) e a Vercel o roda sem configuração. TypeScript `strict` nas mesmas regras do backend (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, sem `any`, sem `as` em dado externo: decodificadores escritos à mão). Tailwind com tokens CSS das cores de sistema do iOS. Dependências de runtime mínimas: `next`, `react`, `react-dom`, `@tanstack/react-query` (cache e invalidação no lugar do `MyHouseCache`), `lucide-react` (os SF Symbols não podem ser usados fora das plataformas da Apple; tabela de equivalência em `web/src/components/icons.tsx`) e primitivos Radix acessíveis para diálogo, menu e switch. Sem Amplify JS, sem SDK da AWS, sem zod.

## D3. Login: só e-mail e senha, no mesmo app client do Cognito
Decisão do dono: o app client `21gqeeehhmeufpipk84e3cc7tu` e o user pool `us-east-1_M9GpISkE3` ficam intocados. O web usa o mesmo client (público, sem segredo), então o `client_id` dos tokens é o que a `api` já confere: **nenhuma mudança na `api` para autenticar**. Sign in with Apple exigiria uma URL de retorno web no app client e fica fora; a tela de login avisa que contas criadas com a Apple entram pelo iPhone. Fluxos: cadastro com código por e-mail, reenviar código, login SRP, esqueci a senha (código), trocar senha, sair, apagar conta (`DELETE /v1/me`, como o iOS).

## D4. Sessão no servidor (BFF) com cookies httpOnly
O navegador nunca vê tokens. Rotas do Next (`/api/auth/*`) falam com a API JSON do Cognito (SRP calculado no servidor com `node:crypto`), e `/api/v1/*` é um proxy para a `api` que põe o `Authorization: Bearer` a partir do cookie. Cookies `HttpOnly; Secure; SameSite=Lax; Path=/`: access token, refresh token cifrado (AES-256-GCM, `SESSION_SECRET`) e um cookie assinado com e-mail para a tela de Conta. Access vencido ou 401 da `api` → um refresh (`REFRESH_TOKEN_AUTH`) e uma nova tentativa; falhou, a sessão acaba (como o `APIClient` do iOS).

Consequência: **sem CORS** na `api` nem no bucket de fotos. A foto vai do navegador ao BFF, que faz o `PUT` no URL pré-assinado.

## D5. CSRF, XSS e cabeçalhos
Mutações em `/api/*` exigem origem própria (`Origin` ou `Sec-Fetch-Site: same-origin`) e o cabeçalho `X-Reveza: 1`, que um formulário de outro site não consegue mandar. CSP com nonce por requisição, `frame-ancestors 'none'`, `Referrer-Policy: same-origin`, `Permissions-Policy` restrita. React sem `dangerouslySetInnerHTML`. O proxy só encaminha caminhos `/v1/...`, limita o corpo a 4 KB (foto: 2 MB, só JPEG), repassa status e `{ "error" }` da `api` sem alterar e nunca registra token nem corpo. Rotas de auth têm limite de taxa por IP (por instância; o Cognito também limita; para limite global usar o Firewall da Vercel).

## D6. Dados e atualização
Sem tempo real no backend (o iOS também não tem). `GET /v1/me/house/snapshot` é a leitura principal, com `staleTime` de 5 s (igual ao `MyHouseCache`), invalidação depois de toda mutação, nova busca ao voltar para a aba e a cada 30 s com a aba visível. Prévia otimista só de concluir/reabrir, com rollback (como `OptimisticTaskCompletions`). Web Push (D8) avisa quando a página está fechada.

## D7. Regras de negócio
Nenhuma regra de distribuição, elegibilidade ou saldo no web: o servidor é a autoridade. O web só espelha o que o iOS faz na apresentação (quais botões aparecem, rótulos como "Termina domingo", agrupamento das seções) em `web/src/lib/rules/` e `web/src/lib/format/`, com testes.

## D8. Notificações
Web Push (VAPID) com service worker; no iPhone só funciona com o PWA instalado (iOS 16.4+). O servidor manda `kind` e argumentos, o service worker monta a frase no idioma do navegador. Equivalentes dos avisos locais do iOS (resumo diário e novo ciclo) são enviados pelo servidor **só para aparelhos web**, para o iPhone não receber em dobro.

## D9. Hospedagem: Vercel
Decisão do dono. A Vercel roda o Next.js como está e só chama a `api` e o Cognito pela internet; nada novo na AWS para o web. Variáveis em `web/.env.example`. Domínio e projeto na Vercel são passos manuais do dono (`web/README.md`).

## D10. Idioma
Segue o navegador: pt-BR ou en, outro idioma cai no inglês (como o app). Os textos vêm do `Localizable.xcstrings` do app (script `web/scripts/import-xcstrings.mjs`), com a mesma chave (o texto em pt-BR); textos só do web ficam em `web/src/i18n/web/*.ts` (um arquivo por área). O teste `tests/i18n-keys.test.ts` falha se algum `t("…")` ficar sem inglês.

## D11. Testes
Vitest para regras, formatação, decodificadores (todas as fixtures da `api`), SRP, cookies e CSRF. Playwright para os fluxos principais contra um servidor local da `api` (`backend/tools/local-api/`): a `createApiHandler` real com adaptadores em memória, verificador Cognito real sobre chaves locais e um emulador da API JSON do Cognito (SRP de verdade, código de confirmação `123456`) que emite tokens RS256 no formato do Cognito; o web fala com ele pelo mesmo cliente de produção, só trocando `COGNITO_ENDPOINT`. Um teste unitário confere o SRP do cliente contra um servidor escrito à parte. Nada nos testes toca a AWS.

## Mudanças no backend
Todas retrocompatíveis; o app iOS em produção continua com o mesmo contrato.

| Mudança | Onde | Estado |
| --- | --- | --- |
| Servidor local da `api` para dev e e2e (não é implantado) | `backend/tools/local-api/` | feito neste PR |
| Web Push: `PUT /v1/me/devices` aceita `{ kind: "web", endpoint, keys }`; `DELETE ?endpoint=`; `WebPushSender` (RFC 8291/8292); push de `cycleTurned` e lembrete diário só para web; segredo VAPID | `backend/src/push/`, `api.ts`, `scheduled`, `infra/` | pronto no branch `web-push` (commit 3568976, 1295 testes do backend passando); falta merge, `terraform plan`/`apply` autorizado pelo dono e gerar as chaves VAPID |

## Suposições
- A URL da App Store não está no repositório: `NEXT_PUBLIC_APP_STORE_URL`; sem valor, o botão some.
- A dica de senha segue o iOS; a regra que vale é a do user pool (erro do Cognito traduzido).
- Ordem dos cômodos só na sessão, como no iOS (o iOS não a guarda).
- Fonte arredondada: `ui-rounded` (SF Pro Rounded) nas plataformas Apple e a fonte do sistema nas demais; sem fonte web baixada (o build não depende da rede, e o CSP fica só com `'self'`).
- Boas-vindas aparecem antes do primeiro login ou cadastro no navegador (marca `reveza.hasSeenWelcome`), como a `WelcomeView` na 1ª abertura do app.
- Com convite pendente (`/invite/{code}`), o perfil entra direto na casa do código ao continuar, sem a escolha criar/entrar.
- Avaliar a semana: card no topo de Minhas tarefas que abre a sheet ao tocar, como no iOS (não abre sozinho). "Já enviada" fica em `localStorage` (prefixo `reveza.account.`, limpo no logout) até o fim da janela.
- Resumo diário no web: só a hora, no fuso da casa (o iOS usa hora e minuto no fuso do aparelho), porque é enviado pelo servidor.
- Tarefas, cômodo e avisos usam menus "⋯" no lugar dos gestos de deslizar do iOS; reordenar cômodos usa botões subir/descer no lugar de arrastar.
- Sugestões de tarefa (catálogo do domínio) aparecem na sheet de criação, com o título vazio.
- Nomes de cômodo usados como texto misturam a cor do cômodo com a do texto, para passar no contraste AA (amarelo puro sobre branco não passa).
