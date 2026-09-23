# Distribuição de tarefas on-device

## Objetivo e limites matemáticos

Distribuir fases de filas estáticas, reduzindo picos **semanais** de esforço e concentração de dificuldades. Não é um solucionador geral de Job Shop Scheduling: não modelamos duração, precedências ou recursos simultâneos.

Para uma tarefa nova, as outras filas ficam fixas. Em entradas e saídas de participantes, `HouseQueueOptimizer` reotimiza as filas da casa a partir da próxima segunda-feira. O Húngaro encontra a bijeção de menor custo **de cada matriz**, não um ótimo global de todas as tarefas da casa. A busca conjunta tem duas configurações iniciais e até 20 passagens por configuração, com tarefas ordenadas por UUID para repetibilidade.

## Estado e invariantes

- `TaskDefinition`: configuração e `rotationQueue`, com cada participante exatamente uma vez; vazia quando não há elegíveis. `pendingRotation` guarda a fila por conclusão que passa a valer na próxima segunda-feira.
- `currentRotationIndex`: posição da **próxima ocorrência ainda não publicada**. Não é o índice de uma ocorrência pendente: existem várias ocorrências futuras já publicadas.
- `nextScheduledAt`: data da próxima ocorrência de calendário ainda não publicada; `nil` para esporádicas e tarefas que avançam por conclusão.
- `TaskOccurrence`: execução, janela de disponibilidade e `effortSnapshot`. Alterar o esforço da definição não muda snapshots existentes.
- `TaskAssignment`: histórico de atribuições. Há no máximo uma atribuição ativa por ocorrência; uma atribuição futura só vale a partir de `assignedAt`. `supersededAt` cancela um plano substituído sem produzir `endedAt < assignedAt`; `isActive` exclui atribuições concluídas/devolvidas e substituídas.
- `RoomMembership.fairnessDebt`: saldo relativo ao cômodo, positivo para quem executou mais que sua cota. Não é moeda nem placar. O vínculo é preservado na saída e reutilizado na reentrada, sem zerar saldo.
- `RoomMembership.leftAt`: término do acesso geral ao cômodo. `rotationChanges` registra mudanças de participação por data de vigência. Registros legados sem essas propriedades mantêm participação e acesso originais.

Membros da fila pertencem ao cômodo e à casa. Tarefas privadas restringem a fila ao proprietário elegível. IDs são ordenados por UUID antes da otimização; empates no solucionador são resolvidos pela ordem dos índices.

## Saldo de justiça

Para esforço `E`, executor `U` e conjunto de `M` pessoas elegíveis no momento da conclusão:

```
impacto(U) = E - E/M
impacto(outro) = -E/M
```

O esforço vem da ocorrência. Pessoas de outros cômodos, fora da casa, em ausência naquele instante ou sem acesso à tarefa privada não recebem impacto. Ausências usam intervalo `[startsAt, endsAt)`.

`FairnessCalculator` deduplica os IDs recebidos, exige esforço 1...3 e executor no conjunto. A soma dos impactos é zero, dentro da precisão de `Double`; um único membro recebe zero. A transação rejeita saldos não finitos e vínculos duplicados no cômodo.

Concluir novamente pela mesma pessoa é idempotente. Outra pessoa não pode se apropriar da conclusão. Uma ocorrência futura não pode ser concluída antecipadamente. Conclusão exige uma atribuição ativa ao executor e elegibilidade atual. A exceção é uma pendência preservada anterior à saída efetiva: o executor continua autorizado, desde que pertença à casa e não esteja ausente. Ele é incluído uma vez no conjunto usado para o saldo, junto aos participantes elegíveis na conclusão.

## Horizonte e função de custo

O calendário é injetado; a composição padrão usa calendário gregoriano e o fuso do dispositivo. A semana começa na segunda-feira. Datas avançam por componentes de calendário, nunca somando 604800 segundos, preservando transições de horário de verão.

Na criação, o horizonte é `[início da semana de referência, início + 12 semanas)`. A primeira ocorrência começa na data de criação. Na recorrência semanal, as seguintes começam na segunda-feira da semana calculada pelo intervalo, com prazo até a próxima ocorrência. Recorrências diárias, mensais e anuais avançam pelo respectivo componente de calendário. A primeira semana pode ser parcial. Intervalo 2 gera seis ocorrências; intervalos maiores que o horizonte geram apenas a primeira.

A projeção inclui ocorrências pendentes atribuídas de **todos os cômodos da casa**, por usuário e semana de disponibilidade, com esforço snapshot. Históricos de reassunção não duplicam carga. Concluídas não entram novamente: seu efeito histórico já está no saldo. Pendências anteriores ao horizonte continuam consultáveis, mas não são movidas artificialmente para outra semana.

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

## Calendário versus conclusão

- `.calendarRotation` e `.balancedAutomatically` exigem recorrência com intervalo positivo (diária, semanal, mensal ou anual); usam o mesmo planejador de fases.
- `.afterCompletion` normaliza recorrência para `.none`. Gera somente uma ocorrência. A escolha inicial usa uma contribuição na semana atual, e as demais posições têm empate estável. Cada conclusão publica exatamente uma sucessora e consome o próximo slot estático. Não se inventa uma frequência semanal para tarefas sem prazo.
- `.sporadic` exige `.none` e `.selfAssigned`; nasce sem responsável, fora do Húngaro. Assumir/devolver não altera saldo. Concluir altera saldo e não cria sucessora. Como não possui fila, sua elegibilidade usa a participação atual no cômodo, inclusive antes da vigência da próxima rotação.
- `.recurring + .selfAssigned` não é uma combinação aceita na criação nova.

`RefreshTaskScheduleUseCase` completa a janela de 12 semanas a partir de `nextScheduledAt`. Pular semanas sem abrir o app materializa também os períodos intermediários, preservando fase e histórico. Repetir o refresh não duplica dados. Consultas pessoais e esporádicas acionam refresh; outros clientes podem chamar o caso de uso explicitamente. Isso não é execução em background com o aplicativo fechado.

## Entrada e saída de participantes

`AddRoomMemberUseCase` e `RemoveRoomMemberUseCase` executam vínculo, filas e atribuições no mesmo commit. Exigem participação na casa e são idempotentes pelo par cômodo/usuário e estado desejado.

A vigência da nova rotação é sempre a segunda-feira **imediatamente seguinte**, mesmo quando o comando acontece numa segunda. Exemplo: uma alteração na quarta-feira, 16/09/2026, vale em 21/09/2026; uma alteração em 21/09 vale em 28/09. Entrar na escala não garante uma tarefa já na primeira semana.

O serviço materializa primeiro o calendário anterior, inclusive semanas perdidas sem abrir o app. Depois registra a mudança de participação e replaneja as ocorrências não concluídas com `availableAt >= vigência`. A semana atual, atrasados e concluídos permanecem intactos, incluindo IDs, responsáveis e snapshots. Nas ocorrências futuras, preserva IDs, datas, prazos e esforço; apenas atribuições e status podem mudar. Atribuições iguais não geram novos registros.

O acesso ao cômodo muda no comando. Quem sai mantém acesso específico às suas pendências preservadas e pode concluí-las depois da vigência, sem poder consultar as demais tarefas de um cômodo privado. Alterações repetidas na mesma semana consolidam a composição da mesma segunda-feira. Reentrar não apaga o histórico nem o saldo.

### Reequilíbrio da casa

Todas as filas de calendário da casa são consideradas. Tarefas privadas têm apenas o proprietário elegível, portanto não podem ser distribuídas a terceiros. A carga das tarefas fora do recálculo permanece fixa. A projeção usa 12 semanas a partir da vigência e snapshots individuais, incluindo restrições de ausência.

O custo é uma tupla comparada em ordem lexicográfica, sem permitir que um critério secundário piore o anterior:

1. Soma dos quadrados das cargas semanais por morador.
2. Soma dos quadrados das quantidades semanais de tarefas de esforço 1, 2 e 3.
3. `Σ 2 × cargaSemanal × saldoDaCasa / 12`, usando a soma dos saldos dos cômodos; equivale ao termo variável da carga ajustada ao quadrado quando a carga primária empata.
4. Número de atribuições alteradas em relação ao plano publicado.

Para cada fila, remover sua contribuição da projeção, construir a matriz usuário/posição e resolver pelo Húngaro lexicográfico. Aceitar somente melhoria estrita do custo da casa. Repetir até estabilizar ou atingir 20 passagens. Executar a busca a partir das filas antigas adaptadas e também de filas reconstruídas por UUID; conservar o melhor resultado, nunca pior que a configuração adaptada. Empates do solucionador seguem índices derivados de UUID; entre resultados de mesmo custo, preservar o primeiro.

Cada participante aparece uma vez por ciclo. Essa restrição e frequências distintas podem impedir igualdade perfeita. A busca é determinística e encontra melhorias locais; não promete ótimo global. O horizonte limita a avaliação, mas todas as ocorrências futuras já publicadas recebem a continuidade da fila escolhida, inclusive as que estiverem além dele. O cursor final aponta para a próxima ocorrência ainda não publicada.

### Tarefas por conclusão e cômodos vazios

Tarefas por conclusão não recebem datas fictícias. Sua ocorrência pendente permanece com o responsável atual; a fila sucessora fica em `pendingRotation` até a vigência. A adaptação preserva a ordem restante e acrescenta os novos participantes em ordem de UUID. Não há otimização temporal dessas sucessoras sem conhecer quando serão concluídas.

Sem participantes elegíveis, a fila fica vazia e o calendário continua gerando ocorrências sem responsável. Em tarefas por conclusão, existe apenas uma pendência: ao retornar um participante, o refresh na vigência pode atribuí-la sem duplicar a ocorrência. Pendências antigas atribuídas não são tomadas do responsável.

Definições legadas atingidas pelo replanejamento são inicializadas a partir da recorrência e da última ocorrência conhecida, mantendo as ocorrências antigas. Sem ocorrência anterior, o calendário começa na vigência. Tarefas legadas `.selfAssigned` continuam fora das filas automáticas.

## Atomicidade, concorrência e limites de produto

Os serviços são valores `Sendable`, sem acesso a Data, SwiftUI, relógio global ou banco. `TaskSchedulingService` recebe um `TaskSchedulingState` por valor e executa a transição sincronamente. IDs de novos registros são gerados apenas quando necessários; decisões matemáticas são determinísticas para os mesmos dados e calendário.

O repositório executa o serviço **dentro** de `MockStore.update`, sem `await` na transação. O store altera uma cópia e a publica somente se a closure termina com sucesso. Assim, falhas revertem todas as mutações, e duas criações concorrentes não calculam sobre o mesmo snapshot desatualizado. O actor é independente do MainActor. Essa decisão serializa cálculos pequenos da casa; em escala maior, migrar para snapshot versionado e commit com compare-and-swap, nunca leitura/cálculo/gravação sem validação de versão.

Ausências são respeitadas na publicação e conclusão. Se o próximo usuário estiver ausente, seu slot é consumido e a ocorrência fica sem responsável. A criação avalia a fila nominal; o replanejamento por mudança de participantes avalia apenas a carga efetivamente atribuível. Retorno de férias, por si só, não dispara reotimização. Entradas e saídas de cômodos seguem a política descrita acima; sair da casa é uma operação distinta, fora deste fluxo.

A persistência atual é mockada. Os novos campos opcionais são compatíveis com decodificação de registros anteriores. Autorização administrativa de entrada/saída, migração de um backend real e novas telas de gestão continuam fora desta entrega.

## Verificação

Testes no target `grupuxoTests` verificam matrizes escalares e lexicográficas contra enumeração exaustiva, equilíbrio semanal entre filas, transições na próxima segunda-feira, snapshots, saída e reentrada, privacidade, idempotência, atomicidade, concorrência, cômodo vazio, avanço por conclusão, ausência, legado e horário de verão. `WeeklyLoadCalculator` conta cada ocorrência uma vez, na semana de disponibilidade, desconsiderando planos substituídos e mantendo o esforço concluído com seu executor.

Executar:

```sh
xcodebuild test -project grupuxo/grupuxo.xcodeproj -scheme grupuxo \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -only-testing:grupuxoTests
```
