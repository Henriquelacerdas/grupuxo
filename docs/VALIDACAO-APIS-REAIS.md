# Validação contra as APIs reais

Checklist do que **ainda não foi validado** contra a Graph API da Meta, o Gemini e a Lambda Function URL. Hoje todos os testes usam `HttpFetch` falso e nunca chamam a rede. Nada abaixo foi executado: cada item que toca AWS, Meta ou Google exige **autorização explícita, caso a caso** (deploy, criar recurso, chamar a API real). Estado e decisões: [BACKEND.md](BACKEND.md) (seções 3.1, 3.2, 7.4 e 7.5).

Regras para qualquer chamada real: usar números e chaves de **teste** (ambiente `dev`), nunca registrar token, texto de mensagem nem telefone, e anotar aqui o resultado (data, versão da API, o que diferiu do código).

**Como rodar as seções 1 e 2:** scripts descartáveis em `backend/tools/validate/` (`graph.ts`: G1–G7; `gemini.ts`: M1–M5), um item por vez, com autorização por item; ver o [README](../backend/tools/validate/README.md) (variáveis, chamadas de cada item e o que a saída nunca mostra). `--dry-run` exercita os scripts sem rede. Os scripts estão prontos e **não foram executados contra a rede**.

## 1. Graph API (`src/whatsapp/graph-sender.ts`)

Conferido só na documentação (somente leitura, 2026-10-05): URL `https://graph.facebook.com/<versão>/<PHONE_NUMBER_ID>/messages`, `Authorization: Bearer`, corpo com `messaging_product`, `recipient_type`, `to`, `type`, `text.body`; exemplos com `v25.0`.

| # | O que validar | Por quê | Como |
| --- | --- | --- | --- |
| G1 | Formato do `to`: o código envia E.164 **com `+`** (`+5511999998888`) | A documentação recomenda o `+`, mas o exemplo não deixa claro se `to` sem `+` é igualmente aceito | Enviar uma mensagem de teste a um número do próprio time (dentro da janela de 24 h) e conferir a entrega |
| G2 | **Nono dígito brasileiro**: o `from` que a Meta envia (só dígitos) pode vir sem o 9 (números antigos), e a documentação diz que, para Brasil e México, a Cloud API pode modificar o prefixo do `to` | O vínculo guarda o `from` normalizado; se a Meta responder por outro formato, o `phoneE164` do cadastro pode divergir | Com um número que **não** tem o 9 no cadastro do WhatsApp, vincular, receber, responder e comparar o `wa_id` devolvido com o `phoneE164` gravado |
| G3 | Limite de **4096 caracteres** do `text.body` (o código corta aí) | Não consta nas páginas de documentação lidas; o valor veio do pedido | Enviar texto com 4096 e com 4097 caracteres e ver a resposta |
| G4 | `recipient_type: "individual"` é aceito (e se é opcional) | A doc o lista; o pedido original do corpo não o trazia | Enviar com e sem o campo (só em `dev`) |
| G5 | Versão vigente da Graph API | `WHATSAPP_GRAPH_VERSION` não tem padrão; a doc mostra `v25.0` em 2026-10-05 | Conferir a página de versões antes do release |
| G6 | Códigos de erro 4xx permanentes (por exemplo fora da janela de 24 h, número inexistente, token inválido) | Hoje toda falha propaga e o SQS repete até a DLQ; `GraphSendError.status` já está exposto | Provocar cada erro em `dev`, anotar status e se vale não repetir |
| G7 | Corpo da resposta de sucesso (o código não o lê) | Confirmar que não precisamos do `wamid` de saída | Só leitura da resposta em `dev` |
| G8 | Assinatura `X-Hub-Signature-256` e *challenge* do webhook com o app real | `SignatureVerifier` foi testado com vetor do `openssl`, não com a Meta | Configurar o webhook em `dev` e enviar uma mensagem |
| G9 | Formato real do payload do webhook (campos que o decodificador rígido exige) | O decodificador é estrito de propósito | Capturar um evento de `dev` (sem registrar o texto) e rodá-lo no teste |

## 2. Gemini (`src/assistant/gemini-client.ts`)

| # | O que validar | Como |
| --- | --- | --- |
| M1 | Corpo do pedido `generateContent` (`systemInstruction`, `contents`, `tools.functionDeclarations`, `toolConfig` modo `AUTO`, `generationConfig`) aceito sem erro 400 | Uma chamada real em `dev` com `GEMINI_MODEL` de teste |
| M2 | Esquema das declarações (`type: "STRING"`, `enum`) e `functionCall` devolvido (`name`, `args`, `id`) | Idem; conferir contra `parseResponse` |
| M3 | Modelos com raciocínio: `thoughtSignature` e partes `thought` | Rodar com o modelo escolhido e verificar a rodada de correção |
| M4 | `gemini-2.5-flash-lite` (padrão recomendado) continua GA e sem data de desligamento | Reconferir a página de depreciações do Google antes de cada release |
| M5 | Latência e custo por pergunta, e o teto de 512 tokens de saída | Medir em `dev` |

## 3. Lambda Function URL (payload 2.0) e SQS (`src/lambdas/events.ts`)

| # | O que validar | Como |
| --- | --- | --- |
| A1 | `rawQueryString` chega crua e a decodificação (`URLSearchParams`) bate com o `hub.verify_token` real; `+` e `%20` | GET de verificação com um token que tenha caracteres especiais, em `dev` |
| A2 | Corpo do webhook com `isBase64Encoded` verdadeiro/falso: os bytes decodificados fecham a assinatura | POST real da Meta; conferir 200 (e não 401) |
| A3 | Nomes de cabeçalho em minúsculo (`x-hub-signature-256`, `authorization`) | Evento real da Function URL |
| A4 | Evento SQS FIFO: `attributes.MessageGroupId` e `ReportBatchItemFailures` habilitado no gatilho | Lote de teste com uma mensagem inválida |
| A5 | `rawPath` das rotas `/v1/...` chega exato, sem *stage* (o handler compara `rawPath` exato) | Deploy em `dev`; chamar a URL da `api` e conferir o evento |
| A6 | Function URL com `AuthType = NONE` aceita a chamada do app e da Meta (permissões `lambda:InvokeFunctionUrl` e, se exigida, `lambda:InvokeFunction` com `InvokedViaFunctionUrl`) | Deploy em `dev`; `curl` sem credenciais AWS deve chegar na Lambda (e o 401 vir do código) |
| A7 | Concorrência reservada nas Lambdas HTTP segura uma rajada sem estourar a conta do DynamoDB sob demanda nem o limite de leitura/escrita da tabela | Teste de carga leve em `dev` |
| A8 | `SqsMessageQueue`: `MessageGroupId` com `+` (telefone) e `MessageDeduplicationId` com `.` e `=` (`wamid`) aceitos pela fila FIFO real; `ContentBasedDeduplication` desligada; um `sendMessage` de teste chega ao worker com o corpo que `parseIncomingMessage` lê (**não executado**) | Fila FIFO de `dev` e um envio de teste com o cliente real embrulhado, sem texto real de usuário |
| A9 | `SecretStringReader`: `GetSecretValue` com a role de menor privilégio devolve `SecretString`; latência da 1ª busca e comportamento sob concorrência no *cold start*; nome do erro quando falta permissão (`causeName`) (**não executado**) | Segredo de teste em `dev`, role só com `secretsmanager:GetSecretValue` nesse ARN |

## 4. DynamoDB (`src/adapters/dynamodb/`, a fazer)

Só vale depois que o adaptador existir. Rodar contra a tabela de `dev` (ou DynamoDB Local, se a equipe preferir, o que não exige autorização AWS) e anotar o resultado.

| # | O que validar | Como |
| --- | --- | --- |
| D1 | Os testes de contrato (`test/contract/`) passam no adaptador, inclusive os concorrentes (`increment`, `ensureUser`, `claim`, `consume`, `create`) | Rodar os mesmos contratos com a fábrica do adaptador DynamoDB |
| D2 | Bloqueio otimista por casa: dois comandos simultâneos na mesma casa terminam com um repetido e o estado final igual ao do `InMemoryStore` | Teste de concorrência com `Promise.all` na tabela de `dev` |
| D3 | Limite de 100 ações / 4 MB do `TransactWriteItems` e o erro explícito (falha fechada) num `refreshSchedule` grande | Casa de teste parada há muitas semanas; medir quantas ações o comando gera |
| D4 | TTL: `ttl` em segundos, e a **condição** (`expiresAt > :at`) decide a validade, não a presença do item (o DynamoDB apaga com atraso de horas) | Token vencido ainda presente na tabela deve ser recusado |
| D5 | Custo real por requisição do worker e da `api` (leituras consistentes de partição inteira) | Medir unidades de capacidade consumidas por consulta em `dev` e extrapolar para uma casa com um ano de histórico |
| D6 | O GSI (`GSI1`) é eventualmente consistente: nada transacional depende dele (`houses(userID)` logo após entrar numa casa) | Entrar numa casa e listar em seguida; se falhar, ler a casa pela partição |
