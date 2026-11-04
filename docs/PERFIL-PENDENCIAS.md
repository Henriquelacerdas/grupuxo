# Perfil (Ajustes): o que falta do design

Design: Figma "Designuxo", nó `847:3410` (frames Ajustes, Conta, Casa, Notificações). Implementado: raiz Ajustes em sheet, Conta, Casa, Notificações (só Lembretes) e WhatsApp. Código em `grupuxo/grupuxo/Presentation/Features/Profile/`. Esta lista cobre o que o design pede e o app ainda não faz, na ordem sugerida (do que destrava mais ao que exige mais backend).

Regra geral: nova rota na `api` entra primeiro em `docs/BACKEND.md` (seção 6.1 e, se mudar modelo, seção 4), com o adaptador, os testes de contrato e o `RemoteRepositories` no app. Publicar no `dev` exige autorização do dono.

## 1. Só configuração (sem código novo)

- [x] **Política de Privacidade**: `GRUPUXO_PRIVACY_POLICY_URL` preenchida em `grupuxo/Config/Grupuxo.xcconfig` com a mesma URL do App Store Connect (`https://henriquelacerdas.github.io/reveza-privacy/`, conferida em 04/11/2026).
- [ ] **Ajuda, Feedback e Termos**: ainda vazios (a linha não aparece no app): `GRUPUXO_HELP_URL`, `GRUPUXO_FEEDBACK_URL` (aceita `mailto:`), `GRUPUXO_TERMS_URL`. Em URL use `/$()/` no lugar de `//`. Hoje não existe página para nenhum; o App Store Connect usa a página da política também como URL de Suporte, o que vale trocar por uma página de suporte própria.
- [ ] Conferir o conteúdo da página "Como o Reveza funciona" (o app só abre a URL).

## 2. Texto do design a alinhar com o produto

- [ ] **Rodapé de "Sair da casa"**: o design diz "Você continua com as tarefas do ciclo atual até ele terminar. Depois, sai de todos os rodízios." O produto hoje (`docs/PRODUTO.md`) tira o morador de todos os cômodos na hora; o app usa "Ao sair, você deixa todos os cômodos da casa." Decidir: mudar o design ou implementar a saída ao fim do ciclo (mexe no algoritmo: Swift de referência, TypeScript, fixtures).
- [ ] **Rodapé de "Apagar conta"**: o design fala em "seu histórico"; o `DELETE /v1/me` apaga perfil e vínculo do WhatsApp e tira da casa. Confirmar o texto final com o design.
- [ ] **Subtítulo do cartão** ("Conta, foto e nome" no design, "Sua conta" no app): volta ao do design quando houver foto e edição de nome (itens 3 e 4).

## 3. Edição de nome (Conta e Casa)

- [ ] **Nome do morador**: hoje `POST /v1/me` não sobrescreve nome. Criar rota (por exemplo `PATCH /v1/me { name }`, `400 invalid_name`), comando de domínio, atualização do perfil `USER#<id>` no DynamoDB, invalidar `MyHouseCache`. No app, trocar o `Text(me.name)` de `AccountView` por campo editável com salvar.
- [ ] **Nome da casa**: não há rota. Criar `PATCH /v1/houses/{houseID} { name }` (1 a 80 caracteres, como na criação), restrita a moradores. Em `HouseSettingsView`, campo editável.
- [ ] Decidir quem pode renomear a casa (qualquer morador ou só quem criou). O design mostra "Criou a casa" na lista de moradores, mas `House` não guarda o criador (precisa de `createdBy`, modelo na seção 4 do BACKEND.md).

## 4. Foto de perfil

- [ ] Escolher armazenamento (S3 com URL pré-assinada é o caminho natural) e registrar a decisão em `docs/BACKEND.md`.
- [ ] Campo de foto no `User` (domínio Swift e TypeScript) e nos DTOs; fotos dos moradores na lista de Casa e no cartão.
- [ ] "Alterar foto" em `AccountView` com `PhotosPicker`, recorte, compressão e erro de upload. Fallback continua sendo as iniciais (`ResidentAvatar`).
- [ ] Exclusão da foto ao apagar a conta (`DELETE /v1/me`).

## 5. Modo férias

- [ ] O domínio já tem `Absence` (`Entities/Absence.swift`) e o algoritmo respeita ausência, mas não existe rota nem repositório remoto. Criar rotas para ler, criar e encerrar ausência do morador, repositório `Remote…` e use cases.
- [ ] Linha "Modo férias" com toggle na seção "Você" e o rodapé do design ("Você sai dos rodízios a partir do próximo ciclo e volta quando desligar").
- [ ] Conferir no algoritmo se "a partir do próximo ciclo" é o comportamento real; senão, ajustar o texto ou a regra (mexer no algoritmo exige Swift, TypeScript e fixtures regeneradas).

## 6. Notificações (tela do design)

O design tem 5 itens; o app só tem "Sincronizar com o Lembretes" (local).

- [ ] **Lembrar das minhas tarefas + Horário**: lembrete diário local (`UNUserNotificationCenter`) com a lista do que está com o morador, e seletor de horário. Decidir se é local (mais simples) ou push (exige APNs e backend).
- [ ] **Quando o ciclo virar**, **Atividade da casa** e **Resumo da semana**: preferências por tipo de aviso. Precisam de rota para guardar as preferências do morador e de quem dispare os avisos (hoje as notificações cobrem só trocas de tarefa, `docs/PRODUTO.md`).
- [ ] Decidir se "Sincronizar com o Lembretes" continua nesta tela junto dos novos itens.
- [ ] Atualizar WhatsApp/boas-vindas só se algum aviso novo sair pelo bot (regra do `CLAUDE.md` sobre `WHATSAPP-MENSAGENS.md`).

## 7. Acabamento visual e de comportamento

- [ ] Extrair tokens exatos do Figma (cores, raios, espaçamentos, tipografia) quando o MCP do Figma estiver autorizado com a conta dona do arquivo, e comparar com a implementação (hoje foi feita sobre o embed, só pixels).
- [ ] Tela de WhatsApp: o design não tem frame para ela; hoje reaproveita a seção existente. Pedir o frame ao design.
- [ ] Estados sem frame no design: carregando, erro de rede, sem casa, WhatsApp não conectado, conta Apple sem e-mail.
- [ ] Revisar no iPad, Dynamic Type grande (`AccessibilityXL`, como em `grupuxoUITests`) e VoiceOver.
- [ ] Testes de UI do fluxo (abrir Ajustes, abrir Conta, sair da conta) no `grupuxoUITests`, que hoje não cobre o perfil.

## 8. Validar com login real

- [ ] E-mail e "Entrou com" são lidos do ID token (`AccountIdentity`) e só foram testados com tokens montados à mão. Conferir com uma conta de e-mail e uma da Apple no `dev`; ajustar o rótulo se a claim `identities` vier em outro formato.
