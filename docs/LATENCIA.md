# Latência das telas e o erro "Não foi possível falar com o servidor"

## WhatsApp — indicador "digitando…" (publicado no dev em 28/10/2026)

O worker aciona o indicador nativo em paralelo ao responder, depois da deduplicação, do limite de taxa e da identificação do vínculo. Uma chamada por processamento, com timeout próprio de 1 s, cancelada e encerrada quando a resposta fica pronta; sem mensagem intermediária, renovação periódica ou retry do indicador. Falhas nele não impedem o envio final. Também marca a mensagem recebida como lida; o indicador desaparece com a resposta ou após até 25 s. Não cobre tempo anterior ao worker na fila e não reduz o tempo real de Gemini/DynamoDB.

Métricas próprias: `typingMs`, `typingCalls`, `typingFailures`, `typingTimeouts`, `typingCancellations`, `typingStatus`. Não somar `typingMs` a `responderMs`: são operações concorrentes. `graphMs`/`graphCalls` continuam medindo o envio final de texto. Payload, concorrência, cancelamento, falhas, idempotência, limite de taxa e privacidade são verificados com HTTP falso, sem chamada real à Graph.

Validação local: **1.149 testes passaram** (`npm test`), `npm run typecheck` e `npm run build` passaram.

Publicação autorizada e concluída em **28/10/2026 às 12:03, Brasília**. Plano Terraform direcionado ao worker: **0 criações, 1 atualização de código, 0 exclusões**; único campo alterado `source_code_hash`. ZIP implantado: `q3Zdk1i1ihme/BiQLvENv2dkv5wEqqdDfeVixf/CmKQ=` (SHA-256 base64), confirmado na Lambda `grupuxo-dev-worker`, `Active`/`Successful`, com 512 MB e timeout de 60 s preservados. Hashes da API e do webhook permanecem os da publicação anterior; fila, modelo e ambiente não mudaram. Teste de inicialização com lote SQS vazio retornou HTTP 200, sem `FunctionError`; não envia mensagens nem chama o Gemini. A exibição do indicador no aparelho ainda precisa ser conferida em uma conversa real.

## WhatsApp — diagnóstico e instrumentação local (2026-10-28)

Investigação autorizada em CloudWatch, somente leitura, seguida de aprovação para implementar e rodar a instrumentação local. Publicação autorizada posteriormente e concluída em **28/10/2026 às 10:13, Brasília**, no worker e webhook do `dev`. Nenhuma alteração de memória, timeout, fila ou modelo; não houve envio real pela Graph, chamada real ao Gemini ou operação na DLQ pelo agente. Testes locais usam clientes falsos.

Janela principal: **20/10 21:00 a 28/10 09:13:34, Brasília** (21/10 00:00 a 28/10 12:13:34 UTC), `us-east-1`, grupos `/aws/lambda/grupuxo-dev-webhook` e `/aws/lambda/grupuxo-dev-worker`. Logs Insights `platform.report`:

| Medida | Amostras | Mediana | p90 |
| --- | ---: | ---: | ---: |
| Webhook, todas as requisições (inclui callbacks sem texto) | 166 invocações | 2,39 ms | 429,22 ms |
| Worker, versões da janela | 44 invocações | 3.417,71 ms | 13.640,54 ms |
| Worker desde a implantação de 26/10 11:53:11 Brasília | 16 invocações | 5.427,31 ms | 15.316,07 ms |
| Init do worker atual, somente invocações frias | 5 reports | 429,44 ms | 491,17 ms |

Duração de invocação exclui `initDurationMs`; setup preguiçoso/segredo fica dentro dela. Batch pode conter várias mensagens: invocação não equivale a mensagem respondida. Queries de origem: `2b3c805a-e140-4559-acb8-a1353ae3d5e9` (janela principal) e `9d9175a7-dcb0-45e6-8261-88b5a2ecedf2` (worker atual). A consulta usa `filter type = "platform.report" | stats count(*), pct(record.metrics.durationMs,50), pct(record.metrics.durationMs,90) by @log` e os intervalos acima.

Sem instrumentação implantada, **Meta→webhook, espera por mensagem no SQS, Gemini por tentativa/rodada, carga da casa e Graph não têm p50/p90 separados**. Não deduzir esses tempos subtraindo percentis de populações diferentes.

Configuração efetiva conferida: worker **512 MB / 60 s**, API **1769 MB / 15 s**, webhook **256 MB / 10 s**; Gemini `gemini-3.1-flash-lite`, duas tentativas de 12 s, backoff de 500 ms, thinking `low`; até três rodadas com cutoff de 15 s para iniciar correção (não é deadline da chamada). SQS FIFO: batch **5**, janela **0**, visibilidade **360 s**, `maxReceiveCount=3`, sem máximo de concorrência do mapping ou reserva configurados para o worker. Processamento sequencial inclusive entre grupos do lote; mesmo telefone mantém FIFO.

Métricas `AWS/SQS` de uma hora mostraram idade máxima **1372 s (22 min 52 s)**, backlog visível máximo 2, 42 envios/49 recebimentos/39 exclusões reportados (não contagens de mensagens únicas) e DLQ com máximo de oito itens. Idade máxima agregada não é tempo individual de espera. Sem throttles/erros de Lambda; respostas parciais/fallback podem falhar sem elevar a métrica `Errors`. Logs seguros registraram três Graph HTTP 400 e cinco 401, todos anteriores à implantação atual, com sequências próximas de 360 s. Depois da implantação atual: quatro falhas finais Gemini 503 e um timeout. Falhas finais não contam retries recuperados. Não há evidência para trocar modelo ou aumentar timeout agora.

O SHA-256 base64 do ZIP local `backend/infra/build/worker.zip`, **`T3owSq2Qts5YZjNK9zB05fyYTWC/0AEZN3Y8W44Aizo=`**, coincide com o `CodeSha256` implantado. O bundle reconstruído de `6e32523` coincide após remover comentários de caminho. Esse código ainda recodifica baseline/clona leituras e faz buscas repetidas em `taskItems`; as otimizações do commit `101779e` (27/10), já no checkout, ainda não estavam implantadas no worker.

Benchmark offline da investigação: Node 25.1.0, 15 amostras/cenário, seed determinístico com **2508 itens na partição**, mais perfis; cliente falso com uma página por carga, Gemini e Graph falsos. Sem RTT, SDK ou limitação de CPU da Lambda. Baseline equivalente ao bundle implantado versus HEAD antes desta instrumentação:

| Cenário | Cargas completas | Rodadas Gemini | Implantado: mediana / p90 | HEAD: mediana / p90 |
| --- | ---: | ---: | ---: | ---: |
| Minhas tarefas da semana | 2 | 1 | 27,41 / 28,22 ms | 15,41 / 15,59 ms |
| Cômodo | 2 | 1 | 23,51 / 24,68 ms | 11,27 / 11,51 ms |
| Avulsas | 2 | 1 | 32,07 / 32,42 ms | 19,79 / 20,82 ms |
| Três ferramentas | 4 | 1 | 71,66 / 74,09 ms | 35,80 / 37,19 ms |
| Pedir conclusão | 2 | 1 | 27,58 / 28,36 ms | 15,27 / 16,78 ms |
| Confirmar com "sim" | 3 | 0 | 36,19 / 37,04 ms | 22,95 / 24,37 ms |
| Três correções de tarefa não resolvida | 4 | 3 | 69,97 / 71,21 ms | 34,64 / 36,42 ms |

Ajuda sem ferramenta ainda faz uma carga antes do modelo. `houses.houses` é GSI + lote de META, sem carga completa; o fuso de `GetMyTasks(week)` é um `GetItem`, não outra carga. Cada carga completa pode ter várias páginas e lotes de perfis. Escala vencida acrescenta a leitura transacional; conflitos repetem a carga. Nos perfis CPU locais, `taskItems` na pilha caiu de ~2,29 s para ~0,10 s em 200 mensagens; a clonagem/expressões do falso também aparecem e não representam custo do DynamoDB real. Os números acima antecedem a instrumentação; não são projeção do ganho fim a fim na Lambda.

### Instrumentação implementada e publicada no dev

`src/latency.ts` define campos fechados, timers com relógio injetado e samples sem conteúdo. `src/main/latency.ts` usa relógio monotônico e `AsyncLocalStorage`: uma medição por mensagem, sem contador compartilhado entre usuários/invocações; só `main/` escreve JSON em stdout. Falha do destino do log não muda o retorno/erro original. Não entram texto, telefone, wamid, IDs de casa/morador, argumentos, nomes de tarefa/cômodo, URL, token, corpo ou mensagem de erro. Não há novas dependências de runtime.

Evento **`whatsapp_latency`**, `version=1`, com `kind`:

- `webhook`: requisição inteira, inclusive setup na primeira; status traduzido em `success`, `rejected` ou `failure`. `textMessages`, `timestampFallbacks`, `invalidTimestamps`, `enqueuedMessages`, `metaDeliveryMs` e `enqueueMs`. `metaDeliveryMs` soma os atrasos de timestamps válidos num payload; **filtrar `textMessages=1`, fallback/inválidos zero para percentis por mensagem**. Timestamp da Meta tem precisão limitada e não mede o gesto no aparelho.
- `batch`: duração do handler do worker, inclusive setup e todos os registros. `setup` registra separadamente a montagem preguiçosa/dependências, somente quando ela acontece, inclusive falhas. Não somar esses tempos aninhados.
- `message`: um registro SQS, inclusive JSON inválido ou grupo bloqueado. `batchSize`, `batchIndex`, `receiveCount`; `queueDispatchMs` = chegada ao handler externo menos `SentTimestamp` (inclui reentregas); `firstQueueWaitMs` = primeiro recebimento SQS menos envio; `batchWaitMs` = início do registro menos chegada ao handler externo, incluindo setup e registros anteriores. Atributos opcionais inválidos não descartam a mensagem nem viram espera zero. `outcome` distingue `success`, `failure`, `duplicate`, `limited` e `blocked_group`.

Dentro de cada mensagem: `claimMs`, `rateLimitMs`, `linkMs`, `resolveHouseMs`, `roomsMs`, `responderMs`, `toolMs`, `markProcessedMs`; `geminiRounds`, `geminiAttempts`, `geminiRetries`, `geminiFailures`, `geminiCutoffs`, `geminiRetrySleepMs` e `geminiAttemptTimings` (cada tentativa traz duração, outcome constante e status HTTP quando disponível, inclusive falhas recuperadas). `toolCalls` conta chamadas recebidas; contadores específicos distinguem execução de minhas tarefas/cômodo/avulsas, pedidos e confirmações. Gemini continua decidindo somente a ferramenta; "sim" continua decidido pelo código.

Armazenamento: `houseLoads`, `housePages`, `houseItems`, `profileBatches`, `profiles`, `houseConflicts` e `houseTransactions`; tempos `houseReadMs`, `houseUpdateMs`, `houseLoadMs`, `houseQueryMs`, `houseDecodeMs`, `profileMs`, `houseBaselineMs`, `houseCloneMs`, `houseCommandMs`, `houseDiffMs`, `houseWriteMs`. São tempos aninhados: `houseLoadMs` inclui query/decodificação/perfis; `houseCommandMs` inclui o callback de domínio; `houseQueryMs` inclui SDK/rede, `houseDecodeMs` é só o decoder do adaptador. Não somar pais/filhos. Páginas/itens contam retornos recebidos, cargas/transações contam tentativas.

Envio: `graphMs`, `graphCalls`, `graphStatus`, falhas/timeout/rede, `replyChars` e indicadores de corte do responder/sender. Continua um envio por resposta; limites 3800/4096 pontos de código. `sourceToWorkerMs` e `sourceToGraphMs` usam `IncomingMessage.receivedAt` (timestamp original ou fallback legado). **Graph aceita o envio; isso não comprova entrega no aparelho.** Não há novo tratamento de callbacks de entrega.

Contadores começam em zero; durações não executadas e timestamps/status ausentes ficam ausentes. Um `outcome=success` com `geminiFailures>0` pode ser envio bem-sucedido do fallback, não interpretação bem-sucedida. Usar `kind=message` para percentis por registro e separar essas populações. `totalMs` de mensagem exclui `batchWaitMs`; `platform.report.initDurationMs` continua a fonte de inicialização do runtime anterior ao handler JavaScript.

Consultas nos grupos de worker/webhook, em uma janela explícita após a publicação:

```text
parse @message /(?<payload>\{.*\})/
| fields jsonParse(payload) as m
| filter m.event = "whatsapp_latency" and m.kind = "message"
| stats count(*) as n,
    pct(m.queueDispatchMs,50) as queue_p50, pct(m.queueDispatchMs,90) as queue_p90,
    pct(m.batchWaitMs,50) as batch_p50, pct(m.batchWaitMs,90) as batch_p90,
    pct(m.totalMs,50) as worker_p50, pct(m.totalMs,90) as worker_p90,
    pct(m.geminiMs,50) as gemini_p50, pct(m.geminiMs,90) as gemini_p90,
    pct(m.houseLoadMs,50) as house_p50, pct(m.houseLoadMs,90) as house_p90,
    pct(m.graphMs,50) as graph_p50, pct(m.graphMs,90) as graph_p90
  by m.outcome
```

```text
parse @message /(?<payload>\{.*\})/
| fields jsonParse(payload) as m
| filter m.event = "whatsapp_latency" and m.kind = "message"
| unnest m.geminiAttemptTimings into attempt
| stats count(*) as n, pct(attempt.durationMs,50) as p50,
    pct(attempt.durationMs,90) as p90 by attempt.outcome, attempt.status
```

Validação local: `npm test` em `backend/` — **1139 testes passaram**, incluindo 14 novos cenários de telemetria (privacidade, isolamento concorrente, retry recuperado, timeout do corpo, Graph 401/corte, SQS/reentrega/grupo bloqueado, fallback de timestamp, paginação, conflito e falha de comando, cutoff e idempotência na composição). `npm run typecheck`, `npm run build` e `git diff --check` passaram. Sem chamadas a serviços reais. As consultas seguem a sintaxe oficial de [jsonParse/unnest do CloudWatch](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax-Unnest.html).

Publicação de 28/10: plano Terraform direcionado às duas Lambdas, validado como **0 criações, 2 atualizações de código, 0 exclusões**, sem mudanças de configuração. Worker `qtlNo8MLBfqaw1GLNeNIudviT7mWcWN1byvoYQgOhBM=`; webhook `JcVP0KsDZCrytaFNtYlnw3xiPf0adwEj0/pDhO10LWI=` (SHA-256 base64). Ambos confirmados `Active`/`Successful` e com hashes iguais aos pacotes locais. O bundle do worker também inclui as otimizações de leitura e `taskItems` já existentes no checkout. API preservada (hash `vBE07EKMSXJc3Fbu8UY96AW4bBp/ghIP8MhvwmcZ0PA=`). Smoke tests: lote SQS vazio e GET de verificação sem token, sem erros de execução; não exercitam conversa real. CloudWatch confirmou dois eventos `setup=success`, um `batch=success` e um `webhook=rejected` (esperado sem token). Query validada `719fbe8e-308d-4d80-8f4b-45b7dddbdc47`; extração explícita de JSON nas consultas abaixo evita o resultado vazio observado ao filtrar diretamente o alias de `jsonParse(@message)`.

Próxima medição: comparar caminhos, tamanho/estado da casa e versão equivalentes; separar cold starts, retries, falhas/fallback e número de cargas. A publicação permite medir o efeito das otimizações já existentes. Depois avaliar uma mudança por vez: memória 512→1769 MB, leitura agregada por mensagem/rodada e orçamento global Gemini. Permanecem timeout 60 s, visibilidade 360 s, modelo e FIFO. Mudanças adicionais de infraestrutura continuam dependendo de autorização específica.


## Correções implementadas localmente — 2026-10-27

Auditoria local da abertura, navegação e conclusão/desmarcação de tarefas. Nenhuma chamada à AWS, Meta ou Gemini nesta rodada.

- Backend: `taskItems` passa a indexar atribuições e moradores por ocorrência/ID; elimina a busca da lista inteira para cada ocorrência, preservando a primeira atribuição ativa e a última encerrada compatível com a conclusão.
- `HouseStateStore.read` deixa de recodificar todos os itens para montar um baseline de escrita e de clonar os arrays de um estado que acabou de ser carregado para a própria chamada. Escritas mantêm baseline canônico, cópia e controle de versão.
- Nova rota `GET /v1/me/house/snapshot`: uma carga da partição entrega casa, moradores, participações e tarefas visíveis. Usa as mesmas políticas das rotas individuais, com renovação transacional apenas quando a escala está desatualizada.
- Abertura: `userID` e casa saem do snapshot; a mesma instância do cache segue da `RemoteHouseSession` até os repositórios do `AppContainer`, evitando repetir a carga nas primeiras abas.
- App: cache compartilhado do snapshot por 5 segundos, com uma busca para consumidores concorrentes, invalidação após mutações (inclusive falha ambígua de transporte de tarefa) e descarte de respostas anteriores à invalidação. Servidor sem a rota (`404 not_found`) usa as rotas anteriores durante o rollout.
- Interface: conclusão/desmarcação com prévia imediata em Minhas tarefas, cômodo, avulsas e detalhe; bloqueio apenas da ocorrência em gravação, reversão em falha e reconciliação após a última gravação. Recargas mantêm o conteúdo; respostas iniciadas antes de uma ação não sobrescrevem a prévia.

Medição reproduzível: `cd backend && npm run benchmark:reads` (Node 25.1.0 nesta máquina, 15 amostras, 2.513 itens, cliente falso). O perfil CPU inclui custo de clonagem/expressões do falso e não equivale a uma medição de rede/Lambda. Foram comparados o código antes das correções e o código alterado, com a mesma casa; a última linha substitui as consultas da tela Casa por um snapshot.

| Consulta local | Antes: mediana / p90 | Depois: mediana / p90 |
| --- | --- | --- |
| Tarefas do morador | 20,82 / 24,03 ms | 10,23 / 11,90 ms |
| Consultas individuais da tela Casa | 168,00 / 175,83 ms | 84,42 / 86,65 ms |
| Tela Casa pelo snapshot | mesmas consultas acima | **15,16 / 15,43 ms** |

O snapshot reduz cerca de 91% do tempo local frente às consultas individuais anteriores. Com a escala em dia, faz uma carga da partição + um lote de perfis, sem escrita. Não elimina o crescimento do histórico na partição nem a latência de rede; arquivamento continua como evolução separada.

Validação:

- `npm run typecheck`, `npm test`: **1.125 testes passaram**, incluindo fixtures Swift↔TS e contrato JSON do snapshot; `npm run build` também passou.
- `swift test --package-path grupuxo/Packages/GrupuxoDomain`: **8 testes passaram**.
- Testes do app no simulador iPhone 17 / iOS 27: **165 testes passaram** (`-only-testing:grupuxoTests -testLanguage pt-BR -testRegion BR -enableCodeCoverage NO`). Cobrem uma chamada na abertura + duas abas, atualização explícita que ignora o TTL, expiração e invalidação, resposta invalidada em andamento, consumidor cancelado sem cancelar os outros, fallback e 401, isolamento no logout, resposta visual antes do servidor, rollback e progresso/desmarcação com ações independentes.
- Dois testes antigos dependiam de quem recebia tarefas no seed aleatório; agora escolhem um responsável real por tarefa do ciclo para testar conclusão/desfazer, sem presumir que a Marina sempre tenha um ciclo nem que uma tarefa após-conclusão permaneça sendo a ocorrência atual.

Entrega local validada: build iOS e bundles das Lambdas gerados, sem alteração de infraestrutura. Publicar a `api`, gerar/distribuir o novo build iOS e repetir a medição no aparelho contra o ambiente real continuam pendentes. A autorização específica para AWS está definida em `CLAUDE.md`; nenhuma chamada real foi necessária para os benchmarks e testes descritos aqui. As seções abaixo são o histórico anterior a estas correções.

## Sintoma

Ao trocar de aba ou de tela e voltar, o app mostrava "Não foi possível falar com o servidor agora. Tente de novo em instantes." por alguns segundos e depois voltava ao normal.

## Causa (corrigida no app)

1. As telas carregam em `.task` / `.task(id:)`. Quando a tela some (troca de aba no `TabView`, push no `NavigationStack`), o SwiftUI cancela essa tarefa.
2. O `URLSession` cancelado lança `URLError(.cancelled)`, não `CancellationError`. O `APIClient.send` tratava tudo que não fosse `CancellationError` como `APIError.network`, cuja mensagem é a do erro.
3. Os ViewModels trocavam o conteúdo por `.failure` em qualquer erro. Ao voltar, a recarga em segundo plano não limpa a tela, então a falha ficava visível até a nova resposta chegar.

Correção:

- `APIClient` converte `URLError(.cancelled)` (ou erro com a tarefa já cancelada, inclusive na busca do token) em `CancellationError`.
- Os `load()` dos ViewModels ignoram `CancellationError`: o estado anterior fica.
- `MyTasksViewModel.load(showLoading: false)` (recarga ao voltar, depois de criar tarefa) mantém a lista se a recarga falhar; a falha cheia só aparece sem nada na tela ou no puxar para atualizar.

Testes: `APIClientTests.cancelledRequestIsCancellationNotNetworkFailure` e `MyTasksOverviewTests.backgroundReloadFailureKeepsTheListOnScreen`.

## Medição (CloudWatch, 2026-10-19 a 2026-10-25, `grupuxo-dev-api` e tabela `grupuxo-dev`)

Leitura feita com autorização do dono, só leitura (logs `platform.report` da Lambda e métricas do DynamoDB e da Lambda).

| Dia | Chamadas | Duração p50 | p90 | Itens por `Query` (média) |
|---|---|---|---|---|
| 19/10 | 132 | 101 ms | 436 ms | 72 |
| 20/10 | 208 | 77 ms | 262 ms | 345 |
| 21/10 | 632 | 122 ms | 630 ms | 1.299 |
| 22/10 | 735 | 850 ms | 1.509 ms | 1.173 |
| 23/10 | 134 | 1.197 ms | 2.215 ms | — |
| 24/10 | 108 | 1.203 ms | 1.847 ms | 1.669 |
| 25/10 | 617 | 1.339 ms | 2.431 ms | — |

Na semana, 2.566 chamadas: p50 691 ms, p90 1,8 s, p99 3,1 s, máximo 9,1 s; todas com `status: success`.

O que os números dizem:

- **Cold start não é o problema.** 115 das 2.566 chamadas (4,5%) foram frias, com `Init Duration` médio de 413 ms (máximo 507 ms). Concorrência máxima da `api` foi 7; nenhum throttle.
- **DynamoDB também não.** Latência média de `Query` de 3 a 27 ms e de `GetItem` de cerca de 2 ms; nenhum `TransactionConflict` nem `ConditionalCheckFailed`; só 7 a 78 `TransactWriteItems` por dia.
- **O tempo está na CPU da Lambda, e cresce com o tamanho da partição da casa.** Cada chamada carrega a partição inteira (`HouseStateStore.load`, `Query` consistente), que passou de cerca de 70 para cerca de 1.700 itens por consulta, e a duração mediana subiu de cerca de 100 ms para 1,3 s junto. Com 512 MB, a Lambda tem cerca de 0,3 vCPU para decodificar os itens, clonar o estado (`cloneStoreState`), rodar o comando e calcular a diferença.
- **Leituras rodam como escrita.** `GET` de tarefas do morador (`DynamoTaskRepository.tasks`) e de participação no cômodo (`DynamoRoomRepository.participation`) usam `store.update`: `refreshSchedule` (o motor de distribuição) roda em toda consulta, mais o clone e a diferença do estado inteiro, mesmo quando nada muda. `participation`, `room` e `roomTasks` ainda fazem uma `Query` no `GSI1` (`houseOf`) antes da carga.

## Por que uma tela leva alguns segundos

As telas principais fazem várias chamadas, e cada uma carrega e processa a partição inteira (`N` = cômodos envolvidos; até 4 cômodos em paralelo, `maxConcurrentRoomQueries`):

| Tela | Chamadas | Rodadas em sequência |
|---|---|---|
| Minhas tarefas (`GetMyTasksOverviewUseCase`) | 2 + 2N (`tasks` e `rooms`; por cômodo com ciclo, `participation` e `tasks` do cômodo para o progresso) | 1 + 2 × ⌈N/4⌉ |
| Casa (`GetHouseOverviewUseCase`) | 2 + 2N (`rooms` e avulsas; por cômodo, `participation` e `tasks` do cômodo) | 1 + 2 × ⌈N/4⌉ |

Numa casa com 4 cômodos, são 10 cargas da partição de 1.700 itens e 3 rodadas de 1 a 2,5 s cada: de 4 a 7 s por tela. Durante essa espera, o app mostrava o erro de cancelamento (já corrigido).

## Propostas (para decisão)

Em ordem de ganho por esforço:

1. **Mais memória na `api` (`backend/infra/lambdas.tf`, `api = { memory = 512 }` → 1769).** Com 1.769 MB a Lambda tem 1 vCPU inteira, cerca de 3,5 vezes a de hoje. Como o tempo é CPU, a duração deve cair na mesma proporção, e o custo por chamada fica parecido (paga-se GB × segundo). Uma linha no Terraform, mas precisa de `plan`/`apply` autorizados. Medir de novo depois para confirmar.
2. ✅ **Consultas sem `update`** (publicada em 2026-10-25 20:39 UTC; ganho pequeno, ver "Depois da proposta 2"). `tasks` e `participation` passam a usar `store.read` quando a escala já cobre o instante pedido, e só chamam `refreshSchedule` com `update` quando falta escala. Sem clone, sem diferença e sem motor na maioria das chamadas. Mexe no adaptador e no domínio (decidir onde mora o "precisa renovar?"), com teste nos dois adaptadores.
3. **Partição menor.** ✅ Parte "escala materializada" feita em 2026-10-25 (falta publicar a `api` e medir): só a próxima vez de cada morador é publicada; a seguinte sai na conclusão (escala do cômodo: também quando a atual atrasa), e o otimizador projeta as 12 semanas sem gravar (ALGORITMO.md, "Publicação por morador"). Uma tarefa semanal com 4 moradores passa de 12 ocorrências + 12 atribuições futuras para 4 + 4; uma diária, de 84 + 84 para 4 + 4. As escalas antigas do `dev` são convertidas sozinhas na primeira escrita ou consulta de cada casa (as ocorrências futuras que sobram são apagadas, em várias transações se passar de 100 ações). Falta a outra parte: arquivar ocorrências e atribuições concluídas antigas (`HOUSEARCHIVE#<id>`, já previsto no BACKEND.md seção 4), porque o histórico continua crescendo na mesma partição.
4. **Rota agregada por tela** (`GET /v1/me/tasks/overview` e `GET /v1/me/house/overview`): uma carga da partição por tela em vez de 2 + 2N. Muda o contrato (BACKEND.md seção 6.1 e fixtures em `backend/test/fixtures/api/`) e exige montar o overview no TypeScript, que hoje só existe no Swift. Meio-termo: uma rota em lote com participação e progresso de vários cômodos.
5. **Cache curto no app** para `rooms` e `participation` (como o `MyHouseCache`, `maxAge` 5 s), invalidado nas mutações. Barato, mas só ajuda idas e voltas rápidas.

Concorrência provisionada **não** compensa: o cold start é 4,5% das chamadas e custa cerca de 0,4 s.

## Depois da proposta 1 (memória da `api` em 1769 MB, aplicada em 2026-10-25 16:29 UTC)

Amostra curta: 155 chamadas em cerca de 1 minuto de uso do app (16:31 a 16:32 UTC), comparadas com as 6 horas anteriores ao apply.

| | Antes (512 MB, 478 chamadas) | Depois (1769 MB, 155 chamadas) | Ganho |
|---|---|---|---|
| p50 | 1.339 ms | 607 ms | 2,2× |
| p90 | 2.530 ms | 863 ms | 2,9× |
| p99 | 5.977 ms | 1.242 ms | 4,8× |
| Máximo | 9.146 ms | 1.252 ms | 7,3× |
| Memória usada (máx.) | 183 MB | 243 MB | |

- O cold start não mudou (cerca de 410 ms, 6 das 155 chamadas).
- A partição continuou crescendo: a `Query` devolveu em média **2.530 itens** na hora da amostra (1.669 em 24/10). Por item carregado, o ganho fica perto dos 3,5× esperados de 1 vCPU contra 0,3: o tempo é mesmo CPU, e volta a subir se a partição continuar crescendo.
- Custo por chamada: cerca de 1,6 vez o anterior em GB × segundo (1,05 contra 0,67). No volume do `dev` (centenas de chamadas por dia), fica dentro da camada gratuita da Lambda.
- Próximo passo: as propostas 2 e 3 atacam a causa (processar a partição inteira em toda chamada, e a partição sempre crescer); sem elas, a latência volta a subir com o tempo.

## Proposta 2 (consultas sem `update`)

`DynamoTaskRepository.tasks`/`sporadicTasks` e `DynamoRoomRepository.participation` primeiro leem a partição e conferem se a escala está em dia (`scheduleIsCurrent` / `roomScheduleReady`). Em dia, respondem dessa leitura, sem `refreshSchedule`, transação nem diferença. Faltando escala (a primeira consulta de cada semana nova, ou cômodo sem escala), estendem num `store.update` como antes, ao custo de uma leitura a mais nessa chamada. Numa simulação de 3 semanas com uma consulta por hora na casa de demonstração, 500 de 504 consultas ficaram só na leitura. O adaptador em memória não mudou (não tem custo de rede nem de transação).

Testes: `test/schedule-current.test.ts` (120 dias com conclusões: escala em dia nunca é alterada pelo `refresh`, e depois do `refresh` está em dia) e, em `test/dynamodb/house-state-store.test.ts`, "consultas com a escala em dia só leem" (nenhuma transação aberta; uma semana depois, uma escrita só; resultado igual ao da memória).

## Depois da proposta 2 (publicada em 2026-10-25 20:39 UTC)

161 chamadas de uso do app (20:44 a 20:53 UTC), comparadas com as 581 chamadas só com 1769 MB (16:31 a 20:38 UTC) e com a semana anterior (512 MB).

| | Semana anterior (512 MB) | 1769 MB | 1769 MB + consultas sem `update` |
|---|---|---|---|
| Chamadas | 2.566 | 581 | 161 |
| p50 | 691 ms (1.339 ms no dia 25) | 641 ms | 567 ms |
| p90 | 1.778 ms | 917 ms | 886 ms |
| p99 | 3.103 ms | 1.397 ms | 1.308 ms |
| Máximo | 9.146 ms | 1.613 ms | 1.609 ms |

- Ganho da proposta 2: cerca de 10% (p50 641 → 567 ms). Nenhum `TransactWriteItems` na janela: as consultas deixaram de abrir transação, como esperado, mas `refreshSchedule` e a diferença não eram o grosso do tempo.
- As durações ficam em dois grupos: 57 chamadas até 500 ms (rotas que não carregam a partição, como `GET /v1/me`) e quase todo o resto entre 600 e 900 ms. A carga e o processamento da partição de cerca de 2.540 itens custam por volta de 0,6 s por chamada mesmo com 1 vCPU. Isso não se explica pela `Query` do DynamoDB (cerca de 25 ms por página).
- Próximo passo: **medir onde vão esses 0,6 s antes de mudar mais código**. Montar localmente uma casa com cerca de 2.500 itens (o cliente falso de `test/support/fake-dynamo-client.ts`, sem AWS) e perfilar uma consulta com `node --cpu-prof`: decodificação (`codec.ts`), `cloneStoreState`, `taskItems`/`canSee` e sugestões das avulsas (`suggestedResident`) são os candidatos. Em paralelo, a proposta 3 (partição menor) continua necessária: a partição segue crescendo, porque a escala é materializada 12 semanas à frente (`HORIZON_WEEKS`) e o histórico fica na mesma partição.
