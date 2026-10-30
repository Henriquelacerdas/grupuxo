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

## Quebra-gelos (ice breakers)

Sugestões que o WhatsApp mostra a quem abre uma conversa com o número do bot ([documentação da Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/conversational-components#ice-breakers)). Limites da Meta: até 4, até 80 caracteres cada, sem emojis. A lista fica em `ICE_BREAKERS` (`backend/src/assistant/ice-breakers.ts`), nesta ordem:

```text
Quais as minhas tarefas da semana?
Quais são todas as minhas tarefas?
Tem alguma tarefa avulsa?
O que você sabe fazer?
```

O toque chega ao webhook como mensagem de texto comum, com o texto exato do quebra-gelo, e segue o fluxo normal (limite de taxa, vínculo, assistente). As três primeiras são consultas que o Gemini resolve com `list_my_tasks` (semana e todas) e `list_sporadic_tasks`. "O que você sabe fazer?" é reconhecido por código (`isHelpIceBreaker`, texto exato sem diferenciar maiúsculas) e responde a ajuda fixa sem chamar o Gemini. Um número ainda não vinculado recebe a orientação de vínculo, como qualquer mensagem.

A configuração mora no número, não no código implantado: depois de mudar `ICE_BREAKERS`, regrave com `backend/tools/whatsapp-config/ice-breakers.ts` (`POST /<PHONE_NUMBER_ID>/conversational_automation` com `prompts`), só com autorização do dono do projeto:

```sh
cd backend
node tools/whatsapp-config/ice-breakers.ts show apply --dry-run   # sem rede
node tools/whatsapp-config/ice-breakers.ts show                    # REAL: só lê
node tools/whatsapp-config/ice-breakers.ts apply                   # REAL: altera o número
```

Usa `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID` e `WHATSAPP_GRAPH_VERSION` do ambiente, como `tools/validate`, e nunca imprime token nem `PHONE_NUMBER_ID`. Os comandos (`commands`) e a mensagem de boas-vindas automática da Meta não são usados.

## Regra de manutenção

As boas-vindas e a ajuda são **textos fixos no código, nunca gerados pelo Gemini**.

**Sempre que o bot ganhar ou perder uma capacidade (ferramenta em `backend/src/assistant/read-tools.ts` ou `complete_task`), atualize essa mensagem e os exemplos.** Mantenha em sincronia o texto canônico deste documento, `WhatsAppLinker.linkedReply`, `GeminiMessageResponder.helpReply`, `ICE_BREAKERS` (e regrave no número), os exemplos da seção 7 de [BACKEND.md](BACKEND.md#7-fluxo-do-whatsapp) e os testes em `backend/test`.

As capacidades atuais são consultar as próprias tarefas (`list_my_tasks`), consultar tarefas de um cômodo (`list_room_tasks`), consultar tarefas avulsas (`list_sporadic_tasks`) e pedir a conclusão de uma tarefa própria (`complete_task`). A conclusão só é gravada depois da confirmação do morador.

Validação local: rodar `npm test` em `backend/`. Os testes do vínculo verificam o texto exato enviado sem chamar o responder; os testes do assistente verificam a ajuda fixa mesmo quando o modelo devolve texto livre.
