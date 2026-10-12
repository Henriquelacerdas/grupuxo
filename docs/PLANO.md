# Plano: costura app ↔ backend do grupuxo (a partir de `merge-feat-login`)

## Contexto
Duas frentes resolveram identidade, casa, moradores e convite de formas diferentes (Frente A: `backend/` TS + DynamoDB; Frente B: Amplify Data/AppSync no app). O merge (b4889da…ac6ff92) fez as duas coexistirem pela decisão ✅ 10. Auditei o código: o domínio TS e o Swift são sólidos e bem testados; **a costura é que é de nível demo**, e há problemas maiores que o "Refresh Token has expired". Este plano diz o que fazer, em que ordem, por quê e como verificar. Nada aqui toca AWS/Meta/Gemini sem autorização caso a caso.

Legenda: **FATO** = verificado no código/execução (arquivo:linha). **HIP** = hipótese, precisa de doc oficial ou teste real.

---

## 1. Veredito

O domínio (Swift e TS) e o backend WhatsApp estão sólidos para seguir. A integração do app **não** está: hoje o app não é confiável nem para um teste interno com duas pessoas.

**Maior risco:** colocar nas mãos de moradores uma "casa compartilhada" em que as tarefas são **por aparelho e somem ao fechar o app** (FATO: `RootView.swift:21` cria `MockStore(state: MockSeed.empty())` em memória), cada celular calcula a sua própria escala, a seção de WhatsApp é falsa (FATO: `MockWhatsAppConnectionRepository.swift:18-19` "conecta" sozinho) e o bot não enxerga a casa. Isso destrói a confiança no produto antes de ele existir. O segundo maior risco é organizacional: já existe uma **terceira** implementação de persistência em andamento (`origin/banco_de_dados`), e investir em endurecer o Amplify Data (descartável) em vez do caminho definitivo (`api` + DynamoDB) repete o mesmo erro.

---

## 2. Achados da auditoria (o que confirmei ou descartei)

### Ambiente (bloqueia tudo)
- **FATO: o repositório está no iCloud Drive e arquivos foram "despejados"** (`dataless`). `npm test` falha em 5 suítes de fixtures com `Unexpected end of JSON input` porque `backend/test/fixtures/*.json` estavam sem conteúdo local; o pack `.git/objects/pack/pack-3205…` também (git log quebra em b4889da). Não é bug de código. Risco: commits/merges corrompidos, testes falsos negativos. `origin/merge-feat-login` = `ac6ff92` (já está no GitHub, então dá para reclonar sem perda).

### Sessão e login
- **FATO** `AuthService.checkSession` (`AuthService.swift:20-28`) só lê `session.isSignedIn`; não olha os tokens. **HIP (verificar na doc do Amplify Swift):** com refresh token vencido, `fetchAuthSession` devolve `isSignedIn == true` e os tokens falham com `AuthError.sessionExpired`. Resultado observado: o app entra no `HouseGateView`, `load()` falha e aparece o erro.
- **FATO** a tela de erro do `HouseGateView` (`HouseGateView.swift:15-23`) só tem "Tentar novamente": **o usuário fica preso sem conseguir sair da conta**. É o seu sintoma.
- **FATO** não há listener do Hub de auth (nenhum `Amplify.Hub` no app): sessão que expira com o app aberto não volta ao login.
- **FATO** `signOut` com `.failed` (`AuthService.swift:67-68`) mantém o usuário logado sem feedback.
- **FATO** troca de conta: `houses.reset()` roda no `onChange` (`ContentView.swift:23-26`), mas um `load()` em andamento da conta anterior pode terminar depois e repor a casa antiga (sem cancelamento nem conferência de usuário em `HouseService.load`, `HouseService.swift:48-70`). O `MockStore` não vaza entre contas porque o `RootView` sai da hierarquia no logout.

### Composição do app (bug grave, não estava na sua lista)
- **FATO** `RootView.init()` cria um **novo `AppContainer` + `MockStore` vazio a cada inicialização da struct** (`RootView.swift:20-30`; `container` é `let`, não `@State`). `HouseGateView` observa `HouseService` (`HouseGateView.swift:6`), então cada `@Published` (ex.: `isLoading` em todo `perform`) reavalia o corpo e chama `RootView()` de novo. **HIP de alta confiança (comportamento padrão do SwiftUI; confirmar com teste de UI/log):** depois de qualquer ação da casa, os ViewModels já criados (`@StateObject`) ficam no store antigo e as telas empurradas depois (`destination(for:)`) usam o store novo e vazio; o `.task(id: syncKey)` só ressincroniza se a chave mudar. Sintomas esperados: cômodo "não encontrado", tarefas sumindo, escalas diferentes entre abas.
- **FATO** se `container.sync` falha, `syncWithHouse` só faz `return` (`RootView.swift:81-85`): spinner "Carregando sua casa…" para sempre.
- **FATO** `uuid()` gera `UUID()` aleatório quando o id não é UUID (`RootView.swift:94-96`): o morador mudaria de id a cada sincronização e o rebalanceamento rodaria de novo. **HIP:** o `sub` do Cognito e os ids do AppSync são sempre UUID (verificar na doc; o `sub` costuma ser UUID v4). Mesmo assim, falhar fechado é melhor que inventar id.
- **FATO** criar cômodo pelo `RoomEditor` grava primeiro no Mock e só depois no Amplify (`RootView.swift:172-177`); se o `addRoom` falhar, o próximo `sync` apaga o cômodo local e as tarefas dele (`AppContainer.swift:151-157`) sem avisar.
- **FATO** `grupuxoApp.swift` é um segundo `App` sem `@main` (código morto; o `@main` é `DomesticApp`).

### Identidade
- **FATO** no app, `User.id` = `sub` (`RootView.swift:87`, `MemberRecord.userId`). No backend, `User.id` é um **UUID novo** e o `sub` é mapeado por `COGNITO#<sub>` (`adapters/in-memory/user-directory.ts:31`, `adapters/dynamodb/user-directory.ts:36`). O desenho do backend está certo (indireção), mas `BACKEND.md:228` ("migrar sem mapear identidades") está impreciso: a migração **tem** de passar por `ensureUser`.
- **FATO** o backend não tem comando para criar casa nem para um usuário **existente** entrar por código: `addHouseMember` sempre cria um `User` novo sem conta (`domain/commands/houses.ts:10-31`); a `api` só tem `/v1/me` e WhatsApp (`lambdas/api.ts:21-23`). Ou seja, `POST /houses` e `/houses/join` ainda não existem nem no domínio.
- Morador sem conta (`MemberRecord.userId == nil`) nunca vira conta: quem cria conta depois entra como outra pessoa e o "fantasma" continua recebendo tarefas. Sem solução em nenhuma das frentes.

### Amplify Data: integridade e segurança (vale só se for implantar)
- **FATO + HIP crítica: convite forjado dá acesso a qualquer casa.** Qualquer logado pode criar um `InviteCode` com `members:[ele]` e `houseId` de outra casa (a regra `ownersDefinedIn('members')` só exige que ele esteja em `members`; HIP, testar em P2). O `joinHouse` (IAM) só confere que o código existe e que a casa existe (`join-house/handler.ts:39-45`) e então põe o chamador na casa alheia. Exige conhecer o `houseId`, mas é escalada de privilégio.
- **FATO: perda de atualização em entradas simultâneas.** `joinHouse` lê `house.members` e grava a lista inteira (`handler.ts:47-63`); dois moradores entrando juntos (caso real: código mandado no grupo) → o último sobrescreve e o outro fica com `MemberRecord` mas sem acesso.
- **FATO: lista `members` desatualizada no cliente.** `addRoom`, `addResident` e `detach` usam o `house.members` carregado antes (`HouseService.swift:163,196,282`). Ex.: C entra; A (com tela antiga) remove B → `remaining = [A]` é gravado em todos os registros e **C é expulso sem saber**.
- **FATO: sair da casa não é retomável.** `detach` apaga o próprio `MemberRecord` antes de atualizar a casa (`HouseService.swift:296-299`); se a última gravação falhar, `myMember` vira `nil` e `leaveHouse` não roda mais (`HouseService.swift:141`), mas o `sub` continua em `house.members`.
- **FATO: busca da casa.** `load()` usa `list` com filtro e `limit: 1000` sem `nextToken` (`HouseService.swift:43,59,320-326`). **HIP (comportamento do DynamoDB/AppSync, verificar):** o filtro é aplicado depois de ler até 1000 itens, então quando a tabela de `MemberRecord` passar de ~1000 registros **somando todas as casas**, o usuário pode "não ter casa", cair no onboarding e criar uma segunda. O schema já tem `index('userId')` (`data/resource.ts:40`) e o app não usa.
- **HIP:** com `ownersDefinedIn`, qualquer dono pode editar o campo `members` (acrescentar/remover outros). Aceitável no MVP (moradores com peso igual), mas também permite criar `MemberRecord`/`HouseRecord` com o `sub` de outra pessoa e "puxá-la" para uma casa (`load()` pega `memberships.first`). Baixo risco (exige o `sub` da vítima), registrar.
- Erros reconhecidos por texto (`"Conditional"`, `INVALID_INVITE_CODE`, `HouseService.swift:130,272`): frágil, já está em P3/P4.

### Tarefas, histórico e telas
- **FATO** `DeleteTask` (`MockTaskRepository.swift:497-503` → `TaskSchedulingService.deleteTask`, `TaskSchedulingService.swift:117-125`): sem `requestedBy`, sem checar participação no cômodo, apaga ocorrências concluídas e atribuições (histórico), e deixa `TaskSwapRequest`/`AppNotification` apontando para ocorrências que não existem. Não existe no TS (divergência Swift↔TS sem fixture). Contradiz a regra "definição e ocorrência separadas".
- **FATO** `ProfileView` sem rota (ARQUITETURA.md:99); usa moradores do Mock, que o `sync` apaga. Código morto.
- **FATO** seção de WhatsApp no `HouseView` (`HouseView.swift:31`) usa o mock que finge conectar.
- **FATO** `xcodebuild test`: tudo passa menos `TaskListPresentationTests/completionKeepsResidentAndUpdatesRoomState` (`grupuxoTests.swift:319`). **HIP:** depende do relógio real (`.now` contra o `MockSeed`; hoje é segunda-feira, virada de semana) e não de regressão do merge. Corrigir injetando uma data fixa, como os testes de agendamento já fazem.
- **FATO** `swift test` do pacote abortou com "input file … Room.swift was modified during the build": de novo o iCloud, não o código.

### Terceira frente (não estava no seu contexto)
- **FATO** `origin/banco_de_dados` (5896a7c, 2026-10-11, outra pessoa): `backend/src/adapters/database/*.js` com `@aws-sdk/lib-dynamodb`, tabela `HouseholdApp`, `SK: "METADATA"`, atributos `snake_case` e um `setup-table.js` — um **segundo modelo DynamoDB**, incompatível com BACKEND.md §4 e com `src/adapters/dynamodb/` (já pronto e testado). O último commit chama esse banco **de dentro de `src/domain/commands/`**, com validações comentadas e sintaxe que não compila (`addUserToHouse(userId: userID, …)`). Viola o CLAUDE.md (domínio puro, zero dependências, nenhuma chamada real). **HIP:** se `setup-table.js` foi executado, existe uma tabela `HouseholdApp` na conta AWS. É exatamente o padrão que gerou o merge difícil, e vai se repetir se não for tratado já.

---

## 3. Plano em fases

### Fase 0 — Higiene do ambiente (agora, ~0,5 dia)
Objetivo: ter um repositório e uma suíte em que se possa confiar.
1. Reclonar fora do iCloud (ex.: `~/dev/grupuxo`), `git fsck --full`, conferir que todas as branches locais com trabalho estão no GitHub (`backup/…`, `final-wpp`, `final-whatsapp`, `whatsapp`, `stash` não têm upstream: empurrar ou descartar conscientemente). Deixar a cópia do iCloud só como arquivo morto.
2. Rodar as três suítes na cópia nova; registrar a linha de base.
3. CI mínimo no GitHub Actions: `npm ci && npm run typecheck && npm test` (Node 22, não 25: o doc diz que só foi verificado no 25) e `swift test` do pacote. `xcodebuild test` no CI pode esperar.
4. Corrigir `completionKeepsResidentAndUpdatesRoomState` com data fixa (confirmar antes que é relógio, rodando com outra data).
5. **Parar a terceira frente:** conversar com quem mantém `banco_de_dados`, não mesclar, aproveitar a pessoa no que falta de verdade (pontos de entrada das Lambdas e Terraform, que usam o `src/adapters/dynamodb/` existente). Perguntar se `setup-table.js` rodou na AWS; se sim, registrar a tabela `HouseholdApp` e decidir apagá-la (com sua autorização).
- Pronto quando: três suítes verdes na cópia nova e CI verde no PR de `merge-feat-login`.

### Fase 1 — Consertar a costura do app (agora, independe de deploy; ~3 dias)
Objetivo: o app não perde estado sozinho, não prende o usuário e não mente.
1. **Dono estável do container.** `RootView`: `container` vira `@State` (ou é criado uma vez fora e passado). Em `ContentView`, `RootView().id(<sub do usuário>)` para garantir estado novo por conta. Apagar `grupuxoApp.swift`.
2. **Sessão.** `AuthService.checkSession`: além de `isSignedIn`, ler os tokens (`AuthCognitoTokensProvider.getCognitoTokens()`); `sessionExpired`/`signedOut` → `signOut` local e `isSignedIn = false`. Escutar o Hub de auth (`sessionExpired`, `signedOut`) no `AuthService`. `signOut .failed` também limpa o estado local. *(Nomes exatos das APIs: confirmar na doc do Amplify Swift v2.)*
3. **Erros de carga.** `HouseService` classifica a falha (`sessão expirada` vs `rede/AppSync`); sessão expirada vira logout; a tela de erro do `HouseGateView` ganha "Sair da conta". `load()` guarda o `userId` da chamada e descarta o resultado se o usuário mudou (ou é cancelado no `reset`).
4. **Sincronização que falha fechado.** `syncWithHouse`: erro visível + "Tentar novamente" em vez de spinner eterno; `uuid()` lança (id inválido = erro de dado) e normaliza para minúsculo.
5. **Cômodo: remoto primeiro.** No `RoomEditor`, gravar no Amplify antes do Mock (ou desfazer o Mock se o Amplify falhar) e mostrar o erro.
6. **Honestidade de produto.** Esconder a `WhatsAppConnectionSection` até a `api` existir. Se for distribuir para testadores, aviso claro de que as tarefas ainda ficam só neste aparelho.
7. **`DeleteTask` → "encerrar tarefa".** Mudar a regra no Swift (referência): exige `requestedBy` participante atual do cômodo; remove só ocorrências **pendentes futuras** e suas atribuições; mantém concluídas, `fairnessDebt` e atribuições históricas; recusa trocas pendentes envolvidas (notificando). Portar para o TS (`domain/commands/tasks.ts`), regenerar fixtures, documentar em ALGORITMO.md/ARQUITETURA.md (fecha a pergunta 18).
8. Apagar `ProfileView`/`ProfileViewModel`/`makeProfileViewModel` (manter os use cases do domínio).
- Pronto quando: teste de UI/integração cobrindo "ação na casa não troca o store"; teste de unidade do `AuthService` com sessão expirada (com um provedor fake, sem rede); testes Swift do novo `endTask` + fixture; nenhuma tela promete WhatsApp.
- Como testar: `xcodebuild test`, `swift test`, `npm test`; manualmente no simulador com o Amplify **não** implantado: forçar erro de rede (modo avião) e conferir que dá para sair da conta.

### Fase 2 — Antes do primeiro deploy do Amplify Data (só se você decidir implantar; ~2 dias)
Objetivo: não abrir buraco de segurança nem perder morador.
1. `join-house`: recusar convite cujo `members` esteja vazio ou não seja subconjunto de `house.members` (função pura em `members.ts`, com teste). Fecha o convite forjado.
2. `join-house`: gravar a **união** relida (`house.members` ∪ {sub}), depois reler e conferir que o `sub` está lá; senão repetir (até N vezes). Cada participante confere a própria presença, então entradas simultâneas convergem. Se `update` com `condition` for suportado pelo cliente Gen 2 (**HIP**, verificar), preferir condição em `updatedAt`.
3. `HouseService`: reler casa e detalhes imediatamente antes de `detach`, `addRoom` e `addResident`; `remaining` sempre a partir da casa relida.
4. `leaveHouse` retomável: se `myMember == nil` mas o `sub` está em `house.members`, completar a saída.
5. `load()`: consulta pelo índice `userId` (documento GraphQL próprio, como o `joinHouse`); se houver várias casas, escolher de forma determinística (a mais antiga) e só aceitar casa cujo `members` contém o usuário.
6. Ordem do deploy (cada passo com sua autorização): (a) `ampx sandbox` pessoal do dono, conferir o diff do CloudFormation (nenhuma mudança no user pool `us-east-1_M9GpISkE3`); (b) apagar registros antigos sem `members`; (c) `modelgen` e comparar com `Data/Amplify/Models` (P6); (d) roteiro P1–P9 com duas contas de teste, mais os casos novos: convite forjado, duas entradas simultâneas, remoção com tela velha; (e) só então `dev` compartilhado/TestFlight.
- Pronto quando: P1–P9 e os 3 casos novos anotados em VALIDACAO-APIS-REAIS.md §5.

### Fase 3 — Antes de ligar o WhatsApp (backend; maior bloco)
Objetivo: o bot e o app falarem da **mesma** casa.
1. Decidir a pergunta 1 (transação > 100 ações) — ver decisão D3. Sem isso, entrar/sair de casa no servidor falha fechado.
2. Domínio TS: `createHouse(founderUserID, name, timezone)` (cria "Casa toda" e `ACCESSCODE#`), `joinHouseByCode(userID, code)` (usa o caminho de `addHouseMember` com usuário existente), `leaveHouse(userID)`. Fixtures: o replanejamento é o mesmo de `addHouseMember`/`removeHouseMember`, já coberto; só regras de casa novas.
3. Pontos de entrada das Lambdas, empacotamento (perguntas 13–15) e Terraform da tabela/filas/Function URLs.
4. Rotas: `POST /v1/houses`, `POST /v1/houses/join`, `GET /v1/me/house`, `DELETE /v1/me/house`, e as de tarefas da seção 6 que o app usa.
5. Validações reais (D1–D6, A1–A9, G1–G9, M1–M6), cada uma autorizada por você.
6. Vínculo: desvincular o WhatsApp ao sair da casa (pergunta 10) — recomendo sim.
- Pronto quando: um morador cria casa e tarefa pela `api` em `dev`, outro entra pelo código, e o bot responde "minhas tarefas" igual ao app.

### Fase 4 — Migração do app para a `api` (fim do Amplify Data)
1. `Data/Remote` implementando os protocolos de repositório do domínio; `AppContainer` troca os Mocks. Enviar o **access token**; `User.id` passa a vir de `POST /v1/me`, não do `sub`.
2. `HouseService` e `Data/Amplify` saem; `RootView.syncWithHouse` e `AppContainer.sync` saem.
3. Migração dos dados do Amplify (se houver usuários reais): script único, idempotente, por casa: `ensureUser(sub)` de cada morador com conta → `seedHouse` com moradores sem conta como usuários sem `COGNITO#`; **código novo** (o `InviteCode` do Amplify morre; não tentar reaproveitar) e aviso no app; tarefas não migram (estão no aparelho). Rodar em `dev` com cópia, depois `prod`. Desligar o Amplify Data só depois de uma versão do app que não o usa estar adotada.
4. O `GrupuxoDomain` Swift e o gerador de fixtures saem do caminho (regra do CLAUDE.md).

---

## 4. Decisões que você precisa tomar

**D1. Implantar o Amplify Data ou ir direto para a `api`?**
- (a) Implantar após a Fase 2: login + casa compartilhada logo; custa ~2 dias de código descartável endurecido e um script de migração, e entrega uma casa compartilhada com tarefas por aparelho (confusão garantida se chegar a usuários reais).
- (b) **Recomendo:** não pôr o Amplify Data na frente de usuários reais. Fazer só a Fase 1 agora e concentrar a Frente B na Fase 3/4 (`api` + `Data/Remote`). Se precisar de demo interna, implantar no sandbox do dono após a Fase 2, sem TestFlight. Consequência: o app só fica "de verdade" quando a `api` existir, mas sem migração nem dois códigos de convite.

**D2. Identidade:** manter `User.id` próprio + `COGNITO#<sub>` no backend (**recomendo**; desacopla do pool e permite unir contas Apple/e-mail depois) ou usar o `sub` como `User.id` (mais simples na migração, acoplado ao pool para sempre).

**D3. Transação > 100 ações (pergunta 1):** **recomendo (c) agrupar a escala futura** (ocorrências pendentes + atribuições de uma tarefa num item, histórico imutável em itens separados): `addMember` passa a reescrever poucos itens e o modelo continua simples. (a) intenção com *roll-forward* é a mais geral, mas é a mais complexa; (b) lotes no domínio quebra a atomicidade que o domínio assume. Medir antes de decidir (D3 e D5 do checklist, ainda sem AWS: dá para medir com o cliente falso).

**D4. Morador sem conta:** permitir "reivindicar" o registro ao entrar pelo código (escolher "sou eu" na lista) ou proibir moradores sem conta. Recomendo reivindicar, só no servidor (Fase 3).

**D5. `DeleteTask`:** "encerrar" (recomendo, Fase 1.7) ou excluir de vez com permissão.

---

## 5. Riscos que o plano não elimina / o que monitorar
- Comportamento real do Amplify/AppSync/Cognito marcado como HIP (sessão expirada, `ownersDefinedIn` em lista, filtro após `limit`, `condition` no update, `sub` sempre UUID): só teste real confirma.
- Custo de `Query` da partição inteira cresce com o histórico (pergunta 2); monitorar RCU por requisição.
- Limite do WhatsApp: nono dígito, janela de 24 h, template para lembretes.
- Contas Apple e e-mail do mesmo morador são pessoas diferentes.
- Monitorar: DLQ com mensagens, 5xx da `api`, `DynamoStoreError(conflict|tooManyWrites)`, 401/403 por versão do app, taxa de "casa não encontrada" no `load()`.

## 6. Processo enxuto para as equipes não divergirem
1. **Contrato antes de código:** qualquer coisa que cruze app↔servidor (rota, campo, id, erro) entra primeiro como PR só de doc em BACKEND.md §6 / ARQUITETURA.md, revisado por alguém de cada frente.
2. **Um dono por conceito:** identidade, casa e convite são da Frente A (servidor); a Frente B consome. Nada de segunda implementação "provisória" sem data de remoção escrita.
3. **Branches curtas e CI obrigatório** (Fase 0.3) na `main`; merge semanal na `main` em vez de branches longas (hoje há ~10 branches locais sem upstream e a `origin/banco_de_dados` reinventando a persistência em paralelo).
4. Checklist de PR com os itens do CLAUDE.md que mais quebram: Swift↔TS + fixtures, docs no mesmo commit, nenhuma chamada real.
5. Repositório fora de pasta sincronizada (iCloud/Dropbox).

## Verificação geral
- `npm run typecheck && npm test` em `backend`, `swift test --package-path grupuxo/Packages/GrupuxoDomain`, `xcodebuild test … -only-testing:grupuxoTests`, todos na cópia fora do iCloud.
- Testes reais só com autorização item a item, anotados em `docs/VALIDACAO-APIS-REAIS.md`.
