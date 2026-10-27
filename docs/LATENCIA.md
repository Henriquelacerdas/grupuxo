# Latência das telas e o erro "Não foi possível falar com o servidor"

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
