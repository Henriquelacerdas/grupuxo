# Backend e integração com WhatsApp

Proposta de arquitetura para alinhar com o desenvolvimento do banco antes de codar. Status: **rascunho para revisão**. Decisões marcadas com ✅ já foram tomadas; as marcadas com ❓ estão em aberto (seção 12).

Documentos relacionados: [ARQUITETURA.md](ARQUITETURA.md) (app), [ALGORITMO.md](ALGORITMO.md) (contrato matemático), [PRODUTO.md](PRODUTO.md).

## 1. Objetivo e escopo

Hoje o app roda inteiro sobre `MockStore`, em memória, sem login e sem persistência. Este documento define:

1. Um backend AWS que passa a ser a **fonte de verdade** dos dados.
2. Um canal WhatsApp que atua como **mais um cliente** desse backend.

**v1 do WhatsApp (✅): somente consulta.** Exemplo: "quais são minhas tarefas da semana?". Concluir tarefas ("acabei de limpar a sala"), lembretes proativos e trocas ficam para versões seguintes, mas o desenho já os comporta (seção 9).

Fora de escopo: avaliação da casa, widget, Siri, lista de mercado e financeiro (ver roadmap em PRODUTO.md).

## 2. Decisões

| # | Decisão | Motivo |
| --- | --- | --- |
| ✅ 1 | O cálculo da escala (Húngaro, justiça, replanejamento) roda **no servidor, em Swift**, reusando o `Domain/` do app | Uma única implementação. Se app e WhatsApp calculassem separados, divergiriam. Também permite concluir tarefas pelo WhatsApp sem o app aberto. |
| ✅ 2 | Banco: **Aurora PostgreSQL** | O modelo é relacional (casa → cômodos → tarefas → ocorrências) e a conclusão precisa de transação forte. |
| ✅ 3 | LLM: **Gemini**, via API REST com *function calling* | Escolha do time. |
| ✅ 4 | Vínculo do número: **link `wa.me` com token**, com código de verificação como plano B | Ver seção 8. |
| ✅ 5 | O LLM só **interpreta a intenção**; nunca grava dados nem calcula escala | Segurança e previsibilidade. Toda leitura e escrita passa pelos casos de uso. |

## 3. Visão geral

```
┌─────────┐   HTTPS + JWT     ┌───────────────┐
│ App iOS │ ────────────────► │ API Gateway   │
└─────────┘                   │ (HTTP API)    │
                              └──────┬────────┘
                                     ▼
┌──────────┐  webhook   ┌────────────────────┐        ┌────────────────────┐
│ WhatsApp │ ─────────► │ Lambda "webhook"   │        │ Lambda "api" (Swift)│
│ (Meta)   │            │ valida assinatura  │        │ casos de uso        │
└──────────┘            │ e enfileira        │        └─────────┬──────────┘
      ▲                 └─────────┬──────────┘                  │
      │                           ▼                             ▼
      │                    ┌─────────────┐             ┌────────────────┐
      │                    │ SQS (FIFO)  │             │ Aurora          │
      │                    └──────┬──────┘             │ PostgreSQL      │
      │                           ▼                    │ (via RDS Proxy) │
      │                 ┌────────────────────┐         └────────────────┘
      └──────────────── │ Lambda "worker"    │ ◄──── lê/grava pelos mesmos
        Graph API       │ Gemini + casos de  │       casos de uso do domínio
                        │ uso                │
                        └────────────────────┘

Secrets Manager: segredos da Meta e do Gemini (seção 10)
```

Três Lambdas com responsabilidades separadas:

| Lambda | Responsabilidade | Observação |
| --- | --- | --- |
| `api` | Endpoints do app (seção 6) | Autenticada por JWT |
| `whatsapp-webhook` | Responde ao *challenge* (GET), valida a assinatura e enfileira (POST) | Sem dependência de domínio nem de LLM. Responde 200 em milissegundos. |
| `whatsapp-worker` | Consome a fila, resolve o usuário, chama Gemini, executa o caso de uso e responde | Idempotente por `wamid` |

O webhook nunca chama o LLM diretamente. A Meta reenvia o evento se não receber 200 rápido, e sem fila o mesmo pedido rodaria duas vezes.

### Estrutura de código

O `Domain/` do app não importa SwiftUI nem persistência, então virou um pacote local (✅ feito):

```
grupuxo/
  Packages/
    GrupuxoDomain/        entidades, repositórios (protocolos), casos de uso, serviços
  grupuxo/                app iOS (Presentation, App, Data/Mock, Data/Remote)
backend/
  Sources/
    Persistence/          repositórios PostgreSQL (implementam os protocolos do Domain)
    ApiLambda/
    WhatsAppWebhookLambda/
    WhatsAppWorkerLambda/
  infra/                  IaC (AWS CDK ou SAM ❓)
```

Regra mantida: **nenhuma regra de negócio no backend fora do pacote de domínio**. As Lambdas só traduzem HTTP/WhatsApp em chamadas a casos de uso.

## 4. Modelo de dados (PostgreSQL)

Espelha as entidades do app. IDs são `uuid`, os mesmos que o app já usa. Datas em `timestamptz` (UTC).

| Tabela | Origem | Campos-chave |
| --- | --- | --- |
| `users` | `User` | `id`, `name`, `email`, `apple_sub` (único), `created_at` |
| `houses` | `House` | `id`, `name`, `access_code` (único), `timezone`, `created_at` |
| `house_memberships` | `HouseMembership` | `house_id`, `user_id`, `joined_at`, `left_at` |
| `rooms` | `Room` | `id`, `house_id`, `name`, `visibility`, `periodicity` (n, x), `simultaneous_assignees`, `appearance`, `schedule_versions` |
| `room_memberships` | `RoomMembership` | `room_id`, `user_id`, `left_at`, `rotation_changes`, `fairness_debt` |
| `task_definitions` | `TaskDefinition` | `id`, `room_id`, `name`, `effort` (1–3), agenda, fila rotativa, `pending_rotation` |
| `task_occurrences` | `TaskOccurrence` | `id`, `task_definition_id`, `available_at`, `due_at`, `status`, `completed_at`, `completed_by`, `effort_snapshot`, `completion_debt_impacts` |
| `task_assignments` | `TaskAssignment` | `occurrence_id`, `user_id`, `assigned_at`, `ended_at`, `superseded_at` |
| `task_swap_requests` | `TaskSwapRequest` | `id`, ocorrências oferecida/pedida, `status` |
| `notifications` | `AppNotification` | `id`, `user_id`, payload, `read_at` |
| `absences` | `Absence` | `house_membership_id`, `[starts_at, ends_at)` |
| `whatsapp_links` | **novo** | `user_id`, `phone_e164` (único), `status`, `consented_at`, `linked_at` |
| `whatsapp_link_tokens` | **novo** | `token_hash`, `user_id`, `expires_at`, `used_at` |
| `whatsapp_inbox` | **novo** | `wamid` (PK), `received_at`, `processed_at` (idempotência e auditoria) |

Estruturas aninhadas (fila rotativa, versões de escala, `completion_debt_impacts`) podem ser `jsonb` na primeira versão; o desenvolvedor do banco decide o quanto normalizar. Restrições que o banco deve garantir:

- Invariantes do PRODUTO.md (toda tarefa tem `room_id`; `house_id` é derivado do cômodo, sem coluna duplicada nas tarefas).
- `phone_e164` único: um número, um morador.
- Alterar `task_definitions` nunca reescreve `task_occurrences` passadas.

### Concorrência e transações

Cada comando transacional do app (`create`, `complete`, `refreshSchedule`, `addMember`, `removeMember`) executa hoje **dentro** de `MockStore.update` (cópia, commit, rollback). No servidor, isso vira:

1. `BEGIN` com bloqueio por casa: `SELECT ... FROM houses WHERE id = $1 FOR UPDATE` (ou *advisory lock* por `house_id`). Mutações de escala são por casa, então o bloqueio não atrapalha casas diferentes.
2. Carregar o estado da casa, executar o serviço de domínio (puro, sem I/O) e gravar o resultado.
3. `COMMIT`. Qualquer erro causa `ROLLBACK`.

Conclusão e atribuição continuam **idempotentes**: repetir não duplica esforço nem `fairness_debt`. Isso é essencial porque o WhatsApp entrega *at-least-once*.

Custo de conexões: Lambda abre muitas conexões, então usar **RDS Proxy**. Para custo baixo em desenvolvimento, Aurora Serverless v2 com pausa automática (min. 0 ACU) ❓.

## 5. Autenticação

O app planeja Sign in with Apple (PRODUTO.md).

1. O app obtém o *identity token* da Apple.
2. `POST /v1/auth/apple` valida o token e cria ou recupera o `users` por `apple_sub`.
3. O backend devolve um JWT de acesso (vida curta) e um *refresh token*.

Opções de implementação ❓: **Amazon Cognito** com a Apple como provedor federado (menos código, menos controle) ou validação própria do token da Apple na Lambda (mais código, mais simples de portar). O contrato do app é o mesmo nos dois casos.

**Autorização sempre no servidor.** A UI nunca é autoridade. Os casos de uso já recebem `userID` e aplicam `TaskEligibilityPolicy`; o `userID` vem do JWT (app) ou do vínculo do número (WhatsApp), **nunca de um campo enviado pelo cliente**.

## 6. API para o app

REST com JSON, sob `/v1`, autenticada por JWT. O app ganha `Data/Remote/` com repositórios que implementam os mesmos protocolos de `Domain/Repositories` (Views e Domain não mudam). DTOs e mapeadores ficam em `Data/Remote/`.

Um endpoint por ação de negócio, como os protocolos já fazem:

| Recurso | Endpoints (exemplo) |
| --- | --- |
| Casa | `POST /houses`, `POST /houses/join` (código de acesso), `GET /houses/{id}/members` |
| Cômodos | `GET /houses/{id}/rooms`, `POST /houses/{id}/rooms`, `POST/DELETE /rooms/{id}/members` |
| Tarefas | `GET /me/tasks`, `GET /rooms/{id}/tasks`, `POST /rooms/{id}/tasks` |
| Ocorrências | `POST /occurrences/{id}/complete`, `/reopen`, `/claim`, `/release` |
| Trocas | `GET/POST /swap-requests`, `POST /swap-requests/{id}/accept`, `/reject` |
| Notificações | `GET /notifications`, `POST /notifications/{id}/read` |
| WhatsApp | `POST /me/whatsapp/link` (gera token e link), `GET /me/whatsapp`, `DELETE /me/whatsapp` |

Todas as mutações aceitam `Idempotency-Key`. O `at` (data de referência) vem do **servidor**, não do dispositivo, para não depender do relógio do cliente.

Fuso: o mock usa o do dispositivo. No backend passa a ser **por casa** (`houses.timezone`), o que resolve a decisão aberta do PRODUTO.md e é necessário para "tarefas da semana" ter o mesmo significado no app e no WhatsApp.

### Sincronização do app

v1: o app consulta a API a cada abertura de tela e após mutações (já é o que os ViewModels fazem: "recarregar após mutações"). Sem *offline-first*. Notificações push (APNs) ficam para depois ❓.

## 7. Fluxo do WhatsApp

### 7.1 Webhook

1. **GET** (verificação): responde `hub.challenge` se `hub.verify_token` confere com o segredo (comparação em tempo constante). Nunca registrar o token em log.
2. **POST** (evento):
   - Validar `X-Hub-Signature-256` (HMAC-SHA256 do corpo bruto com o **App Secret** da Meta). Assinatura inválida: 401, sem processar.
   - Ignorar eventos que não sejam mensagens de texto (os de `statuses`, como entregue e lido, chegam no mesmo webhook).
   - Enfileirar no SQS FIFO (`MessageGroupId` = telefone, `MessageDeduplicationId` = `wamid`) e responder 200 imediatamente.

### 7.2 Worker

```
mensagem ─► inserir wamid em whatsapp_inbox (se já existe: descartar)
        ─► resolver telefone → usuário (whatsapp_links)
              ├─ desconhecido: se for token de vínculo, vincular (seção 8);
              │                senão responder "Vincule seu número no app"
        ─► Gemini (function calling) interpreta a intenção
        ─► executa a ferramenta → caso de uso (leitura)
        ─► formata a resposta em português e envia pela Graph API
```

Ferramentas expostas ao Gemini na v1 (somente leitura, sem parâmetro de usuário: o `userID` é injetado pelo worker):

| Ferramenta | Caso de uso | Exemplo |
| --- | --- | --- |
| `list_my_tasks(range)` | `GetMyTasks` | "quais são minhas tarefas da semana?" |
| `list_room_tasks(room_name)` | `GetRoomTasks` | "o que tem na cozinha?" |
| `list_sporadic_tasks()` | `GetSporadicTasks` | "tem alguma tarefa avulsa?" |

Se o Gemini não reconhecer a intenção, responde com a lista do que sabe fazer. O texto final pode ser gerado pelo próprio modelo a partir do JSON retornado, mas os dados (nomes, datas) vêm sempre da ferramenta.

### 7.3 Segurança do LLM

- O texto da mensagem é **entrada não confiável**. O modelo não tem acesso a banco, segredos ou a outros usuários, só às ferramentas acima.
- Um usuário só consegue dados que ele já veria no app, porque o caso de uso aplica a elegibilidade.
- Limite de taxa por número e teto de tokens por resposta, para controlar custo.
- Não registrar o conteúdo das mensagens em log além do necessário (dados pessoais; ver seção 11).

## 8. Vínculo número ↔ morador

✅ **Link `wa.me` com token** (padrão). ❓ Plano B: código de verificação.

Por que o `wa.me` é mais barato: quando é o **usuário** quem envia a primeira mensagem, abre-se uma janela de atendimento de 24 h em que o negócio pode responder livremente. Já o código de verificação é uma mensagem iniciada pela empresa, que exige um *template* de autenticação aprovado e é cobrada por mensagem. (Conferir a tabela de preços vigente da Meta antes de fechar o orçamento.)

Fluxo:

1. No Perfil, o usuário toca em "Conectar WhatsApp". O app chama `POST /me/whatsapp/link`.
2. O backend cria um token aleatório de uso único (≥128 bits, validade curta, ex. 15 min; grava apenas o *hash*) e devolve `https://wa.me/<numero-do-bot>?text=<mensagem com token>`.
3. O app abre o link. O usuário envia a mensagem pré-preenchida.
4. O worker recebe a mensagem, encontra o token, grava `whatsapp_links(user_id, phone_e164, consented_at)`, marca o token como usado e confirma no chat.
5. O app passa a mostrar "WhatsApp conectado", com opção de desconectar.

Cuidados:

- O token só vale uma vez e expira. Sem token válido, um número desconhecido nunca é vinculado.
- Um número pertence a um único usuário. Tentar vincular um número já usado devolve erro.
- Consentimento: o texto da tela deve explicar o que o bot lê e envia; o envio do token pelo usuário registra o aceite.
- Se o dono trocar de número, basta desconectar e conectar de novo.

## 9. Evolução (fora da v1)

| Etapa | O que muda |
| --- | --- |
| Concluir tarefa | Nova ferramenta `complete_task(occurrence_id)` → `CompleteTask`. **Confirmação obrigatória** antes de gravar ("Marcar *Limpar sala* como feita?"), guardando o pedido pendente por curto tempo. Idempotente por `wamid`. |
| Lembretes | Mensagens iniciadas pelo bot fora da janela de 24 h exigem *template* aprovado, com custo. Usar um agendador (EventBridge Scheduler) que enfileira lembretes. Por isso o *opt-in* explícito é gravado desde a v1. |
| Trocas, assumir esporádica | Novas ferramentas sobre os casos de uso existentes. |

## 10. Segredos e infraestrutura

Um segredo no **AWS Secrets Manager** (ex. `grupuxo/whatsapp`), lido só pelas Lambdas `webhook` e `worker`:

| Chave | Origem |
| --- | --- |
| `WHATSAPP_TOKEN` | Token permanente de um *System User* no Business Manager da Meta |
| `WHATSAPP_APP_SECRET` | Segredo do app Meta (validação da assinatura) |
| `PHONE_NUMBER_ID` | Número do WhatsApp Business |
| `VERIFY_TOKEN` | "Senha" do webhook |
| `GEMINI_API_KEY` | Google AI Studio / Vertex |

Regras:

- Nada de segredos no repositório, em variáveis de ambiente em texto puro nem em log. As Lambdas leem o segredo uma vez por instância e mantêm em cache.
- **Menor privilégio:** cada role recebe apenas `secretsmanager:GetSecretValue` no ARN desse segredo. Evitar a política gerenciada `SecretsManagerReadWrite`, que dá escrita em todos os segredos da conta.
- Sem usuário IAM com chaves de acesso para as Lambdas: elas usam a role de execução. Pessoas acessam por IAM Identity Center.
- Aurora em subnets privadas; credenciais do banco no Secrets Manager (rotação gerenciada) e acesso via RDS Proxy.
- Ambientes separados (`dev`, `prod`), com números e apps Meta distintos.
- Observabilidade: CloudWatch Logs com retenção definida, alarmes para DLQ com mensagens e erros 5xx, *X-Ray* opcional.
- Fila com DLQ e novas tentativas limitadas; o worker é idempotente.

## 11. Privacidade e LGPD

Dados pessoais tratados: nome, e-mail, número de telefone e conteúdo das mensagens.

- Finalidade e consentimento explícitos no vínculo (seção 8).
- Direito de desconectar e apagar: `DELETE /me/whatsapp` remove o número; a exclusão da conta remove o usuário e os vínculos.
- Guardar o mínimo do conteúdo das mensagens (não persistir o texto; manter só `wamid` e horário para idempotência).
- Dados em `sa-east-1` (São Paulo) se a latência e a disponibilidade dos serviços permitirem ❓.
- A Meta e a Google atuam como operadoras: revisar termos e transferência internacional.

## 12. Perguntas em aberto

Para o desenvolvedor do banco:

1. Quanto normalizar (`jsonb` para fila rotativa e versões de escala, ou tabelas próprias)?
2. Bloqueio por casa: `FOR UPDATE` em `houses` ou *advisory lock*?
3. Aurora Serverless v2 com pausa automática atende o custo do MVP?
4. Região: `sa-east-1` ou `us-east-1` (mais serviços e preços menores)?
5. IaC: CDK, SAM ou Terraform?

Para o produto:

6. Cognito ou validação própria do token da Apple?
7. Notificações push (APNs) entram antes ou depois do WhatsApp?
8. Qual modelo Gemini usar (custo × qualidade)? Deixar configurável por variável.
9. Um número de bot por ambiente ou um único número de produção?
10. O que acontece com o vínculo quando o morador sai da casa (desvincular automaticamente)?

## 13. Ordem de entrega sugerida

1. ✅ **Feito:** `GrupuxoDomain` extraído como Swift Package (`grupuxo/Packages/GrupuxoDomain`); o app continua funcionando com o mock.
2. Esquema PostgreSQL, repositórios de persistência e testes contra o mesmo conjunto de cenários do mock.
3. Lambda `api` e autenticação; `Data/Remote` no app (trocar mocks em `AppContainer`).
4. Vínculo do número (`wa.me`) e tela no Perfil.
5. Webhook + fila + worker, primeiro só eco, depois Gemini com as ferramentas de leitura.
6. Concluir tarefas com confirmação e, por fim, lembretes.

Os passos 1–3 e o esqueleto do webhook (passo 5, sem LLM) podem andar em paralelo.
