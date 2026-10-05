# Sugestões para o banco

Rascunho para levar ao responsável pelo Aurora PostgreSQL. **O backend nunca altera o banco**: nada aqui foi aplicado. Cada item traz o motivo, o SQL proposto, o impacto no código e se **bloqueia** a implementação do adaptador. Fonte do esquema assumido: [BACKEND.md](BACKEND.md) seções 4 e 14; o esquema real (projeto `casaviva`, DBeaver) vale mais e ainda não foi conferido. Quando o DDL chegar, cada divergência entra aqui.

Instantes são `timestamptz`; no código viram milissegundos desde a época Unix.

| # | Assunto | Bloqueia? |
| --- | --- | --- |
| 1 | Unicidade em `whatsapp_links` | Sim |
| 2 | `users.cognito_sub` | Sim (Lambda `api`) |
| 3 | `whatsapp_link_tokens` | Sim (contrato de `consume`) |
| 4 | `whatsapp_inbox` | Sim (contrato de `claim`) |
| 5 | `houses.timezone` | Não |
| 6 | Consumir token e criar vínculo na mesma transação | Não |
| 7 | Bloqueio por casa e leitura que escreve | Não (decisão de desenho) |
| 8 | Coluna `status` de `whatsapp_links` | Não |
| 9 | Telefone: E.164 e nono dígito | Não |

## 1. Unicidade em `whatsapp_links` (bloqueante)

**Motivo.** O código assume um número por morador e um morador por número, e traduz as violações em `WhatsAppLinkError`. Sem as restrições, dois vínculos concorrentes passam. Pergunta 12 de BACKEND.md (`UNIQUE (user_id)`).

```sql
ALTER TABLE whatsapp_links
  ADD CONSTRAINT whatsapp_links_user_id_key UNIQUE (user_id),
  ADD CONSTRAINT whatsapp_links_phone_e164_key UNIQUE (phone_e164);
```

**Impacto.** `create` mapeia `unique_violation` (SQLSTATE `23505`) pelo nome da restrição: `phone_e164` → `phoneAlreadyLinked`, `user_id` → `userAlreadyLinked`. Os nomes das restrições passam a fazer parte do contrato. Se o time preferir `UNIQUE (user_id)` ausente (vários números por morador), o código e a pergunta 12 mudam.

## 2. `users.cognito_sub` (bloqueante para a `api`)

**Motivo.** O `userID` do app vem do claim `sub` do JWT do Cognito; sem coluna única não há como resolver o morador (`POST /v1/me` idempotente).

```sql
ALTER TABLE users ADD COLUMN cognito_sub text;            -- se ainda não existir
CREATE UNIQUE INDEX users_cognito_sub_key ON users (cognito_sub) WHERE cognito_sub IS NOT NULL;
```

**Impacto.** Novo port de leitura (conta por `cognito_sub`) e criação idempotente por `INSERT ... ON CONFLICT (cognito_sub) DO NOTHING`. Moradores adicionados pelo dono da casa (sem login) ficam com `cognito_sub` nulo, por isso o índice parcial.

## 3. `whatsapp_link_tokens` (bloqueante)

**Motivo.** O `consume` precisa ser atômico e idempotente: um token, um uso.

```sql
ALTER TABLE whatsapp_link_tokens ADD CONSTRAINT whatsapp_link_tokens_pkey PRIMARY KEY (token_hash);
CREATE INDEX whatsapp_link_tokens_expires_at_idx ON whatsapp_link_tokens (expires_at);

-- consume(tokenHash, at)
UPDATE whatsapp_link_tokens SET used_at = $2
 WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2
RETURNING user_id;
```

**Impacto.** Só o SHA-256 (hex minúsculo) é gravado; o token em claro nunca chega ao banco. O índice por `expires_at` serve a uma limpeza periódica de tokens vencidos (não bloqueante).

## 4. `whatsapp_inbox` (bloqueante)

**Motivo.** Idempotência do worker por `wamid` (a Meta e o SQS entregam *at-least-once*). A coluna de texto da mensagem **não deve existir**: só `wamid` e horários (LGPD, BACKEND.md seção 11).

```sql
ALTER TABLE whatsapp_inbox ADD CONSTRAINT whatsapp_inbox_pkey PRIMARY KEY (wamid);
CREATE INDEX whatsapp_inbox_received_at_idx ON whatsapp_inbox (received_at);  -- retenção

-- claim(wamid, receivedAt): 1 linha = claimed, 0 = duplicate
INSERT INTO whatsapp_inbox (wamid, received_at) VALUES ($1, $2)
ON CONFLICT (wamid) DO UPDATE SET wamid = EXCLUDED.wamid
  WHERE whatsapp_inbox.processed_at IS NULL
RETURNING wamid;
```

**Impacto.** Definir uma política de retenção (por exemplo apagar linhas com mais de 30 dias) para não acumular dados pessoais indiretos.

## 5. `houses.timezone` (não bloqueante)

**Motivo.** O calendário de toda a escala e o filtro "da semana" usam o fuso IANA da casa; fuso nulo ou inválido faz o caso de uso falhar (falha fechada, `invalidDateInterval`).

```sql
ALTER TABLE houses ALTER COLUMN timezone SET NOT NULL;
-- opcional: CHECK (timezone IN (SELECT name FROM pg_timezone_names)) não é permitido (subconsulta);
-- alternativa: validar na aplicação ao criar a casa e, no banco, uma FK para uma tabela de fusos ou um trigger.
```

**Impacto.** Nenhum no código se o valor já for validado na escrita. Sugiro `'America/Sao_Paulo'` como padrão só se o produto confirmar.

## 6. Consumir token e criar vínculo na mesma transação (não bloqueante)

**Motivo.** Hoje são duas chamadas aos ports; se `create` falhar depois do `consume`, o token fica queimado (BACKEND.md seção 8). No PostgreSQL as duas operações cabem numa transação.

**Impacto.** Opcional: o adaptador pode oferecer um método combinado ou o worker pode envolver as duas chamadas numa transação do adaptador. Não muda o contrato dos ports.

## 7. Bloqueio por casa e leitura que escreve (decisão de desenho)

**Motivo.** Cada comando transacional roda com a casa bloqueada: `SELECT ... FROM houses WHERE id = $1 FOR UPDATE` ou `pg_advisory_xact_lock(hashtextextended(house_id::text, 0))`. `FOR UPDATE` bloqueia também a leitura concorrente da linha da casa; o advisory lock não toca em dados, mas exige disciplina (toda escrita da casa tem de chamá-lo). Recomendo **advisory lock transacional** (liberado no `COMMIT`/`ROLLBACK`) por não competir com outras escritas na linha de `houses`.

Observação importante: `GetMyTasks` e `GetSporadicTasks` chamam `refreshSchedule` antes de ler, ou seja, **uma consulta pode gravar** (materializa semanas pulando). No servidor isso significa transação de escrita com o bloqueio da casa mesmo em leituras. Alternativa: um agendador (EventBridge) chama `refreshSchedule` por casa e as consultas só leem. Decisão do time (ver ALGORITMO.md, "Refresh").

## 8. Coluna `status` de `whatsapp_links` (não bloqueante)

**Motivo.** O código não usa; desvincular apaga a linha. Remover para evitar estados que nada trata, ou manter só se houver necessidade de histórico (e aí definir quem escreve).

```sql
ALTER TABLE whatsapp_links DROP COLUMN status;  -- se existir e ninguém mais a usar
```

## 9. Telefone: E.164 e nono dígito (não bloqueante)

**Motivo.** O backend normaliza o `from` da Meta (só dígitos) para E.164 com `+`. Números brasileiros antigos podem chegar sem o nono dígito.

```sql
ALTER TABLE whatsapp_links
  ADD CONSTRAINT whatsapp_links_phone_e164_format CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$');
```

**Impacto.** O `CHECK` rejeita lixo na borda do banco. A normalização do nono dígito, se for necessária, fica na aplicação (decisão em aberto quando houver caso real).
