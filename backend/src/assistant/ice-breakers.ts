// Quebra-gelos (ice breakers) do número do bot: sugestões que o WhatsApp mostra ao abrir a conversa. Texto canônico em
// docs/WHATSAPP-MENSAGENS.md, gravado na Graph API por `tools/whatsapp-config/ice-breakers.ts`. O toque chega ao
// webhook como mensagem de texto comum, com o texto exato do quebra-gelo.
// Limites da Meta: até 4, até 80 caracteres cada, sem emojis.

export const HELP_ICE_BREAKER = "O que você sabe fazer?";

export const ICE_BREAKERS: readonly string[] = [
  "Quais as minhas tarefas da semana?",
  "Quais são todas as minhas tarefas?",
  "Tem alguma tarefa avulsa?",
  HELP_ICE_BREAKER,
];

export const MAX_ICE_BREAKERS = 4;
export const MAX_ICE_BREAKER_CHARS = 80;

/** Problemas da lista frente aos limites da Meta; vazia quando está tudo certo. */
export function iceBreakerProblems(prompts: readonly string[]): string[] {
  const problems: string[] = [];
  if (prompts.length === 0) problems.push("nenhum quebra-gelo");
  if (prompts.length > MAX_ICE_BREAKERS) problems.push(`mais de ${MAX_ICE_BREAKERS} quebra-gelos`);
  if (new Set(prompts).size !== prompts.length) problems.push("quebra-gelos repetidos");
  prompts.forEach((prompt, index) => {
    if (prompt.trim() === "") problems.push(`quebra-gelo ${index + 1} vazio`);
    if (Array.from(prompt).length > MAX_ICE_BREAKER_CHARS) problems.push(`quebra-gelo ${index + 1} com mais de ${MAX_ICE_BREAKER_CHARS} caracteres`);
    if (/\p{Extended_Pictographic}/u.test(prompt)) problems.push(`quebra-gelo ${index + 1} com emoji`);
  });
  return problems;
}

/** O toque no quebra-gelo de ajuda chega com o texto exato; responde a ajuda fixa sem chamar o modelo. */
export function isHelpIceBreaker(message: string): boolean {
  return message.trim().toLocaleLowerCase("pt-BR") === HELP_ICE_BREAKER.toLocaleLowerCase("pt-BR");
}
