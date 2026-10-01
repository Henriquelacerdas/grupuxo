# Backend e integração com WhatsApp

Arquitetura do backend e do canal WhatsApp, alinhada com o desenvolvimento do banco. Status: **rascunho para revisão, com a primeira parte implementada** (webhook, worker e ports em `backend/`, sem banco nem AWS; ver seção 14). Decisões marcadas com ✅ já foram tomadas; as marcadas com ❓ estão em aberto (seção 12).

Documentos relacionados: [ARQUITETURA.md](ARQUITETURA.md) (app), [ALGORITMO.md](ALGORITMO.md) (contrato matemático), [PRODUTO.md](PRODUTO.md).

## 1. Objetivo e escopo

Hoje os dados do app vivem no `MockStore`, em memória, sem persistência. Já existe login (Amazon Cognito via Amplify, e-mail/senha e Sign in with Apple), mas ele só libera a interface: a sessão ainda usa o morador do `MockSeed`, e o app não fala com nenhum servidor de dados. Este documento define:

1. Um backend AWS que passa a ser a **fonte de verdade** dos dados.
2. Um canal WhatsApp que atua como **mais um cliente** desse backend.

**v1 do WhatsApp (✅): somente consulta.** Exemplo: "quais são minhas tarefas da semana?". Concluir tarefas ("acabei de limpar a sala"), lembretes proativos e trocas ficam para versões seguintes, mas o desenho já os comporta (seção 9).

Fora de escopo: avaliação da casa, widget, Siri, lista de mercado e financeiro (ver roadmap em PRODUTO.md).

## 2. Decisões

| # | Decisão | Motivo |
| --- | --- | --- |
| ✅ 1 | O cálculo da escala (Húngaro, justiça, replanejamento) roda **no servidor, em Swift**, reusando o `Domain/` do app | Uma única implementação. Se app e WhatsApp calculassem separados, divergiriam. Também permite concluir tarefas pelo WhatsApp sem o app aberto. |
| ✅ 2 | Banco: **Aurora PostgreSQL** | O modelo é relacional (casa → cômodos → tarefas → ocorrências) e a conclusão precisa de transação forte. |
| ✅ 3 | LLM: **Gemini**, via API REST com *function calling* | Escolha do time. |
| ✅ 4 | Vínculo do número: **link `wa.me` com token**, com código de verificação como plano B | Ver seção 8. |
| ✅ 5 | O LLM só **interpreta a intenção**; nunca grava dados nem calcula escala | Segurança e previsibilidade. Toda leitura e escrita passa pelos casos de uso. |
| ✅ 6 | Autenticação: **Amazon Cognito** (Amplify no app), com Apple como provedor federado | Já implementado no app (`Data/Auth/AuthService`, `amplify_outputs.json`, user pool em `us-east-1`). A `api` só valida o JWT do Cognito (seção 5). Confirmar com o time que é o caminho definitivo. |

## 3. Visão geral

```
┌─────────┐   HTTPS + JWT     ┌───────────────┐
│ App iOS │ ────────────────► │ API Gateway   │
└─────────┘                   │ (HTTP API)    │
                              └──────┬────────┘
                                     ▼
┌──────────┐  webhook   ┌────────────────────┐        ┌────────────────────┐
│ WhatsApp │ ─────────► │ Lambda "webhook"   │        │ Lambda "api" (Swift)│
│ (Meta)   │            │ valida assinatura  │        │ casos de uso        │
└──────────┘            │ e enfileira        │        └─────────┬──────────┘
      ▲                 └─────────┬──────────┘                  │
      │                           ▼                             ▼
      │                    ┌─────────────┐             ┌────────────────┐
      │                    │ SQS (FIFO)  │             │ Aurora          │
      │                    └──────┬──────┘             │ PostgreSQL      │
      │                           ▼                    │ (via RDS Proxy) │
      │                 ┌────────────────────┐         └────────────────┘
      └──────────────── │ Lambda "worker"    │ ◄──── lê/grava pelos mesmos
        Graph API       │ Gemini + casos de  │       casos de uso do domínio
                        │ uso                │
                        └────────────────────┘

Secrets Manager: segredos da Meta e do Gemini (seção 10)
```

Três Lambdas com responsabilidades separadas:

| Lambda | Responsabilidade | Observação |
| --- | --- | --- |
| `api` | Endpoints do app (seção 6) | Autenticada por JWT |
| `whatsapp-webhook` | Responde ao *challenge* (GET), valida a assinatura e enfileira (POST) | Sem dependência de domínio nem de LLM. Responde 200 em milissegundos. |
| `whatsapp-worker` | Consome a fila, resolve o usuário, chama Gemini, executa o caso de uso e responde | Idempotente por `wamid` |

O webhook nunca chama o LLM diretamente. A Meta reenvia o evento se não receber 200 rápido, e sem fila o mesmo pedido rodaria duas vezes.

### Estrutura de código

O `Domain/` do app não importa SwiftUI nem persistência, então virou um pacote local (✅ feito):

```
grupuxo/
  Packages/
    GrupuxoDomain/        entidades, repositórios (protocolos), casos de uso, serviços   ✅
  grupuxo/                app iOS (Presentation, App, Data/Mock, Data/Auth, Data/Remote)
backend/                  Swift Package; depende de GrupuxoDomain por caminho local
  Package.swift
  Sources/
    WhatsAppCore/         payload, assinatura, WebhookHandler, ports, WhatsAppWorker   ✅
    WhatsAppInMemory/     adaptadores em memória dos ports (dev e testes)              ✅
    Persistence/          repositórios PostgreSQL (implementam Domain e os ports)      a fazer
    ApiLambda/                                                                         a fazer
    WhatsAppWebhookLambda/  converte o evento do API Gateway em WebhookRequest         a fazer
    WhatsAppWorkerLambda/   converte o evento do SQS em IncomingMessage                a fazer
  Tests/WhatsAppCoreTests
  Dockerfile              verificação em Linux (build + testes do domínio e do backend)  ✅
  infra/                  IaC (AWS CDK, SAM ou Terraform ❓)                           a fazer
```

`WhatsAppCore` não conhece AWS: as Lambdas serão camadas finas (com `swift-aws-lambda-runtime`) que montam `WebhookRequest`/`IncomingMessage`, chamam o núcleo e traduzem a resposta. A dependência de criptografia é `swift-crypto`, que também compila em Linux (as Lambdas rodam lá). ✅ Verificado: `GrupuxoDomain` e `backend/` compilam e passam nos testes em Linux (seção 14).

Regra mantida: **nenhuma regra de negócio no backend fora do pacote de domínio**. As Lambdas só traduzem HTTP/WhatsApp em chamadas a casos de uso.

## 4. Modelo de dados (PostgreSQL)

Espelha as entidades do app. IDs são `uuid`, os mesmos que o app já usa. Datas em `timestamptz` (UTC).

| Tabela | Origem | Campos-chave |
| --- | --- | --- |
| `users` | `User` | `id`, `name`, `email`, `cognito_sub` (único; claim `sub` do JWT do Cognito), `created_at` |
| `houses` | `House` | `id`, `name`, `access_code` (único), `timezone`, `created_at` |
| `house_memberships` | `HouseMembership` | `house_id`, `user_id`, `joined_at`, `left_at` |
| `rooms` | `Room` | `id`, `house_id`, `name`, `visibility`, `periodicity` (n, x), `simultaneous_assignees`, `appearance`, `schedule_versions` |
| `room_memberships` | `RoomMembership` | `room_id`, `user_id`, `left_at`, `rotation_changes`, `fairness_debt` |
| `task_definitions` | `TaskDefinition` | `id`, `room_id`, `name`, `effort` (1–3), agenda, fila rotativa, `pending_rotation` |
| `task_occurrences` | `TaskOccurrence` | `id`, `task_definition_id`, `available_at`, `due_at`, `status`, `completed_at`, `completed_by`, `effort_snapshot`, `completion_debt_impacts` |
| `task_assignments` | `TaskAssignment` | `occurrence_id`, `user_id`, `assigned_at`, `ended_at`, `superseded_at` |
| `task_swap_requests` | `TaskSwapRequest` | `id`, ocorrências oferecida/pedida, `status` |
| `notifications` | `AppNotification` | `id`, `user_id`, payload, `read_at` |
| `absences` | `Absence` | `house_membership_id`, `[starts_at, ends_at)` |
| `whatsapp_links` | **novo** | `user_id`, `phone_e164` (único), `status`, `consented_at`, `linked_at` |
| `whatsapp_link_tokens` | **novo** | `token_hash`, `user_id`, `expires_at`, `used_at` |
| `whatsapp_inbox` | **novo** | `wamid` (PK), `received_at`, `processed_at` (idempotência e auditoria) |

Estruturas aninhadas (fila rotativa, versões de escala, `completion_debt_impacts`) podem ser `jsonb` na primeira versão; o desenvolvedor do banco decide o quanto normalizar. Restrições que o banco deve garantir:

- Invariantes do PRODUTO.md (toda tarefa tem `room_id`; `house_id` é derivado do cômodo, sem coluna duplicada nas tarefas).
- `phone_e164` único: um número, um morador.
- Alterar `task_definitions` nunca reescreve `task_occurrences` passadas.

### Concorrência e transações

Cada comando transacional do app (`create`, `complete`, `refreshSchedule`, `addMember`, `removeMember`) executa hoje **dentro** de `MockStore.update` (cópia, commit, rollback). No servidor, isso vira:

1. `BEGIN` com bloqueio por casa: `SELECT ... FROM houses WHERE id = $1 FOR UPDATE` (ou *advisory lock* por `house_id`). Mutações de escala são por casa, então o bloqueio não atrapalha casas diferentes.
2. Carregar o estado da casa, executar o serviço de domínio (puro, sem I/O) e gravar o resultado.
3. `COMMIT`. Qualquer erro causa `ROLLBACK`.

Conclusão e atribuição continuam **idempotentes**: repetir não duplica esforço nem `fairness_debt`. Isso é essencial porque o WhatsApp entrega *at-least-once*.

Custo de conexões: Lambda abre muitas conexões, então usar **RDS Proxy**. Para custo baixo em desenvolvimento, Aurora Serverless v2 com pausa automática (min. 0 ACU) ❓. O time está montando o banco em AWS e modelando no DBeaver/PostgreSQL; o contrato que o código do WhatsApp espera está na seção 14.

## 5. Autenticação

✅ O app usa **Amazon Cognito** via Amplify (`AuthService`): cadastro com confirmação por e-mail, login com e-mail/senha e Sign in with Apple pelo Hosted UI do Cognito (provedor `APPLE`, redirect `grupuxo://`).

1. O app autentica no Cognito e passa a ter tokens (o Amplify cuida de renovação).
2. Nas chamadas à API, envia o *access token* (ou ID token) no cabeçalho `Authorization: Bearer`.
3. A Lambda `api` valida o JWT contra o JWKS do user pool (assinatura, `iss`, `client_id`/`aud`, `token_use`, expiração). Sem endpoint `POST /v1/auth/apple`.
4. Na primeira chamada autenticada, cria ou recupera `users` por `cognito_sub` (ex. `POST /v1/me`, idempotente).

Usuários que entram com Apple e com e-mail/senha são contas distintas no Cognito, cada uma com seu `sub`. Vincular os dois (mesmo e-mail) exige configuração do pool e fica fora da v1 ❓.

Hoje `AppSession.currentUser` vem do `MockSeed`. Ligar a sessão ao usuário autenticado depende do passo 3 da seção 13.

**Autorização sempre no servidor.** A UI nunca é autoridade. Os casos de uso já recebem `userID` e aplicam `TaskEligibilityPolicy`; o `userID` vem do JWT (app) ou do vínculo do número (WhatsApp), **nunca de um campo enviado pelo cliente**.

## 6. API para o app

REST com JSON, sob `/v1`, autenticada por JWT. O app ganha `Data/Remote/` com repositórios que implementam os mesmos protocolos de `Domain/Repositories` (Views e Domain não mudam). DTOs e mapeadores ficam em `Data/Remote/`.

Um endpoint por ação de negócio, como os protocolos já fazem:

| Recurso | Endpoints (exemplo) |
| --- | --- |
| Casa | `POST /houses`, `POST /houses/join` (código de acesso), `GET /houses/{id}/members` |
| Cômodos | `GET /houses/{id}/rooms`, `POST /houses/{id}/rooms`, `POST/DELETE /rooms/{id}/members` |
| Tarefas | `GET /me/tasks`, `GET /rooms/{id}/tasks`, `POST /rooms/{id}/tasks` |
| Ocorrências | `POST /occurrences/{id}/complete`, `/reopen`, `/claim`, `/release` |
| Trocas | `GET/POST /swap-requests`, `POST /swap-requests/{id}/accept`, `/reject` |
| Notificações | `GET /notifications`, `POST /notifications/{id}/read` |
| Conta | `POST /me` (cria ou recupera o `users` do JWT) |
| WhatsApp | `POST /me/whatsapp/link` (gera token e link), `GET /me/whatsapp`, `DELETE /me/whatsapp` |

Todas as mutações aceitam `Idempotency-Key`. O `at` (data de referência) vem do **servidor**, não do dispositivo, para não depender do relógio do cliente.

Fuso: o mock usa o do dispositivo. No backend passa a ser **por casa** (`houses.timezone`), o que resolve a decisão aberta do PRODUTO.md e é necessário para "tarefas da semana" ter o mesmo significado no app e no WhatsApp.

### Sincronização do app

v1: o app consulta a API a cada abertura de tela e após mutações (já é o que os ViewModels fazem: "recarregar após mutações"). Sem *offline-first*. Notificações push (APNs) ficam para depois ❓.

## 7. Fluxo do WhatsApp

### 7.1 Webhook

Implementado em `WebhookHandler` (`backend/Sources/WhatsAppCore/Webhook`), com testes.

1. **GET** (verificação): responde `hub.challenge` se `hub.verify_token` confere com o segredo (comparação em tempo constante). Nunca registrar o token em log.
2. **POST** (evento):
   - Validar `X-Hub-Signature-256` (HMAC-SHA256 do corpo bruto com o **App Secret** da Meta). Assinatura inválida: 401, sem processar.
   - Ignorar eventos que não sejam mensagens de texto (os de `statuses`, como entregue e lido, chegam no mesmo webhook).
   - Enfileirar no SQS FIFO (`MessageGroupId` = telefone, `MessageDeduplicationId` = `wamid`) e responder 200 imediatamente.

### 7.2 Worker

Implementado em `WhatsAppWorker`; hoje responde com `EchoResponder` e ainda não faz o vínculo por token nem chama o Gemini.

```
mensagem ─► inserir wamid em whatsapp_inbox (se já existe: descartar)
        ─► resolver telefone → usuário (whatsapp_links)
              ├─ desconhecido: se for token de vínculo, vincular (seção 8);
              │                senão responder "Vincule seu número no app"
        ─► Gemini (function calling) interpreta a intenção
        ─► executa a ferramenta → caso de uso (leitura)
        ─► formata a resposta em português e envia pela Graph API
```

Ferramentas expostas ao Gemini na v1 (somente leitura, sem parâmetro de usuário: o `userID` é injetado pelo worker):

| Ferramenta | Caso de uso | Exemplo |
| --- | --- | --- |
| `list_my_tasks(range)` | `GetMyTasks` | "quais são minhas tarefas da semana?" |
| `list_room_tasks(room_name)` | `GetRoomTasks` | "o que tem na cozinha?" |
| `list_sporadic_tasks()` | `GetSporadicTasks` | "tem alguma tarefa avulsa?" |

Se o Gemini não reconhecer a intenção, responde com a lista do que sabe fazer. O texto final pode ser gerado pelo próprio modelo a partir do JSON retornado, mas os dados (nomes, datas) vêm sempre da ferramenta.

### 7.3 Segurança do LLM

- O texto da mensagem é **entrada não confiável**. O modelo não tem acesso a banco, segredos ou a outros usuários, só às ferramentas acima.
- Um usuário só consegue dados que ele já veria no app, porque o caso de uso aplica a elegibilidade.
- Limite de taxa por número e teto de tokens por resposta, para controlar custo.
- Não registrar o conteúdo das mensagens em log além do necessário (dados pessoais; ver seção 11).

## 8. Vínculo número ↔ morador

✅ **Link `wa.me` com token** (padrão). ❓ Plano B: código de verificação.

Por que o `wa.me` é mais barato: quando é o **usuário** quem envia a primeira mensagem, abre-se uma janela de atendimento de 24 h em que o negócio pode responder livremente. Já o código de verificação é uma mensagem iniciada pela empresa, que exige um *template* de autenticação aprovado e é cobrada por mensagem. (Conferir a tabela de preços vigente da Meta antes de fechar o orçamento.)

Fluxo:

1. No Perfil, o usuário toca em "Conectar WhatsApp". O app chama `POST /me/whatsapp/link`.
2. O backend cria um token aleatório de uso único (≥128 bits, validade curta, ex. 15 min; grava apenas o *hash*) e devolve `https://wa.me/<numero-do-bot>?text=<mensagem com token>`.
3. O app abre o link. O usuário envia a mensagem pré-preenchida.
4. O worker recebe a mensagem, encontra o token, grava `whatsapp_links(user_id, phone_e164, consented_at)`, marca o token como usado e confirma no chat.
5. O app passa a mostrar "WhatsApp conectado", com opção de desconectar.

Cuidados:

- O token só vale uma vez e expira. Sem token válido, um número desconhecido nunca é vinculado.
- Um número pertence a um único usuário. Tentar vincular um número já usado devolve erro.
- Consentimento: o texto da tela deve explicar o que o bot lê e envia; o envio do token pelo usuário registra o aceite.
- Se o dono trocar de número, basta desconectar e conectar de novo.

## 9. Evolução (fora da v1)

| Etapa | O que muda |
| --- | --- |
| Concluir tarefa | Nova ferramenta `complete_task(occurrence_id)` → `CompleteTask`. **Confirmação obrigatória** antes de gravar ("Marcar *Limpar sala* como feita?"), guardando o pedido pendente por curto tempo. Idempotente por `wamid`. |
| Lembretes | Mensagens iniciadas pelo bot fora da janela de 24 h exigem *template* aprovado, com custo. Usar um agendador (EventBridge Scheduler) que enfileira lembretes. Por isso o *opt-in* explícito é gravado desde a v1. |
| Trocas, assumir esporádica | Novas ferramentas sobre os casos de uso existentes. |

## 10. Segredos e infraestrutura

Um segredo no **AWS Secrets Manager** (ex. `grupuxo/whatsapp`), lido só pelas Lambdas `webhook` e `worker`:

| Chave | Origem |
| --- | --- |
| `WHATSAPP_TOKEN` | Token permanente de um *System User* no Business Manager da Meta |
| `WHATSAPP_APP_SECRET` | Segredo do app Meta (validação da assinatura) |
| `PHONE_NUMBER_ID` | Número do WhatsApp Business |
| `VERIFY_TOKEN` | "Senha" do webhook |
| `GEMINI_API_KEY` | Google AI Studio / Vertex |

Regras:

- Nada de segredos no repositório, em variáveis de ambiente em texto puro nem em log. As Lambdas leem o segredo uma vez por instância e mantêm em cache.
- **Menor privilégio:** cada role recebe apenas `secretsmanager:GetSecretValue` no ARN desse segredo. Evitar a política gerenciada `SecretsManagerReadWrite`, que dá escrita em todos os segredos da conta.
- Sem usuário IAM com chaves de acesso para as Lambdas: elas usam a role de execução. Pessoas acessam por IAM Identity Center.
- Aurora em subnets privadas; credenciais do banco no Secrets Manager (rotação gerenciada) e acesso via RDS Proxy.
- Ambientes separados (`dev`, `prod`), com números e apps Meta distintos.
- Observabilidade: CloudWatch Logs com retenção definida, alarmes para DLQ com mensagens e erros 5xx, *X-Ray* opcional.
- Fila com DLQ e novas tentativas limitadas; o worker é idempotente.

## 11. Privacidade e LGPD

Dados pessoais tratados: nome, e-mail, número de telefone e conteúdo das mensagens.

- Finalidade e consentimento explícitos no vínculo (seção 8).
- Direito de desconectar e apagar: `DELETE /me/whatsapp` remove o número; a exclusão da conta remove o usuário e os vínculos.
- Guardar o mínimo do conteúdo das mensagens (não persistir o texto; manter só `wamid` e horário para idempotência).
- Dados em `sa-east-1` (São Paulo) se a latência e a disponibilidade dos serviços permitirem ❓. O user pool do Cognito já está em `us-east-1`; se o banco ficar em outra região, os dados pessoais passam a existir nas duas.
- A Meta e a Google atuam como operadoras: revisar termos e transferência internacional.

## 12. Perguntas em aberto

Para o desenvolvedor do banco:

1. Quanto normalizar (`jsonb` para fila rotativa e versões de escala, ou tabelas próprias)?
2. Bloqueio por casa: `FOR UPDATE` em `houses` ou *advisory lock*?
3. Aurora Serverless v2 com pausa automática atende o custo do MVP?
4. Região do banco e das Lambdas: `sa-east-1` ou `us-east-1`? O Cognito já está em `us-east-1`, o que favorece manter tudo lá.
5. IaC: CDK, SAM ou Terraform?

Para o produto:

6. ~~Cognito ou validação própria do token da Apple?~~ Resolvido: Cognito (decisão ✅ 6). Falta decidir se contas Apple e e-mail/senha do mesmo morador podem ser unificadas.
7. Notificações push (APNs) entram antes ou depois do WhatsApp?
8. Qual modelo Gemini usar (custo × qualidade)? Deixar configurável por variável.
9. Um número de bot por ambiente ou um único número de produção?
10. O que acontece com o vínculo quando o morador sai da casa (desvincular automaticamente)?
11. Um morador pode estar em mais de uma casa? Os casos de uso pedem `houseID`; o worker precisa resolver usuário → casa antes de chamar o domínio.
12. Um morador tem no máximo um número vinculado (restrição `UNIQUE (user_id)` em `whatsapp_links`, assumida pelo código)? Confirmar com o desenvolvedor do banco.

## 13. Ordem de entrega sugerida

1. ✅ **Feito:** `GrupuxoDomain` extraído como Swift Package (`grupuxo/Packages/GrupuxoDomain`); o app continua funcionando com o mock.
2. Esquema PostgreSQL, repositórios de persistência e testes contra o mesmo conjunto de cenários do mock. *Em andamento pelo time (banco); os ports da seção 14 são parte do contrato.*
3. Lambda `api` e autenticação (login Cognito do app ✅; falta validar o JWT no servidor); `Data/Remote` no app (trocar mocks em `AppContainer`).
4. Vínculo do número (`wa.me`) e tela no Perfil. *Ports `LinkTokenStore` e `WhatsAppLinkStore` prontos; falta gerar/reconhecer o token, o endpoint e a tela.*
5. Webhook + fila + worker, primeiro só eco, depois Gemini com as ferramentas de leitura. *✅ Webhook, ports, worker e eco com adaptadores em memória; falta Lambda, SQS, Graph API e Gemini.*
6. Concluir tarefas com confirmação e, por fim, lembretes.

Os passos 1–3 e o esqueleto do webhook (passo 5, sem LLM) podem andar em paralelo.

## 14. Estado da implementação e contrato com o banco

Código em `backend/` (`swift test --package-path backend`). Tudo roda com adaptadores em memória; nada acessa AWS, PostgreSQL, Meta ou Gemini ainda.

| Peça | Onde | Situação |
| --- | --- | --- |
| Verificação (GET) e eventos (POST) do webhook | `WebhookHandler` | ✅ testado |
| Assinatura `X-Hub-Signature-256` (HMAC-SHA256, tempo constante, falha fechada com segredo vazio) | `SignatureVerifier` | ✅ testado, incluindo vetor gerado com `openssl` |
| Extração de mensagens de texto (ignora `statuses`, mídia e outros campos) | `WebhookPayload` | ✅ testado |
| Worker: idempotência por `wamid`, resolve número → morador, responde | `WhatsAppWorker` | ✅ com `EchoResponder` |
| Ports e adaptadores em memória | `Ports/`, `WhatsAppInMemory` | ✅ |
| Build e testes em Linux (`swift:6.3`, aarch64) | `backend/Dockerfile` | ✅ domínio (8 testes) e backend (28 testes) passam |
| Lambdas, SQS, Graph API, Secrets Manager | | a fazer |
| Vínculo por token (gerar, reconhecer, `POST /me/whatsapp/link`) | | a fazer (passo 4) |
| Gemini e ferramentas de leitura (`MessageResponder` definitivo) | | a fazer |
| Intervalo de datas ("da semana") em `GetMyTasksUseCase` | | a fazer no domínio, com o fuso da casa; hoje o caso de uso devolve todas |

### Verificação em Linux

As Lambdas rodam em Linux, então o domínio e o backend precisam compilar lá. O `backend/Dockerfile` usa `swift:6.3`, compila os dois pacotes e roda as duas suítes. O contexto do build é a **raiz do repositório** (o backend depende de `grupuxo/Packages/GrupuxoDomain` por caminho local):

```sh
docker build -f backend/Dockerfile -t grupuxo-backend .
docker run --rm grupuxo-backend
```

Sem Docker Desktop, `brew install colima docker && colima start` serve. Se o build falhar com `docker-credential-desktop: executable file not found`, o `~/.docker/config.json` aponta para um helper do Docker Desktop que não existe; remova `credsStore` desse arquivo (ou use um `DOCKER_CONFIG` temporário), pois a imagem base é pública.

Resultado: `GrupuxoDomain` compilou em Linux sem alterações. O único problema foi no backend: `SymmetricKey` do `swift-crypto` não é `Sendable` (o do CryptoKit é), então `SignatureVerifier` guarda o segredo como `Data` e cria a chave a cada validação. Testado em aarch64 (compatível com Lambda arm64/Graviton); x86_64 não foi testado.

### Comportamentos decididos na implementação

- Webhook: assinatura inválida ou ausente → 401; verificação com token/modo errado → 403; JSON inválido com assinatura válida → 400; falha ao enfileirar → 500 (a Meta reenvia; o SQS FIFO e a `whatsapp_inbox` deduplicam por `wamid`); método diferente de GET/POST → 405; qualquer evento válido sem mensagem de texto → 200 sem enfileirar.
- Telefone: a Meta envia só dígitos (`5511999998888`); o backend normaliza para E.164 (`+5511999998888`) antes de enfileirar e de consultar `whatsapp_links`. **Risco:** números brasileiros antigos podem chegar sem o nono dígito; se aparecer divergência entre o número do cadastro e o `from` da Meta, normalizar na entrada.
- Idempotência: `claim` devolve `claimed` para mensagem nova **ou registrada e ainda não processada** (o worker caiu no meio), e `duplicate` só depois de `markProcessed`. Assim uma falha não perde a mensagem. O custo é poder responder duas vezes se o envio funcionou e a marcação falhou; aceitável para leitura (na escrita, o caso de uso é idempotente).
- Número desconhecido: o worker responde "Vincule seu número no app" (texto em `WhatsAppWorker.unlinkedReply`). Nunca vincula sem token válido.

### Contrato dos ports com as tabelas

Quem implementar o PostgreSQL deve fazer cada port passar nos mesmos testes dos adaptadores em memória (`backend/Tests/WhatsAppCoreTests/InMemoryStoreTests.swift`).

| Port | Método | Tabela | SQL esperado |
| --- | --- | --- | --- |
| `InboxStore` | `claim(wamid:receivedAt:)` | `whatsapp_inbox` | `INSERT (wamid, received_at) ON CONFLICT (wamid) DO UPDATE SET wamid = EXCLUDED.wamid WHERE whatsapp_inbox.processed_at IS NULL RETURNING wamid` (1 linha = `claimed`; 0 = `duplicate`) |
| | `markProcessed(wamid:at:)` | | `UPDATE ... SET processed_at = $2 WHERE wamid = $1` |
| `WhatsAppLinkStore` | `link(forPhone:)`, `link(forUser:)` | `whatsapp_links` | `SELECT` por `phone_e164` ou `user_id` |
| | `create(_:)` | | `INSERT`; violação de `UNIQUE (phone_e164)` → `WhatsAppLinkError.phoneAlreadyLinked`; de `UNIQUE (user_id)` → `.userAlreadyLinked` |
| | `remove(forUser:)` | | `DELETE ... WHERE user_id = $1` (idempotente) |
| `LinkTokenStore` | `save(_:)` | `whatsapp_link_tokens` | `INSERT (token_hash, user_id, expires_at)` |
| | `consume(tokenHash:at:)` | | `UPDATE ... SET used_at = $2 WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2 RETURNING user_id` (atômico) |

Campos que o código usa em `whatsapp_links`: `user_id`, `phone_e164` (E.164 com `+`), `consented_at`, `linked_at`. A coluna `status` listada na seção 4 não é usada na v1: desvincular apaga a linha. Mantê-la só se o time quiser histórico.
