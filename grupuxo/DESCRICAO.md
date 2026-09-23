# Descrição do projeto

Aplicativo iOS em SwiftUI para organizar tarefas domésticas em casas compartilhadas e repúblicas. O objetivo é reduzir a carga mental de criar, distribuir, lembrar e acompanhar tarefas, tornando a divisão de responsabilidades mais clara e justa.

A primeira entrega terá arquitetura, navegação e dados mockados. O usuário deve conseguir abrir o app e entender a proposta mesmo sem autenticação, backend, sincronização ou integração com WhatsApp funcionando. Em uma etapa posterior, o login será feito com Sign in with Apple.

## Estrutura da casa

Uma casa possui moradores, cômodos e tarefas.

- Toda tarefa pertence a um cômodo.
- Existe um cômodo padrão chamado **Casa toda**, usado para tarefas que envolvem a residência como um todo.
- Cômodos comuns incluem os moradores da casa na rotação por padrão, mas seus participantes podem ser alterados.
- Cômodos privados podem ter uma ou mais pessoas. Quem não participa não vê suas tarefas.
- Cômodos privados não aparecem explicitamente na tela principal de gestão da casa. Existe uma área específica para solicitar entrada em um cômodo privado.
- As permissões de edição, exclusão e aprovação de entrada em cômodos privados ainda serão detalhadas.

## Áreas do app

### Tarefas

A área de tarefas mostra as responsabilidades do usuário: cômodos, tarefas periódicas, tarefas gerais e esporádicas já assumidas.

O usuário pode consultar prazo, esforço, responsável e estado da tarefa, além de marcar tarefas como concluídas.

**Não é possível criar tarefas nessa área.** A criação de tarefas é exclusiva de Gerenciar casa.

### Gerenciar casa

Essa área centraliza a organização coletiva da casa.

O usuário pode:

- Ver e gerenciar os cômodos comuns e Casa toda.
- Criar, editar e excluir cômodos, conforme suas permissões.
- Criar e editar tarefas.
- Acessar o card de tarefas esporádicas.
- Acessar futuramente sugestões de tarefas para cômodos.

Tarefas esporádicas mantêm vínculo com um cômodo nos dados, mas não aparecem dentro dele na interface. Elas ficam em um card próprio na tela de gestão da casa.

### Configurações e notificações

Configurações reúne informações do perfil e da casa, saída da casa e modo férias. A foto de perfil não é selecionada manualmente pelo usuário.

Notificações registram eventos relevantes, como tarefas atrasadas, alterações em cômodos, pedidos de entrada em cômodos privados e, futuramente, solicitações de troca de tarefas.

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

A rotação semanal de cômodos começa na segunda-feira. A ordem de responsáveis e a distribuição quando há mais cômodos que moradores ou mais moradores que cômodos devem ser calculadas automaticamente.

### Tarefas que mudam após conclusão

Uma tarefa criada sem rotação por calendário só muda de responsável depois que a pessoa responsável a conclui.

A fila inicial considera a carga semanal e o saldo dos moradores elegíveis. Depois, cada conclusão passa ao próximo slot dessa fila estática, mantendo previsibilidade. Só existe uma ocorrência ativa; não são inventadas datas para futuras conclusões.

### Delegação automática e Balanceamento

A delegação automática de tarefas periódicas opera localmente (on-device) e utiliza um modelo de **Projeção de Horizonte (Rolling Horizon)** focado no equilíbrio de fases.

O algoritmo segue as seguintes premissas:

1. **Saldo de Justiça (Fairness Debt):** O histórico não é a soma absoluta de quem trabalhou mais. É baseado na referência do cômodo. Ao concluir uma tarefa de esforço `E` em um cômodo com `M` membros elegíveis, o executor recebe um saldo de `+ (E - (E/M))`, enquanto os demais recebem `- (E/M)`. Pessoas de fora do cômodo não são afetadas.
2. **Geração da Fila Inicial (Algoritmo Húngaro):** Ao criar uma tarefa, o sistema projeta a carga já agendada da casa para as próximas 12 semanas. Ele simula o custo de colocar cada participante em cada posição (slot) da nova fila rotativa, utilizando uma **função de custo quadrática** (que pune picos de estresse em uma mesma semana). O Algoritmo Húngaro encontra a permutação de menor custo para essa tarefa, mantendo as outras filas fixas. Isso não garante um ótimo global da casa.
3. **Entrada e Saída de Participantes:** A nova composição das filas vale na segunda-feira imediatamente seguinte. O sistema reequilibra tarefas futuras de toda a casa, respeitando os participantes de cada cômodo e a privacidade. Pode mudar atribuições já publicadas a partir dessa data; preserva a semana atual, atrasados e concluídos. Entrar na fila não garante tarefa já na primeira semana. Quem sai continua podendo concluir suas pendências preservadas.
4. **Atualizações Estruturais:** Entradas e saídas disparam busca de melhoria entre as filas da casa, priorizando igualdade de esforço semanal. A busca não garante ótimo global nem reordena continuamente o cotidiano. Cômodos vazios mantêm tarefas sem responsável; reentradas preservam o saldo. Filas por conclusão mudam na mesma vigência, sem inventar datas para futuras conclusões.

## Tarefas esporádicas

Tarefas esporádicas são tarefas sem recorrência previsível, como trocar uma resistência ou resolver um problema pontual. São independentes do fluxo algorítmico tradicional.

Elas aparecem no card próprio de Gerenciar casa. Um morador pode criar, visualizar, assumir, concluir ou devolver uma tarefa ao card.

Ao concluir uma tarefa esporádica, a pessoa recebe o ajuste de justiça correspondente ao esforço realizado, no cômodo da tarefa. Esse saldo interno influencia futuras otimizações. Não há pulo automático da próxima tarefa de mesmo esforço: isso conflitaria com a preservação das atribuições publicadas e compensaria o mesmo trabalho por dois mecanismos.

Assumir ou devolver uma tarefa esporádica sem concluí-la não altera o saldo.

## Modo férias

Ausências registradas impedem novas atribuições ao morador durante o período. Nesta implementação, seu turno nominal pode ficar sem responsável; filas e atribuições já publicadas não são recalculadas automaticamente. A interface de férias e a regra de redistribuição ainda precisam ser definidas.

O comportamento para uma tarefa que depende de conclusão quando seu responsável entra em férias ou sai da casa ainda deve ser definido.

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
- Regras para saída da casa e redistribuição em férias; saída de cômodo segue a política de vigência semanal acima.
- Política de compensação mais imediata, caso necessária, sem crédito duplicado ou quebra de atribuições publicadas.
- Permissões de edição, exclusão e aprovação de entrada em cômodos privados.
- Regras detalhadas de coleta e exibição das avaliações.
