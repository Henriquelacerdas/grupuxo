# Backend e integração com WhatsApp

Arquitetura do backend e do canal WhatsApp. Status: **rascunho para revisão, com a primeira parte implementada** em Node.js + TypeScript (`backend/`): domínio e algoritmo portados do Swift, webhook, worker, vínculo por token, validação do JWT do Cognito, assistente Gemini, sender da Graph API, limite de taxa e handlers no formato Lambda, tudo com adaptadores em memória, sem DynamoDB nem AWS de verdade (ver seção 14). Decisões marcadas com ✅ já foram tomadas; as marcadas com ❓ estão em aberto (seção 12).

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
| ✅ 1 | O cálculo da escala (Húngaro, justiça, replanejamento) roda **no servidor, em TypeScript (Node.js)**. O domínio e o algoritmo foram portados do `GrupuxoDomain` Swift, que continua sendo a referência (e o domínio do app enquanto ele usar o mock) até o app consumir a API | O WhatsApp (e depois o Android) precisa da escala calculada com o app fechado, de forma transacional por casa, e não no cliente. Uma implementação única no servidor evita divergência entre canais. Um backend em Swift tende a dar mais problemas a longo prazo (ecossistema de servidor, deploy em Lambda, contratação). A equivalência com o Swift é provada por fixtures de referência (seção 14), não por confiança. |
| ✅ 2 | Banco: **Amazon DynamoDB**, tabela única, modo sob demanda (`PAY_PER_REQUEST`). Substitui o Aurora PostgreSQL (RDS) da versão anterior deste documento | **Custo mínimo**: sem cobrança por hora (nem ACU mínima, nem RDS Proxy), sem VPC (as Lambdas ficam fora de VPC, então sem NAT Gateway nem VPC endpoints), paga só por requisição e armazenamento. O domínio já trabalha por **agregado da casa** (carrega o estado, roda o comando puro, grava), o que cabe numa partição por casa com bloqueio otimista e `TransactWriteItems` (seção 4). As unicidades (número, `cognito_sub`, código de acesso) viram itens com escrita condicional. |
| ✅ 3 | LLM: **Gemini**, via API REST com *function calling* | Escolha do time. |
| ✅ 4 | Vínculo do número: **link `wa.me` com token**, com código de verificação como plano B | Ver seção 8. |
| ✅ 5 | O LLM só **interpreta a intenção**; nunca grava dados nem calcula escala | Segurança e previsibilidade. Toda leitura e escrita passa pelos casos de uso. |
| ✅ 6 | Autenticação: **Amazon Cognito** (Amplify no app), com Apple como provedor federado | Já implementado no app (`Data/Auth/AuthService`, `amplify_outputs.json`, user pool em `us-east-1`). A `api` só valida o **access token** do Cognito (seção 5); o ID token é rejeitado. Confirmar com o time que é o caminho definitivo. |
| ✅ 7 | Stack do backend: **Node.js 22 + TypeScript** (`strict`, ESM), **zero dependências de runtime** (`node:crypto`, `Intl`, `node:test`); sem Temporal, Luxon, zod, ORM nem container de DI | O básico bem feito: menos superfície de supply chain e de atualização, bundle de Lambda mínimo. Validação de entrada na borda por funções de estreitamento escritas à mão. |
| ✅ 8 | Infraestrutura como Código (IaC): **Terraform** | Padrão declarativo da indústria, reprodutibilidade de ambientes e controle de versão de toda a infraestrutura AWS (Lambdas com Function URL, SQS, DynamoDB, Secrets Manager). |
| ✅ 9 | Entrada HTTP: **URL pública da Lambda (Lambda Function URL)**, **sem API Gateway** | Menos um serviço para configurar, pagar e manter; a URL é gerada pela própria Lambda. Cada Lambda HTTP (`api`, `whatsapp-webhook`) tem a sua URL. A autenticação já é feita no código (JWT do Cognito na `api`, assinatura HMAC no webhook), então a URL fica com `AuthType = NONE`. O evento chega no mesmo formato 2.0 do HTTP API, e por isso `src/lambdas/events.ts` não muda. Consequências na seção 3.2. |

## 3. Visão geral

```
┌─────────┐ HTTPS + JWT  ┌─────────────────────┐        ┌─────────────────┐
│ App iOS │ ───────────► │ Lambda "api" (Node) │ ─────► │ DynamoDB        │
└─────────┘ (Function    │ casos de uso        │        │ (tabela única,  │
            URL)         └─────────────────────┘        │ sob demanda)    │
                                                        └────────┴────────┘
                                                                 │
┌──────────┐  webhook   ┌────────────────────┐                   │
│ WhatsApp │ ─────────► │ Lambda "webhook"   │                   │
│ (Meta)   │ (Function  │ valida assinatura  │                   │
└──────────┘  URL)      │ e enfileira        │                   │
      ▲                 └─────────┬──────────┘                   │
      │                           ▼                              │
      │                    ┌─────────────┐                       │
      │                    │ SQS (FIFO)  │                       │
      │                    └──────┬──────┘                       │
      │                           ▼                              │
      │                 ┌────────────────────┐                   │
      └──────────────── │ Lambda "worker"    │ ◄─────────────────┘
        Graph API       │ Gemini + casos de  │  lê/grava pelos mesmos
                        │ uso                │  casos de uso do domínio
                        └────────────────────┘

Secrets Manager: segredos da Meta e do Gemini (seção 10)
Sem VPC: as Lambdas falam com o DynamoDB pelo endpoint público da AWS, autenticadas pela role (IAM)
```

Três Lambdas com responsabilidades separadas:

| Lambda | Responsabilidade | Observação |
| --- | --- | --- |
| `api` | Endpoints do app (seção 6) | Function URL pública; autenticada por JWT na própria Lambda |
| `whatsapp-webhook` | Responde ao *challenge* (GET), valida a assinatura e enfileira (POST) | Function URL pública (é a URL cadastrada na Meta). Sem dependência de domínio nem de LLM. Responde 200 em milissegundos. |
| `whatsapp-worker` | Consome a fila, resolve o usuário, chama Gemini, executa o caso de uso e responde | Idempotente por `wamid` |

O webhook nunca chama o LLM diretamente. A Meta reenvia o evento se não receber 200 rápido, e sem fila o mesmo pedido rodaria duas vezes.

### Estrutura de código

O `GrupuxoDomain` Swift (pacote local do app) continua existindo e é a referência do algoritmo; o backend tem o seu próprio domínio em TypeScript, verificado contra ele:

```
grupuxo/
  Packages/GrupuxoDomain/   domínio Swift: domínio do app e referência das fixtures      ✅
  grupuxo/                  app iOS (Presentation, App, Data/Mock, Data/Auth, Data/Remote)
backend/                 projeto Node.js + TypeScript (zero dependências de runtime)
  src/domain/               port do GrupuxoDomain: entidades, value objects, repositórios
                            (interfaces), services (algoritmo), commands, use-cases, dates.ts   ✅
  src/whatsapp/             webhook (payload, assinatura, handler), worker, vínculo por token
                            (linking/) e ports (ports.ts)                                       ✅
  src/auth/                 validação do JWT do Cognito (TokenVerifier, JWKS) e UserDirectory   ✅
  src/http.ts               tipo HttpFetch: HTTP de saída injetável (JWKS, Gemini, Graph API)    ✅
  src/assistant/            Gemini: GeminiClient, ferramentas de leitura e GeminiMessageResponder ✅ (em memória/falso; sem chamada real)
  src/whatsapp/graph-sender.ts  WhatsAppSender real (Graph API), com HttpFetch injetado          ✅ (testado com falso; sem chamada real)
  src/adapters/in-memory/   store transacional, repositórios, ports do WhatsApp e seed (dev/testes) ✅
  src/adapters/aws/         SqsMessageQueue e SecretStringReader sobre clientes mínimos injetados     ✅ (cliente falso; sem chamada real)
  src/adapters/dynamodb/    repositórios DynamoDB (implementam as interfaces do domínio e os ports)    a fazer
  src/lambdas/              handlers webhook, worker e api, conversão de eventos (Function URL, payload 2.0,
                            SQS), config.ts (ambiente e segredos) e compose.ts (composição)           ✅ (sem ponto de entrada: ver 3.1)
  test/                     testes; contract/ (contratos dos ports); fixtures/ (casos dourados do Swift)  ✅
  tools/swift-fixtures/     gerador das fixtures a partir do GrupuxoDomain (Swift)                    ✅
  infra/                    IaC com Terraform (módulos, Lambdas + Function URLs, SQS, DynamoDB)        a fazer
```

`src/whatsapp/`, `src/auth/` e `src/domain/` não conhecem AWS: as Lambdas são camadas finas (`src/lambdas/`) que montam `WebhookRequest`/`IncomingMessage`, chamam o núcleo e traduzem a resposta. Empacotamento das Lambdas (esbuild ou `tsc` com `rewriteRelativeImportExtensions`) é decisão de infraestrutura ❓.

### 3.1 Lambdas (`src/lambdas/`)

São funções de fábrica `create…Handler(dependências) => (evento: unknown) => Promise<resposta>`; nada lê `process.env`, relógio ou rede (o teste de arquitetura verifica). O que **ainda não existe** e depende de decisões abertas (empacotamento, perguntas 13 e 14; AWS SDK): o **ponto de entrada** de cada Lambda, que lê `process.env`, embrulha o AWS SDK nos clientes mínimos de `src/adapters/aws/clients.ts` (`SqsClient`, `SecretsManagerClient`), cria o `SqsMessageQueue` e o `SecretStringReader` (a busca do segredo e o `parse…Secrets` são feitos aqui) e o cliente do DynamoDB, e passa tudo às funções abaixo.

**Adaptadores AWS (`src/adapters/aws/`)**, sem o AWS SDK (o teste de arquitetura proíbe `node:*`, `process`, relógio, `fetch` e `@aws-sdk`):

- `SqsMessageQueue` (`MessageQueue`): corpo JSON com exatamente os quatro campos de `IncomingMessage` (o que `parseIncomingMessage` lê no worker), `MessageGroupId` = telefone, `MessageDeduplicationId` = `wamid`. Sem `QUEUE_URL` a criação falha (`LambdaConfigError`). `wamid` ou telefone fora das regras de ID do FIFO (1–128 caracteres ASCII alfanuméricos ou de pontuação) não são enviados (`MessageQueueError` `invalidMessage`). Qualquer falha do cliente vira `MessageQueueError` `sendFailed`, com mensagem fixa (sem texto, telefone, `wamid`, URL nem mensagem original; só o `name` do erro original em `causeName`), e propaga: o webhook responde 500 e a Meta reenvia. A fila precisa ter `ContentBasedDeduplication` desligada (a deduplicação é pelo `wamid`).
- `SecretStringReader`: lê o `SecretString` uma vez por instância (a promessa fica em cache, então chamadas concorrentes compartilham a busca); **falha não é cacheada**. `SecretReadError` (`readFailed`, `noSecretString`) tem mensagem fixa, sem ID do segredo nem conteúdo. Sem `SECRET_ID` a criação falha.
- Testes: `test/contract/message-queue.ts` (rodado contra a fila em memória e o `SqsMessageQueue` com cliente falso), `test/adapters/`. Nada foi chamado na AWS.

| Arquivo | Função |
| --- | --- |
| `events.ts` | Estreitamento (de `unknown`, sem `as`) dos eventos das Lambda Function URLs (payload 2.0, idêntico ao do HTTP API v2) e do SQS. Corpo `isBase64Encoded` é decodificado para os **bytes brutos** (a assinatura do webhook cobre esses bytes); corpo em texto vira UTF-8 exato; base64 mal formado invalida o evento. A query string é lida de `rawQueryString` (decodificada com `URLSearchParams`; vale a primeira ocorrência), com `queryStringParameters` só como reserva. Cabeçalhos em minúsculo. |
| `webhook.ts` | `createWebhookHandler(WebhookHandler)`: evento → `WebhookRequest` → resposta (`text/plain`). Evento que não é HTTP: 400. |
| `worker.ts` | `createWorkerHandler(WhatsAppWorker)`: cada registro do SQS → `JSON.parse` → `parseIncomingMessage` → `WhatsAppWorker.process`. Devolve `batchItemFailures` (a fila precisa de `ReportBatchItemFailures`): o registro que falha (inclusive corpo inválido) e **os seguintes do mesmo `MessageGroupId`** são reportados sem serem processados, para manter a ordem por telefone; outros telefones seguem. Evento que não é um lote do SQS lança erro. |
| `api.ts` | `createApiHandler({ verifier, users, linker, links })`: rotas da seção 6.1. |
| `config.ts` | `parseWorkerSettings`, `parseApiSettings` (variáveis de ambiente) e `parseWebhookSecrets`/`parseWorkerSecrets` (o `SecretString` do segredo, JSON com as chaves da seção 10). Nada tem valor padrão escondido; o erro nomeia a variável, nunca o valor. |
| `compose.ts` | `composeWhatsAppWorker` (`WhatsAppWorker` + `GeminiMessageResponder` + `GraphWhatsAppSender` + `MessageRateLimiter`, falha fechada na criação) e `composeCognitoVerifier` (`CognitoJwtVerifier` + `HttpJwksSource`). |

Variáveis de ambiente: **worker** `GEMINI_MODEL`, `WHATSAPP_GRAPH_VERSION`, `RATE_LIMIT_MAX_MESSAGES`, `RATE_LIMIT_WINDOW_SECONDS` (sugestão inicial: 10 mensagens por 60 s); **api** `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `BOT_PHONE_NUMBER`; **api e worker** `TABLE_NAME` (nome da tabela DynamoDB do ambiente; ainda não lida por `config.ts`, entra junto com o adaptador). Segredos (Secrets Manager, seção 10): **webhook** `VERIFY_TOKEN` e `WHATSAPP_APP_SECRET`; **worker** `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID` e `GEMINI_API_KEY`.

Regras mantidas:

- **Nenhuma regra de negócio no backend fora de `src/domain/`.** As Lambdas e `src/whatsapp/` só traduzem HTTP/WhatsApp em chamadas a casos de uso e comandos.
- **`src/domain/` é puro**: sem `node:*`, sem I/O, sem relógio nem gerador de IDs globais (`now` e `newID` são injetados). Um teste de arquitetura (`test/architecture.test.ts`) verifica isso.
- **Camadas de `src/`** (também no teste de arquitetura): `domain` só importa `domain`; `whatsapp` só `ids`, `dates` do domínio e `http.ts`; `auth` só `ids`/`dates` e `http.ts` (pode usar `node:crypto`); `assistant` pode importar o domínio e os ports do WhatsApp, mas não usa `node:*`; `adapters` e `lambdas` são raízes de composição. `auth`, `assistant` e `whatsapp` não usam relógio, aleatoriedade, `process` nem `fetch` globais, e `lambdas` também não usa `node:*` nem `process`: tudo entra por parâmetro (o ponto de entrada de cada Lambda, que lerá o ambiente, ainda não existe).
- **A lógica transacional vive em `src/domain/commands/`** (o que no app está dentro dos `Mock*Repository`: acesso, claim/release, trocas, entrada/saída de casa). O adaptador só chama `store.update(estado => comando(...))`; o adaptador DynamoDB carrega a partição da casa, chama o mesmo comando e grava a diferença numa transação condicional, sem reimplementar regras (seção 4).

### 3.2 Entrada HTTP: Lambda Function URL (sem API Gateway)

✅ Decisão 9. Cada Lambda HTTP recebe uma URL própria (`https://<id>.lambda-url.<região>.on.aws/`), criada no Terraform com `aws_lambda_function_url`. Uma URL por Lambda: a `api` e a `whatsapp-webhook` não compartilham endereço. A `worker` não tem URL, pois só lê do SQS.

| Ponto | Como fica |
| --- | --- |
| Formato do evento | Payload 2.0, o mesmo do HTTP API v2: `events.ts`, `webhook.ts` e `api.ts` funcionam sem mudança de código. |
| Autenticação da URL | `AuthType = NONE` (qualquer um alcança a URL). A defesa está no código: JWT do Cognito na `api` (seção 5) e HMAC `X-Hub-Signature-256` no webhook (seção 7.1). Não usar `AWS_IAM`: nem o app nem a Meta assinam com SigV4. |
| Permissão de invocação | `AuthType = NONE` exige a permissão pública `lambda:InvokeFunctionUrl` com `function_url_auth_type = NONE` (`aws_lambda_permission`). Contas novas também podem precisar de `lambda:InvokeFunction` com a condição `lambda:InvokedViaFunctionUrl`: conferir a documentação vigente no deploy. |
| Rotas | A URL não tem *stage* nem mapeamento de rotas: `rawPath` é exatamente o caminho pedido (`/v1/me`), e o roteamento continua em `api.ts`. O app guarda a URL base da `api` na configuração por ambiente. |
| URL cadastrada na Meta | A URL da `whatsapp-webhook`. A Meta faz o GET de verificação e o POST de eventos nela. |
| Limitação de taxa e abuso | Não existe *throttling* por rota nem plano de uso como no API Gateway. Mitigações: **concorrência reservada** em cada Lambda (teto de custo e de carga no banco; no modo sob demanda, cada requisição ao DynamoDB é cobrada, então esse teto também limita a conta), assinatura validada **antes** de qualquer trabalho no webhook, token validado antes de tocar no banco na `api`, e o limite por telefone do worker (seção 7.3). Se o abuso virar problema, o caminho é pôr o CloudFront com AWS WAF na frente da URL (fora da v1). |
| Domínio próprio | Sem domínio personalizado na v1: a URL gerada serve. Domínio próprio exigiria CloudFront. |
| CORS | O app iOS não precisa. Só configurar `cors` na URL se um cliente web passar a existir. |
| Tamanho | Corpo de requisição e de resposta de até 6 MB (síncrono). Folgado para esta API. |
| Logs | Sem *access log* do gateway. Registrar na Lambda só o que já é permitido (nunca token, texto de mensagem ou telefone). |

## 4. Modelo de dados (DynamoDB)

✅ Decisão 2. **Uma tabela por ambiente** (`grupuxo-dev`, `grupuxo-prod`), modo **sob demanda** (`PAY_PER_REQUEST`), chave primária composta `PK` + `SK` (strings), um índice global `GSI1` (`GSI1PK`, `GSI1SK`, projeção `ALL`) e **TTL** no atributo `ttl` (época Unix em **segundos**). Espelha as entidades do domínio TypeScript: IDs são os UUIDs (texto em minúsculo) que o app já usa; instantes são números em **milissegundos** desde a época Unix, o mesmo `Instant` do código (só o `ttl` é em segundos, exigência do DynamoDB). Estruturas aninhadas (fila rotativa, `scheduleVersions`, `pendingRotation`, `completionDebtImpacts`, `rotationChanges`) ficam como listas e mapas dentro do próprio item, sem tabela auxiliar.

**Agregado da casa.** Tudo o que um comando transacional lê e grava mora na mesma partição `HOUSE#<houseId>`, para ser carregado com uma única `Query`:

| Entidade | `PK` | `SK` | `GSI1PK` / `GSI1SK` | Atributos principais |
| --- | --- | --- | --- | --- |
| `House` | `HOUSE#<houseId>` | `META` | | `name`, `accessCode`, `timezone` (IANA), `createdAt`, **`version`** (número; bloqueio otimista) |
| `HouseMembership` | `HOUSE#<houseId>` | `MEMBER#<id>` | `USER#<userId>` / `HOUSE#<houseId>` | `userID`, `joinedAt`, `leftAt` |
| `Room` | `HOUSE#<houseId>` | `ROOM#<id>` | | `name`, `kind`, `category`, `visibility`, `periodicity`, `responsibleCount`, `calendarAnchor`, `scheduleVersions`, `icon`, `color` |
| `RoomMembership` | `HOUSE#<houseId>` | `ROOMMEMBER#<id>` | | `roomID`, `userID`, `fairnessDebt`, `leftAt`, `rotationChanges` |
| `TaskDefinition` | `HOUSE#<houseId>` | `TASKDEF#<id>` | | `roomID`, `name`, `details`, `effort` (1–3), `kind`, `recurrence`, `assignmentPolicy`, `rotationQueue`, `currentRotationIndex`, `nextScheduledAt`, `pendingRotation`, `calendarAnchor` |
| `TaskOccurrence` | `HOUSE#<houseId>` | `OCC#<id>` | | `taskDefinitionID`, `availableAt`, `dueAt`, `status`, `completedAt`, `completedByUserID`, `completionDebtImpacts`, `didPublishSuccessor`, `effortSnapshot` |
| `TaskAssignment` | `HOUSE#<houseId>` | `ASSIGN#<id>` | | `occurrenceID`, `userID`, `assignedAt`, `endedAt`, `supersededAt` |
| `TaskSwapRequest` | `HOUSE#<houseId>` | `SWAP#<id>` | | `requesterID`, `receiverID`, ocorrências oferecida/pedida, `status`, `createdAt`, `resolvedAt` |
| `AppNotification` | `HOUSE#<houseId>` | `NOTIF#<id>` | `USER#<recipientUserId>` / `NOTIF#<createdAt>#<id>` | `kind`, `swapRequestID`, `createdAt`, `readAt` |
| `Absence` | `HOUSE#<houseId>` | `ABSENCE#<id>` | | `membershipID`, `startsAt`, `endsAt`, `reason` |

**Itens globais** (fora da partição da casa):

| Item | `PK` | `SK` | Atributos | Para quê |
| --- | --- | --- | --- | --- |
| Perfil do morador (`User`) | `USER#<userId>` | `PROFILE` | `name`, `email`, `cognitoSub` (opcional), `createdAt` | Moradores de várias casas; carregado por `BatchGetItem` junto com a casa |
| Unicidade do Cognito | `COGNITO#<sub>` | `COGNITO` | `userID` | `UserDirectory`: `sub` → morador, único (seção 5) |
| Unicidade do código de acesso | `ACCESSCODE#<code>` | `ACCESSCODE` | `houseID` | Entrar na casa pelo código; criado na mesma transação da casa |
| Vínculo do WhatsApp (por número) | `PHONE#<e164>` | `LINK` | `userID`, `consentedAt`, `linkedAt` | `linkForPhone`; um número, um morador |
| Vínculo do WhatsApp (por morador) | `USER#<userId>` | `WHATSAPP` | `phoneE164`, `consentedAt`, `linkedAt` | `linkForUser`; um morador, um número |
| Token de vínculo | `LINKTOKEN#<sha256>` | `LINKTOKEN` | `userID`, `expiresAt`, `usedAt`, `ttl` | Uso único (seção 8); o TTL apaga os vencidos |
| Caixa de entrada | `WAMID#<wamid>` | `INBOX` | `receivedAt`, `processedAt`, `ttl` | Idempotência do worker (seção 7.2); só `wamid` e horários |
| Contador do limite de taxa | `RATE#<telefone ou hash>` | `<windowStart>` | `count`, `ttl` | `RateCounter` (seção 7.3); o TTL apaga as janelas antigas |

Padrões de acesso:

| Pergunta | Operação |
| --- | --- |
| Estado inteiro de uma casa (`StoreState`) | `Query PK = HOUSE#<id>` com `ConsistentRead` (paginado) + `BatchGetItem` dos `USER#<id>/PROFILE` dos membros |
| Casas de um morador (`houses(userID)`) | `Query GSI1 GSI1PK = USER#<id>` com `begins_with(GSI1SK, "HOUSE#")` |
| Notificações de um morador | `Query GSI1 GSI1PK = USER#<id>` com `begins_with(GSI1SK, "NOTIF#")`, mais recentes primeiro |
| Casa pelo código de acesso | `GetItem ACCESSCODE#<code>` |
| Morador pelo `sub` do Cognito | `GetItem COGNITO#<sub>` |

Restrições que o modelo garante (no DynamoDB não há `UNIQUE` nem `FOREIGN KEY`; tudo vira **escrita condicional**):

- Invariantes do PRODUTO.md (toda tarefa tem `roomID`; a casa é derivada da partição, sem atributo duplicado nas tarefas). A integridade referencial é responsabilidade dos comandos de domínio, que já a verificam.
- Número único (um número, um morador) e um número por morador: `Put` de `PHONE#` e de `USER#/WHATSAPP` na mesma transação, ambos com `attribute_not_exists(PK)`.
- `cognitoSub` e `accessCode` únicos: itens `COGNITO#` e `ACCESSCODE#` com `attribute_not_exists(PK)`.
- Validação na escrita (o DynamoDB não tem `NOT NULL` nem `CHECK`): `timezone` da casa é um fuso IANA válido (senão o caso de uso falha fechado, `invalidDateInterval`); `phoneE164` casa com `^\+[1-9][0-9]{7,14}$`; `name` do morador de 1 a 80 caracteres. O adaptador valida antes de gravar, e o domínio não confia em item lido sem estreitar o tipo (sem `as`).
- Alterar uma `TaskDefinition` nunca reescreve `TaskOccurrence` passadas (regra do domínio; o adaptador só grava o que o comando mudou).

### Concorrência e transações

Cada comando transacional (`create`, `complete`, `refreshSchedule`, `addMember`, `removeMember`) executa hoje **dentro** de `MockStore.update` no app e de `InMemoryStore.update` no backend (cópia, commit, rollback; testes de rollback e concorrência). No DynamoDB isso vira **bloqueio otimista por casa**:

1. Carregar a partição da casa (`Query` consistente) e os perfis dos membros; montar o `StoreState` e guardar o `version` lido do item `META`.
2. Executar o comando de domínio (`src/domain/commands/`, puro e síncrono, sem I/O) sobre uma cópia, exatamente como no `InMemoryStore.update`.
3. Calcular a diferença entre o estado lido e o novo: itens novos ou alterados viram `Put`, itens removidos viram `Delete`. Se não houver diferença, **nada é gravado** (uma consulta que chama `refreshSchedule` sem materializar nada continua sendo só leitura).
4. Gravar tudo num único `TransactWriteItems`, com um `Update` no `META` condicionado a `version = :lido` (e `SET version = version + 1`). Se outro pedido gravou a casa no meio, a transação é cancelada (`TransactionCanceledException` com `ConditionalCheckFailed`), nada é aplicado e o adaptador **recarrega e repete** (até 3 tentativas com *jitter*); esgotadas, o erro propaga (a `api` responde 500/409 e o SQS tenta de novo). Qualquer outro erro também não aplica nada.

Mutações de escala são por casa, então o conflito nunca envolve casas diferentes. Conclusão e atribuição continuam **idempotentes**: repetir não duplica esforço nem `fairnessDebt`. Isso é essencial porque o WhatsApp entrega *at-least-once* e porque o bloqueio otimista repete o comando.

Limites do DynamoDB a respeitar no adaptador:

- `TransactWriteItems` aceita **até 100 ações e 4 MB** por chamada. Um comando que gere mais (por exemplo, `refreshSchedule` de uma casa parada há muitas semanas) deve **falhar fechado** com erro explícito, nunca gravar em partes. Medir com casas reais ❓ (pergunta 1 da seção 12).
- Item de no máximo 400 KB: folgado, porque cada entidade é um item.
- A `Query` da casa lê o histórico inteiro de ocorrências; o custo cresce com o tempo. Na v1 isso é barato (leituras são cobradas por 4 KB); se pesar, arquivar ocorrências antigas concluídas numa partição `HOUSEARCHIVE#<id>` ❓.
- O GSI é eventualmente consistente: `houses(userID)` logo depois de entrar numa casa pode demorar frações de segundo. Nada transacional depende do GSI.

Sem conexões persistentes: o SDK usa HTTPS com *keep-alive*, então não existe pool de conexões nem proxy. Fuso: o `timezone` (IANA) do item `META` é lido na carga do estado e define o calendário do serviço de agendamento. O contrato que o código do WhatsApp espera está na seção 14.

## 5. Autenticação

✅ O app usa **Amazon Cognito** via Amplify (`AuthService`): cadastro com confirmação por e-mail, login com e-mail/senha e Sign in with Apple pelo Hosted UI do Cognito (provedor `APPLE`, redirect `grupuxo://`).

1. O app autentica no Cognito e passa a ter tokens (o Amplify cuida de renovação).
2. Nas chamadas à API, envia o **access token** no cabeçalho `Authorization: Bearer`. O ID token **não é aceito**: o `token_use` do access token é `access`, ele carrega `client_id` (e não `aud`) e não expõe dados do perfil.
3. A Lambda `api` valida o JWT com `CognitoJwtVerifier` (`src/auth/`), contra o JWKS do user pool. Sem endpoint `POST /v1/auth/apple`.
4. Na primeira chamada autenticada, o app chama `POST /v1/me` com o `name`; o `UserDirectory.ensureUser` cria ou recupera o morador por `cognitoSub` (idempotente). As demais rotas resolvem o morador com `UserDirectory.userForSub` (conta que ainda não passou pelo `POST /me` → 403/404, decisão da Lambda `api`).

### Validação do token (`src/auth/`)

`TokenVerifier.verify(token)` devolve `{ cognitoSub }` ou falha. **Falha sempre fechada**: nenhum caminho aceita um token que não passou em todas as regras. A assinatura é conferida antes de qualquer claim.

| Regra | Detalhe |
| --- | --- |
| Estrutura | Exatamente 3 segmentos base64url não vazios (alfabeto estrito), cabeçalho e payload são objetos JSON, UTF-8 válido, no máximo 8192 caracteres |
| Algoritmo | Só `RS256`. `none`, HS256 (inclusive o ataque que usa a chave pública como segredo), RS384 e variações de caixa são recusados antes de qualquer chave ser consultada; cabeçalho com `crit` também |
| Chave | `kid` do cabeçalho tem de existir no JWKS do pool (`createPublicKey({ format: "jwk" })`, RSA de pelo menos 2048 bits; chaves de outro tipo, `use` ≠ `sig` ou `alg` ≠ `RS256` são ignoradas) |
| `iss` | Exatamente `https://cognito-idp.<região>.amazonaws.com/<pool>` (região derivada do ID do pool) |
| `token_use` | Dentro de `acceptedTokenUse`, hoje só `["access"]` (configuração do verificador; qualquer outro valor é erro de configuração) |
| `client_id` | Igual ao `user_pool_client_id` configurado. **Nunca se consulta `aud`** |
| `exp` / `nbf` | Relógio injetado, tolerância de 30 s (configurável, máximo 300 s). `exp` é obrigatório; `nbf` é opcional, mas se vier tem de ser um número válido |
| `sub` | Obrigatório, de 1 a 128 caracteres ASCII visíveis |

Chaves (`JwksSource`): `HttpJwksSource` busca `<issuer>/.well-known/jwks.json` por HTTPS com `fetch` injetado (tempo limite de 5 s, corpo de até 64 KB, mensagens de erro sem o corpo). O cache vale 1 hora; um `kid` desconhecido provoca nova busca (rotação), **no máximo uma a cada 10 s**, para que tokens forjados com `kid` aleatório não virem requisições ao Cognito; buscas simultâneas são unificadas. Sem nenhum conjunto de chaves válido, o erro é `TokenVerifierUnavailableError` (a `api` responde 503, não 401); com o cache vigente, uma busca que falha só deixa aquele `kid` desconhecido.

Erros: `AuthenticationError` tem mensagem fixa (`Não autorizado`), nunca contém o token e carrega um `reason` interno (para teste e telemetria); a resposta ao cliente é só 401, sem o motivo. **Nunca registrar o token em log.**

Configuração (valores públicos, sem segredo; estão em `grupuxo/grupuxo/amplify_outputs.json`): `userPoolID` (`user_pool_id`) e `clientID` (`user_pool_client_id`). Por ambiente, vêm de variáveis de ambiente da Lambda lidas na composição (`src/lambdas/`), não do domínio.

`UserDirectory` (`src/auth/user-directory.ts`): `userForSub(cognitoSub)` e `ensureUser(cognitoSub, { name })`. O `name` vem do app (`parseProfileName`: sem espaços nas pontas, 1 a 80 caracteres, sem controle); numa conta que já existe ele só é validado e **não sobrescreve** o nome. Adaptador em memória: `src/adapters/in-memory/user-directory.ts`. Teste de contrato reutilizável (inclusive concorrência no `ensureUser`): `test/contract/user-directory.ts`; o adaptador DynamoDB (`TransactWriteItems` com `Put` condicional em `COGNITO#<sub>` e, se perder a corrida, `GetItem` consistente; seção 4) tem de passar nele.

Do lado do app (pendente, `Data/Remote`): enviar o access token do Amplify (`fetchAuthSession()` → `tokens.accessToken`), não o ID token.

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
| Conta | `POST /me` (cria ou recupera o morador do JWT) |
| WhatsApp | `POST /me/whatsapp/link` (gera token e link), `GET /me/whatsapp`, `DELETE /me/whatsapp` |

Todas as mutações aceitam `Idempotency-Key`. O `at` (data de referência) vem do **servidor**, não do dispositivo, para não depender do relógio do cliente.

Fuso: o mock usa o do dispositivo. No backend passa a ser **por casa** (`House.timezone`, atributo do item `META`), o que resolve a decisão aberta do PRODUTO.md e é necessário para "tarefas da semana" ter o mesmo significado no app e no WhatsApp.

### 6.1 Rotas implementadas (`src/lambdas/api.ts`)

Só as quatro de conta e WhatsApp, sob `/v1`; as demais da tabela dependem dos repositórios DynamoDB. A autorização é feita na Lambda (a Function URL fica com `AuthType = NONE`): `Authorization: Bearer <access token>` (esquema sem distinção de caixa). O `userID` vem sempre do token (via `UserDirectory`), nunca do corpo ou da URL.

| Rota | Resposta |
| --- | --- |
| `POST /v1/me` | Corpo JSON `{ "name": "…" }` (até 4 KB; `parseProfileName`) → `200 { "id" }` (idempotente; não sobrescreve o nome de conta existente). Nome ou corpo inválido → `400 invalid_name`. |
| `POST /v1/me/whatsapp/link` | `200 { "url", "expiresAt" (ISO 8601) }` com o link `wa.me`; número já conectado → `409 already_linked`. |
| `GET /v1/me/whatsapp` | `200 { "linked": false }` ou `{ "linked": true, "phone": "+55•••••••8888", "linkedAt" }` (telefone mascarado). |
| `DELETE /v1/me/whatsapp` | `204`, idempotente. |

Erros: sem token válido (ausente, malformado, expirado, ID token, `client_id` errado…) → `401 { "error": "unauthorized" }`, **igual para qualquer motivo**; chaves do Cognito indisponíveis → `503`; erro inesperado → `500 { "error": "internal" }` sem detalhe. Conta que ainda não passou por `POST /v1/me` nas rotas do WhatsApp → `403 account_not_registered`. Rota desconhecida → `404`; método errado → `405` com `allow`; corpo ilegível → `400`. Rota e método são verificados antes do token (revelar que a rota existe não expõe nada). `Idempotency-Key` e as demais rotas ainda não foram implementadas.

### Sincronização do app

v1: o app consulta a API a cada abertura de tela e após mutações (já é o que os ViewModels fazem: "recarregar após mutações"). Sem *offline-first*. Notificações push (APNs) ficam para depois ❓.

## 7. Fluxo do WhatsApp

### 7.1 Webhook

Implementado em `WebhookHandler` (`backend/src/whatsapp/webhook/`), com testes.

1. **GET** (verificação): responde `hub.challenge` se `hub.verify_token` confere com o segredo (comparação em tempo constante). Nunca registrar o token em log.
2. **POST** (evento):
   - Validar `X-Hub-Signature-256` (HMAC-SHA256 do corpo bruto com o **App Secret** da Meta). Assinatura inválida: 401, sem processar.
   - Ignorar eventos que não sejam mensagens de texto (os de `statuses`, como entregue e lido, chegam no mesmo webhook).
   - Enfileirar no SQS FIFO (`MessageGroupId` = telefone, `MessageDeduplicationId` = `wamid`) e responder 200 imediatamente.

### 7.2 Worker

Implementado em `WhatsAppWorker` (`backend/src/whatsapp/worker.ts`); já faz o vínculo por token (seção 8). O `MessageResponder` definitivo é o `GeminiMessageResponder` (seção 7.4); `composeWhatsAppWorker` (`src/lambdas/compose.ts`) o injeta no lugar do `EchoResponder`, que fica para dev e testes, e liga o `GraphWhatsAppSender` (seção 7.5).

```
mensagem ─► registrar o wamid na caixa de entrada (item WAMID#; se já foi processado: descartar)
        ─► limite de taxa por número (seção 7.3); estourou: avisa uma vez por janela, descarta o resto e para
        ─► mensagem com token de vínculo? responder pelo `WhatsAppLinker` (seção 8) e parar
        ─► resolver telefone → usuário (vínculo PHONE#)
              ├─ desconhecido: responder "Vincule seu número no app"
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

Se o Gemini não reconhecer a intenção, o bot responde com a lista do que sabe fazer. O texto final **não** é gerado pelo modelo: é montado por código a partir do que o caso de uso devolveu (seção 7.4).

### 7.3 Segurança do LLM

- O texto da mensagem é **entrada não confiável**. O modelo não tem acesso a banco, segredos ou a outros usuários, só às ferramentas acima.
- Um usuário só consegue dados que ele já veria no app, porque o caso de uso aplica a elegibilidade.
- Limite de taxa por número e teto de tokens por resposta, para controlar custo. ✅ Implementado (abaixo).
- Não registrar o conteúdo das mensagens em log além do necessário (dados pessoais; ver seção 11).

**Limite de taxa por número** (`MessageRateLimiter`, `src/whatsapp/rate-limit.ts`; port `RateCounter` em `ports.ts`). Janela fixa: o instante é arredondado ao início da janela e `RateCounter.increment(telefone, início da janela)` devolve a contagem (atômico; no DynamoDB, `UpdateItem ... ADD count 1` com `ReturnValues: UPDATED_NEW`, e o `ttl` apaga as janelas antigas; seção 4). `limit` e `windowSeconds` vêm da configuração, sem valor padrão no código (sugestão inicial: 10 por 60 s). O worker consulta logo depois do `claim` e **antes** do vínculo e do Gemini, então um número que exagera não gera consulta, chamada ao modelo nem resposta:

| Contagem na janela | Decisão | O que o worker faz |
| --- | --- | --- |
| até `limit` | `allowed` | segue o fluxo normal |
| `limit + 1` | `limitedFirst` | envia o aviso fixo (`WhatsAppWorker.rateLimitedReply`) e marca como processada |
| acima | `limited` | só marca como processada (descarta em silêncio) |

A mensagem barrada conta como processada (nem retry nem DLQ). Vale para todos os números, inclusive os sem vínculo (o aviso de "vincule seu número" não vira spam). Limitações aceitas: uma rajada na virada da janela pode somar até o dobro do limite; uma nova tentativa depois de uma falha (SQS) conta de novo na janela.
### 7.4 Assistente (`src/assistant/`)

Implementado e testado com `GeminiClient` falso e `HttpFetch` falso; nenhum teste chama a rede, e nada chamou o Gemini de verdade ainda.

**`GeminiClient` / `HttpGeminiClient`** (`gemini-client.ts`): `POST https://generativelanguage.googleapis.com/v1beta/models/<GEMINI_MODEL>:generateContent` com *function calling* (`toolConfig` modo `AUTO`, `temperature` 0).

- A chave da API vai só no cabeçalho `x-goog-api-key`: nunca na URL, no corpo ou em mensagem de erro.
- O modelo vem de `GEMINI_MODEL` e é validado antes de entrar na URL (`^[a-z0-9][a-z0-9.-]{0,63}$`: um pouco mais estrito que `^[a-z0-9.-]+$`, para barrar `.`/`..` como nome). **Sem `GEMINI_MODEL` (ou sem chave) o cliente não é criado** (`GeminiConfigurationError`): não existe modelo escondido. O nome vem como `string | undefined` para a composição passar a variável de ambiente direto e falhar fechada.
- Timeout (padrão 10 s) e teto de tokens de saída (padrão 512; o modelo só emite chamadas de ferramenta).
- Erros tipados (`GeminiRequestError`: `network`, `timeout`, `status` com o status HTTP, `invalidResponse`, `blocked`), com mensagem fixa: sem corpo de resposta, sem o erro original, sem texto do usuário. Resposta com mais de 256 KB é recusada. A resposta é lida com estreitamento escrito à mão; partes de raciocínio (`thought`) e tipos desconhecidos são descartados.
- Modelo padrão **recomendado**: `gemini-2.5-flash-lite` (o mais barato com *function calling*). Conferido em 2026-10-05 na página de depreciações do Google: estável (GA), sem data de desligamento anunciada. Já existe o `gemini-3.5-flash-lite` (também sem data). O `gemini-1.5-flash` foi desativado e, segundo a mesma página, o `gemini-2.0-flash-lite` tinha desligamento anunciado para 1/6/2026: nenhum dos dois pode ser usado. O valor concreto é configuração do ambiente; reconferir a página antes de cada release.

**Ferramentas** (`read-tools.ts`): `list_my_tasks(range)`, `list_room_tasks(room_name)`, `list_sporadic_tasks()`. As declarações não têm parâmetro de usuário nem de casa; o `userID` e a casa são injetados pelo responder. Tudo o que o modelo devolve é entrada não confiável:

| Entrada do modelo | Tratamento |
| --- | --- |
| Ferramenta desconhecida (inclusive de escrita ou nomes do protótipo) | Recusada (`unknown_tool`); nada executa |
| `range` | Só `"week"` ou `"all"`; ausente = `"week"`; qualquer outro valor é recusado (`invalid_range`) |
| `room_name` | Texto de 1 a 80 caracteres após `trim`; senão `invalid_room_name` |
| Argumentos extras (`user_id`, `house_id`...) | Ignorados: só os parâmetros declarados são lidos (e só chaves próprias do objeto) |

`room_name` é resolvido contra `RoomRepository.rooms(houseID, userID)`: igualdade sem caixa, acento nem artigo inicial; depois "um nome contém o outro" (mínimo de 3 caracteres). Nomes iguais são desempatados pelo **menor ID**; nomes diferentes na busca parcial são ambíguos (o bot lista as opções em vez de escolher). `rooms()` lista todos os cômodos da casa, inclusive os privados de que o morador não participa (como o app mostra); as tarefas, porém, só saem de `GetRoomTasks`, que aplica a elegibilidade: o morador de fora recebe "Não há tarefas em X", nunca as tarefas.

**`GeminiMessageResponder`** (`gemini-responder.ts`), `reply(text, userID)`:

1. Resolve a casa por `HouseRepository.houses(userID)`, **antes** de chamar o modelo: nenhuma casa → orienta a criar ou entrar numa casa pelo app; mais de uma → diz que o WhatsApp ainda não suporta várias casas e manda usar o app; uma → segue.
2. Mensagem em branco → lista do que o bot sabe fazer, sem chamar o modelo. Texto cortado em 500 caracteres antes de ir ao modelo.
3. Laço de *function calling* com limite de rodadas (padrão 3) e no máximo 3 chamadas por rodada; consultas repetidas respondem uma vez. A instrução de sistema é fixa; o texto do morador só vai como mensagem de usuário.
4. A saída das ferramentas **não** volta ao modelo. A resposta é montada em `task-format.ts` a partir do que os casos de uso devolveram, então nomes e datas só vêm dos dados, e o texto que o modelo escrever é descartado: uma instrução escondida na mensagem ou num nome de tarefa de outro morador não consegue ditar o que o bot diz. Só uma falha recuperável (argumento inválido, cômodo não encontrado/ambíguo) volta ao modelo, como erro de código fixo mais os nomes dos cômodos, para ele corrigir a chamada.
5. Falha do Gemini (`GeminiRequestError`) → mensagem fixa em português ("Tente de novo em instantes"). Qualquer outro erro (banco, bug) propaga e o SQS tenta de novo. Se a rodada de correção falhar, mantém o que já foi respondido.
6. Nada do conteúdo é registrado em log nem guardado (teste dedicado: console, `stdout`/`stderr`, responder sem estado, caixa de entrada só com `wamid` e horários).

**Formatação** (`task-format.ts`): datas no fuso da casa (`localDateTime` em `dates.ts`, extensão só do servidor). O prazo é o fim **exclusivo** de `[availableAt, dueAt)`: prazo à meia-noite aparece como o dia anterior ("até dom 20/09" para a semana que termina na segunda 00:00); com horário, aparece o horário; vencido leva "(atrasada)". O ano só aparece quando não é o corrente. Esforço nunca é exibido. Nomes de outros moradores viram uma linha só, sem caracteres de controle, com no máximo 60 caracteres; no máximo 20 tarefas por lista ("… e mais N") e 3800 caracteres por resposta (o `WhatsAppSender` ainda corta em 4096).

A composição na Lambda `worker` está em `compose.ts` (seção 3.1). Pendente: validar o formato do pedido contra a API real (autorização necessária; checklist em [VALIDACAO-APIS-REAIS.md](VALIDACAO-APIS-REAIS.md)).

### 7.5 Envio pela Graph API (`src/whatsapp/graph-sender.ts`)

`GraphWhatsAppSender` implementa `WhatsAppSender.send(text, toPhone)` com `HttpFetch` injetado. Testado só com `HttpFetch` falso; nada chamou a Graph API de verdade ainda.

- `POST https://graph.facebook.com/<WHATSAPP_GRAPH_VERSION>/<PHONE_NUMBER_ID>/messages`, corpo `{ "messaging_product": "whatsapp", "recipient_type": "individual", "to": "+5511999998888", "type": "text", "text": { "body": "…" } }`. `recipient_type` não estava no pedido original: entra porque o exemplo da documentação da Meta o inclui (conferido em 2026-10-05; o exemplo da doc usa `v25.0`).
- **Campo `to`:** E.164 **com `+`**, exatamente como o port recebe e como o vínculo guarda (a documentação recomenda o `+` e o código do país, e aceita `+`, `-`, `()` e espaços). O sender recusa (`invalidRecipient`) o que não for `^\+[1-9][0-9]{7,14}$`, sem chamar a rede. **Dúvida em aberto:** para Brasil e México a documentação diz que a Cloud API pode modificar o prefixo (nono dígito); o efeito entre o `from` recebido e o `to` enviado precisa ser validado com um número real (ver [VALIDACAO-APIS-REAIS.md](VALIDACAO-APIS-REAIS.md)).
- Token só no cabeçalho `Authorization: Bearer` (nunca em URL, corpo ou erro). Versão (`^v[0-9]{1,3}\.[0-9]{1,2}$`), `PHONE_NUMBER_ID` (só dígitos) e token são validados na criação (`GraphConfigurationError`): **sem versão não existe sender**, como o `GEMINI_MODEL`.
- Timeout (padrão 10 s). Texto cortado em 4096 caracteres por ponto de código (nunca no meio de um par substituto), com reticências no corte; o limite de 4096 vem do pedido e **não foi confirmado nas páginas lidas da documentação** (checklist). Texto vazio: `emptyMessage`.
- Erros tipados (`GraphSendError`: `network`, `timeout`, `status` com o status HTTP, `invalidRecipient`, `emptyMessage`), com mensagem fixa: sem corpo de resposta, token, texto nem telefone. A resposta de sucesso não é lida. **Toda falha propaga** e o SQS tenta de novo; isso inclui erros permanentes (por exemplo, fora da janela de 24 h ou número inexistente), que ficam repetindo até a DLQ. O `status` fica exposto para uma política futura (não repetir 4xx, exceto 429).

## 8. Vínculo número ↔ morador

✅ **Link `wa.me` com token** (padrão). ❓ Plano B: código de verificação.

Por que o `wa.me` é mais barato: quando é o **usuário** quem envia a primeira mensagem, abre-se uma janela de atendimento de 24 h em que o negócio pode responder livremente. Já o código de verificação é uma mensagem iniciada pela empresa, que exige um *template* de autenticação aprovado e é cobrada por mensagem. (Conferir a tabela de preços vigente da Meta antes de fechar o orçamento.)

Fluxo:

1. No Perfil, o usuário toca em "Conectar WhatsApp". O app chama `POST /me/whatsapp/link`.
2. O backend (`WhatsAppLinker.issueInvitation`) cria um token aleatório de uso único e devolve `https://wa.me/<numero-do-bot>?text=<mensagem com token>`. Recusa se o morador já tem número conectado.
3. O app abre o link. O usuário envia a mensagem pré-preenchida (`Conectar meu WhatsApp ao Grupuxo. Código: <token>`).
4. O worker recebe a mensagem, o `WhatsAppLinker.handle` reconhece o token, marca-o como usado, grava o vínculo (`userID`, `phoneE164`, `consentedAt`, `linkedAt`; itens `PHONE#` e `USER#/WHATSAPP`) e confirma no chat.
5. O app passa a mostrar "WhatsApp conectado", com opção de desconectar.

Formato do token (`LinkTokenCodec`):

- 128 bits do gerador seguro do sistema (`crypto.randomBytes`), em 32 caracteres hexadecimais minúsculos. Hex porque o teclado do WhatsApp pode trocar a caixa; o reconhecimento normaliza para minúsculo.
- Persistido só o SHA-256 em hexadecimal (item `LINKTOKEN#<hash>`); o token em claro existe apenas na URL devolvida ao app.
- Validade de 15 minutos (`LinkConfig.tokenLifetimeSeconds`) e uso único (`LinkTokenStore.consume`, atômico).
- Reconhecimento: a primeira palavra da mensagem com exatamente 32 caracteres hex. O texto é entrada não confiável; o `userID` vem sempre do token.

Respostas do bot (`WhatsAppLinker`):

| Situação | Resposta |
| --- | --- |
| Vinculado | "Pronto! Seu WhatsApp está conectado…"; `consentedAt` = horário da mensagem do usuário, `linkedAt` = horário do processamento |
| Token inexistente, usado ou expirado (sem distinguir, para não vazar informação) | "Link inválido ou expirado…" |
| Número já vinculado (a qualquer morador) | "Este número já está conectado…"; **o token não é consumido**, outro número ainda pode usá-lo |
| Morador já tem outro número | "Sua conta já tem outro número conectado…"; o vínculo original fica intacto |

Limitação conhecida: consumir o token e criar o vínculo são duas chamadas aos ports. Se `create` falhar depois do `consume`, o token fica queimado e o morador gera outro pelo app. No DynamoDB, o adaptador pode fazer as duas coisas num `TransactWriteItems`, sem mudar o ponto de chamada. Gerar um novo convite não invalida os anteriores: todos valem até expirar.

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

`GEMINI_MODEL` (nome do modelo) e `WHATSAPP_GRAPH_VERSION` (versão da Graph API) não são segredos: vão em variável de ambiente da Lambda `worker`, validadas na composição (seções 7.4 e 7.5). O segredo é um objeto JSON com estas chaves; `parseWebhookSecrets` e `parseWorkerSecrets` (`src/lambdas/config.ts`) leem só o que cada Lambda usa.

Regras:

- Nada de segredos no repositório, em variáveis de ambiente em texto puro nem em log. As Lambdas leem o segredo uma vez por instância e mantêm em cache (`SecretStringReader`: só o sucesso fica em cache).
- **Menor privilégio:** cada role recebe apenas `secretsmanager:GetSecretValue` no ARN desse segredo. Evitar a política gerenciada `SecretsManagerReadWrite`, que dá escrita em todos os segredos da conta.
- Sem usuário IAM com chaves de acesso para as Lambdas: elas usam a role de execução. Pessoas acessam por IAM Identity Center.
- DynamoDB sem credenciais: as Lambdas acessam a tabela pela role de execução (IAM), então não há senha de banco para guardar nem rotacionar. **Menor privilégio:** cada role recebe só as ações de que precisa, restritas ao ARN da tabela e do índice `GSI1` (`dynamodb:GetItem`, `PutItem`, `UpdateItem`, `DeleteItem`, `Query`, `BatchGetItem`, `ConditionCheckItem`; a `TransactWriteItems` é autorizada por essas ações, não existe permissão com esse nome). O webhook não acessa a tabela. Nunca `dynamodb:*` nem `Resource: "*"`.
- Tabela com criptografia em repouso (padrão da AWS), `deletion_protection_enabled` em `prod` e recuperação a um ponto no tempo (PITR) em `prod` ❓ (PITR tem custo por GB; decidir se vale na v1).
- Ambientes separados (`dev`, `prod`), com números e apps Meta distintos.
- Observabilidade: CloudWatch Logs com retenção definida, alarmes para DLQ com mensagens e erros 5xx, *X-Ray* opcional.
- Fila com DLQ e novas tentativas limitadas; o worker é idempotente.

## 11. Privacidade e LGPD

Dados pessoais tratados: nome, e-mail, número de telefone e conteúdo das mensagens.

- Finalidade e consentimento explícitos no vínculo (seção 8).
- Direito de desconectar e apagar: `DELETE /me/whatsapp` remove o número; a exclusão da conta remove o usuário e os vínculos.
- Guardar o mínimo do conteúdo das mensagens (não persistir o texto; manter só `wamid` e horário para idempotência).
- Região da tabela e das Lambdas: `sa-east-1` (São Paulo) se a latência e a disponibilidade dos serviços permitirem ❓. O user pool do Cognito já está em `us-east-1`; se a tabela ficar em outra região, os dados pessoais passam a existir nas duas. A tabela **não** usa *global tables* na v1 (custo de réplica).
- A Meta e a Google atuam como operadoras: revisar termos e transferência internacional.

## 12. Perguntas em aberto

Para a modelagem e a infraestrutura de dados (DynamoDB):

1. Quantas ações e quantos KB gera um `refreshSchedule` de uma casa parada há semanas? O limite de 100 ações por `TransactWriteItems` (seção 4) falha fechado; medir com casas reais e decidir se o comando passa a materializar em lotes limitados.
2. Arquivar ocorrências antigas concluídas numa partição `HOUSEARCHIVE#<id>` quando a `Query` da casa pesar (seção 4)?
3. PITR em `prod` (custo por GB) e o prazo de retenção dos backups, que também são dado pessoal (seção 11).
4. Região da tabela e das Lambdas: `sa-east-1` ou `us-east-1`? O Cognito já está em `us-east-1`, o que favorece manter tudo lá; `sa-east-1` favorece a latência e a LGPD.
5. ~~IaC: CDK, SAM ou Terraform?~~ Resolvido: Terraform (decisão ✅ 8).
6. ~~Aurora ou DynamoDB?~~ Resolvido: DynamoDB, tabela única sob demanda (decisão ✅ 2).

Para o produto:

6. ~~Cognito ou validação própria do token da Apple?~~ Resolvido: Cognito (decisão ✅ 6). Falta decidir se contas Apple e e-mail/senha do mesmo morador podem ser unificadas.
7. Notificações push (APNs) entram antes ou depois do WhatsApp?
8. ~~Qual modelo Gemini usar?~~ Resolvido: configurável por `GEMINI_MODEL` (sem valor, o cliente falha fechado); padrão recomendado `gemini-2.5-flash-lite` (seção 7.4).
9. Um número de bot por ambiente ou um único número de produção?
10. O que acontece com o vínculo quando o morador sai da casa (desvincular automaticamente)?
11. ~~Um morador pode estar em mais de uma casa?~~ Decisão do WhatsApp v1: uma casa por morador. Com várias casas o bot manda usar o app; sem nenhuma, orienta a criar ou entrar numa (seção 7.4). O app/modelo de dados podem seguir permitindo várias.
12. ~~Um morador tem no máximo um número vinculado?~~ Resolvido pelo modelo: o item `USER#<id>/WHATSAPP` é único por morador, escrito com `attribute_not_exists(PK)` na mesma transação do `PHONE#<e164>/LINK` (seção 4).

Para a infraestrutura (Node):

13. Empacotamento das Lambdas: `esbuild` (bundle único) ou `tsc` com `rewriteRelativeImportExtensions`? O código usa imports com extensão `.ts` e roda no Node 22.18+ por *type stripping*; o Lambda precisa de JavaScript.
14. Runtime Node 22 nas Lambdas e como o time quer fixar a versão (`.nvmrc` e `engines` já indicam 22).
15. **AWS SDK v3** (`@aws-sdk/client-dynamodb` ou `@aws-sdk/lib-dynamodb`, `client-sqs`, `client-secrets-manager`): são dependências de runtime e quebram "zero dependências". O runtime Node 22 do Lambda já traz o AWS SDK v3, então o SDK não precisa ser empacotado (só tipado, como dependência de desenvolvimento). Recomendação: o adaptador `src/adapters/dynamodb/` recebe um **cliente mínimo injetado** (uma interface própria com `get`, `query`, `put`, `update`, `delete`, `batchGet` e `transactWrite`), para o domínio e os testes não importarem o SDK; o ponto de entrada de cada Lambda instancia o SDK real. Para SQS e Secrets Manager isso já está feito: `SqsClient` e `SecretsManagerClient` (`src/adapters/aws/clients.ts`) são as interfaces mínimas e o ponto de entrada embrulha o SDK. Decisão pendente para o DynamoDB; nada foi instalado.
16. ~~Onde fica o contador do limite de taxa?~~ Resolvido: na mesma tabela DynamoDB (itens `RATE#`, com TTL), sem serviço extra (seção 4).

## 13. Ordem de entrega sugerida

1. ✅ **Feito:** `GrupuxoDomain` extraído como Swift Package (`grupuxo/Packages/GrupuxoDomain`); o app continua funcionando com o mock. ✅ **Feito:** domínio e algoritmo portados para TypeScript (`backend/src/domain`), com fixtures de referência geradas do Swift e os cenários dos testes Swift traduzidos.
2. Tabela DynamoDB (Terraform), adaptadores `src/adapters/dynamodb/` (repositórios do domínio e ports) e testes contra o mesmo conjunto de cenários do mock. *A fazer; o modelo de itens está na seção 4, as interfaces de repositório do domínio e os ports da seção 14 são o contrato, e os testes de contrato (`backend/test/contract`) são reutilizáveis: cada função recebe uma fábrica do adaptador.*
3. Lambda `api` e autenticação (login Cognito do app ✅; *✅ validação do JWT e `UserDirectory` prontos e testados, em memória*; falta o `UserDirectory` em DynamoDB e o ponto de entrada da Lambda `api`); `Data/Remote` no app (trocar mocks em `AppContainer`).
4. Vínculo do número (`wa.me`) e tela no Perfil. *✅ Lado servidor pronto e testado (em memória): gerar o convite, reconhecer o token e vincular no worker (`WhatsAppLinker`). Os endpoints `POST /v1/me` e `POST /v1/me/whatsapp/link` já existem no handler `api` (em memória); falta a tela.*
5. Webhook + fila + worker, primeiro só eco, depois Gemini com as ferramentas de leitura. *✅ Webhook, ports, worker, eco, `GeminiMessageResponder`, `GraphWhatsAppSender`, limite de taxa e handlers no formato Lambda, com adaptadores em memória e Gemini/Graph falsos; adaptador SQS e leitor do segredo no Secrets Manager prontos com clientes falsos; falta o ponto de entrada de cada Lambda (AWS SDK e empacotamento em aberto).* O Gemini chama casos de uso do domínio TypeScript (`GetMyTasks`, `GetRoomTasks`, `GetSporadicTasks`), com o `userID` injetado pelo worker.
6. Concluir tarefas com confirmação e, por fim, lembretes.

Os passos 1–3 e o esqueleto do webhook (passo 5, sem LLM) podem andar em paralelo.

## 14. Estado da implementação e contrato com a tabela

Código em `backend/` (`npm test`). Tudo roda com adaptadores em memória; nada acessa AWS, DynamoDB, Meta ou Gemini ainda.

| Peça | Onde | Situação |
| --- | --- | --- |
| Domínio e algoritmo (Húngaro, motor, otimizador da casa, agendamento, justiça, carga, elegibilidade, sugestões) | `src/domain/services/` | ✅ portados; fixtures de referência do Swift verdes |
| Calendário por fuso (semana na segunda, horário de verão) | `src/domain/dates.ts` | ✅ verificado contra o `Calendar` do Foundation em seis fusos |
| Comandos transacionais, casos de uso, repositórios (interfaces) | `src/domain/commands/`, `use-cases/`, `repositories.ts` | ✅ |
| Verificação (GET) e eventos (POST) do webhook | `WebhookHandler` | ✅ testado |
| Assinatura `X-Hub-Signature-256` (HMAC-SHA256, tempo constante, falha fechada com segredo vazio) | `SignatureVerifier` | ✅ testado, incluindo vetor gerado com `openssl` |
| Extração de mensagens de texto (ignora `statuses`, mídia e outros campos) | `webhook-payload.ts` | ✅ testado, com decodificação tão rígida quanto o `Decodable` do Swift |
| Worker: idempotência por `wamid`, resolve número → morador, responde | `WhatsAppWorker` | ✅ com `EchoResponder` |
| Ports e adaptadores em memória | `src/whatsapp/ports.ts`, `src/adapters/in-memory/` | ✅ com testes de contrato reutilizáveis |
| Vínculo por token: gerar convite, reconhecer o token, vincular, rejeitar número já vinculado | `LinkTokenCodec`, `WhatsAppLinker` | ✅ testado (em memória) |
| Validação do JWT do Cognito (`TokenVerifier`, `CognitoJwtVerifier`, JWKS com cache) | `src/auth/` | ✅ testado com chaves RSA geradas no teste, sem rede (só access token; ID token rejeitado) |
| `UserDirectory` (conta Cognito → morador) | `src/auth/user-directory.ts`, `src/adapters/in-memory/user-directory.ts` | ✅ port, adaptador em memória e contrato (`test/contract/user-directory.ts`); DynamoDB a fazer |
| Envio pela Graph API | `src/whatsapp/graph-sender.ts` | ✅ testado com `HttpFetch` falso (seção 7.5); falta validar contra a API real |
| Limite de taxa por número | `src/whatsapp/rate-limit.ts`, port `RateCounter`, `adapters/in-memory/rate-counter.ts`, contrato `test/contract/rate-counter.ts` | ✅ em memória; DynamoDB (itens `RATE#`) a fazer |
| Handlers Lambda (`webhook`, `worker`, `api`), eventos, config, composição | `src/lambdas/` | ✅ testados ponta a ponta em memória (seção 3.1) |
| Adaptador SQS (`MessageQueue`) e leitura do Secrets Manager | `src/adapters/aws/`, contrato `test/contract/message-queue.ts` | ✅ com clientes mínimos falsos; falta validar contra a AWS real (VALIDACAO-APIS-REAIS.md A8, A9) |
| Pontos de entrada das Lambdas (embrulham o AWS SDK nos clientes mínimos) | | a fazer (dependem do empacotamento e do cliente DynamoDB ❓) |
| Tabela DynamoDB e repositórios (domínio e ports) | `infra/` (Terraform), `src/adapters/dynamodb/` | a fazer (modelo na seção 4) |
| Endpoints `POST /v1/me`, `/v1/me/whatsapp/link`, `GET`/`DELETE /v1/me/whatsapp` | `src/lambdas/api.ts` | ✅ em memória; tela no Perfil a fazer |
| Gemini e ferramentas de leitura (`MessageResponder` definitivo) | `src/assistant/` | ✅ testado com cliente e `HttpFetch` falsos (seção 7.4), ligado em `composeWhatsAppWorker`; falta validar contra a API real |
| Intervalo de datas ("da semana") em `GetMyTasksUseCase` | `src/domain/use-cases/tasks.ts` | ✅ `range: "week" \| "all"`, fuso da casa, só a semana corrente; extensão só do servidor (ver [ALGORITMO.md](ALGORITMO.md)) |

### Verificação

```sh
cd backend
npm install          # só dev-dependencies: typescript e @types/node
npm run typecheck    # tsc --noEmit
npm test             # tudo: unitários, contratos e fixtures de referência
npm run test:fixtures
```

Requer Node 22.18 ou superior (execução de `.ts` por *type stripping*, sem `tsx`; verificado localmente com Node 25 — o Node 22 ainda precisa ser conferido no CI). Estrutura dos testes:

- **Fixtures de referência** (`test/*.fixtures.test.ts`, `test/fixtures/*.json`): casos gerados do `GrupuxoDomain` Swift por `tools/swift-fixtures` (`regenerate.sh`) e comparados com `deepStrictEqual`. Detalhes e pontos de cuidado em [ALGORITMO.md](ALGORITMO.md).
- **Cenários portados** dos testes Swift (app, domínio e backend) para `node:test`, mais testes novos para o que o Swift não cobria (calendário por fuso, trocas, notificações, assumir/devolver, decodificação rígida do webhook, arquitetura).
- **Contratos** (`test/contract/stores.ts`): uma função por port que recebe uma fábrica do adaptador. O adaptador DynamoDB deve passar nos mesmos testes (incluindo os concorrentes).

### Comportamentos decididos na implementação

- Webhook: assinatura inválida ou ausente → 401; verificação com token/modo errado → 403; JSON inválido, UTF-8 inválido ou payload com tipo errado em campo obrigatório, com assinatura válida → 400; falha ao enfileirar → 500 (a Meta reenvia; o SQS FIFO e a caixa de entrada (`WAMID#`) deduplicam por `wamid`); método diferente de GET/POST → 405; qualquer evento válido sem mensagem de texto → 200 sem enfileirar.
- `timestamp` da mensagem: só dígitos (com fração opcional); qualquer outro valor (inclusive infinito ou fora do intervalo) cai no relógio injetado. É um endurecimento em relação ao Swift, que aceitava formatos como `1e9`.
- Telefone: a Meta envia só dígitos (`5511999998888`); o backend normaliza para E.164 (`+5511999998888`) antes de enfileirar e de consultar o vínculo (`PHONE#<e164>`). **Risco:** números brasileiros antigos podem chegar sem o nono dígito; se aparecer divergência entre o número do cadastro e o `from` da Meta, normalizar na entrada.
- Idempotência: `claim` devolve `claimed` para mensagem nova **ou registrada e ainda não processada** (o worker caiu no meio), e `duplicate` só depois de `markProcessed`. Assim uma falha não perde a mensagem. O custo é poder responder duas vezes se o envio funcionou e a marcação falhou; aceitável para leitura (na escrita, o caso de uso é idempotente).
- Número desconhecido: o worker responde "Vincule seu número no app" (texto em `WhatsAppWorker.unlinkedReply`). Nunca vincula sem token válido.
- Reconhecimento do token: marcas combinantes contam como parte da palavra (um caractere acentuado é uma letra), como no `split` por `Character` do Swift; um falso positivo só gera uma consulta de hash sem resultado.
- Não registrar em log nem persistir o texto das mensagens: o worker só passa ao `InboxStore` o `wamid` e os horários (teste dedicado), e o código de `src` não usa `console`.

### Contrato dos ports com os itens do DynamoDB

Quem implementar o DynamoDB deve fazer cada port passar nos mesmos testes dos adaptadores em memória (`backend/test/contract/`). Chaves e atributos estão na seção 4. Toda unicidade é uma **escrita condicional**; `ConditionalCheckFailedException` (ou `TransactionCanceledException` com `ConditionalCheckFailed`) é traduzida no adaptador, nunca vaza para o domínio.

| Port | Método | Itens | Operação esperada |
| --- | --- | --- | --- |
| `InboxStore` | `claim(wamid, receivedAt)` | `WAMID#<wamid>` / `INBOX` | `PutItem` (`receivedAt`, `ttl`) com `attribute_not_exists(PK) OR attribute_not_exists(processedAt)`; sucesso = `claimed`, condição falha = `duplicate` |
| | `markProcessed(wamid, at)` | | `UpdateItem SET processedAt = :at` |
| `WhatsAppLinkStore` | `linkForPhone(phone)` | `PHONE#<e164>` / `LINK` | `GetItem` consistente |
| | `linkForUser(userID)` | `USER#<id>` / `WHATSAPP` | `GetItem` consistente |
| | `create(link)` | os dois acima | `TransactWriteItems` com os dois `Put` e `attribute_not_exists(PK)` em cada um; o cancelamento é traduzido pelo motivo de cada ação: o item `PHONE#` falhou → `WhatsAppLinkError("phoneAlreadyLinked")`; o `USER#/WHATSAPP` falhou → `"userAlreadyLinked"` (se os dois falharem, vale o do número, como no adaptador em memória) |
| | `remove(userID)` | os dois acima | `GetItem` do `USER#/WHATSAPP` para achar o número, depois `TransactWriteItems` com os dois `Delete` (idempotente: sem vínculo, não faz nada) |
| `LinkTokenStore` | `save(token)` | `LINKTOKEN#<hash>` / `LINKTOKEN` | `PutItem` (`userID`, `expiresAt`, `ttl`) |
| | `consume(tokenHash, at)` | | `UpdateItem SET usedAt = :at` com `attribute_exists(PK) AND attribute_not_exists(usedAt) AND expiresAt > :at` e `ReturnValues: ALL_NEW`; condição falha = `null` |
| `RateCounter` | `increment(key, windowStart)` | `RATE#<key>` / `<windowStart>` | `UpdateItem ADD #count :one SET #ttl = :ttl` com `ReturnValues: UPDATED_NEW`; devolve `count` |
| `UserDirectory` | `userForSub(sub)` | `COGNITO#<sub>` | `GetItem` consistente |
| | `ensureUser(sub, profile)` | `COGNITO#<sub>`, `USER#<id>` / `PROFILE` | `TransactWriteItems` com `Put` de `COGNITO#` (`attribute_not_exists(PK)`) e do perfil; se a condição falhar, `GetItem` consistente do `COGNITO#<sub>` |

Campos do vínculo: `userID`, `phoneE164` (E.164 com `+`), `consentedAt`, `linkedAt`, todos em milissegundos (`Instant`). Não existe `status`: desvincular apaga os itens. Só o `ttl` é em segundos. O token só existe como SHA-256 em hexadecimal; o `ttl` do `LINKTOKEN#` deve ser posterior a `expiresAt` (o DynamoDB apaga com atraso, então a **condição** `expiresAt > :at` é que decide a validade, nunca a presença do item). Pelo mesmo motivo, `RATE#` e `WAMID#` não podem depender do TTL para a lógica: a janela entra na chave, e `claim`/`markProcessed` não leem `ttl`.

Retenção: `WAMID#` com `ttl` de poucos dias (só serve à deduplicação; a Meta e o SQS reentregam em minutos ou horas), `RATE#` com `ttl` de alguns minutos além da janela, `LINKTOKEN#` com `ttl` pouco depois de `expiresAt`. O telefone em `RATE#<key>` é dado pessoal: usar o SHA-256 do número como `key` ❓ (o contrato do `RateCounter` não depende disso).
