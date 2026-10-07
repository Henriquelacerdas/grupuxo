# Validação contra as APIs reais

Checklist do que **ainda não foi validado** contra a Graph API da Meta, o Gemini e a Lambda Function URL. Hoje todos os testes usam `HttpFetch` falso e nunca chamam a rede. Nada abaixo foi executado: cada item que toca AWS, Meta ou Google exige **autorização explícita, caso a caso** (deploy, criar recurso, chamar a API real). Estado e decisões: [BACKEND.md](BACKEND.md) (seções 3.1, 3.2, 7.4 e 7.5).

Regras para qualquer chamada real: usar números e chaves de **teste** (ambiente `dev`), nunca registrar token, texto de mensagem nem telefone, e anotar aqui o resultado (data, versão da API, o que diferiu do código).

## 1. Graph API (`src/whatsapp/graph-sender.ts`)

Conferido só na documentação (somente leitura, 2026-10-05): URL `https://graph.facebook.com/<versão>/<PHONE_NUMBER_ID>/messages`, `Authorization: Bearer`, corpo com `messaging_product`, `recipient_type`, `to`, `type`, `text.body`; exemplos com `v25.0`.

| # | O que validar | Por quê | Como |
| --- | --- | --- | --- |
| G1 | Formato do `to`: o código envia E.164 **com `+`** (`+5511999998888`) | A documentação recomenda o `+`, mas o exemplo não deixa claro se `to` sem `+` é igualmente aceito | Enviar uma mensagem de teste a um número do próprio time (dentro da janela de 24 h) e conferir a entrega |
| G2 | **Nono dígito brasileiro**: o `from` que a Meta envia (só dígitos) pode vir sem o 9 (números antigos), e a documentação diz que, para Brasil e México, a Cloud API pode modificar o prefixo do `to` | O vínculo guarda o `from` normalizado; se a Meta responder por outro formato, o `phone_e164` do cadastro pode divergir | Com um número que **não** tem o 9 no cadastro do WhatsApp, vincular, receber, responder e comparar o `wa_id` devolvido com o `phone_e164` gravado |
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
| A7 | Concorrência reservada nas Lambdas HTTP segura uma rajada sem derrubar o banco | Teste de carga leve em `dev` |
