# Reveza Web: paridade com o app iOS

Checklist de escopo e definição de pronto da versão web. Fonte: `grupuxo/grupuxo/Presentation/Features/*`, `Data/Remote/*` e `docs/BACKEND.md` §6.1. Decisões em [DECISIONS.md](DECISIONS.md).

Status: ✅ feito · 🟡 parcial · ⛔ impossível na web (motivo e alternativa) · ⏳ planejado. Revisado em 26/11/2026.

Verificação: `npm test` (Vitest, 64 testes, incluindo o contrato com todas as fixtures da `api`) e `npm run e2e` (Playwright, Chromium e WebKit móvel) contra o `backend/tools/local-api`. O e2e cobre cadastro com código, criar casa com cômodo inicial, convite por link e entrada do segundo morador, aviso de entrada, concluir tarefa, criar tarefa pela sheet única, Ajustes, sair da casa, rota protegida, CSRF e `axe` (claro, escuro, celular). Trocas, avaliação e resumo da semana, férias e WhatsApp foram testados só por unidade e revisão; não têm e2e ainda. Nada foi testado contra o `dev` real (precisa do login do dono).

## Conta e acesso

| Funcionalidade (iOS) | Endpoint | Web | Lacuna no backend | Status |
| --- | --- | --- | --- | --- |
| Boas-vindas só na 1ª abertura | — | `/welcome`, marca em `localStorage`; reabre em Ajustes › Como o Reveza funciona | — | ✅ |
| Criar conta (e-mail + senha), confirmar código, reenviar | Cognito `SignUp`, `ConfirmSignUp`, `ResendConfirmationCode` | `/signup` (passo do código na mesma tela; também no `/login` para conta não confirmada) pelo BFF | — | ✅ |
| Entrar com e-mail e senha | Cognito SRP | `/login` | — | ✅ |
| Entrar com a Apple | Cognito Hosted UI | aviso: conta Apple entra pelo iPhone | exigiria URL de retorno web no app client (fora, decisão do dono) | ⛔ |
| Esqueci a senha (código) | Cognito `ForgotPassword`, `ConfirmForgotPassword` | `/forgot-password` em 3 passos | — | ✅ |
| Trocar senha | Cognito `ChangePassword` | Ajustes › Conta | — | ✅ |
| Sair | Cognito `RevokeToken`; `DELETE /v1/me/devices` | apaga cookies e a inscrição de push | — | ✅ |
| Apagar conta | `DELETE /v1/me` | Ajustes › Conta, onboarding e erro da casa | — | ✅ |
| Nome do perfil | `POST /v1/me`, `PATCH /v1/me` | onboarding e Conta | — | ✅ |
| Foto do perfil | `POST`/`PUT`/`DELETE /v1/me/photo` + S3 | recorte quadrado 512 px JPEG no navegador, BFF faz o `PUT` | sem CORS no bucket: resolvido pelo BFF | ✅ |
| E-mail e "Entrou com" | ID token | cookie assinado com o e-mail | — | ✅ |

## Casa e onboarding

| Funcionalidade | Endpoint | Web | Lacuna | Status |
| --- | --- | --- | --- | --- |
| Portão da casa (carregando, erro, sem casa) | `GET /v1/me/house/snapshot` (fallback `GET /v1/me` + `/me/house`) | `/app` | — | ✅ |
| Perfil → criar ou entrar | `POST /v1/me`, `POST /v1/houses`, `POST /v1/houses/join` | onboarding em passos; fuso do navegador | — | ✅ |
| Primeiros cômodos (6 sugestões, 2 tarefas cada) | `POST /v1/houses/{id}/rooms`, `POST /v1/rooms/{id}/tasks` | igual ao iOS | — | ✅ |
| Convidar (código, compartilhar, copiar) | `house.accessCode` | código + link `/invite/{code}` (Web Share API ou copiar) | — | ✅ |
| Entrar por link de convite | `POST /v1/houses/join` | `/invite/{code}` preserva o destino no login/cadastro | — | ✅ |
| Ativar notificações | `PUT /v1/me/devices` | Web Push | rota com `kind: "web"` pronta no branch `web-push` (falta merge e deploy) | 🟡 |
| Renomear casa | `PATCH /v1/houses/{id}` | Ajustes da casa | — | ✅ |
| Moradores | `home.members` | Ajustes da casa | adicionar/remover outro morador não tem rota (o iOS também não oferece) | ✅ |
| Sair da casa (duas confirmações) | `DELETE /v1/me/house?confirm…` | diálogos para os dois `409` | — | ✅ |
| Reordenar cômodos (só na sessão) | — | botões subir/descer na sheet (acessível por teclado), ordem em `sessionStorage` | — | ✅ |

## Tarefas

| Funcionalidade | Endpoint | Web | Lacuna | Status |
| --- | --- | --- | --- | --- |
| Minhas tarefas: Repetição do cômodo, Repetição própria, Tarefas únicas | snapshot `myTasks` | `/app/tasks`, seções recolhíveis | — | ✅ |
| Concluir/reabrir (prévia otimista) | `POST /v1/occurrences/{id}/complete` · `/reopen` | igual | — | ✅ |
| Apagar (encerrar) recorrente | `POST /v1/rooms/{r}/tasks/{t}/end` | menu da linha | — | ✅ |
| Detalhe da tarefa (rodízio, detalhes) | snapshot / `GET /v1/rooms/{r}/tasks/{t}`, `GET /v1/rooms/{r}/tasks` | `/app/tasks/{taskDefinitionID}` | — | ✅ |
| Criar tarefa (sheet única) | `POST /v1/rooms/{r}/tasks` | mesma sheet no "+" de Minhas tarefas, Casa e Cômodo | — | ✅ |
| Editar tarefa | `PATCH /v1/rooms/{r}/tasks/{t}` | mesma sheet em modo edição | — | ✅ |
| Tarefas únicas: pegar/devolver em lote, editar, apagar | `/claim`, `/release`, `DELETE /v1/rooms/{r}/tasks/{t}` | sheet com ✓ e "Descartar alterações?" | — | ✅ |
| Sugestões de tarefa por categoria | catálogo do domínio | cópia gerada de `backend/src/domain/services/task-suggestion-catalog.ts` | — | ✅ |
| Selo com pendentes no ícone | — | Badging API no PWA instalado, com o número de avisos não lidos (o iOS mostra as pendentes) | — | 🟡 |

## Cômodos

| Funcionalidade | Endpoint | Web | Lacuna | Status |
| --- | --- | --- | --- | --- |
| Lista de cômodos (cards, progresso) | snapshot | `/app/house` | — | ✅ |
| Pedir/cancelar entrada em privado | `POST`/`DELETE /v1/rooms/{id}/access-requests` | card do cômodo | — | ✅ |
| Aprovar/recusar pedido | `…/access-requests/{userID}/approve` · `/deny` | Notificações e detalhe do cômodo | — | ✅ |
| Detalhe (Agora/Todas, ciclo, Agora/Depois) | snapshot `participations`, `roomTasks` | `/app/rooms/{id}` | — | ✅ |
| Entrar no cômodo / Sair do rodízio | `POST /v1/rooms/{id}/members`, `DELETE …/members/{me}` | igual, com "Sair e excluir" | — | ✅ |
| Criar/editar cômodo (ícone, cor, ciclo, pessoas, privado) | `POST /v1/houses/{id}/rooms`, `PATCH /v1/rooms/{id}` | sheet | — | ✅ |
| Excluir cômodo | `DELETE /v1/rooms/{id}?confirmDeletion=true` | confirmação | — | ✅ |

## Trocas, notificações, semana

| Funcionalidade | Endpoint | Web | Lacuna | Status |
| --- | --- | --- | --- | --- |
| Pedir troca (candidatas por esforço) | `GET /v1/occurrences/{id}/swap-candidates`, `POST /v1/swaps` | sheet | — | ✅ |
| Aceitar/recusar/cancelar | `POST /v1/swaps/{id}/accept` · `/reject` · `/cancel`, `GET /v1/me/swaps` | Notificações | — | ✅ |
| Notificações (Hoje/Ontem/data, não lidas) | `GET /v1/me/notifications`, `POST …/read` | `/app/notifications` | — | ✅ |
| Avaliar a semana | `GET /v1/me/ratings/pending`, `POST /v1/rooms/{id}/ratings` | card + sheet; "já enviada" em `localStorage` | — | ✅ |
| Resumo da semana | `GET /v1/me/ratings/summary` | card + sheet | — | ✅ |

## Ajustes

| Funcionalidade | Endpoint | Web | Lacuna | Status |
| --- | --- | --- | --- | --- |
| Modo férias | `GET`/`PUT`/`DELETE /v1/me/vacation` | Ajustes | — | ✅ |
| Preferências de push | `GET`/`PUT /v1/me/notification-preferences` | Ajustes › Notificações | — | ✅ |
| WhatsApp (conectar, status, desconectar) | `/v1/me/whatsapp*` | link `wa.me` aberto em nova aba, com copiar (sem QR) | — | ✅ |
| Ajuda e Sobre | — | Como funciona, Enviar sugestão (`mailto:`), privacidade, termos, versão | — | ✅ |

## Recursos do iOS sem equivalente direto

| iOS | Web | Status |
| --- | --- | --- |
| Push APNs | Web Push (VAPID) + service worker; iPhone só com PWA instalado | 🟡 web pronto; backend no branch `web-push`, falta merge, `terraform apply` e chaves VAPID |
| Resumo diário local | push diário do servidor só para aparelhos web (Ajustes › Notificações, hora no fuso da casa) | 🟡 backend no branch `web-push` |
| Aviso local de novo ciclo | push `cycleTurned` só para aparelhos web; aviso na lista | 🟡 backend no branch `web-push` |
| Widgets e tela bloqueada | sem widget na web; PWA instalável com selo e atalhos | ⛔ widget · ✅ PWA |
| Siri e Atalhos | atalhos do manifesto (Minhas tarefas, Nova tarefa, Notificações) | ✅ |
| Sincronizar com Lembretes | o app Lembretes é do iOS | ⛔ |
| Notificações ao chegar em casa | a web não monitora localização com a página fechada | ⛔ |
| App Clip | link de convite `/invite/{code}` | ✅ |
| Haptics | feedback visual | ⛔ (sem API no Safari) |
| Deep links `grupuxo://tasks/{id}` | URLs `/app/tasks/{id}` | ✅ |
