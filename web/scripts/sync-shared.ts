// Copia para o web o catálogo de sugestões de tarefa do domínio TypeScript (o mesmo do Swift): fonte única.
// Uso: npm run shared:sync. O teste tests/shared.test.ts confere que a cópia está em dia.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { suggestionsCatalog } from "./shared-source.ts";

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, "../src/lib/shared/task-suggestions.json"), `${JSON.stringify(suggestionsCatalog(), null, 1)}\n`);
process.stdout.write("task-suggestions.json atualizado\n");
