# Pendências do design final (Figma "Reveza · Oficial (clicável)")

Estado em 12/11/2026. Decisões do dono: em divergência o [DESIGN.md](docs/DESIGN.md) vence; foto e push entram como código + Terraform **sem apply** (CLAUDE.md).

## Implementado (backend + app, com testes)

Bot sem "atrasada"; mensagem de código inválido; periodicidade do cômodo oculta; "Começa sábado" em Agora; vocabulário de repetição em Criar Cômodo; verbo "Apagar"; **alterar senha**; **editar nome** (morador e casa); **foto do perfil**; **notificações generalizadas** (texto montado no app); **editar e excluir cômodo**; **cancelar pedido de troca**; **pedido de entrada em cômodo privado** (pedir, cancelar, aprovar/recusar); **"Repetir com o cômodo" como campo**; **repetição própria com janela de 2 dias contada da conclusão**; **tarefa única faz pular a vez** (Swift, TypeScript e fixtures); **editar tarefa recorrente** (inclusive passar entre "Repetir com o cômodo" e repetição própria); **modo férias**; **Avaliar a semana + Resumo**; **primeiros cômodos** e **Ativar notificações** no onboarding; **preferências de push**; **resumo "pronto"** (agendador) e **lembretes no aparelho** (resumo diário das tarefas, virada de ciclo e chegada em casa, do ramo Shortcuts, em Ajustes › Notificações); **foto no onboarding** (sobe depois que a casa existe); **aparelho tirado do servidor ao sair da conta**; **tarefa única** com "Casa toda" de padrão e "Será adicionada para você"; **"Depois"** (previsão do rodízio) nos detalhes do ciclo; rodapé "A contagem começa quando a tarefa é feita".

## Infra

`terraform apply` feito no `dev` em 12/11/2026 (bucket de fotos, Lambdas `push` e `scheduled`, stream, EventBridge) e segredo `grupuxo/dev/apns` gravado. Push Notifications já está ativo no App ID; falta testar o push num aparelho real. As Lambdas foram republicadas em 12/11/2026 sem o lembrete diário do servidor (os lembretes são locais).

## Não implementado

| Item | Situação |
|---|---|
| Saída da casa/rodízio "até o fim do ciclo" | Sair do cômodo já vale na próxima segunda; sair da casa continua imediato. |
| Esqueci a senha por link | Não se faz: o Cognito manda código (mudar exige mexer no user pool protegido). |
| Verificação visual | Conferidos textos de todas as telas e 4 telas por imagem (12/11/2026); o layout (espaços, tipografia) das demais não foi comparado pixel a pixel. |
| Docs | `docs/PERFIL-PENDENCIAS.md` ainda lista itens que já existem (nome, senha, férias, foto). |

## Regras da designer que ainda divergem

- "Excluir" × "Apagar": padronizado em "Apagar" (tarefa, casa, conta) e "Excluir cômodo"; aguarda confirmação dela.
- "A cada 2 meses" × 3 e 6 meses no menu de Criar Tarefa segue em aberto.

## Figma × app (conferência de 12/11/2026, página "Reveza · Oficial (clicável)")

Comparei os textos de todas as telas com o catálogo do app e vi por imagem Avaliar a semana, Resumo da semana, Notificações e Notificações (Ajustes). O que segue diverge do Figma e ainda não foi feito.

**Falta construir**
- **Widgets** (página "Widgets"): pequeno (lista, "o que falta", vazio) e médio (lista com prazo, cômodo + tarefas). O app não tem extensão de widget.
- **Saída da casa "até o fim do ciclo":** o texto do Figma já existe, o comportamento não (a saída da casa vale na hora).

**Notificações em duas linhas (12/11/2026):** título e detalhe como no Figma para troca aceita ("Você faz X até domingo"), tarefa editada ou apagada ("tarefa · cômodo"), esforço ("Leve → Médio"), virada de ciclo ("Você e Fulano até domingo") e resumo pronto; os demais ficam numa linha. O servidor manda os dados novos (`roomName`, `taskName`, `dueAt`, `effortFrom`, `effortTo`, `names`) e o app monta o texto. Diferença de texto: a virada de ciclo diz "Novo ciclo: Cozinha" e não "Novo ciclo na Cozinha", para não pôr artigo antes do nome do cômodo (regra do guia; "no Banheiro" e "na Cozinha" exigiriam o gênero).

**Resumo da semana (12/11/2026):** a tela traz o período, "N de M tarefas feitas na casa", "Seu cômodo" (nível, avaliações e tags em "O que foi bom" e "O que pode melhorar") e "Casa" (demais cômodos, "Poucas avaliações para mostrar" quando ninguém avaliou, e a nota dos cômodos ainda no primeiro ciclo). O servidor devolve esses campos em `GET /v1/me/ratings/summary` (BACKEND.md §6.1).

**Decisão de regra (pede aval):** o rodapé do Figma em Avaliar a semana diz "O resultado de cada cômodo só aparece com 2 avaliações ou mais", mas o servidor libera o resultado também quando a janela fecha com 1 avaliação (senão uma casa de 2 moradores nunca veria o resumo). Por isso não apliquei esse trecho do rodapé; o app mantém "Sua avaliação é anônima: ninguém vê quem avaliou. O resultado aparece para quem cuidou do cômodo."

**Tags da avaliação (12/11/2026):** as 8 do Figma, 4 de elogio (níveis Bom e Ótimo) e 4 de melhoria (Precisa melhorar); o servidor recusa tag do lado errado do nível e descarta, na leitura, as tags do catálogo antigo.

**Textos do Figma aplicados em 12/11/2026:** rodapé de Pedir troca, Ativar notificações (título, corpo e rodapé), Primeiros cômodos (título, subtítulo e rodapé), notificações desligadas no iPhone, nome da casa vazio e modo férias. "Convidar" já estava igual.

**Também aplicados em 12/11/2026:** a regra de senha do app agora segue a política real do Cognito ("Pelo menos 6 caracteres, com uma letra minúscula."), em Criar conta, Nova senha, Alterar senha e nas mensagens de erro; e os textos de WhatsApp do Figma ("No WhatsApp, o Reveza te responde…" e "Você pode conectar de novo quando quiser.").

**Decidido pelo dono (12/11/2026):** o texto do onboarding "uma vez por dia, suas tarefas" fica como no Figma, mesmo com o resumo diário local só valendo depois de ligado em Ajustes › Notificações.

**Decisão da designer**
- **Ajustes › Notificações:** o Figma tem "Lembrar das minhas tarefas" com "Horário" e, abaixo, "Quando o ciclo virar", "Atividade da casa" e "Resumo da semana". Por escolha do dono, o app usa os lembretes locais do ramo Shortcuts ("Resumo diário das minhas tarefas", "Avisar quando o ciclo virar", ambos com horário próprio), e ainda tem "Chegada em casa", "Sincronizar com o Lembretes" e os atalhos do Siri, que **não existem no Figma**. Falta a designer desenhar essas telas ou aprovar os rótulos atuais.
- **Excluir conta:** o Figma diz "Apaga seu perfil e seu histórico, e tira você de todos os rodízios." O app diz "Apaga seu perfil e o vínculo com o WhatsApp e tira você da casa.", que descreve melhor o que acontece. Qual vale?
- **"Esqueci a senha por link":** o Figma mostra link ("vale por 1 hora"); o app manda código (Cognito).
