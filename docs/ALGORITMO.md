# Algoritmo de distribuição de tarefas

Contrato matemático e de consistência da distribuição. Regras de produto em [PRODUTO.md](PRODUTO.md); camadas e transações em [ARQUITETURA.md](ARQUITETURA.md).

Há duas implementações do mesmo contrato, ligadas por fixtures de referência (ver "Implementação em TypeScript e verificação cruzada"):

- **Swift** (domínio do app e **referência**): `grupuxo/Packages/GrupuxoDomain/Sources/GrupuxoDomain/Services/`.
- **TypeScript** (servidor): `backend/src/domain/services/`.

## Resumo

- **Modelo:** filas rotativas estáticas; cada participante aparece uma vez por ciclo.
- **Custo:** carga semanal ao quadrado (pune picos) + concentração por nível de esforço + saldo amortizado, num horizonte de 12 semanas.
- **Otimização:** Algoritmo Húngaro por fila (O(K³)); na casa, busca local lexicográfica com até 20 passagens. Sem garantia de ótimo global.
- **Vigência:** mudanças de participantes replanejam a escala a partir da segunda-feira imediatamente seguinte. Quem entra já é elegível desde a segunda-feira da semana atual, para tarefas criadas na mesma semana.
- **Publicação:** só a próxima vez de cada morador vira ocorrência; a seguinte sai quando ele conclui a sua (escala do cômodo: também quando ela atrasa). As 12 semanas do custo são projetadas sem gravar.
- **Justiça:** saldo por cômodo (`E − E/M` ao executor, `−E/M` aos demais), amortizado por 12 no custo.
- **Determinismo:** mesmos dados e calendário produzem o mesmo resultado; empates por UUID/índice.

## Glossário

| Termo | Significado |
| --- | --- |
| Slot | Posição na fila rotativa; ocorrências `slot, slot+K, slot+2K…` |
| Horizonte | 12 semanas projetadas a partir da vigência |
| Escala do cômodo | Períodos de n execuções em x semanas, com bloco guloso de tarefas por posição |
| Vez | Execução de calendário (data, prazo e responsável nominal), publicada ou não |
| Publicar | Materializar uma vez como `TaskOccurrence` com atribuição |
| Vigência | Segunda-feira a partir da qual a nova composição vale |

## Objetivo e limites matemáticos

Distribuir fases de filas estáticas, reduzindo picos **semanais** de esforço e concentração de dificuldades. Não é um solucionador geral de Job Shop Scheduling: não modelamos duração, precedências ou recursos simultâneos.

Para uma tarefa independente nova, as outras filas ficam fixas. Tarefas vinculadas à periodicidade de seu cômodo utilizam a escala compartilhada. Em entradas e saídas de participantes, `HouseQueueOptimizer` reotimiza as filas da casa a partir da próxima segunda-feira. O Húngaro encontra a bijeção de menor custo **de cada matriz**, não um ótimo global de todas as tarefas da casa. A busca conjunta tem duas configurações iniciais e até 20 passagens por configuração, com tarefas ordenadas por UUID para repetibilidade.

## Estado e invariantes

- `TaskDefinition`: configuração e `rotationQueue` para tarefas independentes, com cada participante exatamente uma vez; vazia quando não há elegíveis. `pendingRotation` guarda a fila por conclusão que passa a valer na próxima segunda-feira.
- Cursor (`nextScheduledAt`, `currentRotationIndex`, `rotationQueue`, `pendingRotation`): a primeira vez de calendário ainda **não resolvida** e a posição da fila nela. Vezes depois do cursor podem já estar publicadas (a próxima de cada morador); o cursor só passa por vezes já disponíveis e resolvidas (ver "Publicação por morador"). `nil` para esporádicas e tarefas que avançam por conclusão. Nas de calendário, `pendingRotation` guarda a fila do replanejamento, que vale a partir da primeira vez com data na vigência ou depois.
- `TaskOccurrence`: execução, janela de disponibilidade e `effortSnapshot`. Alterar o esforço da definição não muda snapshots existentes.
- `TaskAssignment`: histórico de atribuições. Há no máximo uma atribuição ativa por ocorrência; uma atribuição futura só vale a partir de `assignedAt`. `supersededAt` cancela um plano substituído sem produzir `endedAt < assignedAt`; `isActive` exclui atribuições concluídas/devolvidas e substituídas.
- `RoomMembership.fairnessDebt`: saldo relativo ao cômodo, positivo para quem executou mais que sua cota. Não é moeda nem placar. O vínculo é preservado na saída e reutilizado na reentrada, sem zerar saldo.
- `RoomMembership.leftAt`: término do acesso geral ao cômodo. `rotationChanges` registra mudanças de participação por data de vigência. Registros legados sem essas propriedades mantêm participação e acesso originais.

Membros da fila pertencem ao cômodo e à casa. A privacidade existe apenas no cômodo. IDs são ordenados por UUID antes da otimização; empates no solucionador são resolvidos pela ordem dos índices.

## Saldo de justiça

Para esforço `E`, executor `U` e conjunto de `M` pessoas elegíveis no momento da conclusão:

```
impacto(U) = E - E/M
impacto(outro) = -E/M
```

O esforço vem da ocorrência. Pessoas de outros cômodos, fora da casa, em ausência naquele instante ou sem participação elegível no cômodo não recebem impacto. Ausências usam intervalo `[startsAt, endsAt)`.

`FairnessCalculator` deduplica os IDs recebidos, exige esforço 1...3 e executor no conjunto. A soma dos impactos é zero, dentro da precisão de `Double`; um único membro recebe zero. A transação rejeita saldos não finitos e vínculos duplicados no cômodo.

Concluir novamente pela mesma pessoa é idempotente. Outra pessoa não pode se apropriar da conclusão. Uma ocorrência futura não pode ser concluída antecipadamente. Conclusão exige uma atribuição ativa ao executor e elegibilidade atual. A exceção é uma pendência preservada anterior à saída efetiva: o executor continua autorizado, desde que pertença à casa e não esteja ausente. Ele é incluído uma vez no conjunto usado para o saldo, junto aos participantes elegíveis na conclusão.

## Horizonte e função de custo

O calendário é injetado; no app a composição padrão usa calendário gregoriano e o fuso do dispositivo, e no servidor o calendário é o do **fuso da casa** (`House.timezone`, IANA). A semana começa na segunda-feira e a virada de semana acontece às 00:00 desse fuso. Datas avançam por componentes de calendário, nunca somando 604800 segundos (nem 24 h por dia), preservando transições de horário de verão.

Na criação, o horizonte é `[início da semana de referência, início + 12 semanas)`; ele define as vezes que a fila inicial avalia, mas só a primeira vez de cada morador nele é publicada. Tarefas independentes com recorrência antiga começam na criação. A nova modalidade semanal e tarefas vinculadas ao cômodo começam na execução do calendário ainda aberta na criação, se ela for da semana atual (a última execução da semana com data até a criação; prazo até a seguinte), ou senão na primeira execução a partir da criação. Assim, uma tarefa semanal criada na quarta-feira já tem a ocorrência desta semana (disponível desde a segunda) e um responsável nela; no cômodo, a versão da escala passa a valer a partir dessa execução. Na recorrência semanal, as seguintes começam na segunda-feira da semana calculada pelo intervalo, com prazo até a próxima ocorrência. Recorrências diárias, mensais e anuais avançam pelo respectivo componente de calendário. A primeira semana pode ser parcial. Nas recorrências semanais independentes antigas, intervalo 2 gera seis ocorrências e intervalos maiores que o horizonte geram apenas a primeira. Na nova modalidade ancorada, a criação depois da última execução do período pode não gerar ocorrências dentro do horizonte; o próximo refresh continua a partir da próxima data prevista.

A projeção inclui ocorrências pendentes atribuídas de **todos os cômodos da casa**, por usuário e semana de disponibilidade, com esforço snapshot, mais as vezes de calendário ainda não publicadas com responsável e prazo depois do instante do cálculo (esforço da definição). Assim o custo enxerga as 12 semanas como se estivessem publicadas. Históricos de reassunção não duplicam carga. Concluídas não entram novamente: seu efeito histórico já está no saldo. Pendências anteriores ao horizonte continuam consultáveis, mas não são movidas artificialmente para outra semana.

Para cada usuário `u` e semana `w`:

```
C(u,w) = (cargaPendente(u,w) + novasCargas(u,w) + saldoDoCômodo(u)/12)²
       + 0.5 × (quantidadeEsforço1² + quantidadeEsforço2² + quantidadeEsforço3²)
Custo = soma de C(u,w) nas 12 semanas
```

Amortizar o saldo por 12 evita tratá-lo como uma nova carga histórica integral a cada semana. Os pesos são 1 e 0,5, definidos no serviço de custo. Somar primeiro a carga de todo o horizonte e só então elevá-la ao quadrado não detectaria picos semanais.

Limitação deliberada: se todos os slots tiverem a mesma quantidade de ocorrências, o termo de saldo constante não diferencia suas fases; a carga semanal e os contadores decidem a ordem. O saldo influencia cotas desiguais e a primeira atribuição de tarefas sem calendário. Não prometemos compensação imediata ou quitação do saldo. Na criação, as outras atribuições ficam fixas; mudanças de participantes podem replanejar atribuições futuras.

## Húngaro

`HungarianAlgorithm.solve(matrix:)` recebe apenas `[[Double]]` e devolve `resultado[linha] = coluna`. Valida matriz quadrada e finita, aceita custos negativos e matriz vazia. Implementação por potenciais e caminhos aumentantes: O(K³), memória auxiliar O(K); a matriz ocupa O(K²).

Para `K` pessoas, cada coluna é uma posição da fila. A linha do usuário e a coluna do slot contêm o custo semanal desse usuário se ele receber as ocorrências de índices `slot, slot+K, slot+2K...`. Esses conjuntos são fixos antes de atribuir usuários. O custo é separável por usuário/slot, portanto o Húngaro é válido.

A matriz é construída em O(K² × (H+P)), com `H=12` semanas e `P` ocorrências da tarefa. Os loops manipulam números e pequenos buffers. UUIDs de ocorrências e atribuições só são criados na publicação, fora da otimização.

## Escala compartilhada do cômodo

`WeeklyPeriodicity` guarda `executionsPerPeriod = n` e `intervalWeeks = x`, positivos, com n ≤ 7x. O período é ancorado em segunda-feira; as datas usam componentes de calendário e deslocamentos floor(i × 7x / n). A igualdade compara n e x exatamente: 2/2 não equivale a 1/1. A modalidade semanal antiga equivale a n = 1.

`Room` guarda âncora, periodicidade, quantidade desejada e `RoomScheduleVersion`. Cada versão contém vigência, fila, quantidade efetiva, índice do período e o mapa tarefa → posição responsável. Os nomes avançam pela quantidade efetiva ao trocar de período. Mudanças de participantes criam versões na segunda-feira imediatamente seguinte e podem interromper o período atual sem mudar a âncora.

O guloso ordena tarefas vinculadas por esforço decrescente e UUID. Aloca cada uma na posição com menor soma de esforço, depois menor quantidade de tarefas e menor índice. Os blocos são definidos antes de associar nomes; todas as execuções da tarefa no período seguem sua posição. Tarefas vinculadas não consomem cursores individuais.

`QueueForecast.Turn.slot` identifica a posição do bloco na fila do cômodo. Várias tarefas e execuções podem contribuir para o mesmo slot. Isso mantém o custo separável por usuário/posição para o Húngaro. A busca considera filas de cômodos junto às independentes e preserva o vínculo estrutural. Na criação durante um período com execuções anteriores, a fila do cômodo fica fixa para preservar os responsáveis atuais.

O horizonte continua sendo 12 semanas. A busca compara esforço, dificuldade, saldo e alterações lexicograficamente. Matrizes têm solução ótima individual; o conjunto continua sendo uma busca local, sem garantia de ótimo global. Os períodos além do horizonte seguem a mesma fila e as mesmas versões.

## Calendário versus conclusão

- `.calendarRotation` e `.balancedAutomatically` exigem recorrência com intervalo positivo (diária, semanal, mensal ou anual); usam o mesmo planejador de fases.
- `.calendarRotation`/`.balancedAutomatically` publicam uma vez por morador (seção seguinte).
- `.afterCompletion` normaliza recorrência para `.none`. Gera somente uma ocorrência. A escolha inicial usa uma contribuição na semana atual, e as demais posições têm empate estável. Cada conclusão publica exatamente uma sucessora e consome o próximo slot estático. Não se inventa uma frequência semanal para tarefas sem prazo.
- `.sporadic` exige `.none` e `.selfAssigned`; nasce sem responsável, fora do Húngaro. Assumir/devolver não altera saldo. Concluir altera saldo e não cria sucessora. Como não possui fila, sua elegibilidade usa a participação atual no cômodo, inclusive antes da vigência da próxima rotação.
- `.recurring + .selfAssigned` não é uma combinação aceita na criação nova.

`RefreshTaskScheduleUseCase` publica a próxima vez de quem está sem pendente, dentro de 12 semanas a partir da semana atual. Na escala do cômodo, pular semanas sem abrir o app publica também as vezes intermediárias (atrasadas), preservando fase e histórico. Repetir o refresh não duplica dados.

## Publicação por morador

Para diminuir a partição da casa (ver `LATENCIA.md`), as vezes de calendário não são mais todas publicadas até 12 semanas: cada morador tem **no máximo uma vez pendente** por tarefa, a próxima dele. `TaskSchedulingService.turns` calcula as vezes a partir do cursor (data por `nextDate`, responsável pela fila com a posição avançando uma por vez, ou por `roomOwner` na escala do cômodo; ausente ou sem participação na data deixa a vez sem responsável). `plan`/`fill` decidem o que publicar:

- Um morador está **satisfeito** quando tem uma ocorrência ativa, não concluída, desta tarefa. Na **escala do cômodo** (tarefa vinculada) a pendente atrasada (`dueAt <= agora`) não conta: assim que ela atrasa, a próxima vez dele já é publicada; numa casa parada há semanas, as vezes perdidas saem atrasadas, uma depois da outra, até a primeira ainda no prazo. Nas tarefas de **periodicidade própria** a pendente conta até ser concluída, mesmo atrasada.
- Percorrendo as vezes em ordem, a primeira vez não publicada de um morador não satisfeito é publicada para ele. Nas de periodicidade própria, uma vez já vencida não é publicada (fica perdida): ao concluir atrasado, a próxima é a primeira vez dele ainda no prazo.
- **Ausência pula a vez:** a vez sem responsável não é publicada, mas consome a posição da fila; a próxima do morador é a seguinte dele fora da ausência.
- O cursor só passa por vezes já disponíveis (`availableAt <= agora`) e resolvidas: publicadas, sem responsável ou vencidas. Vezes futuras ficam à frente dele, publicadas ou não, e o replanejamento pode redistribuí-las.
- Concluir publica na hora a próxima vez de quem concluiu (`complete` chama `fill` da tarefa). Reabrir não remove a que já saiu.
- `isCurrent` (só no servidor) é falso quando o `refresh` publicaria algo; um cursor que só poderia andar (sem publicar nada) não obriga a gravar, porque não muda nenhuma resposta da `api`, e anda na próxima escrita.
- **Escala antiga:** uma definição gravada antes (todas as vezes até 12 semanas publicadas, contínuas, e o cursor depois delas) é reconhecida por `legacyStart` (há vez publicada ainda não disponível antes do cursor, e da primeira delas até o cursor todas as datas estão publicadas). O cursor volta para essa primeira vez, com a posição da fila recuperada pela contagem, e as ocorrências dali em diante são reaproveitadas (mesmo ID) para a próxima de cada morador ou removidas. Acontece no primeiro `refresh`, conclusão ou mudança de moradores; `isCurrent` é falso enquanto houver escala antiga.

Fixtures: `scheduling-complete.json` ("uma vez por morador…", "atrasada fora da escala do cômodo…", "atrasada na escala do cômodo…", "escala antiga de 12 semanas…"). Consultas pessoais e esporádicas acionam refresh; outros clientes podem chamar o caso de uso explicitamente. No app isso não é execução em background com o aplicativo fechado; no servidor o mesmo caso de uso pode ser chamado por um agendador (decisão futura).

## Entrada e saída de participantes

`AddRoomMemberUseCase` e `RemoveRoomMemberUseCase` executam vínculo, filas e atribuições. Exigem participação na casa e são idempotentes pelo par cômodo/usuário e estado desejado.

A vigência da nova rotação é sempre a segunda-feira **imediatamente seguinte**, mesmo quando o comando acontece numa segunda. Exemplo: uma alteração na quarta-feira, 16/09/2026, vale em 21/09/2026; uma alteração em 21/09 vale em 28/09. Entrar na escala não garante uma tarefa já na primeira semana.

A participação de quem **entra**, porém, é registrada desde a segunda-feira **da semana atual** (entrada em 16/09/2026 participa desde 14/09/2026). Isso não muda os responsáveis já publicados da semana, mas uma tarefa criada depois da entrada, ainda na mesma semana, já pode ser atribuída ao novo participante (por exemplo, uma tarefa diária criada na quarta-feira). Pela mesma razão, ele entra no conjunto de elegíveis do saldo nas conclusões dessa semana. A saída continua registrada na segunda-feira seguinte.

O serviço publica primeiro o que faltava pelo calendário anterior (`refresh`). Depois registra a mudança de participação e replaneja as vezes não concluídas com `availableAt >= vigência`, publicadas ou não: a fila nova entra como `pendingRotation` com a vigência, e as ocorrências futuras (ainda não disponíveis) são redistribuídas pela publicação por morador. A semana atual, atrasados e concluídos permanecem intactos, incluindo IDs, responsáveis e snapshots. Uma ocorrência futura cuja data continua publicada mantém ID, datas, prazo e esforço (só a atribuição pode mudar); a que deixa de ser a próxima de alguém é removida. Atribuições iguais não geram novos registros. Para o critério de alterações, o responsável atual de uma vez não publicada é o da fila (ou da versão da escala do cômodo) anterior.

Há uma só troca de fila pendente por definição: se a anterior é de uma vigência já passada e o cursor ainda não chegou nela, o cursor vai até a primeira vez dessa vigência (as vezes anteriores, todas passadas e ainda sem publicar, ficam perdidas) e a fila dela passa a valer antes de registrar a nova.

O acesso ao cômodo muda no comando. Quem sai mantém acesso específico às suas pendências preservadas e pode concluí-las depois da vigência, sem poder consultar as demais tarefas de um cômodo privado. Alterações repetidas na mesma semana consolidam a composição: uma entrada descarta mudanças do mesmo membro a partir da segunda-feira atual, e uma saída, a partir da próxima. Reentrar não apaga o histórico nem o saldo.

### Reequilíbrio da casa

Todas as filas de calendário da casa são consideradas. Tarefas vinculadas formam blocos da escala do cômodo e não podem ser otimizadas como filas independentes. A carga das tarefas fora do recálculo permanece fixa. A projeção usa 12 semanas a partir da vigência e snapshots individuais, incluindo restrições de ausência.

O custo é uma tupla comparada em ordem lexicográfica, sem permitir que um critério secundário piore o anterior:

1. Soma dos quadrados das cargas semanais por morador.
2. Soma dos quadrados das quantidades semanais de tarefas de esforço 1, 2 e 3.
3. `Σ 2 × cargaSemanal × saldoDaCasa / 12`, usando a soma dos saldos dos cômodos; equivale ao termo variável da carga ajustada ao quadrado quando a carga primária empata.
4. Número de atribuições alteradas em relação ao plano publicado.

Para cada fila, remover sua contribuição da projeção, construir a matriz usuário/posição e resolver pelo Húngaro lexicográfico. Aceitar somente melhoria estrita do custo da casa. Repetir até estabilizar ou atingir 20 passagens. Executar a busca a partir das filas antigas adaptadas e também de filas reconstruídas por UUID; conservar o melhor resultado, nunca pior que a configuração adaptada. Empates do solucionador seguem índices derivados de UUID; entre resultados de mesmo custo, preservar o primeiro.

Cada participante aparece uma vez por ciclo. Essa restrição e frequências distintas podem impedir igualdade perfeita. A busca é determinística e encontra melhorias locais; não promete ótimo global. O horizonte limita a avaliação; as vezes depois dele seguem a fila escolhida.

### Tarefas por conclusão e última saída

Tarefas por conclusão não recebem datas fictícias. Sua ocorrência pendente permanece com o responsável atual; a fila sucessora fica em `pendingRotation` até a vigência. A adaptação preserva a ordem restante e acrescenta os novos participantes em ordem de UUID. Não há otimização temporal dessas sucessoras sem conhecer quando serão concluídas.

A saída do último participante exige confirmação e exclui o cômodo, suas definições, ocorrências, atribuições, vínculos e versões da escala. Não permanece um cômodo vazio. Casa toda não admite saída individual nem exclusão. Ausência temporária pode deixar posições sem atribuição sem excluir o cômodo.

Definições legadas atingidas pelo replanejamento são inicializadas a partir da recorrência e da última ocorrência conhecida, mantendo as ocorrências antigas. Sem ocorrência anterior, o calendário começa na vigência. Tarefas legadas `.selfAssigned` continuam fora das filas automáticas.

### Encerrar tarefa (`endTask`)

Uma tarefa recorrente não é apagada: é **encerrada** (`TaskDefinition.endedAt`). Quem pede precisa ser morador da casa e participante atual do cômodo (a mesma regra de criar); esporádicas não se encerram (têm a própria exclusão, só de quem criou). Repetir é idempotente e mantém a primeira data.

- **Fica:** a ocorrência já disponível (`availableAt <= agora`) e não concluída permanece com o responsável até ser concluída, mesmo atrasada; as concluídas, o `fairnessDebt` e as atribuições históricas não mudam. A tarefa só passa à próxima pessoa depois de concluída, e o prazo da próxima contaria a partir da conclusão: como a próxima não existe mais, **nada é publicado depois**, nem a sucessora de `afterCompletion`.
- **Sai:** as ocorrências ainda não disponíveis (`availableAt > agora`) e suas atribuições. `nextScheduledAt` e `pendingRotation` são zerados.
- **Ignorada pelo planejador:** definição encerrada não entra em `refresh`, `extend`, `rebalance` nem na divisão de papéis do cômodo compartilhado (`isRoomLinked` é falso para ela), então não pesa mais nas escalas novas.
- **Trocas pendentes:** quem guarda as trocas (`MockTaskRepository` no app, `commands/tasks.ts` no servidor; o `TaskSchedulingState` não tem trocas) recusa as que citam uma ocorrência removida (`rejected`, `resolvedAt` = agora) e avisa quem pediu com `taskSwapRejected`. As que só citam ocorrências mantidas seguem válidas. No app a notificação traz um texto próprio; o `AppNotification` do TypeScript ainda não tem `message`.
- **Sem `rebalance` ao encerrar (limitação conhecida):** as demais tarefas só aproveitam a folga na próxima vez que a escala for replanejada (entrada ou saída de morador, nova tarefa vinculada). Replanejar na hora reescreveria atribuições futuras de outras tarefas por uma ação que não as toca.
- A lista de tarefas do cômodo esconde as concluídas de definição encerrada (a "da vez" continua visível até concluir). Fixtures: `scheduling-end.json`.

## Acesso e invariantes de participação

Cômodos comuns têm exatamente todos os moradores atuais. Casa toda é sempre comum e protegida contra saída individual. Uma saída de outro cômodo comum o torna privado imediatamente; saídas da casa não mudam a visibilidade dos comuns restantes.

Moradores veem dados básicos dos privados, mas as versões da escala (que contêm IDs de tarefas) são removidas das respostas para não participantes. Listagens de tarefas e comandos exigem vínculo atual, salvo leitura/conclusão das próprias pendências anteriores à vigência da saída. Essa exceção depende de continuar morando na casa e não autoriza novas tarefas.

A criação recebe o solicitante explicitamente. Assumir uma tarefa exige participação atual. A confirmação da última saída é um argumento obrigatório para permitir exclusão; a ausência de confirmação lança erro antes da mutação. Mudanças de moradores da casa verificam a mesma condição para privados que serão esvaziados.

## Atomicidade, concorrência e limites de produto

Os serviços são valores `Sendable`, sem acesso a Data, SwiftUI, relógio global ou banco. `TaskSchedulingService` recebe um `TaskSchedulingState` por valor e executa a transição sincronamente. IDs de novos registros são gerados apenas quando necessários; decisões matemáticas são determinísticas para os mesmos dados e calendário. No TypeScript, o serviço recebe `calendar` e `newID` por construtor e opera sobre um `SchedulingState` que o chamador já copiou (a transação publica a cópia só em caso de sucesso).

O repositório executa o serviço **dentro** de `MockStore.update` (Swift) ou `InMemoryStore.update` (TypeScript), sem `await` na transação. O store altera uma cópia e a publica somente se a closure termina com sucesso. Assim, falhas revertem todas as mutações, e duas criações concorrentes não calculam sobre o mesmo snapshot desatualizado. O actor é independente do MainActor. Essa decisão serializa cálculos pequenos da casa; em escala maior, migrar para snapshot versionado e commit com compare-and-swap, nunca leitura/cálculo/gravação sem validação de versão.

Ausências são respeitadas na publicação e conclusão. Se o próximo usuário estiver ausente, seu slot é consumido e a vez não é publicada. A criação avalia a fila nominal; o replanejamento por mudança de participantes avalia apenas a carga efetivamente atribuível. Retorno de férias, por si só, não dispara reotimização. Entradas e saídas de cômodos seguem a política descrita acima; entradas na casa incluem todos os cômodos comuns; saídas removem todos os vínculos atuais da pessoa. Cada comando de casa realiza um único replanejamento e um commit atômico.

A persistência é mockada e os dados de demonstração são gerados pelo planejador. Não há migração de backend. Entrada livre e saída confirmada estão disponíveis nos detalhes do cômodo; contratos revalidam acesso e confirmação dentro da transação.

## Implementação em TypeScript e verificação cruzada

Mapa dos arquivos (Swift `GrupuxoDomain/Services/` → TypeScript `backend/src/domain/services/`):

| Swift | TypeScript |
| --- | --- |
| `HungarianAlgorithm` (e `solve(costs:)`, `ScheduleCost`) | `hungarian.ts` (`solve`, `solveLexicographic`) |
| `TaskDistributionEngine`, `ProjectedWeek` | `task-distribution-engine.ts` |
| `HouseQueueOptimizer`, `QueueForecast` | `house-queue-optimizer.ts` |
| `TaskSchedulingService` + `RoomScheduling` | `task-scheduling-service.ts` |
| `FairnessCalculator`, `RotationCalculator`, `WeeklyLoadCalculator` | `fairness.ts`, `rotation.ts`, `weekly-load.ts` |
| `TaskEligibilityPolicy`, `TaskSwapEligibilityPolicy` | `eligibility.ts` |
| `TaskSuggestionCatalog` | `task-suggestion-catalog.ts` |
| `Calendar` do Foundation | `backend/src/domain/dates.ts` (`Intl.DateTimeFormat`) |

**Fixtures de referência.** `backend/tools/swift-fixtures` roda cenários no `GrupuxoDomain` e grava JSON em `backend/test/fixtures/` (cabeçalho `_generated` com o comando). Os testes `*.fixtures.test.ts` carregam cada fixture e comparam com `deepStrictEqual` (com `-0` ≡ `0`, único ajuste). Cobertura: grade de datas × fusos (`UTC`, `America/Sao_Paulo` incluindo a meia-noite inexistente de 2018, `Asia/Tokyo`, `America/New_York`, `Australia/Lord_Howe`, `Europe/London`) em todas as primitivas de calendário; Húngaro escalar e lexicográfico (empates, negativos, vazia, erros); motor; otimizador da casa; agendamento (criação por todas as recorrências, por conclusão, esporádica, escala compartilhada do cômodo, refresh após semanas puladas, conclusão e reabertura, ausência, entrada e saída em cômodo, saída do último participante, replanejamento da casa, horário de verão, encerrar tarefa) e políticas de elegibilidade e troca. IDs gerados na execução (aleatórios no Swift) são normalizados para `new-1`, `new-2`… por ordem de aparição. Para regenerar: `backend/tools/swift-fixtures/regenerate.sh`. Mudou o algoritmo? Altere o Swift (referência) e o TypeScript, regenere e rode `npm test`.

**Pontos que exigem cuidado no port** (todos verificados pelas fixtures):

- **Ponto flutuante.** O Húngaro e os custos usam `Double` (não há inteiros). A igualdade bit a bit com o Swift depende de manter a ordem exata das operações (`0.5 × (n1² + n2² + n3²)`, `2 × carga × saldo / 12`, somas em ordem de semana e usuário). O `number` do JS é um double IEEE-754, então basta replicar a ordem; as fixtures batem bit a bit, e o gerador produz arquivos idênticos nos builds de debug e de release do Swift (sem fusão `a*b+c`/FMA observável). Se isso mudar, é uma fixture quebrada para investigar, não para tolerar.
- **Empates.** Todo desempate é por ordem do texto do UUID (minúsculo no TypeScript; a ordem relativa é a mesma da maiúscula do Swift). Nenhuma regra depende da ordem de `Set`/`Dictionary`; a saída da casa percorre os cômodos em ordem de ID e há teste de que o resultado não depende dela.
- **Húngaro** só aceita matriz quadrada e finita (o Swift lança `invalidDistribution` para retangular, NaN e infinito; o TypeScript também).
- **Datas.** Semana começando na segunda, em dias de calendário local. Horário inexistente (lacuna do horário de verão) usa o deslocamento anterior à transição; horário repetido resolve para a primeira ocorrência; meia-noite inexistente começa o dia na primeira hora válida; mês e ano limitam o dia ao último do mês de destino (31/jan + 1 mês = 28/fev, 29/fev + 1 ano = 28/fev). `daysBetween`/`weeksBetween` contam períodos completos.
- **Inteiros grandes.** O Swift usa `Int` (64 bits) e `dividingFullWidth` em `firstWeeklyDate`; o TypeScript limita `WeeklyPeriodicity` a inteiros seguros (`Number.MAX_SAFE_INTEGER / 7` semanas) e usa `BigInt` só no produto intermediário `i × comprimento / n`. Datas fora do intervalo do `Date` do JS lançam `invalidDateInterval` (o Swift falha de forma equivalente em `Calendar`).
- **Falhas que no Swift travam.** `Dictionary(uniqueKeysWithValues:)` com chave duplicada e fatiamento com índice negativo abortam o processo no Swift; o TypeScript lança erro (`uniqueMap`, `invalidSchedule`).

## Extensão só do servidor: "minhas tarefas da semana"

`GetMyTasksUseCase` do TypeScript aceita `range: "week" | "all"` (padrão `all`, igual ao Swift e ao app). É um filtro de **leitura** sobre o que o repositório já devolve; não altera distribuição, saldo, elegibilidade nem calendário, por isso o Swift não muda e nenhuma fixture é regenerada. O app iOS continua listando tudo.

Com `week`, a janela é `[segunda 00:00, segunda seguinte 00:00)` no fuso da casa (`House.timezone`, via `createCalendar`; nunca somando 24 h, então semanas de horário de verão têm 167 h ou 169 h). A ocorrência ocupa `[availableAt, dueAt)`:

- Entra se o intervalo cruza a janela. Prazo exatamente na virada pertence à semana que termina; disponível na virada, à que começa.
- Sem prazo: pendente sempre entra (está aberta); concluída só entra se foi concluída dentro da janela.
- Atrasadas de semanas anteriores **não** entram (decisão de produto: só a semana corrente). Pendentes continuam antes das concluídas, ordenadas por prazo.

Se o app passar a consumir a API, ele ganha o mesmo parâmetro sem mudar o Swift.

## Verificação

Testes no target `grupuxoTests` verificam matrizes escalares e lexicográficas contra enumeração exaustiva, equilíbrio semanal entre filas, transições na próxima segunda-feira, elegibilidade de quem entra para tarefas criadas na mesma semana, snapshots, saída e reentrada, privacidade, idempotência, atomicidade, concorrência, exclusão confirmada do último participante, avanço por conclusão, ausência, legado e horário de verão. `WeeklyLoadCalculator` conta cada ocorrência uma vez, na semana de disponibilidade, desconsiderando planos substituídos e mantendo o esforço concluído com seu executor. O mesmo conjunto de cenários roda no TypeScript (`backend/test`), somado às fixtures de referência.

Executar:

```sh
xcodebuild test -project grupuxo/grupuxo.xcodeproj -scheme grupuxo \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -only-testing:grupuxoTests
swift test --package-path grupuxo/Packages/GrupuxoDomain
cd backend && npm test
```
