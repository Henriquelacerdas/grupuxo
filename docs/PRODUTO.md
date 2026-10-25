# Produto

App iOS em SwiftUI para organizar tarefas domésticas em casas compartilhadas e repúblicas. Objetivo: reduzir a carga mental de criar, distribuir, lembrar e acompanhar tarefas, com divisão clara e justa.

**Estado atual:** login com Amazon Cognito (e-mail/senha e Sign in with Apple); criar casa ou entrar por código, cômodos, tarefas e conclusão pelo app falam com o backend em Node.js + TypeScript (algoritmo de distribuição no servidor, persistência em DynamoDB) e o canal WhatsApp (ver e concluir as próprias tarefas) está escrito e testado, aguardando o primeiro deploy do ambiente `dev` (ver [BACKEND.md](BACKEND.md) e [PLANO.md](PLANO.md)). Tarefas avulsas (criar, assumir, devolver), trocas e notificações também passam pelo servidor. Edição de tarefa e exclusão de avulsa ainda não têm rota e estão escondidas no app.

## Estrutura da casa

Uma casa possui moradores, cômodos e tarefas. Toda tarefa pertence a um cômodo.

### Cômodos

| Tipo | Participantes | Visibilidade | Entrada |
| --- | --- | --- | --- |
| Comum | Todos os moradores atuais (invariante) | Toda a casa | Automática |
| Privado | Um ou mais | Existência visível a todos; tarefas só para participantes | Livre, sem aprovação |

- **Casa toda** é o cômodo padrão para tarefas da residência inteira: sempre comum, não pode ser excluído nem abandonado individualmente.
- Sair de um cômodo comum o torna privado imediatamente; reentrar não o torna comum de novo.
- A **última saída** de um cômodo exige confirmação: "Atenção: Você é o último participante desse cômodo. Se sair, o cômodo e suas tarefas serão excluídos." → botão "Sair e excluir". Cancelar preserva tudo.
- Novo morador entra automaticamente em todos os cômodos comuns. Ao sair da casa, deixa todos os cômodos; comuns continuam comuns. Se isso esvaziar um privado, a exclusão também exige confirmação. O último morador também pode sair: depois de confirmar, a casa é excluída inteira (cômodos, tarefas, histórico e código de convite).
- Não há privacidade individual de tarefas nem aprovação de entrada.

### Escala do cômodo

Todo cômodo tem periodicidade **n execuções a cada x semanas** e uma quantidade configurável de **responsáveis simultâneos** (inicialmente 1; nunca maior que o número de participantes). Os responsáveis são definidos pela escala, permanecem durante as x semanas e as n execuções são espaçadas automaticamente. Detalhes em [ALGORITMO.md](ALGORITMO.md).

## Áreas do app

A barra principal tem duas abas. Sino (notificações) e perfil (configurações) ficam no canto superior direito da tela inicial.

### Minhas tarefas

Responsabilidades do usuário, em três seções recolhíveis:

- **Seu ciclo**: os cômodos de que o morador é responsável neste ciclo, cada um com o prazo ("Termina domingo"), o progresso do cômodo ("2 de 5") e as tarefas de mesma periodicidade do cômodo.
- **Tarefas gerais**: tarefas recorrentes de um cômodo com periodicidade diferente da do cômodo, com o nome do cômodo e o dia do prazo.
- **Tarefas únicas**: as esporádicas que o morador assumiu na aba Casa, com o nome do cômodo.

Permite consultar prazo, responsável e estado; concluir (e desmarcar); e, deslizando a linha, **Pedir troca** com outro morador, **Editar** (abre o detalhe da tarefa; só leitura enquanto a `api` não tiver edição) e **Excluir** (só em recorrentes: encerra a tarefa, com confirmação; o histórico fica e a vez atual continua até ser concluída). Tarefas concluídas ficam marcadas até o fim do ciclo (seu ciclo) ou da semana (gerais e únicas). O botão "+" da barra abre a mesma sheet de criação de tarefa da aba Casa; o avatar abre as configurações e o sino, as notificações.

### Gerenciar casa

Organização coletiva:

- Ver todos os cômodos; entrar em privados; sair dos participantes (exceto Casa toda).
- Criar cômodos (ícone, periodicidade, responsáveis, visibilidade).
- Criar e editar tarefas, com **sugestões por tipo de cômodo** (`TaskSuggestionCatalog`).
- Card de **Tarefas Únicas** (esporádicas): as primeiras tarefas abertas, cada uma com o ícone e a cor do cômodo, e "+N Outras" quando sobram (não aparecem dentro do cômodo na interface, mas mantêm `roomID` nos dados).
- Um card por cômodo. Para quem participa: ícone, nome, responsáveis do ciclo ("Você e Gabriel M.", ou seja, quem tem as tarefas de mesma periodicidade do cômodo; o morador logado aparece como "Você" e os demais como "Nome S."), quando o ciclo termina ("Termina hoje", "amanhã", dia da semana ou "em N dias"), barra de progresso na cor do cômodo e "X de Y tarefas feitas" (fração das tarefas do ciclo atual já concluídas). Cadeado: só em cômodo privado; aberto quando o morador participa, fechado quando não participa. Quem não participa de um cômodo privado vê só ícone, nome, "Cômodo Privado" e um botão: "Pedir para entrar" ou, com pedido aberto, "Cancelar solicitação". O pedido ainda não tem aprovação por parte dos participantes; ele só registra a intenção e pode ser cancelado.

### Configurações e notificações

- Configurações: moradores da casa (adicionar/remover). Modo férias e saída da casa pela interface ainda dependem de definição.
- Notificações: hoje cobrem o ciclo de troca de tarefas (solicitada, aceita, rejeitada). Tarefas atrasadas, alterações de cômodos e entradas/saídas são evoluções previstas.
- A foto de perfil não é escolhida pelo usuário; usar iniciais/avatar padrão.

## Tarefas

Toda tarefa tem nome, cômodo obrigatório, descrição opcional, esforço de 1 a 3 e configuração de periodicidade/distribuição.

O esforço é carga interna usada para equilibrar responsabilidades; não deve virar pontuação competitiva. Há separação estrita entre **definição** (regra e fila) e **ocorrência** (execução pendente ou histórica).

### Rotação por calendário

O responsável muda conforme o calendário, mesmo que o anterior não tenha concluído.

- Períodos de cômodo ancorados na segunda-feira, com n, x > 0 e n ≤ 7x (no máximo uma execução por dia). A execução i ocorre no dia `floor(i × 7x / n)` do período. Criar no meio da semana já gera a execução desta semana ainda aberta (por exemplo, a de segunda-feira para uma tarefa semanal criada na quarta), com prazo até a execução seguinte; execuções de semanas anteriores não são geradas.
- Opções de periodicidade da tarefa: "Mesma periodicidade do cômodo", outra semanal, diária, mensal ou anual. O semanal antigo com intervalo x equivale a 1 execução a cada x semanas (frações não são reduzidas).
- Tarefas com a mesma periodicidade do cômodo compartilham seus responsáveis: com um responsável, todas são dele; com vários, um guloso distribui da mais trabalhosa para a menos, antes de associar nomes pelo Húngaro. As demais têm filas independentes.

### Rotação após conclusão

Tarefa sem calendário só troca de responsável quando o atual conclui. A fila inicial considera carga semanal e saldo dos elegíveis; cada conclusão passa ao próximo slot da fila estática. Há uma única ocorrência ativa e nenhuma data futura inventada.

### Distribuição automática e justiça

No app roda no dispositivo e no servidor roda a mesma lógica (implementação em TypeScript, verificada contra a do app), com projeção de 12 semanas (rolling horizon):

1. **Saldo de justiça:** ao concluir esforço `E` num cômodo com `M` elegíveis, o executor ganha `E − E/M` e os demais perdem `E/M`. Quem é de fora do cômodo não é afetado.
2. **Fila inicial:** custo quadrático por usuário/semana (pune picos) e Húngaro para a permutação de menor custo, com as demais filas fixas. Não garante ótimo global.
3. **Entrada/saída de participantes:** a nova composição vale na segunda-feira imediatamente seguinte. Pode mudar atribuições futuras já publicadas (inclusive responsáveis de um período em andamento); preserva a semana atual, atrasados e concluídos. Quem sai ainda conclui suas pendências preservadas. Entrar na fila não garante tarefa na primeira semana. Quem entra já é elegível na semana atual para tarefas criadas depois da entrada (por exemplo, uma diária criada na quarta-feira), sem tirar tarefas já atribuídas a outros nesta semana.
4. **Reequilíbrio estrutural:** busca de melhoria entre as filas da casa priorizando igualdade de esforço semanal; sem garantia de ótimo global e sem reordenar o cotidiano continuamente. Reentradas preservam o saldo.

## Tarefas esporádicas

Sem recorrência previsível (ex.: trocar uma resistência); fora do fluxo algorítmico. Um participante do cômodo pode criar, ver, assumir, concluir ou devolver ao card. A interface sugere moradores para assumir. Quem saiu do cômodo mantém acesso apenas às próprias pendências preservadas, enquanto morar na casa.

- Concluir aplica o ajuste de justiça pelo esforço, no cômodo da tarefa.
- Assumir ou devolver sem concluir não altera o saldo.
- Não há "pulo" automático da próxima tarefa de mesmo esforço: isso conflitaria com atribuições publicadas e compensaria o mesmo trabalho duas vezes.

## Troca de tarefas

Um morador oferece uma ocorrência sua e escolhe entre candidatas elegíveis de outro morador; o destinatário aceita ou recusa na tela de Notificações (seção "Trocas pendentes", com a tarefa que recebe e a que passa) e quem pediu recebe a notificação da resposta. Regras de elegibilidade em `TaskSwapEligibilityPolicy`: só se oferece ocorrência própria, ativa, não concluída e já disponível; só recebe quem mora na casa, participa do cômodo e não está ausente.

## Modo férias

Ausências registradas impedem novas atribuições ao morador no período `[startsAt, endsAt)`. O turno nominal pode ficar sem responsável; filas e atribuições já publicadas não são recalculadas. Pendências por conclusão são preservadas e sua fila sucessora muda na próxima segunda-feira. Interface, redistribuição e retorno de férias ainda não existem.

## Avaliação da casa (planejado)

Moradores avaliam cômodos comuns; privados não participam. Resumo a cada 3 semanas para casas de 2–3 moradores e semanal para 4 ou mais. Sem promessa de anonimato absoluto.

## Roadmap e decisões abertas

**WhatsApp:** integração com o WhatsApp dos moradores para consultar tarefas, receber lembretes e, depois, registrar conclusões sem abrir o app. Decidido: API oficial da Meta (Cloud API), v1 de consulta e, com confirmação ("Marcar X como feita? sim/não"), conclusão de tarefas (implementada em memória; ver [BACKEND.md](BACKEND.md) seção 7.4), vínculo do número por link `wa.me` com token e consentimento registrado no vínculo. Exige backend (ver [BACKEND.md](BACKEND.md)). Em aberto: custo de mensagens iniciadas pelo bot (lembretes) e um número de bot por ambiente.

Futuro, sem bloquear a entrega atual: widget, Lembretes, Siri, NFC, lista de mercado, controle financeiro.

Decisões abertas:

- Banco, API do app e sincronização (o banco será o DynamoDB, tabela única sob demanda, para minimizar custo; modelo em [BACKEND.md](BACKEND.md) seção 4); versão mínima de iOS (hoje 26.5).
- Regras de atraso. O fuso é por casa no servidor (`House.timezone`; semana iniciando na segunda, virada no fuso da casa); o mock do app ainda usa o fuso do dispositivo.
- Redistribuição imediata das pendências de quem deixa a casa e em férias.
- Compensação mais imediata, sem crédito duplicado ou quebra de atribuições publicadas.
- Permissões de edição/exclusão manual de cômodos.
- Regras de coleta e exibição das avaliações; comportamento para casas de uma pessoa.
