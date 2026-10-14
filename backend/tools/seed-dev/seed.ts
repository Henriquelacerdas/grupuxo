// Carga da casa de demonstração na tabela DynamoDB **real** (`dev`) e geração do link de vínculo do WhatsApp.
// Só roda com autorização explícita do dono (CLAUDE.md). Usa as credenciais locais (`AWS_PROFILE`, `AWS_REGION`).
//
//   TABLE_NAME=grupuxo-dev BOT_PHONE_NUMBER=+1555... node tools/seed-dev/seed.ts house [--name Henrique]
//   TABLE_NAME=grupuxo-dev BOT_PHONE_NUMBER=+1555... node tools/seed-dev/seed.ts link <userID>
//
// `house` cria uma casa nova a cada execução (IDs novos): rode uma vez só e, para outro link, use `link`.

import { createSeed } from "../../src/adapters/in-memory/seed.ts";
import { userID } from "../../src/domain/ids.ts";
import { createLinkConfig } from "../../src/whatsapp/linking/whatsapp-linker.ts";
import { WhatsAppLinkError } from "../../src/whatsapp/ports.ts";
import { houseAdapters, linkAdapters } from "../../src/main/dynamo-adapters.ts";
import { dynamoClient, newAccessCode, newID, now } from "../../src/main/runtime.ts";

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    console.error(`Defina ${name}.`);
    process.exit(2);
  }
  return value;
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function printLink(link: ReturnType<typeof linkAdapters>, user: string): Promise<void> {
  try {
    const invitation = await link.linker.issueInvitation(userID(user));
    console.log(`\nLink de vínculo (vale até ${new Date(invitation.expiresAt).toLocaleString("pt-BR")}):`);
    console.log(invitation.url);
    console.log("Abra no celular cadastrado na Meta e envie a mensagem sem alterá-la.");
  } catch (error) {
    if (error instanceof WhatsAppLinkError && error.code === "userAlreadyLinked") {
      console.log("\nEste morador já tem um WhatsApp vinculado.");
      return;
    }
    throw error;
  }
}

const [command, ...args] = process.argv.slice(2);
const client = dynamoClient(env("TABLE_NAME"));
const link = linkAdapters(client, createLinkConfig(env("BOT_PHONE_NUMBER")));

if (command === "house") {
  const seed = createSeed({ now: now(), newID, timezone: "America/Sao_Paulo" });
  const ownerName = option(args, "--name");
  const owner = { ...seed.users.marina, name: ownerName ?? seed.users.marina.name };
  // Código de convite aleatório (o `GRUPUXO` da demonstração é adivinhável).
  const house = { ...seed.house, accessCode: newAccessCode() };
  const state = {
    ...seed.state,
    users: seed.state.users.map((user) => (user.id === owner.id ? owner : user)),
    houses: [house],
  };
  await houseAdapters(client).store.createHouse(state);
  console.log(`Casa "${house.name}" criada: ${house.id} (código ${house.accessCode})`);
  for (const user of state.users) console.log(`  ${user.name.padEnd(8)} ${user.id}`);
  console.log(`\nVocê é ${owner.name} (${owner.id}).`);
  await printLink(link, owner.id);
} else if (command === "link" && args[0] !== undefined) {
  await printLink(link, args[0]);
} else {
  console.error("Uso: seed.ts house [--name <nome>] | seed.ts link <userID>");
  process.exit(2);
}
