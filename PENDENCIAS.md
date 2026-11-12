# Pendências do design final (Figma "Reveza · Oficial (clicável)")

Estado em 11/11/2026. Decisões do dono: em divergência o [DESIGN.md](docs/DESIGN.md) vence; foto e push entram como código + Terraform **sem apply** (CLAUDE.md).

## Implementado (backend + app, com testes)

Bot sem "atrasada"; mensagem de código inválido; periodicidade do cômodo oculta; "Começa sábado" em Agora; vocabulário de repetição em Criar Cômodo; verbo "Apagar"; **alterar senha**; **editar nome** (morador e casa); **foto do perfil**; **notificações generalizadas** (texto montado no app); **editar e excluir cômodo**; **cancelar pedido de troca**; **pedido de entrada em cômodo privado** (pedir, cancelar, aprovar/recusar); **"Repetir com o cômodo" como campo**; **repetição própria com janela de 2 dias contada da conclusão**; **tarefa única faz pular a vez** (Swift, TypeScript e fixtures); **editar tarefa recorrente** (inclusive passar entre "Repetir com o cômodo" e repetição própria); **modo férias**; **Avaliar a semana + Resumo**; **primeiros cômodos** e **Ativar notificações** no onboarding; **preferências de push**; **avisos "ciclo virou" e "resumo pronto"** (agendador); **lembrete diário das tarefas** (push na hora escolhida, para quem tem tarefa pendente); **foto no onboarding** (sobe depois que a casa existe); **aparelho tirado do servidor ao sair da conta**; **tarefa única** com "Casa toda" de padrão e "Será adicionada para você"; **"Depois"** (previsão do rodízio) nos detalhes do ciclo; rodapé "A contagem começa quando a tarefa é feita".

## Infra

`terraform apply` feito no `dev` em 12/11/2026 (bucket de fotos, Lambdas `push` e `scheduled`, stream, EventBridge) e segredo `grupuxo/dev/apns` gravado. As Lambdas `scheduled` e `push` precisam ser republicadas (`npm run build` e `terraform apply`, com autorização) para o lembrete diário entrar no ar. Push Notifications já está ativo no App ID; falta testar o push num aparelho real.

## Não implementado

| Item | Situação |
|---|---|
| Saída da casa/rodízio "até o fim do ciclo" | Sair do cômodo já vale na próxima segunda; sair da casa continua imediato. |
| Rodapé da validade da troca por tipo | O texto exato está só no Figma; falta copiá-lo (o comportamento já o justifica). |
| Esqueci a senha por link | Não se faz: o Cognito manda código (mudar exige mexer no user pool protegido). |
| Verificação visual | As telas novas compilam e têm testes de view model/repositório, mas não foram conferidas no simulador contra o Figma. |
| Docs | `docs/PERFIL-PENDENCIAS.md` ainda lista itens que já existem (nome, senha, férias, foto). |

## Regras da designer que ainda divergem

- "Excluir" × "Apagar": padronizado em "Apagar" (tarefa, casa, conta) e "Excluir cômodo"; aguarda confirmação dela.
- "A cada 2 meses" × 3 e 6 meses no menu de Criar Tarefa segue em aberto.
