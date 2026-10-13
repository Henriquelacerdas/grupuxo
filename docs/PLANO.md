# Plano: WhatsApp no TestFlight externo o quanto antes (a partir de `merge-feat-login`)

## Contexto
Duas frentes resolveram identidade, casa, moradores e convite de formas diferentes (Frente A: `backend/` TS + DynamoDB; Frente B: Amplify Data/AppSync no app). O merge (b4889da…ac6ff92) fez as duas coexistirem pela decisão ✅ 10. A auditoria (seção 4) concluiu que o domínio TS e o Swift são sólidos e que a costura do app era de nível demo; a Fase 1 consertou essa costura.

**Objetivo novo (2026-10-12):** pôr em TestFlight externo, o quanto antes, uma **casa compartilhada real** em que os moradores veem pelo WhatsApp as **mesmas tarefas** do app. Robustez menor é aceita, desde que registrada como dívida (seção 2). Decisões do dono:

- **Pular o Amplify Data** e ir direto para a `api` + DynamoDB do backend (D1 = b). O Amplify Data nunca foi implantado, então **não há o que migrar** (a pergunta 17 do BACKEND.md deixa de existir) e a antiga Fase 2 é cancelada.
- Infra com **Terraform mínimo**, um ambiente só (`dev`).
- Meta: hoje só há o **número de teste** da Cloud API, que responde a **no máximo 5 números destinatários** cadastrados no painel. A primeira rodada externa com WhatsApp fica limitada a esses 5; o número de produção corre em paralelo (T0).

Nada aqui toca AWS/Meta/Gemini sem autorização caso a caso.

Legenda: **FATO** = verificado no código/execução (arquivo:linha). **HIP** = hipótese, precisa de doc oficial ou teste real.

---

## 1. Veredito

O backend WhatsApp está pronto em código e testado com falsos: domínio, webhook, worker, Gemini, Graph, vínculo por token, limite de taxa e adaptadores DynamoDB (`src/adapters/dynamodb/`). O responder já acha a casa do morador vinculado e lista as tarefas (`assistant/gemini-responder.ts`: `houses(userID)` → `GetMyTasks`). O que separa o teste do TestFlight é:

1. **Backend:** comandos de casa (criar, entrar por código, sair), as rotas que o app usa, pontos de entrada das Lambdas, build e `infra/`. FATO: `addHouseMember` só cria usuário novo (`domain/commands/houses.ts:10-31`); a `api` só tem `/v1/me` e WhatsApp (`lambdas/api.ts:20-24`); não há `process.env`, empacotamento nem Terraform.
2. **Limite de 100 ações por transação:** FATO `HouseStateStore.update` falha fechado acima disso (`adapters/dynamodb/house-state-store.ts:141`); `addMember` ~140 e `removeMember` ~110 na casa de demonstração, e ler tarefas roda `refreshSchedule` (grava), então casa parada também pode estourar. Sem um atalho, ninguém entra na casa.
3. **App:** FATO nenhum `URLSession` nem `Data/Remote`; `AmplifyAuthSessionClient` descarta o access token (`AmplifyAuthSessionClient.swift:8-23`); sem configuração de URL da API. A troca é localizada: `AppContainer` tipa os repositórios como `any XRepository` (`AppContainer.swift:23-29`) e o `WhatsAppConnectionRepository` + `WhatsAppConnectionSection` já existem, só desmontados.

---

## 2. Atalhos aceitos e o que não se corta

**Atalhos** (dívida; remover antes de abrir para mais casas que as do teste):
- **Escrita acima de 100 ações dividida** em várias transações: a primeira leva o `Update` do `META` condicionado a `version`, as seguintes não. Opção `oversizedWrites: "fail" | "split"` no `HouseStateStore`, `fail` como padrão e `split` ligado só no ponto de entrada. Risco: estado parcial se falhar no meio, e uma leitura concorrente pode ver a casa pela metade. Solução definitiva: D3 (seção 6), depois do teste.
- Sem `Idempotency-Key` nas mutações (o domínio já é idempotente em concluir/atribuir).
- Um ambiente só: `dev`, em `us-east-1` (mesma região do Cognito; pergunta 4 decidida provisoriamente). Estado do Terraform local, sem CI de deploy, sem WAF, alarme só da DLQ.
- Telas sem rota no servidor **escondidas** no build de teste: trocas, notificações, esporádicas, renomear/apagar cômodo, **editar tarefa** (`PATCH` fica para depois do teste: o TS não tem `updateTaskDetails`), morador sem conta.
- Um morador, uma casa (regra v1 do bot): criar ou entrar com casa já existente é recusado.

**Não se corta:** validação do access token do Cognito (ID token rejeitado, `client_id` conferido), HMAC do webhook, `userID` sempre do token ou do vínculo, limite de taxa antes do vínculo e do Gemini, nada de conteúdo de mensagem em log, segredos só no Secrets Manager, IAM de menor privilégio, e cada chamada real autorizada item a item.

---

## 3. Trilha rápida

Ordem e paralelismo: T0 começa já e corre em paralelo. T1 destrava T2 e T4, que andam juntas. T3 pode começar junto de T2 e entrega o primeiro marco (M1) só com as rotas que já existem e uma casa semeada.

### T0 — Prazos externos (dono; começa já)
- [ ] Número de produção na Cloud API e app da Meta em modo Live (exige URL de política de privacidade). **HIP:** se a verificação de empresa é obrigatória para responder a mensagens iniciadas pelo usuário; conferir na doc da Meta. Assinar o campo `messages` do webhook.
- [ ] Chave do Gemini (projeto de teste). **`gemini-2.5-flash-lite` é desligado na Gemini API em 2026-10-16** (página de descontinuações do Google); o `dev` usa o substituto indicado, `gemini-3.1-flash-lite` (o cliente já devolve o `thoughtSignature` que os modelos com raciocínio exigem). Validar M1–M3 com ele.
- [ ] Acesso à conta AWS para o `terraform apply` e para gravar os segredos.
- [ ] App no App Store Connect, grupo de teste externo, e **conta de demonstração com casa semeada** para o Beta App Review (a revisão pede login).
- [ ] Cadastrar no painel da Meta os até 5 números dos testadores com WhatsApp.

### T1 — Contrato primeiro (~0,5 dia)
- ✅ (aprovado pelo dono; `646f271`) BACKEND.md §6.1 com as rotas de T2, JSON de entrada e saída, erros e códigos HTTP, revisado pelas duas frentes antes de qualquer código.
- ✅ (lado TS, `646f271`; o teste Swift é T4) Teste de contrato TS↔Swift: um teste TS grava um JSON de exemplo de cada resposta (casa, cômodo, participação, `TaskItem`, `TaskDefinition`) em `backend/test/fixtures/api/`, e um teste Swift decodifica os mesmos arquivos com os DTOs de `Data/Remote`. Pega divergência de DTO como as fixtures pegam divergência de algoritmo.

### T2 — Backend: domínio e `api` — ✅ feita no código (2026-10-12; `npm run typecheck && npm test`: 1065 testes verdes; nada tocou AWS, Meta nem Gemini)
1. ✅ Comandos de domínio (TS; regras de casa novas, sem equivalente no Swift):
   - ✅ `addExistingUserToHouse` extraído de `addHouseMember`, sem mudar comportamento nem a ordem de chamadas (`9f3966f`; fixtures intactas).
   - ✅ `createHouse(founderID, name, timezone)`: casa, "Casa toda" com o fundador, `accessCode` de um gerador injetado; no DynamoDB, `HouseStateStore.createHouse(state)` pelo caminho condicional do `seedHouse` (`META` com `version = 0` e `ACCESSCODE#`), com nova tentativa se o código colidir (`39bed90`, `3a46317`).
   - ✅ `joinHouseByCode(userID, code)` (código → casa por `GetItem ACCESSCODE#<code>`; `extraProfileIDs` pré-carrega o perfil de quem entra) e `leaveHouse(userID)` (comando separado; `removeHouseMember` segue proibindo remover a si mesmo; último morador → `last_member`) (`39bed90`, `3a46317`).
2. ✅ `HouseStateStore`: `oversizedWrites: "fail" | "split"` (padrão `fail`), com `partialWrite` se uma transação depois da primeira falhar; testes de divisão, conflito na primeira e falha no meio (`1a847cd`).
3. ✅ Rotas, todas com `userID` do token e `at` do servidor, conforme BACKEND.md §6.1: casa (`4d48d8a`), cômodos (`74d4434`), tarefas (`994aa0f`), ocorrências (`63398a3`). Antes delas, duas leituras de repositório que o contrato exigia (`TaskRepository.definition` e `houseOfOccurrence`, `05b9dc3`), para o 404 uniforme que a §6.1 manda.
4. ✅ Testes ponta a ponta do handler em memória e contra o DynamoDB com o cliente falso (`test/lambdas/api-routes*.ts`, com a escrita dividida ligada).

Pontos da implementação que o dono deve conhecer: o criador de cômodo privado entra sempre (união na rota, como diz a §6.1); uma tarefa criada começa na próxima segunda-feira (comportamento do domínio, anotado na §6.1); `already_in_house`/`no_house` leem o `GSI1`, eventualmente consistente (anotado na §6.1 e em D6 do checklist). Nenhuma fixture de API mudou, e o contrato da §6.1 não foi alterado (só notas).

### T3 — Deploy do bot (~2 dias; em paralelo com T2) — código pronto (2026-10-12), deploy aguardando o dono

**Conta AWS nova (2026-10-12):** sem acesso à conta antiga (580100736070), o `dev` vai para a conta **641328361775** (login por IAM Identity Center, perfil `grupuxo-dev`). O user pool do app (`us-east-1_M9GpISkE3`) continua na conta antiga e não muda: a `api` valida os tokens dele pelo JWKS público. Itens 1–4 escritos e testados localmente; o passo a passo do deploy está em `backend/infra/README.md`. Segredo: `grupuxo/dev/whatsapp`.

1. ✅ Pontos de entrada `backend/src/main/{api,webhook,worker}.ts` (+ `aws-sdk.ts`, `runtime.ts`, `dynamo-adapters.ts`; o worker ganhou `BOT_PHONE_NUMBER`): a única camada que lê `process.env` e importa `@aws-sdk`; embrulham o SDK nos clientes mínimos (`DynamoClient`, `SqsClient`, `SecretsManagerClient`), leem o segredo, montam os adaptadores DynamoDB e passam as retenções de TTL (sugestão: `WAMID#` 7 dias, `RATE#` janela + 5 min, `LINKTOKEN#` validade + 1 h). Teste de arquitetura atualizado para a nova camada. **Herdado de T2, na `api`:** `new HouseStateStore(client, runtime, { oversizedWrites: "split" })`; o gerador de código de convite (`newAccessCode`, `^[A-Z0-9]{4,16}$`, de `crypto`, sem caracteres ambíguos) passado ao `DynamoHouseRepository`; `now` (relógio) e `newID` (`crypto.randomUUID`) passados ao `createApiHandler` e ao `CommandContext`; `DynamoRuntime` (`sleep`, `random`) real; `DynamoUserDirectory` e os repositórios `DynamoHouse/Room/TaskRepository` montados sobre o mesmo store. (`extraProfileIDs` já é usado por dentro do `DynamoHouseRepository.joinByCode`: não há o que ligar.)
2. ✅ Build: `esbuild` (devDependency) gera um bundle por Lambda; o AWS SDK v3 fica externo (vem no runtime Node 22) e entra só como devDependency de tipos. Fecha as perguntas 13–15.
3. ✅ (escrito; falta `apply`) `backend/infra/` (Terraform): tabela a partir de `table-definition.ts` (GSI1, TTL, sob demanda), SQS FIFO + DLQ (`ContentBasedDeduplication` desligada, `ReportBatchItemFailures`), segredos (valores gravados pelo dono fora do state), 3 Lambdas Node 22 com roles mínimas, 2 Function URLs `AuthType = NONE`, concorrência reservada (variável, desligada por padrão: conta nova tem limite total baixo), logs com retenção, alarme da DLQ.
4. ✅ (escrito; roda só com autorização) `backend/tools/seed-dev/seed.ts`: `house` cria a casa de demonstração (o dono no lugar da Marina, código de convite aleatório) e imprime o link `wa.me` de vínculo; `link <userID>` gera outro. O vínculo pelo token usa o `from` real da Meta (evita o nono dígito na gravação). Para a conta do revisor da Apple, falta ligar o morador ao `COGNITO#<sub>` (depende de T4).
5. **Marco M1:** o bot, no número de teste, responde "minhas tarefas" da casa semeada ao celular do dono. Valida, cada um com autorização: G1, G2, G8, G9, M1–M3, A1–A6, A8, A9, D1 e D2 (VALIDACAO-APIS-REAIS.md).

### T4 — App na `api` (~3–4 dias; começa depois de T1)
1. `Data/Remote`: `APIClient` (URLSession, JSON, `Authorization: Bearer`), `AccessTokenProvider` sobre o Amplify Auth (`fetchAuthSession` → `accessToken`; renovação pelo Amplify; 401 desloga), DTOs e `RemoteHouseRepository`, `RemoteRoomRepository`, `RemoteTaskRepository`, `RemoteWhatsAppConnectionRepository`. Métodos sem rota lançam um erro `unsupported`; os parâmetros `requestedBy`/`at` são ignorados (o servidor usa o token e o próprio relógio).
2. URL base da `api` por `.xcconfig` → chave no `Info.plist`.
3. `RemoteHouseSession` (`@MainActor`, `ObservableObject`) no lugar do `HouseService`: `POST /v1/me` com o nome → `GET /v1/me/house`; criar, entrar por código, sair, mostrar código. `HouseGateView`, onboarding e `HouseView` passam a usá-lo. `User.id` passa a ser o id do backend (D2), não o `sub`.
4. `AppContainer` com os repositórios remotos; saem `RootModel.sync`, `AppContainer.sync` e o plugin API do Amplify (fica só o Auth). `Data/Amplify` e `grupuxo/amplify` são apagados na limpeza do fim da trilha.
5. Reativar a `WhatsAppConnectionSection` com o repositório remoto. Esconder as telas da seção 2, **inclusive a edição de tarefa** (sem `PATCH` na `api`; encerrar usa `POST /v1/rooms/{roomID}/tasks/{taskID}/end`, então o `RemoteTaskRepository` precisa do `roomID`, que o `TaskDefinition` já carrega).
6. Testes: decodificação dos JSON de `backend/test/fixtures/api/` (teste Swift que decodifica os mesmos arquivos que o teste TS de T1 grava, com formatador próprio de datas ISO com milissegundos), `APIClient` com `URLProtocol` falso (401, 404 `no_house`, erro de rede), `RemoteHouseSession` com cliente falso.

### T5 — Rodadas de teste
- **M2, TestFlight interno:** duas contas em dois aparelhos: criar casa, entrar por código, criar tarefa, ver a mesma escala no app e no WhatsApp, concluir pelo bot (com o "sim") e ver concluída no app. Roteiro anotado em VALIDACAO-APIS-REAIS.md §6.
- **M3, TestFlight externo:** com até 5 números com WhatsApp enquanto for o número de teste. Com o número de produção pronto, basta trocar `BOT_PHONE_NUMBER` e o segredo: o link `wa.me` vem do servidor, sem novo build.

---

## 4. Achados da auditoria (contexto; o que ficou obsoleto está marcado)

### Ambiente
- **FATO (resolvido):** o repositório estava no iCloud Drive com arquivos "despejados" (`dataless`), o que quebrava fixtures e o pack do git. A cópia de trabalho atual está fora do iCloud.

### Sessão e login (resolvido na Fase 1, itens 2 e 3)
- `AuthService.checkSession` só lia `isSignedIn`; a tela de erro do `HouseGateView` prendia o usuário; não havia listener do Hub; `signOut` com `.failed` mantinha o usuário logado; um `load()` da conta anterior podia repor a casa antiga.

### Composição do app (resolvido na Fase 1, itens 1, 4 e 5)
- `RootView.init()` criava um `AppContainer` + `MockStore` novo a cada reavaliação; `syncWithHouse` com falha deixava spinner eterno; `uuid()` inventava id; cômodo era gravado no Mock antes do Amplify; `grupuxoApp.swift` era código morto.

### Identidade
- **FATO** no app, `User.id` = `sub`; no backend, `User.id` é um UUID próprio e o `sub` é mapeado por `COGNITO#<sub>` (`adapters/dynamodb/user-directory.ts:36`). Com a trilha, o app passa a usar o id do backend (D2).
- **FATO** o backend não tinha comando para criar casa nem para um usuário existente entrar por código (`domain/commands/houses.ts:10-31`). Coberto em T2.
- Morador sem conta nunca vira conta (D4): fora da trilha, tela escondida.

### Amplify Data — **obsoleto** (não será implantado)
Convite forjado dando acesso a qualquer casa, perda de atualização em entradas simultâneas no `joinHouse`, lista `members` desatualizada no cliente, saída não retomável, `list` com filtro depois de `limit: 1000`, edição livre de `members` e erros reconhecidos por texto. Ficam registrados como motivo para não implantar.

### Tarefas, histórico e telas
- **FATO (resolvido na Fase 1.7):** `DeleteTask` apagava histórico; virou `endTask` nos dois lados.
- **FATO (resolvido):** `ProfileView` sem rota, apagado; seção de WhatsApp falsa, escondida (volta em T4 com o repositório remoto).
- **FATO (resolvido):** `completionKeepsResidentAndUpdatesRoomState` era teste desatualizado; `SporadicTasksViewModel` ganhou o desfazer.

### Terceira frente
- **FATO** `origin/banco_de_dados` (5896a7c) trazia um segundo modelo DynamoDB (`HouseholdApp`, `snake_case`, `setup-table.js`) incompatível com BACKEND.md §4, importado de dentro do domínio. Nada disso existe no `HEAD`. **HIP:** se `setup-table.js` rodou, existe uma tabela `HouseholdApp` na conta AWS; perguntar à autora antes do `terraform apply` para não confundir as tabelas.

---

## 5. Fases antigas, reclassificadas

### Fase 0 — Higiene
- ✅ Repositório fora do iCloud; ✅ CI mínima (`.github/workflows/ci.yml`). Falta a primeira execução verde no GitHub.
- Ainda vale: conversar com quem mantém `banco_de_dados` (não mesclar de novo; aproveitar a pessoa em T3) e perguntar se `setup-table.js` rodou na AWS.

### Fase 1 — Costura do app — ✅ feita no código
Itens entregues: dono estável do container (`121d8a0`), sessão (`923e083`), erros de carga (`c38ddd2`), sincronização que falha fechado (`6738f6d`), cômodo remoto primeiro (`d9d2229`), WhatsApp falso escondido (`2bbb0da`), `endTask` (`b17bc87`), perfil morto apagado (`1837373`), desfazer nas esporádicas (`ce8a39f`). Suítes verdes ao fechar: `npm test` (960), `swift test` do domínio e `xcodebuild test -only-testing:grupuxoTests`.

Verificação manual que **continua valendo** (sessão e login, independem do Amplify Data):
- [ ] Modo avião: abrir com sessão salva continua logado; a tela de erro mostra "Tentar novamente" e "Sair da conta".
- [ ] "Sair da conta" sem rede limpa o estado local e volta ao login.
- [ ] Sessão vencida de verdade (Cognito), com o app aberto e fechado: volta ao login. Confirma a HIP do Hub.

Os demais itens da verificação antiga (troca de conta durante `load()`, cômodo em modo avião, tarefa que some depois de ação na casa, encerrar tarefa) passam a ser conferidos contra a `api`, em M2.

### Fase 2 — Endurecer o Amplify Data — **cancelada**
O Amplify Data não será implantado (D1 = b).

### Fases 3 e 4 — Backend e migração do app
O necessário para o teste entrou na trilha (T2–T4). Fica **para depois do teste**:
- D3 definitivo, substituindo o `oversizedWrites: "split"`.
- `Idempotency-Key`, ambiente `prod`, Terraform com estado remoto e CI de deploy, alarmes de 5xx.
- Trocas, notificações e esporádicas no servidor, e as telas de volta.
- Morador sem conta (D4) e desvincular o WhatsApp ao sair da casa (pergunta 10; recomendo sim).
- O `GrupuxoDomain` Swift e o gerador de fixtures saem do caminho quando o app não usar mais o Mock (regra do CLAUDE.md).

---

## 6. Decisões

- **D1. Amplify Data ou `api`?** ✅ `api` direto (2026-10-12).
- **D2. Identidade:** `User.id` próprio + `COGNITO#<sub>` no backend (recomendado e adotado na trilha). O app deixa de usar o `sub` como id.
- **D3. Transação > 100 ações (pergunta 1):** provisório = `split` (seção 2). Definitivo, depois do teste: **recomendo (c) agrupar a escala futura** (ocorrências pendentes + atribuições de uma tarefa num item, histórico imutável em itens separados). (a) intenção com *roll-forward* é a mais geral e a mais complexa; (b) lotes no domínio quebra a atomicidade.
- **D4. Morador sem conta:** recomendo "reivindicar" o registro ao entrar pelo código, só no servidor. Fora da trilha.
- **D5. `DeleteTask`:** ✅ "encerrar" (Fase 1.7).

---

## 7. Riscos da trilha e o que monitorar
- **Escrita dividida** deixando uma casa inconsistente: poucas casas no teste; monitorar `DynamoStoreError` e falhas da `api`; reconstruir pelo seed se preciso.
- **Meta:** limite de 5 destinatários no número de teste; prazo do número de produção e do modo Live; nono dígito (G2).
- **Beta App Review:** precisa de login de demonstração e de uma casa com tarefas; o recurso de WhatsApp pode ser questionado se o revisor não conseguir usá-lo (descrever no texto da revisão).
- `refreshSchedule` de casa parada há semanas (gravações e custo; D3 e D5 do checklist).
- Contas Apple e e-mail do mesmo morador são pessoas diferentes.
- Monitorar: DLQ com mensagens, 5xx e 401 da `api`, latência do worker.

## 8. Processo enxuto para as equipes não divergirem
1. **Contrato antes de código:** qualquer coisa que cruze app↔servidor (rota, campo, id, erro) entra primeiro como PR só de doc em BACKEND.md §6 / ARQUITETURA.md, revisado por alguém de cada frente (T1).
2. **Um dono por conceito:** identidade, casa e convite são da Frente A (servidor); a Frente B consome. Nada de segunda implementação "provisória" sem data de remoção escrita.
3. **Branches curtas e CI obrigatório** na `main`; merge semanal.
4. Checklist de PR com os itens do CLAUDE.md que mais quebram: Swift↔TS + fixtures, docs no mesmo commit, nenhuma chamada real.
5. Repositório fora de pasta sincronizada (iCloud/Dropbox).

## Verificação geral
- `npm run typecheck && npm test` em `backend`, `swift test --package-path grupuxo/Packages/GrupuxoDomain`, `xcodebuild test … -only-testing:grupuxoTests`.
- Teste de contrato JSON TS↔Swift (T1).
- Testes reais só com autorização item a item, anotados em `docs/VALIDACAO-APIS-REAIS.md` (M1 e M2 na §6).
