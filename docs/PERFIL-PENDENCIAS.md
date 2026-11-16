# Perfil (Ajustes): o que falta do design

Design: Figma "Reveza · Oficial (clicável)", seção "6 · Ajustes". Código em `grupuxo/grupuxo/Presentation/Features/Profile/`. Estado em 12/11/2026. O que já existe: raiz Ajustes em sheet, Conta (nome e foto editáveis, alterar senha, apagar conta), Casa (nome editável, código, sair), modo férias, Notificações (push por tipo e lembretes locais) e WhatsApp. A lista geral do que o Figma pede e o app não faz está em [PENDENCIAS.md](../PENDENCIAS.md); aqui ficam só os itens do Perfil.

Regra geral: nova rota na `api` entra primeiro em `docs/BACKEND.md` (seção 6.1 e, se mudar modelo, seção 4), com o adaptador, os testes de contrato e o `RemoteRepositories` no app. Publicar no `dev` exige autorização do dono.

## Feito

- Nome do morador (`PATCH /v1/me`) e da casa (`PATCH /v1/houses/{id}`), qualquer morador renomeia a casa.
- Foto do perfil (S3 com URL pré-assinada), no onboarding e em Ajustes; apagada junto com a conta.
- Modo férias (`/v1/me/absence`), com o rodapé "a partir do próximo ciclo".
- Alterar senha (oculta para conta Apple) e preferências de push (`/v1/me/notification-preferences`).
- Lembretes locais (resumo diário, virada de ciclo, chegada em casa) e "Sincronizar com o Lembretes", em Ajustes › Notificações.
- Política de Privacidade (`GRUPUXO_PRIVACY_POLICY_URL`).

## Falta

- [ ] **Ajuda, Feedback e Termos:** `GRUPUXO_HELP_URL`, `GRUPUXO_FEEDBACK_URL` (aceita `mailto:`) e `GRUPUXO_TERMS_URL` seguem vazios no `Grupuxo.xcconfig` (a linha não aparece no app). Em URL use `/$()/` no lugar de `//`. O App Store Connect usa a página da política como URL de Suporte; vale uma página de suporte própria. Conferir também o conteúdo de "Como o Reveza funciona".
- [ ] **Sair da casa "até o fim do ciclo":** o Figma diz "Você continua com as tarefas do ciclo atual até ele terminar. Depois, sai de todos os rodízios."; o app tira o morador na hora ("Ao sair, você deixa todos os cômodos da casa."). Implementar mexe no algoritmo (Swift, TypeScript, fixtures).
- [ ] **Texto de "Apagar conta":** o Figma fala em "seu histórico"; o app descreve o que o `DELETE /v1/me` faz (perfil, vínculo do WhatsApp e saída da casa). A designer decide qual vale.
- [ ] **Ajustes › Notificações:** o Figma tem "Lembrar das minhas tarefas" com "Horário", "Quando o ciclo virar", "Atividade da casa" e "Resumo da semana". O app usa os lembretes locais do ramo Shortcuts e tem itens sem frame ("Chegada em casa", "Sincronizar com o Lembretes", atalhos do Siri). A designer precisa desenhar ou aprovar.
- [ ] **Tela de WhatsApp:** o Figma tem o frame "WhatsApp (Ajustes)", mas só com o texto de rodapé e o alerta; conferir o restante contra o app.
- [ ] **Estados sem frame:** carregando, erro de rede, sem casa, WhatsApp não conectado, conta Apple sem e-mail.
- [ ] **Acessibilidade e aparelhos:** revisar no iPad, com Dynamic Type grande (`AccessibilityXL`, como em `grupuxoUITests`) e VoiceOver.
- [ ] **Testes de UI** do fluxo de Ajustes (abrir Ajustes, Conta, sair da conta): o `grupuxoUITests` só cobre moradores, cômodos e criação.
- [ ] **Validar com login real:** e-mail e "Entrou com" vêm do ID token (`AccountIdentity`); conferir com uma conta de e-mail e uma da Apple no `dev` e ajustar o rótulo se a claim `identities` vier em outro formato.
