# Mensagens do WhatsApp

## Boas-vindas ao vincular o número

O nome do app é **Reveza**. A mensagem é enviada quando o morador conclui o vínculo do número por token, em `WhatsAppLinker.linkedReply` (`backend/src/whatsapp/linking/whatsapp-linker.ts`). Entrar em uma casa pelo app não dispara mensagem no WhatsApp.

Texto canônico em pt-BR, com estas quebras de linha e pontuação:

```text
Olá, eu sou o bot do Reveza e vou ser seu assistente pessoal para ajudar a manter a casa organizada!
Você pode me fazer perguntas como:
- Quais as minhas tarefas da semana?
- Quais são as tarefas da cozinha?

E me pedir para fazer ações como:
- Marque "limpar sala" como concluído.
```

## Ajuda quando nenhuma intenção é reconhecida

`GeminiMessageResponder.helpReply` (`backend/src/assistant/gemini-responder.ts`) usa os mesmos exemplos, acrescenta a consulta de tarefas avulsas e explica a confirmação da conclusão:

```text
Você pode me fazer perguntas como:
- Quais as minhas tarefas da semana?
- Quais são as tarefas da cozinha?
- Tem alguma tarefa avulsa?

E me pedir para fazer ações como:
- Marque "limpar sala" como concluído.

Para concluir uma tarefa sua, vou pedir sua confirmação.
```

Essa ajuda cobre o caso em que o Gemini não seleciona ferramenta. Falhas de processamento continuam usando o aviso fixo `GeminiMessageResponder.fallbackReply`.

## Regra de manutenção

As boas-vindas e a ajuda são **textos fixos no código, nunca gerados pelo Gemini**.

**Sempre que o bot ganhar ou perder uma capacidade (ferramenta em `backend/src/assistant/read-tools.ts` ou `complete_task`), atualize essa mensagem e os exemplos.** Mantenha em sincronia o texto canônico deste documento, `WhatsAppLinker.linkedReply`, `GeminiMessageResponder.helpReply`, os exemplos da seção 7 de [BACKEND.md](BACKEND.md#7-fluxo-do-whatsapp) e os testes em `backend/test`.

As capacidades atuais são consultar as próprias tarefas (`list_my_tasks`), consultar tarefas de um cômodo (`list_room_tasks`), consultar tarefas avulsas (`list_sporadic_tasks`) e pedir a conclusão de uma tarefa própria (`complete_task`). A conclusão só é gravada depois da confirmação do morador.

Validação local: rodar `npm test` em `backend/`. Os testes do vínculo verificam o texto exato enviado sem chamar o responder; os testes do assistente verificam a ajuda fixa mesmo quando o modelo devolve texto livre.
