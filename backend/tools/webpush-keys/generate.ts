// Gera o par VAPID do Web Push e grava direto no Secrets Manager **real** (`grupuxo/<ambiente>/webpush`, criado pelo
// Terraform sem valor). A chave privada nunca é impressa nem gravada em disco: só a pública aparece, para o site
// (`applicationServerKey` do `pushManager.subscribe`). Só roda com autorização explícita do dono (CLAUDE.md).
// Usa as credenciais locais (`AWS_PROFILE`, `AWS_REGION`).
//
//   WEBPUSH_SECRET_ID=grupuxo/dev/webpush node tools/webpush-keys/generate.ts
//   WEBPUSH_SECRET_ID=grupuxo/dev/webpush node tools/webpush-keys/generate.ts --rotate   # troca um par existente
//
// Trocar o par invalida todas as inscrições web (o navegador as fez com a chave pública antiga): o site precisa
// se inscrever de novo. Por isso, sem `--rotate`, um segredo que já tem valor não é sobrescrito.

import { createECDH } from "node:crypto";
import { GetSecretValueCommand, PutSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

const secretID = process.env["WEBPUSH_SECRET_ID"];
if (secretID === undefined || secretID === "") {
  console.error("Defina WEBPUSH_SECRET_ID (ex.: grupuxo/dev/webpush).");
  process.exit(2);
}
const rotate = process.argv.includes("--rotate");
const client = new SecretsManagerClient({});

async function hasValue(): Promise<boolean> {
  try {
    const current = await client.send(new GetSecretValueCommand({ SecretId: secretID }));
    return typeof current.SecretString === "string" && current.SecretString !== "";
  } catch (error) {
    // Segredo criado sem valor: a AWS responde ResourceNotFoundException ("can't find the specified secret value").
    if (error instanceof Error && error.name === "ResourceNotFoundException") return false;
    throw error;
  }
}

if (!rotate && (await hasValue())) {
  console.error("O segredo já tem um par VAPID. Use --rotate para trocar (as inscrições web atuais deixam de valer).");
  process.exit(1);
}

const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
const publicKey = ecdh.getPublicKey().toString("base64url");
await client.send(new PutSecretValueCommand({
  SecretId: secretID,
  SecretString: JSON.stringify({ WEBPUSH_VAPID_PUBLIC_KEY: publicKey, WEBPUSH_VAPID_PRIVATE_KEY: ecdh.getPrivateKey().toString("base64url") }),
}));
console.log("Par VAPID gravado no Secrets Manager. Chave pública (applicationServerKey do site, não é segredo):");
console.log(publicKey);
