# Pendências do design final (Figma "Reveza · Oficial (clicável)")

Diferenças entre as telas finais do Figma (arquivo Designuxo, nó 980-1184) e o que o app e o backend fazem hoje. O que
está aqui **não foi implementado**: falta rota na `api`, regra de domínio ou decisão de produto. As pendências da tela
de Ajustes que já existiam continuam em [docs/PERFIL-PENDENCIAS.md](docs/PERFIL-PENDENCIAS.md).

## Sem backend (feature inteira)

| Tela / elemento do Figma | Por que ficou de fora |
|---|---|
| **Avaliar a semana** (sheet com nota por cômodo e chips) e **Resumo da semana** | Feature planejada em `docs/PRODUTO.md` ("Avaliação da casa"), sem entidade, rota nem regra de anonimato no backend. |
| Linha "Avaliar a semana / Termina terça" em Minhas tarefas | Depende da avaliação acima. |
| **Foto do perfil** ("Adicionar foto" no onboarding e nos Ajustes) | Não há armazenamento de imagem nem campo de foto no `User`. O avatar mostra as iniciais. |
| **Modo férias** | Não existe ausência programada exposta na `api`. |
| **Notificações push**: passo "Ativar notificações" do onboarding, alerta do sistema e Ajustes › Notificações (Lembrar das minhas tarefas, Horário, Quando o ciclo virar, Atividade da casa, Resumo da semana) e "desligadas no iPhone" | O app não registra push (sem APNs no backend nem `UNUserNotificationCenter`). Pela HIG, não se pede permissão sem uso real; o passo foi omitido. Os lembretes continuam pelo app Lembretes. |
| **Primeiros cômodos** no onboarding (marcar Cozinha, Banheiro, Sala… com tarefas sugeridas) | A criação da casa (`POST /v1/houses`) não recebe cômodos. Depois do onboarding o app abre em Casa, onde o "+" cria cômodos. |
| Tipos de notificação "ciclo virou", "resumo da semana", "esforço mudou", "fulano entrou na casa" | `AppNotification.Kind` só tem tarefa editada e troca pedida/aceita/recusada. |

## Sem rota na `api`

| Elemento | Situação |
|---|---|
| **Editar tarefa recorrente** (swipe "Editar" e "Editar Tarefa" no detalhe) | O `PATCH` só vale para tarefa única criada por quem edita; recorrente responde `403 task_unavailable` e o botão fica oculto. Em tarefa única, só nome e descrição são editáveis (esforço e a tela "Editar Tarefa" completa do Figma ficam para depois). |
| **Notificação "tarefa editada"** | O servidor não tem esse tipo (`AppNotificationKind`) e toda notificação exige `swapRequestID`; o aviso só existe no Mock. A designer quer o histórico notificado para evitar edição e exclusão silenciosas. |
| **Editar / Excluir cômodo** (itens do "⋯" do Cômodo) ("Editar cômodo", "Excluir cômodo", alerta "Excluir a Cozinha?") | Sem rota de edição nem exclusão de cômodo. O menu do cômodo mostra só "Sair do rodízio". |
| **Cancelar pedido de troca** ("Cancelar pedido" em Seus pedidos) | Sem rota de cancelamento. "Seus pedidos" só mostra o pedido aguardando. |
| **Pedido de entrada em cômodo privado** | `RemoteRoomAccessRequestRepository` lança `APIError.unsupported`. |
| **Editar nome** (Ajustes) e erro "A casa precisa de um nome…" | Nome da casa e do morador são só leitura na `api`. |
| **Alterar senha** (sheet em Ajustes › Conta) | Exige `updatePassword` no `AuthService`, que está com mudanças locais do dono; não mexi. |

## Textos e comportamentos adaptados

| Figma | No app | Motivo |
|---|---|---|
| Esqueci a senha: "Vamos mandar um **link**", "Abrir o Mail", "Reenviar link"; tela "Nova senha" | Código de 6 dígitos por e-mail e "Reenviar código" (telas atuais) | O Cognito manda código, não link. |
| "Não achamos uma casa com esse código. Confira com quem te mandou." | Mensagem vinda do `APIClient` ("Código de convite inválido.") | O mapeamento de erros está no `APIClient`, com mudanças locais do dono. |
| Sair da casa: "Você continua com as tarefas deste ciclo até domingo. Depois, sai dos rodízios." | "Ao sair, você deixa todos os cômodos da casa." | Sair da casa apaga a participação na hora (`docs/BACKEND.md`); não há carência até domingo. |
| Sair do rodízio: "…deste ciclo…" | "Você continua com as tarefas desta semana até domingo. Depois, o rodízio segue só entre os outros." | A saída de cômodo vale a partir da próxima segunda (`docs/ALGORITMO.md`), não do fim do ciclo. |
| Repetição própria: "A contagem começa quando a tarefa é feita" | "A cada vez, ela passa para a próxima pessoa." | A repetição própria é por calendário, não conta a partir da conclusão. |
| Pedir troca, rodapé final: "Tarefa do ciclo: a troca vale até o fim do ciclo. Tarefa geral: fica com quem recebeu até ser feita." | "A pessoa precisa aceitar para a troca valer." | A regra de validade por tipo não está confirmada no domínio; mantive só o que é certo. |
| Cartão do ciclo do cômodo: linha "Depois" (próximos responsáveis) | Ciclo, Agora e Participantes | Não há previsão do próximo rodízio na `api`. |
| Tarefas únicas: cômodo padrão "Casa inteira" e legenda "Será adicionada para você" | Cômodo escolhido na criação, como hoje | A criação usa os cômodos da casa; sem cômodo virtual fixo no app. |
| Apagar tarefa: "Apagar" | "Encerrar" | Encerrar mantém o histórico (definição separada das ocorrências). |
| Seu perfil: "Seu nome e sua foto aparecem…" | "Seu nome aparece nas tarefas e no rodízio." | Sem foto (ver acima). |

## Regras da designer que o app ou o servidor ainda não seguem

Fonte: [docs/DESIGN.md](docs/DESIGN.md). O que não está aqui já foi implementado.

| Regra do guia | Situação |
|---|---|
| Repetição própria com janela de **2 dias**, sem fazer antes de abrir, próxima janela contada **a partir da conclusão** | O servidor repete por calendário (`docs/ALGORITMO.md`). O rodapé de Criar Tarefa omite "A contagem começa quando a tarefa é feita". |
| "Quem faz uma tarefa única **pula a vez** na próxima tarefa de repetição própria" | O texto aparece na tela de Tarefas únicas, mas o algoritmo não pula (`docs/PRODUTO.md`: concluir só ajusta o saldo). Decidir entre implementar a regra e trocar o texto. |
| "Repetir com o cômodo" é **um campo da tarefa** | Hoje só existe no rascunho da tela; o vínculo é deduzido comparando periodicidades (`TaskDefinition.isLinked`). A tarefa não acompanha o cômodo quando ele muda de periodicidade. |
| Cartão do ciclo com a linha **"Depois"** | Sem previsão do rodízio na `api` (já listado acima). |
| "Começa sábado" na tela do Cômodo (Agora) | O filtro Agora só mostra o que já abriu; o início futuro só aparece em Minhas tarefas. |
| Menu "⋯" do Cômodo: **Editar cômodo** e **Excluir cômodo** | Sem rota (ver tabela anterior). |
| Periodicidade do cômodo **não aparece** como opção de Repetição quando o toggle está desligado | O app a mantém visível e desabilitada. |
| Bot do WhatsApp nunca diz "atrasada" | `backend/src/assistant/task-format.ts` ainda escreve "(atrasada)" (`docs/BACKEND.md`). |
| Vocabulário de repetição da Apple em **Criar Cômodo** ("Semanal/Quinzenal/Mensal") | `NovoComodoView` é código da própria designer; aguarda ela decidir (ver "Decisões em aberto" em `docs/DESIGN.md`). |
| "Excluir" × "Apagar" como verbo padrão | O app mistura "Apagar tarefa" (detalhe), "Encerrar" (cômodo) e "Excluir" (swipe e tarefa única); aguarda a decisão. |
