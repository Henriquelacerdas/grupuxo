# Distribuição de tarefas on-device

## Objetivo e limites matemáticos

Distribuir fases de filas estáticas, reduzindo picos **semanais** de esforço e concentração de dificuldades. Não é um solucionador geral de Job Shop Scheduling: não modelamos duração, precedências ou recursos simultâneos.

Para uma tarefa nova, as outras filas ficam fixas. O Húngaro encontra a bijeção de menor custo **dessa matriz**, não um ótimo global de todas as tarefas da casa. A entrada de um morador é uma busca gulosa, dependente da ordem de processamento das tarefas (ordenadas por UUID para repetibilidade).

## Estado e invariantes

- `TaskDefinition`: configuração e `rotationQueue`, com cada participante exatamente uma vez.
- `currentRotationIndex`: posição da **próxima ocorrência ainda não publicada**. Não é o índice de uma ocorrência pendente: existem várias ocorrências futuras já publicadas.
- `nextScheduledAt`: data da próxima ocorrência de calendário ainda não publicada; `nil` para esporádicas e tarefas que avançam por conclusão.
- `TaskOccurrence`: execução, janela de disponibilidade e `effortSnapshot`. Alterar o esforço da definição não muda snapshots existentes.
- `TaskAssignment`: histórico de atribuições. Há no máximo uma atribuição ativa por ocorrência; uma atribuição futura só vale a partir de `assignedAt`.
- `RoomMembership.fairnessDebt`: saldo relativo ao cômodo, positivo para quem executou mais que sua cota. Não é moeda nem placar.

Membros da fila pertencem ao cômodo e à casa. Tarefas privadas restringem a fila ao proprietário elegível. IDs são ordenados por UUID antes da otimização; empates no solucionador são resolvidos pela ordem dos índices.

## Saldo de justiça

Para esforço `E`, executor `U` e conjunto de `M` pessoas elegíveis no momento da conclusão:

```
impacto(U) = E - E/M
impacto(outro) = -E/M
```

O esforço vem da ocorrência. Pessoas de outros cômodos, fora da casa, em ausência naquele instante ou sem acesso à tarefa privada não recebem impacto. Ausências usam intervalo `[startsAt, endsAt)`.

`FairnessCalculator` deduplica os IDs recebidos, exige esforço 1...3 e executor no conjunto. A soma dos impactos é zero, dentro da precisão de `Double`; um único membro recebe zero. A transação rejeita saldos não finitos e vínculos duplicados no cômodo.

Concluir novamente pela mesma pessoa é idempotente. Outra pessoa não pode se apropriar da conclusão. Uma ocorrência futura não pode ser concluída antecipadamente. Conclusão exige uma atribuição ativa ao executor e elegibilidade atual.

## Horizonte e função de custo

O calendário é injetado; a composição padrão usa calendário gregoriano e o fuso do dispositivo. A semana começa na segunda-feira. Datas avançam por componentes de calendário, nunca somando 604800 segundos, preservando transições de horário de verão.

O horizonte é `[início da semana de referência, início + 12 semanas)`. A primeira ocorrência começa na data de criação; as seguintes começam na segunda-feira da semana calculada pelo intervalo, com prazo até a próxima ocorrência. A primeira semana pode ser parcial. Intervalo 2 gera seis ocorrências; intervalos maiores que o horizonte geram apenas a primeira.

A projeção inclui ocorrências pendentes atribuídas de **todos os cômodos da casa**, por usuário e semana de disponibilidade, com esforço snapshot. Históricos de reassunção não duplicam carga. Concluídas não entram novamente: seu efeito histórico já está no saldo. Pendências anteriores ao horizonte continuam consultáveis, mas não são movidas artificialmente para outra semana.

Para cada usuário `u` e semana `w`:

```
C(u,w) = (cargaPendente(u,w) + novasCargas(u,w) + saldoDoCômodo(u)/12)²
       + 0.5 × (quantidadeEsforço1² + quantidadeEsforço2² + quantidadeEsforço3²)
Custo = soma de C(u,w) nas 12 semanas
```

Amortizar o saldo por 12 evita tratá-lo como uma nova carga histórica integral a cada semana. Os pesos são 1 e 0,5, definidos no serviço de custo. Somar primeiro a carga de todo o horizonte e só então elevá-la ao quadrado não detectaria picos semanais.

Limitação deliberada: se todos os slots tiverem a mesma quantidade de ocorrências, o termo de saldo constante não diferencia suas fases; a carga semanal e os contadores decidem a ordem. O saldo influencia cotas desiguais e a primeira atribuição de tarefas sem calendário. Não prometemos compensação imediata ou quitação do saldo mantendo todas as atribuições publicadas fixas.

## Húngaro

`HungarianAlgorithm.solve(matrix:)` recebe apenas `[[Double]]` e devolve `resultado[linha] = coluna`. Valida matriz quadrada e finita, aceita custos negativos e matriz vazia. Implementação por potenciais e caminhos aumentantes: O(K³), memória auxiliar O(K); a matriz ocupa O(K²).

Para `K` pessoas, cada coluna é uma posição da fila. A linha do usuário e a coluna do slot contêm o custo semanal desse usuário se ele receber as ocorrências de índices `slot, slot+K, slot+2K...`. Esses conjuntos são fixos antes de atribuir usuários. O custo é separável por usuário/slot, portanto o Húngaro é válido.

A matriz é construída em O(K² × (H+P)), com `H=12` semanas e `P` ocorrências da tarefa. Os loops manipulam números e pequenos buffers. UUIDs de ocorrências e atribuições só são criados na publicação, fora da otimização.

## Calendário versus conclusão

- `.calendarRotation` e `.balancedAutomatically` exigem recorrência semanal com intervalo positivo; usam o mesmo planejador de fases.
- `.afterCompletion` normaliza recorrência para `.none`. Gera somente uma ocorrência. A escolha inicial usa uma contribuição na semana atual, e as demais posições têm empate estável. Cada conclusão publica exatamente uma sucessora e consome o próximo slot estático. Não se inventa uma frequência semanal para tarefas sem prazo.
- `.sporadic` exige `.none` e `.selfAssigned`; nasce sem responsável, fora do Húngaro. Assumir/devolver não altera saldo. Concluir altera saldo e não cria sucessora.
- `.recurring + .selfAssigned` não é uma combinação aceita na criação nova.

`RefreshTaskScheduleUseCase` completa a janela de 12 semanas a partir de `nextScheduledAt`. Pular semanas sem abrir o app materializa também os períodos intermediários, preservando fase e histórico. Repetir o refresh não duplica dados. Consultas pessoais e esporádicas acionam refresh; outros clientes podem chamar o caso de uso explicitamente. Isso não é execução em background com o aplicativo fechado.

## Entrada de morador

`AddRoomMemberUseCase` adiciona vínculo com saldo zero e atualiza as filas no mesmo commit. Exige participação na casa e é idempotente pelo par cômodo/usuário.

Para cada tarefa pública recorrente com fila inicializada, o motor testa inserir o novo membro depois do cursor da próxima ocorrência não publicada. Preserva a ordem relativa dos antigos e também seu próximo turno. A avaliação usa as primeiras 12 semanas ainda não publicadas; projetar somente a janela já persistida não distinguiria candidatos.

A projeção das outras tarefas inclui sua continuação virtual usando as filas já atualizadas nos passos anteriores. Essa continuação não cria ocorrências, UUIDs ou atribuições persistidas. As ocorrências e responsáveis já publicados permanecem intactos. Com 12 semanas já publicadas, a primeira participação do novato pode ocorrer apenas depois dessa janela: é a consequência de priorizar a previsibilidade solicitada.

Para tarefas sem calendário, apenas a próxima ocorrência é estimável; a inserção tende a um empate estável. Não há promessa de otimização temporal de conclusões desconhecidas.

## Atomicidade, concorrência e limites de produto

Os serviços são valores `Sendable`, sem acesso a Data, SwiftUI, relógio global ou banco. `TaskSchedulingService` recebe um `TaskSchedulingState` por valor e executa a transição sincronamente. IDs de novos registros são gerados apenas quando necessários; decisões matemáticas são determinísticas para os mesmos dados e calendário.

O repositório executa o serviço **dentro** de `MockStore.update`, sem `await` na transação. O store altera uma cópia e a publica somente se a closure termina com sucesso. Assim, falhas revertem todas as mutações, e duas criações concorrentes não calculam sobre o mesmo snapshot desatualizado. O actor é independente do MainActor. Essa decisão serializa cálculos pequenos da casa; em escala maior, migrar para snapshot versionado e commit com compare-and-swap, nunca leitura/cálculo/gravação sem validação de versão.

Ausências são respeitadas na publicação e conclusão. Se o próximo usuário estiver ausente, seu slot é consumido e a ocorrência fica sem responsável; a otimização ainda considera a fila nominal. Reatribuição, retorno de férias e remoção de moradores permanecem políticas de produto abertas e não reescrevem atribuições existentes automaticamente.

Definições legadas do seed sem `nextScheduledAt` continuam como exemplos estáticos. O algoritmo completo é aplicado a novas criações. Na conclusão de uma definição legada `.afterCompletion`, sua fila é inicializada uma vez. Migração de persistência real, autorização de criação/entrada em cômodo privado e regras de edição continuam fora desta entrega mockada.

## Verificação

25 testes no target `grupuxoTests`, validados no iPhone 17 Pro / iOS 26.5 com Swift 6: matriz conhecida, empates, custos negativos, entradas inválidas, comparação com todas as permutações para K=1...6, fases semanais, justiça, criação/refresh, snapshots, atomicidade, concorrência, tarefas privadas, esporádicas, avanço por conclusão, ausência, transição de horário de verão e compatibilidade dos controles do editor. Executar:

```sh
xcodebuild test -project grupuxo/grupuxo.xcodeproj -scheme grupuxo \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -only-testing:grupuxoTests
```
