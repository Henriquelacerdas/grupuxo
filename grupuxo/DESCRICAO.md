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

O esforço representa carga de trabalho interna. Ele serve para equilibrar responsabilidades e não deve aparecer como pontuação competitiva ou gamificação.

### Rotação por calendário

Tarefas e responsabilidades que seguem uma rotação com prazo trocam de responsável conforme o calendário, mesmo que a pessoa anterior não tenha concluído a tarefa.

A rotação semanal de cômodos começa na segunda-feira. A ordem de responsáveis e a distribuição quando há mais cômodos que moradores ou mais moradores que cômodos devem ser calculadas automaticamente.

### Tarefas que mudam após conclusão

Uma tarefa criada sem rotação por calendário só muda de responsável depois que a pessoa responsável a conclui.

A próxima pessoa não deve ser definida apenas por uma fila fixa. O sistema deve considerar a carga semanal atual dos moradores elegíveis.

### Delegação automática

A delegação automática de tarefas periódicas usa um algoritmo **guloso com busca local**.

O algoritmo deve:

1. Considerar as tarefas disponíveis, seus esforços e os moradores elegíveis.
2. Excluir moradores em modo férias.
3. Calcular a carga da semana atual.
4. Priorizar quem tem menor carga.
5. Usar histórico como desempate apenas quando não prejudicar significativamente o equilíbrio.
6. Realocar ou trocar atribuições quando isso reduzir a diferença de carga entre moradores.
7. Recalcular a distribuição imediatamente quando moradores, cômodos ou férias alterarem a elegibilidade.

A carga considera esforço atribuído e concluído sem duplicação. Concluir uma tarefa já atribuída não soma novamente seu esforço.

A distribuição busca equilíbrio dentro da semana atual. Ela não cria compensações por semanas anteriores.

## Tarefas esporádicas

Tarefas esporádicas são tarefas sem recorrência previsível, como trocar uma resistência ou resolver um problema pontual.

Elas aparecem no card próprio de Gerenciar casa. Um morador pode criar, visualizar, assumir, concluir ou devolver uma tarefa ao card.

Ao concluir uma tarefa esporádica, a pessoa é automaticamente pulada na próxima tarefa de mesmo esforço que receberia. Ela não escolhe qual tarefa será pulada e não recebe um vale, saldo ou carteira de benefícios.

Assumir uma tarefa esporádica sem concluí-la não concede esse pulo.

## Modo férias

O modo férias retira temporariamente um morador das tarefas da semana. Ao ativar ou encerrar férias, a distribuição é recalculada imediatamente.

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
- Horários, fusos e regras detalhadas de periodicidade e atraso.
- Regras para saída de moradores e férias em tarefas pendentes.
- Exceções para o pulo de tarefas esporádicas.
- Permissões de edição, exclusão e aprovação de entrada em cômodos privados.
- Regras detalhadas de coleta e exibição das avaliações.
