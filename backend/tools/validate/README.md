# tools/validate

Scripts **descartáveis** que exercitam os clientes reais do projeto (`GraphWhatsAppSender`, `HttpGeminiClient`) contra a Graph API e o Gemini, para fechar os itens das seções 1 e 2 de [../../../docs/VALIDACAO-APIS-REAIS.md](../../../docs/VALIDACAO-APIS-REAIS.md). Ficam fora do `npm test`. **Cada item chama a rede de verdade e só roda com autorização explícita do dono do projeto.** Use só números e chaves de teste (ambiente `dev`).

```sh
cd backend
node tools/validate/graph.ts --list            # itens e quantas chamadas cada um faz
node tools/validate/graph.ts G1 --dry-run      # roda com HTTP falso, sem rede e sem variáveis
node tools/validate/graph.ts G1                # REAL: só o(s) item(ns) autorizado(s)
node tools/validate/gemini.ts M2
node --test tools/validate/validate.test.ts    # testes dos próprios scripts (sem rede)
```

Não existe "rodar tudo": sem ID de item o script recusa.

## Variáveis (só por ambiente; nunca em arquivo)

| Variável | Usada por | Observação |
| --- | --- | --- |
| `WHATSAPP_TOKEN` | G1–G7 | token de teste |
| `PHONE_NUMBER_ID` | G1–G7 | número de teste do bot |
| `WHATSAPP_GRAPH_VERSION` | G1–G7 | ex.: `v25.0`; sem padrão |
| `VALIDATE_WA_TO` | G1, G3, G4, G6a–c, G7 | E.164 com `+`, número de teste **dentro** da janela de 24 h |
| `VALIDATE_WA_BR_NUMBER` | G2 | celular brasileiro de teste (+55 DD 9XXXXXXXX ou sem o 9) |
| `VALIDATE_WA_OUT_OF_WINDOW_TO` | G6d | número **fora** da janela de 24 h |
| `VALIDATE_WA_NOT_ON_WHATSAPP_TO` | G6e | número sem WhatsApp (ou fora da lista de teste) |
| `GEMINI_API_KEY` | M1–M5 | chave de teste |
| `GEMINI_MODEL` | M1–M5 | sem padrão |

## O que a saída mostra (e o que nunca mostra)

Só status, tempo, códigos de erro de vocabulário fechado (`code`, `type`, `error_subcode`, `status`, `reason`, `finishReason`), contagens de tokens e a **forma** dos JSONs (chaves e tipos). Nunca: token, chave, telefone, `wa_id`, `wamid`, `error.message`, texto de mensagem ou valor de argumento escolhido pelo modelo. Tudo passa por `out()` (`common.ts`), que ainda apaga os segredos registrados e qualquer sequência de 7 ou mais dígitos. Nada é gravado em arquivo. As mensagens enviadas têm texto fixo (`[validacao Gx]`), então dá para conferi-las no aparelho de teste.

Variantes que o cliente do projeto recusa de propósito (`to` sem `+`, texto de 4097 caracteres, `to` malformado, corpo vazio do Gemini) são POSTs crus, marcados como bypass deliberado no código.
