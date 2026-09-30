# Produto

App iOS em SwiftUI para organizar tarefas domésticas em casas compartilhadas e repúblicas. Objetivo: reduzir a carga mental de criar, distribuir, lembrar e acompanhar tarefas, com divisão clara e justa.

**Estado atual:** arquitetura, navegação e fluxos completos sobre dados mockados. Sem autenticação, backend, sincronização ou WhatsApp. Login futuro: Sign in with Apple.

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
- Novo morador entra automaticamente em todos os cômodos comuns. Ao sair da casa, deixa todos os cômodos; comuns continuam comuns. Se isso esvaziar um privado, a exclusão também exige confirmação.
- Não há privacidade individual de tarefas nem aprovação de entrada.

### Escala do cômodo

Todo cômodo tem periodicidade **n execuções a cada x semanas** e uma quantidade configurável de **responsáveis simultâneos** (inicialmente 1; nunca maior que o número de participantes). Os responsáveis são definidos pela escala, permanecem durante as x semanas e as n execuções são espaçadas automaticamente. Detalhes em [ALGORITMO.md](ALGORITMO.md).

## Áreas do app

A barra principal tem duas abas. Sino (notificações) e perfil (configurações) ficam no canto superior direito da tela inicial.

### Minhas tarefas

Responsabilidades do usuário: tarefas periódicas, gerais e esporádicas assumidas. Permite consultar prazo, esforço, responsável e estado; concluir (e desmarcar); e pedir **troca** de tarefa com outro morador. **Não permite criar tarefas.**

### Gerenciar casa

Organização coletiva:

- Ver todos os cômodos; entrar em privados; sair dos participantes (exceto Casa toda).
- Criar cômodos (ícone, periodicidade, responsáveis, visibilidade).
- Criar e editar tarefas, com **sugestões por tipo de cômodo** (`TaskSuggestionCatalog`).
- Card de **tarefas esporádicas** (não aparecem dentro do cômodo na interface, mas mantêm `roomID` nos dados).

### Configurações e notificações

- Configurações: moradores da casa (adicionar/remover). Modo férias e saída da casa pela interface ainda dependem de definição.
- Notificações: hoje cobrem o ciclo de troca de tarefas (solicitada, aceita, rejeitada). Tarefas atrasadas, alterações de cômodos e entradas/saídas são evoluções previstas.
- A foto de perfil não é escolhida pelo usuário; usar iniciais/avatar padrão.

## Tarefas

Toda tarefa tem nome, cômodo obrigatório, descrição opcional, esforço de 1 a 3 e configuração de periodicidade/distribuição.

O esforço é carga interna usada para equilibrar responsabilidades; não deve virar pontuação competitiva. Há separação estrita entre **definição** (regra e fila) e **ocorrência** (execução pendente ou histórica).

### Rotação por calendário

O responsável muda conforme o calendário, mesmo que o anterior não tenha concluído.

- Períodos de cômodo ancorados na segunda-feira, com n, x > 0 e n ≤ 7x (no máximo uma execução por dia). A execução i ocorre no dia `floor(i × 7x / n)` do período. Criar no meio do período não gera execuções passadas.
- Opções de periodicidade da tarefa: "Mesma periodicidade do cômodo", outra semanal, diária, mensal ou anual. O semanal antigo com intervalo x equivale a 1 execução a cada x semanas (frações não são reduzidas).
- Tarefas com a mesma periodicidade do cômodo compartilham seus responsáveis: com um responsável, todas são dele; com vários, um guloso distribui da mais trabalhosa para a menos, antes de associar nomes pelo Húngaro. As demais têm filas independentes.

### Rotação após conclusão

Tarefa sem calendário só troca de responsável quando o atual conclui. A fila inicial considera carga semanal e saldo dos elegíveis; cada conclusão passa ao próximo slot da fila estática. Há uma única ocorrência ativa e nenhuma data futura inventada.

### Distribuição automática e justiça

Roda no dispositivo, com projeção de 12 semanas (rolling horizon):

1. **Saldo de justiça:** ao concluir esforço `E` num cômodo com `M` elegíveis, o executor ganha `E − E/M` e os demais perdem `E/M`. Quem é de fora do cômodo não é afetado.
2. **Fila inicial:** custo quadrático por usuário/semana (pune picos) e Húngaro para a permutação de menor custo, com as demais filas fixas. Não garante ótimo global.
3. **Entrada/saída de participantes:** a nova composição vale na segunda-feira imediatamente seguinte. Pode mudar atribuições futuras já publicadas (inclusive responsáveis de um período em andamento); preserva a semana atual, atrasados e concluídos. Quem sai ainda conclui suas pendências preservadas. Entrar na fila não garante tarefa na primeira semana.
4. **Reequilíbrio estrutural:** busca de melhoria entre as filas da casa priorizando igualdade de esforço semanal; sem garantia de ótimo global e sem reordenar o cotidiano continuamente. Reentradas preservam o saldo.

## Tarefas esporádicas

Sem recorrência previsível (ex.: trocar uma resistência); fora do fluxo algorítmico. Um participante do cômodo pode criar, ver, assumir, concluir ou devolver ao card. A interface sugere moradores para assumir. Quem saiu do cômodo mantém acesso apenas às próprias pendências preservadas, enquanto morar na casa.

- Concluir aplica o ajuste de justiça pelo esforço, no cômodo da tarefa.
- Assumir ou devolver sem concluir não altera o saldo.
- Não há "pulo" automático da próxima tarefa de mesmo esforço: isso conflitaria com atribuições publicadas e compensaria o mesmo trabalho duas vezes.

## Troca de tarefas

Um morador oferece uma ocorrência sua e escolhe entre candidatas elegíveis de outro morador; o destinatário aceita ou rejeita e ambos recebem notificação. Regras de elegibilidade em `TaskSwapEligibilityPolicy`: só se oferece ocorrência própria, ativa, não concluída e já disponível; só recebe quem mora na casa, participa do cômodo e não está ausente.

## Modo férias

Ausências registradas impedem novas atribuições ao morador no período `[startsAt, endsAt)`. O turno nominal pode ficar sem responsável; filas e atribuições já publicadas não são recalculadas. Pendências por conclusão são preservadas e sua fila sucessora muda na próxima segunda-feira. Interface, redistribuição e retorno de férias ainda não existem.

## Avaliação da casa (planejado)

Moradores avaliam cômodos comuns; privados não participam. Resumo a cada 3 semanas para casas de 2–3 moradores e semanal para 4 ou mais. Sem promessa de anonimato absoluto.

## Roadmap e decisões abertas

**WhatsApp:** integração com o WhatsApp dos moradores para consultar tarefas, receber lembretes e, depois, registrar conclusões sem abrir o app. Viabilidade, custos, escopo (API oficial vs. alternativas), vínculo número↔morador e consentimento dependem de um spike técnico. Provavelmente exige backend.

Futuro, sem bloquear a entrega atual: widget, Lembretes, Siri, NFC, lista de mercado, controle financeiro.

Decisões abertas:

- Backend, banco, sincronização; versão mínima de iOS (hoje 26.5).
- Fuso persistido por casa e regras de atraso (mock: calendário gregoriano, fuso do dispositivo, semana iniciando na segunda).
- Redistribuição imediata das pendências de quem deixa a casa e em férias.
- Compensação mais imediata, sem crédito duplicado ou quebra de atribuições publicadas.
- Permissões de edição/exclusão manual de cômodos.
- Regras de coleta e exibição das avaliações; comportamento para casas de uma pessoa.
