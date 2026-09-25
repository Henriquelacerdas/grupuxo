# Descrição do projeto

Aplicativo iOS em SwiftUI para organizar tarefas domésticas em casas compartilhadas e repúblicas. O objetivo é reduzir a carga mental de criar, distribuir, lembrar e acompanhar tarefas, tornando a divisão de responsabilidades mais clara e justa.

A primeira entrega terá arquitetura, navegação e dados mockados. O usuário deve conseguir abrir o app e entender a proposta mesmo sem autenticação, backend, sincronização ou integração com WhatsApp funcionando. Em uma etapa posterior, o login será feito com Sign in with Apple.

## Estrutura da casa

Uma casa possui moradores, cômodos e tarefas.

- Toda tarefa pertence a um cômodo.
- Existe um cômodo padrão chamado **Casa toda**, usado para tarefas que envolvem a residência como um todo.
- Cômodos comuns necessariamente incluem todos os moradores atuais da casa.
- Cômodos privados podem ter um ou mais participantes. Todos os moradores veem sua existência e podem entrar livremente; somente participantes consultam e criam tarefas.
- Não existe privacidade individual de tarefas nem aprovação de entrada.
- Sair de um cômodo comum o torna privado imediatamente. Reentrar não o torna comum automaticamente.
- A última saída exige o aviso “Atenção: Você é o último participante desse cômodo. Se sair, o cômodo e suas tarefas serão excluídos.” e confirmação em “Sair e excluir”. Cancelar preserva todos os dados.
- **Casa toda** é uma exceção: permanece comum, inclui todos e não pode ser excluído ou abandonado individualmente.
- Novos moradores entram automaticamente em todos os cômodos comuns. Ao sair da casa, deixam todos os cômodos; cômodos comuns permanecem comuns. Se isso esvaziar um privado, sua exclusão também exige confirmação.
- Todo cômodo possui periodicidade **n execuções a cada x semanas** e uma quantidade configurável de responsáveis simultâneos, inicialmente 1. A quantidade efetiva não supera os participantes.
- Os responsáveis são escolhidos pela escala e permanecem durante as x semanas. As n execuções são espaçadas automaticamente pelos dias desse período.

## Áreas do app

### Tarefas

A área de tarefas mostra as responsabilidades do usuário: cômodos, tarefas periódicas, tarefas gerais e esporádicas já assumidas.

O usuário pode consultar prazo, esforço, responsável e estado da tarefa, além de marcar tarefas como concluídas.

**Não é possível criar tarefas nessa área.** A criação de tarefas é exclusiva de Gerenciar casa.

### Gerenciar casa

Essa área centraliza a organização coletiva da casa.

O usuário pode:

- Ver todos os cômodos, entrar nos privados e sair dos participantes, exceto Casa toda.
- Criar, editar e excluir cômodos, conforme suas permissões.
- Criar e editar tarefas.
- Acessar o card de tarefas esporádicas.
- Acessar futuramente sugestões de tarefas para cômodos.

Tarefas esporádicas mantêm vínculo com um cômodo nos dados, mas não aparecem dentro dele na interface. Elas ficam em um card próprio na tela de gestão da casa.

### Configurações e notificações

Configurações reúne informações do perfil e da casa, saída da casa e modo férias. A foto de perfil não é selecionada manualmente pelo usuário.

Notificações registram eventos relevantes, como tarefas atrasadas, alterações em cômodos, entradas e saídas de cômodos e, futuramente, solicitações de troca de tarefas.

## Tarefas

Toda tarefa possui:

- Nome.
- Cômodo obrigatório.
- Descrição opcional.
- Esforço de 1 a 3.
- Configuração de periodicidade e distribuição.

O esforço representa carga de trabalho interna. Ele serve para equilibrar responsabilidades e não deve aparecer como pontuação competitiva ou gamificação. Existe uma separação estrita entre a **definição da tarefa** (a regra e a fila) e a **ocorrência** (a execução histórica ou pendente).

### Rotação por calendário

Tarefas e responsabilidades que seguem uma rotação com prazo trocam de responsável conforme o calendário, mesmo que a pessoa anterior não tenha concluído a tarefa.

Os períodos de cômodos são ancorados em segunda-feira, com n e x positivos e n ≤ 7x (no máximo uma execução por dia). Para a execução i, o deslocamento em dias é floor(i × 7x / n). Uma criação no meio do período não gera execuções passadas.

Tarefas podem adotar “Mesma periodicidade do cômodo”, outra periodicidade semanal ou frequências diária, mensal e anual. A modalidade semanal anterior de intervalo x equivale a 1 execução a cada x semanas; frações não são reduzidas.

Tarefas de mesma periodicidade compartilham obrigatoriamente os responsáveis do cômodo. Com um responsável, todas são dele. Com vários, um guloso distribui tarefas da mais trabalhosa para a menos trabalhosa entre posições responsáveis de menor carga, antes de associar os nomes pelo Húngaro. As demais tarefas mantêm filas independentes.

### Tarefas que mudam após conclusão

Uma tarefa criada sem rotação por calendário só muda de responsável depois que a pessoa responsável a conclui.

A fila inicial considera a carga semanal e o saldo dos moradores elegíveis. Depois, cada conclusão passa ao próximo slot dessa fila estática, mantendo previsibilidade. Só existe uma ocorrência ativa; não são inventadas datas para futuras conclusões.

### Delegação automática e Balanceamento

A delegação automática de tarefas periódicas opera localmente (on-device) e utiliza um modelo de **Projeção de Horizonte (Rolling Horizon)** focado no equilíbrio de fases.

O algoritmo segue as seguintes premissas:

1. **Saldo de Justiça (Fairness Debt):** O histórico não é a soma absoluta de quem trabalhou mais. É baseado na referência do cômodo. Ao concluir uma tarefa de esforço `E` em um cômodo com `M` membros elegíveis, o executor recebe um saldo de `+ (E - (E/M))`, enquanto os demais recebem `- (E/M)`. Pessoas de fora do cômodo não são afetadas.
2. **Geração da Fila Inicial (Algoritmo Húngaro):** Ao criar uma tarefa independente, o sistema projeta a carga já agendada da casa para as próximas 12 semanas. Ele simula o custo de colocar cada participante em cada posição (slot) da nova fila rotativa, utilizando uma **função de custo quadrática** (que pune picos de estresse em uma mesma semana). O Algoritmo Húngaro encontra a permutação de menor custo para essa tarefa, mantendo as outras filas fixas. Isso não garante um ótimo global da casa.
3. **Entrada e Saída de Participantes:** A nova composição das filas vale na segunda-feira imediatamente seguinte. O sistema reequilibra tarefas futuras de toda a casa, respeitando os participantes de cada cômodo e a privacidade. Pode mudar atribuições já publicadas a partir dessa data, inclusive os responsáveis de um período ainda em andamento; preserva a semana atual, atrasados e concluídos. Entrar na fila não garante tarefa já na primeira semana. Quem sai continua podendo concluir suas pendências preservadas.
4. **Atualizações Estruturais:** Entradas e saídas disparam busca de melhoria entre as filas da casa, priorizando igualdade de esforço semanal. A busca não garante ótimo global nem reordena continuamente o cotidiano. A saída do último participante exclui o cômodo e suas tarefas após confirmação; reentradas em cômodos existentes preservam o saldo. Filas por conclusão mudam na mesma vigência, sem inventar datas para futuras conclusões.

## Tarefas esporádicas

Tarefas esporádicas são tarefas sem recorrência previsível, como trocar uma resistência ou resolver um problema pontual. São independentes do fluxo algorítmico tradicional.

Elas aparecem no card próprio de Gerenciar casa. Um participante do cômodo pode criar, visualizar, assumir, concluir ou devolver uma tarefa ao card. Quem saiu mantém somente o acesso específico às próprias pendências preservadas enquanto ainda mora na casa.

Ao concluir uma tarefa esporádica, a pessoa recebe o ajuste de justiça correspondente ao esforço realizado, no cômodo da tarefa. Esse saldo interno influencia futuras otimizações. Não há pulo automático da próxima tarefa de mesmo esforço: isso conflitaria com a preservação das atribuições publicadas e compensaria o mesmo trabalho por dois mecanismos.

Assumir ou devolver uma tarefa esporádica sem concluí-la não altera o saldo.

## Modo férias

Ausências registradas impedem novas atribuições ao morador durante o período. Nesta implementação, seu turno nominal pode ficar sem responsável; filas e atribuições já publicadas não são recalculadas automaticamente. A interface de férias e a regra de redistribuição ainda precisam ser definidas.

Pendências por conclusão são preservadas, e sua fila sucessora muda na próxima segunda-feira. Quem deixa a casa perde acesso; a redistribuição imediata dessas pendências e o retorno de férias ainda são evoluções futuras.

## Avaliação da casa

Moradores podem avaliar os cômodos comuns da casa. Cômodos privados não participam da avaliação.

- Casas com 2 ou 3 moradores recebem resumo a cada 3 semanas.
- Casas com 4 ou mais moradores recebem resumo semanal.

Não há promessa de anonimato absoluto das avaliações. A frequência da coleta, a janela para responder e o comportamento para casas com uma pessoa ainda serão definidos.

## Integrações futuras

O WhatsApp será uma ponte para consultar tarefas, receber lembretes e, futuramente, registrar conclusões sem precisar abrir o app. A viabilidade, os custos e o escopo da integração dependem de um spike técnico.

Widget, Lembretes, troca de tarefas, Siri, NFC, lista de mercado e controle financeiro são evoluções futuras e não devem bloquear a primeira entrega.

## Decisões abertas

Ainda precisam ser definidas:

- Backend, banco de dados, sincronização e versão mínima de iOS.
- Fuso persistido por casa e regras de atraso. O mock usa calendário gregoriano, fuso injetado do dispositivo e semanas iniciadas na segunda-feira.
- Redistribuição imediata de pendências de quem deixa a casa e redistribuição em férias.
- Política de compensação mais imediata, caso necessária, sem crédito duplicado ou quebra de atribuições publicadas.
- Permissões de edição e exclusão manual de cômodos; a exclusão por última saída segue a regra acima.
- Regras detalhadas de coleta e exibição das avaliações.
