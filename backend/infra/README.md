# Infra `dev` (Terraform)

Um ambiente só (`dev`, `us-east-1`), estado local, conta AWS **641328361775**. O provider recusa qualquer outra conta (`allowed_account_ids`). Cria:

- Tabela DynamoDB `grupuxo-dev` (PK/SK, `GSI1`, TTL `ttl`, sob demanda), igual a `src/adapters/dynamodb/table-definition.ts`.
- Fila SQS FIFO `grupuxo-dev-whatsapp.fifo` com a DLQ e o alarme da DLQ.
- Segredo `grupuxo/dev/whatsapp` **sem valor** (o dono grava; o valor nunca entra no estado).
- Lambdas `grupuxo-dev-webhook`, `-worker` e `-api` (Node 22, arm64), roles de menor privilégio e logs com 14 dias de retenção.
- Function URLs públicas para `webhook` e `api`, cada uma com as duas permissões que a AWS exige desde out/2025.

Nada aqui roda sem autorização explícita do dono (CLAUDE.md).

## 1. Ferramentas e login (uma vez)

```sh
brew install awscli
brew tap hashicorp/tap && brew install hashicorp/tap/terraform
aws configure sso --profile grupuxo-dev   # portal do IAM Identity Center, conta 641328361775, região us-east-1
aws sso login --profile grupuxo-dev
aws sts get-caller-identity --profile grupuxo-dev   # confere a conta
```

## 2. Build e deploy

```sh
cd backend
npm install
npm run typecheck && npm test
npm run build                      # gera dist/{api,webhook,worker}/index.mjs
cd infra
cp terraform.tfvars.example terraform.tfvars   # preencher (nada é segredo)
terraform init
terraform plan -out dev.tfplan
terraform apply dev.tfplan
```

Antes do apply, confira que o `gemini_model` segue disponível (doc do Gemini) e a versão atual da Graph API. Mudou código? `npm run build` e de novo `plan`/`apply` (o hash do zip troca a Lambda).

## 3. Segredo (o dono grava; ninguém mais digita estes valores)

Console → Secrets Manager → `grupuxo/dev/whatsapp` → *Retrieve secret value* → *Set secret value* → *Plaintext*:

```json
{
  "WHATSAPP_TOKEN": "...",
  "WHATSAPP_APP_SECRET": "...",
  "PHONE_NUMBER_ID": "...",
  "VERIFY_TOKEN": "...",
  "GEMINI_API_KEY": "..."
}
```

- `WHATSAPP_TOKEN`: token de acesso da Cloud API (o temporário do *API Setup* vence em 24 h; o de um *System User* do Business Manager não vence).
- `WHATSAPP_APP_SECRET`: app da Meta → *App settings* → *Basic* → *App secret*.
- `PHONE_NUMBER_ID`: *WhatsApp* → *API Setup*, abaixo do número de teste.
- `VERIFY_TOKEN`: qualquer valor aleatório, por exemplo `openssl rand -hex 32`; o mesmo vai no painel da Meta.
- `GEMINI_API_KEY`: Google AI Studio.

As Lambdas leem o segredo uma vez por instância. Trocou o valor? Uma instância já aquecida segue com o antigo até ser reciclada; para forçar, rode de novo `terraform apply -replace='aws_lambda_function.lambda["worker"]'` (ou `webhook`).

## 4. Meta

1. *WhatsApp* → *API Setup*: cadastre o seu celular como destinatário (o número de teste só responde a até 5).
2. *WhatsApp* → *Configuration* → *Webhook*: *Callback URL* = output `webhook_url`; *Verify token* = o `VERIFY_TOKEN`. A Meta faz o GET de verificação na hora.
3. Em *Webhook fields*, assine `messages`.

## 5. Casa de demonstração e vínculo

```sh
cd backend
AWS_PROFILE=grupuxo-dev AWS_REGION=us-east-1 TABLE_NAME=grupuxo-dev BOT_PHONE_NUMBER=+1555... \
  node tools/seed-dev/seed.ts house --name "Seu nome"
```

Cria a casa (moradores, cômodos e tarefas da demonstração, com você no lugar da Marina) e imprime um link `wa.me` válido por 15 minutos. Abra no celular cadastrado e envie a mensagem como está: o bot confirma o vínculo. Depois, pergunte "quais são minhas tarefas?". Para outro link: `node tools/seed-dev/seed.ts link <seu userID>`. Rode `house` uma vez só (cada execução cria uma casa nova).

## 6. App apontando para o `dev`

```sh
cd grupuxo
cp Config/Local.xcconfig.example Config/Local.xcconfig   # fora do git
terraform -chdir=../backend/infra output -raw api_url  # cole no lugar de SEU-ID..., trocando `//` por `/$()/`
```

Só o Debug usa esse endereço; o Release continua `CONFIGURE-ME` (falha fechado) até existir `prod`.

## Diagnóstico

```sh
aws logs tail /aws/lambda/grupuxo-dev-webhook --since 15m --profile grupuxo-dev
aws logs tail /aws/lambda/grupuxo-dev-worker --since 15m --profile grupuxo-dev
aws sqs get-queue-attributes --queue-url "$(terraform output -raw dlq_url)" --attribute-names ApproximateNumberOfMessages --profile grupuxo-dev
```

O código não registra conteúdo de mensagem: os logs só mostram erros e a duração das invocações.
