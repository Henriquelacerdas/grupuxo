# Demo local (sem AWS) para o TestFlight externo

O backend roda num processo `node` no Mac, com banco em arquivo (`backend/data/db.json`), exposto por um túnel HTTPS. Contexto e limites: [BACKEND.md §9.1](BACKEND.md). Nada aqui usa DynamoDB, SQS, Lambda nem Terraform.

## 1. Preparar

```sh
cd backend
npm install
cp .env.example .env   # preencher: Meta, Gemini, COGNITO_CLIENT_ID, BOT_PHONE_NUMBER
npm run start:local    # ouve em http://localhost:8787
```

`GET http://localhost:8787/health` responde `ok`. Sem variável obrigatória o servidor não sobe e diz o **nome** da variável que falta. `data/db.json` é o banco inteiro: copie para fazer backup; arquivo corrompido faz o servidor recusar a subir (nunca recomeça vazio por cima).

## 2. Endereço público estável

O app (build do TestFlight) e o webhook da Meta apontam para o mesmo endereço HTTPS fixo. O túnel rápido do Cloudflare (`cloudflared tunnel --url http://localhost:8787`) muda de URL a cada execução: serve só para teste de bancada. Para o TestFlight use um **named tunnel** (domínio no Cloudflare) ou equivalente com domínio fixo.

- **Meta (WhatsApp Cloud API):** URL de callback `https://<seu-dominio>/webhook`, token de verificação igual a `VERIFY_TOKEN`, campo `messages`.
- **App:** no Xcode, build setting `GRUPUXO_API_BASE_URL` da configuração **Release** (hoje `https://CONFIGURE-ME.example.com`, que faz o app recusar falar com qualquer servidor). Debug usa `http://localhost:8787` (simulador).

## 3. Ver funcionando

1. Simulador/aparelho: entrar com a conta Cognito, criar a casa (ou entrar por código), em Casa criar um cômodo e uma tarefa.
2. Perfil → Conectar WhatsApp → o app abre o WhatsApp com a mensagem pré-preenchida; enviar. O bot responde "Seu WhatsApp está conectado".
3. No WhatsApp: "quais são minhas tarefas?"; concluir uma tarefa pelo bot (ele pede o "sim").

## 4. Limites conhecidos da demo

- Mac ligado e sem dormir durante a revisão; um processo só, sem alta disponibilidade.
- Fila em processo: uma queda no meio perde as mensagens pendentes (a Meta reentrega as que não receberam 200).
- Número de teste da Meta: até 5 números com WhatsApp.
- Sem rota na `api` (telas escondidas): trocas de tarefa, notificações, tarefas esporádicas, edição de tarefa, sair de/entrar em cômodo pela tela, remover morador.
- Cada serviço externo (Graph API, Gemini, Cognito) só é chamado de verdade com autorização do dono, item por item ([VALIDACAO-APIS-REAIS.md](VALIDACAO-APIS-REAIS.md)).
